import { ECDH, createHash, timingSafeEqual } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { rejectTron } from './tron-protocol';

const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest();
const checksum = (value: Uint8Array) => sha(sha(value)).subarray(0, 4);
export function nileBase58(address: string): string {
  if (!/^41[a-f0-9]{40}$/.test(address)) rejectTron('invalid_nile_address');
  const bytes = Buffer.from(address, 'hex');
  let number = BigInt('0x' + Buffer.concat([bytes, checksum(bytes)]).toString('hex')), output = '';
  while (number) { output = alphabet[Number(number % 58n)] + output; number /= 58n; }
  return output;
}
export function nileHex(address: string): string {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return rejectTron('invalid_nile_address');
  let number = 0n;
  for (const char of address) number = number * 58n + BigInt(alphabet.indexOf(char));
  const encoded = number.toString(16);
  if (encoded.length !== 50) return rejectTron('invalid_nile_address');
  const bytes = Buffer.from(encoded, 'hex'), payload = bytes.subarray(0, 21);
  if (payload[0] !== 0x41 || !timingSafeEqual(checksum(payload), bytes.subarray(21))) return rejectTron('invalid_nile_address');
  return payload.toString('hex');
}
export function nilePublicKeyAddress(publicKey: string) {
  if (!/^04[a-f0-9]{128}$/.test(publicKey)) return rejectTron('invalid_nile_public_key');
  try { ECDH.convertKey(Buffer.from(publicKey, 'hex'), 'secp256k1'); }
  catch { return rejectTron('invalid_nile_public_key'); }
  return '41' + Buffer.from(keccak_256(Buffer.from(publicKey.slice(2), 'hex'))).subarray(12).toString('hex');
}
