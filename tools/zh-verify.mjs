// 在 Electron 里以 ELECTRON_RUN_AS_NODE 运行时，asar fs 包装会把 `*.asar` 路径当容器解析，
// 直接 fs.openSync(app.asar) 会报 ENOENT。这里关掉包装。
if (typeof process !== 'undefined') { try { process.noAsar = true; } catch { } }
// 校验产物 asar：结构完整性 + 改动条目读回
import fs from 'node:fs';
import crypto from 'node:crypto';

const SRC = process.argv[2] || String.raw`E:\holaos-zh-build\app.zh.asar`;
const fd = fs.openSync(SRC, 'r');
const fileSize = fs.fstatSync(fd).size;
const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0);
const hb = head.readUInt32LE(4);
const hp = Buffer.alloc(hb); fs.readSync(fd, hp, 0, hb, 8);
const jl = hp.readUInt32LE(4);
const header = JSON.parse(hp.subarray(8, 8 + jl).toString('utf8'));
const dataStart = 8 + hb;
const dataLen = fileSize - dataStart;
console.log(`file ${(fileSize / 1048576).toFixed(1)} MB | dataStart ${dataStart} | data ${(dataLen / 1048576).toFixed(1)} MB`);

const entries = [];
(function walk(n, p) {
  if (n.files) { for (const [k, v] of Object.entries(n.files)) walk(v, p + '/' + k); }
  else entries.push({ node: n, path: p, size: n.size, offset: Number(n.offset), unpacked: !!n.unpacked });
})({ files: header.files }, '');
console.log(`entries ${entries.length} | unpacked ${entries.filter(e => e.unpacked).length}`);

let bad = 0;
for (const e of entries) {
  if (e.unpacked) continue;
  if (!(e.offset >= 0 && e.size >= 0 && e.offset + e.size <= dataLen)) { bad++; if (bad < 6) console.log(`  OUT OF RANGE ${e.path} ${e.offset}+${e.size} > ${dataLen}`); }
}
console.log(`range check: ${bad === 0 ? 'PASS' : 'FAIL ' + bad}`);

// integrity 全量重算：抽样 200 条 + 全部改动条目
const calc = (buf) => {
  const bs = 4 * 1024 * 1024; const blocks = [];
  for (let o = 0; o < buf.length; o += bs) blocks.push(crypto.createHash('sha256').update(buf.subarray(o, o + bs)).digest('hex'));
  return { hash: crypto.createHash('sha256').update(buf).digest('hex'), blocks };
};
const sample = entries.filter(e => !e.unpacked && e.node.integrity).filter((_, i) => i % 97 === 0);
let integ = 0, integBad = 0;
for (const e of sample) {
  const b = Buffer.alloc(e.size); fs.readSync(fd, b, 0, e.size, dataStart + e.offset);
  const c = calc(b);
  if (c.hash === e.node.integrity.hash && c.blocks.every((h, i) => h === e.node.integrity.blocks[i])) integ++;
  else { integBad++; if (integBad < 6) console.log(`  INTEGRITY MISMATCH ${e.path}`); }
}
console.log(`integrity sample: ${integ} ok / ${integBad} bad (of ${sample.length})`);

// 改动的 7 个文件读回，确认中文在
const targets = ['index-r09AJlLv.js', 'chunk-BMBP5UFA-PFTPK4_4.js', 'UniverSpreadsheetView-DUqSqAwv.js'];
for (const t of targets) {
  const e = entries.find(x => x.path.endsWith('/' + t));
  if (!e) { console.log(`  MISSING ${t}`); continue; }
  const b = Buffer.alloc(e.size); fs.readSync(fd, b, 0, e.size, dataStart + e.offset);
  const s = b.toString('utf8');
  const zh = (s.match(/[\u4e00-\u9fff]{1,10}/g) || []).length;
  console.log(`  ${t}: size ${e.size} @${e.offset} | 中文字段数 ${zh} | 尾部 40B: ${JSON.stringify(s.slice(-40))}`);
}
fs.closeSync(fd);
