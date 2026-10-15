import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readFileSync,writeFileSync} from 'node:fs';
import {PostgresDatabase} from '../server/database';
import {DemoWalletStore,WalletError} from '../server/demoWallet';
import {DemoExpansionStore} from '../server/demoExpansion';
import {STUDIO_DEFAULTS,validStudioSlotPresentation,type StudioElementPresentationGameId,type StudioSlotView} from '../src/shared/studioGames';
import type {ExpansionAction} from '../src/shared/casinoExpansion';
import type {StudioResult} from '../server/games/studioGames';
import {WALLET_ACCOUNT_HEADER} from '../src/shared/walletAccount';

const directory='artifacts/studio-wave5-20261012';
type Fixture={name:string;gameId:StudioElementPresentationGameId;stops:number[];seeds:number[];results:StudioResult[]};
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/studio-element-presentation-v1.json',import.meta.url),'utf8')) as Fixture[];
const start=(gameId:StudioElementPresentationGameId):Extract<ExpansionAction,{action:'start'}>=>({id:randomUUID(),gameId,action:'start',stakeUnits:'1000',settings:structuredClone(STUDIO_DEFAULTS[gameId])});
const rejected=(status:number)=>(error:unknown)=>error instanceof WalletError&&error.status===status;
async function rows(db:PostgresDatabase){const result:Record<string,unknown>={};for(const table of ['demo_wallets','demo_ledger','demo_casino_sessions','demo_casino_requests'])result[table]=await db.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all();return JSON.stringify(result);}

test('Read-only element metadata preserves golden receipts, RNG, reserves and all ledger/session/request rows',async()=>{
  const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('element-alice'),('element-bob')");
  let values:number[]=[],draws=0,forbiddenCalls=0,metadataReads=0,frames=0;
  const wallet=new DemoWalletStore(db);await wallet.operate('element-alice',{id:randomUUID(),kind:'deposit',amount:100000});
  const store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>{draws++;return values.shift()!;});
  const readDb=new PostgresDatabase(db.schema,{readOnly:true}),forbidden=()=>{forbiddenCalls++;throw Error('Presentation must not draw, settle or snapshot money');};
  const reader=new DemoExpansionStore(readDb,forbidden,readDb.ready,forbidden,forbidden);
  try{
    for(const fixture of fixtures){
      values=[...fixture.stops,...fixture.seeds];const operation=start(fixture.gameId);let session=(await store.operate('element-alice',operation)).session;
      assert.equal(session.rulesVersion,1);
      for(let step=0;step<fixture.results.length;step++){
        assert.deepEqual(session.view.studio,fixture.results[step].studio);const view=session.view.studio as StudioSlotView;
        const beforeRows=await rows(db),beforeReply=JSON.stringify(await store.operate('element-alice',operation)),beforeDraws=draws;
        const metadata=await reader.presentation('element-alice',session.id,session.view.phase,view.step);metadataReads++;
        assert(validStudioSlotPresentation(metadata,fixture.gameId,session.id,session.view.phase,view));assert.deepEqual(metadata.heldBefore,[]);assert.deepEqual(metadata.heldAfter,[]);assert.equal(Boolean(metadata.chosen),fixture.gameId==='studio-saffron-cipher');
        assert.equal(JSON.stringify(await reader.presentation('element-alice',session.id,session.view.phase,view.step)),JSON.stringify(metadata));metadataReads++;
        await assert.rejects(reader.presentation('element-bob',session.id,session.view.phase,view.step),rejected(404));
        await assert.rejects(reader.presentation('element-alice',session.id,session.view.phase%3+1,view.step),rejected(409));
        await assert.rejects(reader.presentation('element-alice',session.id,session.view.phase,(view.step+1)%3),rejected(409));
        await assert.rejects(reader.presentation('element-alice','not-a-session',session.view.phase,view.step),rejected(400));
        assert.equal(await rows(db),beforeRows);assert.equal(JSON.stringify(await store.operate('element-alice',operation)),beforeReply);assert.equal(draws,beforeDraws);assert.equal(forbiddenCalls,0);frames++;
        assert.equal(Object.keys(JSON.parse(beforeReply)).sort().join(),'replayed,session,sessions,wallet');
        assert(!/"(engine|seeds|seed|stops|payoutUnits|totalPayoutUnits|balance)"/.test(JSON.stringify(metadata)));
        if(step+1<fixture.results.length){const move:ExpansionAction={id:randomUUID(),action:'move',gameId:fixture.gameId,sessionId:session.id,move:'studio-spin'};const first=await store.operate('element-alice',move),afterMove=await rows(db),repeat=await store.operate('element-alice',move);assert.equal(repeat.replayed,true);assert.deepEqual(repeat.session,first.session);assert.equal(await rows(db),afterMove);session=first.session;}
      }
      assert.equal(session.state,'settled');assert.equal(session.view.phase,1);assert.equal(session.spentUnits,'1000');assert.equal(session.returnedUnits,fixture.results.at(-1)!.credit.toString());
      const walletView=await wallet.snapshot('element-alice');assert.equal(walletView.entries.filter(entry=>entry.kind==='bet'&&entry.operationId===operation.id).length,1);
      const original=session;values=[...fixture.stops,...fixture.seeds];let replacement=(await store.operate('element-alice',start(fixture.gameId))).session;
      await assert.rejects(reader.presentation('element-alice',original.id,1,(original.view.studio as StudioSlotView).step),rejected(404));
      while(replacement.state==='active')replacement=(await store.operate('element-alice',{id:randomUUID(),action:'move',gameId:fixture.gameId,sessionId:replacement.id,move:'studio-spin'})).session;
    }
    writeFileSync(directory+'/metadata-readonly-proof.json',JSON.stringify({legacyFixtures:fixtures.length,legacyFrames:frames,metadataReads,forbiddenDrawsSnapshotsSettlements:forbiddenCalls,readOnlyPostgres:true,allLedgerPayloadReserveRequestRowsAndReplyBytesUnchanged:true,oneOriginalBetPerRound:true,currentSessionAndExactPhaseStepEnforced:true},null,2)+'\n');
  }finally{await readDb.close();await db.close();}
});

test('Element HTTP metadata enforces login, account, origin, private-field and latest step guards',async()=>{
  process.env.AUTH_DB_PATH=':memory:';
  const {accounts}=await import('../server/accounts'),{installDemoWallet}=await import('../server/demoWalletRoutes');
  const app=express();installDemoWallet(app);const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
  const alice=await accounts.login('studio-element-alice-'+randomUUID()+'@example.test','Synthetic-metadata-test!'),bob=await accounts.login('studio-element-bob-'+randomUUID()+'@example.test','Synthetic-metadata-test!');
  const headers={Cookie:'royal_session='+alice.token,[WALLET_ACCOUNT_HEADER]:alice.account.id};let requests200=0;
  try{
    await accounts.wallet.operate(alice.account.id,{id:randomUUID(),kind:'deposit',amount:1000});
    for(const gameId of ['studio-stormforge-duel','studio-saffron-cipher','studio-beacon-bay'] as const){let session=(await accounts.wallet.expansion.operate(alice.account.id,start(gameId))).session;
      for(;;){
        const view=session.view.studio as StudioSlotView,path='/api/demo-wallet/expansion/presentation?sessionId='+session.id+'&phase='+session.view.phase+'&step='+view.step;
        const before=await (await fetch(origin+'/api/demo-wallet/expansion',{headers})).text();
        const response=await fetch(origin+path,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const metadata=await response.json();requests200++;
        assert(validStudioSlotPresentation(metadata,gameId,session.id,session.view.phase,view));assert(!/"(engine|seeds|seed|stops|payoutUnits|totalPayoutUnits|balance)"/.test(JSON.stringify(metadata)));
        const probes:[string,HeadersInit,number][]=[
          [path,{},401],
          [path,{Cookie:'royal_session='+bob.token,[WALLET_ACCOUNT_HEADER]:bob.account.id},404],
          [path,{Cookie:'royal_session='+alice.token,[WALLET_ACCOUNT_HEADER]:bob.account.id},401],
          [path,{...headers,Origin:'https://untrusted.example.test'},403],
          [path.replace('&step='+view.step,'&step='+((view.step+1)%3)),headers,409],
          [path.replace('&phase='+session.view.phase,'&phase='+(session.view.phase%3+1)),headers,409],
          [path+'&seed=5',headers,400],
          [path+'&future=1',headers,400],
          [path+'&step=0',headers,400],
          [path.replace(session.id,'not-a-session'),headers,400]
        ];
        for(const [url,requestHeaders,status]of probes){const rejectedResponse=await fetch(origin+url,{headers:requestHeaders});assert.equal(rejectedResponse.status,status,url);await rejectedResponse.json();}
        assert.equal(await (await fetch(origin+'/api/demo-wallet/expansion',{headers})).text(),before);
        if(session.state==='settled')break;
        session=(await accounts.wallet.expansion.operate(alice.account.id,{id:randomUUID(),action:'move',gameId,sessionId:session.id,move:'studio-spin'})).session;
      }
    }
    writeFileSync(directory+'/metadata-http-proof.json',JSON.stringify({games:3,requests200,cacheControlNoStore:true,loginAccountOriginSessionPhaseStepAndPrivateQueryGuards:true,mainExpansionResponseBytesUnchanged:true},null,2)+'\n');
  }finally{await accounts.logout(alice.token);await accounts.logout(bob.token);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await accounts.close();}
});
