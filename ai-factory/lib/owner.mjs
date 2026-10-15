import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export class Owner {
  constructor(directory) { this.directory = directory; this.file = join(directory, 'owner.json'); this.setupQueue = Promise.resolve(); }
  async read() {
    try { return JSON.parse(await readFile(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  }
  async save(value) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.file}.${randomBytes(8).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, this.file);
  }
  async init() {
    if (await this.read()) return;
    await this.save({ bootstrap: randomBytes(32).toString('hex'), expires: Date.now() + 86400000 });
  }
  async configured() { return Boolean((await this.read())?.password); }
  async serialize(change) {
    const previous = this.setupQueue;
    let release;
    this.setupQueue = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await change(); }
    finally { release(); }
  }
  async setup(token, password, email) { return this.serialize(() => this.performSetup(token, password, email)); }
  async performSetup(token, password, email) {
    const current = await this.read();
    if (current?.password || !current?.bootstrap || current.expires < Date.now() || !equal(token, current.bootstrap)) return false;
    const normalizedEmail = requireEmail(email);
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) throw Object.assign(new Error('Пароль должен содержать от 12 до 128 символов.'), { status: 400 });
    const salt = randomBytes(16).toString('hex');
    await this.save({ email: normalizedEmail, salt, password: scryptSync(password, salt, 64).toString('hex'), created: Date.now() });
    return true;
  }
  async bindEmail(email) {
    return this.serialize(async () => {
      const normalizedEmail = requireEmail(email);
      const current = await this.read();
      if (!current?.password) throw Object.assign(new Error('Владелец еще не настроен.'), { status: 409 });
      if (current.email) {
        if (!equal(normalizedEmail, current.email)) throw Object.assign(new Error('Почта владельца уже настроена.'), { status: 409 });
        return true;
      }
      await this.save({ ...current, email: normalizedEmail });
      return true;
    });
  }
  async verify(password, email) {
    const current = await this.read();
    const normalizedEmail = normalizeEmail(email);
    if (!current?.password || !current.email || !normalizedEmail || typeof password !== 'string' || password.length > 128) return false;
    const passwordMatches = equal(scryptSync(password, current.salt, 64).toString('hex'), current.password);
    return equal(normalizedEmail, current.email) && passwordMatches;
  }
}
function normalizeEmail(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || /\s/.test(email)) return null;
  const parts = email.split('@');
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (local.length > 64 || !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return null;
  const labels = domain.split('.');
  if (labels.length < 2 || labels.some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) return null;
  return email;
}
function requireEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw Object.assign(new Error('Укажи корректную почту.'), { status: 400 });
  return normalized;
}
const digest = value => createHash('sha256').update(String(value ?? '')).digest();
function equal(a, b) { return timingSafeEqual(digest(a), digest(b)); }

export class Sessions {
  constructor(pool, schema = 'ai_factory') { this.pool = pool; this.table = `${schema}.owner_sessions`; }
  async init() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.table}(hash text PRIMARY KEY, expires timestamptz NOT NULL)`);
  }
  async create() {
    const token = randomBytes(32).toString('hex');
    await this.pool.query(`DELETE FROM ${this.table} WHERE expires < now()`);
    await this.pool.query(`INSERT INTO ${this.table}(hash,expires) VALUES($1,now()+interval '7 days')`, [digest(token).toString('hex')]);
    return token;
  }
  async active(token) {
    if (!/^[a-f0-9]{64}$/.test(token || '')) return false;
    const result = await this.pool.query(`SELECT 1 FROM ${this.table} WHERE hash=$1 AND expires>now()`, [digest(token).toString('hex')]);
    return result.rowCount > 0;
  }
  async remove(token) { if (token) await this.pool.query(`DELETE FROM ${this.table} WHERE hash=$1`, [digest(token).toString('hex')]); }
}
