import { isDeepStrictEqual } from 'node:util';
import { applySchemaMigration } from '../database-migrations';
import type { PostgresDatabase } from '../database';
import type { AuditScope, AuditSourceRef } from './contract';
import {
  inspectReplayFragment, inspectReplayManifest, isReplayId, isReplayScope, verifyReplayPackage,
  type ReplayDefinition, type ReplayVerification,
} from './replay-package';

export async function migrateAuditReplayPackages(db: PostgresDatabase) {
  await applySchemaMigration(db, { id: 'paid-activity-audit-replay-packages-v1', statements: [
    `CREATE TABLE audit_replay_packages (
      dataset_id uuid NOT NULL REFERENCES audit_datasets(id), replay_id uuid NOT NULL,
      manifest jsonb NOT NULL CHECK (octet_length(manifest::text) <= 131072),
      PRIMARY KEY(dataset_id,replay_id)
    )`,
    `CREATE TABLE audit_replay_fragments (
      dataset_id uuid NOT NULL, replay_id uuid NOT NULL, ordinal smallint NOT NULL CHECK (ordinal BETWEEN 0 AND 127),
      fragment jsonb NOT NULL CHECK (octet_length(fragment::text) <= 524288),
      PRIMARY KEY(dataset_id,replay_id,ordinal),
      FOREIGN KEY(dataset_id,replay_id) REFERENCES audit_replay_packages(dataset_id,replay_id)
    )`,
  ] });
}

type WriteResult = 'recorded' | 'replayed' | 'conflict' | 'corrupt' | 'unsupported' | 'too-large'
  | 'dataset-unavailable' | 'manifest-unavailable' | 'posting-not-captured';

function sameIdentity(manifest: { scope: AuditScope; replayId: string }, scope: AuditScope, replayId: string): boolean {
  return manifest.scope.datasetId === scope.datasetId && manifest.scope.environment === scope.environment && manifest.replayId === replayId;
}

/** An audit-only writer. The dataset lock participates in the same boundary as audit sealing. */
export class AuditReplayStore {
  constructor(private readonly db: PostgresDatabase) {}

  private async dataset(scope: AuditScope, writing = false) {
    const row = await this.db.prepare(`SELECT environment,sealed_at_ms FROM audit_datasets WHERE id=?${writing ? ' FOR SHARE' : ''}`)
      .get(scope.datasetId);
    return row?.environment === scope.environment ? row : null;
  }

  private async manifest(scope: AuditScope, replayId: string) {
    return this.db.prepare('SELECT manifest FROM audit_replay_packages WHERE dataset_id=? AND replay_id=?')
      .get(scope.datasetId, replayId);
  }

  private async postingLinksCaptured(scope: AuditScope, postings: AuditSourceRef[]) {
    if (!postings.length) return true;
    const refs = [...new Map(postings.map(ref => [ref.namespace + '/' + ref.rowId, ref])).values()];
    const row = await this.db.prepare(`SELECT NOT EXISTS (
      SELECT 1 FROM jsonb_to_recordset(?::jsonb) p(namespace text,"rowId" text)
      WHERE NOT EXISTS (SELECT 1 FROM audit_posting_refs r WHERE r.dataset_id=?
        AND r.source_namespace=p.namespace AND r.source_row_id=p."rowId"::bigint)
    ) AS captured`).get(JSON.stringify(refs), scope.datasetId);
    return row?.captured === true;
  }

  async writeManifest(input: unknown): Promise<WriteResult> {
    const inspected = inspectReplayManifest(input);
    if (inspected.status !== 'verified') return inspected.status;
    const manifest = structuredClone(inspected.value);
    const { scope, replayId } = manifest;
    return this.db.transaction<WriteResult>(async () => {
      const dataset = await this.dataset(scope, true);
      if (!dataset) return 'dataset-unavailable';
      const previous = await this.manifest(scope, replayId);
      if (previous) return isDeepStrictEqual(previous.manifest, manifest) ? 'replayed' : 'conflict';
      if (dataset.sealed_at_ms !== null) return 'dataset-unavailable';
      await this.db.prepare('INSERT INTO audit_replay_packages(dataset_id,replay_id,manifest) VALUES (?,?,?::jsonb)')
        .run(scope.datasetId, replayId, JSON.stringify(manifest));
      return 'recorded';
    }, { lockKey: 'paid-audit-replay:' + scope.datasetId + ':' + replayId });
  }

  async writeFragment(scope: AuditScope, replayId: string, input: unknown): Promise<WriteResult> {
    if (!isReplayScope(scope) || !isReplayId(replayId)) return 'corrupt';
    scope = { ...scope };
    return this.db.transaction<WriteResult>(async () => {
      const dataset = await this.dataset(scope, true);
      if (!dataset) return 'dataset-unavailable';
      const row = await this.manifest(scope, replayId);
      if (!row) return 'manifest-unavailable';
      const header = inspectReplayManifest(row.manifest);
      if (header.status !== 'verified') return header.status;
      if (!sameIdentity(header.value, scope, replayId)) return 'corrupt';
      const inspected = inspectReplayFragment(header.value, input);
      if (inspected.status !== 'verified') return inspected.status;
      const fragment = structuredClone(inspected.value);
      const { index } = fragment;
      const payload = JSON.stringify(fragment);
      const previous = await this.db.prepare('SELECT fragment FROM audit_replay_fragments WHERE dataset_id=? AND replay_id=? AND ordinal=?')
        .get(scope.datasetId, replayId, index);
      if (previous) return isDeepStrictEqual(previous.fragment, fragment) ? 'replayed' : 'conflict';
      if (dataset.sealed_at_ms !== null) return 'dataset-unavailable';
      if (!await this.postingLinksCaptured(scope, fragment.events.flatMap(event => event.postings))) return 'posting-not-captured';
      await this.db.prepare('INSERT INTO audit_replay_fragments(dataset_id,replay_id,ordinal,fragment) VALUES (?,?,?,?::jsonb)')
        .run(scope.datasetId, replayId, index, payload);
      return 'recorded';
    }, { lockKey: 'paid-audit-replay:' + scope.datasetId + ':' + replayId });
  }

  async read(scope: AuditScope, replayId: string, supported?: readonly ReplayDefinition[]): Promise<ReplayVerification | { status: 'not-found' }> {
    if (!isReplayScope(scope) || !isReplayId(replayId)) return { status: 'not-found' };
    scope = { ...scope };
    return this.db.transaction(async () => {
      if (!await this.dataset(scope)) return { status: 'not-found' };
      const row = await this.manifest(scope, replayId);
      if (!row) return { status: 'not-found' };
      const header = inspectReplayManifest(row.manifest);
      if (header.status !== 'verified') return header;
      if (!sameIdentity(header.value, scope, replayId)) return { status: 'corrupt' };
      const sizes = header.value.fragments.map(ref => ref.byteLength * 2);
      const fragments = await this.db.prepare(`SELECT ordinal,CASE WHEN octet_length(fragment::text)<=(?::int[])[ordinal+1]
        THEN fragment ELSE NULL END AS fragment FROM audit_replay_fragments
        WHERE dataset_id=? AND replay_id=? ORDER BY ordinal LIMIT ?`)
        .all(sizes, scope.datasetId, replayId, sizes.length + 1);
      if (fragments.some(row => row.ordinal !== row.fragment?.index)) return { status: 'corrupt' };
      return verifyReplayPackage({ manifest: header.value, fragments: fragments.map(row => row.fragment) }, supported);
    }, { readOnly: true });
  }
}
