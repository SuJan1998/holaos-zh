// 生成待翻译清单：anchors.json（属性位，必翻）+ bare-extra.json（非属性位，严格过滤）
import fs from 'node:fs';
import path from 'node:path';

const ROOT = String.raw`E:\holaos-zh-build\app\out`;
const OUTDIR = path.join(import.meta.dirname, '..', '_probe');

const files = [
  path.join(ROOT, 'dist', 'assets', 'index-r09AJlLv.js'),
  path.join(ROOT, 'dist-electron', 'main.cjs'),
  path.join(ROOT, 'dist-electron', 'preload.cjs'),
  path.join(ROOT, 'dist-electron', 'appSurfacePreload.cjs'),
  path.join(ROOT, 'dist', 'index.html'),
];

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
const RE_ANCHOR = new RegExp(`((?:^|[{,(\\s])(?:${KEY_ALT})\\s*:\\s*)(?:\`([^\`\\n\\\\$]{1,400})\`|"([^"\\n\\\\$]{1,400})"|'([^'\\n\\\\$]{1,400})')`, 'g');
const RE_BT = /`([^`\\\n]{2,300})`/g;

// ---- tailwind / CSS token 识别 ----
const TW = /^(?:[-a-z0-9[\]/.:#%()_]+)$/;
const TW_PREFIX = /^(?:flex|grid|block|inline-?|hidden|absolute|relative|fixed|sticky|static|items-|justify-|self-|place-|content-|gap-|space-|divide-|size-|w-|h-|min-|max-|p[xytblr]?-|m[xytblr]?-|text-(?:xs|sm|base|lg|xl|[2-9]xl|left|center|right|justify|balance|pretty|wrap|nowrap|ellipsis|clip|muted|foreground|primary|secondary|destructive|accent|[a-z]+-\d)|font-|leading-|tracking-|rounded|border|bg-|shadow|opacity-|overflow-|truncate|whitespace-|antialiased|animate-|transition|duration-|delay-|ease-|origin-|transform|rotate|scale|translate|skew|blur|brightness|contrast|drop-shadow|grayscale|invert|saturate|sepia|backdrop-|mix-blend|ring-|outline-|fill-|stroke-|cursor-|select-|pointer-events|resize|appearance|z-|inset-|top-|left-|right-|bottom-|col-|row-|basis-|grow|shrink|order-|float-|clear-|isolate|aspect-|columns-|break-|list-|align-|table-|caption-|from-|via-|to-|sr-only|not-sr-only|container|uppercase|lowercase|capitalize|normal-case|italic|underline|line-through|no-underline|[a-z-]+:)/;
const isClassy = s => {
  const toks = s.trim().split(/\s+/);
  if (!toks.length) return true;
  let tw = 0;
  for (const t of toks) if (TW_PREFIX.test(t) && TW.test(t)) tw++;
  return tw === toks.length;
};
const CODE_CH = /[{};=<>\\|&]|=>|\|\||&&|!==|===|typeof |function\b|return\b|Error\(|\.map\(|\.filter\(|\.find\(|\.then\(|\.catch\(|Object\.|Array\.|JSON\.|window\.|document\./;
const BAD = [
  /^[a-z0-9\-_/.]+$/,
  /^#(?:[0-9a-fA-F]{3,8})$/,
  /:\/\//,
  /\bpx\b|\brem\b|\bvh\b|\bvw\b|var\(--|cubic-bezier/,
  /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)$/,
  /^[A-Z0-9_]{2,40}$/,
  /^[\d\s.,%+\-]+$/,
  /^\.{0,3}$/,
];
const prose = s => {
  if (!/[A-Za-z]{2}/.test(s)) return false;
  for (const re of BAD) if (re.test(s)) return false;
  if (CODE_CH.test(s)) return false;
  if (isClassy(s)) return false;
  return true;
};

const A = new Map(), B = new Map();
const bump = (m, s, file) => {
  const r = m.get(s) || { count: 0, files: [] };
  r.count++;
  const b = path.basename(file);
  if (!r.files.includes(b)) r.files.push(b);
  m.set(s, r);
};

for (const f of files) {
  if (!fs.existsSync(f)) { console.log('miss', path.basename(f)); continue; }
  const text = fs.readFileSync(f, 'utf8');
  let m;
  RE_ANCHOR.lastIndex = 0;
  while ((m = RE_ANCHOR.exec(text))) {
    const v = m[2] ?? m[3] ?? m[4];
    if (v && prose(v)) bump(A, v, f);
  }
  RE_BT.lastIndex = 0;
  while ((m = RE_BT.exec(text))) {
    const v = m[1];
    if (!v || !prose(v)) continue;
    // 短语：含空格且首词大写，或 2-26 词首大写的标签
    const sentence = /^[A-Z]/.test(v) && /\s/.test(v.trim());
    const label = /^[A-Z][A-Za-z0-9'’&+/-]{1,24}$/.test(v);
    if (sentence || label) bump(B, v, f);
  }
}

const sortObj = m => Object.fromEntries([...m.entries()].sort((a, b) => b[1].count - a[1].count));
fs.writeFileSync(path.join(OUTDIR, 'anchors.json'), JSON.stringify(sortObj(A), null, 1));
const onlyB = new Map([...B].filter(([k]) => !A.has(k)));
fs.writeFileSync(path.join(OUTDIR, 'bare-extra.json'), JSON.stringify(sortObj(onlyB), null, 1));

const L = m => { const b = { s20: 0, s40: 0, s80: 0, s160: 0, big: 0 }; for (const k of m.keys()) { const n = k.length; if (n <= 20) b.s20++; else if (n <= 40) b.s40++; else if (n <= 80) b.s80++; else if (n <= 160) b.s160++; else b.big++; } return b; };
console.log('anchors:', A.size, JSON.stringify(L(A)));
console.log('bare-extra:', onlyB.size, JSON.stringify(L(onlyB)));
console.log('\n--- anchors top 80 ---');
for (const [k, v] of [...A].slice(0, 80)) console.log(`${String(v.count).padStart(4)} [${k.length}] ${k}`);
console.log('\n--- bare-extra top 60 ---');
for (const [k, v] of [...onlyB].slice(0, 60)) console.log(`${String(v.count).padStart(4)} [${k.length}] ${k}`);
