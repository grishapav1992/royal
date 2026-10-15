import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { Owner } from '../lib/owner.mjs';
import { Store } from '../lib/store.mjs';
import { config } from '../lib/config.mjs';

// The private pre-migration owner backup arrives through stdin and is never logged.
const before = JSON.parse(readFileSync(0, 'utf8'));
const expectedEmail = process.argv[2]?.trim().toLowerCase();
assert.ok(expectedEmail, 'Owner email argument required.');
const options = config();
const after = await new Owner(options.data).read();
assert.ok(isDeepStrictEqual(after, { ...before, email: expectedEmail }), 'Owner data changed during migration.');
const base = `${options.origin}${options.prefix}`;
const bootstrap = await fetch(`${base}/api/bootstrap`);
assert.equal(bootstrap.status, 200);
assert.ok(isDeepStrictEqual(await bootstrap.json(), { configured: true }), 'Unexpected public bootstrap fields.');
const denied = await fetch(`${base}/api/state`);
assert.equal(denied.status, 401);
const invalidRequests = [
  { email: 'wrong-owner@example.test', password: 'Synthetic-password-123' },
  { email: expectedEmail, password: 'Synthetic-password-123' },
  { password: 'Synthetic-password-123' },
  { email: 'invalid', password: 'Synthetic-password-123' },
];
for (const body of invalidRequests) {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: options.origin }, body: JSON.stringify(body),
  });
  assert.equal(response.status, 401);
  assert.ok(!response.headers.get('set-cookie'), 'Denied login created a cookie.');
  assert.ok(isDeepStrictEqual(await response.json(), { error: 'Неверная почта или пароль.' }), 'Login denial exposed account details.');
}
const fileHashes = {};
for (const [path, relative] of [['/', 'public/index.html'], ['/app.js', 'public/app.js']]) {
  const response = await fetch(`${base}${path}`);
  assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer());
  const local = readFileSync(`/app/${relative}`);
  assert.ok(bytes.equals(local), 'Public file differs from the running image.');
  fileHashes[relative] = createHash('sha256').update(bytes).digest('hex');
}
const store = new Store({ connectionString: options.databaseUrl });
try {
  const tasks = await store.listTasks();
  const statuses = {};
  for (const task of tasks) statuses[task.status] = (statuses[task.status] || 0) + 1;
  const sessions = await store.pool.query('SELECT count(*)::int AS count FROM ai_factory.owner_sessions WHERE expires > now()');
  console.log(JSON.stringify({
    owner_email_matches: true, password_and_owner_fields_preserved: true,
    bootstrap_private: true, anonymous_state_denied: true, invalid_login_scenarios: invalidRequests.length,
    file_hashes: fileHashes, tasks: tasks.length, task_statuses: statuses, active_sessions: sessions.rows[0].count,
  }));
} finally { await store.close(); }
