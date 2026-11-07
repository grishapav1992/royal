import { createHash } from 'node:crypto';
import { isAuditMode, type AuditMode, type AuditReplayProfile, type AuditScope, type AuditSourceRef } from './contract';

export const REPLAY_FORMAT_VERSION = 1;
const limits = { fragments: 128, eventsPerFragment: 128, postingsPerEvent: 16,
  manifestBytes: 65536, fragmentBytes: 262144, packageBytes: 8388608 } as const;

export type ReplayDefinition = AuditMode & { formatVersion: number; gameVersion: string; engineId: string; engineVersion: string };
type Phase = 'open' | 'settled' | 'cancelled';
type Fighter = { x: number; y: number; health: number; pose: number; facing: -1 | 1 };
export type ReplayState =
  { profile: 'casino-steps'; phase: Phase; revision: number; visible: number[] } |
  { profile: 'pvp-turn-based'; phase: Phase; turn: number; seatToMove: 1 | 2 | null; board: number[] } |
  { profile: 'pvp-realtime'; phase: Phase; tick: number; fighters: [Fighter, Fighter] } |
  { profile: 'pool-steps'; phase: Phase; stage: number; remaining: number[]; eliminated: number[] };
type ReplayAction =
  { profile: 'casino-steps'; code: 'start' | 'move' | 'cashout'; selection: number[] } |
  { profile: 'pvp-turn-based'; code: 'move' | 'pass' | 'resign'; seat: 1 | 2; positions: number[] } |
  { profile: 'pvp-realtime'; code: 'input'; seat: 1 | 2; tick: number; buttons: number } |
  { profile: 'pool-steps'; code: 'advance' | 'eliminate'; entrants: number[] };
type ReplayEventData =
  { kind: 'action'; action: ReplayAction } |
  { kind: 'checkpoint'; state: ReplayState } |
  { kind: 'terminal'; state: ReplayState; outcome: 'settled' | 'cancelled' | 'timed-out' | 'forfeited' | 'draw'; winnerSeat: 1 | 2 | null };
export type ReplayEvent = { sequence: number; atMs: number; data: ReplayEventData; postings: AuditSourceRef[] };
type ReplayGap = 'initial-state-unavailable' | 'event-gap' | 'terminal-unavailable' | 'source-unavailable' | 'unsupported-source';
type FragmentRef = { index: number; firstSequence: number; lastSequence: number; firstMs: number; lastMs: number;
  eventCount: number; byteLength: number; sha256: string };
export type ReplayManifest = {
  formatVersion: typeof REPLAY_FORMAT_VERSION;
  scope: AuditScope;
  replayId: string;
  entityId: string;
  game: Omit<ReplayDefinition, 'formatVersion'>;
  initial: ReplayState | null;
  coverage: 'complete' | 'partial';
  gaps: ReplayGap[];
  terminal: { sequence: number; sha256: string } | null;
  fragments: FragmentRef[];
  sha256: string;
};
export type ReplayFragment = { formatVersion: typeof REPLAY_FORMAT_VERSION; scope: AuditScope; replayId: string;
  index: number; events: ReplayEvent[]; sha256: string };
export type ReplayPackage = { manifest: ReplayManifest; fragments: ReplayFragment[] };
type ReplayProblem = 'corrupt' | 'unsupported' | 'too-large';
type Inspection<T> = { status: 'verified'; value: T } | { status: ReplayProblem };
export type ReplayVerification = { status: 'verified'; value: ReplayPackage }
  | { status: 'incomplete'; missingFragments: number[] }
  | { status: ReplayProblem };

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const own = (value: object, key: string): unknown => Object.getOwnPropertyDescriptor(value, key)?.value;

function fields(value: unknown, names: string[]): value is Record<string, unknown> {
  return object(value) && Reflect.ownKeys(value).length === names.length && names.every(name => {
    const property = Object.getOwnPropertyDescriptor(value, name);
    return !!property?.enumerable && Object.hasOwn(property, 'value');
  });
}

const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0) && value >= min && value <= max;
const oneOf = <T extends string>(value: unknown, items: readonly T[]): value is T =>
  typeof value === 'string' && items.some(item => item === value);
export const isReplayId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const slug = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
const sha = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function list<T>(value: unknown, max: number, check: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property?.enumerable || !Object.hasOwn(property, 'value') || !check(property.value)) return false;
  }
  return true;
}

export function isReplayScope(value: unknown): value is AuditScope {
  return fields(value, ['datasetId', 'environment']) && isReplayId(value.datasetId) && oneOf(value.environment, ['test', 'live']);
}

function gameIdentity(value: unknown): value is ReplayManifest['game'] {
  if (!fields(value, ['gameId', 'modeId', 'rulesVersion', 'category', 'replayProfile', 'gameVersion', 'engineId', 'engineVersion'])) return false;
  const { gameVersion, engineId, engineVersion, ...mode } = value;
  return slug(gameVersion) && slug(engineId) && slug(engineVersion) && isAuditMode(mode);
}

function fighter(value: unknown): value is Fighter {
  return fields(value, ['x', 'y', 'health', 'pose', 'facing']) && integer(value.x, -1000000, 1000000)
    && integer(value.y, -1000000, 1000000) && integer(value.health, 0, 100000) && integer(value.pose, 0, 1023)
    && (value.facing === -1 || value.facing === 1);
}

const token = (value: unknown): value is number => integer(value, 0, 1023);
const seat = (value: unknown) => value === 1 || value === 2;
const knownPhase = (value: unknown) => oneOf(value, ['open', 'settled', 'cancelled']);

function state(value: unknown, profile: AuditReplayProfile): value is ReplayState {
  if (!object(value) || own(value, 'profile') !== profile || !knownPhase(own(value, 'phase'))) return false;
  switch (profile) {
    case 'casino-steps': return fields(value, ['profile', 'phase', 'revision', 'visible'])
      && integer(value.revision) && list(value.visible, 256, token);
    case 'pvp-turn-based': return fields(value, ['profile', 'phase', 'turn', 'seatToMove', 'board'])
      && integer(value.turn) && (seat(value.seatToMove) || value.seatToMove === null) && list(value.board, 256, token);
    case 'pvp-realtime': return fields(value, ['profile', 'phase', 'tick', 'fighters'])
      && integer(value.tick) && list(value.fighters, 2, fighter) && value.fighters.length === 2;
    case 'pool-steps': {
      if (!fields(value, ['profile', 'phase', 'stage', 'remaining', 'eliminated']) || !integer(value.stage)
        || !list(value.remaining, 256, token) || !list(value.eliminated, 256, token)) return false;
      const all = [...value.remaining, ...value.eliminated];
      return new Set(all).size === all.length;
    }
  }
}

function action(value: unknown, profile: AuditReplayProfile): value is ReplayAction {
  if (!object(value) || own(value, 'profile') !== profile) return false;
  switch (profile) {
    case 'casino-steps': return fields(value, ['profile', 'code', 'selection'])
      && oneOf(value.code, ['start', 'move', 'cashout']) && list(value.selection, 16, token);
    case 'pvp-turn-based': return fields(value, ['profile', 'code', 'seat', 'positions'])
      && oneOf(value.code, ['move', 'pass', 'resign']) && seat(value.seat) && list(value.positions, 16, token);
    case 'pvp-realtime': return fields(value, ['profile', 'code', 'seat', 'tick', 'buttons'])
      && value.code === 'input' && seat(value.seat) && integer(value.tick) && integer(value.buttons, 0, 65535);
    case 'pool-steps': return fields(value, ['profile', 'code', 'entrants'])
      && oneOf(value.code, ['advance', 'eliminate']) && list(value.entrants, 256, token)
      && new Set(value.entrants).size === value.entrants.length;
  }
}

function posting(value: unknown): value is AuditSourceRef {
  return fields(value, ['namespace', 'rowId']) && typeof value.namespace === 'string'
    && /^[a-z_][a-z0-9_]{0,62}\.(demo_ledger|capro_pending_ledger|crypto_ledger)$/.test(value.namespace)
    && typeof value.rowId === 'string' && /^[1-9][0-9]{0,18}$/.test(value.rowId) && BigInt(value.rowId) <= 9223372036854775807n;
}

function event(value: unknown, profile: AuditReplayProfile): value is ReplayEvent {
  if (!fields(value, ['sequence', 'atMs', 'data', 'postings']) || !integer(value.sequence, 1) || !integer(value.atMs)
    || !list(value.postings, limits.postingsPerEvent, posting) || !object(value.data)) return false;
  const postingIds = value.postings.map(ref => ref.namespace + '/' + ref.rowId);
  if (new Set(postingIds).size !== postingIds.length) return false;
  const data = value.data;
  if (own(data, 'kind') === 'action') return fields(data, ['kind', 'action']) && action(data.action, profile);
  if (own(data, 'kind') === 'checkpoint') return fields(data, ['kind', 'state']) && state(data.state, profile) && data.state.phase === 'open';
  return fields(data, ['kind', 'state', 'outcome', 'winnerSeat']) && data.kind === 'terminal'
    && state(data.state, profile) && data.state.phase !== 'open'
    && oneOf(data.outcome, ['settled', 'cancelled', 'timed-out', 'forfeited', 'draw'])
    && (data.outcome !== 'cancelled' || data.state.phase === 'cancelled')
    && (data.outcome !== 'settled' && data.outcome !== 'draw' || data.state.phase === 'settled')
    && (data.winnerSeat === null || (profile === 'pvp-turn-based' || profile === 'pvp-realtime') && seat(data.winnerSeat)
      && data.outcome !== 'draw' && data.outcome !== 'cancelled');
}

// Every value hashed here has already passed the closed JSON schema.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}

const hash = (value: unknown) => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
const size = (value: unknown) => Buffer.byteLength(canonical(value), 'utf8');
const sameScope = (a: AuditScope, b: AuditScope) => a.datasetId === b.datasetId && a.environment === b.environment;
const gapCodes = ['initial-state-unavailable', 'event-gap', 'terminal-unavailable', 'source-unavailable', 'unsupported-source'] as const;
const gapCode = (value: unknown): value is ReplayGap => oneOf(value, gapCodes);

function fragmentRef(value: unknown): value is FragmentRef {
  return fields(value, ['index', 'firstSequence', 'lastSequence', 'firstMs', 'lastMs', 'eventCount', 'byteLength', 'sha256'])
    && integer(value.index, 0, limits.fragments - 1) && integer(value.firstSequence, 1) && integer(value.lastSequence, value.firstSequence)
    && integer(value.firstMs) && integer(value.lastMs, value.firstMs)
    && integer(value.eventCount, 1, limits.eventsPerFragment) && value.eventCount <= value.lastSequence - value.firstSequence + 1
    && integer(value.byteLength, 1, limits.fragmentBytes) && sha(value.sha256);
}

function manifestShape(value: unknown): value is ReplayManifest {
  if (!fields(value, ['formatVersion', 'scope', 'replayId', 'entityId', 'game', 'initial', 'coverage', 'gaps', 'terminal', 'fragments', 'sha256'])
    || value.formatVersion !== REPLAY_FORMAT_VERSION || !isReplayScope(value.scope)
    || !isReplayId(value.replayId) || !isReplayId(value.entityId) || !gameIdentity(value.game)
    || !oneOf(value.coverage, ['complete', 'partial']) || !list(value.gaps, gapCodes.length, gapCode)
    || !list(value.fragments, limits.fragments, fragmentRef) || !sha(value.sha256)) return false;
  const { fragments, gaps, terminal, coverage, initial } = value;
  if (initial !== null && (!state(initial, value.game.replayProfile) || initial.phase !== 'open')) return false;
  if (terminal !== null && (!fields(terminal, ['sequence', 'sha256']) || !integer(terminal.sequence, 1)
    || !sha(terminal.sha256) || terminal.sequence !== fragments.at(-1)?.lastSequence)) return false;
  if (new Set(gaps).size !== gaps.length || (initial === null) !== gaps.includes('initial-state-unavailable')
    || (terminal === null) !== gaps.includes('terminal-unavailable')) return false;
  if (coverage === 'complete' ? gaps.length !== 0 : gaps.length === 0) return false;
  let lastSequence = 0, lastMs = 0;
  for (const [index, ref] of fragments.entries()) {
    if (ref.index !== index || ref.firstSequence <= lastSequence || ref.firstMs < lastMs) return false;
    const skipped = ref.firstSequence !== lastSequence + 1 || ref.eventCount !== ref.lastSequence - ref.firstSequence + 1;
    if (skipped && !gaps.includes('event-gap')) return false;
    lastSequence = ref.lastSequence;
    lastMs = ref.lastMs;
  }
  return true;
}

export function inspectReplayManifest(value: unknown): Inspection<ReplayManifest> {
  const version = object(value) ? own(value, 'formatVersion') : null;
  if (integer(version, 1) && version !== REPLAY_FORMAT_VERSION) return { status: 'unsupported' };
  if (!manifestShape(value)) return { status: 'corrupt' };
  if (size(value) > limits.manifestBytes || size(value) + value.fragments.reduce((sum, ref) => sum + ref.byteLength, 0) > limits.packageBytes) {
    return { status: 'too-large' };
  }
  const { sha256, ...body } = value;
  return sha256 === hash(body) ? { status: 'verified', value } : { status: 'corrupt' };
}

export function inspectReplayFragment(manifest: ReplayManifest, value: unknown): Inspection<ReplayFragment> {
  if (!fields(value, ['formatVersion', 'scope', 'replayId', 'index', 'events', 'sha256']) || value.formatVersion !== manifest.formatVersion
    || !isReplayScope(value.scope) || !sameScope(value.scope, manifest.scope) || value.replayId !== manifest.replayId
    || !integer(value.index, 0, manifest.fragments.length - 1) || !sha(value.sha256)
    || !list(value.events, limits.eventsPerFragment, (candidate): candidate is ReplayEvent => event(candidate, manifest.game.replayProfile))) {
    return { status: 'corrupt' };
  }
  const expected = manifest.fragments[value.index], first = value.events[0], last = value.events.at(-1);
  if (expected.sha256 !== value.sha256 || expected.eventCount !== value.events.length || !last
    || first.sequence !== expected.firstSequence || last.sequence !== expected.lastSequence
    || first.atMs !== expected.firstMs || last.atMs !== expected.lastMs) return { status: 'corrupt' };
  let previousSequence = first.sequence - 1, previousMs = 0;
  for (const next of value.events) {
    if (next.sequence <= previousSequence || next.atMs < previousMs) return { status: 'corrupt' };
    const isTerminal = next.sequence === manifest.terminal?.sequence;
    if ((next.data.kind === 'terminal') !== isTerminal || isTerminal && hash(next) !== manifest.terminal?.sha256) return { status: 'corrupt' };
    previousSequence = next.sequence;
    previousMs = next.atMs;
  }
  const bytes = size(value);
  if (bytes > limits.fragmentBytes) return { status: 'too-large' };
  const { sha256, ...body } = value;
  return bytes === expected.byteLength && sha256 === hash(body) ? { status: 'verified', value: value as ReplayFragment }
    : { status: 'corrupt' };
}

export function verifyReplayPackage(input: unknown, supported?: readonly ReplayDefinition[]): ReplayVerification {
  if (!fields(input, ['manifest', 'fragments']) || !Array.isArray(input.fragments)) return { status: 'corrupt' };
  if (input.fragments.length > limits.fragments) return { status: 'too-large' };
  if (!list(input.fragments, limits.fragments, (item): item is object => object(item))) return { status: 'corrupt' };
  const header = inspectReplayManifest(input.manifest);
  if (header.status !== 'verified') return header;
  const manifest = header.value;
  const fragments = new Map<number, ReplayFragment>();
  for (const item of input.fragments) {
    const verified = inspectReplayFragment(manifest, item);
    if (verified.status !== 'verified') return verified;
    const fragment = verified.value;
    fragments.set(fragment.index, fragment);
  }
  const missingFragments = manifest.fragments.filter(ref => !fragments.has(ref.index)).map(ref => ref.index);
  if (missingFragments.length) return { status: 'incomplete', missingFragments };
  if (supported) {
    const version = { ...manifest.game, formatVersion: manifest.formatVersion };
    if (!supported.some(item => canonical(item) === canonical(version))) return { status: 'unsupported' };
  }
  return { status: 'verified', value: { manifest, fragments: manifest.fragments.map(ref => fragments.get(ref.index)!) } };
}

/** Builds packages only from supplied, already accepted evidence. It never queries or plays a game. */
export function createReplayPackage(
  input: Omit<ReplayManifest, 'formatVersion' | 'terminal' | 'fragments' | 'sha256'>, events: readonly ReplayEvent[],
): ReplayPackage {
  if (!fields(input, ['scope', 'replayId', 'entityId', 'game', 'initial', 'coverage', 'gaps'])
    || !gameIdentity(input.game) || !isReplayId(input.replayId) || !isReplayId(input.entityId) || !isReplayScope(input.scope)
    || !list(events, limits.fragments * limits.eventsPerFragment,
      (candidate): candidate is ReplayEvent => event(candidate, input.game.replayProfile))) throw new Error('Invalid replay evidence');
  const fragments: ReplayFragment[] = [];
  const refs: FragmentRef[] = [];
  for (let offset = 0; offset < events.length; offset += limits.eventsPerFragment) {
    const part = events.slice(offset, offset + limits.eventsPerFragment);
    const first = part[0], last = part[part.length - 1];
    const body: Omit<ReplayFragment, 'sha256'> = { formatVersion: REPLAY_FORMAT_VERSION, scope: input.scope,
      replayId: input.replayId, index: fragments.length, events: part };
    const fragment = { ...body, sha256: hash(body) };
    fragments.push(fragment);
    refs.push({ index: fragment.index, firstSequence: first.sequence, lastSequence: last.sequence, firstMs: first.atMs, lastMs: last.atMs,
      eventCount: part.length, byteLength: size(fragment), sha256: fragment.sha256 });
  }
  const terminal = events.at(-1);
  const body = { ...input, formatVersion: REPLAY_FORMAT_VERSION,
    terminal: terminal?.data.kind === 'terminal' ? { sequence: terminal.sequence, sha256: hash(terminal) } : null, fragments: refs };
  if (!manifestShape({ ...body, sha256: '0'.repeat(64) })) throw new Error('Invalid replay evidence');
  const result = { manifest: { ...body, sha256: hash(body) }, fragments };
  const checked = verifyReplayPackage(result);
  if (checked.status !== 'verified') throw new Error('Invalid replay package: ' + checked.status);
  return structuredClone(checked.value);
}

export function planReplaySeek(
  input: unknown, supported: readonly ReplayDefinition[], sequence: number,
): { status: 'ready'; sequence: number; state: ReplayState; events: ReplayEvent[] }
  | { status: 'incomplete' | 'corrupt' | 'unsupported' | 'too-large' | 'missing-checkpoint' } {
  const checked = verifyReplayPackage(input, supported);
  if (checked.status !== 'verified') return { status: checked.status };
  if (!integer(sequence)) return { status: 'missing-checkpoint' };
  let checkpoint = checked.value.manifest.initial, checkpointSequence = 0, lastSequence = 0;
  let selected: ReplayEvent[] = [];
  for (const fragment of checked.value.fragments) {
    for (const event of fragment.events) {
      if (event.sequence > sequence) break;
      if (event.data.kind === 'checkpoint' || event.data.kind === 'terminal') {
        checkpoint = event.data.state;
        checkpointSequence = event.sequence;
        selected = [];
      } else if (checkpoint && event.sequence === lastSequence + 1) selected.push(event);
      else checkpoint = null;
      lastSequence = event.sequence;
    }
  }
  return checkpoint && lastSequence === sequence ? { status: 'ready', sequence: checkpointSequence, state: checkpoint, events: selected }
    : { status: 'missing-checkpoint' };
}
