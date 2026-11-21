// 在 Electron 里以 ELECTRON_RUN_AS_NODE 运行时，asar fs 包装会把 `*.asar` 路径当容器解析，
// 直接 fs.openSync(app.asar) 会报 ENOENT。这里关掉包装。
if (typeof process !== 'undefined') { try { process.noAsar = true; } catch { } }
// 裸字面量淘词 v2：只扫 index chunk（应用主 bundle），过滤掉 TextMate scope / tailwind / css var 噪声，
// 输出「疑似 UI 文案」列表供人工翻译。
// 用法: node harvest2.mjs [--asar path] [--file out/dist/assets/index-r09AJlLv.js] [--top 1200] [--out file]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ASAR = arg('--asar', String.raw`E:\Local\Programs\holaOS\resources\app.asar.orig`);
const FILE = arg('--file', '/out/dist/assets/index-r09AJlLv.js');
const TOP = Number(arg('--top', 1200));
const OUT = arg('--out', 'E:\\tmp\\bare2.json');
const DICTDIR = path.join(import.meta.dirname, '..', 'dict');

const dict = new Set();
for (const f of fs.readdirSync(DICTDIR).filter(f => f.endsWith('.json'))) {
  const o = JSON.parse(fs.readFileSync(path.join(DICTDIR, f), 'utf8'));
  for (const k of Object.keys(o)) dict.add(k);
}

const fd = fs.openSync(ASAR, 'r');
const head = Buffer.alloc(8); fs.readSync(fd, head, 0, 8, 0);
const hbSize = head.readUInt32LE(4);
const hp = Buffer.alloc(hbSize); fs.readSync(fd, hp, 0, hbSize, 8);
const jsonLen = hp.readUInt32LE(4);
const header = JSON.parse(hp.subarray(8, 8 + jsonLen).toString('utf8'));
const dataStart = 8 + hbSize;
let node = header;
for (const part of FILE.split('/').filter(Boolean)) node = node.files[part];
const buf = Buffer.alloc(node.size);
fs.readSync(fd, buf, 0, node.size, dataStart + Number(node.offset));
fs.closeSync(fd);
const src = buf.toString('utf8');
console.log(`file ${FILE} size ${node.size}`);

const count = new Map();
// 反引号字面量：不含 ${} 插值、不含反斜杠
let re = /\x60([^\x60\n\\]{1,160})\x60/g, m;
while ((m = re.exec(src))) { const v = m[1]; if (!v.includes('${')) count.set(v, (count.get(v) || 0) + 1); }
// 双引号字面量
re = /"([^"\n\\]{1,160})"/g;
while ((m = re.exec(src))) { const v = m[1]; count.set(v, (count.get(v) || 0) + 1); }

const NOISE_RE = [
  /^[a-z][a-zA-Z0-9]*$/,                       // 单小写词/标识符
  /^[A-Z][a-zA-Z0-9]*$/,                       // PascalCase 标识符
  /^[A-Z_]+$/,                                 // 常量
  /^[a-z]+(\.[a-z0-9-]+)+$/i,                  // scope 名
  /\.(js|ts|tsx|jsx|cjs|mjs|json|css|scss|svg|png|jpe?g|webp|gif|md|mdx|html|yml|yaml|toml|lock|wasm|node|dll|exe|zip|pdf)$/i,
  /^(https?|wss?|file|data|mailto):/i,
  /^var\(/,
  /^#(?:[0-9a-f]{3,8})$/i,
  /^\d+(\.\d+)?(px|em|rem|%|s|ms|vh|vw)?$/,
  /^[\x00-\x20]+$/,
];
const TAILWIND = /(?:^|\s)(?:flex|grid|block|inline|hidden|absolute|relative|fixed|sticky|items-|justify-|gap-|p[xy]?-|m[xy]?-|w-|h-|min-|max-|text-(?:xs|sm|base|lg|xl|\d)|font-|leading-|tracking-|rounded|border|bg-|shadow|overflow-|truncate|whitespace-|select-|cursor-|space-[xy]-|ring-|opacity-|transition|duration-|ease-|animate-|z-|top-|left-|right-|bottom-|col-|row-|self-|place-|content-|order-)/;

const out = [];
for (const [s, n] of count) {
  if (dict.has(s)) continue;
  if (!s || s.length > 200) continue;
  if (!/[A-Za-z]/.test(s)) continue;
  if (/[\u4e00-\u9fff]/.test(s)) continue;
  if (NOISE_RE.some(r => r.test(s))) continue;
  if (TAILWIND.test(s) && !/\s[a-z]+\s[a-z]+/.test(s)) continue;
  if (/^[a-z0-9_\-./:]+$/.test(s)) continue;                 // 全小写标识符/路径/mime
  if (/=/.test(s)) continue;                                  // JSX 属性碎片
  if (/[{}<>;|]/.test(s)) continue;                           // 代码片段
  if (/\b(return|throw|typeof|function|const|let|var|undefined|null|Error)\b/.test(s)) continue;
  if (/[a-z][A-Z]/.test(s) && !/\s/.test(s)) continue;        // camelCase
  if (/^[\s,.:;)\]}]|[\s,.:;([{]$/.test(s)) continue;         // 首尾标点碎片
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters / s.length < 0.72) continue;                    // 字母占比太低 = class/id 汤
  // tailwind class 汤：命中任一 class 标记就丢
  if (/(muted-foreground|foreground|border-border|shrink-0|\bflex\b|\bgrid\b|truncate|rounded|font-medium|font-semibold|text-(?:xs|sm|base|lg|xl|\d)|size-\d|px-\d|py-\d|gap-\d|mt-\d|mb-\d|ml-|mr-|min-w-|max-w-|h-full|w-full|inset-|justify-|items-|place-|uppercase|tracking-|transition|hover:|bg-|ring-|opacity-|pointer-events)/.test(s)) continue;
  // 常见非 UI 噪音
  if (/^\[object /.test(s)) continue;
  if (/(Mod-|Ctrl-|Alt-|Meta-|Shift-|Keymap|keymap|\bkeydown\b)/.test(s)) continue;
  if (/(invalid|unknown|must be|cannot|Cannot|expected|unexpected|mismatch|not supported|not included|does not have|is required)/i.test(s) && /(`|_|\$|\{|\}|:)/.test(s)) continue;
  // UI 文案判定：含空格，或以大写字母开头
  if (!(/\s/.test(s) || /^[A-Z]/.test(s))) continue;
  out.push({ s, n });
}
out.sort((a, b) => b.n - a.n || a.s.localeCompare(b.s));
fs.writeFileSync(OUT, JSON.stringify(out.slice(0, TOP), null, 1), 'utf8');
console.log(`unique literals ${count.size}, candidates ${out.length}, wrote top ${Math.min(TOP, out.length)} -> ${OUT}`);
