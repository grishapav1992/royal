const fs = require('node:fs'), {Client} = require('pg');
const secret = name => process.env[name + '_FILE'] ? fs.readFileSync(process.env[name + '_FILE'], 'utf8').trim() : process.env[name];
const url = secret('DATABASE_URL');
const config = url ? {connectionString: url} : {host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE, user: process.env.PGUSER, password: secret('PGPASSWORD')};
config.ssl = process.env.PGSSLMODE === 'verify-full' ? {rejectUnauthorized: true,
  ...(process.env.PGSSLROOTCERT ? {ca: fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8')} : {})} : false;
Object.assign(config, {application_name: 'royal/cosmic-release-gate', connectionTimeoutMillis: 5000,
  statement_timeout: 5000, lock_timeout: 5000, idle_in_transaction_session_timeout: 30000});
const client = new Client(config);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  await client.connect();
  const deadline = Date.now() + 180000;
  while (true) {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('royal_game',0))");
    const result = await client.query("SELECT (SELECT count(*) FROM royal_game.combat_matches WHERE state='active') + (SELECT count(*) FROM royal_game.virtual_pvp_holds WHERE state='held') AS active");
    if (Number(result.rows[0].active) === 0) break;
    await client.query('ROLLBACK');
    if (Date.now() >= deadline) throw Error('Paid matches remain active; no release mutation was performed');
    console.log(JSON.stringify({waitingForMatches: true})); await wait(1000);
  }
  console.log(JSON.stringify({quiet: true, financialLockHeld: true}));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Release financial lock deadline exceeded')), 25000);
    process.stdin.once('data', () => {clearTimeout(timer); resolve();});
    process.stdin.once('end', () => {clearTimeout(timer); resolve();});
  });
  await client.query('COMMIT'); await client.end();
})().catch(async () => {
  await client.query('ROLLBACK').catch(() => {}); await client.end().catch(() => {});
  console.error('Cannot acquire or retain the release financial gate'); process.exit(1);
});
