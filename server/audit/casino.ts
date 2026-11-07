import { identifier, type PostgresDatabase } from '../database';
import { verifyGameRound } from '../games/core';
import { validCaramelSettings } from '../../src/shared/caramelCarnival';
import { validCaribbeanTransportSettings } from '../../src/shared/caribbeanTransport';
import { isExpansionGame, validExpansionRulesVersion } from '../../src/shared/casinoExpansion';
import { isSessionGame } from '../../src/shared/casinoSessions';
import { validFlagSettings } from '../../src/shared/flagBattle';
import { isLuelonSlotGame, validLuelonSlotSettings } from '../../src/shared/luelonSlots';
import { validNeopolisSettings } from '../../src/shared/neopolis';
import { isAuditEntityRef, type AuditEntityRef, type AuditSourceRef } from './contract';

export type CasinoPostingKey = {
  rowId: string;
  accountId: string;
  operationId: string;
  gameId: string;
};

export type CasinoPostingResolution = {
  source: AuditSourceRef;
  entity: AuditEntityRef & { category: 'casino' };
  coverage: 'complete' | 'partial';
  operation: AuditSourceRef | null;
  origin: 'command' | 'automatic' | 'unknown';
};

type CasinoDatabase = Pick<PostgresDatabase, 'prepare' | 'schema'>;

type CasinoSourceTable = 'demo_ledger' | 'demo_operations' | 'demo_casino_requests' | 'demo_casino_sessions';

function sourceRef(db: CasinoDatabase, table: CasinoSourceTable, rowId: string): AuditSourceRef {
  return { namespace: db.schema + '.' + table, rowId };
}

function operationKey(accountId: string, id: string): string {
  return JSON.stringify([accountId, id]);
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const normalExpansionModes = new Set([
  'github-crash', 'github-hilo', 'original-cr-vs-leo', 'original-jackie-chan',
  'studio-afterglow', 'studio-dracona', 'studio-flooded-temple', 'studio-forest-heart',
  'studio-last-convoy', 'studio-meme-overload', 'studio-nitro-run', 'studio-wild-nudge',
]);

export function casinoExpansionMode(gameId: string, rulesVersion: unknown, settings: unknown): string | null {
  if (normalExpansionModes.has(gameId)) return 'normal';
  if (isLuelonSlotGame(gameId)) {
    return validLuelonSlotSettings(gameId, settings) ? settings.luelon.mode : null;
  }
  switch (gameId) {
    case 'flag-battle':
      if (!validFlagSettings(settings)) return null;
      return settings.flags.mode ?? (rulesVersion === 1 ? 'classic' : null);
    case 'studio-caramel-carnival':
      return validCaramelSettings(settings) ? settings.caramel.mode : null;
    case 'studio-caribbean-treasures':
      return validCaribbeanTransportSettings(settings) ? settings.caribbean.mode : null;
    case 'studio-neopolis':
      return validNeopolisSettings(settings) ? settings.neopolis.hero : null;
    default:
      return null;
  }
}

function entityRef(
  gameId: string, modeId: string | null, rulesVersion: string | null, source: AuditSourceRef,
): CasinoPostingResolution['entity'] | null {
  const entity = { category: 'casino', kind: 'round', gameId, modeId: modeId ?? 'unknown',
    rulesVersion, source, ticketId: null } as const;
  return isAuditEntityRef(entity) ? entity : null;
}

/** Resolve a committed ledger row through the source keys, without running a wallet method or replaying an RNG. */
export async function resolveCasinoPosting(db: CasinoDatabase, entry: CasinoPostingKey): Promise<CasinoPostingResolution | null> {
  if (!/^[1-9][0-9]{0,18}$/.test(entry.rowId) || BigInt(entry.rowId) > 9223372036854775807n) return null;
  const schema = identifier(db.schema);
  const row = await db.prepare(`
    SELECT l.entry_type, o.result AS instant_result, r.session_id AS request_session_id,
      s.id AS session_id, s.payload AS session_payload
    FROM ${schema}.demo_ledger l
    LEFT JOIN ${schema}.demo_operations o ON o.account_id=l.account_id AND o.operation_id=l.operation_id
      AND o.kind IN ('play','spin')
    LEFT JOIN ${schema}.demo_casino_requests r ON r.account_id=l.account_id AND r.id=l.operation_id
    LEFT JOIN ${schema}.demo_casino_sessions s ON s.account_id=l.account_id
      AND s.id=COALESCE(r.session_id,l.operation_id) AND s.game_id=l.source
    WHERE l.id=?::bigint AND l.account_id=? AND l.operation_id=? AND l.source=?
      AND l.entry_type IN ('bet','win','refund','rollback')
  `).get(entry.rowId, entry.accountId, entry.operationId, entry.gameId);
  if (!row) return null;

  const source = sourceRef(db, 'demo_ledger', entry.rowId);
  const requestKey = operationKey(entry.accountId, entry.operationId);
  if (row.instant_result !== null) {
    if (row.session_id !== null || !['bet', 'win'].includes(row.entry_type)) return null;
    const round = parseRecord(row.instant_result)?.gameRound;
    if (!verifyGameRound(round) || round.gameId !== entry.gameId) return null;
    const operation = sourceRef(db, 'demo_operations', requestKey);
    const entity = entityRef(entry.gameId, 'normal', String(round.rulesVersion), operation);
    return entity ? { source, entity, operation, origin: 'command', coverage: 'complete' } : null;
  }

  const session = parseRecord(row.session_payload);
  if (!session || typeof row.session_id !== 'string' || session.id !== row.session_id || session.gameId !== entry.gameId) {
    return null;
  }
  const version = session.rulesVersion;
  const rulesVersion = (isExpansionGame(entry.gameId) && validExpansionRulesVersion(entry.gameId, version))
    || (isSessionGame(entry.gameId) && version === 1) ? String(version) : null;
  const mode = casinoExpansionMode(entry.gameId, version, session.settings);
  const entity = entityRef(entry.gameId, mode, rulesVersion,
    sourceRef(db, 'demo_casino_sessions', operationKey(entry.accountId, row.session_id)));
  if (!entity) return null;

  // An automatic Crash win uses the start UUID, but has no accepted cashout command of its own.
  const sessionKeyWin = row.entry_type === 'win' && entry.operationId === row.session_id;
  const automatic = entry.gameId === 'github-crash' && sessionKeyWin;
  const command = row.request_session_id !== null && !automatic && !(isSessionGame(entry.gameId) && sessionKeyWin);
  if (!command && !automatic && !sessionKeyWin) return null;
  return {
    source, entity, operation: command ? sourceRef(db, 'demo_casino_requests', requestKey) : null,
    origin: automatic ? 'automatic' : command ? 'command' : 'unknown',
    coverage: rulesVersion !== null && mode !== null && (command || automatic) ? 'complete' : 'partial',
  };
}
