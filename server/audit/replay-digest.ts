import { createHash } from 'node:crypto';

export const replayDigest = (canonicalJson: string) => createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
