// holaOS zh-CN 构建器
// 用法: node build-zh.mjs [--src app.asar] [--out app.zh.asar] [--dict dir] [--dry] [--stats]
//
// 原理：不重打包整个 asar。只把 out 下的 js/html 中「UI 属性位」上的英文字面量
//      替换成中文，新内容追加到数据区尾部，header 里对应 entry 的 offset/size 重写。
//      134 个 unpacked 条目与 4 个 native .node/.dll 位置完全不动。
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SRC = arg('--src', String.raw`E:\Local\Programs\holaOS\resources\app.asar`);
const OUT = arg('--out', path.join(path.dirname(SRC), 'app.zh.asar'));
const DICTDIR = arg('--dict', path.join(import.meta.dirname, '..', 'dict'));
const DRY = args.includes('--dry');
const STATS = args.includes('--stats');

// UI 属性白名单：只在这些键后面替换，避免破坏枚举值 / 逻辑比较
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
// 捕获：前缀(key:" / key:` / key:' + 前导空格) 值(不含反引号/引号/换行/反斜杠/$) 尾引号
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
      dict.set(en, zh); n++;
    }
    console.log(`dict ${f}: ${n}`);
  }
}
console.log(`dictionary: ${dict.size}`);

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
console.log(`asar ${(fileSize / 1048576).toFixed(1)} MB | header ${headerBufSize} B | data ${(dataLen / 1048576).toFixed(1)} MB`);

const entries = [];
(function walk(n, p) {
  if (n.files) { for (const [k, v] of Object.entries(n.files)) walk(v, p + '/' + k); }
  else entries.push({ node: n, path: p, size: n.size, offset: Number(n.offset), unpacked: !!n.unpacked });
})({ files: header.files }, '');

const targets = entries.filter(e =>
  !e.unpacked &&
  e.path.startsWith('/out/') &&
  /\.(js|cjs|mjs|html)$/.test(e.path)
);
console.log(`scannable: ${targets.length} files`);

// ---------- 替换 ----------
const changed = [];
const appended = [];
let appendedBytes = 0;
const usedKeys = new Set();
const missing = new Set(dict.keys());

const applyDict = (text, entryPath) => {
  let hits = 0;
  const sub = (re) => {
    text = text.replace(re, (m, prefix, val) => {
      const zh = dict.get(val);
      if (zh === undefined) return m;
      hits++;
      usedKeys.add(val);
      missing.delete(val);
      const q = m[m.length - 1];
      return prefix + q + zh + q;
    });
  };
  sub(RE_BT); sub(RE_DQ); sub(RE_SQ);
  return { text, hits };
};

for (const e of targets) {
  const buf = Buffer.alloc(e.size);
  fs.readSync(fd, buf, 0, e.size, dataStart + e.offset);
  const src = buf.toString('utf8');
  if (src.indexOf('latin1') < 0 && !/[A-Za-z]/.test(src)) continue;
  const { text, hits } = applyDict(src, e.path);
  if (!hits) continue;
  const nb = Buffer.from(text, 'utf8');
  if (nb.equals(buf)) continue;
  changed.push({ path: e.path, hits, oldSize: e.size, newSize: nb.length });
  appended.push({ entry: e, buf: nb });
  appendedBytes += nb.length;
}
fs.closeSync(fd);

const totalHits = changed.reduce((a, c) => a + c.hits, 0);
console.log(`---- result ----`);
console.log(`files ${changed.length}, replacements ${totalHits}, appended ${(appendedBytes / 1048576).toFixed(2)} MB`);
for (const c of changed.slice(0, 30)) console.log(`  ${c.path}  ${c.oldSize}->${c.newSize}  x${c.hits}`);
if (changed.length > 30) console.log(`  ... +${changed.length - 30} more`);
if (STATS) {
  console.log(`dict keys used: ${usedKeys.size} / ${dict.size}`);
  if (missing.size) console.log(`unused (${missing.size}): ${[...missing].slice(0, 60).join(' | ')}`);
}

if (DRY) { console.log('dry run'); process.exit(0); }
if (!changed.length) { console.log('no change'); process.exit(0); }

// ---------- header 重写 ----------
let base = dataLen;
for (const a of appended) {
  a.entry.node.offset = String(base);
  a.entry.node.size = a.buf.length;
  base += a.buf.length;
}

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
  const rfd = fs.openSync(SRC, 'r');
  const CHUNK = 8 * 1024 * 1024;
  for (let pos = dataStart; pos < fileSize; pos += CHUNK) {
    const len = Math.min(CHUNK, fileSize - pos);
    const b = Buffer.alloc(len);
    fs.readSync(rfd, b, 0, len, pos);
    await write(b);
  }
  fs.closeSync(rfd);
  for (const a of appended) await write(a.buf);
  await new Promise(res => ws.end(res));
  fs.renameSync(tmp, OUT);
  console.log(`OK -> ${OUT}  ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
})().catch(bail);
