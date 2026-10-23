import { DemoWalletStore } from './demoWallet';
import { CasinoApiProWallet } from './casinoApiProWallet';
import { ModerationStore } from './moderation';
import { IntoxicationStore } from './intoxicationStore';
import { PaymentClient, paymentClientConfig } from './payments/client';
import { PaymentCredits } from './payments/credits';
import { normalizeAppearance, type Appearance } from '../src/shared/appearance';
import { isPlayerCharacter } from '../src/shared/characters';
import { PostgresDatabase } from './database';
import { applyAccountSchemaMigrations } from './game-database-migrations';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { FinanceAdminStore } from './admin/store';

export type Account = { id: string; email: string; name: string; skin: number | null; appearance?: Appearance | null };
type StoredAccount = Account & { password: string };
export class AuthError extends Error { constructor(public status: number, message: string) { super(message); } }
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
export const SESSION_AGE = 30 * 24 * 60 * 60 * 1000;
export class AccountStore {
  private db: PostgresDatabase;
  readonly ready: Promise<void>;
  readonly schema: string;
  readonly wallet: DemoWalletStore;
  readonly casinoApiProWallet: CasinoApiProWallet;
  readonly moderation: ModerationStore;
  readonly drinking: IntoxicationStore;
  readonly cryptoWallet: PaymentClient;
  readonly paymentCredits: PaymentCredits;
  readonly financeAdmin: FinanceAdminStore;
  readonly paymentEventSecret: string;
  readonly events = new EventEmitter();
  private sessionCleanup?: Promise<void>;
  private nextSessionCleanup = 0;
  constructor(name = 'royal_game') {
    this.db = new PostgresDatabase(name);
    this.schema = this.db.schema;
    const schemaReady = this.db.transaction(async () => this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password TEXT NOT NULL, skin INTEGER CHECK(skin >= 0), created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);`)).then(() => applyAccountSchemaMigrations(this.db));
    this.wallet = new DemoWalletStore(this.db, undefined, undefined, schemaReady);
    this.casinoApiProWallet = new CasinoApiProWallet(this.db, schemaReady);
    this.moderation = new ModerationStore(this.db, schemaReady);
    this.drinking = new IntoxicationStore(this.db, (id, state) => { this.events.emit('drinking', id, state); }, schemaReady);
    const payments = paymentClientConfig();
    this.paymentCredits = new PaymentCredits(this.db, schemaReady);
    this.paymentEventSecret = payments.eventSecret;
    this.cryptoWallet = new PaymentClient(payments, this.paymentCredits);
    this.financeAdmin = new FinanceAdminStore(this.db,schemaReady);
    this.ready = Promise.all([schemaReady, this.wallet.ready, this.casinoApiProWallet.ready, this.moderation.ready, this.drinking.ready, this.paymentCredits.ready,this.financeAdmin.ready]).then(() => {});
    this.events.setMaxListeners(0);
  }
  async login(rawEmail: unknown, rawPassword: unknown) {
    await this.ready;
    if (typeof rawEmail !== 'string' || typeof rawPassword !== 'string') throw new AuthError(400, 'Введи почту и пароль.');
    const email = rawEmail.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, 'Проверь адрес почты.');
    if (rawPassword.length < 8 || rawPassword.length > 128) throw new AuthError(400, 'Пароль должен содержать от 8 до 128 символов.');
    const fields = 'id,email,name,password,skin,appearance';
    let row = (await this.db.prepare(`SELECT ${fields} FROM accounts WHERE email = ?`).get(email)) as StoredAccount | undefined;
    if (!row) {
      const salt = randomBytes(16).toString('hex');
      const password = `${salt}:${(await derive(rawPassword, salt)).toString('hex')}`;
      const id = randomUUID();
      row = await this.db.transaction(async () => {
        const inserted = await this.db.prepare(`INSERT INTO accounts (id,email,name,password,created_at) VALUES (?,?,?,?,?) ON CONFLICT(email) DO NOTHING RETURNING ${fields}`)
          .get(id, email, `Игрок ${id.slice(0,6).toUpperCase()}`, password, Date.now());
        return (inserted ?? await this.db.prepare(`SELECT ${fields} FROM accounts WHERE email = ?`).get(email)) as StoredAccount;
      }, { lockKey: 'email:'+email });
    }
    const [salt, expected] = row.password.split(':');
    const actual = await derive(rawPassword, salt);
    if (!timingSafeEqual(actual, Buffer.from(expected, 'hex'))) throw new AuthError(401, 'Неверная почта или пароль.');
    const token = randomBytes(32).toString('hex');
    await this.clearExpiredSessions(Date.now());
    (await this.db.prepare('INSERT INTO sessions (hash,account_id,expires) VALUES (?,?,?)').run(digest(token), row.id, Date.now() + SESSION_AGE));
    return { token, account: this.publicAccount(row) };
  }
  private async clearExpiredSessions(now: number) {
    if (this.sessionCleanup) { await this.sessionCleanup; return; }
    if (now < this.nextSessionCleanup) return;
    const cleanup = this.db.transaction(async () => { await this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now); }, { lockKey: 'session-cleanup' });
    this.sessionCleanup = cleanup;
    try { await cleanup; this.nextSessionCleanup = now+60000; }
    finally { if (this.sessionCleanup === cleanup) this.sessionCleanup = undefined; }
  }
  private publicAccount(row: Account): Account { return { id: row.id, email: row.email, name: row.name, skin: row.skin, appearance: normalizeAppearance(row.appearance) }; }
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
    const[salt,expected]=String(row.password).split(':');
    if(!timingSafeEqual(await derive(value,salt),Buffer.from(expected,'hex')))throw new AuthError(401,'Неверный пароль подтверждения.');
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
  async close() { await this.ready; await this.db.close(); }
}
export const accounts = new AccountStore(process.env.NODE_ENV === 'test' ? process.env.AUTH_DB_PATH || ':memory:' : 'royal_game');
export function cookieToken(cookie: string | undefined) { return cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('royal_session='))?.slice('royal_session='.length); }
export function allowedOrigin(origin: string | undefined) {
  if (!origin) return true;
  if (process.env.NODE_ENV === 'production') return origin === process.env.PUBLIC_ORIGIN;
  return /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+):\d+$/.test(origin);
}
