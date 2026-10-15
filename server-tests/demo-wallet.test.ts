import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDatabase } from '../server/database';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DemoWalletStore } from '../server/demoWallet';

async function database(path = ':memory:') {
  const db = new PostgresDatabase(path);
  (await db.exec(" CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES ('alice'),('bob') ON CONFLICT DO NOTHING;"));
  return db;
}
const deposit = (amount: number) => ({ id: randomUUID(), kind: 'deposit', amount });
const spin = (amount: number) => ({ id: randomUUID(), kind: 'spin', amount });

test('stake and server payout reconcile to the ledger, including loss and returned stake', async () => {
  const db = (await database()); let queue = [0,0,0, 0,1,2, 0,0,1];
  const wallet = new DemoWalletStore(db, () => queue.shift()!);
  try {
    assert.equal((await wallet.snapshot('alice')).balance,0);
    (await wallet.operate('alice',deposit(1000)));
    const win = (await wallet.operate('alice',spin(100)));
    assert.equal(win.round?.payout,1200); assert.equal(win.wallet.balance,2100);
    assert.equal((await wallet.operate('alice',spin(100))).wallet.balance,2000);
    assert.equal((await wallet.operate('alice',spin(100))).wallet.balance,2000);
    const entries = (await wallet.snapshot('alice')).entries.reverse();
    let total = 0;
    for (const entry of entries) { total += entry.amount; assert.equal(entry.balance,total); }
    assert.equal(total,2000); assert.equal((await wallet.snapshot('bob')).balance,0);
  } finally { (await db.close()); }
});

test('idempotency survives restart, rejects changed requests and never redraws a completed round', async () => {
  const dir = mkdtempSync(join(tmpdir(),'royal-wallet-')), path=join(dir,'wallet.sqlite');
  let db = (await database(path)), draws=0, wallet = new DemoWalletStore(db, () => { draws++; return 0; });
  const funding=deposit(1000), round=spin(100);
  try {
    (await wallet.operate('alice',funding)); (await wallet.operate('alice',funding));
    const first = (await wallet.operate('alice',round));
    (await db.close());db=(await database(path));wallet=new DemoWalletStore(db,()=>{throw new Error('Must not redraw');});
    const replay=(await wallet.operate('alice',round));
    assert.deepEqual(first,replay);assert.equal(draws,3);assert.equal(replay.wallet.entries.length,3);
    (await assert.rejects(async ()=>(await wallet.operate('alice',{...round,amount:500})),/изменить/));
    assert.equal((await wallet.snapshot('alice')).balance,2100);
    (await wallet.operate('bob',funding));assert.equal((await wallet.snapshot('bob')).balance,1000);
  } finally { (await db.close());rmSync(dir,{recursive:true}); }
});

test('invalid amounts, insufficient funds and interrupted settlement leave no partial debit', async () => {
  const db=(await database());const wallet=new DemoWalletStore(db,()=>{throw new Error('Draw failed');});
  try {
    for(const amount of [-10,0,0.5,100001,NaN,Infinity,'100']) (await assert.rejects(async ()=>(await wallet.operate('alice',deposit(amount as number)))));
    (await assert.rejects(async ()=>(await wallet.operate('alice',spin(100))),/Недостаточно/));
    (await wallet.operate('alice',deposit(100)));
    (await assert.rejects(async ()=>(await wallet.operate('alice',spin(100))),/Draw failed/));
    assert.equal((await wallet.snapshot('alice')).balance,100);assert.equal((await wallet.snapshot('alice')).entries.length,1);
    assert.equal(Number((await db.prepare('SELECT COUNT(*) AS n FROM demo_operations').get())!.n),1);
    const settlement = new DemoWalletStore(db, () => 0);
    (await db.exec("CREATE OR REPLACE FUNCTION reject_win_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='win' THEN RAISE EXCEPTION 'Settlement failed'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_win BEFORE INSERT ON demo_ledger FOR EACH ROW EXECUTE FUNCTION reject_win_fn();"));
    (await assert.rejects(async ()=>(await settlement.operate('alice',spin(100))),/Settlement failed/));
    assert.equal((await wallet.snapshot('alice')).balance,100);
    assert.equal((await wallet.snapshot('alice')).entries.length,1);

    (await assert.rejects(async ()=>(await wallet.operate('missing-account',deposit(100)))));
  } finally { (await db.close()); }
});

test('competing debits cannot spend the same funds twice', async () => {
  const db=(await database());let n=0;const wallet=new DemoWalletStore(db,()=>n++%3);
  try {
    (await wallet.operate('alice',deposit(100)));
    const requests=await Promise.allSettled([Promise.resolve().then(async ()=>(await wallet.operate('alice',spin(100)))),Promise.resolve().then(async ()=>(await wallet.operate('alice',spin(100))))]);
    assert.equal(requests.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(requests.filter(r=>r.status==='rejected').length,1);
    assert.equal((await wallet.snapshot('alice')).balance,0);assert.equal((await wallet.snapshot('alice')).entries.length,3);
  } finally { (await db.close()); }
});
