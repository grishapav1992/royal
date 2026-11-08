import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authorizationSessionCount, type measureGameAuthorization } from './chat-load-game-authorization';
import { startLocalChatLoadStand, walletEnvironment } from './chat-load-stand';

type OwnedGame = Pick<Awaited<ReturnType<typeof startLocalChatLoadStand>>, 'runId' | 'game'>;
type Phase = 'baseline' | 'chat-on';
type Profile = { durationSeconds: number; authorizationRate: number };
type PhaseReport = {
  format: 1; runId: string; phase: Phase; durationSeconds: number; authorizationRate: number; authorizationSessions: number;
  passed: boolean; measured: { planned: number; dispatched: number; fresh: number; replayed: number; completed: number;
    latency: { p95Ms: number | null } };
  authorization: Awaited<ReturnType<typeof measureGameAuthorization>> | null;
};

async function ownedDirectory(path: string) {
  const target = resolve(path);
  const root = join(await realpath(process.cwd()), 'artifacts', 'work');
  assert(await realpath(target) === target && dirname(target) === root, 'Use an owned directory under artifacts/work');
  return target;
}

async function requireAbsent(path: string) {
  await lstat(path).then(() => { throw new Error('Use a new directory for each wallet authorization comparison'); }, error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
}

function validateProfile({ durationSeconds, authorizationRate }: Profile) {
  assert(Number.isSafeInteger(durationSeconds) && durationSeconds >= 1 && durationSeconds <= 1800
    && Number.isSafeInteger(authorizationRate) && authorizationRate >= 1 && authorizationRate <= 333,
  'Invalid wallet authorization profile');
}

/** Use the same guarded HTTP wallet runner with a game database already provisioned by the local stand. */
export async function runLocalWalletAuthorizationPhase(stand: OwnedGame, directory: string, phase: Phase,
  profile: Profile, signal?: AbortSignal): Promise<PhaseReport> {
  validateProfile(profile);
  assert(phase === 'baseline' || phase === 'chat-on', 'Invalid wallet authorization phase');
  const output = join(await ownedDirectory(directory), `wallet-${phase}.json`);
  await requireAbsent(output);
  signal?.throwIfAborted();
  const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(new URL('./chat-load-wallet-baseline.ts', import.meta.url)),
    '--run-id', stand.runId, '--phase', phase, '--duration-seconds', String(profile.durationSeconds),
    '--authorization-rate', String(profile.authorizationRate), '--output', output],
  { env: walletEnvironment(stand.game), stdio: ['ignore', 'inherit', 'inherit', 'ipc'], windowsHide: true });
  let termination: ReturnType<typeof setTimeout> | undefined;
  const interrupt = () => {
    if (child.connected) child.disconnect();
    termination = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 12_000);
  };
  signal?.addEventListener('abort', interrupt, { once: true });
  try {
    if (signal?.aborted) interrupt();
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    signal?.throwIfAborted();
    assert(code === 0 || code === 1, 'Wallet authorization phase did not exit normally');
    const report = JSON.parse(await readFile(output, 'utf8')) as PhaseReport;
    assert(report.format === 1 && report.runId === stand.runId && report.phase === phase
      && report.durationSeconds === profile.durationSeconds && report.authorizationRate === profile.authorizationRate
      && report.authorizationSessions === authorizationSessionCount && typeof report.passed === 'boolean'
      && report.passed === (code === 0) && (phase !== 'baseline' || report.authorization === null),
    'Wallet authorization report does not match the requested phase');
    return report;
  } finally {
    clearTimeout(termination);
    signal?.removeEventListener('abort', interrupt);
  }
}

export async function runLocalWalletAuthorizationComparison(directory: string, profile: Profile, signal?: AbortSignal) {
  validateProfile(profile);
  const target = await ownedDirectory(directory);
  const reportPath = join(target, 'local-wallet-authorization-comparison.json');
  await Promise.all([reportPath, join(target, 'wallet-baseline.json'), join(target, 'wallet-chat-on.json')].map(requireAbsent));

  // Each phase starts from an empty PostgreSQL. Both receive the same number
  // of synthetic sessions and the same wallet traffic mix.
  const run = async (phase: Phase) => {
    const stand = await startLocalChatLoadStand(target, signal);
    try { return await runLocalWalletAuthorizationPhase(stand, target, phase, profile, signal); }
    finally { await stand.cleanup(); }
  };
  const baseline = await run('baseline');
  const withAuthorization = await run('chat-on');
  signal?.throwIfAborted();
  const a = baseline.measured.latency.p95Ms, b = withAuthorization.measured.latency.p95Ms;
  const comparable = baseline.passed && withAuthorization.passed && withAuthorization.authorization?.passed === true;
  const p95GrowthRatio = comparable && a !== null && a > 0 && b !== null ? (b - a) / a : null;
  const report = {
    qualification: 'preliminary_single_host', targetAccepted: false, cleanupConfirmed: true, profile,
    walletBaseline: { p95Ms: a, completed: baseline.measured.completed, report: 'wallet-baseline.json' },
    walletWithAuthorization: { p95Ms: b, completed: withAuthorization.measured.completed, report: 'wallet-chat-on.json' },
    gameAuthorization: withAuthorization.authorization, comparable, p95GrowthRatio,
    withinWalletP95Budget: p95GrowthRatio === null ? null : p95GrowthRatio <= 0.10,
  };
  assert.equal(await realpath(target), target, 'Wallet authorization artifact directory changed');
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  try {
    const [directory, duration = '30', rate = '333'] = process.argv.slice(2);
    assert(directory && process.argv.length <= 5,
      'Usage: node --import tsx scripts/chat-load-wallet-authorization-ab.ts <owned-artifact-directory> [seconds] [messages-per-second]');
    const report = await runLocalWalletAuthorizationComparison(directory, { durationSeconds: Number(duration), authorizationRate: Number(rate) },
      controller.signal);
    console.log(JSON.stringify(report));
    if (!report.comparable || !report.withinWalletP95Budget) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Wallet authorization comparison failed');
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
