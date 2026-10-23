import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { PostgresDatabase, DatabaseRow } from './database';
import { applySchemaMigration } from './database-migrations';
import { CryptoError } from './crypto/config';
import { generatedAppearance, normalizeCharacterAppearance, SKIN_THEME, SKIN_UUID, SKIN_PRICE_UNITS, type SkinJob, type SkinStudioSnapshot, type SkinPurchase } from '../src/shared/skinStudio';
import type { SkinImageGenerator } from './skinImages';

export type SkinPayments = { skinPurchase(user: string, id: string, action: 'reserve' | 'capture' | 'refund'): Promise<SkinPurchase> };
export class SkinStudioError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (status: number, message: string): never => { throw new SkinStudioError(status, message); };
const ACTIVE = "('reserving','generating','capturing','ready','refunding')";
export class SkinStudioStore {
  readonly ready: Promise<void>;
  private running?: Promise<void>;
  constructor(private db: PostgresDatabase, private payments: SkinPayments, private images: SkinImageGenerator,
    private paymentEnabled: () => boolean, private changed: (accountId: string, appearance: unknown) => void,
    prerequisite: Promise<void> = Promise.resolve(), private now = Date.now) {
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
    ] }));
  }
  enabled() { return this.paymentEnabled() && this.images.available(); }
  private card(row: DatabaseRow) { return { id: String(row.id), jobId: String(row.job_id), prompt: String(row.prompt), createdAt: Number(row.created_at) }; }
  async snapshot(accountId: string): Promise<SkinStudioSnapshot> {
    await this.ready;
    const row = await this.db.prepare('SELECT * FROM skin_jobs WHERE account_id=? AND theme=? ORDER BY created_at DESC,id DESC LIMIT 1').get(accountId, SKIN_THEME.id);
    let job: SkinJob | null = null;
    if (row) {
      const variants = row.state === 'ready' ? await this.db.prepare('SELECT s.id,s.job_id,j.prompt,j.created_at FROM generated_skins s JOIN skin_jobs j ON j.id=s.job_id WHERE j.id=? ORDER BY variant').all(row.id) : [];
      job = { id: row.id, prompt: row.prompt, state: row.state, error: row.error, selectedId: row.selected_id, createdAt: Number(row.created_at), variants: variants.map(s => this.card(s)) };
    }
    const wardrobe = await this.db.prepare(`SELECT s.id,s.job_id,j.prompt,j.created_at FROM generated_skins s JOIN skin_jobs j ON j.id=s.job_id
      WHERE j.account_id=? AND j.theme=? AND j.selected_id=s.id AND j.state='selected' ORDER BY j.created_at DESC LIMIT 200`).all(accountId, SKIN_THEME.id);
    const account = await this.db.prepare('SELECT skin,appearance FROM accounts WHERE id=?').get(accountId);
    return { theme: SKIN_THEME, priceUnits: SKIN_PRICE_UNITS, enabled: this.enabled(), job, wardrobe: wardrobe.map(s => this.card(s)), equippedId: generatedAppearance(account?.appearance)?.skinId ?? null,
      character: { skin: Number(account?.skin ?? 0), appearance: normalizeCharacterAppearance(account?.appearance) } };
  }
  async create(accountId: string, value: unknown) {
    await this.ready;
    const op = value as { id: string; prompt: string; reference: string };
    if (!op || Object.keys(op).sort().join(',') !== 'id,prompt,reference' || typeof op.id !== 'string' || !SKIN_UUID.test(op.id)
      || typeof op.prompt !== 'string' || !op.prompt.trim() || Array.from(op.prompt).length > 1000
      || typeof op.reference !== 'string' || op.reference.length > 1_500_000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(op.reference)) fail(400, 'Опиши образ, до 1000 символов.');
    const prompt = op.prompt.trim();
    const reference = Buffer.from(op.reference.split(',')[1], 'base64');
    try {
      const meta = await sharp(reference, { limitInputPixels: 1_000_000 }).metadata();
      if (meta.format !== 'png' || !meta.width || !meta.height || meta.width > 1024 || meta.height > 1024) throw new Error('Invalid reference');
    } catch { fail(400, 'Не удалось прочитать текущего персонажа. Обнови страницу.'); }
    await this.db.transaction(async () => {
      const previous = await this.db.prepare('SELECT * FROM skin_jobs WHERE id=?').get(op.id);
      if (previous) {
        if (previous.account_id !== accountId || previous.prompt !== prompt) fail(409, 'Нельзя изменить отправленную генерацию.');
        return;
      }
      if (!this.enabled()) fail(503, 'Генерация пока недоступна. Деньги не списаны.');
      if (await this.db.prepare(`SELECT 1 FROM skin_jobs WHERE account_id=? AND state IN ${ACTIVE}`).get(accountId)) fail(409, 'Сначала дождись генерации и выбери один образ.');
      const recent = await this.db.prepare('SELECT count(*) AS n FROM skin_jobs WHERE account_id=? AND created_at>?').get(accountId, this.now() - 3600000);
      if (Number(recent?.n) >= 10) fail(429, 'Доступно до 10 генераций в час. Попробуй позже.');
      await this.db.prepare("INSERT INTO skin_jobs(id,account_id,theme,prompt,reference,state,created_at) VALUES (?,?,?,?,?,'reserving',?)")
        .run(op.id, accountId, SKIN_THEME.id, prompt, reference, this.now());
    }, { lockKey: 'skin:' + accountId });
    return this.snapshot(accountId);
  }
  async choose(accountId: string, jobId: string, skinId: string) {
    await this.ready;
    if (!SKIN_UUID.test(jobId) || !SKIN_UUID.test(skinId)) fail(400, 'Выбери один из трёх образов.');
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
  /** One leased job per process. A crashed image request is refunded instead of silently regenerated. */
  tick() {
    if (this.running) return this.running;
    this.running = this.work().finally(() => { this.running = undefined; });
    return this.running;
  }
  drain() { return this.running ?? Promise.resolve(); }
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
        const results = await Promise.allSettled([0, 1, 2].map(i => this.images.generate(job.prompt, job.reference, i)));
        if (results.some(r => r.status === 'rejected')) {
          console.error('Skin generation failed', job.id, results.filter(r => r.status === 'rejected').map(r => r.reason instanceof Error ? r.reason.message : 'Unknown image error'));
          if (!await this.toRefund(job, 'Не удалось подготовить все три образа.')) return;
          job.state = 'refunding';
        } else {
          if (!await this.withLease(job, async () => {
            for (let i = 0; i < 3; i++) await this.db.prepare('INSERT INTO generated_skins(id,job_id,variant,image) VALUES (?,?,?,?)')
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
          await this.db.prepare("UPDATE skin_jobs SET state='failed',reference=NULL,lease_until=0,error=error || ' Оплата возвращена или не списывалась. Можно попробовать ещё раз.' WHERE id=?")
            .run(job.id);
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
