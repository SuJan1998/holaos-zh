// 在 Electron 里以 ELECTRON_RUN_AS_NODE 运行时，asar fs 包装会把 `*.asar` 路径当容器解析，
// 直接 fs.openSync(app.asar) 会报 ENOENT。这里关掉包装。
if (typeof process !== 'undefined') { try { process.noAsar = true; } catch { } }
// 属性位淘词：只取 `children:` / `label:` / `title:` 等 UI 属性后面紧跟的字符串字面量。
// 精度远高于裸字面量扫描（不会混入 TextMate scope、tailwind class、i18n key）。
// 用法: node anchor-harvest.mjs [--asar path] [--top 600] [--out file]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ASAR = arg('--asar', String.raw`E:\Local\Programs\holaOS\resources\app.asar.orig`);
const TOP = Number(arg('--top', 600));
const OUT = arg('--out', 'E:\\tmp\\anchors2.json');
const DICTDIR = path.join(import.meta.dirname, '..', 'dict');

const dict = new Set();
for (const f of fs.readdirSync(DICTDIR).filter(f => f.endsWith('.json'))) {
  const o = JSON.parse(fs.readFileSync(path.join(DICTDIR, f), 'utf8'));
  for (const k of Object.keys(o)) dict.add(k);
}

const KEYS = ['children', 'label', 'title', 'placeholder', 'description', 'tooltip', 'hint', 'alt',
  'emptyText', 'emptyTitle', 'confirmText', 'cancelText', 'submitText', 'actionLabel', 'heading',
  'subheading', 'helpText', 'errorText', 'subtitle', 'detail', 'message', 'text', 'summary',
  'aria-label', 'name', 'caption', 'header', 'footer', 'note', 'notice', 'toast', 'badge',
  'descriptionText', 'labelText', 'buttonLabel', 'emptyState', 'helperText', 'prompt', 'body'];
const KEY_ALT = KEYS.map(k => k.replace(/-/g, '\\-')).join('|');

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

const RE_BT = new RegExp(`((?:^|[{,(\\s])(${KEY_ALT})\\s*:\\s*)\x60([^\x60\\n\\\\$]{1,400})\x60`, 'g');
const RE_DQ = new RegExp(`((?:^|[{,(\\s])(${KEY_ALT})\\s*:\\s*)"([^"\\n\\\\$]{1,400})"`, 'g');

const hits = new Map();
for (const f of files) {
  if (/Univer|DocxEditor|PptxRenderer|zh-CN-/.test(f.path)) continue;
  const src = readEntry(f.node).toString('utf8');
  for (const re of [RE_BT, RE_DQ]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const prop = m[2], val = m[3];
      const key = prop + '\u0000' + val;
      hits.set(key, (hits.get(key) || 0) + 1);
    }
  }
}
fs.closeSync(fd);

const looksEN = (s) => {
  if (!s || s.length > 200) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  if (/[\u4e00-\u9fff]/.test(s)) return false;              // 已经是中文
  if (/[a-z][A-Z]/.test(s) && !/ /.test(s)) return false;    // camelCase
  if (/^(https?:\/\/|mailto:|data:|\.\/|\/)/.test(s)) return false;
  if (/^[a-z0-9_\-./]+$/.test(s) && !/^[a-z]{3,}$/.test(s)) return false; // 小写标识符/路径
  if (/^[a-z]+(-[a-z0-9]+)+$/.test(s)) return false;         // tailwind / kebab
  if (/\b(flex|grid|px-|py-|bg-|text-|rounded|hover:|focus:|absolute|relative|w-full|h-full)\b/.test(s)) return false;
  if (/\.[a-z0-9]+$/.test(s) && !/\.$/.test(s)) return false; // 以扩展名结尾
  return true;
};

const agg = new Map();
for (const [k, n] of hits) {
  const [prop, val] = k.split('\u0000');
  if (dict.has(val)) continue;
  if (!looksEN(val)) continue;
  const prev = agg.get(val);
  if (prev) { prev.n += n; prev.props.add(prop); }
  else agg.set(val, { n, props: new Set([prop]) });
}
const out = [...agg.entries()]
  .map(([s, v]) => ({ s, n: v.n, prop: [...v.props].join('|') }))
  .sort((a, b) => b.n - a.n || a.s.length - b.s.length);
fs.writeFileSync(OUT, JSON.stringify(out.slice(0, TOP), null, 1), 'utf8');
console.log(`files ${files.length}, anchor hits ${hits.size}, candidates ${out.length}, wrote top ${Math.min(TOP, out.length)} -> ${OUT}`);
