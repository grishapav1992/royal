import { constants, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exactFiles = ['Dockerfile.load', '.dockerignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html',
  'scripts/build-load-stand.mjs', 'scripts/crypto-reconcile.ts', 'scripts/database-test.ts', 'scripts/load-stand-database.ts', 'scripts/load-generator-completion.ts', 'scripts/load-account-probe.ts',
  'scripts/load-websocket-cluster.ts', 'scripts/load-server-metrics.ts', 'scripts/temporary-redis.ts',
  'scripts/load-stand-control.ts', 'scripts/load-stand-contract.ts', 'scripts/load-stand-limits.ts',
  'scripts/websocket-server-diagnostics.ts', 'scripts/load-websocket-diagnostics.ts'];
const trees = ['src', 'server', 'public'];
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.css', '.json', '.html', '.svg', '.png', '.jpg', '.jpeg',
  '.webp', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.ogg', '.mp3', '.wav', '.webm', '.go', '.mod', '.sum', '.md', '.txt', '.sql', '.php']);
const prohibited = /^(?:\.env(?:\..*)?|\.git|node_modules|artifacts|backups?|data|runtime|dist(?:-.*)?|secrets?|\.ssh)$/i;
const sha = data => createHash('sha256').update(data).digest('hex');

export async function collectLoadSource(root = project) {
  root = resolve(root); if (await realpath(root) !== root) throw Error('source-root-symlink-refused');
  const selected = [...exactFiles];
  async function walk(tree) {
    const info = await lstat(resolve(root, tree));
    if (!info.isDirectory() || info.isSymbolicLink()) throw Error('source-directory-required');
    for (const name of (await readdir(resolve(root, tree))).sort()) {
      if (name.startsWith('._') || prohibited.test(name)) continue;
      const relative = tree + '/' + name, info = await lstat(resolve(root, relative));
      if (info.isSymbolicLink()) throw Error('source-symlink-refused');
      if (info.isDirectory()) await walk(relative);
      else if (info.isFile() && (extensions.has(extname(name).toLowerCase()) || name === 'LICENSE')) selected.push(relative);
      else if (!info.isFile()) throw Error('source-special-file-refused');
    }
  }
  for (const tree of trees) await walk(tree);
  const files = []; let bytes = 0;
  for (const path of selected.sort()) {
    if (path.length > 255 || path.split('/').some(part => !part || part === '..' || part === '.') || files.length >= 10000) throw Error('source-path-limit');
    const handle = await open(resolve(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > 64 * 1024 ** 2) throw Error('regular-bounded-source-required');
      const data = await handle.readFile(); bytes += data.length;
      if (data.length !== info.size || bytes > 512 * 1024 ** 2) throw Error('source-size-limit');
      files.push({ path, data, sha256: sha(data) });
    } finally { await handle.close(); }
  }
  return files;
}
function header(path, bytes) {
  const buffer = Buffer.alloc(512), slash = path.lastIndexOf('/');
  let name = path, prefix = '';
  if (Buffer.byteLength(path) > 100) { name = path.slice(slash + 1); prefix = path.slice(0, slash); }
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw Error('tar-path-limit');
  buffer.write(name, 0, 100); buffer.write('0000644\0', 100); buffer.write('0000000\0', 108); buffer.write('0000000\0', 116);
  buffer.write(bytes.toString(8).padStart(11, '0') + '\0', 124); buffer.write('00000000000\0', 136);
  buffer.fill(32, 148, 156); buffer.write('0', 156); buffer.write('ustar\0', 257); buffer.write('00', 263); buffer.write(prefix, 345, 155);
  const checksum = buffer.reduce((sum, value) => sum + value, 0); buffer.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return buffer;
}
export async function packLoadSource(output, root = project) {
  output = resolve(output); if (!output.endsWith('.tar.gz')) throw Error('tar-gzip-output-required');
  const files = await collectLoadSource(root);
  async function* archive() {
    for (const file of files) { yield header(file.path, file.data.length); yield file.data;
      if (file.data.length % 512) yield Buffer.alloc(512 - file.data.length % 512); }
    yield Buffer.alloc(1024);
  }
  await mkdir(dirname(output), { recursive: true });
  await pipeline(Readable.from(archive()), createGzip({ level: 6 }), createWriteStream(output, { flags: 'wx', mode: 0o600 }));
  return { files: files.map(({ path, data, sha256 }) => ({ path, bytes: data.length, sha256 })),
    totalSourceBytes: files.reduce((sum, file) => sum + file.data.length, 0), purpose: 'Explicit source-only build context for Dockerfile.load' };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--output') throw Error('usage: node scripts/pack-load-test-source.mjs --output PATH.tar.gz');
    const result = await packLoadSource(process.argv[3]);
    console.log(JSON.stringify({ ok: true, files: result.files.length, totalSourceBytes: result.totalSourceBytes, purpose: result.purpose }));
  } catch { console.error(JSON.stringify({ ok: false, code: 'load-source-pack-failed' })); process.exitCode = 1; }
}
