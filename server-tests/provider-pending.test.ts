import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {CasinoApiProWallet,ProviderWalletError} from '../server/casinoApiProWallet';
import {MAX_DEMO_UNITS,demoBalanceUnits,saveDemoUnits} from '../server/demoWalletAmounts';
import {providerDecimal,providerPendingUnits} from '../server/providerPending';
import {providerCoins,validProviderBalance} from '../src/shared/demoWallet';
import {WalletClient} from '../src/wallet/WalletClient';

async function fixture(units=0){
  const db=new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES ('alice'),('bob');");
  const wallet=new DemoWalletStore(db,max=>max-1),provider=new CasinoApiProWallet(db);
  await Promise.all([wallet.ready,provider.ready]);await saveDemoUnits(db,'alice',units);
  const player=await provider.player('alice'),bob=await provider.player('bob');
  const request=(id:string,amount:string)=>({playerId:player,currency:'USD',transactionId:id,amount,roundId:'pending-round'});
  return {db,wallet,provider,player,bob,request};
}
const providerError=(code:string)=>(error:unknown)=>error instanceof ProviderWalletError&&error.code===code;
async function pendingLedger(db:PostgresDatabase){
  const rows=await db.prepare('SELECT account_id,amount_units,pending_balance_units FROM capro_pending_ledger ORDER BY id').all();
  const sums=new Map<string,bigint>();for(const row of rows){const sum=(sums.get(row.account_id)??0n)+BigInt(row.amount_units);assert.equal(sum,BigInt(row.pending_balance_units));sums.set(row.account_id,sum);}
  for(const [account,total]of sums)assert.equal(await providerPendingUnits(db,account),total);
  return rows;
}

test('an accepted provider stake retains its full win above the cap and spending pending is exact',async()=>{
  const f=await fixture(MAX_DEMO_UNITS-500);
  try{
    await f.provider.callback('debit',f.request('stake','10.00'),'USD');
    const win=await f.provider.callback('credit',f.request('win','20.00'),'USD');
    assert.equal(win.balance,'1000000005.00');assert.equal(await demoBalanceUnits(f.db,'alice'),MAX_DEMO_UNITS);assert.equal(await providerPendingUnits(f.db,'alice'),500n);
    assert.equal((await f.wallet.snapshot('alice')).pendingBalance,'5.00');
    assert.deepEqual(await f.provider.callback('credit',f.request('win','20.00'),'USD'),{...win,duplicate:true});
    await assert.rejects(()=>f.provider.callback('credit',f.request('win','20.01'),'USD'),providerError('INVALID_REQUEST'));
    const debit=await f.provider.callback('debit',f.request('pending-stake','3.01'),'USD');
    assert.equal(debit.balance,'1000000001.99');assert.equal(await providerPendingUnits(f.db,'alice'),199n);assert.equal(await demoBalanceUnits(f.db,'alice'),MAX_DEMO_UNITS);
    const refund=await f.provider.callback('refund',{...f.request('refund','3.01'),referenceTransactionId:'pending-stake'},'USD');
    assert.equal(refund.balance,win.balance);assert.equal(await providerPendingUnits(f.db,'alice'),500n);
    await assert.rejects(()=>f.provider.callback('rollback',{...f.request('another-refund','3.01'),referenceTransactionId:'pending-stake'},'USD'),providerError('ALREADY_REVERSED'));
    assert.equal((await f.provider.callback('balance',{playerId:f.bob,currency:'USD'},'USD')).balance,'0.00');
    await pendingLedger(f.db);
  }finally{await f.db.close();}
});

test('a provider credit larger than the local cap and both reversal directions preserve every cent',async()=>{
  const f=await fixture();
  try{
    const amount='1000000000.01',credit=await f.provider.callback('credit',f.request('large-win',amount),'USD');
    assert.equal(credit.balance,amount);assert.equal(await demoBalanceUnits(f.db,'alice'),MAX_DEMO_UNITS);assert.equal(await providerPendingUnits(f.db,'alice'),1n);
    const rolled=await f.provider.callback('rollback',{...f.request('void-win',amount),referenceTransactionId:'large-win'},'USD');
    assert.equal(rolled.balance,'0.00');assert.equal(await providerPendingUnits(f.db,'alice'),0n);assert.equal(await demoBalanceUnits(f.db,'alice'),0);
    await f.provider.callback('credit',f.request('large-win-2',amount),'USD');
    await f.provider.callback('debit',f.request('large-stake',amount),'USD');
    const refunded=await f.provider.callback('refund',{...f.request('return-stake',amount),referenceTransactionId:'large-stake'},'USD');
    assert.equal(refunded.balance,amount);assert.equal(await providerPendingUnits(f.db,'alice'),1n);
    await pendingLedger(f.db);
  }finally{await f.db.close();}
});

test('a local completed losing round releases pending funds once with a consistent ledger',async()=>{
  const f=await fixture(100000);
  try{
    const start=await f.wallet.mines.operate('alice',{id:randomUUID(),action:'start',amount:10,mineCount:1});
    const reserved=await f.wallet.mines.reservedUnits('alice');
    await saveDemoUnits(f.db,'alice',MAX_DEMO_UNITS-reserved);
    const ledgerStart=(await f.db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM demo_ledger').get())!.id;
    await f.provider.callback('credit',f.request('deferred-win','5.00'),'USD');
    const result=await f.wallet.mines.operate('alice',{id:randomUUID(),action:'reveal',sessionId:start.session!.id,cell:24});
    assert.equal(result.session!.state,'lost');assert.equal(result.session!.payout,0);assert.equal(result.wallet.pendingBalance,undefined);
    assert.equal(await demoBalanceUnits(f.db,'alice'),MAX_DEMO_UNITS-reserved+500);assert.equal(await providerPendingUnits(f.db,'alice'),0n);
    const released=result.wallet.entries.filter(entry=>entry.gameName==='Отложенный выигрыш');assert.equal(released.length,1);assert.equal(released[0].amount,5);
    assert.equal((await f.wallet.snapshot('alice')).entries.filter(entry=>entry.gameName==='Отложенный выигрыш').length,1);
    const entries=await f.db.prepare('SELECT amount_units,balance_units FROM demo_ledger WHERE id>? ORDER BY id').all(ledgerStart);let balance=MAX_DEMO_UNITS-reserved;
    for(const entry of entries){balance+=Number(entry.amount_units);assert.equal(balance,Number(entry.balance_units));}
    await pendingLedger(f.db);
  }finally{await f.db.close();}
});

test('failed provider writes roll back available and pending money, and concurrent retries only credit once',async()=>{
  const f=await fixture(MAX_DEMO_UNITS);
  try{
    await f.db.exec("CREATE FUNCTION fail_pending_credit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Interrupted provider credit'; END $$;CREATE TRIGGER fail_pending_credit BEFORE INSERT ON capro_transactions FOR EACH ROW EXECUTE FUNCTION fail_pending_credit();");
    await assert.rejects(()=>f.provider.callback('credit',f.request('failed','1.00'),'USD'),/Interrupted provider credit/);
    assert.equal(await providerPendingUnits(f.db,'alice'),0n);assert.equal(await demoBalanceUnits(f.db,'alice'),MAX_DEMO_UNITS);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM capro_pending_ledger').get())!.n,0);assert.equal((await f.db.prepare('SELECT count(*) AS n FROM demo_ledger').get())!.n,0);
    await f.db.exec('DROP TRIGGER fail_pending_credit ON capro_transactions;DROP FUNCTION fail_pending_credit();');
    const requests=await Promise.all(Array.from({length:8},()=>f.provider.callback('credit',f.request('concurrent','1.00'),'USD')));
    assert.equal(requests.filter(result=>!result.duplicate).length,1);assert.equal(await providerPendingUnits(f.db,'alice'),100n);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM capro_transactions').get())!.n,1);await pendingLedger(f.db);
  }finally{await f.db.close();}
});

test('pending sums above Number precision survive reopening and remain usable by provider debit',async()=>{
  const f=await fixture(MAX_DEMO_UNITS);
  try{
    const huge=9007199254740993123456789n;
    await f.db.prepare('INSERT INTO capro_pending_balances(account_id,pending_units) VALUES (?,?)').run('alice',huge.toString());
    await f.db.prepare('INSERT INTO capro_pending_ledger(account_id,operation_id,amount_units,pending_balance_units,reason,created_at) VALUES (?,?,?,?,?,?)').run('alice','seed',huge.toString(),huge.toString(),'credit',Date.now());
    const provider=new CasinoApiProWallet(f.db);await provider.ready;
    const expected=providerDecimal(BigInt(MAX_DEMO_UNITS)+huge);
    assert.equal(await provider.balance('alice'),expected);assert.equal((await f.wallet.snapshot('alice')).pendingBalance,providerDecimal(huge));
    const debit=await provider.callback('debit',f.request('wide-pending-debit','0.01'),'USD');
    assert.equal(debit.balance,providerDecimal(BigInt(MAX_DEMO_UNITS)+huge-1n));assert.equal(await providerPendingUnits(f.db,'alice'),huge-1n);
    const players=await f.db.prepare('SELECT * FROM capro_players ORDER BY player_id').all();
    const transactions=await f.db.prepare('SELECT * FROM capro_transactions ORDER BY transaction_id').all();
    const pending=await f.db.prepare('SELECT * FROM capro_pending_balances').all();
    const reopened=new CasinoApiProWallet(f.db);await reopened.ready;
    assert.deepEqual(await f.db.prepare('SELECT * FROM capro_players ORDER BY player_id').all(),players);
    assert.deepEqual(await f.db.prepare('SELECT * FROM capro_transactions ORDER BY transaction_id').all(),transactions);
    assert.deepEqual(await f.db.prepare('SELECT * FROM capro_pending_balances').all(),pending);
    assert.deepEqual(await reopened.callback('debit',f.request('wide-pending-debit','0.01'),'USD'),{...debit,duplicate:true});
    await pendingLedger(f.db);
    const migrations=await f.db.prepare("SELECT count(*) AS n FROM _royal_migrations WHERE id='game-provider-pending-v1'").get();assert.equal(migrations!.n,1);
  }finally{await f.db.close();}
});

test('a transaction ID race across capped wallets rolls back the losing pending credit',async context=>{
  const f=await fixture(MAX_DEMO_UNITS);
  try{
    await saveDemoUnits(f.db,'bob',MAX_DEMO_UNITS);
    const prepare=f.db.prepare.bind(f.db);let reads=0,release!:()=>void;
    const bothRead=new Promise<void>(resolve=>{release=resolve;});
    context.mock.method(f.db,'prepare',(sql:string)=>{
      const statement=prepare(sql);if(sql!=='SELECT fingerprint,response FROM capro_transactions WHERE transaction_id=?')return statement;
      return {...statement,get:async(...values:unknown[])=>{const row=await statement.get(...values);if(!row&&values[0]==='overflow-account-race'){if(++reads===2)release();await bothRead;}return row;}};
    });
    const results=await Promise.allSettled([
      f.provider.callback('credit',f.request('overflow-account-race','3.01'),'USD'),
      f.provider.callback('credit',{...f.request('overflow-account-race','3.01'),playerId:f.bob},'USD'),
    ]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    const failed=results.find(result=>result.status==='rejected') as PromiseRejectedResult;assert(providerError('INVALID_REQUEST')(failed.reason));
    const alice=await providerPendingUnits(f.db,'alice'),bob=await providerPendingUnits(f.db,'bob');
    assert.equal(alice+bob,301n);assert(alice===0n||bob===0n);
    assert.equal(await demoBalanceUnits(f.db,'alice'),MAX_DEMO_UNITS);assert.equal(await demoBalanceUnits(f.db,'bob'),MAX_DEMO_UNITS);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM capro_transactions').get())!.n,1);assert.equal((await pendingLedger(f.db)).length,1);
  }finally{await f.db.close();}
});

test('optional pending balances are validated and shown without passing through Number',()=>{
  const value='90071992547409931234567.89';
  assert(validProviderBalance(value));assert.equal(providerCoins(value),'90\u00a0071\u00a0992\u00a0547\u00a0409\u00a0931\u00a0234\u00a0567,89');
  const client=new WalletClient();client.accountId='alice';client.acceptExternalWallet('alice',{balance:1,entries:[],pendingBalance:value});assert.equal(client.wallet!.pendingBalance,value);
  for(const invalid of [1,'-1.00','1e4','01.00','1.001','1'])assert.throws(()=>client.acceptExternalWallet('alice',{balance:1,entries:[],pendingBalance:invalid as any}));
  client.acceptExternalWallet('alice',{balance:1,entries:[]});assert.equal(client.wallet!.pendingBalance,undefined);
});
