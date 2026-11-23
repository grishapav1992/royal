import { DemoWalletStore } from './demoWallet';
import { demoBalanceUnits, recordDemoUnits, saveDemoUnits } from './demoWalletAmounts';
import { CLUB_FINE_SOURCE } from '../src/shared/security';
import {CaribbeanCrewStore} from './caribbeanCrew';
import {StarSpinCollectionStore} from './starSpinCollection';
import { CasinoApiProWallet } from './casinoApiProWallet';
import { ModerationStore } from './moderation';
import { ClubSanctionStore } from './clubSanctions';
import { IntoxicationStore } from './intoxicationStore';
import { PaymentClient, paymentClientConfig } from './payments/client';
import { PaymentCredits } from './payments/credits';
import { SandboxPaymentStore } from './payments/sandbox';
import { sandboxConfig, SandboxNowPayments } from './payments/sandbox-provider';
import { normalizeAppearance } from '../src/shared/appearance';
import { normalizeCharacterAppearance, type CharacterAppearance } from '../src/shared/skinStudio';
import { SkinStudioStore } from './skinStudio';
import { CodexSkinDescriptions } from './skinDescriptions';
import { CodexSkinImages } from './skinImages';
import { NileSkinPayments } from './nileSkinPayments';
import { CommonSkinPayments } from './skinPayments';
import { VirtualPvpLedger } from './pvp/virtual-wallet';
import { PvpStore } from './pvp/store';
import { NileCombatEscrow } from './finance/combat-escrow';
import { isPlayerCharacter } from '../src/shared/characters';
import { PostgresDatabase } from './database';
import { applyAccountSchemaMigrations } from './game-database-migrations';
import { randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { FinanceAdminStore } from './admin/store';
import { ProgressionStore } from './progression/store';
import { instrumentProgressionWallet, instrumentProgressionPvpLedger } from './progression/sources';
import { LiveFreeSpinService } from './progression/freeSpins';
import { FreeSkinGenerations } from './progression/skinGenerations';

export type Account = { id: string; email: string; name: string; skin: number | null; appearance?: CharacterAppearance | null };
type StoredAccount = Account & { password: string; failed_logins: number; locked_until: number | null };
export class AuthError extends Error {
  constructor(public status: number, message: string, public code?: string, public retryAt?: number) { super(message); }
}
export type SendRecoveryCode = (email: string, code: string) => Promise<void>;

const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_LOCK_MS = 30 * 60 * 1000;
const CODE_FAILURE_LIMIT = 5;
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RESEND_MS = 60 * 1000;
const RESET_TTL_MS = 10 * 60 * 1000;
const PASSWORD_RULES = 'Пароль должен содержать от 8 до 128 символов, прописную и строчную буквы, цифру и спецсимвол.';

function accountEmail(raw: unknown) {
  if (typeof raw !== 'string') throw new AuthError(400, 'Введи почту и пароль.');
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, 'Проверь адрес почты.');
  return email;
}

function newPassword(value: unknown) {
  if (typeof value !== 'string' || [...value].length < 8 || value.length > 128 ||
      !/\p{Lu}/u.test(value) || !/\p{Ll}/u.test(value) || !/\p{Nd}/u.test(value) || !/[\p{P}\p{S}]/u.test(value)) {
    throw new AuthError(400, PASSWORD_RULES, 'password_requirements');
  }
  return value;
}

const lockedError = (until: number) => new AuthError(429, 'Пять неверных попыток. Вход заблокирован на 30 минут.', 'login_locked', until);
const invalidCode = () => new AuthError(400, 'Код неверный или устарел. Проверь его или запроси новый.');
const invalidReset = () => new AuthError(400, 'Время смены пароля истекло. Запроси новый код.', 'reset_expired');
function gameName(value: unknown) {
  if (typeof value !== 'string') throw new AuthError(400, 'Введи игровое имя.');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (Array.from(name).length > 24 || !/[\p{L}\p{N}\p{P}\p{S}]/u.test(name) || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name)) {
    throw new AuthError(400, 'Игровое имя должно содержать от 1 до 24 символов.');
  }
  return name;
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key));
});
async function secretHash(value: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${(await derive(value, salt)).toString('hex')}`;
}
async function matchesSecret(value: string, stored: string) {
  const [salt, expected] = stored.split(':');
  return timingSafeEqual(await derive(value, salt), Buffer.from(expected, 'hex'));
}

export const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
export class AccountStore {
  private db: PostgresDatabase;
  readonly ready: Promise<void>;
  readonly schema: string;
  readonly wallet: DemoWalletStore;
  readonly progression: ProgressionStore;
  readonly rewardSpins: LiveFreeSpinService;
  readonly caribbeanCrew:CaribbeanCrewStore;
  readonly starSpinCollection:StarSpinCollectionStore;
  readonly pvp: PvpStore;
  readonly combat: NileCombatEscrow;
  readonly casinoApiProWallet: CasinoApiProWallet;
  readonly moderation: ModerationStore;
  readonly clubSanctions: ClubSanctionStore;
  readonly drinking: IntoxicationStore;
  readonly cryptoWallet: PaymentClient;
  readonly skinStudio: SkinStudioStore;
  readonly skinRewards: FreeSkinGenerations;
  readonly paymentCredits: PaymentCredits;
  readonly sandboxPayments: SandboxPaymentStore;
  readonly financeAdmin: FinanceAdminStore;
  readonly paymentEventSecret: string;
  readonly events = new EventEmitter();
  private sessionCleanup?: Promise<void>;
  private nextSessionCleanup = 0;
  private wagerSweep?:ReturnType<typeof setInterval>;
  private sweeping?:Promise<unknown>;
  constructor(name = 'royal_game') {
    this.db = new PostgresDatabase(name);
    this.schema = this.db.schema;
    const schemaReady = this.db.transaction(async () => this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, skin INTEGER CHECK(skin >= 0), created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);`)).then(() => applyAccountSchemaMigrations(this.db));
    const commonWallet = new DemoWalletStore(this.db, undefined, undefined, schemaReady);
    this.progression = new ProgressionStore(this.db,{prerequisite:commonWallet.ready,
      onLevel: (accountId, level) => { this.events.emit('progression-level', accountId, level); }});
    this.wallet = instrumentProgressionWallet(this.db,commonWallet,this.progression);
    this.rewardSpins = new LiveFreeSpinService(this.db,this.wallet,this.progression,undefined,undefined,id=>this.financeAdmin.assertAllowed(id));
    this.caribbeanCrew=new CaribbeanCrewStore(this.db,schemaReady);
    this.starSpinCollection=new StarSpinCollectionStore(this.db,schemaReady);
    const sandbox = sandboxConfig();
    this.sandboxPayments = new SandboxPaymentStore(this.db, sandbox, new SandboxNowPayments(sandbox), this.wallet.ready);
    const virtualWallet=instrumentProgressionPvpLedger(this.db,new VirtualPvpLedger(this.db,this.wallet),this.progression);
    this.pvp=new PvpStore(virtualWallet);
    this.combat=new NileCombatEscrow(virtualWallet);
    this.casinoApiProWallet = new CasinoApiProWallet(this.db, schemaReady);
    this.moderation = new ModerationStore(this.db, schemaReady);
    this.drinking = new IntoxicationStore(this.db, (id, state) => { this.events.emit('drinking', id, state); }, schemaReady);
    const payments = paymentClientConfig();
    this.paymentCredits = new PaymentCredits(this.db, schemaReady);
    this.paymentEventSecret = payments.eventSecret;
    this.cryptoWallet = new PaymentClient(payments, this.paymentCredits);
    this.financeAdmin = new FinanceAdminStore(this.db,schemaReady);
    const commonSkins=new CommonSkinPayments(this.db,this.wallet.ready),legacySkins=new NileSkinPayments();
    this.skinRewards=new FreeSkinGenerations(this.db,this.progression.ready);
    this.skinStudio = new SkinStudioStore(this.db, {skinPurchase:async(account,id,action,terms)=>{
      const job=await this.db.prepare('SELECT payment_source,reward_grant_id FROM skin_jobs WHERE id=?').get(id);
      if(job?.reward_grant_id)return this.skinRewards.skinPurchase(account,id,action);
      if(job?.payment_source==='nile')return legacySkins.skinPurchase(account,id,action);
      return commonSkins.skinPurchase(account,id,action,terms);
    }}, new CodexSkinImages(), () => true,
      (id, appearance) => this.events.emit('appearance', id, appearance), Promise.all([this.wallet.ready,this.skinRewards.ready]).then(()=>{}), Date.now, new CodexSkinDescriptions(), this.skinRewards, id => this.clubSanctions.revealedDisguises(id));
    this.clubSanctions = new ClubSanctionStore(this.db, this.moderation.ready, this.skinStudio.ready,
      (accountId, operationId, amountCents) => this.chargeClubFine(accountId, operationId, amountCents));
    this.ready = Promise.all([schemaReady, this.wallet.ready, this.progression.ready, this.rewardSpins.ready, this.caribbeanCrew.ready, this.starSpinCollection.ready, this.sandboxPayments.ready, this.pvp.ready, this.combat.ready, this.casinoApiProWallet.ready, this.moderation.ready, this.clubSanctions.ready, this.drinking.ready, this.paymentCredits.ready, this.skinStudio.ready, this.financeAdmin.ready]).then(() => {
      this.wagerSweep=setInterval(()=>{if(!this.sweeping)this.sweeping=Promise.allSettled([this.pvp.sweep(),this.combat.recoverExpired(),this.progression.processPending()]).finally(()=>{this.sweeping=undefined;});},1000);
      this.wagerSweep.unref();
    });
    this.events.setMaxListeners(0);
  }
  private async chargeClubFine(accountId: string, operationId: string, amountCents: number) {
    // The sanction store holds the same account lock as game wagers and skin purchases.
    if (!this.db.inTransaction) throw new Error('Fine debit requires an account transaction');
    await this.wallet.ready;
    await this.financeAdmin.assertAllowed(accountId);
    const balance = await demoBalanceUnits(this.db, accountId);
    if (balance < amountCents) return false;
    const remaining = balance - amountCents;
    await saveDemoUnits(this.db, accountId, remaining);
    await recordDemoUnits(this.db, accountId, `${CLUB_FINE_SOURCE}:${operationId}`, 'bet', -amountCents, remaining, CLUB_FINE_SOURCE, 'Клубный штраф');
    return true;
  }
  async login(rawEmail: unknown, rawPassword: unknown) {
    await this.ready;
    const email = accountEmail(rawEmail);
    if (typeof rawPassword !== 'string' || !rawPassword.length || rawPassword.length > 128) {
      throw new AuthError(400, 'Введи пароль длиной до 128 символов.');
    }
    await this.clearExpiredSessions(Date.now());
    const result = await this.db.transaction(async () => {
      const fields = 'id,email,name,password,skin,appearance,failed_logins,locked_until';
      let row = await this.db.prepare(`SELECT ${fields} FROM accounts WHERE email = ?`).get(email) as StoredAccount | undefined;
      const now = Date.now();
      if (!row) {
        const password = await secretHash(newPassword(rawPassword));
        const id = randomUUID();
        row = await this.db.prepare(`INSERT INTO accounts (id,email,name,password,created_at) VALUES (?,?,?,?,?) RETURNING ${fields}`)
          .get(id, email, `Игрок ${id.slice(0,6).toUpperCase()}`, password, now) as StoredAccount;
      } else {
        if (row.locked_until !== null && row.locked_until > now) return lockedError(row.locked_until);
        if (!(await matchesSecret(rawPassword, row.password))) {
          const failures = row.locked_until === null ? row.failed_logins + 1 : 1;
          const until = failures >= LOGIN_FAILURE_LIMIT ? Date.now() + LOGIN_LOCK_MS : null;
          await this.db.prepare('UPDATE accounts SET failed_logins=?,locked_until=? WHERE id=?').run(failures, until, row.id);
          return until === null ? new AuthError(401, 'Неверная почта или пароль.', 'invalid_credentials') : lockedError(until);
        }
        if (row.failed_logins) await this.db.prepare('UPDATE accounts SET failed_logins=0,locked_until=NULL WHERE id=?').run(row.id);
      }
      const token = randomBytes(32).toString('hex');
      await this.db.prepare('INSERT INTO sessions (hash,account_id,expires) VALUES (?,?,?)').run(digest(token), row.id, Date.now() + SESSION_AGE);
      return { token, account: this.publicAccount(row) };
    }, { lockKey: 'email:' + email });
    if (result instanceof AuthError) throw result;
    return result;
  }

  async requestPasswordCode(rawEmail: unknown, send: SendRecoveryCode) {
    await this.ready;
    const email = accountEmail(rawEmail);
    // Do the same password-hashing work even when the address is unknown or a resend is suppressed.
    const code = randomInt(1000000).toString().padStart(6, '0');
    const hash = await secretHash(code);
    await this.db.transaction(async () => {
      const account = await this.db.prepare('SELECT id FROM accounts WHERE email=?').get(email);
      if (!account) return;
      const previous = await this.db.prepare('SELECT issued_at FROM password_recovery WHERE account_id=?').get(account.id);
      const now = Date.now();
      if (previous && previous.issued_at + CODE_RESEND_MS > now) return;
      await this.db.prepare(`
        INSERT INTO password_recovery (account_id,code_hash,issued_at,code_expires)
        VALUES (?,?,?,?)
        ON CONFLICT (account_id) DO UPDATE SET code_hash=EXCLUDED.code_hash, issued_at=EXCLUDED.issued_at,
          code_expires=EXCLUDED.code_expires, failed_codes=0
      `).run(account.id, hash, now, now + CODE_TTL_MS);
      await send(email, code);
    }, { lockKey: 'email:' + email });
  }

  async verifyPasswordCode(rawEmail: unknown, code: unknown) {
    await this.ready;
    const email = accountEmail(rawEmail);
    if (typeof code !== 'string' || !/^\d{6}$/.test(code)) throw invalidCode();
    const token = await this.db.transaction(async () => {
      const row = await this.db.prepare(`
        SELECT r.* FROM password_recovery r JOIN accounts a ON a.id=r.account_id WHERE a.email=?
      `).get(email);
      if (!row?.code_hash || row.code_expires <= Date.now() || row.failed_codes >= CODE_FAILURE_LIMIT) return;
      if (!(await matchesSecret(code, row.code_hash))) {
        await this.db.prepare('UPDATE password_recovery SET failed_codes=failed_codes+1 WHERE account_id=?').run(row.account_id);
        return;
      }
      const grant = randomBytes(32).toString('hex');
      await this.db.prepare('UPDATE password_recovery SET code_hash=NULL,reset_hash=?,reset_expires=? WHERE account_id=?')
        .run(digest(grant), Date.now() + RESET_TTL_MS, row.account_id);
      return grant;
    }, { lockKey: 'email:' + email });
    if (!token) throw invalidCode();
    return token;
  }

  async resetPassword(rawEmail: unknown, token: unknown, rawPassword: unknown) {
    await this.ready;
    const email = accountEmail(rawEmail);
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw invalidReset();
    const sessions = await this.db.transaction(async () => {
      const row = await this.db.prepare(`
        SELECT r.account_id FROM password_recovery r JOIN accounts a ON a.id=r.account_id
        WHERE a.email=? AND r.reset_hash=? AND r.reset_expires>?
      `).get(email, digest(token), Date.now());
      if (!row) throw invalidReset();
      const password = await secretHash(newPassword(rawPassword));
      await this.db.prepare('UPDATE accounts SET password=?,failed_logins=0,locked_until=NULL WHERE id=?').run(password, row.account_id);
      await this.db.prepare('DELETE FROM password_recovery WHERE account_id=?').run(row.account_id);
      return this.db.prepare('DELETE FROM sessions WHERE account_id=? RETURNING hash').all(row.account_id);
    }, { lockKey: 'email:' + email });
    for (const { hash } of sessions) this.events.emit('logout', hash);
  }

  private async clearExpiredSessions(now: number) {
    if (this.sessionCleanup) { await this.sessionCleanup; return; }
    if (now < this.nextSessionCleanup) return;
    const cleanup = this.db.transaction(async () => { await this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now); }, { lockKey: 'session-cleanup' });
    this.sessionCleanup = cleanup;
    try { await cleanup; this.nextSessionCleanup = now+60000; }
    finally { if (this.sessionCleanup === cleanup) this.sessionCleanup = undefined; }
  }
  private publicAccount(row: Account): Account { return { id: row.id, email: row.email, name: row.name, skin: row.skin, appearance: normalizeCharacterAppearance(row.appearance) }; }
  async currentAccount(id: string): Promise<Account | undefined> {
    await this.ready;
    const row = await this.db.prepare('SELECT id,email,name,skin,appearance FROM accounts WHERE id=?').get(id) as Account | undefined;
    return row ? this.publicAccount(row) : undefined;
  }
  async session(token: string | undefined) {
    await this.ready;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
    const hash = digest(token);
    const row = (await this.db.prepare('SELECT a.id,a.email,a.name,a.skin,a.appearance FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.hash=? AND s.expires>?').get(hash, Date.now())) as Account | undefined;
    return row ? { account: this.publicAccount(row), hash } : undefined;
  }
  async active(hash: string) { await this.ready; return !!(await this.db.prepare('SELECT hash FROM sessions WHERE hash=? AND expires>?').get(hash, Date.now())); }
  async verifyPassword(id:string,value:unknown){
    await this.ready;
    if(typeof value!=='string'||value.length<8||value.length>128)throw new AuthError(401,'Подтверди действие паролем своего аккаунта.');
    const row=await this.db.prepare('SELECT password FROM accounts WHERE id=?').get(id);
    if(!row)throw new AuthError(401,'Аккаунт не найден.');
    if (!(await matchesSecret(value, row.password)))throw new AuthError(401,'Неверный пароль подтверждения.');
  }
  async health() { await this.ready; await this.db.prepare('SELECT 1').get(); }
  async select(id: string, skin: unknown, rawName?: unknown, rawAppearance?: unknown) {
    await this.ready;
    const custom = rawAppearance !== undefined;
    const appearance = custom ? normalizeAppearance(rawAppearance) : null;
    if (custom && !appearance) throw new AuthError(400, 'Проверь настройки внешности.');
    if (!custom && !isPlayerCharacter(skin)) throw new AuthError(400, 'Выбери персонажа из списка.');
    const selectedSkin = custom ? 0 : skin as number;
    const name = rawName === undefined ? undefined : gameName(rawName);
    if (name === undefined) await this.db.prepare('UPDATE accounts SET skin=?,appearance=?::jsonb WHERE id=?').run(selectedSkin, appearance ? JSON.stringify(appearance) : null, id);
    else await this.db.prepare('UPDATE accounts SET skin=?,appearance=?::jsonb,name=? WHERE id=?').run(selectedSkin, appearance ? JSON.stringify(appearance) : null, name, id);
    if (name !== undefined) this.events.emit('name', id, name);
    this.events.emit('skin', id, selectedSkin);
    this.events.emit('appearance', id, appearance);
  }
  async rename(id: string, rawName: unknown) {
    await this.ready;
    const name = gameName(rawName);
    (await this.db.prepare('UPDATE accounts SET name=? WHERE id=?').run(name, id));
    this.events.emit('name', id, name);
  }
  async logout(token: string | undefined) {
    await this.ready;
    if (!token) return;
    const hash = digest(token); (await this.db.prepare('DELETE FROM sessions WHERE hash=?').run(hash));
    this.events.emit('logout', hash);
  }
  async close() { await this.ready; clearInterval(this.wagerSweep);await this.sweeping; await this.db.close(); }
}
export const accounts = new AccountStore(process.env.NODE_ENV === 'test' ? process.env.AUTH_DB_PATH || ':memory:' : 'royal_game');
export function cookieToken(cookie: string | undefined) { return cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('royal_session='))?.slice('royal_session='.length); }
export function allowedOrigin(origin: string | undefined) {
  if (!origin) return true;
  if (process.env.NODE_ENV === 'production') return origin === process.env.PUBLIC_ORIGIN;
  return /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+):\d+$/.test(origin);
}
