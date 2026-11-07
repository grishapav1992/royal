import { auditSourceKey, type AuditAsset, type AuditAttempt, type AuditPosting, type AuditScope, type AuditSourceRef } from './contract';

type Component = 'available' | 'reserved' | 'pending';
type SourceGap = 'not-captured' | 'source-unavailable' | 'unsupported';
type GapReason = SourceGap | 'opening-unconfirmed' | 'previous-balance-unavailable' | 'delta-unavailable'
  | 'recorded-balance-unavailable' | 'response-not-observed' | 'response-balance-absent' | 'response-balance-invalid'
  | 'response-balance-not-recorded' | 'snapshot-unassociated' | 'snapshot-unavailable' | 'snapshot-context-mismatch'
  | 'snapshot-route-unsupported' | 'snapshot-source-unsupported';

export type AuditBalanceEntry = {
  posting: AuditPosting;
  pendingDeltaUnits?: string | null;
  pendingAfterUnits?: string | null;
} | { gap: { source: AuditSourceRef; sequence: string; reason: SourceGap } };

export type AuditBalanceStream = {
  scope: AuditScope;
  accountId: string;
  asset: AuditAsset;
  sourceNamespace: string;
  component: Component;
  openingUnits: string | null;
  entries: readonly AuditBalanceEntry[];
};

export type AuditBalanceComparison = {
  status: 'match' | 'mismatch';
  expectedUnits: string;
  observedUnits: string;
} | {
  status: 'insufficient-data';
  reason: GapReason;
  expectedUnits: string | null;
  observedUnits: string | null;
};

type ChainCheck = AuditBalanceComparison & {
  source: AuditSourceRef;
  sequence: string;
  basis: 'opening' | 'adjacent' | null;
};

export type AuditBalanceSnapshot = {
  source: AuditSourceRef;
  scope: AuditScope;
  accountId: string;
  asset: AuditAsset;
  units: string;
};

type AttemptBalanceCheck = AuditBalanceComparison & { asset: AuditAsset | null };
type BalancePostingReader = {
  read(datasetId: string, source: AuditSourceRef): Promise<{ status: 'found'; posting: AuditPosting } | { status: SourceGap }>;
};

const virtualHttpRoutes = new Set([
  '/api/demo-wallet/operations',
  '/api/demo-wallet/expansion',
  '/api/demo-wallet/casino-sessions',
  '/api/demo-wallet/flight',
  '/api/demo-wallet/mines',
  '/api/demo-wallet/flag-tote',
  '/api/progression/spins',
]);

const sameScope = (a: AuditScope, b: AuditScope) =>
  a.datasetId === b.datasetId && a.environment === b.environment;
const sameAsset = (a: AuditAsset, b: AuditAsset) => a.code === b.code && a.contour === b.contour;

function units(value: string): bigint {
  if (!/^(0|-?[1-9][0-9]{0,77})$/.test(value)) throw new Error('Expected canonical integer audit units');
  return BigInt(value);
}

function optionalUnits(value: string | null | undefined): bigint | null {
  return value == null ? null : units(value);
}

function insufficient(reason: GapReason, expected?: bigint | null, observed?: bigint | null): AuditBalanceComparison {
  return { status: 'insufficient-data', reason, expectedUnits: expected?.toString() ?? null,
    observedUnits: observed?.toString() ?? null };
}

function attemptGap(reason: GapReason): AttemptBalanceCheck {
  return { asset: null, ...insufficient(reason) };
}

function compare(expected: bigint, observed: bigint): AuditBalanceComparison {
  return { status: expected === observed ? 'match' : 'mismatch',
    expectedUnits: expected.toString(), observedUnits: observed.toString() };
}

function componentValues(entry: Extract<AuditBalanceEntry, { posting: AuditPosting }>, component: Component) {
  const { posting } = entry;
  switch (component) {
    case 'available': return [posting.availableDeltaUnits, posting.availableAfterUnits] as const;
    case 'reserved': return [posting.reservedDeltaUnits, posting.reservedAfterUnits] as const;
    case 'pending': return [entry.pendingDeltaUnits, entry.pendingAfterUnits] as const;
  }
}

/** The caller supplies one authoritative stream in source order, including explicit gaps. */
export function reconcileAuditBalance(stream: AuditBalanceStream): {
  opening: 'verified' | 'unconfirmed';
  checks: ChainCheck[];
} {
  const opening = stream.openingUnits === null ? 'unconfirmed' : 'verified';
  let cumulative = optionalUnits(stream.openingUnits), previous: bigint | null = null;
  let lastSequence = -1n, sawEntry = false;
  const seenSources = new Set<string>();
  const checks: ChainCheck[] = [];
  for (const entry of stream.entries) {
    const identity = 'posting' in entry ? entry.posting : entry.gap;
    const { source, sequence } = identity;
    const order = units(sequence), key = auditSourceKey(source);
    if (source.namespace !== stream.sourceNamespace || order <= lastSequence || seenSources.has(key)) {
      throw new Error('Audit balance stream has a foreign source, duplicate or invalid order');
    }
    if ('posting' in entry) {
      const { accountId, asset, scope } = entry.posting;
      if (accountId !== stream.accountId || !sameScope(scope, stream.scope) ||
        !sameAsset(asset, stream.asset) || asset.scale !== stream.asset.scale) {
        throw new Error('Audit balance stream has a foreign account, scope or asset');
      }
    }
    lastSequence = order;
    seenSources.add(key);
    if ('gap' in entry) {
      cumulative = previous = null;
      checks.push({ source, sequence, basis: null, ...insufficient(entry.gap.reason) });
    } else {
      const [rawDelta, rawObserved] = componentValues(entry, stream.component);
      const delta = optionalUnits(rawDelta), observed = optionalUnits(rawObserved);
      const basis = cumulative !== null ? 'opening' : previous !== null ? 'adjacent' : null;
      const before = cumulative ?? previous;
      const expected = before === null || delta === null ? null : before + delta;
      const comparison = delta === null ? insufficient('delta-unavailable', null, observed)
        : expected === null ? insufficient(sawEntry ? 'previous-balance-unavailable' : 'opening-unconfirmed', null, observed)
        : observed === null ? insufficient('recorded-balance-unavailable', expected)
        : compare(expected, observed);
      // A wrong recorded balance cannot replace the expected chain from a verified opening.
      cumulative = cumulative === null || delta === null ? null : cumulative + delta;
      previous = observed;
      checks.push({ source, sequence, basis, ...comparison });
    }
    sawEntry = true;
  }
  return { opening, checks };
}

/** Check only the saved source reference for this formed response. Server formation does not imply delivery. */
export function checkAuditAttemptBalance(attempt: AuditAttempt, snapshot: AuditBalanceSnapshot | null): AttemptBalanceCheck {
  if (attempt.response !== 'formed') return attemptGap('response-not-observed');
  const balance = attempt.balance;
  if (balance.state === 'absent') return attemptGap('response-balance-absent');
  if (balance.state === 'invalid') return attemptGap('response-balance-invalid');
  if (balance.state !== 'value') return attemptGap('response-balance-not-recorded');
  if (balance.snapshot === null) return attemptGap('snapshot-unassociated');
  if (snapshot === null) return attemptGap('snapshot-unavailable');
  if (auditSourceKey(snapshot.source) !== auditSourceKey(balance.snapshot) ||
    !sameScope(snapshot.scope, attempt.scope) || snapshot.accountId !== attempt.accountId ||
    !sameAsset(snapshot.asset, balance.asset)) return attemptGap('snapshot-context-mismatch');

  const scale = Math.max(balance.asset.scale, snapshot.asset.scale);
  const expected = units(snapshot.units) * 10n ** BigInt(scale - snapshot.asset.scale);
  const observed = units(balance.units) * 10n ** BigInt(scale - balance.asset.scale);
  return { asset: { ...balance.asset, scale }, ...compare(expected, observed) };
}

function usesVirtualAvailableBalance(attempt: AuditAttempt): boolean {
  if (!attempt.operationId || attempt.decision === 'rejected') return false;
  if (attempt.transport === 'websocket') return attempt.route === 'pvp' && attempt.statusCode === null;
  return attempt.transport === 'http' && virtualHttpRoutes.has(attempt.route) && attempt.statusCode !== null &&
    attempt.statusCode >= 200 && attempt.statusCode < 300;
}

/** Resolve the independently captured wallet head in the attempt's dataset. */
export async function reconcileStoredAuditAttempt(
  attempt: AuditAttempt, reader: BalancePostingReader,
): Promise<AttemptBalanceCheck> {
  const balance = attempt.balance;
  if (attempt.response !== 'formed' || balance.state !== 'value' || balance.snapshot === null) {
    return checkAuditAttemptBalance(attempt, null);
  }
  if (!usesVirtualAvailableBalance(attempt) || balance.asset.contour !== 'virtual' || balance.asset.code !== 'VIRTUAL_USD') {
    return attemptGap('snapshot-route-unsupported');
  }
  const source = balance.snapshot;
  if (!/^[a-z_][a-z0-9_]{0,62}\.demo_ledger$/.test(source.namespace) ||
    !/^[1-9][0-9]{0,18}$/.test(source.rowId) || BigInt(source.rowId) > 9223372036854775807n) {
    return attemptGap('snapshot-source-unsupported');
  }
  const found = await reader.read(attempt.scope.datasetId, source);
  if (found.status !== 'found') return attemptGap(found.status);
  const posting = found.posting;
  if (posting.asset.scale !== 2 || !sameAsset(posting.asset, balance.asset) ||
    posting.accountId !== attempt.accountId || !sameScope(posting.scope, attempt.scope) ||
    auditSourceKey(posting.source) !== auditSourceKey(source)) return attemptGap('snapshot-context-mismatch');
  if (posting.availableAfterUnits === null) return attemptGap('recorded-balance-unavailable');
  return checkAuditAttemptBalance(attempt, { source: posting.source, scope: posting.scope,
    accountId: posting.accountId, asset: posting.asset, units: posting.availableAfterUnits });
}

/** Include all debit buckets for one operation at one asset scale. Explicit null means the pending leg is unknown. */
export function checkAuditStakeDirection(
  posting: Pick<AuditPosting, 'movement' | 'availableDeltaUnits'>, pendingDeltaUnits: string | null = '0',
): { status: 'match' | 'mismatch'; deltaUnits: string } | { status: 'not-applicable' | 'insufficient-data' } {
  if (posting.movement !== 'stake' && posting.movement !== 'paid-option' && posting.movement !== 'reserve') {
    return { status: 'not-applicable' };
  }
  if (pendingDeltaUnits === null) return { status: 'insufficient-data' };
  const delta = units(posting.availableDeltaUnits) + units(pendingDeltaUnits);
  return { status: delta < 0n ? 'match' : 'mismatch', deltaUnits: delta.toString() };
}
