// Implementación mínima de ZIP (sin dependencias) usada por build-zip.mjs
// y check-zip.mjs. Determinista a propósito: orden fijo de entradas, fecha
// fija (época DOS 1980-01-01 00:00:00) y mismo nivel de compresión siempre,
// así dos corridas sobre el mismo contenido producen bytes idénticos.
import { deflateRawSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const DOS_DATE = 0x0021; // 1980-01-01
const DOS_TIME = 0x0000; // 00:00:00
const VERSION = 20; // 2.0
const FLAG_UTF8 = 0x0800;
const EXTERNAL_ATTR = (0o100644 << 16) >>> 0; // -rw-r--r--, archivo regular

// CRC-32 estándar (tabla precalculada), sin depender de zlib.crc32 (Node 21+)
// para que el script funcione en Node 18 como pide la consigna.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function collectDescargablesEntries(descargablesDir) {
  const files = readdirSync(descargablesDir)
    .filter((name) => name.endsWith('.html'))
    .sort();
  const entries = [{ name: 'descargables/', isDir: true, data: Buffer.alloc(0) }];
  for (const name of files) {
    entries.push({
      name: `descargables/${name}`,
      isDir: false,
      data: readFileSync(join(descargablesDir, name)),
    });
  }
  return entries;
}

export function buildZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const uncompressed = entry.data;
    const method = entry.isDir ? 0 : 8; // stored para directorios, deflate para archivos
    const compressed = entry.isDir ? uncompressed : deflateRawSync(uncompressed, { level: 9 });
    const crc = crc32(uncompressed);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(LOCAL_SIG, 0);
    localHeader.writeUInt16LE(VERSION, 4);
    localHeader.writeUInt16LE(FLAG_UTF8, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(CENTRAL_SIG, 0);
    centralHeader.writeUInt16LE(VERSION, 4); // version made by
    centralHeader.writeUInt16LE(VERSION, 6); // version needed
    centralHeader.writeUInt16LE(FLAG_UTF8, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(EXTERNAL_ATTR, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const localSection = Buffer.concat(localChunks);
  const centralSection = Buffer.concat(centralChunks);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

// Lee el directorio central de un ZIP ya armado -> Map<name, {crc32, size}>.
// Alcanza para comparar contenido (check-zip.mjs); no es un lector de ZIP
// de propósito general.
export function readZipEntries(buf) {
  const eocdOffset = buf.lastIndexOf(
    Buffer.from([0x50, 0x4b, 0x05, 0x06])
  );
  if (eocdOffset === -1) throw new Error('No se encontró el End Of Central Directory: ¿es un ZIP válido?');
  const total = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) throw new Error(`Central directory corrupto en offset ${p}`);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { crc32: crc, size, compSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
