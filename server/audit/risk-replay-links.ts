import type { PostgresDatabase } from '../database';
import { auditSourceKey, type AuditEntityRef, type AuditSourceRef } from './contract';
import { inspectReplayManifest, type ReplayPackage } from './replay-package';
import { AuditReplayStore } from './replay-store';
import type { AuditRiskEvidence, AuditRiskWindow } from './risk-rules';
import type { AuditRiskCandidate, AuditRiskSelection } from './risk-selection';

type Posting = Extract<AuditRiskEvidence, { kind: 'posting' }>;
type Observation = AuditRiskWindow['observations'][number];
type ReplayLink = NonNullable<AuditRiskCandidate['replayLinks']>[number];
type ReplayProof = { entity: AuditEntityRef; posting: Posting; ticket?: { id: string; admittedAtMs: number } };
const maxReplayEntities = 96;
const maxReplayPackages = 32;
const maxPackagesPerEntity = 3;

export function casinoRiskReplayPostings({ primary, supporting, entity }: Observation): Posting[] {
  if (entity && entity.category !== 'casino') return [];
  if (primary.kind === 'posting') return [primary];
  if (primary.kind !== 'attempt') return [];
  return supporting.filter((ref): ref is Posting => ref.kind === 'posting' && ref.accountId === primary.accountId);
}

export function toteRiskReplayProofs({ primary, supporting, entity }: Observation, subjects: Set<string>): ReplayProof[] {
  if (entity?.category !== 'totalizator' || entity.gameId !== 'flag-tote' || primary.kind !== 'event' ||
      primary.operationId !== entity.ticketId) return [];
  return [primary, ...supporting].flatMap(ref => {
    if (ref.kind !== 'event' || !ref.operationId || !ref.accountId || !subjects.has(ref.accountId)) return [];
    const posting = supporting.find((item): item is Posting => item.kind === 'posting' && item.accountId === ref.accountId &&
      item.operationId === entity.gameId + ':' + ref.operationId);
    return posting ? [{ entity, posting, ticket: { id: ref.operationId, admittedAtMs: ref.occurredAtMs } }] : [];
  });
}

function replayEntityId({ entity, posting }: ReplayProof): string | null {
  if (entity.category !== 'casino') return entity.source.rowId;
  try {
    const key: unknown = JSON.parse(entity.source.rowId);
    return Array.isArray(key) && key.length === 2 && key[0] === posting.accountId && typeof key[1] === 'string' ? key[1] : null;
  } catch {
    return null;
  }
}

export function riskReplayWithinBudget(input: unknown) {
  const manifest = inspectReplayManifest(input);
  return manifest.status === 'verified' &&
    manifest.value.fragments.reduce((sum, part) => sum + part.eventCount, 0) <= 512 &&
    manifest.value.fragments.reduce((sum, part) => sum + part.byteLength, 0) <= 256 * 1024;
}

export function riskReplaySequence(proof: ReplayProof, replay: ReplayPackage): number | undefined {
  const { entity, posting, ticket } = proof, { manifest, fragments } = replay, { game } = manifest;
  if (manifest.entityId !== replayEntityId(proof) || game.category !== entity.category || game.gameId !== entity.gameId ||
      game.modeId !== entity.modeId || game.rulesVersion !== entity.rulesVersion) return;
  const key = auditSourceKey(posting.source);
  const events = fragments.flatMap(fragment => fragment.events).filter(event =>
    event.money?.some(leg => auditSourceKey(leg.posting) === key) &&
    (entity.category === 'casino' ? manifest.formatVersion === 2 && game.replayProfile === 'casino-steps' :
      manifest.formatVersion === 3 && game.replayProfile === 'pool-steps' && ticket && event.pool?.kind === 'ticket' &&
      !event.pool.opening && event.pool.ticketId === ticket.id && event.pool.admittedAtMs === ticket.admittedAtMs));
  return events.length === 1 ? events[0].sequence : undefined;
}

const proofKey = ({ entity, posting, ticket }: ReplayProof) =>
  JSON.stringify([auditSourceKey(entity.source), auditSourceKey(posting.source), ticket]);

/** Links are optional enrichment. Privileges, read budgets and evidence gaps never change rule observations. */
export async function attachRiskReplayJumps(audit: PostgresDatabase, selection: AuditRiskSelection,
  plans: { candidate: AuditRiskCandidate; proofs: ReplayProof[] }[]) {
  const byEntity = new Map<string, Map<string, ReplayProof>>();
  for (const { proofs } of plans) for (const proof of proofs) {
    const id = replayEntityId(proof);
    if (!id) continue;
    const existing = byEntity.get(id);
    if (existing) existing.set(proofKey(proof), proof);
    else if (byEntity.size < maxReplayEntities) byEntity.set(id, new Map([[proofKey(proof), proof]]));
  }
  if (!byEntity.size) return;
  const privileges = await audit.prepare(`SELECT bool_and(coalesce(pg_catalog.has_table_privilege(
      pg_catalog.to_regclass(name), 'SELECT'), false)) AS allowed FROM unnest(?::text[]) tables(name)`)
    .get(['audit_replay_packages', 'audit_replay_fragments'].map(table => audit.schema + '.' + table));
  if (privileges?.allowed !== true) return;

  const rows = await audit.prepare(`SELECT ids.entity_id,p.replay_id::text,
      CASE WHEN octet_length(p.manifest::text)<=65536 THEN p.manifest END AS manifest
    FROM unnest(?::text[]) WITH ORDINALITY ids(entity_id,position)
    CROSS JOIN LATERAL (SELECT replay_id,manifest,row_number() OVER (ORDER BY replay_id) AS preference
      FROM audit_replay_packages WHERE dataset_id=? AND manifest->>'entityId'=ids.entity_id ORDER BY replay_id LIMIT ?) p
    ORDER BY p.preference,ids.position LIMIT ?`).all([...byEntity.keys()], selection.scope.datasetId,
      maxPackagesPerEntity, maxReplayPackages);

  const store = new AuditReplayStore(audit);
  const matches = new Map<string, { complete: boolean; link: ReplayLink }>();
  for (const row of rows) {
    selection.signal?.throwIfAborted();
    if (!riskReplayWithinBudget(row.manifest)) continue;
    const replay = await store.read(selection.scope, row.replay_id);
    if (replay.status !== 'verified') continue;
    const complete = replay.value.manifest.coverage === 'complete';
    for (const [key, proof] of byEntity.get(row.entity_id) ?? []) {
      const previous = matches.get(key);
      if (previous && (previous.complete || !complete)) continue;
      const sequence = riskReplaySequence(proof, replay.value);
      if (sequence === undefined) continue;
      const source = proof.entity.category === 'casino' ? proof.posting.source : proof.entity.source;
      matches.set(key, { complete, link: { replayId: row.replay_id, sequence, source } });
    }
  }
  for (const { candidate, proofs } of plans) {
    const links = new Map<string, ReplayLink>();
    for (const proof of proofs) {
      const match = matches.get(proofKey(proof));
      if (match) links.set(match.link.replayId + ':' + match.link.sequence, match.link);
    }
    if (links.size) candidate.replayLinks = [...links.values()].slice(0, 96);
  }
}
