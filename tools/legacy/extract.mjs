// 用与 build-zh.mjs 完全相同的锚定规则，把 out 下所有 UI 文案抽成清单
// 输出: _probe/ui-final.json  { "英文": {count, files, maxLen} }
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || String.raw`E:\Local\Programs\holaOS\resources\app.asar`;
const OUTDIR = path.join(import.meta.dirname, '..', '_probe');

const UI_KEYS = [
  'children', 'label', 'title', 'placeholder', 'description', 'tooltip', 'hint',
  'alt', 'aria-label', 'ariaLabel', 'srLabel', 'emptyText', 'emptyTitle',
  'emptyDescription', 'emptyLabel', 'confirmText', 'cancelText', 'submitText',
  'actionLabel', 'actionText', 'buttonText', 'linkText', 'heading', 'subheading',
  'helpText', 'helpLabel', 'errorText', 'errorMessage', 'subtitle', 'detail',
  'caption', 'badge', 'footerNote', 'footerText', 'headerText', 'note',
  'dialogTitle', 'dialogDescription', 'statusText', 'hintText', 'captionText',
  'labelText', 'titleText', 'descriptionText', 'promptText', 'summary',
];
const KEY_ALT = UI_KEYS.map(k => k.replace(/[-]/g, '\\-')).join('|');
const RE = new RegExp(`((?:^|[{,(\\s])(?:${KEY_ALT})\\s*:\\s*)(?:\`([^\`\\n\\\\$]{1,400})\`|"([^"\\n\\\\$]{1,400})"|'([^'\\n\\\\$]{1,400})')`, 'g');

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

const entries = [];
(function walk(n, p) {
  if (n.files) { for (const [k, v] of Object.entries(n.files)) walk(v, p + '/' + k); }
  else entries.push({ path: p, size: n.size, offset: Number(n.offset), unpacked: !!n.unpacked });
})({ files: header.files }, '');

const targets = entries.filter(e => !e.unpacked && e.path.startsWith('/out/') && /\.(js|cjs|mjs|html)$/.test(e.path));
const map = new Map();
let fileCount = 0;
for (const e of targets) {
  const buf = Buffer.alloc(e.size);
  fs.readSync(fd, buf, 0, e.size, dataStart + e.offset);
  const text = buf.toString('utf8');
  let m, found = 0;
  RE.lastIndex = 0;
  while ((m = RE.exec(text))) {
    const val = m[2] ?? m[3] ?? m[4];
    if (!val || !/[A-Za-z]/.test(val)) continue;
    found++;
    const rec = map.get(val) || { count: 0, files: [] };
    rec.count++;
    if (rec.files.length < 6 && !rec.files.includes(e.path)) rec.files.push(e.path);
    map.set(val, rec);
  }
  if (found) fileCount++;
}
fs.closeSync(fd);

const arr = [...map.entries()].sort((a, b) => b[1].count - a[1].count);
const out = {};
for (const [k, v] of arr) out[k] = { count: v.count, files: v.files.length };
fs.writeFileSync(path.join(OUTDIR, 'ui-final.json'), JSON.stringify(out, null, 1));

const buckets = { '1-8': 0, '9-16': 0, '17-32': 0, '33-64': 0, '65-120': 0, '120+': 0 };
for (const [k] of arr) {
  const L = k.length;
  if (L <= 8) buckets['1-8']++; else if (L <= 16) buckets['9-16']++; else if (L <= 32) buckets['17-32']++;
  else if (L <= 64) buckets['33-64']++; else if (L <= 120) buckets['65-120']++; else buckets['120+']++;
}
console.log(`scanned files ${targets.length}, files with hits ${fileCount}`);
console.log(`unique strings ${arr.length}, total occurrences ${arr.reduce((a, b) => a + b[1].count, 0)}`);
console.log('length buckets:', JSON.stringify(buckets));
console.log('top 60:');
for (const [k, v] of arr.slice(0, 60)) console.log(`  ${String(v.count).padStart(3)}  ${k.slice(0, 100)}`);
