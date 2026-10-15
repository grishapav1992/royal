import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore} from '../server/demoWallet';
import {DemoExpansionStore,expansionMax,type ExpansionState} from '../server/demoExpansion';
import {cardEngine} from '../server/games/cardEngine';
import {expansionRulesVersion,validExpansionRulesVersion,validExpansionAction,type ExpansionAction,type ExpansionGameId} from '../src/shared/casinoExpansion';
import {demoBalanceUnits,demoReservedUnits,recordDemoUnits,saveDemoUnits} from '../server/demoWalletAmounts';

const start=(gameId:ExpansionGameId):Extract<ExpansionAction,{action:'start'}>=>({id:randomUUID(),gameId,action:'start',stakeUnits:'1000',settings:{}});
const move=(gameId:ExpansionGameId,sessionId:string,name:string):ExpansionAction=>({id:randomUUID(),gameId,action:'move',sessionId,move:name});
async function fixture(){
  const db=new PostgresDatabase(':memory:');
  await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('alice')");
  const wallet=new DemoWalletStore(db);await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:1000});
  return {db,wallet};
}

test('new revised rounds select rules 2 and a caller cannot start rules 1',async()=>{
  const {db,wallet}=await fixture();
  const selected:number[]=[];
  const engine:typeof cardEngine=async(game,name,payload,picks,side,version)=>{
    selected.push(version!);return cardEngine(game,name,payload,picks,side,version);
  };
  const store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},undefined,undefined,engine);
  try{
    const op=start('github-rummy');assert.equal(expansionRulesVersion(op.gameId),2);
    const reply=await store.operate('alice',op);
    assert.equal(reply.session.rulesVersion,2);assert.equal(selected[0],2);
    assert.equal(await demoReservedUnits(db,'alice'),13000);
    assert.ok(!validExpansionAction({...op,rulesVersion:1}));
    assert.ok(!validExpansionRulesVersion('github-diamonds',2));
    assert.ok(validExpansionRulesVersion('github-rummy',1));
    const replay=await store.operate('alice',op);assert.ok(replay.replayed);assert.equal(selected.length,1);
    assert.equal(expansionMax('github-holdem-bonus',1),1010);assert.equal(expansionMax('github-holdem-bonus',2),10);
    assert.equal(expansionMax('github-rummy',1),20);assert.equal(expansionMax('github-rummy',2),13);
  }finally{await db.close();}
});

test('an accepted version 1 round retains its old payout, reserve and replay after update',async()=>{
  const {db,wallet}=await fixture();
  try{
    const old=await cardEngine('rummy','start',undefined,undefined,false,1);
    const payload=old.payload as {ph:unknown[];dh:unknown[]};
    const card=(d:number,v:number)=>({d,v,w:true});
    payload.ph=[card(1,1),card(2,2),card(3,3)];
    payload.dh=[card(1,4),card(2,5),card(3,6)];
    const visible=await cardEngine('rummy','view',payload,undefined,false,1);
    const id=randomUUID();
    const session:ExpansionState={id,gameId:'github-rummy',rulesVersion:1,state:'active',stakeUnits:'1000',spentUnits:'1000',returnedUnits:'0',createdAt:1,settings:{},engine:payload,view:visible.view};
    await db.transaction(async()=>{
      const balance=await demoBalanceUnits(db,'alice')-1000;
      await db.prepare('INSERT INTO demo_casino_sessions VALUES(?,?,?,?,?,?)').run('alice',id,session.gameId,session.state,JSON.stringify(session),20000);
      await saveDemoUnits(db,'alice',balance);await recordDemoUnits(db,'alice',id,'bet',-1000,balance,session.gameId);
    },{lockKey:'account:alice'});
    const reopened=new DemoWalletStore(db);await reopened.ready;
    const loaded=(await reopened.expansion.active('alice')).sessions.find(s=>s.id===id)!;
    assert.equal(loaded.rulesVersion,1);assert.equal(await demoReservedUnits(db,'alice'),20000);
    const op=move(session.gameId,id,'play');const settled=await reopened.expansion.operate('alice',op);
    assert.equal(settled.session.rulesVersion,1);assert.equal(settled.session.spentUnits,'2000');
    assert.equal(settled.session.returnedUnits,'5000');assert.equal(await demoReservedUnits(db,'alice'),0);
    const duplicate=await reopened.expansion.operate('alice',op);assert.equal(duplicate.wallet.balance,settled.wallet.balance);
    const revised=await cardEngine('rummy','play',payload,undefined,false,2);assert.equal(revised.credit,4000);
    const next=await reopened.expansion.operate('alice',start('github-rummy'));assert.equal(next.session.rulesVersion,2);
    const ledger=await db.prepare('SELECT SUM(amount_units) AS total FROM demo_ledger WHERE account_id=?').get('alice');
    assert.equal(Number(ledger!.total),await demoBalanceUnits(db,'alice'));
  }finally{await db.close();}
});

test('unknown stored rules fail before a move can change the wallet',async()=>{
  const {db,wallet}=await fixture();
  try{
    const first=await wallet.expansion.operate('alice',start('github-rummy'));
    await db.prepare("UPDATE demo_casino_sessions SET payload=jsonb_set(payload::jsonb,'{rulesVersion}','3'::jsonb)::text WHERE account_id=? AND id=?").run('alice',first.session.id);
    const before=await demoBalanceUnits(db,'alice');
    await assert.rejects(wallet.expansion.operate('alice',move('github-rummy',first.session.id,'play')),/rules version/);
    assert.equal(await demoBalanceUnits(db,'alice'),before);
  }finally{await db.close();}
});

test('an outdated client is stopped before debit, but its accepted request still replays',async()=>{
  const {db,wallet}=await fixture();
  try{
    const before=await demoBalanceUnits(db,'alice'),op=start('github-rummy');
    await assert.rejects(wallet.expansion.operate('alice',op,1),/Обнови страницу/);
    assert.equal(await demoBalanceUnits(db,'alice'),before);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM demo_casino_sessions WHERE id=?').get(op.id))!.count,0);
    const accepted=await wallet.expansion.operate('alice',op,2);
    const replay=await wallet.expansion.operate('alice',op,1);assert.ok(replay.replayed);
    assert.equal(replay.wallet.balance,accepted.wallet.balance);
    const stillSupported=await wallet.expansion.operate('alice',start('github-war'),1);assert.equal(stillSupported.session.rulesVersion,1);
  }finally{await db.close();}
});
