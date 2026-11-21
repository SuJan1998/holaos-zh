// 原地字节补丁：不改 header / 不改 offset / 不改文件大小
// 只允许「UTF-8 字节长度完全一致」的替换（如 Cancel(6B) -> 取消(6B)），
// 用来判定「补丁版不启动」到底是结构问题还是内容问题。
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || String.raw`E:\Local\Programs\holaOS\resources\app.asar`;
const DICTDIR = process.argv[3] || path.join(import.meta.dirname, '..', 'dict');

const dict = new Map();
for (const f of fs.readdirSync(DICTDIR).filter(f => f.endsWith('.json')).sort()) {
  const obj = JSON.parse(fs.readFileSync(path.join(DICTDIR, f), 'utf8'));
  for (const [en, zh] of Object.entries(obj)) {
    if (!en || !zh || en === zh) continue;
    if (Buffer.byteLength(en, 'utf8') === Buffer.byteLength(zh, 'utf8')) dict.set(en, zh);
    else console.log(`skip (len mismatch): ${en} -> ${zh}`);
  }
}
console.log('usable entries:', dict.size);

const UI_KEYS = ['children', 'label', 'title', 'placeholder', 'description', 'tooltip', 'hint',
  'alt', 'aria-label', 'ariaLabel', 'emptyText', 'emptyTitle', 'confirmText', 'cancelText',
  'submitText', 'actionLabel', 'heading', 'subheading', 'helpText', 'errorText', 'subtitle', 'detail'];
const KEY_ALT = UI_KEYS.map(k => k.replace(/-/g, '\\-')).join('|');
const RE_BT = new RegExp(`((?:^|[{,(\\s])(?:${KEY_ALT})\\s*:\\s*)\`([^\`\\n\\\\$]{1,400})\``, 'g');

const fd = fs.openSync(SRC, 'r+');
const fileSize = fs.fstatSync(fd).size;
const head = Buffer.alloc(8);
fs.readSync(fd, head, 0, 8, 0);
const hbSize = head.readUInt32LE(4);
const hp = Buffer.alloc(hbSize);
fs.readSync(fd, hp, 0, hbSize, 8);
const jl = hp.readUInt32LE(4);
const header = JSON.parse(hp.subarray(8, 8 + jl).toString('utf8'));
const dataStart = 8 + hbSize;

const entries = [];
(function walk(n, p) {
  if (n.files) { for (const [k, v] of Object.entries(n.files)) walk(v, p + '/' + k); }
  else entries.push({ path: p, size: n.size, offset: Number(n.offset), unpacked: !!n.unpacked });
})({ files: header.files }, '');

const targets = entries.filter(e => !e.unpacked && e.path.startsWith('/out/') && /\.(js|cjs|mjs)$/.test(e.path));
let totalFiles = 0, totalHits = 0, totalBytes = 0;
for (const e of targets) {
  const buf = Buffer.alloc(e.size);
  fs.readSync(fd, buf, 0, e.size, dataStart + e.offset);
  let text = buf.toString('utf8');
  let hits = 0;
  text = text.replace(RE_BT, (m, prefix, val) => {
    const zh = dict.get(val);
    if (zh === undefined) return m;
    if (m.length !== Buffer.byteLength(m, 'utf8')) return m;
    hits++;
    return prefix + '`' + zh + '`';
  });
  if (!hits) continue;
  const nb = Buffer.from(text, 'utf8');
  if (nb.length !== e.size) { console.log('SIZE DRIFT (should not happen)', e.path); continue; }
  fs.writeSync(fd, nb, 0, nb.length, dataStart + e.offset);
  totalFiles++; totalHits += hits; totalBytes += nb.length;
  console.log(`  ${e.path}  x${hits}`);
}
fs.closeSync(fd);
console.log(`patched files=${totalFiles} replacements=${totalHits}`);
