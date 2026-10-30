import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ProgressionClient } from '../src/wallet/ProgressionClient';
import { demoWallet } from '../src/wallet/WalletClient';
import { DEFAULT_PROGRESSION_POLICY, type ProgressionSnapshot, type RewardSpinRequest, type RewardSpinResult } from '../src/shared/progression';

const account = randomUUID(), grant = randomUUID();
const snapshot = (): ProgressionSnapshot => ({ accountId: account, locationId: 'south-park', policyVersion: DEFAULT_PROGRESSION_POLICY.version,
  currency: 'VIRTUAL_USD', xp: '10000', level: 5, levels: structuredClone(DEFAULT_PROGRESSION_POLICY.levels), enabled: true,
  grants: [{ id: grant, level: 5, gameId: 'royal-coins', count: 5, remaining: 5, stakeUnits: '100000', currency: 'VIRTUAL_USD' }] });
const reply = (operation: RewardSpinRequest): RewardSpinResult => ({ ...operation, replayed: false, remaining: 4, payoutUnits: '1200000',
  wallet: { balance: 101.2, entries: [{ id: 1, kind: 'win', amount: 1.2, balance: 101.2, operationId: 'reward:' + operation.id, createdAt: 1 }] },
  gameRound: { gameId: 'royal-coins', rulesVersion: 1, stakeUnits: '10', payoutUnits: '120', multiplier: 12, input: {}, outcome: { symbols: [0, 0, 0] } } });

async function fixture(run: (client: ProgressionClient, storage: Map<string, string>) => Promise<void>) {
  const savedFetch = globalThis.fetch, savedStorage = globalThis.sessionStorage;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  } });
  globalThis.fetch = (async () => Response.json(snapshot())) as typeof fetch;
  demoWallet.accountId = account; demoWallet.wallet = { balance: 100, entries: [] }; demoWallet.busy = false; demoWallet.pending = undefined;
  const client = new ProgressionClient(); client.accountId = account; client.snapshot = snapshot();
  try { await run(client, storage); }
  finally {
    client.setAccount(null); demoWallet.accountId = null; demoWallet.wallet = undefined; demoWallet.pending = undefined; demoWallet.busy = false;
    demoWallet.setExternalBusy('progression', false); demoWallet.setExternalBusy('other-game', false);
    await Promise.resolve(); globalThis.fetch = savedFetch;
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: savedStorage });
  }
}

test('a lost reward reply retains the same account-scoped UUID across reload and retries it once', () => fixture(async (client, storage) => {
  const operations: RewardSpinRequest[] = [];
  globalThis.fetch = (async (_url, init) => {
    if (init?.method !== 'POST') return Response.json(snapshot());
    const operation = JSON.parse(String(init.body)); operations.push(operation);
    assert.equal(new Headers(init.headers).get('X-Royal-Account-Id'), account);
    assert.equal(storage.get('royal-reward-spin:' + account), JSON.stringify(operation));
    if (operations.length === 1) throw Error('Lost committed reply');
    return Response.json({ ...reply(operation), replayed: true });
  }) as typeof fetch;
  await assert.rejects(client.spin(grant)); assert(client.pending); assert(demoWallet.externalBusy);
  const reloaded = new ProgressionClient(); reloaded.setAccount(account); assert.deepEqual(reloaded.pending, client.pending);
  const result = await reloaded.retry(); assert(result?.replayed); assert.deepEqual(operations[1], operations[0]);
  assert.equal(reloaded.pending, undefined); assert.equal(storage.has('royal-reward-spin:' + account), false);
  assert.equal(demoWallet.wallet?.balance, 101.2); reloaded.setAccount(null);
}));

test('an old account reply never installs a wallet or clears the old account recovery request', () => fixture(async (client, storage) => {
  let release!: (value: Response) => void, operation!: RewardSpinRequest;
  globalThis.fetch = (async (_url, init) => {
    if (init?.method !== 'POST') return Response.json(snapshot());
    operation = JSON.parse(String(init.body)); return new Promise<Response>(resolve => { release = resolve; });
  }) as typeof fetch;
  const submitting = client.spin(grant); client.setAccount(null); release(Response.json(reply(operation)));
  await assert.rejects(submitting); assert.equal(client.last, undefined); assert.equal(client.pending, undefined);
  assert.equal(demoWallet.wallet?.balance, 100); assert(storage.has('royal-reward-spin:' + account));
}));

test('mismatched receipts and HTTP uncertainty preserve the pending operation and common wallet lock', () => fixture(async client => {
  for (const variant of ['wrong-id', 'wrong-grant', 'wrong-game', 'wrong-nominal', 'bad-payout', '401', '429', '503']) {
    globalThis.fetch = (async (_url, init) => {
      if (init?.method !== 'POST') return Response.json(snapshot());
      const operation = JSON.parse(String(init.body)), result = reply(operation);
      if (/^\d+$/.test(variant)) return Response.json({ error: 'Unknown' }, { status: Number(variant) });
      if (variant === 'wrong-id') result.id = randomUUID();
      if (variant === 'wrong-grant') result.grantId = randomUUID();
      if (variant === 'wrong-game') result.gameRound = { gameId: 'royal-fruits', rulesVersion: 1, stakeUnits: '10', payoutUnits: '50', multiplier: 5, input: {}, outcome: { symbols: [0, 0, 0] } }, result.payoutUnits = '500000';
      if (variant === 'wrong-nominal') result.gameRound.stakeUnits = '20', result.gameRound.payoutUnits = '240', result.payoutUnits = '2400000';
      if (variant === 'bad-payout') result.payoutUnits = '1';
      return Response.json(result);
    }) as typeof fetch;
    await assert.rejects(client.pending ? client.retry() : client.spin(grant));
    assert(client.pending, variant); assert(demoWallet.externalBusy, variant); assert.equal(demoWallet.wallet?.balance, 100);
  }
}));

test('a definitive rejection unlocks the wallet while an unmarked conflict remains recoverable', () => fixture(async client => {
  globalThis.fetch = (async (_url, init) => init?.method === 'POST'
    ? Response.json({ error: 'В пакете не осталось бесплатных спинов.' }, { status: 409 }) : Response.json(snapshot())) as typeof fetch;
  await assert.rejects(client.spin(grant)); assert(client.pending);
  globalThis.fetch = (async (_url, init) => init?.method === 'POST'
    ? Response.json({ error: 'В пакете не осталось бесплатных спинов.', rejected: true }, { status: 409 }) : Response.json(snapshot())) as typeof fetch;
  await assert.rejects(client.retry()); assert.equal(client.pending, undefined); assert.equal(demoWallet.externalBusy, false);
}));

test('new reward actions cannot overlap a common wallet operation or another game recovery', () => fixture(async client => {
  let posts = 0;
  globalThis.fetch = (async (_url, init) => { if (init?.method === 'POST') posts++; return Response.json(snapshot()); }) as typeof fetch;
  demoWallet.busy = true; await assert.rejects(client.spin(grant)); demoWallet.busy = false;
  demoWallet.setExternalBusy('other-game', true); await assert.rejects(client.spin(grant));
  assert.equal(posts, 0); assert.equal(client.pending, undefined);
}));

test('failure to save recovery data prevents sending a new reward request', () => fixture(async client => {
  let posts = 0;
  globalThis.fetch = (async (_url, init) => { if (init?.method === 'POST') posts++; return Response.json(snapshot()); }) as typeof fetch;
  Reflect.set(globalThis.sessionStorage, 'setItem', () => { throw Error('Storage unavailable'); });
  await assert.rejects(client.spin(grant)); assert.equal(posts, 0); assert.equal(client.pending, undefined);
}));

test('two tabs for the same account keep independent pending UUIDs and cannot remove each other recovery state', () => fixture(async () => {
  const first = new Map<string, string>(), second = new Map<string, string>();
  const tab = (map: Map<string, string>) => ({ getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => map.set(key, value), removeItem: (key: string) => { map.delete(key); } });
  const one = new ProgressionClient(tab(first)), two = new ProgressionClient(tab(second));
  one.accountId = two.accountId = account; one.snapshot = two.snapshot = snapshot();
  let lose = true;
  globalThis.fetch = (async (_url, init) => {
    if (init?.method !== 'POST') return Response.json(snapshot());
    if (lose) throw Error('Lost committed reply');
    return Response.json(reply(JSON.parse(String(init.body))));
  }) as typeof fetch;
  await assert.rejects(one.spin(grant)); await assert.rejects(two.spin(grant));
  assert(one.pending && two.pending); assert.notEqual(one.pending.id, two.pending.id);
  const firstId = one.pending.id, secondId = two.pending.id; lose = false;
  await one.retry(); assert.equal(first.size, 0); assert.equal(JSON.parse(second.get('royal-reward-spin:' + account)!).id, secondId);
  assert.notEqual(firstId, secondId); await two.retry(); assert.equal(second.size, 0);
  one.setAccount(null); two.setAccount(null);
}));
