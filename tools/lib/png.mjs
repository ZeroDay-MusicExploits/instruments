// Encoder PNG mínimo, sin dependencias (usa zlib nativo de Node para el deflate del IDAT).
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// pixels: Uint8Array/Buffer RGBA de largo width*height*4.
export function encodePNG(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type RGBA
  ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0;
  const ihdr = chunk('IHDR', ihdrData);

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro "none" por fila
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = deflateSync(raw, { level: 9 });
  const idat = chunk('IDAT', idatData);
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

// Framebuffer helper RGBA simple.
export class Canvas {
  constructor(width, height, bgHex) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
    if (bgHex) this.fillRect(0, 0, width, height, bgHex);
  }
  setPixel(x, y, hex, alpha = 255) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const [r, g, b] = hexToRgb(hex);
    const i = (y * this.width + x) * 4;
    if (alpha >= 255) {
      this.pixels[i] = r; this.pixels[i + 1] = g; this.pixels[i + 2] = b; this.pixels[i + 3] = 255;
    } else {
      const a = alpha / 255;
      const dr = this.pixels[i], dg = this.pixels[i + 1], db = this.pixels[i + 2];
      this.pixels[i] = Math.round(r * a + dr * (1 - a));
      this.pixels[i + 1] = Math.round(g * a + dg * (1 - a));
      this.pixels[i + 2] = Math.round(b * a + db * (1 - a));
      this.pixels[i + 3] = 255;
    }
  }
  fillRect(x0, y0, w, h, hex, alpha = 255) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.setPixel(x, y, hex, alpha);
  }
  toPNG() {
    return encodePNG(this.width, this.height, this.pixels);
  }
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
