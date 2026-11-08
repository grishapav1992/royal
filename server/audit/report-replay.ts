import type { ClientConfig } from 'pg';
import { writeAuditJson } from './export-json';
import { AuditPlayerReportError, openAuditReportReader, runAuditReport, type ReplayReportFilters } from './report-player';
import { isReplayId, verifyReplayPackage } from './replay-package';
import { chessTurnReplayDefinition, verifyChessTurnReplay } from './replay-pvp-turn';
import { combatReplayDefinition, reconstructCombatReplay } from './replay-pvp-realtime-engine';
import { isCardTurnReplayGame, verifyCardTurnReplay } from './replay-pvp-cards';
import { reconstructSportReplay, sportReplayDefinitions } from './replay-pvp-sport-engine';
import { tsuTurnReplayDefinition, verifyTsuTurnReplay } from './replay-pvp-tsu';

export type { ReplayReportFilters } from './report-player';
const maxFileBytes = 12 * 1024 * 1024;
const timeoutMs = 30_000;

export function isReplayEntity(gameId: string, entityKind: string, entityId: string) {
  return typeof gameId === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(gameId) &&
    (entityKind === 'match' ? isReplayId(entityId)
      : entityKind === 'round' && (isReplayId(entityId) || /^ft1-[0-9]{1,16}$/.test(entityId)));
}

function verificationFailure(status: 'corrupt' | 'unsupported' | 'too-large' | 'incomplete', jobId: string): never {
  const code = {
    corrupt: 'replay-corrupt', unsupported: 'replay-unsupported', 'too-large': 'byte-limit', incomplete: 'replay-incomplete',
  } as const;
  throw new AuditPlayerReportError(code[status], jobId);
}

function verifyReplayCandidate(input: unknown, datasetId: string, filters: ReplayReportFilters, jobId: string) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return verificationFailure('corrupt', jobId);
  const row = input as { status?: unknown; manifest?: unknown; fragments?: unknown };
  if (row.status === 'absent') throw new AuditPlayerReportError('replay-absent', jobId);
  if (row.status === 'capture-gap') throw new AuditPlayerReportError('replay-not-recorded', jobId);
  if (row.status === 'ambiguous') throw new AuditPlayerReportError('replay-ambiguous', jobId);
  if (row.status !== 'candidate') return verificationFailure('corrupt', jobId);
  const structural = verifyReplayPackage({ manifest: row.manifest, fragments: row.fragments });
  if (structural.status !== 'verified') return verificationFailure(structural.status, jobId);
  const pack = structural.value, { manifest, fragments } = pack;
  const { game } = manifest;
  const matches = 'replayId' in filters ? manifest.replayId === filters.replayId
    : manifest.entityId === filters.entityId && game.gameId === filters.gameId &&
      (filters.entityKind === 'match' ? game.category === 'pvp' : game.category !== 'pvp');
  if (manifest.scope.datasetId !== datasetId || !matches) return verificationFailure('corrupt', jobId);
  const chess = game.gameId === chessTurnReplayDefinition.gameId;
  const combat = game.gameId === combatReplayDefinition.gameId;
  const events = fragments.flatMap(fragment => fragment.events);
  let engineVerified = false;
  if (chess || combat) {
    const pinned = verifyReplayPackage(pack, [chess ? chessTurnReplayDefinition : combatReplayDefinition]);
    if (pinned.status !== 'verified') return verificationFailure(pinned.status, jobId);
    const canSimulate = !!manifest.initial && events.every((event, index) => event.sequence === index + 1);
    if (canSimulate || chess && !manifest.initial) {
      const simulated = chess ? verifyChessTurnReplay(pack) : reconstructCombatReplay(pack);
      if (simulated.status !== 'verified') {
        return verificationFailure(simulated.status === 'unknown-tick' ? 'corrupt' : simulated.status, jobId);
      }
      engineVerified = canSimulate;
    }
  } else if (game.replayProfile === 'pvp-sport' || sportReplayDefinitions.some(definition => definition.gameId === game.gameId)) {
    const result = reconstructSportReplay(pack);
    if (result.status !== 'verified') return verificationFailure(result.status, jobId);
    engineVerified = !!manifest.initial && !!manifest.terminal && !manifest.gaps.includes('event-gap');
  } else if (game.gameId === tsuTurnReplayDefinition.gameId) {
    const result = verifyTsuTurnReplay(pack);
    if (result.status !== 'verified') return verificationFailure(result.status, jobId);
    engineVerified = result.engineVerified;
  } else if (isCardTurnReplayGame(game.gameId)) {
    const result = verifyCardTurnReplay(pack);
    if (result.status !== 'verified') return verificationFailure(result.status, jobId);
  }
  return { pack, engineVerified, rowCount: events.length };
}

/** Export the exact offline-viewer payload, including its authenticated test/live dataset marker. */
export async function exportAuditReplay(config: ClientConfig, input: {
  schema: string; datasetId: string; filters: ReplayReportFilters; destination: string;
  signal?: AbortSignal; fixtureStandbyPort?: number;
}) {
  const { filters } = input;
  if (!isReplayId(input.datasetId) || !('replayId' in filters ? isReplayId(filters.replayId)
    : isReplayEntity(filters.gameId, filters.entityKind, filters.entityId))) throw new Error('Invalid audit replay identity');
  return runAuditReport(config, input, 'replay', timeoutMs, async (settings, schema, jobId, signal, publish) => {
    const { query, finish } = await openAuditReportReader(settings, jobId, signal);
    let candidate: unknown;
    try {
      signal.throwIfAborted();
      const result = await query<{ replay: unknown }>(`SELECT ${schema}.audit_report_replay($1) AS replay`, [jobId]);
      candidate = result.rows[0]?.replay;
      await query('COMMIT');
    } finally {
      await finish();
    }
    signal.throwIfAborted();
    const { pack, engineVerified, rowCount } = verifyReplayCandidate(candidate, input.datasetId, filters, jobId);
    const { manifest } = pack;
    const written = await writeAuditJson({ destination: input.destination, value: pack, maxBytes: maxFileBytes, signal, publish });
    return { ...written, rowCount, replayId: manifest.replayId, datasetId: manifest.scope.datasetId,
      environment: manifest.scope.environment, coverage: manifest.coverage, engineVerified };
  });
}
