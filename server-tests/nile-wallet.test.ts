import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accounts } from '../server/accounts';
import { installNileWallet, selectNileWallet } from '../server/nileWalletRoutes';
import { NILE_WALLET_SCOPE, formatNileUnits } from '../src/shared/nileWallet';

const address = 'TQXj2m3KDSCbLXZHyQs1YFtmnjGQntfWi7';
function view(id: string) { return { version: 1, ...NILE_WALLET_SCOPE, ready: true, generatedAt: Date.now(), ledgerHeight: 100,
  ledgerHash: 'a'.repeat(64), reconciledAt: Date.now(), bindingsSha256: 'b'.repeat(64),
  wallets: [{ accountId: id, address, balanceUnits: '1000000000', deposits: [{ txId: 'c'.repeat(64), logIndex: 0, height: 100, amountUnits: '1000000000' }] }] }; }
test('account selection returns only the owner, with exact decimal formatting', () => {
  const owner = randomUUID(), value = view(owner), wallet = selectNileWallet(value, owner);
  assert.equal(wallet.state, 'assigned'); if (wallet.state === 'assigned') assert.equal(wallet.balanceUnits, '1000000000');
  assert.deepEqual(selectNileWallet(value, randomUUID()), { ...NILE_WALLET_SCOPE, state: 'unassigned' });
  assert.ok(!JSON.stringify(wallet).includes(owner));
  assert.equal(formatNileUnits('1'), '0,000001'); assert.equal(formatNileUnits('1000000000'), '1\u00a0000');
  assert.equal(formatNileUnits('9007199254740993123456'), '9\u00a0007\u00a0199\u00a0254\u00a0740\u00a0993,123456');
});
test('stale and unsafe snapshots, duplicate owners and bad amounts fail closed', () => {
  const id = randomUUID(), valid = view(id);
  for (const change of [{ ready: false }, { spendable: true }, { network: 'mainnet' }, { generatedAt: Date.now() - 120001 },
    { generatedAt: Date.now() + 60000 }, { reconciledAt: Date.now() - 600001 }, { wallets: [...valid.wallets, valid.wallets[0]] },
    { wallets: [{ ...valid.wallets[0], balanceUnits: '-1' }] }, { wallets: [{ ...valid.wallets[0], balanceUnits: '1' }] },
    { wallets: [{ ...valid.wallets[0], deposits: [...valid.wallets[0].deposits, valid.wallets[0].deposits[0]] }] }]) assert.throws(() => selectNileWallet({ ...valid, ...change }, id));
});
test('HTTP authentication, owner isolation, stale files, query injection and all writes are guarded', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'royal-wallet-route-')), file = join(directory, 'wallets.json');
  const owner = await accounts.login(`nile-owner-${randomUUID()}@example.test`, 'test-password!');
  const other = await accounts.login(`nile-other-${randomUUID()}@example.test`, 'test-password!');
  const app = express(); installNileWallet(app, file);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}/api/nile-wallet`;
  const headers = { Cookie: 'royal_session=' + owner.token };
  try {
    await writeFile(file, JSON.stringify(view(owner.account.id)));
    assert.equal((await fetch(endpoint)).status, 401);
    const response = await fetch(endpoint, { headers }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).state, 'assigned');
    const otherWallet = await (await fetch(endpoint, { headers: { Cookie: 'royal_session=' + other.token } })).json();
    assert.equal(otherWallet.state, 'unassigned'); assert.ok(!JSON.stringify(otherWallet).includes(address));
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal((await fetch(endpoint, { method, headers })).status, 405);
    assert.equal((await fetch(endpoint + '?accountId=' + owner.account.id, { headers })).status, 400);
    assert.equal((await fetch(endpoint, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    await writeFile(file, JSON.stringify({ ...view(owner.account.id), generatedAt: 1 })); assert.equal((await fetch(endpoint, { headers })).status, 503);
    await writeFile(file, '{'); assert.equal((await fetch(endpoint, { headers })).status, 503);
    await rm(file); assert.equal((await fetch(endpoint, { headers })).status, 503);
    (await accounts.logout(owner.token)); assert.equal((await fetch(endpoint, { headers })).status, 401);
    assert.equal((await accounts.wallet.snapshot(owner.account.id)).balance, 0);
  } finally { (await accounts.logout(other.token)); await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true }); }
});
