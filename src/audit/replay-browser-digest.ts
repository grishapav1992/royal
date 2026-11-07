import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const utf8 = new TextEncoder();
export const replayDigest = (canonicalJson: string) => bytesToHex(sha256(utf8.encode(canonicalJson)));
