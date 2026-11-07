import { createHash } from 'node:crypto';
import { prepareGame } from '../games/core';
import { validExpansionAction } from '../../src/shared/casinoExpansion';
import { casinoActionKey, validCasinoAction } from '../../src/shared/casinoSessions';
import { validPvpRequest } from '../../src/shared/pvp';

export const auditCommandRoutes = {
  core: '/api/demo-wallet/operations',
  expansion: '/api/demo-wallet/expansion',
  session: '/api/demo-wallet/casino-sessions',
  pvp: 'pvp',
} as const;

function coreIntent(value: Record<string, unknown>) {
  const { kind, amount, gameId, rulesVersion, input, stakePolicyVersion } = value;
  if ((kind !== 'deposit' && kind !== 'spin' && kind !== 'play') || typeof amount !== 'number' || !Number.isFinite(amount)) return null;
  const keys = Object.keys(value).filter(key => key !== 'stakePolicyVersion').sort().join(',');
  if (keys !== (kind === 'play' ? 'amount,gameId,id,input,kind,rulesVersion' : 'amount,id,kind') ||
    (Object.hasOwn(value, 'stakePolicyVersion') && (kind !== 'play' || stakePolicyVersion !== 1))) return null;
  const game = kind === 'play' ? prepareGame(gameId, rulesVersion, input) :
    kind === 'spin' ? prepareGame('royal-coins', 1, {}) : null;
  return JSON.stringify([kind, amount, game?.gameId ?? null, game?.rulesVersion ?? null, game?.input ?? null,
    ...(stakePolicyVersion === 1 ? [1] : [])]);
}

// The PvP store compares nested keys in sorted order, including keys in the move payload.
function pvpIntent(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(pvpIntent).join(',') + ']';
  const row = value as Record<string, unknown>;
  return '{' + Object.keys(row).sort().map(key => JSON.stringify(key) + ':' + pvpIntent(row[key])).join(',') + '}';
}

export function fingerprintAuditIntent(route: string, accountId: string, operationId: string, canonicalKey: string) {
  return createHash('sha256').update(JSON.stringify(['royal-audit-intent-v1', route, accountId, operationId, canonicalKey])).digest('hex');
}

/** Mirror only known source comparison formats. Never retain an input body or a source request key. */
export function observeAuditIntent(route: string, accountId: string, operationId: string, value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const row = value as Record<string, unknown>;
  if (row.id !== operationId) return;
  let key: string | null = null;
  try {
    switch (route) {
      case auditCommandRoutes.core: key = coreIntent(row); break;
      case auditCommandRoutes.expansion: if (validExpansionAction(row)) key = JSON.stringify(row); break;
      case auditCommandRoutes.session: if (validCasinoAction(row)) key = casinoActionKey(row); break;
      case auditCommandRoutes.pvp: if (validPvpRequest(row)) key = pvpIntent(row); break;
    }
  } catch {
    return;
  }
  if (key !== null) return fingerprintAuditIntent(route, accountId, operationId, key);
}
