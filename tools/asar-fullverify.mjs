// 在 Electron 里以 ELECTRON_RUN_AS_NODE 运行时，asar fs 包装会把 `*.asar` 路径当容器解析，
// 直接 fs.openSync(app.asar) 会报 ENOENT。这里关掉包装。
if (typeof process !== 'undefined') { try { process.noAsar = true; } catch { } }
import fs from 'node:fs';
import crypto from 'node:crypto';

const ASAR = process.argv[2] || 'E:\\Local\\Programs\\holaOS\\resources\\app.asar';
const fd = fs.openSync(ASAR, 'r');
const st = fs.fstatSync(fd);
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const hbSize = head.readUInt32LE(4);
const hp = Buffer.alloc(hbSize);
fs.readSync(fd, hp, 0, hbSize, 8);
const jsonLen = hp.readUInt32LE(4);
const header = JSON.parse(hp.subarray(8, 8 + jsonLen).toString('utf8'));
const dataStart = 8 + hbSize;
const dataLen = st.size - dataStart;
console.log(`file ${(st.size / 1048576).toFixed(1)} MB | dataStart ${dataStart} | data ${(dataLen / 1048576).toFixed(1)} MB | jsonLen ${jsonLen}`);

let files = 0, checked = 0, bad = 0, skippedUnpacked = 0, skippedNoInt = 0, rangeBad = 0;
const badList = [];

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function walk(node, path) {
  if (node.files) {
    for (const [k, v] of Object.entries(node.files)) walk(v, path ? `${path}/${k}` : k);
    return;
  }
  files++;
  if (node.unpacked) { skippedUnpacked++; return; }
  if (!node.integrity) { skippedNoInt++; return; }
  const off = Number(node.offset);
  const size = Number(node.size);
  if (off < 0 || off + size > dataLen) { rangeBad++; badList.push(`RANGE ${path} off=${off} size=${size}`); return; }
  const buf = Buffer.alloc(size);
  if (size > 0) fs.readSync(fd, buf, 0, size, dataStart + off);
  const integ = node.integrity;
  // whole-file hash
  if (integ.hash) {
    const h = sha256(buf);
    checked++;
    if (h !== integ.hash) { bad++; if (badList.length < 20) badList.push(`HASH ${path} size=${size} got=${h.slice(0, 16)} want=${integ.hash.slice(0, 16)}`); return; }
  }
  // block hashes
  if (Array.isArray(integ.blocks)) {
    const bs = integ.blockSize || 4194304;
    for (let i = 0; i < integ.blocks.length; i++) {
      const start = i * bs;
      const end = Math.min(start + bs, size);
      const h = sha256(buf.subarray(start, end));
      if (h !== integ.blocks[i]) { bad++; if (badList.length < 20) badList.push(`BLOCK ${path} #${i} got=${h.slice(0, 16)} want=${integ.blocks[i].slice(0, 16)}`); break; }
    }
  }
}

walk(header, '');
fs.closeSync(fd);
console.log(`files=${files} checked=${checked} bad=${bad} rangeBad=${rangeBad} unpacked=${skippedUnpacked} noIntegrity=${skippedNoInt}`);
if (badList.length) { console.log('--- 前 20 条异常 ---'); for (const l of badList) console.log(l); }
