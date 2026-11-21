const fs=require('fs');
const SRC=String.raw`E:\Local\Programs\holaOS\resources\app.asar`;
const UI_KEYS=['children','label','title','placeholder','description','tooltip','hint','alt','aria-label','ariaLabel','emptyText','emptyTitle','confirmText','cancelText','submitText','actionLabel','heading','subheading','helpText','errorText','subtitle','detail'];
const KEY_ALT=UI_KEYS.map(k=>k.replace(/-/g,'\\-')).join('|');
const RE=new RegExp(`((?:^|[{,(\\s])(?:${KEY_ALT})\\s*:\\s*)\`([^\`\\n\\\\$]{1,400})\``,'g');
const fd=fs.openSync(SRC,'r+');
const sz=fs.fstatSync(fd).size;
const h=Buffer.alloc(8); fs.readSync(fd,h,0,8,0);
const hb=h.readUInt32LE(4);
const hp=Buffer.alloc(hb); fs.readSync(fd,hp,0,hb,8);
const jl=hp.readUInt32LE(4);
const header=JSON.parse(hp.subarray(8,8+jl).toString('utf8'));
const dataStart=8+hb;
const entries=[];
(function walk(n,p){ if(n.files){for(const[k,v] of Object.entries(n.files))walk(v,p+'/'+k);} else entries.push({path:p,size:n.size,offset:Number(n.offset),unpacked:!!n.unpacked}); })({files:header.files},'');
const targets=entries.filter(e=>!e.unpacked&&e.path.startsWith('/out/')&&/\.(js|cjs|mjs)$/.test(e.path));
let files=0,hits=0;
for(const e of targets){
  const buf=Buffer.alloc(e.size); fs.readSync(fd,buf,0,e.size,dataStart+e.offset);
  let t=buf.toString('utf8'); let n=0;
  t=t.replace(RE,(m,p,v)=>{ if(v==='\u53d6\u6d88'){n++; return p+'`Cancel`';} return m; });
  if(!n) continue;
  const nb=Buffer.from(t,'utf8');
  if(nb.length!==e.size){ console.log('SIZE DRIFT',e.path); continue; }
  fs.writeSync(fd,nb,0,nb.length,dataStart+e.offset);
  files++; hits+=n; console.log(`  restored ${e.path} x${n}`);
}
fs.closeSync(fd);
console.log(`reverted files=${files} replacements=${hits}`);
