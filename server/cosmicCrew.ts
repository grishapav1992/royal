import type {PostgresDatabase} from './database';
import {applySchemaMigration} from './database-migrations';
import {COSMIC_CREW_GAME, COSMIC_CREW_RATES, cosmicCrewUnlocked, isCosmicCrewId, validCosmicCrewProfile, validCosmicCrewRequest, type CosmicCrewId, type CosmicCrewProfile} from '../src/shared/cosmicCrew';

export class CosmicCrewError extends Error { constructor(public status: number, public code: string) { super(code); } }
const CENT = 10000n;
/** Settlements of one account are ordered by its wallet lock. The overlap only covers a clock correction. */
const OVERLAP_MS = 3600000;
const rateSql = 'CASE ' + [...COSMIC_CREW_RATES].reverse().map(rate => `WHEN paid.cents>=${rate.from} THEN ${rate.points}`).join(' ') + ' ELSE 0 END';

/**
 * Reads completed paid rounds from the committed progression outbox. The wallet writes that outbox once per round,
 * inside the settlement transaction. The crew keeps its own credited list, so a failure here cannot touch money.
 */
export class CosmicCrewStore {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, prerequisite: Promise<unknown>, private now: () => number = Date.now) {
    this.ready = prerequisite.then(() => applySchemaMigration(db, {
      id: 'cosmic-crew-v1',
      indexes: [{name: 'progression_outbox_account_time', table: 'progression_outbox', columns: ['account_id', 'created_at']}],
      statements: [
        'CREATE TABLE cosmic_crew_start(id INTEGER PRIMARY KEY CHECK(id=1),started_at BIGINT NOT NULL CHECK(started_at>0))',
        'INSERT INTO cosmic_crew_start(id,started_at) VALUES(1,floor(extract(epoch FROM clock_timestamp())*1000)::bigint)',
        `CREATE TABLE cosmic_crew_profiles(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,selected_id TEXT NOT NULL DEFAULT 'racer',
          points BIGINT NOT NULL DEFAULT 0 CHECK(points>=0),revision BIGINT NOT NULL DEFAULT 0 CHECK(revision>=0),credited_until BIGINT NOT NULL DEFAULT 0 CHECK(credited_until>=0))`,
        `CREATE TABLE cosmic_crew_rounds(account_id TEXT NOT NULL REFERENCES cosmic_crew_profiles(account_id) ON DELETE CASCADE,round_id TEXT NOT NULL,
          paid_cents BIGINT NOT NULL CHECK(paid_cents>=0),points INTEGER NOT NULL CHECK(points>=0),settled_at BIGINT NOT NULL,PRIMARY KEY(account_id,round_id))`,
        `CREATE TABLE cosmic_crew_revealed(account_id TEXT NOT NULL REFERENCES cosmic_crew_profiles(account_id) ON DELETE CASCADE,character_id TEXT NOT NULL,
          revealed_at BIGINT NOT NULL,PRIMARY KEY(account_id,character_id))`,
      ],
    }));
    this.ready.catch(() => {});
  }

  private async credit(account: string) {
    await this.db.prepare('INSERT INTO cosmic_crew_profiles(account_id) VALUES(?) ON CONFLICT DO NOTHING').run(account);
    const profile = (await this.db.prepare('SELECT credited_until FROM cosmic_crew_profiles WHERE account_id=?').get(account))!;
    const start = Number((await this.db.prepare('SELECT started_at FROM cosmic_crew_start WHERE id=1').get())!.started_at);
    const from = Math.max(start, Number(profile.credited_until) - OVERLAP_MS);
    const added = await this.db.prepare(`INSERT INTO cosmic_crew_rounds(account_id,round_id,paid_cents,points,settled_at)
      SELECT paid.account_id,paid.id,paid.cents,${rateSql},paid.created_at FROM (
        SELECT o.account_id,o.id,o.created_at,((o.payload::jsonb->>'paidUnits')::numeric-(o.payload::jsonb->>'refundedUnits')::numeric)/${CENT} AS cents
        FROM progression_outbox o JOIN progression_rounds r ON r.id=o.id
        WHERE o.account_id=? AND o.created_at>=? AND o.payload::jsonb->>'outcome'='settled' AND o.payload::jsonb->>'sourceType'='paid-game' AND r.context_json::jsonb->>'gameId'=?) paid
      WHERE paid.cents>0 ON CONFLICT DO NOTHING RETURNING points,settled_at`).all(account, from, COSMIC_CREW_GAME);
    if (!added.length) return;
    const points = added.reduce((sum, row) => sum + Number(row.points), 0), until = Math.max(...added.map(row => Number(row.settled_at)));
    await this.db.prepare('UPDATE cosmic_crew_profiles SET points=points+?,credited_until=GREATEST(credited_until,?),revision=revision+1 WHERE account_id=?').run(points, until, account);
  }

  private async view(account: string): Promise<CosmicCrewProfile> {
    const row = (await this.db.prepare('SELECT selected_id,points,revision FROM cosmic_crew_profiles WHERE account_id=?').get(account))!;
    const seen = await this.db.prepare('SELECT character_id FROM cosmic_crew_revealed WHERE account_id=? ORDER BY revealed_at,character_id').all(account);
    const active = await this.db.prepare("SELECT 1 FROM demo_casino_sessions WHERE account_id=? AND game_id=? AND state='active'").get(account, COSMIC_CREW_GAME);
    const unlocked = cosmicCrewUnlocked(Number(row.points));
    const revealed: CosmicCrewId[] = ['racer', ...seen.map(item => item.character_id).filter((id): id is CosmicCrewId => isCosmicCrewId(id) && id !== 'racer' && unlocked.includes(id))];
    const selected: CosmicCrewId = isCosmicCrewId(row.selected_id) && revealed.includes(row.selected_id) ? row.selected_id : 'racer';
    const profile: CosmicCrewProfile = {version: 1, accountId: account, revision: Number(row.revision), points: Number(row.points), unlocked, revealed, selected, active: !!active};
    if (!validCosmicCrewProfile(profile)) throw Error('Invalid Cosmic crew profile');
    return profile;
  }

  async snapshot(account: string) {
    await this.ready;
    return this.db.transaction(async () => { await this.credit(account); return this.view(account); }, {lockKey: 'cosmic-crew:' + account});
  }

  async operate(account: string, value: unknown) {
    await this.ready;
    if (!validCosmicCrewRequest(value)) throw new CosmicCrewError(400, 'invalid-request');
    return this.db.transaction(async () => {
      await this.credit(account);
      const current = await this.view(account);
      if (!current.unlocked.includes(value.characterId)) throw new CosmicCrewError(403, 'character-locked');
      // A repeated request returns the same profile and changes nothing.
      const choose = value.action === 'select' && current.selected !== value.characterId, open = !current.revealed.includes(value.characterId);
      if (!choose && !open) return current;
      if (choose && current.active) throw new CosmicCrewError(409, 'round-active');
      if (open) await this.db.prepare('INSERT INTO cosmic_crew_revealed(account_id,character_id,revealed_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(account, value.characterId, this.now());
      if (choose) await this.db.prepare('UPDATE cosmic_crew_profiles SET selected_id=? WHERE account_id=?').run(value.characterId, account);
      await this.db.prepare('UPDATE cosmic_crew_profiles SET revision=revision+1 WHERE account_id=?').run(account);
      return this.view(account);
    }, {lockKey: 'cosmic-crew:' + account});
  }
}
