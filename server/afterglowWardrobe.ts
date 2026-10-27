import type {PostgresDatabase} from './database';
import {WalletError} from './demoWallet';
import {applySchemaMigration} from './database-migrations';
import {migrateAfterglowProgress, creditAfterglowProgress} from './afterglowProgress';
import {AFTER_LOOK_TARGET_UNITS, AFTER_STARTER_GIRL, afterAlbumUnlocked, validAfterLookChoice, validAfterWardrobe, type AfterWardrobe} from '../src/shared/afterglowWardrobe';

/** Cosmetic progress is committed inside the existing account transaction. */
export class AfterglowWardrobeStore {
  readonly ready: Promise<void>;
  constructor(private db: PostgresDatabase, prerequisite: Promise<void>) {
    this.ready = prerequisite.then(() => db.exec(`
      CREATE TABLE IF NOT EXISTS demo_afterglow_wardrobe (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        selected_girl INTEGER NOT NULL CHECK(selected_girl BETWEEN 0 AND 3),
        selected_look INTEGER NOT NULL CHECK(selected_look BETWEEN 0 AND 1),
        revision BIGINT NOT NULL CHECK(revision>=0));
      CREATE TABLE IF NOT EXISTS demo_afterglow_girl_progress (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        girl INTEGER NOT NULL CHECK(girl BETWEEN 0 AND 3),
        spins INTEGER NOT NULL CHECK(spins BETWEEN 0 AND 50), PRIMARY KEY(account_id,girl));
      CREATE TABLE IF NOT EXISTS demo_afterglow_round_girls (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL, girl INTEGER NOT NULL CHECK(girl BETWEEN 0 AND 3),
        counted BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(account_id,session_id));
    `)).then(() => applySchemaMigration(db, {
      id: 'afterglow-look-rarity-v2',
      statements: [
        'ALTER TABLE demo_afterglow_girl_progress ADD COLUMN IF NOT EXISTS unlocked BOOLEAN NOT NULL DEFAULT FALSE',
        // This one-time migration preserves looks earned under the former 50-round rule.
        'UPDATE demo_afterglow_girl_progress SET unlocked=TRUE WHERE spins>=50',
        'ALTER TABLE demo_afterglow_girl_progress DROP CONSTRAINT IF EXISTS demo_afterglow_girl_progress_spins_check',
        'ALTER TABLE demo_afterglow_girl_progress ADD CONSTRAINT demo_afterglow_girl_progress_spins_check CHECK(spins>=0 AND spins<=CASE girl WHEN 0 THEN 200 WHEN 1 THEN 50 WHEN 2 THEN 150 WHEN 3 THEN 100 END)',
      ],
    })).then(() => migrateAfterglowProgress(db));
  }
  async read(account: string): Promise<AfterWardrobe> {
    const row = await this.db.prepare('SELECT * FROM demo_afterglow_wardrobe WHERE account_id=?').get(account);
    const album = await this.db.prepare('SELECT points_units FROM demo_afterglow_stake_album WHERE account_id=?').get(account);
    const progress = await this.db.prepare('SELECT girl,points_units FROM demo_afterglow_stake_girls WHERE account_id=?').all(account);
    const active = await this.db.prepare("SELECT s.id,g.girl FROM demo_casino_sessions s LEFT JOIN demo_afterglow_round_girls g ON g.account_id=s.account_id AND g.session_id=s.id WHERE s.account_id=? AND s.game_id='studio-afterglow' AND s.state='active' LIMIT 1").get(account);
    const pointsUnits = [0, 0, 0, 0], unlocked = [false, false, false, false];
    for (const p of progress) {const i=Number(p.girl);pointsUnits[i]=Number(p.points_units);unlocked[i]=pointsUnits[i]===AFTER_LOOK_TARGET_UNITS[i];}
    const albumUnits = Number(album?.points_units ?? 0), available = afterAlbumUnlocked(albumUnits);
    const activeGirl = active?.girl == null ? null : Number(active.girl);
    const savedGirl = Number(row?.selected_girl ?? AFTER_STARTER_GIRL);
    const selectedGirl = activeGirl ?? (available[savedGirl] ? savedGirl : AFTER_STARTER_GIRL);
    const selectedLook = selectedGirl === savedGirl ? Number(row?.selected_look ?? 0) as 0 | 1 : 0;
    const result: AfterWardrobe = {version: 4, revision: Number(row?.revision ?? 0),
      selectedGirl, selectedLook, albumUnits, pointsUnits, unlocked, active: !!active, activeGirl};
    if (!validAfterWardrobe(result)) throw Error('Invalid Afterglow wardrobe');
    return result;
  }
  async snapshot(account: string) {
    await this.ready;
    return this.db.transaction(() => this.read(account), {lockKey: 'account:' + account});
  }
  async choose(account: string, value: unknown) {
    await this.ready;
    if (!validAfterLookChoice(value)) throw new WalletError(400, 'Некорректный выбор образа.');
    return this.db.transaction(async () => {
      const current = await this.read(account);
      if (current.selectedGirl === value.girl && current.selectedLook === value.look) {
        const saved = await this.db.prepare('SELECT selected_girl,selected_look FROM demo_afterglow_wardrobe WHERE account_id=?').get(account);
        if (!saved || Number(saved.selected_girl) === value.girl && Number(saved.selected_look) === value.look) return current;
      }
      if (current.active) throw new WalletError(409, 'Заверши фотосессию, чтобы сменить героиню или образ.');
      if (value.revision !== current.revision) throw new WalletError(409, 'Образ уже изменился. Обнови альбом.');
      if (!afterAlbumUnlocked(current.albumUnits)[value.girl]) throw new WalletError(409, 'Эта героиня ещё не открыта.');
      if (value.look === 1 && !current.unlocked[value.girl]) throw new WalletError(409, 'Второй образ ещё не открыт.');
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw Error('Afterglow wardrobe revision limit');
      await this.db.prepare('INSERT INTO demo_afterglow_wardrobe(account_id,selected_girl,selected_look,revision) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET selected_girl=EXCLUDED.selected_girl,selected_look=EXCLUDED.selected_look,revision=EXCLUDED.revision').run(account, value.girl, value.look, current.revision + 1);
      return this.read(account);
    }, {lockKey: 'account:' + account});
  }
  async beginRound(account: string, session: string) {
    const current = await this.read(account);
    await this.db.prepare('INSERT INTO demo_afterglow_round_girls(account_id,session_id,girl) VALUES(?,?,?)').run(account, session, current.selectedGirl);
  }
  async assertSelection(account: string, value: unknown) {
    if (value === undefined) return;
    if (!validAfterLookChoice(value)) throw new WalletError(400, 'Некорректный выбор героини.');
    const current = await this.read(account);
    if (current.revision !== value.revision || current.selectedGirl !== value.girl || current.selectedLook !== value.look)
      throw new WalletError(409, 'Героиня изменилась в другом окне. Обнови альбом перед вращением.');
  }
  async completeRound(account: string, session: string, stakeUnits: string) {
    await creditAfterglowProgress(this.db, account, session, stakeUnits);
  }
}
