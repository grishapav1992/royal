import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const maximumReport = 16 * 1024 ** 2;
const hex = /^[a-f0-9]{64}$/, uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function refuse(): never { throw new Error('Private generator completion refused'); }
class IncompleteManifest extends Error {}
const delay = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
type Identity = { runId: string; bundleSha256: string; clients: number; seconds: number };
type Options = { args: string[]; completionFile?: string; manifestFile?: string };

export function generatorCompletionOptions(args: string[]): Options {
  const indexes = args.flatMap((value, index) => value === '--generator-completion-file' ? [index] : []);
  if (!indexes.length) return { args: [...args] };
  if (indexes.length !== 1) refuse();
  const index = indexes[0], completionFile = args[index + 1];
  const manifests = args.flatMap((value, index) => value === '--stand-manifest' ? [args[index + 1]] : []);
  if (!completionFile || manifests.length !== 1 || !manifests[0]) refuse();
  const manifestFile = manifests[0];
  if (resolve(completionFile) !== completionFile || resolve(manifestFile) !== manifestFile
    || dirname(completionFile) !== dirname(manifestFile) || basename(completionFile) !== 'generator-completion.json'
    || basename(manifestFile) !== 'stand.json') refuse();
  return { args: args.filter((_, offset) => offset !== index && offset !== index + 1), completionFile, manifestFile };
}

export function generatorCompletionExitCode(child: number, generator: number) {
  if (![child, generator].every(code => Number.isInteger(code) && code >= 0 && code <= 255)) refuse();
  return child === 0 ? generator : child;
}

export async function boundedCompletionRead(maximum: number,
  read: (buffer: Buffer, offset: number, length: number, position: number) => Promise<{ bytesRead: number }>) {
  const buffer = Buffer.alloc(maximum + 1);
  let offset = 0;
  while (offset < buffer.length) {
    const length = Math.min(65536, buffer.length - offset);
    const { bytesRead } = await read(buffer, offset, length, offset);
    if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > length) refuse();
    if (bytesRead === 0) break;
    offset += bytesRead;
    if (offset > maximum) refuse();
  }
  return buffer.subarray(0, offset);
}

async function privateBytes(path: string, maximum: number, incompleteManifest = false) {
  const descriptor = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await descriptor.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid!() || (info.mode & 0o777) !== 0o600
      || info.size > maximum) refuse();
    if (info.size < 1) { if (incompleteManifest) throw new IncompleteManifest(); refuse(); }
    const bytes = await boundedCompletionRead(maximum, (buffer, offset, length, position) => descriptor.read(buffer, offset, length, position));
    const after = await descriptor.stat();
    if (bytes.length !== info.size || after.size !== info.size) { if (incompleteManifest) throw new IncompleteManifest(); refuse(); }
    return bytes;
  } finally { await descriptor.close(); }
}

function identityFrom(bytes: Buffer): Identity {
  const value = JSON.parse(bytes.toString());
  if (value.protocol !== 1 || value.role !== 'isolated-test-stand' || !uuid.test(value.runId)
    || !hex.test(value.bundleSha256) || !Number.isInteger(value.clients) || value.clients < 1 || value.clients > 6000
    || !Number.isInteger(value.seconds) || value.seconds < 1 || value.seconds > 1800) refuse();
  // Keep only public provenance; manifest credentials are never retained in the hold state.
  return { runId: value.runId, bundleSha256: value.bundleSha256, clients: value.clients, seconds: value.seconds };
}

export async function createGeneratorCompletionHold(completionFile: string, manifestFile: string,
  { pollMs = 100, timeoutMs = 30000, manifestPartialTimeoutMs = 10000 }:
  { pollMs?: number; timeoutMs?: number; manifestPartialTimeoutMs?: number } = {}) {
  generatorCompletionOptions(['--stand-manifest', manifestFile, '--generator-completion-file', completionFile]);
  if (!Number.isInteger(pollMs) || pollMs < 1 || pollMs > 1000 || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000
    || !Number.isInteger(manifestPartialTimeoutMs) || manifestPartialTimeoutMs < 1 || manifestPartialTimeoutMs > 10000) refuse();
  const parent = dirname(completionFile), info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!() || (info.mode & 0o777) !== 0o700
    || await realpath(parent) !== parent) refuse();
  for (const path of [completionFile, manifestFile]) {
    try { await lstat(path); refuse(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  let identity: Identity | undefined, failure = false, closed = false, pending: Promise<void> | undefined, partialSince: number | undefined;
  const capture = async () => {
    if (identity || failure || closed || pending) return;
    pending = (async () => {
      try { identity = identityFrom(await privateBytes(manifestFile, 2 * 1024 ** 2, true)); }
      catch (error) {
        if (error instanceof IncompleteManifest || error instanceof SyntaxError) {
          partialSince ??= performance.now();
          if (performance.now() - partialSince >= manifestPartialTimeoutMs) failure = true;
        } else if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failure = true;
      }
    })();
    try { await pending; } finally { pending = undefined; }
  };
  const timer = setInterval(() => { void capture(); }, pollMs);
  const close = async () => { closed = true; clearInterval(timer); await pending; };
  return { close, async wait(interrupted: () => boolean = () => false) {
    await capture(); if (pending) await pending;
    clearInterval(timer);
    if (!identity || failure || interrupted()) refuse();
    const expected = identity, deadline = performance.now() + timeoutMs;
    while (!interrupted() && performance.now() < deadline) {
      try {
        const marker = JSON.parse((await privateBytes(completionFile, 4096)).toString());
        const keys = ['protocol', 'purpose', 'runId', 'bundleSha256', 'generatorExitCode', 'reportSha256', 'reportBytes'];
        if (Object.keys(marker).sort().join(',') !== keys.sort().join(',') || marker.protocol !== 1
          || marker.purpose !== 'isolated-generator-completion' || marker.runId !== expected.runId
          || marker.bundleSha256 !== expected.bundleSha256 || !Number.isInteger(marker.generatorExitCode)
          || marker.generatorExitCode < 0 || marker.generatorExitCode > 255 || !hex.test(marker.reportSha256)
          || !Number.isInteger(marker.reportBytes) || marker.reportBytes < 1 || marker.reportBytes > maximumReport) refuse();
        const bytes = await privateBytes(join(parent, 'generators.json'), maximumReport);
        const { createHash } = await import('node:crypto');
        if (bytes.length !== marker.reportBytes || createHash('sha256').update(bytes).digest('hex') !== marker.reportSha256) refuse();
        const report = JSON.parse(bytes.toString());
        if (report.runId !== expected.runId || report.bundleSha256 !== expected.bundleSha256
          || report.targetClients !== expected.clients || report.seconds !== expected.seconds
          || report.generatorOnly !== true || report.productionTraffic !== false || report.cleanup?.passed !== true
          || !Array.isArray(report.cleanup.failures) || report.cleanup.failures.length
          || marker.generatorExitCode === 0 && report.ok !== true) refuse();
        return { generatorExitCode: marker.generatorExitCode as number };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') refuse();
      }
      await delay(pollMs);
    }
    refuse();
  } };
}
