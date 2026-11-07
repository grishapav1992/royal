export const AUDIT_SCHEMA_VERSION = 1;

const profiles = {
  casino: ['casino-steps'],
  pvp: ['pvp-turn-based', 'pvp-realtime', 'pvp-sport'],
  totalizator: ['pool-steps'],
} as const;
const entityKinds = { casino: 'round', pvp: 'match', totalizator: 'pool' } as const;

export type AuditCategory = keyof typeof profiles;
export type AuditReplayProfile = (typeof profiles)[AuditCategory][number];
export type AuditMode = {
  gameId: string;
  modeId: string;
  rulesVersion: string;
  category: AuditCategory;
  replayProfile: AuditReplayProfile;
};
export type AuditScope = { datasetId: string; environment: 'test' | 'live' };
export type AuditAsset = { contour: 'virtual' | 'test' | 'real'; code: string; scale: number };
export type AuditSourceRef = { namespace: string; rowId: string };
export type AuditEntityRef = {
  gameId: string;
  modeId: string;
  rulesVersion: string | null;
  source: AuditSourceRef;
} & (
  { category: 'casino'; kind: 'round'; ticketId: null } |
  { category: 'pvp'; kind: 'match'; ticketId: null } |
  { category: 'totalizator'; kind: 'pool'; ticketId: string | null }
);

const movements = ['deposit', 'withdrawal-reserve', 'withdrawal-paid', 'stake', 'paid-option',
  'reserve', 'release', 'payout', 'refund', 'adjustment', 'reward', 'purchase', 'fee', 'reversal'] as const;
const events = ['accepted', 'advanced', 'reserved', 'released', 'settled', 'cancelled', 'timed-out',
  'disconnected', 'reconnected', 'forfeited', 'recovered'] as const;
const coverage = ['complete', 'partial', 'not-recorded', 'source-unavailable', 'unsupported'] as const;

type RecordHeader = { schemaVersion: typeof AUDIT_SCHEMA_VERSION; scope: AuditScope; occurredAtMs: number };
export type AuditPosting = RecordHeader & {
  type: 'posting';
  source: AuditSourceRef;
  sequence: string;
  accountId: string;
  operationId: string | null;
  entity: AuditEntityRef | null;
  coverage: (typeof coverage)[number];
  movement: (typeof movements)[number];
  asset: AuditAsset;
  availableDeltaUnits: string;
  reservedDeltaUnits: string | null;
  availableAfterUnits: string | null;
  reservedAfterUnits: string | null;
};
export type AuditEvent = RecordHeader & {
  type: 'event';
  eventId: string;
  sequence: string;
  accountId: string | null;
  operationId: string | null;
  entity: AuditEntityRef;
  event: (typeof events)[number];
  reasonCode: string | null;
  postings: AuditSourceRef[];
};
export type AuditResponseBalance =
  { state: 'value'; asset: AuditAsset; units: string; snapshot: AuditSourceRef | null } |
  { state: 'absent' | 'invalid' | 'not-recorded' };
export type AuditAttempt = RecordHeader & {
  type: 'attempt';
  attemptId: string;
  accountId: string;
  operationId: string | null;
  entity: AuditEntityRef | null;
  transport: 'http' | 'websocket';
  route: string;
  decision: 'accepted' | 'replayed' | 'rejected' | 'unknown';
  response: 'formed' | 'not-observed';
  statusCode: number | null;
  balance: AuditResponseBalance;
  delivery?: 'handed-off' | 'closed' | 'unobserved';
  intentFingerprint?: string;
};
export type AuditReplay = RecordHeader & {
  type: 'replay';
  replayId: string;
  entity: AuditEntityRef;
  profile: AuditReplayProfile;
  engineVersion: string;
  formatVersion: number;
  coverage: (typeof coverage)[number];
  firstSequence: string | null;
  lastSequence: string | null;
  terminalEventId: string | null;
  sha256: string | null;
};
export type AuditRecord = AuditPosting | AuditEvent | AuditAttempt | AuditReplay;

// Encoded tuples preserve opaque IDs without separator collisions. Store the dataset ID separately.
export const auditSourceKey = ({ namespace, rowId }: AuditSourceRef): string => JSON.stringify([namespace, rowId]);
export const auditModeKey = ({ gameId, modeId, rulesVersion }: AuditMode): string =>
  JSON.stringify([gameId, modeId, rulesVersion]);

function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fields(value: Record<string, unknown>, names: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === names.length && names.every(name => Object.hasOwn(value, name));
}

const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T =>
  typeof value === 'string' && values.some(option => option === value);
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value);
const slug = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(value);
const integer = (value: unknown): value is string => typeof value === 'string' && /^(0|-?[1-9][0-9]{0,77})$/.test(value);
const sequence = (value: unknown): value is string => integer(value) && !value.startsWith('-');
const safeInt = (value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const nullable = <T>(value: unknown, check: (v: unknown) => v is T): value is T | null => value === null || check(value);
const category = (value: unknown): value is AuditCategory => typeof value === 'string' && Object.hasOwn(profiles, value);
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function source(value: unknown): value is AuditSourceRef {
  return object(value) && fields(value, ['namespace', 'rowId']) && slug(value.namespace) && identifier(value.rowId);
}

function scope(value: unknown): value is AuditScope {
  return object(value) && fields(value, ['datasetId', 'environment']) && identifier(value.datasetId) &&
    oneOf(value.environment, ['test', 'live']);
}

function asset(value: unknown): value is AuditAsset {
  return object(value) && fields(value, ['contour', 'code', 'scale']) && oneOf(value.contour, ['virtual', 'test', 'real']) &&
    typeof value.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(value.code) && safeInt(value.scale, 0, 18);
}

export function isAuditEntityRef(value: unknown): value is AuditEntityRef {
  return object(value) && fields(value, ['category', 'kind', 'gameId', 'modeId', 'rulesVersion', 'source', 'ticketId']) &&
    category(value.category) && value.kind === entityKinds[value.category] && slug(value.gameId) && slug(value.modeId) &&
    nullable(value.rulesVersion, slug) && source(value.source) &&
    (value.category === 'totalizator' ? nullable(value.ticketId, identifier) : value.ticketId === null);
}

export function isAuditMode(value: unknown): value is AuditMode {
  return object(value) && fields(value, ['gameId', 'modeId', 'rulesVersion', 'category', 'replayProfile']) &&
    slug(value.gameId) && slug(value.modeId) && slug(value.rulesVersion) && category(value.category) &&
    oneOf(value.replayProfile, profiles[value.category]);
}

export function isAuditModeRegistry(value: unknown): value is AuditMode[] {
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>();
  for (const mode of value) {
    if (!isAuditMode(mode)) return false;
    const key = auditModeKey(mode);
    if (keys.has(key)) return false;
    keys.add(key);
  }
  return true;
}

const header = ['schemaVersion', 'type', 'scope', 'occurredAtMs'] as const;
const operation = ['accountId', 'operationId', 'entity'] as const;

function posting(value: Record<string, unknown>): boolean {
  return fields(value, [...header, ...operation, 'source', 'sequence', 'coverage', 'movement', 'asset',
    'availableDeltaUnits', 'reservedDeltaUnits', 'availableAfterUnits', 'reservedAfterUnits']) &&
    source(value.source) && sequence(value.sequence) && identifier(value.accountId) &&
    nullable(value.operationId, identifier) && nullable(value.entity, isAuditEntityRef) &&
    oneOf(value.coverage, coverage) && oneOf(value.movement, movements) && asset(value.asset) &&
    integer(value.availableDeltaUnits) && nullable(value.reservedDeltaUnits, integer) &&
    nullable(value.availableAfterUnits, integer) && nullable(value.reservedAfterUnits, integer);
}

function postingRefs(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const refs = new Set<string>();
  for (const ref of value) {
    if (!source(ref)) return false;
    const key = auditSourceKey(ref);
    if (refs.has(key)) return false;
    refs.add(key);
  }
  return true;
}

function event(value: Record<string, unknown>): boolean {
  return fields(value, [...header, ...operation, 'eventId', 'sequence', 'event', 'reasonCode', 'postings']) &&
    identifier(value.eventId) && sequence(value.sequence) && nullable(value.accountId, identifier) &&
    nullable(value.operationId, identifier) && isAuditEntityRef(value.entity) && oneOf(value.event, events) &&
    nullable(value.reasonCode, slug) && postingRefs(value.postings);
}

function responseBalance(value: unknown): value is AuditResponseBalance {
  if (!object(value)) return false;
  if (value.state === 'value') {
    return fields(value, ['state', 'asset', 'units', 'snapshot']) &&
      asset(value.asset) && integer(value.units) && nullable(value.snapshot, source);
  }
  return fields(value, ['state']) && oneOf(value.state, ['absent', 'invalid', 'not-recorded']);
}

function attempt(value: Record<string, unknown>): boolean {
  const names = [...header, ...operation, 'attemptId', 'transport', 'route', 'decision', 'response', 'statusCode', 'balance'];
  if (Object.hasOwn(value, 'delivery')) {
    names.push('delivery');
    if (!oneOf(value.delivery, ['handed-off', 'closed', 'unobserved']) ||
      (value.delivery === 'handed-off' && value.response !== 'formed')) return false;
  }
  if (Object.hasOwn(value, 'intentFingerprint')) {
    names.push('intentFingerprint');
    if (value.operationId === null || !sha256(value.intentFingerprint)) return false;
  }
  if (!fields(value, names) ||
    !identifier(value.attemptId) || !identifier(value.accountId) || !nullable(value.operationId, identifier) ||
    !nullable(value.entity, isAuditEntityRef) || !oneOf(value.transport, ['http', 'websocket']) ||
    !(value.transport === 'http'
      ? typeof value.route === 'string' && /^\/[a-zA-Z0-9._/:-]{1,127}$/.test(value.route)
      : slug(value.route)) || !oneOf(value.decision, ['accepted', 'replayed', 'rejected', 'unknown']) ||
    !responseBalance(value.balance)) return false;
  if (value.response === 'not-observed') return value.statusCode === null && value.balance.state === 'not-recorded';
  return value.response === 'formed' &&
    (value.transport === 'http' ? safeInt(value.statusCode, 100, 599) : value.statusCode === null);
}

function replay(value: Record<string, unknown>): boolean {
  if (!fields(value, [...header, 'replayId', 'entity', 'profile', 'engineVersion', 'formatVersion', 'coverage',
    'firstSequence', 'lastSequence', 'terminalEventId', 'sha256']) || !identifier(value.replayId) ||
    !isAuditEntityRef(value.entity) || value.entity.ticketId !== null ||
    !oneOf(value.profile, profiles[value.entity.category]) || !identifier(value.engineVersion) ||
    !safeInt(value.formatVersion, 1) || !oneOf(value.coverage, coverage) ||
    !nullable(value.firstSequence, sequence) || !nullable(value.lastSequence, sequence) ||
    !nullable(value.terminalEventId, identifier) || !nullable(value.sha256, sha256)) return false;
  if ((value.firstSequence === null) !== (value.lastSequence === null)) return false;
  if (value.firstSequence !== null && value.lastSequence !== null && BigInt(value.firstSequence) > BigInt(value.lastSequence)) return false;
  return value.coverage !== 'complete' || (value.entity.rulesVersion !== null && value.firstSequence !== null &&
    value.terminalEventId !== null && value.sha256 !== null);
}

export function isAuditRecord(value: unknown): value is AuditRecord {
  if (!object(value) || value.schemaVersion !== AUDIT_SCHEMA_VERSION || !scope(value.scope) ||
    !safeInt(value.occurredAtMs, 0)) return false;
  switch (value.type) {
    case 'posting': return posting(value);
    case 'event': return event(value);
    case 'attempt': return attempt(value);
    case 'replay': return replay(value);
    default: return false;
  }
}
