/**
 * Generates the byte-identical public/ fixtures every app serves under /static.
 *
 * Determinism is the whole point: same bytes in every app, sha256 recorded in
 * contract/fixtures.manifest.json, so a static-serve number compares like with like.
 */
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const HTML_BYTES = 4 * 1024;
const JS_BYTES = 64 * 1024;
const PNG_BYTES = 256 * 1024;

/** pad `base` with `filler` repeated until the buffer is exactly `size` bytes */
function padTo(base: string, filler: string, size: number, tail = ''): Buffer {
  const head = Buffer.from(base, 'utf8');
  const tailBuf = Buffer.from(tail, 'utf8');
  const need = size - head.length - tailBuf.length;
  if (need < 0) throw new Error(`base already exceeds ${size} bytes`);
  const fill = Buffer.from(filler.repeat(Math.ceil(need / filler.length)), 'utf8').subarray(0, need);
  return Buffer.concat([head, fill, tailBuf]);
}

function buildHtml(): Buffer {
  const head =
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<title>Asena Benchmark Fixture</title>\n</head>\n<body>\n<h1>Static fixture</h1>\n<p>\n';
  return padTo(head, 'asena benchmark static fixture payload. ', HTML_BYTES, '\n</p>\n</body>\n</html>\n');
}

function buildJs(): Buffer {
  const head = '// asena benchmark static fixture — 64KB\nexport const FIXTURE = [\n';
  return padTo(head, '  "0123456789abcdef",\n', JS_BYTES, '];\n');
}

// ---- minimal deterministic PNG encoder ----

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function buildPng(): Buffer {
  const W = 256;
  const H = 256;
  // filter byte 0 + RGB triplets; a deterministic gradient, no randomness
  const raw = Buffer.alloc(H * (1 + W * 3));
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    for (let x = 0; x < W; x++) {
      raw[p++] = x & 0xff;
      raw[p++] = y & 0xff;
      raw[p++] = (x ^ y) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  const idat = deflateSync(raw, { level: 9 });

  const base = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
  ]);
  const iend = chunk('IEND', Buffer.alloc(0));

  // pad to exactly PNG_BYTES with a tEXt chunk so the file size is a round number
  const overhead = 4 + 4 + 4 + 'Comment\0'.length; // len + type + crc + keyword
  const padLen = PNG_BYTES - base.length - iend.length - overhead;
  if (padLen < 0) throw new Error(`png already exceeds ${PNG_BYTES} bytes`);
  const text = Buffer.concat([
    Buffer.from('Comment\0', 'ascii'),
    Buffer.from('a'.repeat(padLen), 'ascii'),
  ]);
  return Buffer.concat([base, chunk('tEXt', text), iend]);
}

const FIXTURES: Record<string, Buffer> = {
  'index.html': buildHtml(),
  'app.js': buildJs(),
  'logo.png': buildPng(),
};

async function appDirs(): Promise<string[]> {
  const dirs = [join(ROOT, 'reference')];
  const appsRoot = join(ROOT, 'apps');
  if (existsSync(appsRoot)) {
    for (const e of await readdir(appsRoot, { withFileTypes: true })) {
      if (e.isDirectory()) dirs.push(join(appsRoot, e.name));
    }
  }
  return dirs;
}

const only = process.argv.includes('--app') ? process.argv[process.argv.indexOf('--app') + 1] : null;

const manifest: Record<string, { bytes: number; sha256: string }> = {};
for (const [name, buf] of Object.entries(FIXTURES)) {
  manifest[name] = { bytes: buf.length, sha256: new Bun.CryptoHasher('sha256').update(buf).digest('hex') };
}
await writeFile(join(ROOT, 'contract/fixtures.manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

let written = 0;
for (const dir of await appDirs()) {
  if (only && !dir.endsWith(`/${only}`)) continue;
  const pub = join(dir, 'public');
  await mkdir(pub, { recursive: true });
  for (const [name, buf] of Object.entries(FIXTURES)) {
    await writeFile(join(pub, name), buf);
    written++;
  }
}

console.log(`fixtures: ${written} files written`);
for (const [name, m] of Object.entries(manifest)) {
  console.log(`  ${name.padEnd(12)} ${String(m.bytes).padStart(7)} bytes  ${m.sha256.slice(0, 16)}…`);
}
