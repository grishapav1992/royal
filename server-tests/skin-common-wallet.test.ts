import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { CommonSkinPayments } from '../server/skinPayments';
import { demoBalanceUnits, demoReservedUnits, saveDemoUnits, MAX_DEMO_UNITS } from '../server/demoWalletAmounts';
import { SkinStudioStore } from '../server/skinStudio';
import sharp from 'sharp';

async function fixture(balance = 5000) {
  const db = new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY,skin INTEGER DEFAULT 0,appearance JSONB); INSERT INTO accounts(id) VALUES ('alice'),('bob')");
  const wallet = new DemoWalletStore(db); await Promise.all([wallet.ready, wallet.expansion.ready]);
  await saveDemoUnits(db, 'alice', balance);
  return { db, wallet, payments: new CommonSkinPayments(db, wallet.ready),
    balance: () => demoBalanceUnits(db, 'alice'), reserved: () => demoReservedUnits(db, 'alice') };
}

test('atelier debits the same wallet as games once and capture never charges again', async () => {
  const f = await fixture(), id = randomUUID();
  try {
    await Promise.all([f.payments.skinPurchase('alice', id, 'reserve'), f.payments.skinPurchase('alice', id, 'reserve')]);
    assert.equal((await f.wallet.snapshot('alice')).balance, 40);
    assert.equal(await f.reserved(), 1000);
    await assert.rejects(() => f.payments.skinPurchase('bob', id, 'capture'));
    await Promise.all([f.payments.skinPurchase('alice', id, 'capture'), f.payments.skinPurchase('alice', id, 'capture')]);
    assert.equal(await f.balance(), 4000); assert.equal(await f.reserved(), 0);
    const entries = (await f.wallet.snapshot('alice')).entries;
    assert.equal(entries.length, 1); assert.equal(entries[0].amount, -10); assert.equal(entries[0].gameName, 'Ателье');
    await assert.rejects(() => f.payments.skinPurchase('alice', id, 'refund'));
  } finally { await f.db.close(); }
});

test('a pending atelier reserves refund capacity and repeated refunds return exactly ten dollars', async () => {
  const f = await fixture(MAX_DEMO_UNITS), id = randomUUID();
  try {
    await f.payments.skinPurchase('alice', id, 'reserve');
    await assert.rejects(() => saveDemoUnits(f.db, 'alice', MAX_DEMO_UNITS));
    await Promise.all([f.payments.skinPurchase('alice', id, 'refund'), f.payments.skinPurchase('alice', id, 'refund')]);
    assert.equal(await f.balance(), MAX_DEMO_UNITS); assert.equal(await f.reserved(), 0);
    assert.equal((await f.wallet.snapshot('alice')).entries.filter(e => e.kind === 'refund').length, 1);
  } finally { await f.db.close(); }
});

test('concurrent purchases cannot overspend a shared balance and insufficient funds leave no debit', async () => {
  const f = await fixture(1500);
  try {
    const attempts = await Promise.allSettled([f.payments.skinPurchase('alice', randomUUID(), 'reserve'), f.payments.skinPurchase('alice', randomUUID(), 'reserve')]);
    assert.equal(attempts.filter(v => v.status === 'fulfilled').length, 1);
    assert.equal(await f.balance(), 500); assert.equal(await f.reserved(), 1000);
    assert.equal((await f.wallet.snapshot('alice')).entries.length, 1);
    await assert.rejects(() => f.payments.skinPurchase('alice', randomUUID(), 'capture'));
    await assert.rejects(() => f.payments.skinPurchase('alice', 'bad-id', 'reserve'));
  } finally { await f.db.close(); }
});

test('provider failure refunds the shared game balance and a new atelier generation costs one dollar', async () => {
  const f = await fixture();
  try {
    const png = await sharp({ create: { width: 32, height: 48, channels: 4, background: '#a23f5b' } }).png().toBuffer();
    let fail = true, calls = 0;
    const images = { available: () => true, generate: async () => { calls++; if (fail) throw new Error('provider failed'); return png; } };
    const studio = new SkinStudioStore(f.db, f.payments, images, () => true, () => {});
    const request = () => ({ id: randomUUID(), prompt: 'Гангстер', reference: 'data:image/png;base64,' + png.toString('base64') });
    await studio.create('alice', request()); await studio.tick();
    assert.equal((await studio.snapshot('alice')).job?.state, 'failed');
    assert.equal(await f.balance(), 5000); assert.equal(await f.reserved(), 0);
    fail = false; const before = calls; await studio.create('alice', request()); await studio.tick();
    const result = await studio.snapshot('alice'); assert.equal(result.job?.state, 'ready'); assert.equal(result.job?.variants.length, 2);
    assert.equal(calls - before, 2); assert.equal(await f.balance(), 4900); assert.equal(await f.reserved(), 0);
    await studio.choose('alice', result.job!.id, result.job!.variants[1].id);
    assert.equal((await studio.snapshot('alice')).wardrobe.length, 1); assert.equal(await f.balance(), 4900);
  } finally { await f.db.close(); }
});

test('janitor creates one five-dollar outfit, survives a lost capture reply and shares the wardrobe',async()=>{
  const f=await fixture();let now=Date.now(),loseCapture=true,calls=0;
  try{
    const images={available:()=>true,generate:async(_prompt:string,variant:number,count?:number)=>{calls++;assert.equal(variant,0);assert.equal(count,1);return Buffer.from('single outfit');}};
    const studio=new SkinStudioStore(f.db,{skinPurchase:async(account,id,action,terms)=>{
      const purchase=await f.payments.skinPurchase(account,id,action,terms);
      if(action==='capture'&&loseCapture){loseCapture=false;throw Error('Lost capture reply');}return purchase;
    }},images,()=>true,()=>{},undefined,()=>now);
    const request={id:randomUUID(),prompt:'Крупье в плаще',offerId:'janitor'};
    await Promise.all([studio.create('alice',request),studio.create('alice',request)]);
    await assert.rejects(studio.create('alice',{...request,offerId:'atelier'}));
    await studio.tick();assert.equal(await f.balance(),4500);assert.equal(calls,1);
    assert.equal((await studio.snapshot('alice','janitor')).job?.state,'capturing');
    now+=16000;await studio.tick();const ready=await studio.snapshot('alice','janitor');
    assert.equal(ready.priceUnits,'5000000');assert.equal(ready.variantCount,1);assert.equal(ready.job?.variants.length,1);assert.equal(ready.job?.priceUnits,'5000000');
    assert.equal(await f.balance(),4500);assert.equal(await f.reserved(),0);assert.equal(calls,1);
    await studio.choose('alice',request.id,ready.job!.variants[0].id,'janitor');
    assert.equal((await studio.snapshot('alice')).wardrobe.length,1);
    assert.equal((await studio.snapshot('alice')).priceUnits,'1000000');
    assert.equal((await studio.snapshot('alice')).variantCount,2);
    assert.equal((await f.wallet.snapshot('alice')).entries.length,1);
    assert.equal((await f.wallet.snapshot('alice')).entries[0].gameName,'Жора: образы');
  }finally{await f.db.close();}
});

test('the janitor refunds exactly five dollars after failure and rejects client-supplied prices or rewards',async()=>{
  const f=await fixture();let calls=0;
  try{
    const studio=new SkinStudioStore(f.db,f.payments,{available:()=>true,generate:async()=>{calls++;throw Error('Image failed');}},()=>true,()=>{});
    const request={id:randomUUID(),prompt:'Новый образ',offerId:'janitor'};
    for(const extra of [{priceUnits:'1000000'},{variantCount:2},{rewardGrantId:randomUUID()}])await assert.rejects(studio.create('alice',{...request,...extra}));
    await studio.create('alice',request);await studio.tick();assert.equal(calls,1);
    assert.equal(await f.balance(),5000);assert.equal(await f.reserved(),0);
    const entries=(await f.wallet.snapshot('alice')).entries;
    assert.deepEqual(entries.map(e=>e.amount),[5,-5]);
    assert.equal((await studio.snapshot('alice','janitor')).job?.state,'failed');
    await studio.tick();assert.equal((await f.wallet.snapshot('alice')).entries.length,2);
  }finally{await f.db.close();}
});

test('mixed one, five and historical ten dollar reservations retain their own refund amounts',async()=>{
  const f=await fixture(MAX_DEMO_UNITS),old=randomUUID(),atelier=randomUUID(),janitor=randomUUID();
  const a={offerId:'atelier',priceUnits:'1000000'} as const,j={offerId:'janitor',priceUnits:'5000000'} as const;
  try{
    await f.payments.skinPurchase('alice',old,'reserve');
    await f.payments.skinPurchase('alice',atelier,'reserve',a);
    await f.payments.skinPurchase('alice',janitor,'reserve',j);
    assert.equal(await f.reserved(),1600);assert.equal(await f.balance(),MAX_DEMO_UNITS-1600);
    await assert.rejects(()=>saveDemoUnits(f.db,'alice',MAX_DEMO_UNITS-1599));
    await assert.rejects(()=>f.payments.skinPurchase('alice',janitor,'refund',a));
    for(const [id,terms] of [[old,undefined],[atelier,a],[janitor,j]] as const)await Promise.all([f.payments.skinPurchase('alice',id,'refund',terms),f.payments.skinPurchase('alice',id,'refund',terms)]);
    assert.equal(await f.balance(),MAX_DEMO_UNITS);assert.equal(await f.reserved(),0);
  }finally{await f.db.close();}
});

test('accepted ten-dollar three-candidate orders keep their terms when shop prices change',async()=>{
  const f=await fixture();let calls=0;
  try{
    const studio=new SkinStudioStore(f.db,f.payments,{available:()=>true,generate:async(_p:string,_v:number,count?:number)=>{calls++;assert.equal(count,3);return Buffer.from('old outfit');}},()=>true,()=>{});
    const request={id:randomUUID(),prompt:'Старый оплаченный заказ'};await studio.create('alice',request);
    await f.db.prepare("UPDATE skin_jobs SET price_units='10000000',variant_count=3 WHERE id=?").run(request.id);
    await studio.create('alice',request);await studio.tick();
    const snapshot=await studio.snapshot('alice','janitor');
    assert.equal(snapshot.priceUnits,'5000000');assert.equal(snapshot.job?.priceUnits,'10000000');assert.equal(snapshot.job?.variants.length,3);
    assert.equal(calls,3);assert.equal(await f.balance(),4000);assert.equal(await f.reserved(),0);
  }finally{await f.db.close();}
});
