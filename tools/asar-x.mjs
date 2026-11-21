// 在 Electron 里以 ELECTRON_RUN_AS_NODE 运行时，asar fs 包装会把 `*.asar` 路径当容器解析，
// 直接 fs.openSync(app.asar) 会报 ENOENT。这里关掉包装。
if (typeof process !== 'undefined') { try { process.noAsar = true; } catch { } }
// 通用 asar 单文件提取器: node asar-x.mjs <asar> <entryPath> <outFile>
import fs from 'node:fs';
const [asarPath, entryPath, outFile] = process.argv.slice(2);
const fd = fs.openSync(asarPath, 'r');
const head = Buffer.alloc(16); fs.readSync(fd, head, 0, 16, 0);
const hbSize = head.readUInt32LE(4);
const hp = Buffer.alloc(hbSize); fs.readSync(fd, hp, 0, hbSize, 8);
const jsonLen = hp.readUInt32LE(4);
const header = JSON.parse(hp.subarray(8, 8 + jsonLen).toString('utf8'));
const dataStart = 8 + hbSize;
const parts = entryPath.split('/').filter(Boolean);
let cur = header;
for (const p of parts) {
  if (!cur.files || !cur.files[p]) { console.error('NOT FOUND', entryPath); process.exit(1); }
  cur = cur.files[p];
}
if (cur.files) { console.log('DIR:', Object.keys(cur.files).join(',')); process.exit(0); }
const b = Buffer.alloc(cur.size);
fs.readSync(fd, b, 0, cur.size, dataStart + Number(cur.offset));
fs.closeSync(fd);
fs.writeFileSync(outFile, b);
console.log('OK', entryPath, cur.size);
