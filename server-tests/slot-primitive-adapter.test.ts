import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoyalSlotServices } from '../src/modules/RoyalSlotServices';
import { createCaramelSlotServices } from '../src/modules/SlotPrimitiveCaramelBinding';
import { moveCaramel, startCaramel } from '../server/games/caramelCarnival';
import { createSlotActions, type SlotFeedback } from '../templates/slot-primitive/src/actions';
import type { ReelView } from '../templates/slot-primitive/src/view';
import { expansionClient } from '../src/wallet/ExpansionClient';
import { demoWallet } from '../src/wallet/WalletClient';
import type { GameHostV1 } from '../src/modules/GameHostContract';
import type { ExpansionAction, ExpansionSession } from '../src/shared/casinoExpansion';
import type { NewExpansionAction } from '../src/wallet/ExpansionClient';

const gameId = 'studio-caramel-carnival';
const startSettings = { caramel: { mode: 'normal' as const } };
const bind = (host: GameHostV1, mode: 'normal' | 'festival' = 'normal') => createRoyalSlotServices(host, {
  gameId, ordinaryStart: () => ({ caramel: { mode } }), rulesVersion: 2,
  freeMoves: () => [{ id: 'caramel-spin' }, { id: 'symbol-pick', choices: [{ value: 2, label: 'Two' }, { value: 4, label: 'Four' }] }],
  project: session => ({ revision: session.view.phase, view: { frame: session.view.phase } }),
});

function fakeHost() {
  const calls: NewExpansionAction[] = [];
  const retried: ExpansionAction[] = [];
  const balance = { balance: 30 };
  const client = Object.assign(new EventTarget(), {
    accountId: 'owner', busy: false, loading: false, sessions: [] as ExpansionSession[],
    pending: undefined as ExpansionAction | undefined, wallet: balance as typeof balance | undefined, error: '',
    async act(action: NewExpansionAction) { calls.push(action); },
    async retry() { if (this.pending) retried.push(this.pending); },
    async refresh() { refreshes++; },
  });
  let refreshes = 0;
  let outsideLock = false;
  const wallet = Object.assign(new EventTarget(), {
    accountId: 'owner', busy: false, wallet: balance, hasExternalBusy: (except?: string) => {
      assert.equal(except, 'expansion');
      return outsideLock;
    },
  });
  const host = { manualStakes: 1, expansionClient: client, demoWallet: wallet, walletCoins: (n: number) => `wallet:${n}` } as unknown as GameHostV1;
  return { host, client, wallet, calls, retried, refreshes: () => refreshes, lock: () => { outsideLock = true; } };
}

function session(rulesVersion: 1 | 2, cost: number): ExpansionSession {
  return { id: 'saved-round', gameId, rulesVersion, state: 'active', stakeUnits: '23', spentUnits: '23', returnedUnits: '0',
    view: { phase: 4, ended: false, actions: [{ move: 'caramel-spin', label: 'Free spin', cost }],
      player: [], dealer: [], community: [], message: '' } };
}

test('the adapter uses exact host stakes and never starts over a saved round', async () => {
  const { host, client, calls, lock, refreshes } = fakeHost();
  const slot = bind(host);
  assert.equal(slot.stakes.defaultCents, '10');
  assert.equal(slot.read().balanceLabel, 'wallet:30');
  client.wallet = undefined;
  assert.equal(slot.read().status, 'sync-required');
  await assert.rejects(slot.spin('0.10'));
  await slot.refresh();
  assert.equal(refreshes(), 1);
  client.wallet = { balance: 30 };
  await assert.rejects(slot.spin('0.001'));
  assert.equal(slot.stakes.parse('100.00'), '10000');
  await assert.rejects(slot.spin('100.01'));
  await assert.rejects(bind(host, 'festival').spin('0.10'), /exactly the selected stake/);
  assert.deepEqual(calls, []);
  await slot.spin('0,17');
  assert.deepEqual(calls, [{ gameId, action: 'start', stakeUnits: '17', settings: startSettings }]);

  client.sessions = [session(1, 0)];
  assert.equal(slot.read().status, 'unsupported-round');
  await assert.rejects(slot.spin('0.10'));
  const ref = { id: 'saved-round', revision: 4 };
  client.sessions = [{ ...session(1, 0), state: 'settled' }];
  assert.equal(slot.read().status, 'unsupported-round');
  await assert.rejects(slot.spin('0.10'));
  assert.equal(calls.length, 1);
  client.sessions = [session(2, 1)];
  await assert.rejects(slot.playFree(ref, 'caramel-spin'));
  client.sessions = [session(2, 0)];
  assert.equal(slot.read().round?.stakeCents, '23');
  await assert.rejects(slot.playFree({ ...ref, revision: 3 }, 'caramel-spin'));
  await slot.playFree(ref, 'caramel-spin');
  assert.deepEqual(calls[1], { gameId, action: 'move', sessionId: 'saved-round', revision: 4, move: 'caramel-spin' });
  client.sessions[0].view.actions = [{ move: 'symbol-pick', label: 'Choose', cost: 0, perPick: 1, minPicks: 1, maxPicks: 2 }];
  await assert.rejects(slot.playFree(ref, 'symbol-pick', [2]));
  client.sessions[0].view.actions[0].perPick = 0;
  await assert.rejects(slot.playFree(ref, 'symbol-pick', [2, 2]));
  await assert.rejects(slot.playFree(ref, 'symbol-pick', [1]));
  await slot.playFree(ref, 'symbol-pick', [2, 4]);
  assert.deepEqual(calls[2], { gameId, action: 'move', sessionId: 'saved-round', revision: 4, move: 'symbol-pick', picks: [2, 4] });
  lock();
  await assert.rejects(slot.playFree(ref, 'symbol-pick', [2]));
  assert.equal(calls.length, 3);
});

test('Caribbean prices the whole selection and rejects a paid bonus or line-based stake', async () => {
  const { host, calls } = fakeHost();
  const ordinary = (mode: 'normal' | 'buy-raid', stakeBasis?: 'total') => createRoyalSlotServices(host, {
    gameId: 'studio-caribbean-treasures', rulesVersion: 2,
    ordinaryStart: () => ({ caribbean: { lines: 20, mode, ...(stakeBasis ? { stakeBasis } : {}) } }),
    project: () => undefined,
  });
  await assert.rejects(ordinary('buy-raid', 'total').spin('0.10'), /exactly the selected stake/);
  await assert.rejects(ordinary('normal').spin('0.10'), /do not have a supported price/);
  assert.deepEqual(calls, []);
  await ordinary('normal', 'total').spin('0.10');
  assert.deepEqual(calls, [{ gameId: 'studio-caribbean-treasures', action: 'start', stakeUnits: '10',
    settings: { caribbean: { lines: 20, mode: 'normal', stakeBasis: 'total' } } }]);
});

test('Cosmic and Velvet use their shared prices instead of accepting paid modes as an ordinary spin', async () => {
  const { host, calls } = fakeHost();
  for (const [id, paidMode] of [['studio-cosmic-escape', 'cosmic-chaos'], ['studio-velvet-reign', 'booster']] as const) {
    const ordinary = (mode: string) => createRoyalSlotServices(host, {
      gameId: id, rulesVersion: 2, ordinaryStart: () => ({ luelon: { mode } }), project: () => undefined,
    });
    await assert.rejects(ordinary(paidMode).spin('0.10'), /exactly the selected stake/);
    await ordinary('normal').spin('0.10');
  }
  assert.deepEqual(calls.map(action => action.gameId), ['studio-cosmic-escape', 'studio-velvet-reign']);
});

test('only the current account and game can recover a saved operation, including after remount', async () => {
  const { host, client, wallet, retried, calls } = fakeHost();
  const slot = bind(host);
  const pending = { id: 'pending-id', gameId, action: 'start' as const, stakeUnits: '10', settings: startSettings };
  client.pending = { ...pending, gameId: 'studio-cosmic-escape' };
  assert.equal(slot.read().status, 'blocked');
  await assert.rejects(slot.recover());
  client.pending = pending;
  client.busy = true;
  assert.equal(slot.read().status, 'busy');
  await assert.rejects(slot.recover());
  client.busy = false;
  client.loading = true;
  await assert.rejects(slot.recover());
  client.loading = false;
  const remounted = bind(host);
  assert.equal(remounted.read().status, 'recover');
  await assert.rejects(remounted.spin('0.10'));
  await remounted.recover();
  assert.equal(retried[0], pending);
  assert.equal(calls.length, 0);

  let updates = 0;
  const unsubscribe = remounted.subscribe(() => updates++);
  wallet.accountId = 'different-account';
  wallet.dispatchEvent(new Event('change'));
  assert.deepEqual(remounted.read(), { status: 'signed-out', round: null, freeActions: [], balanceLabel: null, error: null });
  await assert.rejects(remounted.recover());
  unsubscribe();
  client.dispatchEvent(new Event('change'));
  wallet.dispatchEvent(new Event('change'));
  assert.equal(updates, 1);
});

test('the facade announces a Royal bet only for the matching operation and account', async () => {
  const { host, client } = fakeHost();
  const actions = createSlotActions(bind(host));
  const events: string[] = [];
  actions.subscribeFeedback(event => { events.push(event.type); });
  let sequence = 0;
  client.act = async action => {
    const id = String(++sequence);
    client.pending = { ...action, id } as ExpansionAction;
    await Promise.resolve();
    if (id === '3') {
      client.accountId = 'another-owner';
      client.dispatchEvent(new Event('change'));
      client.accountId = 'owner';
    }
    client.sessions = [{ ...session(2, 0), id: id === '2' ? 'unrelated' : id,
      state: 'settled', stakeUnits: '10', spentUnits: '10', returnedUnits: '15' }];
    client.pending = undefined;
  };
  await actions.bet('0.10');
  assert.deepEqual(events, ['bet', 'win']);
  await actions.bet('0.10');
  await actions.bet('0.10');
  assert.deepEqual(events, ['bet', 'win']);
});

test('the Caramel example reuses the real ExpansionClient pending UUID after a lost reply', async t => {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
  t.after(() => {
    demoWallet.accountId = null;
    expansionClient.setAccount(null);
    demoWallet.wallet = undefined;
    if (previous) Object.defineProperty(globalThis, 'sessionStorage', previous);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  expansionClient.accountId = demoWallet.accountId = 'offline-test';
  expansionClient.wallet = demoWallet.wallet = { balance: 30, entries: [] };
  const host = { ...fakeHost().host, expansionClient, demoWallet };
  const requests: ExpansionAction[] = [];
  let confirmed: ExpansionSession | undefined;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, '/api/demo-wallet/expansion');
    assert.equal(init.method, 'POST');
    const op: ExpansionAction = JSON.parse(String(init.body));
    requests.push(op);
    if (op.action === 'move') {
      assert.ok(confirmed?.view.caramel);
      assert.equal(op.sessionId, confirmed.id);
      assert.equal(op.move, 'caramel-spin');
      const result = moveCaramel(confirmed.view.caramel, confirmed.stakeUnits, op.revision, () => 0);
      assert.equal(result.ended, false);
      confirmed = { ...confirmed, view: { ...confirmed.view, caramel: result.view, phase: result.view.revision + 1,
        ended: result.ended, actions: result.actions, message: result.message } };
      return Response.json({ wallet: { balance: 29.90, entries: [] }, sessions: [confirmed], session: confirmed, replayed: false });
    }
    assert.equal(op.action, 'start');
    if (!confirmed) {
      const result = startCaramel(startSettings, op.stakeUnits, () => 0);
      confirmed = { id: op.id, gameId, rulesVersion: 2, state: 'active', stakeUnits: op.stakeUnits,
        spentUnits: op.stakeUnits, returnedUnits: '0', view: { caramel: result.view, phase: result.view.revision + 1,
          player: [], dealer: [], community: [], ended: result.ended, actions: result.actions, message: result.message } };
      throw new TypeError('Lost reply after acceptance');
    }
    return Response.json({ wallet: { balance: 29.90, entries: [] }, sessions: [confirmed], session: confirmed, replayed: true });
  });

  const slot = createCaramelSlotServices(host);
  const actions = createSlotActions(slot);
  const events: SlotFeedback<ReelView>[] = [];
  actions.subscribeFeedback(event => { events.push(event); });
  await assert.rejects(actions.bet('0.10'));
  assert.deepEqual(events, []);
  assert.equal(slot.read().status, 'recover');
  assert.equal(slot.read().round, null);
  assert.equal(JSON.parse(storage.get('royal-expansion:offline-test')!).id, requests[0].id);
  const reopened = createCaramelSlotServices(host);
  const reopenedActions = createSlotActions(reopened);
  reopenedActions.subscribeFeedback(event => { events.push(event); });
  await reopenedActions.recover();
  assert.deepEqual(events, []);
  assert.deepEqual(requests, [requests[0], requests[0]]);
  assert.equal(storage.size, 0);
  const round = reopened.read().round;
  assert.equal(round?.id, requests[0].id);
  assert.equal(round?.spentCents, '10');
  assert.equal(round?.view.symbols.length, 30);
  assert.equal(reopened.read().status, 'continue');
  assert.ok(round);
  await reopenedActions.playFree(round, 'caramel-spin');
  assert.deepEqual(events.map(event => event.type), ['free']);
  assert.equal(events.at(0)?.round.revision, round.revision + 1);
  assert.equal(events.at(0)?.round.spentCents, '10');
  assert.equal(requests.at(-1)?.action, 'move');
  assert.equal(requests.length, 3);
  await assert.rejects(reopenedActions.playFree(round, 'caramel-spin'));
  assert.equal(requests.length, 3);
});
