// per-file UI 文案统计，用来分辨哪些 chunk 属于 holaOS 主应用、哪些属于 Univer
import fs from 'node:fs';
import path from 'node:path';

const SRC = process.argv[2] || String.raw`E:\Local\Programs\holaOS\resources\app.asar`;
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
const rows = [];
const instrCtx = [];
for (const e of targets) {
  const buf = Buffer.alloc(e.size);
  fs.readSync(fd, buf, 0, e.size, dataStart + e.offset);
  const text = buf.toString('utf8');
  let m, n = 0; RE.lastIndex = 0;
  while ((m = RE.exec(text))) { if (m[2] ?? m[3] ?? m[4]) n++; }
  if (n) rows.push({ path: e.path, size: e.size, hits: n });
  if (x(text)) {}
  function x() { return false; }
  // 采集 "Instruction" 上下文
  let idx = -1, c = 0;
  while ((idx = text.indexOf(':`Instruction`', idx + 1)) !== -1 && c < 3) {
    instrCtx.push({ file: e.path, ctx: text.slice(Math.max(0, idx - 160), idx + 40) });
    c++;
  }
  let idx2 = -1, c2 = 0;
  while ((idx2 = text.indexOf(':"Instruction"', idx2 + 1)) !== -1 && c2 < 3) {
    instrCtx.push({ file: e.path, ctx: text.slice(Math.max(0, idx2 - 160), idx2 + 40) });
    c2++;
  }
}
fs.closeSync(fd);
rows.sort((a, b) => b.hits - a.hits);
console.log('files with UI hits:', rows.length);
for (const r of rows) console.log(`  ${String(r.hits).padStart(5)}  ${(r.size / 1024).toFixed(0).padStart(7)}KB  ${r.path}`);
console.log('\nInstruction context samples:');
for (const c of instrCtx.slice(0, 6)) console.log(`--- ${c.file}\n${c.ctx}\n`);
