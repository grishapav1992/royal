import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDatabase } from '../server/database';
import { randomUUID, createHmac } from 'node:crypto';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { DemoWalletStore } from '../server/demoWallet';
import { CasinoApiProWallet, ProviderWalletError } from '../server/casinoApiProWallet';
import { CasinoApiProClient, casinoApiProConfig, walletBinding, type CasinoApiProConfig } from '../server/casinoApiPro';
import { installCasinoApiPro, verifyWalletSignature } from '../server/casinoApiProRoutes';
import { AccountStore } from '../server/accounts';
import { recordDemoUnits, saveDemoUnits } from '../server/demoWalletAmounts';

const config: CasinoApiProConfig = {apiKey:'ck_test_abcdefgh1234',apiSecret:'cs_test_abcdefgh12345678',walletSecret:'a'.repeat(64),currency:'USD',publicOrigin:'https://royal.example'};
const fixtureGame={id:'game-1',slug:'mines',name:'Mines',category:'INSTANT',thumbnail_url:'https://assets.casinoapipro.com/games/mines.webp',min_bet:'0.10',max_bet:'100.00',currencies:['USD'],enabled:true,status:'ACTIVE'};
async function fixture(path=':memory:') {
  const db=new PostgresDatabase(path);(await db.exec(" CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES ('alice'),('bob') ON CONFLICT DO NOTHING;"));
  const wallet=new DemoWalletStore(db,()=>0), provider=new CasinoApiProWallet(db);
  await Promise.all([wallet.ready, provider.ready]);
  return {db,wallet,provider,player:(await provider.player('alice')),bob:(await provider.player('bob'))};
}
const fund=async (wallet:DemoWalletStore,amount=1000)=>(await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount}));
const error=(code:string)=>(value:unknown)=>value instanceof ProviderWalletError&&value.code===code;

test('fractional provider stakes, wins and club deposits use the same wallet and exact ledger',async ()=>{
  const {db,wallet,provider,player}=(await fixture());
  try {
    (await fund(wallet));
    assert.equal((await provider.callback('balance',{playerId:player,currency:'USD'},'USD')).balance,'1000.00');
    assert.equal((await provider.callback('debit',{playerId:player,currency:'USD',transactionId:'bet-1',amount:'0.20',gameName:'Mines'},'USD')).balance,'999.80');
    assert.equal((await provider.callback('credit',{playerId:player,currency:'USD',transactionId:'win-1',amount:'0.55',gameName:'Mines'},'USD')).balance,'1000.35');
    assert.equal((await fund(wallet,10)).wallet.balance,1010.35);
    assert.equal((await wallet.operate('alice',{id:randomUUID(),kind:'spin',amount:100})).wallet.balance,2110.35);
    let sum=0;
    for(const entry of (await wallet.snapshot('alice')).entries.reverse()) {sum+=Math.round(entry.amount*100);assert.equal(Math.round(entry.balance*100),sum);}
    assert.equal((await wallet.snapshot('alice')).entries.filter(e=>e.source==='casinoapipro').length,2);
    assert.equal((await wallet.snapshot('bob')).balance,0);
  } finally {(await db.close());}
});

test('provider duplicate returns the original balance after restart and rejects changed identity',async ()=>{
  const dir=mkdtempSync(join(tmpdir(),'royal-capro-')),path=join(dir,'wallet.sqlite');let f=(await fixture(path));
  try {
    (await fund(f.wallet));const body={playerId:f.player,currency:'USD',transactionId:'same',amount:'10.25',roundId:'round-1'};
    const result=(await f.provider.callback('debit',body,'USD'));(await fund(f.wallet,100));(await f.db.close());f=(await fixture(path));
    assert.deepEqual((await f.provider.callback('debit',body,'USD')),{...result,duplicate:true});
    assert.equal((await f.wallet.snapshot('alice')).balance,1089.75);
    for(const change of [{amount:'10.26'},{playerId:f.bob},{roundId:'round-2'}]) (await assert.rejects(async ()=>(await f.provider.callback('debit',{...body,...change},'USD')),error('INVALID_REQUEST')));
    (await assert.rejects(async ()=>(await f.provider.callback('credit',body,'USD')),error('INVALID_REQUEST')));
  } finally {(await f.db.close());rmSync(dir,{recursive:true});}
});

test('parallel provider registration retains one persistent player identity per account', async () => {
  const {db,provider} = await fixture();
  try {
    await db.prepare('INSERT INTO accounts(id) VALUES(?)').run('carol');
    const players = await Promise.all(Array.from({length: 8}, () => provider.player('carol')));
    assert.equal(new Set(players).size, 1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM capro_players WHERE account_id=?').get('carol'))!.count, 1);
    assert.equal(await provider.player('carol'), players[0]);
  } finally { await db.close(); }
});

test('simultaneous transaction identities across accounts reject the loser without a partial debit', async context => {
  const {db,wallet,provider,player,bob} = await fixture();
  try {
    await fund(wallet);
    await wallet.operate('bob', {id: randomUUID(), kind: 'deposit', amount: 1000});
    const prepare = db.prepare.bind(db);
    let reads = 0, release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    context.mock.method(db, 'prepare', (sql: string) => {
      const statement = prepare(sql);
      if (sql !== 'SELECT fingerprint,response FROM capro_transactions WHERE transaction_id=?') return statement;
      return {...statement, get: async (...values: unknown[]) => {
        const row = await statement.get(...values);
        if (!row && values[0] === 'account-race') { if (++reads === 2) release(); await bothRead; }
        return row;
      }};
    });
    const request = {currency: 'USD', transactionId: 'account-race', amount: '10.25'};
    const results = await Promise.allSettled([
      provider.callback('debit', {...request, playerId: player}, 'USD'),
      provider.callback('debit', {...request, playerId: bob}, 'USD'),
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const loser = results.find(result => result.status === 'rejected');
    assert.ok(loser?.status === 'rejected' && error('INVALID_REQUEST')(loser.reason));
    const aliceBalance = (await wallet.snapshot('alice')).balance, bobBalance = (await wallet.snapshot('bob')).balance;
    assert.deepEqual([aliceBalance,bobBalance].sort((a,b) => a-b), [989.75,1000]);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM capro_transactions WHERE transaction_id=?').get('account-race'))!.count, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM demo_ledger WHERE operation_id=?").get('capro:account-race'))!.count, 1);
  } finally { await db.close(); }
});

test('provider schema upgrades preserve player binding and historical callback replay after later deposits', async () => {
  const db = new PostgresDatabase(':memory:');
  try {
    await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('alice');");
    const wallet = new DemoWalletStore(db); await fund(wallet);
    await db.exec(`CREATE TABLE capro_players(player_id TEXT PRIMARY KEY,account_id TEXT UNIQUE NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,wallet_binding TEXT,balance_read_at INTEGER);
      CREATE TABLE capro_transactions(transaction_id TEXT PRIMARY KEY,player_id TEXT NOT NULL REFERENCES capro_players(player_id),operation TEXT NOT NULL,amount_units INTEGER NOT NULL,currency TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,reversed_by TEXT,created_at INTEGER NOT NULL);`);
    const player = 'royal_imported', body = {playerId: player, currency: 'USD', transactionId: 'imported-bet', amount: '10.25', roundId: 'imported-round'};
    const result = {balance: '989.75', currency: 'USD', reference: 'capro:imported-bet', duplicate: false};
    await db.prepare('INSERT INTO capro_players VALUES(?,?,?,?)').run(player, 'alice', 'imported-binding', Date.now());
    await db.transaction(async () => {
      await saveDemoUnits(db, 'alice', 98975);
      await recordDemoUnits(db, 'alice', result.reference, 'bet', -1025, 98975, 'casinoapipro', 'Mines');
      await db.prepare('INSERT INTO capro_transactions VALUES(?,?,?,?,?,?,?,?,?)').run(body.transactionId, player, 'debit', 1025, 'USD', JSON.stringify(['debit',player,1025,'USD','',body.roundId,null]), JSON.stringify(result), null, Date.now());
    }, {lockKey: 'account:alice'});
    const beforePlayers = await db.prepare('SELECT * FROM capro_players').all(), beforeTransactions = await db.prepare('SELECT * FROM capro_transactions').all();
    await fund(wallet, 100);
    const provider = new CasinoApiProWallet(db); await provider.ready;
    assert.deepEqual(await db.prepare('SELECT * FROM capro_players').all(), beforePlayers);
    assert.deepEqual(await db.prepare('SELECT * FROM capro_transactions').all(), beforeTransactions);
    assert.equal(await provider.player('alice'), player); assert.equal(await provider.verified('imported-binding'), true);
    assert.deepEqual(await provider.callback('debit', body, 'USD'), {...result, duplicate: true});
    assert.equal((await wallet.snapshot('alice')).balance, 1089.75);
    const indexes = await db.prepare("SELECT indexdef FROM pg_indexes WHERE schemaname=? AND tablename='capro_players'").all(db.schema);
    assert.ok(indexes.some(index => /\(wallet_binding\)/.test(String(index.indexdef)) && /wallet_binding IS NOT NULL/.test(String(index.indexdef))));
    const lifecycleIndex = await db.prepare("SELECT indexdef FROM pg_indexes WHERE schemaname=? AND indexname='capro_transactions_player_v1'").get(db.schema);
    assert.match(lifecycleIndex!.indexdef, /\(player_id\)/);
    const reopened = new CasinoApiProWallet(db); await reopened.ready;
    assert.deepEqual(await db.prepare('SELECT * FROM capro_transactions').all(), beforeTransactions);
    assert.deepEqual(await reopened.callback('debit', body, 'USD'), {...result, duplicate: true});
    await assert.rejects(db.prepare('DELETE FROM capro_players WHERE player_id=?').run(player), /foreign key constraint/);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM _royal_migrations WHERE id='game-provider-player-fk-index-v1'").get())!.n, 1);
  } finally { await db.close(); }
});

test('refund and rollback require the full matching original and reverse it only once',async ()=>{
  const {db,wallet,provider,player,bob}=(await fixture());
  try {
    (await fund(wallet));const body={playerId:player,currency:'USD',transactionId:'bet',amount:'10.25'};(await provider.callback('debit',body,'USD'));
    const refund={...body,transactionId:'refund',referenceTransactionId:'bet'};
    (await assert.rejects(async ()=>(await provider.callback('refund',{...refund,amount:'100.00'},'USD')),error('INVALID_REQUEST')));
    (await assert.rejects(async ()=>(await provider.callback('refund',{...refund,playerId:bob},'USD')),error('TRANSACTION_NOT_FOUND')));
    assert.equal((await provider.callback('refund',refund,'USD')).balance,'1000.00');
    assert.equal((await provider.callback('refund',refund,'USD')).duplicate,true);
    (await assert.rejects(async ()=>(await provider.callback('rollback',{...refund,transactionId:'another'},'USD')),error('ALREADY_REVERSED')));
    (await assert.rejects(async ()=>(await provider.callback('refund',{...refund,transactionId:'missing',referenceTransactionId:'absent'},'USD')),error('TRANSACTION_NOT_FOUND')));
    (await provider.callback('credit',{...body,transactionId:'win',amount:'0.25'},'USD'));
    assert.equal((await provider.callback('rollback',{...body,transactionId:'void-win',amount:'0.25',referenceTransactionId:'win'},'USD')).balance,'1000.00');
    assert.equal((await wallet.snapshot('alice')).entries[0].kind,'rollback');
  } finally {(await db.close());}
});

test('invalid values, overdrafts and an interrupted write leave no partial balance or transaction',async ()=>{
  const {db,wallet,provider,player}=(await fixture());
  try {
    (await fund(wallet,1));const body={playerId:player,currency:'USD',transactionId:'debit',amount:'1.01'};
    (await assert.rejects(async ()=>(await provider.callback('debit',body,'USD')),error('INSUFFICIENT_FUNDS')));
    for(const amount of [1,-1,'-1','NaN','1e2','0.001','99999999999','0']) (await assert.rejects(async ()=>(await provider.callback('debit',{...body,amount},'USD'))));
    (await assert.rejects(async ()=>(await provider.callback('debit',{...body,currency:'EUR'},'USD')),error('CURRENCY_MISMATCH')));
    (await assert.rejects(async ()=>(await provider.callback('balance',{...body,playerId:'absent'},'USD')),error('PLAYER_NOT_FOUND')));
    (await db.exec("CREATE OR REPLACE FUNCTION fail_provider_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TRUE THEN RAISE EXCEPTION 'Interrupted write'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_provider BEFORE INSERT ON capro_transactions FOR EACH ROW EXECUTE FUNCTION fail_provider_fn();"));
    (await assert.rejects(async ()=>(await provider.callback('debit',{...body,amount:'0.10'},'USD')),/Interrupted write/));
    assert.equal((await wallet.snapshot('alice')).balance,1);assert.equal((await wallet.snapshot('alice')).entries.length,1);
  } finally {(await db.close());}
});

test('legacy whole-coin balances and ledger retain their value through repeated schema initialization',async ()=>{
  const db=new PostgresDatabase(':memory:');
  (await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES ('alice');CREATE TABLE demo_wallets(account_id TEXT PRIMARY KEY REFERENCES accounts(id),balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0 AND balance<=1000000000));CREATE TABLE demo_ledger(id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,account_id TEXT NOT NULL,operation_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('deposit','bet','win')),amount INTEGER NOT NULL,balance INTEGER NOT NULL,created_at INTEGER NOT NULL);INSERT INTO demo_wallets VALUES('alice',1234);INSERT INTO demo_ledger(account_id,operation_id,kind,amount,balance,created_at) VALUES('alice','legacy','deposit',1234,1234,1);"));
  try {
    let wallet=new DemoWalletStore(db);assert.equal((await wallet.snapshot('alice')).balance,1234);assert.equal((await wallet.snapshot('alice')).entries[0].amount,1234);
    wallet=new DemoWalletStore(db);const provider=new CasinoApiProWallet(db),player=(await provider.player('alice'));
    (await provider.callback('debit',{playerId:player,currency:'USD',transactionId:'fraction',amount:'0.01'},'USD'));
    assert.equal((await wallet.snapshot('alice')).balance,1233.99);assert.equal(Number((await db.prepare('SELECT balance FROM demo_wallets').get())!.balance),1233);
    assert.equal(await db.integrityCheck(),true);
  } finally {(await db.close());}
});

test('only fresh raw-body wallet signatures pass; live keys and live auth replies fail closed',async()=>{
  const raw=Buffer.from('{ "playerId": "p", "currency": "USD" }'),time=String(Math.floor(Date.now()/1000)),signature=createHmac('sha256',config.walletSecret).update(`${time}.`).update(raw).digest('hex');
  assert.equal(verifyWalletSignature(config.walletSecret,time,signature,raw),true);
  assert.equal(verifyWalletSignature(config.walletSecret,time,signature,Buffer.from(JSON.stringify(JSON.parse(raw.toString())))),false);
  assert.equal(verifyWalletSignature(config.walletSecret,time,signature,raw,Date.now()+301000),false);
  assert.equal(verifyWalletSignature(config.walletSecret,time,'bad',raw),false);
  assert.throws(()=>casinoApiProConfig({CASINOAPIPRO_ENABLED:'true',CASINOAPIPRO_API_KEY:'ck_live_abcdefgh',CASINOAPIPRO_API_SECRET:config.apiSecret,CASINOAPIPRO_WALLET_SECRET:config.walletSecret,PUBLIC_ORIGIN:config.publicOrigin}));
  const client=new CasinoApiProClient(config,async()=>Response.json({environment:'LIVE',access_token:'secret-token',expires_in:3600}));
  await assert.rejects(async ()=>(await client.games()),/не подтвердил тестовый/);
});

test('catalogue pagination, token reuse and launch validate account, currency and allowed URLs',async()=>{
  let auth=0,catalogue=0,launch=0,bad=false;
  const client=new CasinoApiProClient(config,async(input,init)=>{
    const url=String(input);
    if(url.endsWith('/auth/token')) {auth++;return Response.json({environment:'SANDBOX',access_token:'test-token',expires_in:3600});}
    if(url.includes('/games/')) {catalogue++;return Response.json({data:url.includes('cursor')?[{...fixtureGame,id:'game-2',slug:'dice',name:'Dice'}]:[fixtureGame,{...fixtureGame,id:'wrong-currency',currencies:['EUR']},{...fixtureGame,id:'disabled',enabled:false}],has_more:!url.includes('cursor'),next_cursor:url.includes('cursor')?null:'page-2'});}
    launch++;const body=JSON.parse(String(init?.body));assert.equal(body.player_name,undefined);assert.equal(body.currency,'USD');
    return Response.json({player_id:body.player_id,currency:body.currency,game:{id:body.game_id},launch_url:bad?'https://example.org/play?token=wrong':'https://games.casinoapipro.com/play?token=test-session'});
  });
  const games=await client.games();assert.equal(games.length,2);assert.ok(games[0].thumbnailUrl?.startsWith('https://assets.casinoapipro.com/'));
  await client.games();assert.equal(catalogue,2);assert.equal(auth,1);
  assert.equal((await client.launch('game-1','royal-player')).game.name,'Mines');
  await assert.rejects(async ()=>(await client.launch('missing','royal-player')),/недоступна/);
  bad=true;await assert.rejects(async ()=>(await client.launch('game-1','royal-player')),/недопустим/);assert.equal(launch,2);
});

test('HTTP launch requires a real signed wallet balance call and callbacks cannot use browser auth',async()=>{
  const store=new AccountStore(':memory:'),account=await store.login('capro-test@example.test','Capro-test-password!');
  const app=express();installCasinoApiPro(app,config,store,async(input,init)=>{
    if(String(input).endsWith('/auth/token')) return Response.json({environment:'SANDBOX',access_token:'test-token',expires_in:3600});
    if(String(input).includes('/games/')) return Response.json({data:[fixtureGame],has_more:false,next_cursor:null});
    const body=JSON.parse(String(init?.body));return Response.json({launch_url:'https://games.casinoapipro.com/play?token=test-session',player_id:body.player_id,currency:'USD',game:{id:'game-1'}});
  });
  const listener=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>listener.once('listening',resolve));
  const base=`http://127.0.0.1:${(listener.address() as {port:number}).port}`;
  const browserHeaders={'Content-Type':'application/json',Cookie:`royal_session=${account.token}`};
  try {
    assert.equal((await fetch(base+'/api/casinoapipro/games')).status,401);
    const state=await (await fetch(base+'/api/casinoapipro/status',{method:'POST',headers:browserHeaders,body:'{}'})).json();assert.equal(state.walletConnected,false);
    assert.equal((await fetch(base+'/api/casinoapipro/sessions',{method:'POST',headers:browserHeaders,body:JSON.stringify({gameId:'game-1'})})).status,409);
    const body=JSON.stringify({playerId:state.playerId,currency:'USD'}),time=String(Math.floor(Date.now()/1000));
    assert.equal((await fetch(base+'/api/casinoapipro/wallet/balance',{method:'POST',headers:browserHeaders,body})).status,401);
    const signed={'Content-Type':'application/json','x-timestamp':time,'x-signature':createHmac('sha256',config.walletSecret).update(`${time}.${body}`).digest('hex')};
    assert.equal((await fetch(base+'/api/casinoapipro/wallet/balance',{method:'POST',headers:signed,body})).status,200);
    assert.equal((await store.casinoApiProWallet.connected(state.playerId,walletBinding(config))),true);
    (await store.wallet.operate(account.account.id,{id:randomUUID(),kind:'deposit',amount:1000}));
    const callback=async(operation:string,payload:unknown)=>{
      const raw=JSON.stringify(payload),timestamp=String(Math.floor(Date.now()/1000));
      return (await fetch(base+`/api/casinoapipro/wallet/${operation}`,{method:'POST',headers:{'Content-Type':'application/json','x-timestamp':timestamp,'x-signature':createHmac('sha256',config.walletSecret).update(`${timestamp}.${raw}`).digest('hex')},body:raw}));
    };
    const bet={playerId:state.playerId,currency:'USD',transactionId:'http-bet',amount:'10.25',roundId:'http-round'};
    assert.equal((await (await callback('balance',{playerId:state.playerId,currency:'USD'})).json()).balance,'1000.00');
    assert.equal((await (await callback('debit',bet)).json()).balance,'989.75');
    assert.equal((await (await callback('credit',{...bet,transactionId:'http-win',amount:'20.50'})).json()).balance,'1010.25');
    const repeated=await (await callback('debit',bet)).json();assert.equal(repeated.duplicate,true);assert.equal(repeated.balance,'989.75');
    assert.equal((await store.wallet.snapshot(account.account.id)).balance,1010.25);
    const other=await store.login('capro-other@example.test','Capro-test-password!');
    const otherHeaders={...browserHeaders,Cookie:`royal_session=${other.token}`};
    const otherState=await (await fetch(base+'/api/casinoapipro/status',{method:'POST',headers:otherHeaders,body:'{}'})).json();
    assert.equal(otherState.walletConnected,true);assert.equal(otherState.balance,'0.00');assert.notEqual(otherState.playerId,state.playerId);
    assert.equal((await fetch(base+'/api/casinoapipro/sessions',{method:'POST',headers:otherHeaders,body:JSON.stringify({gameId:'game-1'})})).status,200);
    const response=await fetch(base+'/api/casinoapipro/sessions',{method:'POST',headers:browserHeaders,body:JSON.stringify({gameId:'game-1',playerId:'someone-else'})});assert.equal(response.status,200);
    assert.ok((await response.json()).launchUrl.includes('test-session'));
    assert.equal((await fetch(base+'/api/casinoapipro/status',{method:'POST',headers:{...browserHeaders,Origin:'https://untrusted.example'},body:'{}'})).status,403);
    assert.equal((await store.casinoApiProWallet.connected(state.playerId,'changed-config')),false);
  } finally {await new Promise<void>((resolve,reject)=>listener.close(error=>error?reject(error):resolve()));(await store.close());}
});
