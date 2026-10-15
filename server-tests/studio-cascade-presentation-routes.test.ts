import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readFileSync,writeFileSync} from 'node:fs';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore,WalletError} from '../server/demoWallet';
import {DemoExpansionStore} from '../server/demoExpansion';
import {STUDIO_DEFAULTS,validStudioSlotPresentation,type StudioCascadePresentationGameId,type StudioSlotView} from '../src/shared/studioGames';
import type {ExpansionAction} from '../src/shared/casinoExpansion';
import type {StudioResult} from '../server/games/studioGames';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';

const directory='artifacts/studio-wave3-20261012';
type Fixture={name:string;gameId:StudioCascadePresentationGameId;stops:number[];seeds:number[];results:StudioResult[]};
const fixtures=(JSON.parse(readFileSync(new URL('./fixtures/studio-cascade-presentation-v1.json',import.meta.url),'utf8')) as Fixture[]).filter(item=>['both-cascades','early-end-after-first-cascade'].includes(item.name));
const start=(gameId:StudioCascadePresentationGameId):Extract<ExpansionAction,{action:'start'}>=>({id:randomUUID(),gameId,action:'start',stakeUnits:'1000',settings:structuredClone(STUDIO_DEFAULTS[gameId])});
const rejected=(status:number)=>(error:unknown)=>error instanceof WalletError&&error.status===status;
async function rows(db:PostgresDatabase){const result:Record<string,unknown>={};for(const table of ['demo_wallets','demo_ledger','demo_casino_sessions','demo_casino_requests'])result[table]=await db.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all();return JSON.stringify(result);}

test('Read-only cascade metadata keeps legacy receipts, early-end settlement, reserves and ledger unchanged',async()=>{
  const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('cascade-alice'),('cascade-bob')");
  let values:number[]=[],draws=0,forbiddenCalls=0,metadataReads=0;
  const wallet=new DemoWalletStore(db);await wallet.operate('cascade-alice',{id:randomUUID(),kind:'deposit',amount:100000});
  const store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>{draws++;return values.shift()!;});
  const readDb=new PostgresDatabase(db.schema,{readOnly:true}),forbidden=()=>{forbiddenCalls++;throw Error('Presentation must not draw, settle or snapshot money');};
  const reader=new DemoExpansionStore(readDb,forbidden,readDb.ready,forbidden,forbidden);
  try{
    for(const fixture of fixtures){
      values=[...fixture.stops,...fixture.seeds];const operation=start(fixture.gameId);let receipt=await store.operate('cascade-alice',operation),session=receipt.session;
      assert.equal(session.rulesVersion,1);
      for(let step=0;step<fixture.results.length;step++){
        assert.deepEqual(session.view.studio,fixture.results[step].studio);
        const view=session.view.studio as StudioSlotView,beforeRows=await rows(db),beforeReply=JSON.stringify(await store.operate('cascade-alice',operation)),beforeDraws=draws;
        const metadata=await reader.presentation('cascade-alice',session.id,session.view.phase,view.step);metadataReads++;
        assert(validStudioSlotPresentation(metadata,fixture.gameId,session.id,session.view.phase,view));
        assert.equal(JSON.stringify(await reader.presentation('cascade-alice',session.id,session.view.phase,view.step)),JSON.stringify(metadata));metadataReads++;
        await assert.rejects(reader.presentation('cascade-bob',session.id,session.view.phase,view.step),rejected(404));
        await assert.rejects(reader.presentation('cascade-alice',session.id,session.view.phase%3+1,view.step),rejected(409));
        await assert.rejects(reader.presentation('cascade-alice',session.id,session.view.phase,(view.step+1)%3),rejected(409));
        assert.equal(await rows(db),beforeRows);assert.equal(JSON.stringify(await store.operate('cascade-alice',operation)),beforeReply);
        assert.equal(draws,beforeDraws);assert.equal(forbiddenCalls,0);
        assert.equal(Object.keys(JSON.parse(beforeReply)).sort().join(),'replayed,session,sessions,wallet');
        assert.equal(session.view.phase,fixture.results[step].ended?1:step+1);
        if(step+1<fixture.results.length){receipt=await store.operate('cascade-alice',{id:randomUUID(),action:'move',gameId:fixture.gameId,sessionId:session.id,move:'studio-spin'});session=receipt.session;}
      }
      assert.equal(session.state,'settled');assert.equal(session.view.phase,1);assert.equal(session.returnedUnits,fixture.results.at(-1)!.credit.toString());
      await assert.rejects(reader.presentation('cascade-alice',session.id,1,0),rejected(409));
      const original=session;values=[...fixture.stops,...fixture.seeds];let replacement=(await store.operate('cascade-alice',start(fixture.gameId))).session;
      await assert.rejects(reader.presentation('cascade-alice',original.id,1,(original.view.studio as StudioSlotView).step),rejected(404));
      while(replacement.state==='active')replacement=(await store.operate('cascade-alice',{id:randomUUID(),action:'move',gameId:fixture.gameId,sessionId:replacement.id,move:'studio-spin'})).session;
    }
    writeFileSync(directory+'/metadata-readonly-proof.json',JSON.stringify({legacyFixtures:fixtures.length,legacyFrames:fixtures.reduce((sum,item)=>sum+item.results.length,0),metadataReads,forbiddenDrawsSnapshotsSettlements:forbiddenCalls,readOnlyPostgres:true,ledgerPayloadReserveAndReplyBytesUnchanged:true,earlyEndPhase1Supported:true},null,2)+'\n');
  }finally{await readDb.close();await db.close();}
});

test('Cascade HTTP metadata retains account, origin, current session and exact step guards',async()=>{
  process.env.AUTH_DB_PATH=':memory:';
  const {accounts}=await import('../server/accounts'),{installDemoWallet}=await import('../server/demoWalletRoutes');
  const app=express();installDemoWallet(app);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
  const alice=await accounts.login('studio-cascade-alice-'+randomUUID()+'@example.test','Synthetic-metadata-test!'),bob=await accounts.login('studio-cascade-bob-'+randomUUID()+'@example.test','Synthetic-metadata-test!');
  const headers={Cookie:'royal_session='+alice.token,[WALLET_ACCOUNT_HEADER]:alice.account.id};
  try{
    await accounts.wallet.operate(alice.account.id,{id:randomUUID(),kind:'deposit',amount:1000});
    for(const gameId of ['studio-caramel-carnival','studio-starfall-oracle'] as const){
      let session=(await accounts.wallet.expansion.operate(alice.account.id,start(gameId))).session;
      for(;;){
        const view=session.view.studio as StudioSlotView,path='/api/demo-wallet/expansion/presentation?sessionId='+session.id+'&phase='+session.view.phase+'&step='+view.step;
        const oldGet=await fetch(origin+'/api/demo-wallet/expansion',{headers}),before=await oldGet.text();
        const response=await fetch(origin+path,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
        assert(validStudioSlotPresentation(await response.json(),gameId,session.id,session.view.phase,view));
        const other=await fetch(origin+path,{headers:{Cookie:'royal_session='+bob.token,[WALLET_ACCOUNT_HEADER]:bob.account.id}});assert.equal(other.status,404);await other.json();
        const mismatch=await fetch(origin+path,{headers:{Cookie:'royal_session='+alice.token,[WALLET_ACCOUNT_HEADER]:bob.account.id}});assert.equal(mismatch.status,401);await mismatch.json();
        const untrusted=await fetch(origin+path,{headers:{...headers,Origin:'https://untrusted.example.test'}});assert.equal(untrusted.status,403);await untrusted.json();
        const stale=await fetch(origin+'/api/demo-wallet/expansion/presentation?sessionId='+session.id+'&phase='+session.view.phase+'&step='+((view.step+1)%3),{headers});assert.equal(stale.status,409);await stale.json();
        const extra=await fetch(origin+path+'&seed=5',{headers});assert.equal(extra.status,400);await extra.json();
        assert.equal(await (await fetch(origin+'/api/demo-wallet/expansion',{headers})).text(),before);
        if(session.state==='settled')break;
        session=(await accounts.wallet.expansion.operate(alice.account.id,{id:randomUUID(),action:'move',gameId,sessionId:session.id,move:'studio-spin'})).session;
      }
    }
  }finally{await accounts.logout(alice.token);await accounts.logout(bob.token);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await accounts.close();}
});
