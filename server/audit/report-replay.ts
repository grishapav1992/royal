import type { ClientConfig } from 'pg';
import { writeAuditJson } from './export-json';
import { AuditPlayerReportError, openAuditReportReader, runAuditReport } from './report-player';
import { isReplayId, verifyReplayPackage } from './replay-package';
import { chessTurnReplayDefinition, verifyChessTurnReplay } from './replay-pvp-turn';
import { combatReplayDefinition, reconstructCombatReplay } from './replay-pvp-realtime-engine';

import { isCardTurnReplayGame, verifyCardTurnReplay } from './replay-pvp-cards';
import { reconstructSportReplay } from './replay-pvp-sport-engine';
import { tsuTurnReplayDefinition, verifyTsuTurnReplay } from './replay-pvp-tsu';

export type ReplayReportFilters = { replayId: string };
const maxFileBytes = 12 * 1024 * 1024;
const timeoutMs = 30_000;

function verificationFailure(status: 'corrupt' | 'unsupported' | 'too-large' | 'incomplete', jobId: string): never {
  const code = {
    corrupt: 'replay-corrupt', unsupported: 'replay-unsupported', 'too-large': 'byte-limit', incomplete: 'replay-incomplete',
  } as const;
  throw new AuditPlayerReportError(code[status], jobId);
}

function verifyReplayCandidate(input: unknown, datasetId: string, replayId: string, jobId: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return verificationFailure('corrupt', jobId);
  const row = input as { status?: unknown; manifest?: unknown; fragments?: unknown };
  if (row.status === 'absent') throw new AuditPlayerReportError('replay-absent', jobId);
  if (row.status !== 'candidate') return verificationFailure('corrupt', jobId);
  const structural = verifyReplayPackage({ manifest: row.manifest, fragments: row.fragments });
  if (structural.status !== 'verified') return verificationFailure(structural.status, jobId);
  const pack = structural.value, { manifest, fragments } = pack;
  if (manifest.scope.datasetId !== datasetId || manifest.replayId !== replayId) return verificationFailure('corrupt', jobId);
  const { game } = manifest;
  const chess = game.gameId === chessTurnReplayDefinition.gameId;
  const combat = game.gameId === combatReplayDefinition.gameId;
  const events = fragments.flatMap(fragment => fragment.events);
  let engineVerified = false;
  if (chess || combat) {
    const pinned = verifyReplayPackage(pack, [chess ? chessTurnReplayDefinition : combatReplayDefinition]);
    if (pinned.status !== 'verified') return verificationFailure(pinned.status, jobId);
    if (manifest.initial && events.every((event, index) => event.sequence === index + 1)) {
      const simulated = chess ? verifyChessTurnReplay(pack) : reconstructCombatReplay(pack);
      if (simulated.status !== 'verified') {
        return verificationFailure(simulated.status === 'unknown-tick' ? 'corrupt' : simulated.status, jobId);
      }
      engineVerified = true;
    }
  }
  if (game.replayProfile === 'pvp-sport') {
    const result = reconstructSportReplay(pack);
    if (result.status !== 'verified') return verificationFailure(result.status, jobId);
    engineVerified = !!manifest.initial && !!manifest.terminal && !manifest.gaps.includes('event-gap');
  } else if (game.gameId === tsuTurnReplayDefinition.gameId && game.engineId === tsuTurnReplayDefinition.engineId) {
    const result = verifyTsuTurnReplay(pack);
    if (result.status !== 'verified') return verificationFailure(result.status, jobId);
    engineVerified = result.engineVerified;
  } else if (isCardTurnReplayGame(game.gameId) && game.engineId === 'royal-cards') {
    const result = verifyCardTurnReplay(pack);
    if (result.status !== 'verified') return verificationFailure(result.status, jobId);
  }
  return { pack, engineVerified, rowCount: events.length };
}

/** Export the exact offline-viewer payload, including its authenticated test/live dataset marker. */
export async function exportAuditReplay(config: ClientConfig, input: {
  schema: string; datasetId: string; filters: ReplayReportFilters; destination: string; signal?: AbortSignal;
}) {
  if (!isReplayId(input.datasetId) || !isReplayId(input.filters.replayId)) throw new Error('Invalid audit replay identity');
  return runAuditReport(config, input, 'replay', timeoutMs, async (settings, schema, jobId, signal) => {
    const { connection, finish } = await openAuditReportReader(settings, jobId, signal);
    let candidate: unknown;
    try {
      signal.throwIfAborted();
      const result = await connection.query<{ replay: unknown }>(`SELECT ${schema}.audit_report_replay($1) AS replay`, [jobId]);
      candidate = result.rows[0]?.replay;
      await connection.query('COMMIT');
    } finally {
      await finish();
    }
    signal.throwIfAborted();
    const { pack, engineVerified, rowCount } = verifyReplayCandidate(candidate, input.datasetId, input.filters.replayId, jobId);
    const { manifest } = pack;
    const written = await writeAuditJson({ destination: input.destination, value: pack, maxBytes: maxFileBytes, signal });
    return { ...written, rowCount, replayId: manifest.replayId, datasetId: manifest.scope.datasetId,
      environment: manifest.scope.environment, coverage: manifest.coverage, engineVerified };
  });
}
