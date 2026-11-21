import fs from 'node:fs';
const ASAR = 'E:\\Local\\Programs\\holaOS\\resources\\app.asar';
const fd = fs.openSync(ASAR,'r');
const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0);
const hbSize = head.readUInt32LE(4);
const hp = Buffer.alloc(hbSize); fs.readSync(fd, hp, 0, hbSize, 8);
const jsonLen = hp.readUInt32LE(4);
const header = JSON.parse(hp.subarray(8, 8+jsonLen).toString('utf8'));
const dataStart = 8 + hbSize;
function find(node, path){ // path array
  let cur = node;
  for (const p of path){ if(!cur.files || !cur.files[p]) return null; cur = cur.files[p]; }
  return cur;
}
function readEntry(node){
  const b = Buffer.alloc(node.size);
  fs.readSync(fd, b, 0, node.size, dataStart + Number(node.offset));
  fs.closeSync(fd);
  return b;
}
const target = process.argv[2];
const parts = target.split('/');
const ent = find(header, parts);
if (!ent) { console.error('NOT FOUND'); process.exit(1); }
if (ent.files) { console.log('DIR:', Object.keys(ent.files).join(',')); process.exit(0); }
fs.writeFileSync(process.argv[3], readEntry(ent));
console.log('OK', target, ent.size);
