import fs from 'node:fs';

const EXE = process.argv[2];
const OUT = process.argv[3];
const MIN = Number(process.argv[4] ?? 40);
const buf = fs.readFileSync(EXE);
const parts = [];
let start = -1;
const printable = (b) =>
  (b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x09 || b === 0x0d ||
  b === 0xc3 || (b >= 0x80 && b < 0x100); // rough: allow utf8 continuation

for (let i = 0; i < buf.length; i++) {
  const b = buf[i];
  const ok = (b >= 0x20 && b < 0x7f) || b === 0x09 || b === 0x0a;
  if (ok) {
    if (start < 0) start = i;
  } else {
    if (start >= 0 && i - start >= MIN) parts.push([start, buf.subarray(start, i).toString('latin1')]);
    start = -1;
  }
}
if (start >= 0 && buf.length - start >= MIN) parts.push([start, buf.subarray(start).toString('latin1')]);
fs.writeFileSync(OUT, parts.map(([o, s]) => `@@${o}\t${s}`).join('\n'), 'utf8');
console.log(`scan ${(buf.length / 1048576).toFixed(0)} MB, runs=${parts.length}, bytes=${parts.reduce((a, [, s]) => a + s.length, 0)}`);
