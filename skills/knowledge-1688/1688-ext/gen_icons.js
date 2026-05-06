/**
 * 生成 1688 插件图标 (橙色主题, 16/48/128)
 */
const fs = require("fs");
const path = require("path");

// PNG header + IHDR + IDAT + IEND (最小PNG)
// 橙色色块 PNG (8x8 像素, 彩色)
function createColoredPNG(size) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);   // width
  ihdrData.writeUInt32BE(size, 4);   // height
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 2;   // color type (RGB)
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdr = makeChunk("IHDR", ihdrData);
  
  // IDAT chunk - simple orange fill with lighter center
  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0); // filter byte
    for (let x = 0; x < size; x++) {
      // Orange gradient: #ff6b00
      const cx = size / 2, cy = size / 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / (size / 2);
      const brightness = Math.max(0, 1 - dist * 0.4);
      const r = Math.round(255 * brightness);
      const g = Math.round(107 * brightness);
      const b = Math.round(0);
      raw.push(r, g, b);
    }
  }
  
  const zlib = require("zlib");
  const compressed = zlib.deflateSync(Buffer.from(raw));
  const idat = makeChunk("IDAT", compressed);
  
  // IEND chunk
  const iend = makeChunk("IEND", Buffer.alloc(0));
  
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeB, data]);
  const crc = crc32(crcData);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

const outDir = path.join(__dirname);
[16, 48, 128].forEach(size => {
  const png = createColoredPNG(size);
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png);
  console.log(`✅ icon${size}.png (${png.length} bytes)`);
});
