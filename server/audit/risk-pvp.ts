import { identifier, type PostgresDatabase } from '../database';
import { reconcileStoredPvpMatch } from './check-pvp';
import type { AuditAsset, AuditEntityRef } from './contract';
import { chessTurnReplayDefinition, verifyChessTurnReplay } from './replay-pvp-turn';
import { inspectReplayManifest } from './replay-package';
import { AuditReplayStore } from './replay-store';
import { type AuditRiskEvidence, type AuditRiskRule } from './risk-rules';
import { RISK_WINDOW_MS, riskAccounts, riskCandidate, riskSourceBoundaries,
  type AuditRiskCandidate, type AuditRiskSelection } from './risk-selection';

const asset = { contour: 'virtual', code: 'VIRTUAL_USD', scale: 2 } as const satisfies AuditAsset;
const scanPerAccount = 128;
const anchorsPerCohort = 48;
const maxSegments = 23; // Four rules per segment, leaving four report slots for truncation.
const maxPostingsPerMatch = 8;
const maxReplayEvents = 512;
const maxReplayBytes = 256 * 1024;
const fastResignationMs = 10_000;
const fastResponseMs = 700;
const holdOperation = /^pvp:([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}):hold$/;

const rule = (id: string, absolute: AuditRiskRule['threshold']['absolute'],
  comparisonMultiple: AuditRiskRule['threshold']['comparisonMultiple']): AuditRiskRule => ({
  id, version: '1', metric: 'rate', windowMs: RISK_WINDOW_MS,
  sample: { selector: 'scoped-pvp-settled-v1', minSubject: 6, minComparison: 8, minComparisonAccounts: 2,
    maxObservations: anchorsPerCohort * 2 },
  threshold: { absolute, comparisonMultiple }, cohort: { id: 'pvp-game-stake-window', version: '1' },
});

export const pvpRiskRules = {
  opponents: rule('pvp-opponent-concentration', { numerator: '3', denominator: '4' }, { numerator: '3', denominator: '2' }),
  direction: rule('pvp-directional-funds', { numerator: '3', denominator: '4' }, { numerator: '3', denominator: '2' }),
  resignation: rule('pvp-fast-resignation', { numerator: '1', denominator: '2' }, { numerator: '2', denominator: '1' }),
  response: rule('pvp-fast-response-intervals', { numerator: '2', denominator: '3' }, { numerator: '3', denominator: '2' }),
} as const;

type Cohort = 'subject' | 'comparison';
type Coverage = Record<Cohort, boolean>;
type PostingProof = Extract<AuditRiskEvidence, { kind: 'posting' }>;
type MatchCheck = Awaited<ReturnType<typeof reconcileStoredPvpMatch>>;
type Anchor = { accountId: string; cohort: Cohort };
type Timing = { resign?: { seat: 1 | 2; atMs: number; sequence: number };
  responses: { seat: 1 | 2; elapsedMs: number; sequence: number }[]; terminalSequence: number; gameVersion: string };
type Participant = {
  cohort: Cohort; primary: PostingProof; supporting: PostingProof[]; entity: AuditEntityRef;
  opponent: string; net: bigint; drawn: boolean; seat?: 1 | 2; timing?: Timing;
};

function membership(selection: AuditRiskSelection, accountId: string): Cohort | undefined {
  if (selection.subjectAccountIds.includes(accountId)) return 'subject';
  if (selection.comparisonAccountIds.includes(accountId)) return 'comparison';
  return;
}

function dominant(rows: Participant[], keyOf: (row: Participant) => string): Map<string, string> {
  const frequencies = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const id = row.primary.accountId!;
    let keys = frequencies.get(id);
    if (!keys) frequencies.set(id, keys = new Map());
    const key = keyOf(row);
    keys.set(key, (keys.get(key) ?? 0) + 1);
  }
  return new Map([...frequencies].map(([account, keys]) => [account,
    [...keys].sort(([left, a], [right, b]) => b - a || (left < right ? -1 : left > right ? 1 : 0))[0][0]]));
}

function labels(rows: Participant[], keyOf: (row: Participant) => string) {
  const selected = dominant(rows, keyOf);
  return rows.map(row => ({ ...row, matched: selected.get(row.primary.accountId!) === keyOf(row) }));
}

async function timingFor(audit: PostgresDatabase, store: AuditReplayStore, selection: AuditRiskSelection, matchId: string,
  winnerSeat: 1 | 2 | null, finals: PostingProof[]): Promise<Timing | undefined> {
  const header = await audit.prepare(`SELECT manifest FROM audit_replay_packages WHERE dataset_id=? AND replay_id=?
    AND octet_length(manifest::text)<=65536`).get(selection.scope.datasetId, matchId);
  const manifest = inspectReplayManifest(header?.manifest);
  if (manifest.status !== 'verified' || manifest.value.fragments.reduce((sum, part) => sum + part.eventCount, 0) > maxReplayEvents ||
      manifest.value.fragments.reduce((sum, part) => sum + part.byteLength, 0) > maxReplayBytes) return;
  const read = await store.read(selection.scope, matchId, [chessTurnReplayDefinition]);
  if (read.status !== 'verified') return;
  const { value } = read;
  if (value.manifest.entityId !== matchId || value.manifest.game.gameId !== 'chess' ||
      value.manifest.coverage !== 'complete' || value.manifest.timing === 'source-order' || !value.manifest.terminal ||
      verifyChessTurnReplay(value).status !== 'verified') return;
  const end = value.fragments.at(-1)?.events.at(-1);
  if (end?.data.kind !== 'terminal' || end.data.winnerSeat !== winnerSeat || end.postings.length !== finals.length ||
      finals.some(proof => !end.postings.some(ref => ref.namespace === proof.source.namespace && ref.rowId === proof.source.rowId))) return;
  const timing: Timing = { terminalSequence: value.manifest.terminal.sequence,
    gameVersion: value.manifest.game.rulesVersion + ':' + value.manifest.game.engineVersion, responses: [] };
  let previousMove: { seat: 1 | 2; atMs: number } | undefined;
  for (const { sequence, atMs, data } of value.fragments.flatMap(part => part.events)) {
    if (data.kind === 'presence') previousMove = undefined;
    if (data.kind !== 'action' || data.action.profile !== 'pvp-turn-based') continue;
    const { code, seat } = data.action;
    if (code === 'resign') timing.resign = { seat, sequence, atMs };
    if (code === 'move') {
      if (previousMove && previousMove.seat !== seat) timing.responses.push({ seat, elapsedMs: atMs - previousMove.atMs, sequence });
      previousMove = { seat, atMs };
    }
  }
  return timing;
}

function shortResponse(row: Participant) {
  const sample = row.timing?.responses.filter(response => response.seat === row.seat)
    .sort((a, b) => a.elapsedMs - b.elapsedMs || a.sequence - b.sequence) ?? [];
  if (sample.length < 2) return;
  const lower = sample[Math.floor((sample.length - 1) / 2)], upper = sample[Math.floor(sample.length / 2)];
  return { matched: lower.elapsedMs + upper.elapsedMs <= fastResponseMs * 2, sequence: upper.sequence };
}

async function anchorMatches(audit: PostgresDatabase, selection: AuditRiskSelection, coverage: Coverage) {
  const accounts = riskAccounts(selection), ledger = selection.gameSchema + '.demo_ledger';
  // Bound the indexed ledger range itself, before filtering for PvP, including for high-activity accounts.
  const rows = await audit.prepare(`SELECT a.account_id,r.operation_id
    FROM unnest(?::text[]) a(account_id) CROSS JOIN LATERAL (
      SELECT operation_id,occurred_at_ms,source_row_id FROM audit_posting_refs
      WHERE dataset_id=? AND account_id=a.account_id AND source_namespace=?
        AND occurred_at_ms>=? AND occurred_at_ms<? AND occurred_at_ms<=?
      ORDER BY occurred_at_ms,source_namespace,source_row_id LIMIT ?
    ) r ORDER BY a.account_id,r.occurred_at_ms,r.source_row_id`)
    .all(accounts, selection.scope.datasetId, ledger, selection.fromMs, selection.toMs, selection.asOfMs, scanPerAccount + 1);
  const scanned = new Map<string, number>(), count = { subject: 0, comparison: 0 };
  const anchors = new Map<string, Anchor[]>();
  for (const row of rows) {
    const accountId = row.account_id as string, cohort = membership(selection, accountId);
    if (!cohort) continue;
    const position = (scanned.get(accountId) ?? 0) + 1;
    scanned.set(accountId, position);
    if (position > scanPerAccount) { coverage[cohort] = false; continue; }
    const matchId = holdOperation.exec(row.operation_id)?.[1];
    if (!matchId) continue;
    const previous = anchors.get(matchId);
    if (previous?.some(anchor => anchor.accountId === accountId)) continue;
    if (++count[cohort] > anchorsPerCohort) { coverage[cohort] = false; continue; }
    const anchor = { accountId, cohort };
    if (previous) previous.push(anchor);
    else anchors.set(matchId, [anchor]);
  }
  return anchors;
}

function entityFor(check: MatchCheck, schema: string): AuditEntityRef {
  const bank = check.bank!;
  const source = { namespace: schema + (bank.gameId === 'mortal-kombat' ? '.combat_matches' : '.pvp_matches'), rowId: check.matchId };
  return { category: 'pvp', kind: 'match', gameId: bank.gameId, modeId: 'stake',
    rulesVersion: bank.gameId === 'tsu-e-fa' ? bank.gameRulesVersion : null, source, ticketId: null };
}

async function proofs(audit: PostgresDatabase, selection: AuditRiskSelection, matchId: string): Promise<PostingProof[] | undefined> {
  const ledger = selection.gameSchema + '.demo_ledger';
  const rows = await audit.prepare(`SELECT account_id,operation_id,occurred_at_ms,source_row_id::text AS row_id
    FROM audit_posting_refs WHERE dataset_id=? AND source_namespace=? AND operation_id IN (?,?)
    ORDER BY operation_id,source_row_id LIMIT ?`)
    .all(selection.scope.datasetId, ledger, 'pvp:' + matchId + ':hold', 'pvp:' + matchId + ':final', maxPostingsPerMatch + 1);
  if (rows.length > maxPostingsPerMatch || rows.some(row => !Number.isSafeInteger(row.occurred_at_ms) || row.occurred_at_ms > selection.asOfMs)) return;
  return rows.map(row => ({ kind: 'posting' as const, source: { namespace: ledger, rowId: row.row_id as string },
    accountId: row.account_id as string, operationId: row.operation_id as string, occurredAtMs: row.occurred_at_ms as number }));
}

function segmentFor(check: MatchCheck) {
  const bank = check.bank!;
  return [bank.gameId, 'stake', bank.gameRulesVersion ?? 'rules-unrecorded', bank.moneyRulesVersion, bank.stakeUnits, 'virtual-usd', '2'].join(':');
}

function addReplayLinks(candidate: AuditRiskCandidate, rows: (Participant & { sequence: number })[]) {
  const links = new Map<string, NonNullable<AuditRiskCandidate['replayLinks']>[number]>();
  for (const { entity, sequence } of rows) {
    const replayId = entity.source.rowId;
    links.set(replayId + ':' + sequence, { replayId, sequence, source: entity.source });
  }
  if (links.size) candidate.replayLinks = [...links.values()];
}

async function availableTables(audit: PostgresDatabase, tables: string[]): Promise<Set<string>> {
  const rows = await audit.prepare(`SELECT name FROM unnest(?::text[]) names(name)
    WHERE pg_catalog.has_table_privilege(pg_catalog.to_regclass(name), 'SELECT')`).all(tables);
  return new Set(rows.map(row => row.name as string));
}

/** Behavior uses one verified hold per actor/match and same-cohort match terms. Receipt attempts are never game actions. */
export async function selectPvpRisk(audit: PostgresDatabase, selection: AuditRiskSelection): Promise<AuditRiskCandidate[]> {
  selection.signal?.throwIfAborted();
  return audit.transaction(async () => {
    const { wholeWindow } = await riskSourceBoundaries(audit, selection);
    const walletTables = ['demo_ledger', 'virtual_pvp_banks', 'virtual_pvp_holds', 'pvp_matches', 'combat_matches']
      .map(name => selection.gameSchema + '.' + name);
    const replayTables = ['audit_replay_packages', 'audit_replay_fragments'].map(name => audit.schema + '.' + name);
    const available = await availableTables(audit, [...walletTables, ...replayTables]);
    selection.signal?.throwIfAborted();
    if (walletTables.some(table => !available.has(table))) {
      return Object.values(pvpRiskRules).map(rule => riskCandidate(selection, rule, 'pvp-source-unavailable', asset, [],
        { subject: false, comparison: false }));
    }
    const replayAvailable = replayTables.every(table => available.has(table));
    const completeness: Coverage = { subject: wholeWindow, comparison: wholeWindow };
    const bySegment = new Map<string, Participant[]>();
    const segmentGaps = new Map<string, Set<Cohort>>();
    const findingsBySegment = new Map<string, NonNullable<AuditRiskCandidate['financialFindings']>>();
    const replayStore = new AuditReplayStore(audit);
    const matches = await anchorMatches(audit, selection, completeness);
    const game = identifier(selection.gameSchema);
    for (const [matchId, anchors] of matches) {
      selection.signal?.throwIfAborted();
      const postingProofs = await proofs(audit, selection, matchId);
      if (!postingProofs) {
        for (const anchor of anchors) completeness[anchor.cohort] = false;
        continue;
      }
      const check = await reconcileStoredPvpMatch(audit, { schema: selection.gameSchema }, selection.scope.datasetId, matchId);
      const scopeMatches = check.scope?.datasetId === selection.scope.datasetId && check.scope.environment === selection.scope.environment;
      const segment = scopeMatches && check.bank ? segmentFor(check) : null;
      const markIncomplete = () => {
        if (segment) {
          const sides = segmentGaps.get(segment) ?? new Set<Cohort>();
          for (const anchor of anchors) sides.add(anchor.cohort);
          segmentGaps.set(segment, sides);
        } else for (const anchor of anchors) completeness[anchor.cohort] = false;
      };
      if (check.bank) {
        const time = await audit.prepare(`SELECT updated_at FROM ${game}.virtual_pvp_banks WHERE match_id=?`).get(matchId);
        if (!Number.isSafeInteger(time?.updated_at) || time!.updated_at > selection.asOfMs) { markIncomplete(); continue; }
      }
      if (segment && check.bank && check.status === 'mismatch' && postingProofs.some(proof => proof.operationId?.endsWith(':final'))) {
        const confirmed = findingsBySegment.get(segment) ?? [];
        const postings = check.participants.flatMap(actor => actor.postings.map(posting => posting.source));
        for (const finding of check.findings) if (finding.severity === 'mismatch') {
          confirmed.push({ code: finding.code, source: finding.source ?? check.bank.source, postings });
        }
        findingsBySegment.set(segment, confirmed);
      }
      if (!scopeMatches || !check.bank || check.status === 'insufficient-data' || check.status === 'mismatch' || check.status === 'not-captured') {
        markIncomplete();
        continue;
      }
      if (check.participants.length !== 2) continue; // Unaccepted invitations have no opponent sample.
      if (check.status !== 'match') { markIncomplete(); continue; }
      const drawn = check.bank.state === 'refunded' && check.bank.reason === 'draw';
      if (!drawn && check.bank.state !== 'settled') continue;
      const verifiedIds = new Set(check.participants.flatMap(actor => actor.postings.map(posting => posting.source.rowId)));
      if (postingProofs.length !== verifiedIds.size || postingProofs.some(posting => !verifiedIds.has(posting.source.rowId)) ||
          !postingProofs.some(posting => posting.operationId?.endsWith(':final'))) { markIncomplete(); continue; }
      const entity = entityFor(check, selection.gameSchema);
      const participants = check.participants.map(actor => actor.accountId);
      const sharesSubject = participants.some(account => selection.subjectAccountIds.includes(account));
      const eligible = anchors.filter(anchor => anchor.cohort === 'subject' || !sharesSubject);
      if (!eligible.length) continue;
      const standard = replayAvailable && check.bank.gameId === 'chess' ? await audit.prepare(
        `SELECT creator_id,opponent_id FROM ${game}.pvp_matches WHERE id=?`).get(matchId) : undefined;
      const winner = check.bank.winnerId;
      const winningSeat = winner === null ? null : winner === standard?.creator_id ? 1 : winner === standard?.opponent_id ? 2 : undefined;
      const timing = standard && winningSeat !== undefined ? await timingFor(audit, replayStore, selection, matchId, winningSeat,
        postingProofs.filter(proof => proof.operationId?.endsWith(':final'))) : undefined;
      for (const anchor of eligible) {
        const participant = check.participants.find(actor => actor.accountId === anchor.accountId);
        const primary = postingProofs.find(posting => posting.accountId === anchor.accountId && posting.operationId?.endsWith(':hold'));
        const opponent = participants.find(accountId => accountId !== anchor.accountId);
        if (!participant || !primary || !opponent) { markIncomplete(); continue; }
        const supporting = postingProofs.filter(posting => posting.source.rowId !== primary.source.rowId);
        const net = participant.postings.reduce((sum, posting) => sum + BigInt(posting.units), 0n);
        const seat = standard?.creator_id === anchor.accountId ? 1 : standard?.opponent_id === anchor.accountId ? 2 : undefined;
        const rows = bySegment.get(segment!) ?? [];
        rows.push({ cohort: anchor.cohort, primary, supporting, entity, opponent, net, drawn, seat, timing });
        bySegment.set(segment!, rows);
      }
    }

    const candidates: AuditRiskCandidate[] = [];
    const segments = [...new Set([...bySegment.keys(), ...segmentGaps.keys()])].sort();
    const hasSubject = (segment: string) => segmentGaps.get(segment)?.has('subject') ||
      bySegment.get(segment)?.some(row => row.cohort === 'subject') || false;
    segments.sort((a, b) => Number(hasSubject(b)) - Number(hasSubject(a)));
    for (const segment of segments.slice(0, maxSegments)) {
      selection.signal?.throwIfAborted();
      const rows = bySegment.get(segment) ?? [];
      const gap = segmentGaps.get(segment);
      const covered = { subject: completeness.subject && !gap?.has('subject'), comparison: completeness.comparison && !gap?.has('comparison') };
      const concentration = riskCandidate(selection, pvpRiskRules.opponents, segment, asset, labels(rows, row => row.opponent), covered);
      const findings = findingsBySegment.get(segment);
      if (findings?.length) concentration.financialFindings = findings;
      candidates.push(concentration);
      const directed = rows.filter(row => !row.drawn && row.net !== 0n);
      candidates.push(riskCandidate(selection, pvpRiskRules.direction, segment, asset,
        labels(directed, row => JSON.stringify([row.opponent, row.net > 0n ? 'received' : 'paid'])), covered));

      const verified = rows.filter(row => row.timing && row.seat);
      const timedCovered = { ...covered };
      for (const row of rows) if (!row.timing || !row.seat) timedCovered[row.cohort] = false;
      const versions = new Set(verified.map(row => row.timing!.gameVersion));
      for (const version of versions.size ? versions : ['timing-unavailable']) {
        const timed = verified.filter(row => row.timing?.gameVersion === version);
        const resignations = timed.map(row => ({ ...row, matched: row.timing!.resign?.seat === row.seat &&
          row.timing!.resign!.atMs <= fastResignationMs,
          sequence: row.timing!.resign?.sequence ?? row.timing!.terminalSequence }));
        const intervals = timed.flatMap(row => {
          const response = shortResponse(row);
          return response ? [{ ...row, ...response }] : [];
        });
        const timingSegment = segment + ':' + version;
        const resignation = riskCandidate(selection, pvpRiskRules.resignation, timingSegment, asset, resignations, timedCovered);
        const response = riskCandidate(selection, pvpRiskRules.response, timingSegment, asset, intervals, timedCovered);
        addReplayLinks(resignation, resignations);
        addReplayLinks(response, intervals);
        candidates.push(resignation, response);
      }
    }
    if (segments.length > maxSegments || (!segments.length && (!completeness.subject || !completeness.comparison))) {
      const segment = segments.length ? 'pvp-segment-limit' : 'pvp-evidence-unavailable';
      const unavailable = Object.values(pvpRiskRules).map(rule => riskCandidate(selection, rule, segment, asset, [],
        { subject: false, comparison: false }));
      const findings = segments.slice(maxSegments).flatMap(key => findingsBySegment.get(key) ?? []);
      if (findings.length) unavailable[0].financialFindings = findings;
      candidates.push(...unavailable);
    }
    selection.signal?.throwIfAborted();
    return candidates;
  }, { readOnly: true });
}
