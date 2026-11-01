import { randomUUID } from 'node:crypto';
import type { PostgresDatabase, DatabaseRow } from './database';
import { applySchemaMigration } from './database-migrations';
import { CryptoError } from './crypto/config';
import { generatedAppearance, normalizeCharacterAppearance, SKIN_THEME, SKIN_UUID, SKIN_PRICE_UNITS, SKIN_VARIANTS, type SkinPurchase } from '../src/shared/skinStudio';
import type { SkinDescribedSnapshot, SkinNpcContext } from '../src/shared/skinDescription';
import type { SkinImageGenerator } from './skinImages';
import { skinDescription, type SkinDescriptionGenerator } from './skinDescriptions';
import type { FreeSkinGenerations } from './progression/skinGenerations';

export type SkinPayments = { skinPurchase(user: string, id: string, action: 'reserve' | 'capture' | 'refund'): Promise<SkinPurchase> };
export class SkinStudioError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new SkinStudioError(status, message); };
const ACTIVE = "('reserving','generating','capturing','ready','refunding')";
const CARD_FIELDS = 's.id,s.job_id,s.description,s.description_requested,s.description_attempts,j.prompt,j.created_at';
export class SkinStudioStore {
  readonly ready: Promise<void>;
  private running?: Promise<void>;
  private describing?: Promise<void>;
  constructor(private db: PostgresDatabase, private payments: SkinPayments, private images: SkinImageGenerator,
    private paymentEnabled: () => boolean, private changed: (accountId: string, appearance: unknown) => void,
    prerequisite: Promise<void> = Promise.resolve(), private now = Date.now, private descriptions?: SkinDescriptionGenerator,
    private freeGenerations?: FreeSkinGenerations) {
    this.ready = prerequisite.then(() => applySchemaMigration(db, { id: 'skin-studio-v1', statements: [
      `CREATE TABLE IF NOT EXISTS skin_jobs(id TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),theme TEXT NOT NULL,
        prompt TEXT NOT NULL,reference BYTEA,state TEXT NOT NULL CHECK(state IN ('reserving','generating','capturing','ready','selected','refunding','failed')),
        error TEXT NOT NULL DEFAULT '',selected_id TEXT,created_at BIGINT NOT NULL,lease_until BIGINT NOT NULL DEFAULT 0)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS skin_jobs_active ON skin_jobs(account_id) WHERE state IN ${ACTIVE}`,
      `CREATE TABLE IF NOT EXISTS generated_skins(id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES skin_jobs(id),
        variant INTEGER NOT NULL CHECK(variant BETWEEN 0 AND 2),image BYTEA NOT NULL,UNIQUE(job_id,variant))`,
      `CREATE INDEX IF NOT EXISTS skin_jobs_account ON skin_jobs(account_id,created_at DESC)`,
    ] })).then(() => applySchemaMigration(db, { id: 'skin-studio-leases-v2', statements: [
      "ALTER TABLE skin_jobs ADD COLUMN IF NOT EXISTS lease_token TEXT NOT NULL DEFAULT ''",
    ] })).then(() => applySchemaMigration(db, { id: 'skin-studio-variants-v3', statements: [
      'ALTER TABLE skin_jobs ADD COLUMN IF NOT EXISTS variant_count INTEGER NOT NULL DEFAULT 3 CHECK(variant_count IN (2,3))',
    ] })).then(()=>applySchemaMigration(db,{id:'skin-studio-payment-source-v1',statements:[
      "ALTER TABLE skin_jobs ADD COLUMN payment_source TEXT NOT NULL DEFAULT 'nile' CHECK(payment_source IN ('nile','virtual-usdt-v1'))",
    ]})).then(() => applySchemaMigration(db, { id: 'skin-studio-description-v1', statements: [
      "ALTER TABLE generated_skins ADD COLUMN description TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE generated_skins ADD COLUMN description_requested BOOLEAN NOT NULL DEFAULT false',
      'ALTER TABLE generated_skins ADD COLUMN description_lease_until BIGINT NOT NULL DEFAULT 0',
      "ALTER TABLE generated_skins ADD COLUMN description_lease_token TEXT NOT NULL DEFAULT ''",
      'ALTER TABLE generated_skins ADD COLUMN description_attempts INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE generated_skins ADD COLUMN description_retry_at BIGINT NOT NULL DEFAULT 0',
      "CREATE INDEX generated_skins_description_pending ON generated_skins(description_retry_at,description_lease_until) WHERE description='' AND description_requested",
    ] })).then(()=>applySchemaMigration(db,{id:'skin-studio-level-rewards-v1',statements:[
      'ALTER TABLE skin_jobs ADD COLUMN reward_grant_id TEXT',
    ]}));
  }
  enabled() { return this.paymentEnabled() && this.images.available(); }
  private card(row: DatabaseRow) { return { id: String(row.id), jobId: String(row.job_id), prompt: String(row.prompt), createdAt: Number(row.created_at),
    description: skinDescription(row.description) ?? '', descriptionPending: !row.description && row.description_requested === true
      && Number(row.description_attempts) < 3 && Boolean(this.descriptions?.available()) }; }
  async snapshot(accountId: string): Promise<SkinDescribedSnapshot> {
    await this.ready;
    const row = await this.db.prepare('SELECT * FROM skin_jobs WHERE account_id=? AND theme=? ORDER BY created_at DESC,id DESC LIMIT 1').get(accountId, SKIN_THEME.id);
    let job: SkinDescribedSnapshot['job'] = null;
    if (row) {
      const variants = row.state === 'ready' ? await this.db.prepare(`SELECT ${CARD_FIELDS} FROM generated_skins s JOIN skin_jobs j ON j.id=s.job_id WHERE j.id=? ORDER BY variant`).all(row.id) : [];
      job = { id: row.id, prompt: row.prompt, state: row.state, error: row.error, selectedId: row.selected_id, createdAt: Number(row.created_at), variantCount: Number(row.variant_count), variants: variants.map(s => this.card(s)), funding:row.reward_grant_id?'reward':'paid' };
    }
    const wardrobe = await this.db.prepare(`SELECT ${CARD_FIELDS} FROM generated_skins s JOIN skin_jobs j ON j.id=s.job_id
      WHERE j.account_id=? AND j.theme=? AND j.selected_id=s.id AND j.state='selected' ORDER BY j.created_at DESC LIMIT 200`).all(accountId, SKIN_THEME.id);
    const account = await this.db.prepare('SELECT skin,appearance FROM accounts WHERE id=?').get(accountId);
    return { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, variantCount: SKIN_VARIANTS, enabled: this.enabled(), job, wardrobe: wardrobe.map(s => this.card(s)), equippedId: generatedAppearance(account?.appearance)?.skinId ?? null,
      freeGenerations:await this.freeGenerations?.available(accountId)??[],
      character: { skin: Number(account?.skin ?? 0), appearance: normalizeCharacterAppearance(account?.appearance) } };
  }
  async create(accountId: string, value: unknown) {
    await this.ready;
    const op = value as { id: string; prompt: string; reference?: string; rewardGrantId?:string };
    // Accept old clients' reference field, but never retain or send their previous character.
    if (!op || !['id,prompt', 'id,prompt,reference','id,prompt,rewardGrantId','id,prompt,reference,rewardGrantId'].includes(Object.keys(op).sort().join(',')) || typeof op.id !== 'string' || !SKIN_UUID.test(op.id)
      || typeof op.prompt !== 'string' || !op.prompt.trim() || Array.from(op.prompt).length > 1000
      || (op.reference !== undefined && (typeof op.reference !== 'string' || op.reference.length > 1_500_000))
      || (op.rewardGrantId!==undefined && (typeof op.rewardGrantId!=='string'||!SKIN_UUID.test(op.rewardGrantId)))) fail(400, 'Опиши образ, до 1000 символов.');
    const prompt = op.prompt.trim();
    await this.db.transaction(async () => {
      const previous = await this.db.prepare('SELECT * FROM skin_jobs WHERE id=?').get(op.id);
      if (previous) {
        if (previous.account_id !== accountId || previous.prompt !== prompt || (previous.reward_grant_id??undefined)!==op.rewardGrantId) fail(409, 'Нельзя изменить отправленную генерацию.');
        return;
      }
      if (!this.enabled()) fail(503, 'Генерация пока недоступна. Деньги не списаны.');
      if (await this.db.prepare(`SELECT 1 FROM skin_jobs WHERE account_id=? AND state IN ${ACTIVE}`).get(accountId)) fail(409, 'Сначала дождись генерации и выбери один образ.');
      const recent = await this.db.prepare('SELECT count(*) AS n FROM skin_jobs WHERE account_id=? AND created_at>?').get(accountId, this.now() - 3600000);
      if (Number(recent?.n) >= 10) fail(429, 'Доступно до 10 генераций в час. Попробуй позже.');
      await this.db.prepare("INSERT INTO skin_jobs(id,account_id,theme,prompt,state,created_at,variant_count,payment_source,reward_grant_id) VALUES (?,?,?,?,'reserving',?,?,'virtual-usdt-v1',?)")
        .run(op.id, accountId, SKIN_THEME.id, prompt, this.now(), op.rewardGrantId?2:SKIN_VARIANTS,op.rewardGrantId??null);
      if(op.rewardGrantId){
        if(!this.freeGenerations)fail(503,'Бесплатная генерация временно недоступна. Награда сохранена.');
        try{await this.freeGenerations!.reserveForJob(accountId,op.id,op.rewardGrantId);}catch(error){if(error instanceof CryptoError)fail(error.status,error.message);throw error;}
      }
    }, { lockKey: 'skin:' + accountId });
    return this.snapshot(accountId);
  }
  async choose(accountId: string, jobId: string, skinId: string) {
    await this.ready;
    if (!SKIN_UUID.test(jobId) || !SKIN_UUID.test(skinId)) fail(400, 'Выбери один из готовых образов.');
    const equipped = await this.db.transaction(async () => {
      const job = await this.db.prepare('SELECT * FROM skin_jobs WHERE id=? AND account_id=? AND theme=?').get(jobId, accountId, SKIN_THEME.id);
      if (!job || (job.state !== 'ready' && job.state !== 'selected')) fail(409, 'Образы ещё не готовы.');
      if (job!.state === 'selected' && job!.selected_id !== skinId) fail(409, 'Из этой генерации уже выбран другой образ.');
      if (job!.state === 'selected') return false;
      if (!await this.db.prepare('SELECT 1 FROM generated_skins WHERE id=? AND job_id=?').get(skinId, jobId)) fail(404, 'Образ не найден.');
      await this.db.prepare("UPDATE skin_jobs SET state='selected',selected_id=? WHERE id=?").run(skinId, jobId);
      await this.db.prepare('DELETE FROM generated_skins WHERE job_id=? AND id<>?').run(jobId, skinId);
      await this.saveAppearance(accountId, skinId);
      return true;
    }, { lockKey: 'skin:' + accountId });
    if (equipped) this.changed(accountId, { version: 2, skinId, theme: SKIN_THEME.id });
    return this.snapshot(accountId);
  }
  private async saveAppearance(accountId: string, skinId: string) {
    await this.db.prepare('UPDATE accounts SET appearance=?::jsonb WHERE id=?').run(JSON.stringify({ version: 2, skinId, theme: SKIN_THEME.id }), accountId);
  }
  async equip(accountId: string, skinId: string) {
    await this.ready;
    if (!SKIN_UUID.test(skinId)) fail(400, 'Выбери сохранённый образ.');
    await this.db.transaction(async () => {
      if (!await this.db.prepare("SELECT 1 FROM skin_jobs WHERE account_id=? AND selected_id=? AND theme=? AND state='selected'").get(accountId, skinId, SKIN_THEME.id)) fail(404, 'Этого образа нет в твоём гардеробе.');
      await this.saveAppearance(accountId, skinId);
    }, { lockKey: 'skin:' + accountId });
    this.changed(accountId, { version: 2, skinId, theme: SKIN_THEME.id });
    return this.snapshot(accountId);
  }
  async asset(skinId: string, accountId?: string) {
    await this.ready;
    if (!SKIN_UUID.test(skinId)) return null;
    const row = await this.db.prepare(`SELECT s.image,j.state,j.account_id,j.selected_id FROM generated_skins s JOIN skin_jobs j ON j.id=s.job_id
      WHERE s.id=? AND j.theme=?`).get(skinId, SKIN_THEME.id);
    if (!row || (row.state === 'selected' ? row.selected_id !== skinId : row.account_id !== accountId || row.state !== 'ready')) return null;
    return { image: row.image as Buffer, public: row.state === 'selected' && row.selected_id === skinId };
  }
  /** Shared NPC observation: only the account's currently equipped and owned saved artwork. */
  async appearanceContext(accountId: string): Promise<SkinNpcContext | null> {
    await this.ready;
    const row = await this.db.prepare(`SELECT a.appearance,s.id,s.description FROM accounts a
      JOIN generated_skins s ON s.id=a.appearance->>'skinId' JOIN skin_jobs j ON j.id=s.job_id
      WHERE a.id=? AND j.account_id=a.id AND j.selected_id=s.id AND j.state='selected' AND j.theme=?`).get(accountId, SKIN_THEME.id);
    if (!row || generatedAppearance(row.appearance)?.skinId !== row.id) return null;
    const description = skinDescription(row.description);
    if (description) return { skinId: String(row.id), description };
    // Old wardrobe entries are analyzed only when an NPC needs the equipped look.
    await this.db.prepare('UPDATE generated_skins SET description_requested=true WHERE id=? AND description_requested=false').run(row.id);
    return null;
  }
  private async describeOne() {
    await this.ready;
    if (!this.descriptions?.available()) return;
    const now = this.now(), token = randomUUID();
    const row = await this.db.transaction(async () => {
      const skin = await this.db.prepare(`SELECT s.id,s.image,s.description_attempts FROM generated_skins s JOIN skin_jobs j ON j.id=s.job_id
        WHERE s.description='' AND s.description_requested AND s.description_lease_until<=? AND s.description_retry_at<=?
        AND j.theme=? AND (j.state='ready' OR (j.state='selected' AND j.selected_id=s.id))
        ORDER BY CASE WHEN EXISTS(SELECT 1 FROM accounts a WHERE a.id=j.account_id AND a.appearance->>'skinId'=s.id) THEN 0
          WHEN j.state='ready' THEN 1 ELSE 2 END,j.created_at DESC,s.variant LIMIT 1 FOR UPDATE OF s SKIP LOCKED`).get(now, now, SKIN_THEME.id);
      if (!skin) return;
      await this.db.prepare('UPDATE generated_skins SET description_lease_until=?,description_lease_token=?,description_attempts=description_attempts+1 WHERE id=?')
        .run(now + 60000, token, skin.id);
      return skin;
    }, { lockKey: 'skin-description-worker' });
    if (!row) return;
    try {
      const description = skinDescription(await this.descriptions.describe(row.image as Buffer));
      if (!description) throw new Error('Invalid skin description');
      await this.db.prepare("UPDATE generated_skins SET description=?,description_lease_until=0,description_lease_token='' WHERE id=? AND description='' AND description_lease_token=? AND description_lease_until>?")
        .run(description, row.id, token, this.now());
    } catch {
      const retry = this.now() + Math.min(3600000, 15000 * 2 ** Math.min(Number(row.description_attempts), 8));
      await this.db.prepare("UPDATE generated_skins SET description_retry_at=?,description_lease_until=0,description_lease_token='' WHERE id=? AND description_lease_token=?")
        .run(retry, row.id, token);
      console.error('Skin description will be retried', row.id);
    }
  }
  /** One leased job per process. A crashed image request is refunded instead of silently regenerated. */
  tick() {
    this.running ??= this.work().finally(() => { this.running = undefined; });
    this.describing ??= this.describeOne().finally(() => { this.describing = undefined; });
    return Promise.all([this.running, this.describing]).then(() => {});
  }
  drain() { return Promise.all([this.running, this.describing]).then(() => {}); }
  private async work() {
    await this.ready;
    const job = await this.db.transaction(async () => {
      const row = await this.db.prepare("SELECT * FROM skin_jobs WHERE state IN ('reserving','generating','capturing','refunding') AND lease_until<=? ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED").get(this.now());
      if (!row) return;
      const token = randomUUID();
      await this.db.prepare('UPDATE skin_jobs SET lease_until=?,lease_token=? WHERE id=?').run(this.now() + 600000, token, row.id);
      return { ...row, lease_token: token } as DatabaseRow;
    }, { lockKey: 'skin-worker' });
    if (!job) return;
    try {
      if (job.state === 'generating') {
        if (!await this.toRefund(job, 'Генерация прервалась.')) return;
        job.state = 'refunding';
      }
      if (job.state === 'reserving') {
        const purchase = await this.payments.skinPurchase(job.account_id, job.id, 'reserve');
        if (purchase.state !== 'reserved') throw new SkinStudioError(409, 'Покупка отменена. Создай новую генерацию.');
        if (!await this.withLease(job, async () => {
          await this.db.prepare("UPDATE skin_jobs SET state='generating' WHERE id=?").run(job.id);
        })) return;
        const results = await Promise.allSettled(Array.from({ length: Number(job.variant_count) }, (_, i) => this.images.generate(job.prompt, i, Number(job.variant_count))));
        if (results.some(r => r.status === 'rejected')) {
          console.error('Skin generation failed', job.id, results.filter(r => r.status === 'rejected').map(r => r.reason instanceof Error ? r.reason.message : 'Unknown image error'));
          if (!await this.toRefund(job, 'Не удалось подготовить все образы.')) return;
          job.state = 'refunding';
        } else {
          if (!await this.withLease(job, async () => {
            for (let i = 0; i < results.length; i++) await this.db.prepare('INSERT INTO generated_skins(id,job_id,variant,image,description_requested) VALUES (?,?,?,?,true)')
              .run(randomUUID(), job.id, i, (results[i] as PromiseFulfilledResult<Buffer>).value);
            await this.db.prepare("UPDATE skin_jobs SET state='capturing',reference=NULL WHERE id=?").run(job.id);
          })) return;
          job.state = 'capturing';
        }
      }
      if (job.state === 'capturing') {
        const purchase = await this.payments.skinPurchase(job.account_id, job.id, 'capture');
        if (purchase.state !== 'captured') throw new Error('Purchase capture not confirmed');
        await this.withLease(job, async () => {
          await this.db.prepare("UPDATE skin_jobs SET state='ready',lease_until=0 WHERE id=?").run(job.id);
        });
      }
      if (job.state === 'refunding') {
        const purchase = await this.payments.skinPurchase(job.account_id, job.id, 'refund');
        if (purchase.state !== 'refunded') throw new Error('Purchase refund not confirmed');
        await this.withLease(job, async () => {
          await this.db.prepare('DELETE FROM generated_skins WHERE job_id=?').run(job.id);
          await this.db.prepare("UPDATE skin_jobs SET state='failed',reference=NULL,lease_until=0,error=error || ? WHERE id=?")
            .run(job.reward_grant_id?' Бесплатная генерация возвращена. Можно попробовать ещё раз.':' Оплата возвращена или не списывалась. Можно попробовать ещё раз.',job.id);
        });
      }
    } catch (error) {
      // Unknown payment outcomes are retried with the same purchase id, never a new charge.
      if ((error instanceof CryptoError || error instanceof SkinStudioError) && error.status >= 400 && error.status < 500 && error.status !== 429
        && job.state === 'reserving') {
        await this.toRefund(job, error.message);
      }
      await this.withLease(job, async () => {
        await this.db.prepare('UPDATE skin_jobs SET lease_until=? WHERE id=?').run(this.now() + 15000, job.id);
      });
    }
  }
  private async withLease(job: DatabaseRow, action: () => Promise<void>) {
    return this.db.transaction(async () => {
      const current = await this.db.prepare('SELECT lease_token,lease_until FROM skin_jobs WHERE id=? FOR UPDATE').get(job.id);
      if (!current || current.lease_token !== job.lease_token || Number(current.lease_until) <= this.now()) return false;
      await action();
      return true;
    });
  }
  private toRefund(job: DatabaseRow, error: string) {
    return this.withLease(job, async () => {
      await this.db.prepare("UPDATE skin_jobs SET state='refunding',error=?,reference=NULL WHERE id=?").run(error, job.id);
    });
  }
}
