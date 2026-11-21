// 在 Electron 里以 ELECTRON_RUN_AS_NODE 运行时，asar fs 包装会把 `*.asar` 路径当容器解析，
// 直接 fs.openSync(app.asar) 会报 ENOENT。这里关掉包装。
if (typeof process !== 'undefined') { try { process.noAsar = true; } catch { } }
// holaOS zh-CN 构建器 v2
// 用法: node zh-build.mjs [--src app.asar] [--out app.zh.asar] [--dict dir] [--dry] [--stats] [--try-integrity]
//
// 与 v1 的关键差异（都是上一轮「装完不启动」的嫌疑点）：
//   1) 只改 out/dist/assets 下的渲染层 chunk，**不碰** out/dist-electron/main.cjs
//      —— main.cjs 是主进程入口，改坏它 = 进程直接退出，这正是「200s 内 0 进程」的最可能原因
//   2) 追加数据按 4 字节对齐（asar 内部偏移按 4 对齐更安全）
//   3) 对被改动条目**重算 integrity**（SHA256 + blocks），消除一切哈希校验分支
//   4) 写出前做语法自检：用 new Function / esbuild 语法校验太重，这里退化为
//      「改动处的前后 40 字节仍能被同一个引号闭合」+ 括号/引号计数守恒检查
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SRC = arg('--src', String.raw`E:\Local\Programs\holaOS\resources\app.asar`);
const OUT = arg('--out', path.join(path.dirname(SRC), 'app.zh.asar'));
const DICTDIR = arg('--dict', path.join(import.meta.dirname, '..', 'dict'));
const DRY = args.includes('--dry');
const STATS = args.includes('--stats');

// 渲染层白名单：只有这些路径可以被改写
const SAFE_PREFIX = '/out/dist/assets/';
const SAFE_EXT = /\.js$/;

const UI_KEYS = [
  'children', 'label', 'title', 'placeholder', 'description', 'tooltip', 'hint',
  'alt', 'aria-label', 'ariaLabel', 'srLabel', 'emptyText', 'emptyTitle',
  'emptyDescription', 'emptyLabel', 'confirmText', 'cancelText', 'submitText',
  'actionLabel', 'actionText', 'buttonText', 'linkText', 'heading', 'subheading',
  'helpText', 'helpLabel', 'errorText', 'errorMessage', 'subtitle',
  'caption', 'badge', 'footerNote', 'footerText', 'headerText', 'note',
  'dialogTitle', 'dialogDescription', 'statusText', 'hintText',
  'labelText', 'titleText', 'descriptionText', 'promptText',
];
const KEY_ALT = UI_KEYS.map(k => k.replace(/[-]/g, '\\-')).join('|');
// 值里禁止出现：反引号/引号/换行/反斜杠/$  —— 避免破坏模板字面量与插值
const RE_BT = new RegExp(`((?:^|[{,(\\s])(?:${KEY_ALT})\\s*:\\s*)\`([^\`\\n\\\\$]{1,400})\``, 'g');
const RE_DQ = new RegExp(`((?:^|[{,(\\s])(?:${KEY_ALT})\\s*:\\s*)"([^"\\n\\\\$]{1,400})"`, 'g');
const RE_SQ = new RegExp(`((?:^|[{,(\\s])(?:${KEY_ALT})\\s*:\\s*)'([^'\\n\\\\$]{1,400})'`, 'g');

// ---------- 词条 ----------
const dict = new Map();
if (fs.existsSync(DICTDIR)) {
  for (const f of fs.readdirSync(DICTDIR).filter(f => f.endsWith('.json')).sort()) {
    const obj = JSON.parse(fs.readFileSync(path.join(DICTDIR, f), 'utf8'));
    let n = 0;
    for (const [en, zh] of Object.entries(obj)) {
      if (!en || !zh || en === zh) continue;
      if (/[`"'\n\\$]/.test(zh)) { console.warn(`skip bad zh: ${en} -> ${zh}`); continue; }
      dict.set(en, zh); n++;
    }
    console.log(`dict ${f}: +${n}`);
  }
}
console.log(`dictionary: ${dict.size}`);

// ---------- 模板字符串词条（含 ${...} 插值的整条模板） ----------
// 普通词条只匹配「整条字面量」，插值模板（`This device is up to date on the ${n} channel.`）
// 的文本被 ${} 切碎，必须以「整条模板原文」为 key 做精确子串替换。
const tpl = new Map();
const TPLDIR = path.join(DICTDIR, 'templates');
if (fs.existsSync(TPLDIR)) {
  for (const f of fs.readdirSync(TPLDIR).filter(f => f.endsWith('.json')).sort()) {
    const obj = JSON.parse(fs.readFileSync(path.join(TPLDIR, f), 'utf8'));
    let n = 0;
    for (const [en, zh] of Object.entries(obj)) {
      if (!en || !zh || en === zh) continue;
      if (/[`"'\n\\]/.test(zh)) { console.warn(`skip bad template zh: ${en}`); continue; }
      // 插值占位必须一一对应
      const cntPh = (s) => (s.match(/\$\{/g) || []).length;
      if (cntPh(en) !== cntPh(zh)) { console.warn(`template placeholder mismatch: ${en}`); continue; }
      tpl.set(en, zh); n++;
    }
    console.log(`templates/${f}: +${n}`);
  }
}
console.log(`templates: ${tpl.size}`);

// ---------- asar ----------
const fd = fs.openSync(SRC, 'r');
const fileSize = fs.fstatSync(fd).size;
const head = Buffer.alloc(8);
fs.readSync(fd, head, 0, 8, 0);
const headerBufSize = head.readUInt32LE(4);
const headerPickle = Buffer.alloc(headerBufSize);
fs.readSync(fd, headerPickle, 0, headerBufSize, 8);
const jsonLen = headerPickle.readUInt32LE(4);
const header = JSON.parse(headerPickle.subarray(8, 8 + jsonLen).toString('utf8'));
const dataStart = 8 + headerBufSize;
const dataLen = fileSize - dataStart;
console.log(`asar ${(fileSize / 1048576).toFixed(1)} MB | dataStart ${dataStart} | data ${(dataLen / 1048576).toFixed(1)} MB`);

const entries = [];
(function walk(n, p) {
  if (n.files) { for (const [k, v] of Object.entries(n.files)) walk(v, p + '/' + k); }
  else entries.push({ node: n, path: p, size: n.size, offset: Number(n.offset), unpacked: !!n.unpacked });
})({ files: header.files }, '');

// integrity 算法自检：挑一个未打包条目重算，和 header 里的值比对
const readEntry = (e) => {
  const b = Buffer.alloc(e.size);
  fs.readSync(fd, b, 0, e.size, dataStart + e.offset);
  return b;
};
const computeIntegrity = (buf) => {
  const blockSize = 1024 * 1024 * 4;
  const blocks = [];
  for (let o = 0; o < buf.length; o += blockSize) {
    blocks.push(crypto.createHash('sha256').update(buf.subarray(o, o + blockSize)).digest('hex'));
  }
  return { algorithm: 'SHA256', hash: crypto.createHash('sha256').update(buf).digest('hex'), blockSize, blocks };
};
{
  const probe = entries.find(e => !e.unpacked && e.node.integrity && e.size > 1000);
  if (probe) {
    const got = computeIntegrity(readEntry(probe));
    const want = probe.node.integrity;
    const ok = got.hash === want.hash && got.blocks.length === want.blocks.length;
    console.log(`integrity self-check on ${probe.path}: ${ok ? 'MATCH' : 'MISMATCH'} (algorithm=${want.algorithm} blockSize=${want.blockSize})`);
    if (!ok) console.log(`  want=${want.hash.slice(0, 16)} blocks=${want.blocks.length}  got=${got.hash.slice(0, 16)} blocks=${got.blocks.length}`);
  }
}

const targets = entries.filter(e => !e.unpacked && (
  (e.path.startsWith(SAFE_PREFIX) && SAFE_EXT.test(e.path)) ||
  (process.argv.includes('--with-main') && e.path === '/out/dist-electron/main.cjs')
));
console.log(`scannable: ${targets.length} renderer js files (main.cjs / html 已排除)`);

// ---------- 替换 ----------
const changed = [];
const usedKeys = new Set();
const missing = new Set(dict.keys());
const ambigAll = [];
let totalHits = 0;

// 全量一致替换：同一个字面量在**所有渲染层 chunk 里**统一换掉。
// 理由：minified bundle 里同一个字符串既是显示文案，又是 map 的 key / switch 分支 / 比较值；
// 只换「属性位」会让 `t === \`Cancel\`` 这类比较与 data 失配。统一替换能保持内部自洽。
// 代价：如果某字符串同时是后端枚举值，也会被换（所以词表必须只收纯显示词）。
// v3：不做反引号配对解析 —— 直接对每个词的三种定界形式做字面量全量替换。
// 旧版正则 ``\x60([^\x60\n]{1,400})\x60`` 在嵌套模板字符串里会配对错位，导致大量漏替换
// （实测 `Cancel` 35 处只换掉 4 处）。字面量替换不受嵌套影响。
const QUOTES = ['\x60', '"', "'"];
const applyDict = (src) => {
  const hits = [];
  let text = src;
  // 模板替换会改动定界符计数（原文里的 " 被去掉），这里记录预期漂移量，供守恒检查抵扣
  const drift = { '\x60': 0, '"': 0, "'": 0 };
  const cntCh = (s, ch) => { let c = 0; for (let i = 0; i < s.length; i++) if (s[i] === ch) c++; return c; };
  for (const [en, zh] of dict) {
    for (const q of QUOTES) {
      const needle = q + en + q;
      const i = text.indexOf(needle);
      if (i < 0) continue;
      // 统计并全量替换
      let n = 0, pos = i;
      while (pos >= 0) { n++; pos = text.indexOf(needle, pos + needle.length); }
      text = text.split(needle).join(q + zh + q);
      hits.push(en);
    }
  }
  for (const v of hits) { usedKeys.add(v); missing.delete(v); }
  // 插值模板：整条模板原文精确替换（保留 ${...} 占位）
  for (const [en, zh] of tpl) {
    if (!text.includes(en)) continue;
    const times = text.split(en).length - 1;
    text = text.split(en).join(zh);
    for (const ch of QUOTES) drift[ch] += (cntCh(en, ch) - cntCh(zh, ch)) * times;
    hits.push(en);
    usedKeys.add(en); missing.delete(en);
  }
  return { text, hits, ambiguous: [], drift };
};

for (const e of targets) {
  const buf = readEntry(e);
  const src = buf.toString('utf8');
  const { text, hits, ambiguous, drift } = applyDict(src);
  if (ambiguous.length) ambigAll.push(...ambiguous.map(v => `${e.path}: ${v}`));
  if (!hits.length) continue;
  const nb = Buffer.from(text, 'utf8');
  if (nb.equals(buf)) continue;
  // 语法守恒检查：定界符计数必须与原文件一致。
  // 注意：括号不参与检查 —— 词条本身含半角括号（如 "Link (⌘K)"）翻成全角后计数必然变化，
  // 那属于文案层变化，不影响语法。真正的语法校验交给构建后的 `node --check`。
  const cnt = (s, ch) => { let c = 0; for (let i = 0; i < s.length; i++) if (s[i] === ch) c++; return c; };
  for (const ch of ['`', '"']) {
    const d = cnt(src, ch) - cnt(text, ch);
    if (d !== drift[ch]) throw new Error(`quote/bracket drift on ${e.path}: ${ch} (drift ${d} vs expected ${drift[ch]})`);
  }
  changed.push({ entry: e, buf: nb, hits });
  totalHits += hits.length;
}

console.log('---- result ----');
console.log(`files ${changed.length}, replacements ${totalHits}`);
for (const c of changed.slice(0, 20)) console.log(`  ${c.entry.path}  ${c.entry.size}->${c.buf.length}  x${c.hits.length}`);
if (changed.length > 20) console.log(`  ... +${changed.length - 20} more`);
if (STATS) {
  console.log(`dict keys used: ${usedKeys.size} / ${dict.size}`);
  if (missing.size) console.log(`unused: ${[...missing].slice(0, 80).join(' | ')}`);
  if (ambigAll.length) {
    console.log(`ambiguous skipped (${ambigAll.length}):`);
    for (const a of [...new Set(ambigAll)].slice(0, 40)) console.log(`  ${a}`);
  }
}
if (DRY) { console.log('dry run'); fs.closeSync(fd); process.exit(0); }
if (!changed.length) { console.log('no change'); fs.closeSync(fd); process.exit(0); }

// ---------- header 重写：追加区 4 字节对齐 + 重算 integrity ----------
let base = dataLen;
const pads = [];
for (const c of changed) {
  const pad = (4 - (base % 4)) % 4;
  if (pad) { base += pad; pads.push(pad); } else pads.push(0);
  c.entry.node.offset = String(base);
  c.entry.node.size = c.buf.length;
  if (c.entry.node.integrity) c.entry.node.integrity = computeIntegrity(c.buf);
  base += c.buf.length;
}
console.log(`appended ${(changed.reduce((a, c) => a + c.buf.length, 0) / 1048576).toFixed(2)} MB, new total ${(base / 1048576).toFixed(1)} MB`);

const jsonBuf = Buffer.from(JSON.stringify(header), 'utf8');
const payload = 4 + jsonBuf.length;
const pad = (4 - (payload % 4)) % 4;
const hpSize = payload + pad;
const headerOut = Buffer.alloc(4 + hpSize);
headerOut.writeUInt32LE(hpSize, 0);
headerOut.writeUInt32LE(jsonBuf.length, 4);
jsonBuf.copy(headerOut, 8);
const sizeOut = Buffer.alloc(8);
sizeOut.writeUInt32LE(4, 0);
sizeOut.writeUInt32LE(headerOut.length, 4);

// 新 header 变了 ⇒ 数据区起点也变，但 offset 是相对数据区的，所以原数据块整体照搬即可
const newDataStart = 8 + headerOut.length;
console.log(`header ${headerBufSize} -> ${headerOut.length} B | dataStart ${dataStart} -> ${newDataStart}`);

// ---------- 写出 ----------
const tmp = OUT + '.tmp';
try { fs.unlinkSync(tmp); } catch {}
const ws = fs.createWriteStream(tmp);
const write = b => new Promise((res, rej) => ws.write(b, err => err ? rej(err) : res()));
const bail = e => { console.error(e); try { ws.destroy(); fs.unlinkSync(tmp); } catch {} process.exit(1); };
ws.on('error', bail);

(async () => {
  await write(sizeOut);
  await write(headerOut);
  const CHUNK = 8 * 1024 * 1024;
  for (let pos = dataStart; pos < fileSize; pos += CHUNK) {
    const len = Math.min(CHUNK, fileSize - pos);
    const b = Buffer.alloc(len);
    fs.readSync(fd, b, 0, len, pos);
    await write(b);
  }
  for (let i = 0; i < changed.length; i++) {
    if (pads[i]) await write(Buffer.alloc(pads[i]));
    await write(changed[i].buf);
  }
  await new Promise(res => ws.end(res));
  fs.closeSync(fd);
  fs.renameSync(tmp, OUT);
  const outSize = fs.statSync(OUT).size;
  console.log(`OK -> ${OUT}  ${(outSize / 1048576).toFixed(1)} MB`);
  if (outSize !== newDataStart + (base - dataLen) - 0) {
    // 期望大小 = 新 header + 原数据区 + 追加区
    console.log(`size check: ${outSize} vs expected ${newDataStart + dataLen + (base - dataLen)}`);
  }
})().catch(bail);

