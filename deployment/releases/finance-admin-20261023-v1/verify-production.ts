// Read-only HTTP checks with a short-lived session. Never print credentials or report data.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { databaseConfig } from '../../../server/database';

const ownerId = 'fb3dae97-8288-4932-86ab-28d40ce45014';
assert.equal(process.env.FINANCE_ADMIN_ACCOUNT_IDS, ownerId);
const origin = process.env.PUBLIC_ORIGIN!;
assert.match(origin, /^https:\/\//);
const db = new pg.Pool({ ...databaseConfig(), options: '-c search_path=royal_game,public', application_name: 'royal/admin-verification' });
const token = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(token).digest('hex');
const counters = async () => (await db.query('SELECT (SELECT count(*)::text FROM finance_admin_commands) AS commands,(SELECT count(*)::text FROM finance_admin_audit) AS audit')).rows[0];
const headers = { Cookie: 'royal_session=' + token, Origin: origin, 'X-Royal-Admin-Account': ownerId, 'Content-Type': 'application/json' };
const request = async (path: string, body?: unknown, authenticated = true) => {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: authenticated ? headers : {}, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  return { status: response.status, value: await response.json() as any };
};
try {
  const owner = (await db.query('SELECT id FROM accounts WHERE id=$1 AND lower(email)=$2', [ownerId, 'grishapav1992@gmail.com'])).rows;
  assert.equal(owner.length, 1);
  const before = await counters();
  assert.equal((await request('/api/admin/session', undefined, false)).status, 401);
  await db.query('INSERT INTO sessions(hash,account_id,expires) VALUES($1,$2,$3)', [hash, ownerId, Date.now() + 120000]);
  const session = await request('/api/admin/session');
  assert.equal(session.status, 200);
  assert.equal(session.value.account.id, ownerId);
  const reports: Record<string, unknown> = {};
  for (const source of ['payments', 'nile']) {
    assert.equal(session.value.sources[source], true);
    const report = await request('/api/admin/report', { source, filters: { page: 1, size: 25 } });
    assert.equal(report.status, 200, source + ' report unavailable');
    assert.equal(report.value.source, source);
    assert.equal(report.value.environment, source === 'nile' ? 'test' : 'real');
    assert(Array.isArray(report.value.rows) && Array.isArray(report.value.players) && Array.isArray(report.value.games));
    assert.match(report.value.totals.ggr, /^-?\d+$/);
    const filtered = await request('/api/admin/report', { source, playerQuery: 'grishapav1992@gmail.com', filters: { kind: 'game', mode: 'pvp', page: 1, size: 25 } });
    assert.equal(filtered.status, 200);
    assert(filtered.value.rows.every((row: any) => row.playerId === ownerId && row.kind === 'game' && row.mode === 'pvp'));
    reports[source] = { available: true, filtersVerified: true };
  }
  assert.equal((await request('/api/admin/audit', { page: 1 })).status, 200);
  assert.equal((await request('/api/admin/players/' + ownerId)).status, 200);
  assert.deepEqual(await counters(), before, 'Read-only checks changed administrative commands');
  console.log(JSON.stringify({ publicOwnerSession: true, anonymousDenied: true, reports, moneyCommandsCreated: false }));
} finally {
  await db.query('DELETE FROM sessions WHERE hash=$1', [hash]);
  await db.end();
}
