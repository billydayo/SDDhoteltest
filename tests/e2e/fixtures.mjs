/**
 * 測試用的圖片檔。
 *
 * 直接在執行時產生，不把二進位檔提交進版本控制——照片管理的測試需要
 * 「內容彼此不同」的圖片（才驗得出排序與封面），而那用幾行 PNG 編碼就能生出來。
 * 產物寫在 tests/.tmp/，已列入 .gitignore。
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.tmp');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 單色 PNG。顏色不同 → 壓縮後的位元組不同 → 可以分辨是哪一張。 */
function png(size, [r, g, b]) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;                       // filter type 0
    for (let x = 0; x < size; x += 1) {
      const o = y * stride + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;                                 // bit depth
  ihdr[9] = 2;                                 // colour type: truecolour

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const HUES = [
  [220, 60, 60], [60, 160, 90], [70, 110, 200], [230, 180, 60],
  [160, 80, 190], [90, 190, 190], [200, 120, 70], [120, 120, 120],
  [40, 40, 40], [250, 250, 250]
];

/**
 * 產生 n 張互不相同的 PNG 與一個非圖片檔。
 * @returns {{ images: string[], notAnImage: string }} 絕對路徑
 */
export function makeFixtures(n = 10) {
  fs.mkdirSync(TMP, { recursive: true });

  const images = Array.from({ length: n }, (_, i) => {
    const file = path.join(TMP, `photo-${i + 1}.png`);
    fs.writeFileSync(file, png(64, HUES[i % HUES.length]));
    return file;
  });

  const notAnImage = path.join(TMP, 'not-an-image.txt');
  fs.writeFileSync(notAnImage, '這不是圖片，上傳應該被擋下。');

  return { images, notAnImage };
}
