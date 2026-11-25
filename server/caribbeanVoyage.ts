import type {PostgresDatabase} from './database';
import {applySchemaMigration} from './database-migrations';
import {isCrewId, type CaribbeanCrewId} from '../src/shared/caribbeanCrew';
import {CARIBBEAN_VOYAGE_GAME, CARIBBEAN_VOYAGE_RATES, VOYAGE_START, caribbeanVoyageReached, validCaribbeanVoyageProfile, validCaribbeanVoyageRequest, type CaribbeanVoyageProfile} from '../src/shared/caribbeanVoyage';

export class CaribbeanVoyageError extends Error { constructor(public status: number, public code: string) { super(code); } }
const CENT = 10000n;
/** Settlements of one account are ordered by its wallet lock. The overlap only covers a clock correction. */
const OVERLAP_MS = 3600000;
const rateSql = 'CASE ' + [...CARIBBEAN_VOYAGE_RATES].reverse().map(rate => `WHEN paid.cents>=${rate.from} THEN ${rate.points}`).join(' ') + ' ELSE 0 END';

/**
 * Reads completed paid rounds from the committed progression outbox, like the Cosmic crew. The voyage keeps its own
 * credited list, so a failure here cannot touch money. Tokens and pirates of the earlier collection are carried over once.
 */
export class CaribbeanVoyageStore {
  private schema?: Promise<void>;
  constructor(private db: PostgresDatabase, private prerequisite: Promise<unknown>, private now: () => number = Date.now) { this.ready.catch(() => {}); }

  /** A lock held during startup must not disable the voyage until the next restart: a failed attempt is repeated. */
  get ready(): Promise<void> {
    return this.schema ??= this.prerequisite.then(() => applySchemaMigration(this.db, {
      id: 'caribbean-voyage-v1',
      indexes: [{name: 'progression_outbox_account_time', table: 'progression_outbox', columns: ['account_id', 'created_at']}],
      statements: [
        'CREATE TABLE caribbean_voyage_start(id INTEGER PRIMARY KEY CHECK(id=1),started_at BIGINT NOT NULL CHECK(started_at>0))',
        'INSERT INTO caribbean_voyage_start(id,started_at) VALUES(1,floor(extract(epoch FROM clock_timestamp())*1000)::bigint)',
        `CREATE TABLE caribbean_voyage_profiles(account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,selected_id TEXT NOT NULL DEFAULT 'isabella',
          points BIGINT NOT NULL DEFAULT 0 CHECK(points>=0),revision BIGINT NOT NULL DEFAULT 0 CHECK(revision>=0),credited_until BIGINT NOT NULL DEFAULT 0 CHECK(credited_until>=0))`,
        `CREATE TABLE caribbean_voyage_rounds(account_id TEXT NOT NULL REFERENCES caribbean_voyage_profiles(account_id) ON DELETE CASCADE,round_id TEXT NOT NULL,
          paid_cents BIGINT NOT NULL CHECK(paid_cents>=0),points INTEGER NOT NULL CHECK(points>=0),settled_at BIGINT NOT NULL,PRIMARY KEY(account_id,round_id))`,
        `CREATE TABLE caribbean_voyage_met(account_id TEXT NOT NULL REFERENCES caribbean_voyage_profiles(account_id) ON DELETE CASCADE,character_id TEXT NOT NULL,
          met_at BIGINT NOT NULL,PRIMARY KEY(account_id,character_id))`,
        // One token becomes one point. Opened pirates and the chosen one stay.
        `INSERT INTO caribbean_voyage_profiles(account_id,selected_id,points) SELECT p.account_id,p.selected_id,GREATEST(0,
          COALESCE((SELECT SUM(c.reward) FROM caribbean_crew_completed c WHERE c.account_id=p.account_id),0)-COALESCE((SELECT SUM(o.cost) FROM caribbean_crew_owned o WHERE o.account_id=p.account_id),0))
          FROM caribbean_crew_profiles p`,
        `INSERT INTO caribbean_voyage_met(account_id,character_id,met_at) SELECT account_id,character_id,unlocked_at FROM caribbean_crew_owned WHERE character_id<>'isabella'`,
      ],
    })).catch(error => { this.schema = undefined; throw error; });
  }

  private async credit(account: string) {
    await this.db.prepare('INSERT INTO caribbean_voyage_profiles(account_id) VALUES(?) ON CONFLICT DO NOTHING').run(account);
    const profile = (await this.db.prepare('SELECT credited_until FROM caribbean_voyage_profiles WHERE account_id=?').get(account))!;
    const start = Number((await this.db.prepare('SELECT started_at FROM caribbean_voyage_start WHERE id=1').get())!.started_at);
    const from = Math.max(start, Number(profile.credited_until) - OVERLAP_MS);
    const added = await this.db.prepare(`INSERT INTO caribbean_voyage_rounds(account_id,round_id,paid_cents,points,settled_at)
      SELECT paid.account_id,paid.id,paid.cents,${rateSql},paid.created_at FROM (
        SELECT o.account_id,o.id,o.created_at,((o.payload::jsonb->>'paidUnits')::numeric-(o.payload::jsonb->>'refundedUnits')::numeric)/${CENT} AS cents
        FROM progression_outbox o JOIN progression_rounds r ON r.id=o.id
        WHERE o.account_id=? AND o.created_at>=? AND o.payload::jsonb->>'outcome'='settled' AND o.payload::jsonb->>'sourceType'='paid-game' AND r.context_json::jsonb->>'gameId'=?) paid
      WHERE paid.cents>0 ON CONFLICT DO NOTHING RETURNING points,settled_at`).all(account, from, CARIBBEAN_VOYAGE_GAME);
    if (!added.length) return;
    const points = added.reduce((sum, row) => sum + Number(row.points), 0), until = Math.max(...added.map(row => Number(row.settled_at)));
    await this.db.prepare('UPDATE caribbean_voyage_profiles SET points=points+?,credited_until=GREATEST(credited_until,?),revision=revision+1 WHERE account_id=?').run(points, until, account);
  }

  private async view(account: string): Promise<CaribbeanVoyageProfile> {
    const row = (await this.db.prepare('SELECT selected_id,points,revision FROM caribbean_voyage_profiles WHERE account_id=?').get(account))!;
    const seen = await this.db.prepare('SELECT character_id FROM caribbean_voyage_met WHERE account_id=? ORDER BY met_at,character_id').all(account);
    const active = await this.db.prepare("SELECT 1 FROM demo_casino_sessions WHERE account_id=? AND game_id=? AND state='active'").get(account, CARIBBEAN_VOYAGE_GAME);
    const met: CaribbeanCrewId[] = [VOYAGE_START, ...seen.map(item => item.character_id).filter((id): id is CaribbeanCrewId => isCrewId(id) && id !== VOYAGE_START)];
    const selected: CaribbeanCrewId = isCrewId(row.selected_id) && met.includes(row.selected_id) ? row.selected_id : VOYAGE_START;
    const profile: CaribbeanVoyageProfile = {version: 1, accountId: account, revision: Number(row.revision), points: Number(row.points), reached: caribbeanVoyageReached(Number(row.points)), met, selected, active: !!active};
    if (!validCaribbeanVoyageProfile(profile)) throw Error('Invalid Caribbean voyage profile');
    return profile;
  }

  async snapshot(account: string) {
    await this.ready;
    return this.db.transaction(async () => { await this.credit(account); return this.view(account); }, {lockKey: 'caribbean-voyage:' + account});
  }

  async operate(account: string, value: unknown) {
    await this.ready;
    if (!validCaribbeanVoyageRequest(value)) throw new CaribbeanVoyageError(400, 'invalid-request');
    return this.db.transaction(async () => {
      await this.credit(account);
      const current = await this.view(account), known = current.met.includes(value.characterId);
      if (!known && !current.reached.includes(value.characterId)) throw new CaribbeanVoyageError(403, 'character-locked');
      // A repeated request returns the same profile and changes nothing.
      const choose = value.action === 'select' && current.selected !== value.characterId;
      if (!choose && known) return current;
      if (choose && current.active) throw new CaribbeanVoyageError(409, 'round-active');
      if (!known) await this.db.prepare('INSERT INTO caribbean_voyage_met(account_id,character_id,met_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').run(account, value.characterId, this.now());
      if (choose) await this.db.prepare('UPDATE caribbean_voyage_profiles SET selected_id=? WHERE account_id=?').run(value.characterId, account);
      await this.db.prepare('UPDATE caribbean_voyage_profiles SET revision=revision+1 WHERE account_id=?').run(account);
      return this.view(account);
    }, {lockKey: 'caribbean-voyage:' + account});
  }
}
