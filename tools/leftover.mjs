// 在 Electron 里以 ELECTRON_RUN_AS_NODE 运行时，asar fs 包装会把 `*.asar` 路径当容器解析，
// 直接 fs.openSync(app.asar) 会报 ENOENT。这里关掉包装。
if (typeof process !== 'undefined') { try { process.noAsar = true; } catch { } }
// leftover.mjs <asar> [entry] : 列出补丁后仍为英文的模板字面量（即界面上还没翻的文案）
import fs from 'node:fs';
const ASAR = process.argv[2];
const ENTRY = process.argv[3] || '/out/dist/assets/index-r09AJlLv.js';
const fd=fs.openSync(ASAR,'r');
const h=Buffer.alloc(8); fs.readSync(fd,h,0,8,0); const hb=h.readUInt32LE(4);
const hp=Buffer.alloc(hb); fs.readSync(fd,hp,0,hb,8); const jl=hp.readUInt32LE(4);
const header=JSON.parse(hp.subarray(8,8+jl).toString('utf8'));
const ds=8+hb;
let n=header; for(const s of ENTRY.split('/').filter(Boolean)) n=n.files[s];
const b=Buffer.alloc(n.size); fs.readSync(fd,b,0,n.size,ds+Number(n.offset)); fs.closeSync(fd);
const src=b.toString('utf8');
const NOISE=/^(?:[a-z0-9_$\-]+)$/;
const TAILWIND=/(muted-foreground|foreground|border-border|shrink-0|flex-|grid-|truncate|rounded|font-(medium|bold|semibold)|text-(xs|sm|base|lg|xl|\d)|size-\d|px-\d|py-\d|gap-\d|bg-|hover:|focus:|group|data-\[|aria-)/;
const out=new Map();
const re=/\x60([^\x60\n]{2,300})\x60/g; let m;
while((m=re.exec(src))){
  const v=m[1];
  if(!/[A-Za-z]{2,}/.test(v)) continue;               // 无英文
  if(/[\u4e00-\u9fff]/.test(v)) continue;             // 已含中文
  if(!/\s/.test(v)) continue;                          // 无空格的短标识符基本非文案
  if(/[=<>{};|$\\]/.test(v)) continue;                 // 代码碎片 / 插值
  if(TAILWIND.test(v)) continue;
  if(/\b(return|throw|typeof|function|const|let|var|import|export|undefined|null)\b/.test(v)) continue;
  if(/https?:\/\/|\.(png|svg|json|js|css|ts|tsx)\b/.test(v)) continue;
  const letters=(v.match(/[A-Za-z]/g)||[]).length;
  if(letters/v.length<0.6) continue;
  if(/^[a-z]/.test(v) && v.split(/\s+/).length<3) continue;
  out.set(v,(out.get(v)||0)+1);
}
const arr=[...out.entries()].sort((a,b)=>b[1]-a[1]||a[0].length-b[0].length);
console.log(`total ${arr.length}`);
const lim = Number(process.argv[4] || 400);
for(const [s,c] of arr.slice(0,lim)) console.log(`${c}\t${s}`);
