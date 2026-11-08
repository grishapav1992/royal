import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { ChatV2WorkloadLedger, ChatV2WorkloadPlan } from '../scripts/load-chat-v2-workload';
import { chatV2Pilot } from '../scripts/load-websocket-cluster';
import { DEFAULT_GAME_PROCESSES, MAX_GAME_PROCESSES, MAX_STAND_CLIENTS, MAX_STAND_PREPARATION_MS,
  standDatabaseConnectionLimit, standGameProcessIds, standLoadProfile, standPreparationTimeoutMs, standStartupTimeoutMs } from '../scripts/load-stand-limits';

test('default load profile preserves four processes and the original admission capacity', () => {
  assert.equal(DEFAULT_GAME_PROCESSES, 4);
  assert.deepEqual(standLoadProfile(1000), { clients: 1000, gameProcesses: 4,
    owners: ['main', 'worker-1', 'worker-2', 'worker-3'], maxSeats: 1200, maxRooms: 40 });
  assert.throws(() => standLoadProfile(1201), RangeError);
});

test('expanded profiles preserve room limits and require enough explicitly requested processes', () => {
  assert.equal(MAX_STAND_CLIENTS, 6000); assert.equal(MAX_GAME_PROCESSES, 24);
  const profile = standLoadProfile(6000, 20);
  assert.equal(profile.maxSeats, 6000); assert.equal(profile.maxRooms, 200);
  assert.equal(profile.owners.length, 20); assert.equal(profile.owners[19], 'worker-19');
  assert.equal(standLoadProfile(6000, 24).maxSeats, 7200);
  assert.equal(standLoadProfile(300, 1).maxSeats, 300);
  for (const [clients, processes] of [[6000, 19], [6001, 24], [3, 4], [1000, 3], [1000, 25], [1000, 0], [1000, 4.5], [NaN, 4]]) {
    assert.throws(() => standLoadProfile(clients, processes), RangeError);
  }
  for (const count of [0, -1, 25, .5, NaN, Infinity]) assert.throws(() => standGameProcessIds(count), RangeError);
});

test('preparation and process readiness have bounded budgets while default timings remain unchanged', () => {
  assert.equal(standPreparationTimeoutMs(1200), 5 * 60000);
  assert.equal(standPreparationTimeoutMs(6000), MAX_STAND_PREPARATION_MS);
  assert.equal(MAX_STAND_PREPARATION_MS, 15 * 60000);
  assert.equal(standStartupTimeoutMs(), 30000); assert.equal(standStartupTimeoutMs(24), 120000);
  assert.throws(() => standPreparationTimeoutMs(6001), RangeError);
  assert.throws(() => standStartupTimeoutMs(25), RangeError);
});

test('temporary database connection budget covers every game pool, orchestrator and reserve', () => {
  assert.equal(standDatabaseConnectionLimit(), 100);
  assert.equal(standDatabaseConnectionLimit(20), 154);
  assert.equal(standDatabaseConnectionLimit(24), 178);
  assert.throws(() => standDatabaseConnectionLimit(25), RangeError);
});

async function cliFailure(args: string[]): Promise<string> {
  return new Promise((done, reject) => {
    execFile(process.execPath, ['--import', 'tsx', resolve('scripts/load-websocket-cluster.ts'),
      '--proxy-binary', '/unused-test-proxy', ...args], {
      timeout: 20000, maxBuffer: 65536,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', PGHOST: '', PGDATABASE: '', PGPORT: '', PGPASSWORD: '' },
    }, (error, stdout, stderr) => {
      if (!error || typeof error.code !== 'number' || error.code !== 1 || error.killed) { reject(error ?? new Error('CLI unexpectedly started')); return; }
      try { done(JSON.parse((stderr || stdout).trim()).code); } catch (failure) { reject(failure); }
    });
  });
}

test('CLI rejects oversized profiles before temporary database, sockets or bundle access', async () => {
  assert.equal(await cliFailure(['--clients', '6000']), 'stand-profile-capacity-exceeded');
  assert.equal(await cliFailure(['--clients', '6000', '--game-processes', '19']), 'stand-profile-capacity-exceeded');
  assert.equal(await cliFailure(['--clients', '6001', '--game-processes', '24']), 'invalid-cli-number');
  assert.equal(await cliFailure(['--clients', '6000', '--game-processes', '25']), 'invalid-cli-number');
  assert.equal(await cliFailure(['--clients', '6000', '--game-processes', '20']), 'use-temporary-postgresql-wrapper');
  assert.equal(await cliFailure([]), 'use-temporary-postgresql-wrapper');
});

test('Chat V2 CLI requires an isolated manifest and a bounded, explicit workload', async () => {
  const stand = ['--stand-manifest', '/unused-test-manifest', '--clients', '20', '--seconds', '2'];
  assert.equal(await cliFailure(['--chat-v2-rate', '1']), 'chat-v2-needs-stand');
  assert.equal(await cliFailure(['--chat-v2-moving-clients', '0']), 'chat-v2-needs-stand');
  assert.equal(await cliFailure([...stand, '--chat-v2-burst', '20']), 'chat-v2-burst-needs-count-and-time');
  assert.equal(await cliFailure([...stand, '--chat-v2-burst-at-second', '0']), 'chat-v2-burst-needs-count-and-time');
  assert.equal(await cliFailure([...stand, '--chat-v2-rate', '334']), 'invalid-cli-number');
  assert.equal(await cliFailure([...stand, '--chat-v2-rate', '0']), 'invalid-stand-chat-profile');
  assert.equal(await cliFailure([...stand, '--chat-v2-burst', '21', '--chat-v2-burst-at-second', '1']), 'invalid-cli-number');
  assert.equal(await cliFailure([...stand, '--chat-v2-burst', '20', '--chat-v2-burst-at-second', '2']), 'invalid-cli-number');
  assert.equal(await cliFailure([...stand, '--chat-v2-burst', '20', '--chat-v2-burst-at-second', '1']), 'use-temporary-postgresql-wrapper');
  assert.equal(await cliFailure([...stand, '--chat-v2-rate', '333']), 'use-temporary-postgresql-wrapper');
  assert.equal(await cliFailure([...stand, '--chat-v2-rate', '333', '--chat-v2-moving-clients', '0']), 'use-temporary-postgresql-wrapper');
  assert.equal(await cliFailure([...stand, '--chat-v2-rate', '333', '--chat-v2-moving-clients', '21']), 'invalid-cli-number');
});

test('Chat V2 pilot verdict requires the planned offer rate and complete self-witnessed delivery', () => {
  const profile = { clients: 4, seconds: 1, steadyPerSecond: 100, burst: { count: 4, atSecond: 0 } };
  const startAtUnixMs = 1_800_000_000_000;
  const blank = new ChatV2WorkloadLedger(new ChatV2WorkloadPlan(profile)).summary();
  const completed = (cohort: typeof blank.steady, n: number) => ({ ...cohort, offered: n, acceptanceConfirmed: n,
    published: n, terminalByDeadline: n, witnessed: n, unresolved: 0 });
  const steady = completed(blank.steady, 99), burst = completed(blank.burst, 4);
  const pilot = (changes: Partial<typeof blank> = {}) => chatV2Pilot([{ chatV2: { startAtUnixMs,
    summary: { ...blank, steady, burst, ...changes } } }], profile, startAtUnixMs);
  assert.deepEqual(pilot().checks, { chatV2OfferedAtTarget: true, chatV2DeliveryComplete: true });
  assert.equal(pilot().targetAccepted, false);
  assert.equal(pilot({ steady: completed(blank.steady, 98) }).checks.chatV2OfferedAtTarget, false);
  assert.equal(pilot({ burst: completed(blank.burst, 3) }).checks.chatV2OfferedAtTarget, false);
  const unequalShards = [49, 50].map((offered, index) => {
    const shard = new ChatV2WorkloadLedger(new ChatV2WorkloadPlan(profile, { index, count: 2 })).summary();
    return { chatV2: { startAtUnixMs, summary: { ...shard, steady: completed(shard.steady, offered), burst: completed(shard.burst, 2) } } };
  });
  assert.equal(chatV2Pilot(unequalShards, profile, startAtUnixMs).checks.chatV2OfferedAtTarget, false);
  for (const delta of [{ witnessed: 3 }, { acceptanceConfirmed: 3 }, { published: 3 }, { terminalByDeadline: 3 }, { unresolved: 1 }]) {
    assert.equal(pilot({ burst: { ...burst, ...delta } }).checks.chatV2DeliveryComplete, false);
  }
  assert.equal(pilot({ unmatchedPublications: 1 }).checks.chatV2DeliveryComplete, false);
  assert.throws(() => chatV2Pilot([{}], profile, startAtUnixMs), /stand-chat-result-epoch-mismatch/);
  assert.throws(() => chatV2Pilot([{ chatV2: { startAtUnixMs: startAtUnixMs - 1, summary: blank } }], profile, startAtUnixMs),
    /stand-chat-result-epoch-mismatch/);
});
