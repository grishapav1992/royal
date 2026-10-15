// Offline custody tool. This file is excluded from the service image.
import { createECDH, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { nileBase58, nilePublicKeyAddress } from '../server/finance/nile-address';

function write(file: string, bytes: string | Buffer) {
  const fd = openSync(file, 'wx', 0o600); try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function privateFile(file: string) {
  const stat = lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 8192) throw new Error();
  return readFileSync(file);
}
try {
  if (process.env.USDT_MAINNET_MODE !== 'pilot-mainnet') throw new Error();
  const directory = join(homedir(), '.local/share/royal-mainnet-wallets'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (lstatSync(directory).isSymbolicLink() || (lstatSync(directory).mode & 0o077) !== 0) throw new Error();
  const backupKeyFile = join(directory, 'backup-key'); if (!existsSync(backupKeyFile)) write(backupKeyFile, randomBytes(32));
  const backupKey = privateFile(backupKeyFile); if (backupKey.length !== 32) throw new Error();
  const wallets = [];
  for (const role of ['player', 'service']) {
    const file = join(directory, role + '.mainnet.json');
    if (!existsSync(file)) {
      const key = createECDH('secp256k1'); key.generateKeys();
      const publicKey = key.getPublicKey('hex', 'uncompressed'), address = nileBase58(nilePublicKeyAddress(publicKey));
      write(file, JSON.stringify({ version: 1, network: 'tron-mainnet', role, address, publicKey, privateKey: key.getPrivateKey('hex') }) + '\n');
    }
    const plain = privateFile(file), row = JSON.parse(plain.toString('utf8')), key = createECDH('secp256k1'); key.setPrivateKey(Buffer.from(row.privateKey, 'hex'));
    if (row.version !== 1 || row.network !== 'tron-mainnet' || row.role !== role || key.getPublicKey('hex', 'uncompressed') !== row.publicKey
      || nileBase58(nilePublicKeyAddress(row.publicKey)) !== row.address) throw new Error();
    const backup = file + '.aes256gcm', magic = Buffer.from('ROYAL-MAINNET-KEY-v1\n');
    if (!existsSync(backup)) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', backupKey, iv); cipher.setAAD(magic);
      write(backup, Buffer.concat([magic, iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]));
    }
    const encrypted = privateFile(backup); if (!encrypted.subarray(0, magic.length).equals(magic)) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', backupKey, encrypted.subarray(magic.length, magic.length + 12)); decipher.setAAD(magic); decipher.setAuthTag(encrypted.subarray(-16));
    if (!Buffer.concat([decipher.update(encrypted.subarray(magic.length + 12, -16)), decipher.final()]).equals(plain)) throw new Error();
    wallets.push({ role, address: row.address, publicKey: row.publicKey });
  }
  if (wallets[0].address === wallets[1].address) throw new Error();
  const manifest = { version: 1, network: 'tron-mainnet', wallets }, publicFile = join(directory, 'wallets.public.json');
  if (!existsSync(publicFile)) write(publicFile, JSON.stringify(manifest) + '\n');
  if (JSON.stringify(JSON.parse(privateFile(publicFile).toString('utf8'))) !== JSON.stringify(manifest)) throw new Error();
  const fd = openSync(directory, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
  console.log(JSON.stringify({ ok: true, network: 'tron-mainnet', wallets, directory, privateKeysExported: false, encryptedBackupsVerified: true }));
} catch { console.error(JSON.stringify({ ok: false, code: 'offline_mainnet_key_failed' })); process.exitCode = 1; }
