import type {PostgresDatabase} from './database';
import {applySchemaMigration} from './database-migrations';
import {AFTER_BETS, validAfterStake} from '../src/shared/afterglow';
import {AFTER_ALBUM_MAX_UNITS, AFTER_LOOK_TARGET_UNITS} from '../src/shared/afterglowWardrobe';

/** Additive cosmetic migration. Existing slot sessions and payout rules stay intact. */
export function migrateAfterglowProgress(db: PostgresDatabase) {
  return applySchemaMigration(db, {id: 'afterglow-stake-progress-v3', statements: [
    `CREATE TABLE demo_afterglow_stake_album (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
      points_units BIGINT NOT NULL CHECK(points_units BETWEEN 0 AND ${AFTER_ALBUM_MAX_UNITS}))`,
    `CREATE TABLE demo_afterglow_stake_girls (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      girl INTEGER NOT NULL CHECK(girl BETWEEN 0 AND 3),
      points_units BIGINT NOT NULL CHECK(points_units>=0 AND points_units<=CASE girl
        WHEN 0 THEN 400000 WHEN 1 THEN 100000 WHEN 2 THEN 300000 WHEN 3 THEN 200000 END), PRIMARY KEY(account_id,girl))`,
    `CREATE TABLE demo_afterglow_stake_rounds (
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, session_id TEXT NOT NULL,
      girl INTEGER CHECK(girl BETWEEN 0 AND 3),
      credited_units BIGINT NOT NULL CHECK(credited_units IN (${AFTER_BETS.join(',')})), PRIMARY KEY(account_id,session_id))`,
    // The row-dependent cast aborts the entire migration on corrupt history.
    `INSERT INTO demo_afterglow_stake_rounds(account_id,session_id,girl,credited_units)
      SELECT s.account_id,s.id,g.girl,CASE WHEN s.payload::jsonb->>'stakeUnits' IN (${AFTER_BETS.map(n => `'${n}'`).join(',')})
        THEN (s.payload::jsonb->>'stakeUnits')::bigint ELSE ('invalid historical Afterglow stake: '||s.id)::bigint END
      FROM demo_casino_sessions s LEFT JOIN demo_afterglow_round_girls g ON g.account_id=s.account_id AND g.session_id=s.id
      WHERE s.game_id='studio-afterglow' AND s.state='settled'`,
    // Preserve old percentages and unlocks, or actual historical turnover if it is larger.
    `INSERT INTO demo_afterglow_stake_album(account_id,points_units)
      SELECT account_id,LEAST(${AFTER_ALBUM_MAX_UNITS},MAX(points)) FROM (
        SELECT account_id,cards::bigint*2000 AS points FROM demo_afterglow_albums
        UNION ALL SELECT account_id,SUM(credited_units) AS points FROM demo_afterglow_stake_rounds GROUP BY account_id
      ) p GROUP BY account_id`,
    `INSERT INTO demo_afterglow_stake_girls(account_id,girl,points_units)
      SELECT account_id,girl,LEAST(CASE girl WHEN 0 THEN 400000 WHEN 1 THEN 100000 WHEN 2 THEN 300000 WHEN 3 THEN 200000 END,MAX(points)) FROM (
        SELECT account_id,girl,CASE WHEN unlocked THEN CASE girl WHEN 0 THEN 400000 WHEN 1 THEN 100000 WHEN 2 THEN 300000 WHEN 3 THEN 200000 END ELSE spins::bigint*2000 END AS points FROM demo_afterglow_girl_progress
        UNION ALL SELECT account_id,girl,SUM(credited_units) AS points FROM demo_afterglow_stake_rounds WHERE girl IS NOT NULL GROUP BY account_id,girl
      ) p GROUP BY account_id,girl`,
  ]});
}

/** Called only after server settlement validation, in the wallet account transaction. */
export async function creditAfterglowProgress(db: PostgresDatabase, account: string, session: string, stakeUnits: string) {
  if (!db.inTransaction || !validAfterStake(stakeUnits)) throw Error('Invalid Afterglow progress settlement');
  const attribution = await db.prepare('SELECT girl FROM demo_afterglow_round_girls WHERE account_id=? AND session_id=?').get(account, session);
  const girl = attribution == null ? null : Number(attribution.girl);
  const inserted = await db.prepare('INSERT INTO demo_afterglow_stake_rounds(account_id,session_id,girl,credited_units) VALUES(?,?,?,?) ON CONFLICT(account_id,session_id) DO NOTHING RETURNING session_id').get(account, session, girl, stakeUnits);
  if (!inserted) return;
  await db.prepare('INSERT INTO demo_afterglow_stake_album(account_id,points_units) VALUES(?,LEAST(?,?::bigint)) ON CONFLICT(account_id) DO UPDATE SET points_units=LEAST(?,demo_afterglow_stake_album.points_units+EXCLUDED.points_units)').run(account, AFTER_ALBUM_MAX_UNITS, stakeUnits, AFTER_ALBUM_MAX_UNITS);
  if (girl === null) return; // Older active rounds have no attributable heroine.
  const target = AFTER_LOOK_TARGET_UNITS[girl];
  if (target === undefined) throw Error('Invalid Afterglow round heroine');
  await db.prepare('INSERT INTO demo_afterglow_stake_girls(account_id,girl,points_units) VALUES(?,?,LEAST(?,?::bigint)) ON CONFLICT(account_id,girl) DO UPDATE SET points_units=LEAST(?,demo_afterglow_stake_girls.points_units+EXCLUDED.points_units)').run(account, girl, target, stakeUnits, target);
  await db.prepare('UPDATE demo_afterglow_round_girls SET counted=TRUE WHERE account_id=? AND session_id=?').run(account, session);
}
