import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore, WalletError } from '../server/demoWallet';
import { DemoExpansionStore } from '../server/demoExpansion';
import { STUDIO_DEFAULTS, validStudioSlotPresentation, type StudioPresentationGameId, type StudioSlotView } from '../src/shared/studioGames';
import type { ExpansionAction } from '../src/shared/casinoExpansion';
import type { StudioResult } from '../server/games/studioGames';
import { WALLET_ACCOUNT_HEADER } from '../src/shared/walletAccount';

const golden=JSON.parse(readFileSync(new URL('./fixtures/studio-presentation-v1.json',import.meta.url),'utf8')) as {game:StudioPresentationGameId;draws:number[];results:StudioResult[]}[];
const start=(gameId:StudioPresentationGameId):Extract<ExpansionAction,{action:'start'}>=>({id:randomUUID(),gameId,action:'start',stakeUnits:'1000',settings:structuredClone(STUDIO_DEFAULTS[gameId])});
const rejected=(status:number)=>(error:unknown)=>error instanceof WalletError&&error.status===status;
async function rows(db:PostgresDatabase){const state:Record<string,unknown>={};for(const table of ['demo_wallets','demo_ledger','demo_casino_sessions','demo_casino_requests'])state[table]=await db.prepare('SELECT * FROM '+table+' ORDER BY 1,2').all();return JSON.stringify(state);}

test('Read-only PostgreSQL presentation preserves v1 snapshots, replays, reserves and ledger without RNG or settlement',async()=>{
  const db=new PostgresDatabase(':memory:');await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY);INSERT INTO accounts VALUES('alice'),('bob')");
  let values:number[]=[],draws=0,forbiddenCalls=0;
  const wallet=new DemoWalletStore(db);await wallet.operate('alice',{id:randomUUID(),kind:'deposit',amount:100000});
  const store=new DemoExpansionStore(db,id=>wallet.snapshot(id),wallet.ready,async()=>{},()=>{draws++;return values.shift()!;});
  const readDb=new PostgresDatabase(db.schema,{readOnly:true});
  const forbidden=()=>{forbiddenCalls++;throw Error('Presentation must not draw, settle or read a monetary snapshot');};
  const reader=new DemoExpansionStore(readDb,forbidden,readDb.ready,forbidden,forbidden);
  let requests=0;
  try{
    for(const fixture of golden){
      values=[...fixture.draws];const op=start(fixture.game);let session=(await store.operate('alice',op)).session;
      assert.equal(draws,requests+7);requests=draws;
      for(let step=0;step<3;step++){
        assert.deepEqual(session.view.studio,fixture.results[step].studio);assert.equal(session.rulesVersion,1);
        const beforeRows=await rows(db),beforeReply=JSON.stringify(await store.operate('alice',op)),studio=session.view.studio as StudioSlotView;
        const metadata=await reader.presentation('alice',session.id,session.view.phase,studio.step);
        assert(validStudioSlotPresentation(metadata,fixture.game,session.id,session.view.phase,studio));
        assert.equal(JSON.stringify(await reader.presentation('alice',session.id,session.view.phase,studio.step)),JSON.stringify(metadata));
        await assert.rejects(reader.presentation('bob',session.id,session.view.phase,studio.step),rejected(404));
        await assert.rejects(reader.presentation('alice',session.id,session.view.phase%3+1,studio.step),rejected(409));
        await assert.rejects(reader.presentation('alice',session.id,session.view.phase,(studio.step+1)%3),rejected(409));
        assert.equal(await rows(db),beforeRows);assert.equal(JSON.stringify(await store.operate('alice',op)),beforeReply);
        assert.equal(draws,requests);assert.equal(forbiddenCalls,0);
        assert.equal(Object.keys(JSON.parse(beforeReply)).sort().join(),'replayed,session,sessions,wallet');
        if(step<2)session=(await store.operate('alice',{id:randomUUID(),action:'move',gameId:fixture.game,sessionId:session.id,move:'studio-spin'})).session;
      }
      const original=session;
      assert.equal(original.view.phase,1);assert.equal((original.view.studio as StudioSlotView).step,2);
      await assert.rejects(reader.presentation('alice',original.id,1,0),rejected(409),'settled phase 1 cannot be mistaken for base phase 1');
      values=[...fixture.draws];await store.operate('alice',start(fixture.game));requests=draws;
      await assert.rejects(reader.presentation('alice',original.id,original.view.phase,2),rejected(404),'a replaced session is not the current presentation');
    }
    for(const request of [{sessionId:'not-a-uuid',phase:1,step:0},{sessionId:randomUUID(),phase:'1',step:0},{sessionId:randomUUID(),phase:4,step:0},{sessionId:randomUUID(),phase:1,step:-1}])await assert.rejects(reader.presentation('alice',request.sessionId,request.phase,request.step),rejected(400));
    writeFileSync('artifacts/studio-wave2-20261012/metadata-readonly-proof.json',JSON.stringify({legacyGames:golden.length,legacyFrames:6,actualRandomDraws:draws,presentationForbiddenDrawsSnapshotsSettlements:forbiddenCalls,readOnlyPostgres:true,oldReplyKeys:['wallet','session','sessions','replayed'],ledgerPayloadReserveBytesUnchanged:true},null,2)+'\n');
  }finally{await readDb.close();await db.close();}
});

test('Presentation HTTP endpoint retains cookie, account, origin and current-phase guards',async()=>{
  process.env.AUTH_DB_PATH=':memory:';
  const {accounts}=await import('../server/accounts'),{installDemoWallet}=await import('../server/demoWalletRoutes');
  const app=express();installDemoWallet(app);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();assert(address&&typeof address!=='string');const origin='http://127.0.0.1:'+address.port;
  const alice=await accounts.login('studio-presentation-alice-'+randomUUID()+'@example.test','Synthetic-metadata-test!'),bob=await accounts.login('studio-presentation-bob-'+randomUUID()+'@example.test','Synthetic-metadata-test!');
  const headers={Cookie:'royal_session='+alice.token,[WALLET_ACCOUNT_HEADER]:alice.account.id};
  try{
    await accounts.wallet.operate(alice.account.id,{id:randomUUID(),kind:'deposit',amount:1000});
    const first=await accounts.wallet.expansion.operate(alice.account.id,start('studio-cosmic-escape')),session=first.session,view=session.view.studio as StudioSlotView;
    const path='/api/demo-wallet/expansion/presentation?sessionId='+session.id+'&phase='+session.view.phase+'&step='+view.step;
    const oldGet=await fetch(origin+'/api/demo-wallet/expansion',{headers}),before=await oldGet.text();
    const response=await fetch(origin+path,{headers});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert(validStudioSlotPresentation(await response.json(),'studio-cosmic-escape',session.id,session.view.phase,view));
    for(const claim of [{},{Cookie:'royal_session='+alice.token},{[WALLET_ACCOUNT_HEADER]:alice.account.id},{Cookie:'royal_session='+bob.token,[WALLET_ACCOUNT_HEADER]:alice.account.id}]){
      const rejected=await fetch(origin+path,{headers:claim});assert.equal(rejected.status,401);await rejected.json();
    }
    for(const extra of [{Origin:'https://untrusted.example.test'},{'Sec-Fetch-Site':'cross-site'}]){const rejected=await fetch(origin+path,{headers:{...headers,...extra}});assert.equal(rejected.status,403);await rejected.json();}
    const other=await fetch(origin+path,{headers:{Cookie:'royal_session='+bob.token,[WALLET_ACCOUNT_HEADER]:bob.account.id}});assert.equal(other.status,404);await other.json();
    for(const query of ['sessionId='+session.id+'&phase='+session.view.phase,'sessionId='+session.id+'&phase=1&step=0&seed=5','sessionId='+session.id+'&phase=01&step=0','sessionId='+session.id+'&phase=1&step=0&step=1']){
      const invalid=await fetch(origin+'/api/demo-wallet/expansion/presentation?'+query,{headers});assert.equal(invalid.status,400);await invalid.json();
    }
    const stale=await fetch(origin+'/api/demo-wallet/expansion/presentation?sessionId='+session.id+'&phase='+session.view.phase+'&step=1',{headers});assert.equal(stale.status,409);await stale.json();
    assert.equal(await (await fetch(origin+'/api/demo-wallet/expansion',{headers})).text(),before);
  }finally{await accounts.logout(alice.token);await accounts.logout(bob.token);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await accounts.close();}
});
