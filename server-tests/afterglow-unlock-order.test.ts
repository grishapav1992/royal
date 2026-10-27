import test from 'node:test';
import assert from 'node:assert/strict';
import {PostgresDatabase} from '../server/database';
import {AfterglowWardrobeStore} from '../server/afterglowWardrobe';
import {afterAlbumUnlocked,AFTER_GALLERY_ORDER,validAfterWardrobe} from '../src/shared/afterglowWardrobe';

async function setup(){
 const db=new PostgresDatabase(':memory:');
 const prerequisite=db.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY);
  INSERT INTO accounts VALUES('player');
  CREATE TABLE demo_casino_sessions(account_id TEXT,id TEXT,game_id TEXT,state TEXT,payload TEXT);
  CREATE TABLE demo_afterglow_albums(account_id TEXT,cards INTEGER);`);
 const store=new AfterglowWardrobeStore(db,prerequisite);await store.ready;
 return{db,store,close:async()=>{await db.dropSchema();await db.close();}};
}

test('heroines unlock strictly from common to legendary at each album boundary',()=>{
 for(const [units,count]of [[0,1],[15999,1],[16000,2],[43999,2],[44000,3],[89999,3],[90000,4]]){
  assert.deepEqual(AFTER_GALLERY_ORDER.filter(girl=>afterAlbumUnlocked(units)[girl]),AFTER_GALLERY_ORDER.slice(0,count));
 }
});

test('new accounts start with Mia and the server rejects every locked heroine',async()=>{
 const c=await setup();try{
  const initial=await c.store.snapshot('player');assert.equal(initial.selectedGirl,1);assert.equal(initial.version,4);
  for(const girl of [3,2,0])await assert.rejects(c.store.choose('player',{girl,look:0,revision:0}),/ещё не открыта/);
  await c.db.prepare('INSERT INTO demo_afterglow_stake_album VALUES(?,?)').run('player',16000);
  const rare=await c.store.choose('player',{girl:3,look:0,revision:0});assert.equal(rare.selectedGirl,3);
  for(const girl of [2,0])await assert.rejects(c.store.choose('player',{girl,look:0,revision:rare.revision}),/ещё не открыта/);
  await c.db.prepare('UPDATE demo_afterglow_stake_album SET points_units=44000').run();
  const epic=await c.store.choose('player',{girl:2,look:0,revision:rare.revision});assert.equal(epic.selectedGirl,2);
  await assert.rejects(c.store.choose('player',{girl:0,look:0,revision:epic.revision}),/ещё не открыта/);
  await c.db.prepare('UPDATE demo_afterglow_stake_album SET points_units=90000').run();
  assert.equal((await c.store.choose('player',{girl:0,look:0,revision:epic.revision})).selectedGirl,0);
 }finally{await c.close();}
});

test('former starter falls back to Mia while earned progress and second looks survive',async()=>{
 const c=await setup();try{
  await c.db.exec("INSERT INTO demo_afterglow_wardrobe VALUES('player',0,0,7); INSERT INTO demo_afterglow_stake_album VALUES('player',100); INSERT INTO demo_afterglow_stake_girls VALUES('player',0,100)");
  const changed=await c.store.snapshot('player');assert.equal(changed.selectedGirl,1);assert.equal(changed.selectedLook,0);assert.equal(changed.pointsUnits[0],100);assert.equal(changed.revision,7);
  const chosen=await c.store.choose('player',{girl:1,look:0,revision:7});assert.equal(chosen.revision,8);
  await c.db.exec("UPDATE demo_afterglow_stake_album SET points_units=90000; UPDATE demo_afterglow_stake_girls SET points_units=400000");
  assert.equal((await c.store.snapshot('player')).selectedGirl,1);
  await c.store.choose('player',{girl:0,look:1,revision:8});
  const earned=await c.store.snapshot('player');assert.equal(earned.selectedGirl,0);assert.equal(earned.selectedLook,1);assert.equal(earned.unlocked[0],true);
 }finally{await c.close();}
});

test('accepted old bonus retains its heroine and credits her once before applying the new order',async()=>{
 const c=await setup();try{
  await c.db.exec("INSERT INTO demo_afterglow_wardrobe VALUES('player',0,0,5); INSERT INTO demo_afterglow_stake_album VALUES('player',15900); INSERT INTO demo_afterglow_round_girls VALUES('player','old-bonus',0,FALSE); INSERT INTO demo_casino_sessions VALUES('player','old-bonus','studio-afterglow','active','{}')");
  const active=await c.store.snapshot('player');assert.equal(active.selectedGirl,0);assert.equal(active.activeGirl,0);assert(validAfterWardrobe(active));
  await assert.rejects(c.store.choose('player',{girl:1,look:0,revision:5}),/Заверши фотосессию/);
  await c.db.transaction(async()=>{
   await c.db.prepare("UPDATE demo_casino_sessions SET state='settled'").run();
   await c.store.completeRound('player','old-bonus','100');
   await c.store.completeRound('player','old-bonus','100');
  },{lockKey:'account:player'});
  const settled=await c.store.snapshot('player');assert.equal(settled.selectedGirl,1);assert.equal(settled.albumUnits,16000);assert.equal(settled.pointsUnits[0],100);assert.equal(settled.pointsUnits[1],0);
  assert.equal((await c.store.choose('player',{girl:3,look:0,revision:5})).selectedGirl,3);
 }finally{await c.close();}
});

test('client validation rejects old profiles and premature selections',async()=>{
 const c=await setup();try{
  const profile=await c.store.snapshot('player');assert(validAfterWardrobe(profile));
  assert(!validAfterWardrobe({...profile,version:3}));
  assert(!validAfterWardrobe({...profile,selectedGirl:0}));
  assert(!validAfterWardrobe({...profile,selectedGirl:2,active:true,activeGirl:0}));
 }finally{await c.close();}
});
