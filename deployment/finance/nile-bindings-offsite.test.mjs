import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureNileBindingsCopy } from './nile-bindings-offsite.mjs';
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const config = { addresses: [{ userId: 'alice', address: '41' + 'a'.repeat(40) }, { userId: 'bob', address: '41' + 'b'.repeat(40) }] };
const blank = () => ({ version: 1, network: 'nile', asset: 'USDT_NILE_TEST', configSha256: sha(config), bindings: [] });
const envelope = manifest => ({ ok: true, network: 'nile', asset: 'USDT_NILE_TEST', testOnly: true, spendable: false, manifest, sha256: sha(manifest) });
const binding = index => ({ accountId: randomUUID(), userId: config.addresses[index].userId, address: config.addresses[index].address, boundAt: Date.now() });
test('encrypted binding restoration and repeat verification preserve existing owners', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bindings-test-')), key = randomBytes(32);
  try {
    const empty = blank(); await ensureNileBindingsCopy(envelope(empty), directory, key, config);
    const first = { ...empty, bindings: [binding(0)] };
    const copied = await ensureNileBindingsCopy(envelope(first), directory, key, config);
    const bytes = await readFile(join(directory, copied.file + '.aes256gcm'));
    assert.equal((await ensureNileBindingsCopy(envelope(first), directory, key, config)).encrypted_verified, true);
    assert.deepEqual(await readFile(join(directory, copied.file + '.aes256gcm')), bytes);
    await ensureNileBindingsCopy(envelope({ ...first, bindings: [...first.bindings, binding(1)] }), directory, key, config);
    await assert.rejects(ensureNileBindingsCopy(envelope(first), directory, key, config), /removed_or_reassigned/);
    await assert.rejects(ensureNileBindingsCopy(envelope({ ...first, bindings: [{ ...first.bindings[0], accountId: randomUUID() }] }), directory, key, config), /removed_or_reassigned/);
  } finally { await rm(directory, { recursive: true }); }
});
test('invalid config, changed checksum and corrupt encrypted copies cannot replace verified ownership', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bindings-test-')), key = randomBytes(32);
  try {
    const value = { ...blank(), bindings: [binding(0)] }, latest = envelope(value);
    const copy = await ensureNileBindingsCopy(latest, directory, key, config);
    await assert.rejects(ensureNileBindingsCopy({ ...latest, sha256: '0'.repeat(64) }, directory, key, config));
    await assert.rejects(ensureNileBindingsCopy(latest, directory, key, { addresses: [] }));
    await writeFile(join(directory, copy.file + '.aes256gcm'), 'corrupt');
    await assert.rejects(ensureNileBindingsCopy(latest, directory, key, config));
    assert.equal(JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8')).sha256, latest.sha256);
  } finally { await rm(directory, { recursive: true }); }
});
