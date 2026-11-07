import { randomUUID } from 'node:crypto';
import type { AuditScope } from '../server/audit/contract';
import { persistCapturedSportReplay, SportReplayCapture, type CapturedSportReplay } from '../server/audit/replay-pvp-sport';
import { AuditReplayStore } from '../server/audit/replay-store';
import type { PostgresDatabase } from '../server/database';
import { NileCombatEscrow } from '../server/finance/combat-escrow';
import { PvpStore } from '../server/pvp/store';
import type { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { TableGame } from '../server/tableGames';

/** Prepare one completed and paid replay with the real game engine, outside the measured phases. */
export async function seedAuditLoadReplay(game: PostgresDatabase, audit: PostgresDatabase, ledger: VirtualPvpLedger,
  scope: AuditScope, accounts: [string, string]) {
  const store = new PvpStore(ledger), combat = new NileCombatEscrow(ledger);
  await Promise.all([store.ready, combat.ready]);
  const roomId = 'audit-load-replay', sessions = ['audit-load-replay-a', 'audit-load-replay-b'];
  const actors = accounts.map((accountId, seat) => ({ accountId, name: `Fixture player ${seat + 1}`,
    roomId, connected: true, available: true }));
  const startedAt = Date.now();
  await store.syncRoom(roomId, actors, startedAt);
  const created = await store.command(actors[0], { id: randomUUID(), action: 'create', gameId: 'hockey',
    stakeUnits: '10000000', targetId: accounts[1] }, startedAt + 1);
  const matchId = created.active?.id;
  if (!matchId) throw new Error('Fixture replay match was not created');
  await store.command(actors[1], { id: randomUUID(), action: 'accept', challengeId: matchId }, startedAt + 2);
  await store.command(actors[0], { id: randomUUID(), action: 'ready', challengeId: matchId }, startedAt + 3);
  const { active: match } = await store.command(actors[1], { id: randomUUID(), action: 'ready', challengeId: matchId }, startedAt + 4);
  if (match?.status !== 'playing') throw new Error('Fixture replay match did not start');

  const engine = new TableGame('hockey'), recordings: CapturedSportReplay[] = [];
  let clock = 500;
  const capture = new SportReplayCapture(session => accounts[sessions.indexOf(session)], recording => recordings.push(recording), () => clock++);
  capture.observeMatches([match]);
  engine.setReplayObserver(event => capture.observeEngine(event));
  engine.join(sessions[0]);
  engine.join(sessions[1]);
  for (let tick = 0; tick < 7000 && engine.state.phase === 'playing'; tick++) {
    const puck = engine.state.balls[0];
    engine.move(sessions[0], Math.min(180, puck.x - 30), puck.y + (puck.y > 200 ? 5 : -5));
    engine.tick(tick % 2 ? .05 : .047);
  }
  if (engine.state.winner !== sessions[0] || engine.state.score[0] !== 7 || engine.state.score[1] !== 0) {
    throw new Error('Unexpected fixture replay outcome');
  }
  const finishedAt = Math.max(Date.now(), startedAt + 5);
  await store.adjudicate(roomId, matchId, accounts[0], 'win', finishedAt);
  capture.observeAdjudication(matchId, accounts[0], 'win', finishedAt);
  if (recordings.length !== 1 || await persistCapturedSportReplay(audit, scope, game.schema, recordings[0]) !== 'recorded') {
    throw new Error('Fixture replay was not captured and stored');
  }
  const stored = await new AuditReplayStore(audit).read(scope, matchId);
  if (stored.status !== 'verified' || stored.value.manifest.coverage !== 'complete') {
    const reason = stored.status === 'verified' ? stored.value.manifest.gaps.join(',') : stored.status;
    throw new Error('Fixture replay was not verified: ' + reason);
  }
  const events = stored.value.fragments.flatMap(fragment => fragment.events);
  const payout = events.at(-1)?.money?.find(leg => leg.movement === 'payout');
  const holds = events[0]?.money;
  if (!payout || payout.units !== '1900' || holds?.length !== 2 || holds.some(leg => leg.units !== '-1000')) {
    throw new Error('Unexpected fixture replay money');
  }
  return { replayId: matchId, checksum: stored.value.manifest.sha256, events: events.length, fragments: stored.value.fragments.length,
    payout: payout.posting, postings: holds.length + 1 };
}
