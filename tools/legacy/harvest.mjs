// 从原始 asar 的渲染层 chunk 里淘「还没进词表的英文 UI 文案」
// 用法: node harvest.mjs [--asar path] [--top 300] [--out file]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ASAR = arg('--asar', String.raw`E:\Local\Programs\holaOS\resources\app.asar.orig`);
const TOP = Number(arg('--top', 300));
const OUT = arg('--out', 'E:\\tmp\\harvest.json');
const DICTDIR = path.join(import.meta.dirname, '..', 'dict');

// ---- 已用词表 ----
const dict = new Set();
for (const f of fs.readdirSync(DICTDIR).filter(f => f.endsWith('.json'))) {
  const o = JSON.parse(fs.readFileSync(path.join(DICTDIR, f), 'utf8'));
  for (const k of Object.keys(o)) dict.add(k);
}

// ---- 读 asar ----
const fd = fs.openSync(ASAR, 'r');
const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0);
const hbSize = head.readUInt32LE(4);
const hp = Buffer.alloc(hbSize); fs.readSync(fd, hp, 0, hbSize, 8);
const jsonLen = hp.readUInt32LE(4);
const header = JSON.parse(hp.subarray(8, 8 + jsonLen).toString('utf8'));
const dataStart = 8 + hbSize;
const readEntry = (e) => { const b = Buffer.alloc(e.size); fs.readSync(fd, b, 0, e.size, dataStart + Number(e.offset)); return b; };

const files = [];
(function walk(node, p) {
  if (!node) return;
  if (node.files) { for (const [k, v] of Object.entries(node.files)) walk(v, p + '/' + k); return; }
  if (p.startsWith('/out/dist/assets/') && p.endsWith('.js') && !node.unpacked) files.push({ path: p, node });
})(header, '');

// ---- 收集字面量 ----
const count = new Map();
for (const f of files) {
  if (/Univer|DocxEditor|PptxRenderer|zh-CN-/.test(f.path)) continue; // 第三方编辑器跳过
  const src = readEntry(f.node).toString('utf8');
  for (const q of ['\x60', '"']) {
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^' + q + '\\n]{1,120})' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    let m;
    while ((m = re.exec(src))) {
      const v = m[1];
      count.set(v, (count.get(v) || 0) + 1);
    }
  }
}
fs.closeSync(fd);

// ---- 过滤：像 UI 文案的英文 ----
const looksUI = (s) => {
  if (!s || s.length > 90) return false;
  if (!/^[A-Za-z]/.test(s)) return false;
  if (!/^[A-Za-z0-9 ,.'’…:!?%+\-/&()→·]+$/.test(s)) return false;   // 只允许常见标点
  if (/[a-z][A-Z]/.test(s) && !/ /.test(s)) return false;              // camelCase 标识符
  if (/^(https?|www|className|aria|data-|text-|bg-|px-|py-|flex|grid|size-|rounded|hover|focus|duration|ease|font-|leading|tracking|whitespace)/.test(s)) return false;
  if (/^[A-Z_]{2,}$/.test(s)) return false;                            // 全大写枚举
  if (/^(true|false|null|undefined|NaN|function|return|import|export|const|let|var|typeof|default)$/.test(s)) return false;
  if (/\.(js|ts|tsx|cjs|mjs|json|css|svg|png|jpg|webp|md)$/i.test(s)) return false;
  if (/^[a-z]+(-[a-z0-9]+)+$/.test(s)) return false;                   // kebab id
  if (/^[a-z0-9_]+$/.test(s)) return false;                            // 小写标识符
  if (s.split(' ').length > 14) return false;
  return true;
};

const out = [];
for (const [s, n] of count) {
  if (dict.has(s)) continue;
  if (!looksUI(s)) continue;
  out.push({ s, n });
}
out.sort((a, b) => b.n - a.n || a.s.length - b.s.length);
fs.writeFileSync(OUT, JSON.stringify(out.slice(0, TOP), null, 1), 'utf8');
console.log(`scanned ${files.length} files, unique literals ${count.size}, candidates ${out.length}, wrote top ${Math.min(TOP, out.length)} -> ${OUT}`);
