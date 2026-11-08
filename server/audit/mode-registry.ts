import { CARAMEL_GAME, validCaramelSettings } from '../../src/shared/caramelCarnival';
import { CARIBBEAN_GAME } from '../../src/shared/caribbeanTreasures';
import { validCaribbeanTransportSettings } from '../../src/shared/caribbeanTransport';
import { COMBAT_RULES_VERSION } from '../../src/shared/combatEscrow';
import { FLAG_GAME, FLAG_MODES, flagCountries, validFlagSettings } from '../../src/shared/flagBattle';
import { TOTE_GAME } from '../../src/shared/flagTote';
import { GAME_CATALOG } from '../../src/shared/gameCore';
import { LUELON_SLOT_INFO, validLuelonSlotSettings } from '../../src/shared/luelonSlots';
import { NEOPOLIS_GAME, validNeopolisSettings } from '../../src/shared/neopolis';
import { HEROES } from '../../src/shared/neopolisMath';
import { isStandardPvpGame, PVP_GAMES, STANDARD_PVP_RULES_VERSION } from '../../src/shared/pvp';
import { auditModeKey, isAuditModeRegistry, type AuditMode } from './contract';

type SessionRegistration = {
  gameId: string;
  versions: readonly number[];
  modes: readonly string[];
  selector?: {
    group: string;
    field: string;
    ifAbsent?: { modeId: string; field: string; values: readonly string[] };
  };
  validate?: (settings: unknown) => boolean;
  paidOptions?: readonly string[];
};

const luelon = (gameId: 'studio-cosmic-escape' | 'studio-velvet-reign'): SessionRegistration => {
  const modes = LUELON_SLOT_INFO[gameId]!.modes;
  return { gameId, versions: [1, 2], selector: { group: 'luelon', field: 'mode' }, validate: settings => validLuelonSlotSettings(gameId, settings),
    modes: modes.map(mode => mode.id), paidOptions: modes.filter(mode => mode.cost > 1).map(mode => mode.id) };
};

const normalSessions: readonly (readonly [string, ...number[]])[] = [
  ['github-crash', 1], ['github-hilo', 1], ['original-cr-vs-leo', 1], ['original-jackie-chan', 1],
  ['studio-afterglow', 1, 2], ['studio-dracona', 1, 2, 3], ['studio-flooded-temple', 1, 2],
  ['studio-forest-heart', 1], ['studio-last-convoy', 1, 2], ['studio-meme-overload', 1, 2],
  ['studio-nitro-run', 1, 2], ['studio-wild-nudge', 1, 2],
];

// Saved versions stay registered when current admission or the client changes.
const sessions: readonly SessionRegistration[] = [
  ...normalSessions.map(([gameId, ...versions]) => ({ gameId, versions, modes: ['normal'] })),
  luelon('studio-cosmic-escape'),
  luelon('studio-velvet-reign'),
  { gameId: CARAMEL_GAME, versions: [1, 2], selector: { group: 'caramel', field: 'mode' },
    modes: ['normal', 'festival'], paidOptions: ['festival'], validate: validCaramelSettings },
  { gameId: CARIBBEAN_GAME, versions: [1, 2], selector: { group: 'caribbean', field: 'mode' },
    modes: ['normal', 'buy-raid', 'buy-flagship'], paidOptions: ['buy-raid', 'buy-flagship'], validate: validCaribbeanTransportSettings },
  { gameId: NEOPOLIS_GAME, versions: [1, 2, 3, 4], selector: { group: 'neopolis', field: 'hero' },
    modes: HEROES, validate: validNeopolisSettings },
  { gameId: FLAG_GAME, versions: [1], selector: { group: 'flags', field: 'mode',
    ifAbsent: { modeId: 'classic', field: 'country', values: flagCountries('classic').map(country => country.id) } },
    modes: ['classic'], validate: validFlagSettings },
  { gameId: FLAG_GAME, versions: [2], selector: { group: 'flags', field: 'mode' },
    modes: FLAG_MODES.map(mode => mode.id), validate: validFlagSettings },
];
const instantModes: AuditMode[] = GAME_CATALOG.filter(game => game.kind === 'instant').map(game => ({
  gameId: game.id, modeId: 'normal', rulesVersion: String(game.rulesVersion), category: 'casino', replayProfile: 'casino-steps',
}));
const versionedPvpModes: AuditMode[] = [
  ...[1, 2, 3, 4].map((version): AuditMode => ({
    gameId: 'tsu-e-fa', modeId: 'stake', rulesVersion: String(version), category: 'pvp', replayProfile: 'pvp-turn-based',
  })),
  ...Object.keys(PVP_GAMES).filter(isStandardPvpGame).map((gameId): AuditMode => ({
    gameId, modeId: 'stake', rulesVersion: String(STANDARD_PVP_RULES_VERSION), category: 'pvp',
    replayProfile: gameId === 'hockey' || gameId === 'pool' ? 'pvp-sport' : 'pvp-turn-based',
  })),
  { gameId: 'mortal-kombat', modeId: 'stake', rulesVersion: String(COMBAT_RULES_VERSION), category: 'pvp', replayProfile: 'pvp-realtime' },
];
export const auditToteMode = Object.freeze({ gameId: TOTE_GAME, modeId: 'pool', rulesVersion: '1',
  category: 'totalizator', replayProfile: 'pool-steps' } satisfies AuditMode);
const sessionModes: AuditMode[] = sessions.flatMap(rule => rule.versions.flatMap(version => rule.modes.map(modeId => ({
  gameId: rule.gameId, modeId, rulesVersion: String(version), category: 'casino', replayProfile: 'casino-steps',
}))));
const registered = [...instantModes, ...sessionModes, ...versionedPvpModes, auditToteMode];
if (!isAuditModeRegistry(registered)) throw new Error('Invalid paid audit mode registry');
const modesByKey = new Map(registered.map(mode => [auditModeKey(mode), Object.freeze(mode)]));
const sessionKey = (gameId: string, version: string | number) => JSON.stringify([gameId, String(version)]);
const sessionsByVersion = new Map<string, SessionRegistration>();
for (const rule of sessions) {
  for (const version of rule.versions) {
    const key = sessionKey(rule.gameId, version);
    if (sessionsByVersion.has(key)) throw new Error('Duplicate paid audit session selector');
    sessionsByVersion.set(key, rule);
  }
}

export function registeredAuditMode(gameId: string, modeId: string, version: unknown) {
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) return null;
  return modesByKey.get(JSON.stringify([gameId, modeId, String(version)])) ?? null;
}

export function registeredPvpRulesVersion(gameId: string, version: unknown) {
  const mode = registeredAuditMode(gameId, 'stake', version);
  return mode?.category === 'pvp' ? mode.rulesVersion : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function registeredCasinoSessionMode(gameId: string, version: unknown, settings: unknown) {
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) return null;
  const rule = sessionsByVersion.get(sessionKey(gameId, version));
  if (!rule || rule.validate && !rule.validate(settings)) return null;
  if (!rule.selector) return registeredAuditMode(gameId, rule.modes[0], version);
  const { group, field, ifAbsent } = rule.selector;
  const source = record(settings), selection = record(source?.[group]);
  if (!source || Object.keys(source).length !== 1 || !selection) return null;
  const fallbackValue = ifAbsent && selection[ifAbsent.field];
  const fallback = ifAbsent && typeof fallbackValue === 'string' && ifAbsent.values.includes(fallbackValue)
    ? ifAbsent.modeId : undefined;
  const modeId = Object.hasOwn(selection, field) ? selection[field] : fallback;
  return typeof modeId === 'string' && rule.modes.includes(modeId) ? registeredAuditMode(gameId, modeId, version) : null;
}

export function isPaidCasinoOpening(gameId: string, modeId: string, rulesVersion: string | null) {
  return rulesVersion !== null &&
    sessionsByVersion.get(sessionKey(gameId, rulesVersion))?.paidOptions?.includes(modeId) === true;
}

const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const inList = (expression: string, values: readonly string[]) => expression + ' IN (' + values.map(literal).join(',') + ')';

/** Build only from the declared modes. SQL expressions are supplied by the report installer. */
export function casinoSessionModeSql(game: string, payload: string) {
  const settings = `(${payload}->'settings')`, version = `(${payload}->'rulesVersion')`;
  const cases = sessions.map(rule => {
    const condition = `${game}=${literal(rule.gameId)} AND ${inList(version + '::text', rule.versions.map(String))}`;
    if (!rule.selector) return `WHEN ${condition} THEN ${literal(rule.modes[0])}`;
    const { group, field, ifAbsent } = rule.selector;
    const owner = `(${settings}->${literal(group)})`, mode = `(${owner}->>${literal(field)})`;
    const absent = ifAbsent ? ` WHEN NOT (${owner} ? ${literal(field)})
      AND ${inList(`(${owner}->>${literal(ifAbsent.field)})`, ifAbsent.values)} THEN ${literal(ifAbsent.modeId)}` : '';
    return `WHEN ${condition} AND (CASE WHEN jsonb_typeof(${settings})='object'
      THEN ${settings}-${literal(group)}='{}'::jsonb AND jsonb_typeof(${owner})='object' END)
      THEN CASE WHEN ${inList(mode, rule.modes)} THEN ${mode}${absent} END`;
  });
  return `CASE ${cases.join('\n')} END`;
}

export function casinoPaidOpeningSql(game: string, mode: string, version: string) {
  return sessions.filter(rule => rule.paidOptions?.length).map(rule =>
    `(${game}=${literal(rule.gameId)} AND ${inList(version, rule.versions.map(String))}
      AND ${inList(mode, rule.paidOptions!)})`).join(' OR ');
}

export function instantCasinoModeSql(game: string, round: string) {
  const version = `(${round}->'rulesVersion')::text`;
  const matches = instantModes.map(mode => `(${game}=${literal(mode.gameId)} AND ${version}=${literal(mode.rulesVersion)})`);
  return `CASE WHEN ${round}->>'gameId'=${game} AND (${matches.join(' OR ')}) THEN 'normal' END`;
}

export function pvpModeVersionSql(game: string, version: string) {
  return `CASE ${versionedPvpModes.map(mode => `WHEN ${game}=${literal(mode.gameId)}
    AND (${version})=${literal(mode.rulesVersion)}::jsonb THEN ${literal(mode.rulesVersion)}`).join('\n')} END`;
}
