import { isDeepStrictEqual } from 'node:util';
import { COMBAT_RULES_VERSION } from '../../src/shared/combatEscrow';
import { STANDARD_PVP_RULES_VERSION } from '../../src/shared/pvp';
import type { AuditEntityRef } from './contract';
import type { ReplayDefinition, ReplayManifest } from './replay-package';
import { cardTurnReplayDefinitions } from './replay-pvp-cards';
import { combatReplayDefinition } from './replay-pvp-realtime-engine';
import { sportReplayDefinitions } from './replay-pvp-sport-engine';
import { tsuTurnReplayDefinition } from './replay-pvp-tsu';
import { chessTurnReplayDefinition } from './replay-pvp-turn';

const standardDefinitions = [chessTurnReplayDefinition, ...cardTurnReplayDefinitions,
  ...sportReplayDefinitions.filter(game => game.formatVersion === 4 || game.gameId === 'pool' && game.formatVersion === 5)];
const acceptedVersions = [
  ...standardDefinitions.map(definition => ({ definition, version: String(STANDARD_PVP_RULES_VERSION) })),
  { definition: combatReplayDefinition, version: String(COMBAT_RULES_VERSION) },
  { definition: tsuTurnReplayDefinition, version: tsuTurnReplayDefinition.rulesVersion },
];

/** Replay engine labels and accepted paid rules are separate, versioned identities. */
export function acceptedPvpReplayRulesVersion(game: ReplayDefinition) {
  return acceptedVersions.find(entry => isDeepStrictEqual(entry.definition, game))?.version ?? null;
}

export function replayMatchesAuditRules(entity: Pick<AuditEntityRef, 'category' | 'gameId' | 'modeId' | 'rulesVersion'>,
  manifest: Pick<ReplayManifest, 'game' | 'formatVersion'>) {
  const { game, formatVersion } = manifest;
  if (game.category !== entity.category || game.gameId !== entity.gameId || game.modeId !== entity.modeId) return false;
  if (entity.rulesVersion === null) return true;
  const version = entity.category === 'pvp' ? acceptedPvpReplayRulesVersion({ ...game, formatVersion }) : game.rulesVersion;
  return version === entity.rulesVersion;
}
