import { deflateSync } from "node:zlib";

/**
 * A plain profile picture for demo providers (a person silhouette on a colored
 * circle), drawn here as a PNG so the test site needs no image files.
 */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const PALETTE: [number, number, number][] = [
  [40, 36, 114], [34, 196, 190], [59, 130, 246], [234, 88, 12], [22, 163, 74], [147, 51, 234], [219, 39, 119], [202, 138, 4], [8, 145, 178], [100, 116, 139],
];

export function avatarPng(seed: number, size = 160): Buffer {
  const [r, g, b] = PALETTE[Math.abs(seed) % PALETTE.length];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const inCircle = (x - c) ** 2 + (y - c) ** 2 <= (c - 1) ** 2;
      const head = (x - c) ** 2 + (y - size * 0.4) ** 2 <= (size * 0.17) ** 2;
      const body = (x - c) ** 2 / (size * 0.3) ** 2 + (y - size * 0.95) ** 2 / (size * 0.36) ** 2 <= 1;
      const person = inCircle && (head || body);
      raw[o] = person ? 255 : r;
      raw[o + 1] = person ? 255 : g;
      raw[o + 2] = person ? 255 : b;
      raw[o + 3] = inCircle ? (person ? 235 : 255) : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
