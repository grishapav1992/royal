import { PostgresDatabase } from '../server/database';
import { TronReadStore, type ReaderConfig } from '../server/finance/tron-store';
import { NileTestLedger } from '../server/finance/nile-test-ledger';
import { NilePlayLedger } from '../server/finance/nile-play-ledger';
import { readNileBindings } from '../server/finance/nile-account-views';

const prefix = process.argv[2] ?? '';
if (prefix && !/^preview_[a-z0-9_]+_$/.test(prefix)) throw new Error('Invalid preview prefix');
const databases = {
  game: new PostgresDatabase(prefix + 'royal_game'),
  reader: new PostgresDatabase(prefix + 'royal_tron_reader'),
  deposits: new PostgresDatabase(prefix + 'royal_nile_deposits'),
  play: new PostgresDatabase(prefix + 'royal_nile_play'),
};
const started = Date.now();
try {
  const readerState = (await databases.reader.prepare('SELECT * FROM reader_state').get())!;
  const readerConfig: ReaderConfig = { network: 'nile', startHeight: readerState.start_height, origins: JSON.parse(readerState.origins) };
  const depositConfig = JSON.parse((await databases.deposits.prepare('SELECT config FROM state').get())!.config);
  const playConfig = JSON.parse((await databases.play.prepare('SELECT config FROM state').get())!.config);
  const pool = await databases.deposits.hasTable('deposit_pool') ? JSON.parse((await databases.deposits.prepare('SELECT manifest FROM deposit_pool').get())!.manifest) : undefined;
  const reader = new TronReadStore(databases.reader.schema, readerConfig, false, databases.reader);
  const deposits = new NileTestLedger(databases.deposits.schema, depositConfig, false, pool, databases.deposits);
  const play = new NilePlayLedger(databases.play.schema, playConfig, false, undefined, pool, databases.play);
  await Promise.all([reader.ready, deposits.ready, play.ready]);
  process.env.NODE_ENV = 'test';
  process.env.AUTH_DB_PATH = databases.game.schema;
  const { accounts } = await import('../server/accounts');
  try {
    await accounts.ready;
    const gameCounts = await databases.game.prepare('SELECT (SELECT count(*) FROM accounts) AS accounts,(SELECT count(*) FROM sessions) AS sessions,(SELECT count(*) FROM demo_ledger) AS ledger').get();
    const bindings = await readNileBindings(deposits);
    for (const binding of bindings.bindings) if (!await databases.game.prepare('SELECT id FROM accounts WHERE id=?').get(binding.accountId)) throw new Error('Imported binding has no game account');
    const result = { ok: true, prefix, elapsedMs: Date.now() - started, game: gameCounts, bindings: bindings.bindings.length, reader: await reader.audit(), deposits: await deposits.audit(), play: await play.audit() };
    console.log(JSON.stringify(result));
  } finally { await accounts.close(); }
} finally { await Promise.all(Object.values(databases).map(database => database.close())); }
