import { isDeepStrictEqual } from 'node:util';
import type { PostgresDatabase } from '../database';
import { applySchemaMigration } from '../database-migrations';
import { auditSourceKey, isAuditRecord, type AuditEntityRef, type AuditScope } from './contract';
import type { AuditPostingReader } from './postings';
import { isReplayId } from './replay-package';
import { AuditReplayStore } from './replay-store';
import { casinoRiskReplayPostings, riskReplaySequence, riskReplayWithinBudget, toteRiskReplayProofs } from './risk-replay-links';
import type { AuditRiskCandidate } from './risk-selection';
import {
  evaluateAuditRiskRule, isRiskActorId, isRiskScope, isRiskSignalKey, riskAssetKey, riskEntityKey, riskEvidenceKey,
  type AuditRiskEvidence, type AuditRiskSignal,
} from './risk-rules';

const maximumPayloadBytes = 1_048_576;
const maximumReplayLinks = 96;
const maximumReplayLinkBytes = 65_536;
type ReplayLink = NonNullable<AuditRiskCandidate['replayLinks']>[number];
type ReplayLinks = { version: 1; links: ReplayLink[] };
const reviewDecisions = ['explained', 'escalated', 'dismissed'] as const;
type ReviewDecision = (typeof reviewDecisions)[number];
type Review = { revision: number; reviewerId: string; decision: ReviewDecision; reviewedAtMs: number };

export type StoredAuditRiskSignal = {
  signal: AuditRiskSignal;
  revision: number;
  review: Review | null;
  reviewAppliesToCurrent: boolean;
  replayLinks?: ReplayLink[];
};

export async function migrateAuditRiskSignals(db: PostgresDatabase) {
  await applySchemaMigration(db, { id: 'paid-activity-audit-risk-signals-v1', statements: [
    `CREATE TABLE audit_risk_rules (
      rule_id text NOT NULL, rule_version text NOT NULL, definition jsonb NOT NULL,
      PRIMARY KEY(rule_id,rule_version)
    )`,
    `CREATE TABLE audit_risk_signals (
      dataset_id uuid NOT NULL REFERENCES audit_datasets(id), signal_key text NOT NULL CHECK(signal_key ~ '^[0-9a-f]{64}$'),
      rule_id text NOT NULL, rule_version text NOT NULL, as_of_ms bigint NOT NULL CHECK(as_of_ms>=0),
      revision bigint NOT NULL CHECK(revision BETWEEN 1 AND ${Number.MAX_SAFE_INTEGER}),
      status text NOT NULL CHECK(status IN ('observed','clear','insufficient-data')),
      signal jsonb NOT NULL CHECK(octet_length(signal::text)<=${maximumPayloadBytes * 2}), review jsonb,
      PRIMARY KEY(dataset_id,signal_key),
      FOREIGN KEY(rule_id,rule_version) REFERENCES audit_risk_rules(rule_id,rule_version)
    )`,
  ] });
  await applySchemaMigration(db, { id: 'paid-activity-audit-risk-replay-links-v1', statements: [
    `ALTER TABLE audit_risk_signals ADD COLUMN replay_links jsonb NOT NULL DEFAULT '{"version":1,"links":[]}'::jsonb
      CHECK (jsonb_typeof(replay_links)='object' AND octet_length(replay_links::text)<=${maximumReplayLinkBytes})`,
  ] });
}

function checkSignal(value: AuditRiskSignal): AuditRiskSignal {
  if (!value || typeof value !== 'object') throw new Error('Invalid audit risk signal');
  const computed = evaluateAuditRiskRule(value.rule, value.input);
  if (!isDeepStrictEqual(value, computed) || Buffer.byteLength(JSON.stringify(computed)) > maximumPayloadBytes) {
    throw new Error('Invalid audit risk signal');
  }
  return computed;
}

const positiveRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

function exactFields(value: unknown, fields: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function subjectProofs(signal: AuditRiskSignal) {
  const accounts = new Set(signal.input.subject.accountIds);
  const entities = new Map<string, { entity: AuditEntityRef; accountId: string; postings: Set<string>;
    tickets: ReturnType<typeof toteRiskReplayProofs> }>();
  const casinoPostings = new Map<string, ReturnType<typeof casinoRiskReplayPostings>[number]>();
  for (const row of signal.input.observations) {
    const { entity, primary, supporting } = row;
    if (!primary.accountId || !accounts.has(primary.accountId)) continue;
    for (const posting of casinoRiskReplayPostings(row)) casinoPostings.set(auditSourceKey(posting.source), posting);
    if (!entity) continue;
    const key = auditSourceKey(entity.source);
    const proof = entities.get(key) ?? { entity, accountId: primary.accountId, postings: new Set<string>(), tickets: [] };
    for (const ref of [primary, ...supporting]) if (ref.kind === 'posting') proof.postings.add(auditSourceKey(ref.source));
    proof.tickets.push(...toteRiskReplayProofs(row, accounts));
    entities.set(key, proof);
  }
  return { entities, casinoPostings };
}

function eligibleReplaySource({ entities, casinoPostings }: ReturnType<typeof subjectProofs>, source: ReplayLink['source']) {
  const key = auditSourceKey(source);
  return !!entities.get(key)?.postings.size || casinoPostings.has(key);
}

export function subjectRiskReplayLinks(signal: AuditRiskSignal, links: ReplayLink[]) {
  if (!links.length) return links;
  const eligible = subjectProofs(signal);
  return links.filter(link => eligibleReplaySource(eligible, link.source));
}

function checkedReplayLinks(signal: AuditRiskSignal, input: unknown): ReplayLinks {
  if (!exactFields(input, ['version', 'links']) || input.version !== 1 || !Array.isArray(input.links) ||
      input.links.length > maximumReplayLinks) throw new Error('Invalid audit risk replay links');
  const eligible = subjectProofs(signal);
  const unique = new Set<string>();
  const links: ReplayLink[] = [];
  for (const link of input.links) {
    if (!exactFields(link, ['replayId', 'sequence', 'source']) || !isReplayId(link.replayId) ||
        !positiveRevision(link.sequence) || !exactFields(link.source, ['namespace', 'rowId']) ||
        typeof link.source.namespace !== 'string' || typeof link.source.rowId !== 'string') {
      throw new Error('Invalid audit risk replay link');
    }
    const source = { namespace: link.source.namespace, rowId: link.source.rowId }, key = link.replayId + ':' + link.sequence;
    if (!eligibleReplaySource(eligible, source) || unique.has(key)) {
      throw new Error('Audit risk replay link outside subject evidence');
    }
    unique.add(key);
    links.push({ replayId: link.replayId, sequence: link.sequence, source });
  }
  links.sort((a, b) => (a.replayId < b.replayId ? -1 : a.replayId > b.replayId ? 1 : a.sequence - b.sequence));
  return { version: 1, links };
}

function replayEntityId(entity: AuditEntityRef, accountId: string): string | null {
  if (entity.category !== 'casino') return entity.source.rowId;
  try {
    const key: unknown = JSON.parse(entity.source.rowId);
    return Array.isArray(key) && key.length === 2 && key[0] === accountId && typeof key[1] === 'string' ? key[1] : null;
  } catch { return null; }
}

function stored(signal: AuditRiskSignal, revision: number, review: Review | null, attachment: unknown,
  omitInvalidReplayLinks = false): StoredAuditRiskSignal {
  if (!positiveRevision(revision) || (review !== null && (!positiveRevision(review.revision) || review.revision > revision ||
      !isRiskActorId(review.reviewerId) || !reviewDecisions.includes(review.decision) ||
      !Number.isSafeInteger(review.reviewedAtMs) || review.reviewedAtMs < 0))) {
    throw new Error('Invalid stored audit risk revision or review');
  }
  let links: ReplayLink[] = [];
  try {
    ({ links } = checkedReplayLinks(signal, attachment));
  } catch (error) {
    if (!omitInvalidReplayLinks) throw error;
  }
  return { signal, revision, review, reviewAppliesToCurrent: review !== null && review.revision === revision,
    ...(links.length ? { replayLinks: links } : {}) };
}

function unchanged(previous: AuditRiskSignal, candidate: AuditRiskSignal) {
  return isDeepStrictEqual(previous, { ...candidate, input: { ...candidate.input, asOfMs: previous.input.asOfMs } });
}

type RiskRow = { signal: AuditRiskSignal; revision: number; review: Review | null; replay_links: unknown };
type RecordedEvidence = {
  accountId: string | null;
  operationId: string | null;
  occurredAtMs: number;
  entityKey: string | null;
};

/** Persists derived review signals in the audit schema, without modifying source records. */
export class AuditRiskSignals {
  constructor(private readonly db: PostgresDatabase, private readonly postings?: Pick<AuditPostingReader, 'read'>) {}

  private row(scope: AuditScope, key: string) {
    return this.db.prepare(`SELECT s.signal,s.revision,s.review,s.replay_links FROM audit_risk_signals s
      JOIN audit_datasets d ON d.id=s.dataset_id
      WHERE s.dataset_id=? AND s.signal_key=? AND d.environment=?`)
      .get(scope.datasetId, key, scope.environment) as Promise<RiskRow | undefined>;
  }

  async read(scope: AuditScope, key: string, options?: { omitInvalidReplayLinks?: boolean }): Promise<StoredAuditRiskSignal | null> {
    if (!isRiskScope(scope) || !isRiskSignalKey(key)) return null;
    const row = await this.row(scope, key);
    if (!row) return null;
    const signal = checkSignal(row.signal);
    if (signal.key !== key || signal.input.scope.datasetId !== scope.datasetId || signal.input.scope.environment !== scope.environment) {
      throw new Error('Audit risk signal scope mismatch');
    }
    return stored(signal, row.revision, row.review, row.replay_links, options?.omitInvalidReplayLinks);
  }

  private async validateEvidence(signal: AuditRiskSignal) {
    const { scope, observations } = signal.input;
    const refs = new Map<string, AuditRiskEvidence>();
    for (const { primary, supporting } of observations) {
      for (const ref of [primary, ...supporting]) {
        const key = riskEvidenceKey(ref), previous = refs.get(key);
        if (previous && !isDeepStrictEqual(previous, ref)) throw new Error('Conflicting audit risk evidence references');
        refs.set(key, ref);
      }
    }
    const actual = new Map<string, RecordedEvidence>();
    const recorded = [...refs.values()].filter(ref => ref.kind !== 'posting');
    if (recorded.length) {
      const rows = await this.db.prepare(`SELECT e.kind,e.evidence_id,e.account_id,e.occurred_at_ms,e.payload
        FROM jsonb_to_recordset(?::jsonb) r(kind text,id text) JOIN audit_evidence e
          ON e.dataset_id=? AND e.kind=r.kind AND e.evidence_id=r.id`)
        .all(JSON.stringify(recorded.map(({ kind, id }) => ({ kind, id }))), scope.datasetId);
      for (const row of rows) {
        const value: unknown = row.payload;
        if (!isAuditRecord(value) || value.type === 'posting' || value.type !== row.kind ||
            value.scope.datasetId !== scope.datasetId || value.scope.environment !== scope.environment) continue;
        const id = value.type === 'attempt' ? value.attemptId : value.type === 'event' ? value.eventId : value.replayId;
        const accountId = value.type === 'replay' ? null : value.accountId;
        const operationId = value.type === 'replay' ? null : value.operationId;
        if (id !== row.evidence_id || accountId !== row.account_id || value.occurredAtMs !== row.occurred_at_ms) continue;
        const reference = { kind: value.type, id, accountId, operationId, occurredAtMs: value.occurredAtMs };
        actual.set(riskEvidenceKey(reference), { accountId, operationId, occurredAtMs: value.occurredAtMs,
          entityKey: riskEntityKey(value.entity) });
      }
    }
    const captured = [...refs.values()].filter(ref => ref.kind === 'posting');
    if (captured.length) {
      const rows = await this.db.prepare(`SELECT p.source_namespace,p.source_row_id::text AS id,p.account_id,p.operation_id,p.occurred_at_ms
        FROM jsonb_to_recordset(?::jsonb) r(namespace text,"rowId" text) JOIN audit_posting_refs p
          ON p.dataset_id=? AND p.source_namespace=r.namespace AND p.source_row_id=r."rowId"::bigint`)
        .all(JSON.stringify(captured.map(ref => ref.source)), scope.datasetId);
      for (const row of rows) {
        const reference = { kind: 'posting' as const, source: { namespace: row.source_namespace, rowId: row.id },
          accountId: row.account_id, operationId: row.operation_id, occurredAtMs: row.occurred_at_ms };
        actual.set(riskEvidenceKey(reference), { ...reference, entityKey: null });
      }
    }
    for (const [key, ref] of refs) {
      const row = actual.get(key);
      if (!row || row.accountId !== ref.accountId || row.operationId !== ref.operationId || row.occurredAtMs !== ref.occurredAtMs) {
        throw new Error('Audit risk evidence unavailable or out of scope');
      }
    }
    for (const { primary, entity, asset, value } of observations) {
      if (primary.kind === 'posting' && (entity || asset)) {
        const resolved = await this.postings?.read(scope.datasetId, primary.source);
        if (resolved?.status !== 'found' || resolved.posting.scope.datasetId !== scope.datasetId ||
          resolved.posting.scope.environment !== scope.environment || resolved.posting.accountId !== primary.accountId ||
          resolved.posting.operationId !== primary.operationId || resolved.posting.occurredAtMs !== primary.occurredAtMs ||
          (entity && riskEntityKey(resolved.posting.entity) !== riskEntityKey(entity)) ||
          (asset && riskAssetKey(resolved.posting.asset) !== riskAssetKey(asset))) {
          throw new Error('Audit risk posting context unavailable or out of scope');
        }
        if (signal.rule.metric === 'mean-units' && resolved.posting.availableDeltaUnits.replace(/^-/, '') !== value.numerator) {
          throw new Error('Audit risk amount does not match the canonical posting');
        }
      } else if (entity && actual.get(riskEvidenceKey(primary))?.entityKey !== riskEntityKey(entity)) {
        throw new Error('Audit risk evidence entity does not match');
      }
    }
  }

  private async validateReplayLinks(signal: AuditRiskSignal, links: ReplayLink[]) {
    if (!links.length) return;
    const eligible = subjectProofs(signal), scope = signal.input.scope;
    const store = new AuditReplayStore(this.db);
    const packs = new Map<string, Awaited<ReturnType<AuditReplayStore['read']>>>();
    for (const link of links) {
      let replay = packs.get(link.replayId);
      if (!replay) {
        const header = await this.db.prepare(`SELECT manifest FROM audit_replay_packages WHERE dataset_id=? AND replay_id=?
          AND octet_length(manifest::text)<=65536`).get(scope.datasetId, link.replayId);
        if (!riskReplayWithinBudget(header?.manifest)) {
          throw new Error('Audit risk replay unavailable or outside budget');
        }
        replay = await store.read(scope, link.replayId);
        packs.set(link.replayId, replay);
      }
      if (replay.status !== 'verified') throw new Error('Audit risk replay unavailable');
      const { manifest, fragments } = replay.value, game = manifest.game;
      const sourceKey = auditSourceKey(link.source);
      const casinoPosting = eligible.casinoPostings.get(sourceKey);
      if (casinoPosting) {
        const resolved = await this.postings?.read(scope.datasetId, casinoPosting.source);
        const entity = resolved?.status === 'found' ? resolved.posting.entity : null;
        if (resolved?.status !== 'found' || resolved.posting.scope.datasetId !== scope.datasetId ||
            resolved.posting.scope.environment !== scope.environment || resolved.posting.accountId !== casinoPosting.accountId ||
            resolved.posting.operationId !== casinoPosting.operationId || resolved.posting.occurredAtMs !== casinoPosting.occurredAtMs ||
            entity?.category !== 'casino' || riskReplaySequence({ entity, posting: casinoPosting }, replay.value) !== link.sequence) {
          throw new Error('Audit risk casino replay does not match subject posting or event');
        }
        continue;
      }
      const { entity, accountId, postings, tickets } = eligible.entities.get(sourceKey)!;
      if (entity.category === 'totalizator') {
        if (!tickets.some(ticket => riskReplaySequence(ticket, replay.value) === link.sequence)) {
          throw new Error('Audit risk tote replay does not match subject ticket or event');
        }
        continue;
      }
      if (manifest.entityId !== replayEntityId(entity, accountId) || game.category !== entity.category ||
          game.gameId !== entity.gameId || game.modeId !== entity.modeId ||
          entity.rulesVersion !== null && game.rulesVersion !== entity.rulesVersion ||
          !fragments.some(part => part.events.some(event => event.sequence === link.sequence)) ||
          !fragments.some(part => part.events.some(event => event.postings.some(ref => postings.has(auditSourceKey(ref)))))) {
        throw new Error('Audit risk replay does not match subject evidence or event');
      }
    }
  }

  async record(value: AuditRiskSignal, replayLinks?: ReplayLink[]): Promise<StoredAuditRiskSignal | null> {
    const signal = checkSignal(value);
    const { input, key, rule, status } = signal, { scope, asOfMs } = input;
    const supplied = replayLinks === undefined ? undefined : checkedReplayLinks(signal, { version: 1, links: replayLinks });
    return this.db.transaction(async () => {
      const dataset = await this.db.prepare('SELECT environment,started_at_ms,sealed_at_ms FROM audit_datasets WHERE id=? FOR SHARE')
        .get(scope.datasetId);
      if (!dataset || dataset.environment !== scope.environment || input.toMs <= dataset.started_at_ms ||
          (dataset.sealed_at_ms !== null && input.fromMs >= dataset.sealed_at_ms)) {
        throw new Error('Audit risk dataset or window unavailable');
      }
      if ((input.fromMs < dataset.started_at_ms || (dataset.sealed_at_ms !== null && input.toMs > dataset.sealed_at_ms)) &&
          (input.completeness.subject || input.completeness.comparison)) {
        throw new Error('Audit risk window crosses the dataset boundary');
      }
      const previous = await this.row(scope, key);
      if (previous && !isDeepStrictEqual(previous.signal.rule, rule)) throw new Error('Audit risk rule version changed');
      const prior = previous && stored(previous.signal, previous.revision, previous.review, previous.replay_links);
      if (previous && asOfMs < previous.signal.input.asOfMs) return prior!;
      const sameFacts = previous ? unchanged(previous.signal, signal) : false;
      const attachment = supplied ?? { version: 1, links: sameFacts ? prior?.replayLinks ?? [] : [] };
      const sameLinks = isDeepStrictEqual(attachment.links, prior?.replayLinks ?? []);
      if (previous && asOfMs === previous.signal.input.asOfMs) {
        if (!sameFacts) throw new Error('Conflicting audit risk evaluation at the same observation time');
        if (sameLinks) return prior!;
      }
      await this.validateEvidence(signal);
      if (!sameLinks || !sameFacts) await this.validateReplayLinks(signal, attachment.links);
      const definition = JSON.stringify(rule);
      const findDefinition = () => this.db.prepare(`SELECT definition=?::jsonb AS matches FROM audit_risk_rules
        WHERE rule_id=? AND rule_version=?`).get(definition, rule.id, rule.version);
      if (!previous && status === 'clear') {
        const registered = await findDefinition();
        if (registered && registered.matches !== true) throw new Error('Audit risk rule version changed');
        return null;
      }
      await this.db.prepare(`INSERT INTO audit_risk_rules(rule_id,rule_version,definition) VALUES (?,?,?::jsonb)
        ON CONFLICT DO NOTHING`).run(rule.id, rule.version, definition);
      const registered = await findDefinition();
      if (registered?.matches !== true) throw new Error('Audit risk rule version changed');
      const revision = previous ? previous.revision + (sameFacts ? 0 : 1) : 1;
      await this.db.prepare(`INSERT INTO audit_risk_signals(dataset_id,signal_key,rule_id,rule_version,as_of_ms,revision,status,signal,replay_links)
        VALUES (?,?,?,?,?,?,?,?::jsonb,?::jsonb) ON CONFLICT (dataset_id,signal_key) DO UPDATE
        SET as_of_ms=excluded.as_of_ms,revision=excluded.revision,status=excluded.status,signal=excluded.signal,replay_links=excluded.replay_links`)
        .run(scope.datasetId, key, rule.id, rule.version, asOfMs, revision, status, JSON.stringify(signal), JSON.stringify(attachment));
      return stored(signal, revision, previous?.review ?? null, attachment);
    }, { lockKey: 'paid-audit-risk:' + scope.datasetId + ':' + key });
  }

  async review(scope: AuditScope, key: string, input: {
    expectedRevision: number; reviewerId: string; decision: ReviewDecision;
  }): Promise<StoredAuditRiskSignal | null> {
    if (!isRiskScope(scope) || !isRiskSignalKey(key) || !input ||
      !positiveRevision(input.expectedRevision) || !isRiskActorId(input.reviewerId) || !reviewDecisions.includes(input.decision)) {
      throw new Error('Invalid audit risk review');
    }
    const { expectedRevision, reviewerId, decision } = input;
    return this.db.transaction(async () => {
      const row = await this.row(scope, key);
      if (!row) return null;
      if (row.revision !== expectedRevision || row.signal.status === 'clear') throw new Error('Audit risk review requires current finding');
      if (row.review?.revision === row.revision && row.review.reviewerId === reviewerId && row.review.decision === decision) {
        return stored(row.signal, row.revision, row.review, row.replay_links);
      }
      const review = { revision: row.revision, reviewerId, decision, reviewedAtMs: Date.now() };
      await this.db.prepare('UPDATE audit_risk_signals SET review=?::jsonb WHERE dataset_id=? AND signal_key=?')
        .run(JSON.stringify(review), scope.datasetId, key);
      return stored(row.signal, row.revision, review, row.replay_links);
    }, { lockKey: 'paid-audit-risk:' + scope.datasetId + ':' + key });
  }
}
