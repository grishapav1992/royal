import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pvpFixture} from '../../../server-tests/finance/helpers/nile-pvp-fixture';
import {block} from '../../../server-tests/finance/helpers/nile-play-fixture';
import {NileGameRuntime,type NativeCommand} from '../../../server/finance/nile-game-runtime';
import {AFTER_PROGRESS_VERSION} from '../../../src/shared/afterglowWardrobe';
import {validAfterSession} from '../../../src/shared/afterglow';

// This file is compiled through the release's reviewed financial input selection.
// The running Nile contract is wardrobe v3; the current host's v4 is a separate contract.
const command=(path:string,body:unknown=null):NativeCommand=>({path,body,method:body===null?'GET':'POST',flags:Array(9).fill(true),rules:2,query:{}});
async function setup(){const c=await pvpFixture();await c.source.ingest(block(102,'1000000000000',c.config.source.addresses.find(a=>a.userId==='reserve')!.address));await c.ledger.sync(c.source,await c.reconciliation());return c;}

test('published Nile wardrobe v3 imports once, preserves earned progress and rejects incompatible v4',async()=>{
 assert.equal(AFTER_PROGRESS_VERSION,'3');const c=await setup();try{
  const games=new NileGameRuntime(c.ledger,()=>0);await games.ready;
  const legacy={wardrobe:{version:3,revision:7,selectedGirl:1,selectedLook:1,albumUnits:90000,pointsUnits:[400000,100000,300000,200000],unlocked:[true,true,true,true],active:false,activeGirl:null},convoy:{version:1,completedRounds:250}};
  await assert.rejects(games.run(c.a,{...command('/afterglow-wardrobe'),legacy:{...legacy,wardrobe:{...legacy.wardrobe,version:4}}}),/Некорректный прежний прогресс/);
  const profile=await games.run(c.a,{...command('/afterglow-wardrobe'),legacy})as any;assert.equal(profile.version,3);assert.equal(profile.selectedLook,1);assert.equal(profile.selectedGirl,1);assert.equal(profile.revision,7);
  await games.run(c.a,{...command('/'),legacy:{...legacy,convoy:{version:1,completedRounds:0}}});assert.equal((await games.run(c.a,command('/convoy-progress'))as any).completedRounds,250);
  assert.equal((await c.ledger.wallet(c.a)as any).balanceUnits,'200000000');await c.ledger.audit();
 }finally{await c.close();}
});

test('published Nile Alice selection retains v3 stake progress and credits a complete bonus once',async()=>{
 assert.equal(AFTER_PROGRESS_VERSION,'3');const c=await setup();try{
  let seed=5;const games=new NileGameRuntime(c.ledger,max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;});await games.ready;
  const initial=await games.run(c.a,command('/afterglow-wardrobe'))as any;assert.equal(initial.selectedGirl,0);
  await c.ledger.db.prepare('INSERT INTO demo_afterglow_stake_album VALUES(?,15900)').run(c.a);
  let reply=await games.run(c.a,command('/expansion',{id:randomUUID(),action:'start',gameId:'studio-afterglow',stakeUnits:'100',settings:{afterglow:{mode:'normal'}},appearance:{girl:0,look:0,revision:0}}))as any;
  assert(validAfterSession(reply.session));assert.equal(reply.session.state,'active');assert.equal(reply.wallet.balanceUnits,'199000000');let last:unknown;
  while(reply.session.state==='active'){last={id:randomUUID(),action:'move',gameId:'studio-afterglow',sessionId:reply.session.id,move:'afterglow-spin',revision:reply.session.view.afterglow.revision};reply=await games.run(c.a,command('/expansion',last))as any;assert(validAfterSession(reply.session));}
  assert.equal((await games.run(c.a,command('/expansion',last))as any).wallet.balanceUnits,reply.wallet.balanceUnits);
  const earned=await games.run(c.a,command('/afterglow-wardrobe'))as any;assert.equal(earned.albumUnits,16000);assert.deepEqual(earned.pointsUnits,[100,0,0,0]);
  const mia=await games.run(c.a,command('/afterglow-wardrobe',{girl:1,look:0,revision:earned.revision}))as any;assert.equal(mia.selectedGirl,1);await c.ledger.audit();
 }finally{await c.close();}
});
