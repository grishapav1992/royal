// Offline test keys only. This CLI is never included in the deposit worker image.
import { createECDH } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { nileBase58, nilePublicKeyAddress } from '../server/finance/nile-address';

function writePrivate(file: string, value: unknown) {
  const handle = openSync(file, 'wx', 0o600);
  try { writeSync(handle, JSON.stringify(value) + '\n'); fsyncSync(handle); }
  finally { closeSync(handle); }
}
try {
  if (process.env.NILE_TEST_MODE !== 'testnet-only' || process.env.NILE_TEST_NETWORK !== 'nile') throw new Error();
  const userId = process.argv[2];
  if (!userId || !/^[a-zA-Z0-9_-]{1,64}$/.test(userId)) throw new Error();
  const directory = join(homedir(), '.local/share/royal-nile-test-keys');
  mkdirSync(directory, { mode: 0o700, recursive: true });
  if (lstatSync(directory).isSymbolicLink() || (lstatSync(directory).mode & 0o077) !== 0) throw new Error();
  const file = join(directory, userId + '.nile.json');
  if (!existsSync(file)) {
    const key = createECDH('secp256k1'); key.generateKeys();
    const publicKey = key.getPublicKey('hex', 'uncompressed'), address = nilePublicKeyAddress(publicKey);
    writePrivate(file, { network: 'nile', testOnly: true, userId, address, publicKey, privateKey: key.getPrivateKey('hex') });
    const handle = openSync(directory, 'r'); try { fsyncSync(handle); } finally { closeSync(handle); }
  }
  const stats = lstatSync(file);
  if (stats.isSymbolicLink() || !stats.isFile() || (stats.mode & 0o077) !== 0 || stats.size > 4096) throw new Error();
  const saved = JSON.parse(readFileSync(file, 'utf8'));
  const key = createECDH('secp256k1'); key.setPrivateKey(Buffer.from(saved.privateKey, 'hex'));
  if (saved.network !== 'nile' || saved.testOnly !== true || saved.userId !== userId
    || key.getPublicKey('hex', 'uncompressed') !== saved.publicKey || nilePublicKeyAddress(saved.publicKey) !== saved.address) throw new Error();
  // Only public information crosses the custody boundary.
  console.log(JSON.stringify({ userId, address: saved.address, base58: nileBase58(saved.address), publicKey: saved.publicKey }));
} catch { console.error(JSON.stringify({ ok: false, code: 'offline_test_key_failed' })); process.exitCode = 1; }
