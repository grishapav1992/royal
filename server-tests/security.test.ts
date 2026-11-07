import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../server/accounts';
import { ModerationStore } from '../server/moderation';
import { ChatSpam } from '../server/chatSpam';
import { ChatProfanity } from '../server/chatProfanity';
import { PostgresDatabase } from '../server/database';
import { Guards } from '../server/guards';
import { LobbyState, Player } from '../server/state';
import { SECURITY_BAN_MS, SECURITY_WARNING_MS } from '../src/shared/security';
import { hallObstacles, hallLinks, type HallId } from '../src/shared/world';
import { walkable } from '../src/game/navigation';

test('warnings and bans survive reload, are account-scoped, expire and reset after a served ban', async () => {
  const dir = mkdtempSync(join(tmpdir(),'royal-security-')), file = join(dir,'accounts.sqlite');
  let store = new AccountStore(file);
  try {
    const {account} = await store.login('guard@example.test','test-password');
    const first = (await store.moderation.record(account.id,1000));
    assert.deepEqual(first,{kind:'warning',until:1000+SECURITY_WARNING_MS});
    (await store.close()); store = new AccountStore(file);
    assert.equal((await store.moderation.banUntil(account.id,2000)),0);
    const second = (await store.moderation.record(account.id,2000));
    assert.deepEqual(second,{kind:'ejecting',until:2000+SECURITY_BAN_MS});
    assert.equal((await store.moderation.banUntil('unrelated',2000)),0);
    assert.deepEqual((await store.moderation.record(account.id,3000)),second);
    (await store.close()); store = new AccountStore(file);
    assert.equal((await store.moderation.banUntil(account.id,4000)),second.until);
    assert.equal((await store.moderation.banUntil(account.id,second.until)),0);
    assert.equal((await store.moderation.record(account.id,second.until)).kind,'warning');
    assert.equal((await store.moderation.record(account.id,second.until+SECURITY_WARNING_MS)).kind,'warning');
  } finally {(await store.close());rmSync(dir,{recursive:true});}
});

test('new conduct policy does not carry over old profanity sanctions',async ()=>{
 const db=new PostgresDatabase(':memory:');
 try {
  (await db.exec("CREATE TABLE accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('a'); CREATE TABLE chat_discipline(account_id TEXT PRIMARY KEY,warned_until INTEGER,banned_until INTEGER); INSERT INTO chat_discipline VALUES('a',999999,999999)"));
  const store=new ModerationStore(db);
  assert.equal((await store.banUntil('a',1000)),0);
  assert.equal((await store.record('a',1000)).kind,'warning');
  assert.equal((await store.record('a',2000)).kind,'ejecting');
  assert.equal((await db.prepare('SELECT banned_until FROM chat_discipline').get())!.banned_until,999999);
 } finally {(await db.close());}
});

test('spam detects normalized repeated messages, isolates accounts and expires old history',()=>{
 const spam=new ChatSpam();
 assert.equal(spam.check('a','ПРИВЕТ всем!',1000),'ok');
 assert.equal(spam.check('a','Привет всем',6000),'ok');
 assert.equal(spam.check('b','Привет всем',9000),'ok');
 assert.equal(spam.check('a','при\u200bвет   всем...',11000),'spam');
 assert.equal(spam.check('a','Привет всем',15000),'ok','a new episode starts after a warning');
 assert.equal(spam.check('a','Привет всем',46000),'ok','old entries expire');
 for(let i=0;i<4;i++)assert.equal(spam.check('short','да',50000+i*6000),'ok');
 assert.equal(spam.check('short','ДА!',75000),'spam');
});

test('profanity reaches ten words in a rolling 30-second window per account', () => {
 const profanity = new ChatProfanity();
 assert.equal(profanity.check('a', 6, 1000), false);
 assert.equal(profanity.check('a', 3, 2000), false);
 assert.equal(profanity.check('b', 5, 2000), false);
 assert.equal(profanity.check('a', 1, 30999), true);
 assert.equal(profanity.check('b', 4, 30999), false);
 profanity.clear('a');
 assert.equal(profanity.check('a', 1, 31000), false);
 assert.equal(profanity.check('c', 9, 31000), false);
 assert.equal(profanity.check('c', 1, 61000), false);
 assert.equal(profanity.check('c', 9, 61001), true);
});

test('flood protection warns about speed before sanctioning and allows ordinary varied conversation',()=>{
 const spam=new ChatSpam();
 for(let i=0;i<7;i++)assert.equal(spam.check('flood','сообщение '+i,1000+i*100),i<4?'ok':'slow');
 assert.equal(spam.check('flood','восьмое сообщение',1800),'spam');
 for(let i=0;i<30;i++)assert.equal(spam.check('normal','разная реплика '+i,1000+i*3000),'ok');
 spam.clear('normal');assert.equal(spam.check('normal','ещё одна реплика',92000),'ok');
});

test('spam catches small edits to long messages but permits changing numbers in conversation', () => {
 const spam = new ChatSpam();
 assert.equal(spam.check('a', 'Заходите в нашу группу, там ежедневно раздают бонусы', 1000), 'ok');
 assert.equal(spam.check('a', 'Заходите в нашу группку, там ежеднево раздают бонусы', 6000), 'ok');
 assert.equal(spam.check('a', 'Заходите в нашу групу, там ежедневно раздают бонусы!', 11000), 'spam');
 for (let index = 1; index <= 3; index++) {
  assert.equal(spam.check('b', 'У меня сейчас на игровом счёте ' + index * 100 + ' очков', 1000 + index * 5000), 'ok');
 }
});

test('telegram spam requires three messages about the same destination within the window', () => {
 const spam = new ChatSpam();
 assert.equal(spam.check('a', 'Уже есть новый пост на https://t.me/RoyalExample/12', 1000), 'ok');
 assert.equal(spam.check('a', 'Telegram: @royalexample и https://t.me/another_example', 6000), 'ok');
 assert.equal(spam.check('b', 'Ещё один пост https://t.me/RoyalExample/12', 8000), 'ok');
 assert.equal(spam.check('a', 'Подборка новостей t.me/another_example', 11000), 'ok');
 assert.equal(spam.check('a', 'Смотрите архив на https://telegram.me/s/royalexample?source=game', 16000), 'spam');
 assert.equal(spam.check('b', 'Канал здесь tg://resolve?domain=RoyalExample', 39000), 'ok');
 assert.equal(spam.check('b', 'Написал про обновление в ТГ: @RoyalExample', 44000), 'ok');
 for (const [index, text] of [
  'Про этот сайт уже говорил https://t.me/share?url=example.org',
  'Открой встроенный диалог t.me/share/url?url=another.example',
  'Вот инструкция https://t.me/share?url=docs.example',
 ].entries()) assert.equal(spam.check('c', text, 49000 + 5000 * index), 'ok');
});

test('guards warn, release, carry and eject in all three halls without crossing furniture; queued/disconnected guests do not stall duty',()=>{
  for(const hall of ['arcade','tables','github'] as const){
    const state=new LobbyState(), done:string[]=[], phases=new Set<string>();
    const guards=new Guards(state,(id,decision)=>done.push(id+':'+decision.kind));
    const p=new Player();p.hall=hall;p.x=700;p.y=280;state.players.set('a',p);
    guards.enqueue('a',{kind:'warning',until:100});
    for(let i=0;i<600;i++){guards.tick(.05);const g=state.guards.get('security')!;phases.add(g.phase);assert(walkable(g.x,g.y,hallObstacles(g.hall)));}
    assert(done.includes('a:warning'));assert.equal(p.security,'');assert(phases.has('warn'));
    guards.enqueue('a',{kind:'ejecting',until:1000});
    for(let i=0;i<1000;i++){guards.tick(.05);const g=state.guards.get('security')!;phases.add(g.phase);assert(walkable(g.x,g.y,hallObstacles(g.hall)));}
    assert(done.includes('a:ejecting'));assert(phases.has('carry'));assert(phases.has('throw'));
    state.players.delete('a');const b=new Player();b.hall=hall;state.players.set('b',b);guards.enqueue('b',{kind:'warning',until:100});state.players.delete('b');
    for(let i=0;i<200;i++)guards.tick(.05);assert.equal(state.guards.get('security')!.target,'');assert.notEqual(state.guards.get('security')!.phase,'approach');
  }
});

test('a repeat violation in another room upgrades a pending warning to an ejection',()=>{
 const state=new LobbyState(), decisions:string[]=[];const guards=new Guards(state,(_id,d)=>decisions.push(d.kind));
 const p=new Player();p.x=585;p.y=610;state.players.set('a',p);
 guards.enqueue('a',{kind:'warning',until:100});
 for(let i=0;i<20;i++)guards.tick(.05);
 assert.equal(state.guards.get('security')!.phase,'warn');
 guards.enqueue('a',{kind:'ejecting',until:1000});
 for(let i=0;i<300;i++)guards.tick(.05);
 assert.deepEqual(decisions,['ejecting']);assert.equal(p.security,'ejecting');
});

test('guard can reach and escort visitors from narrow passages by cabinets and bar stools',()=>{
 for(const [x,y,hall] of [[170,340,'arcade'],[1000,520,'arcade'],[1000,560,'arcade'],[440,400,'tables'],[440,440,'tables']] as const){
  const state=new LobbyState(),p=new Player();Object.assign(p,{x,y,hall});state.players.set('a',p);let finished=false;
  const guards=new Guards(state,()=>finished=true);guards.enqueue('a',{kind:'ejecting',until:999999});
  let approached=false;
  for(let i=0;i<1000&&!finished;i++){
   guards.tick(.05);const g=state.guards.get('security')!;
   assert(walkable(g.x,g.y,hallObstacles(g.hall)),`${hall}: ${g.x},${g.y}`);
   if(g.phase==='grab'){approached=true;assert(Math.hypot(g.x-x,g.y-y)<40);}
   if(g.phase==='throw')assert(Math.hypot(g.x-540,g.y-640)<1);
  }
  assert(approached,`${hall}: ${x},${y}`);assert(finished);
 }
});

test('ambient patrol visits bar, windows and games, stays outside furniture and varies its conversation',()=>{
 const state=new LobbyState();let seed=2;const random=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32;};
 const guards=new Guards(state,()=>{},random),visits=new Map<string,Set<string>>(),lines=new Set<string>();
 for(let i=0;i<12000;i++){
  guards.tick(.05);
  for(const g of state.guards.values()){
   const hall=g.hall;
   assert(walkable(g.x,g.y,hallObstacles(g.hall)),`${hall} ${g.routine}: ${g.x},${g.y}`);
   if(!visits.has(hall))visits.set(hall,new Set());
   if(['chat','window','inspect','watch'].includes(g.phase))visits.get(hall)!.add(g.routine);
   if(g.phase==='chat') {assert.equal(hall,'arcade');assert(Math.hypot(g.x-828,g.y-520)<1);if(g.reply)lines.add(g.reply);}
   else assert.equal(g.reply,'');
  }
 }
 for(const id of ['bar','window','piano','arcades','lounge','entrance'])assert(visits.get('arcade')!.has(id),id);
 for(const id of ['window','pool','hockey','chess','entrance'])assert(visits.get('tables')!.has(id),id);
 for(const id of ['cards','dice','entrance'])assert(visits.get('github')!.has(id),id);
 assert(lines.size>=4,'at least two different exchanges with Mira');
});

test('every leisure activity is immediately interrupted for an offense, and patrol resumes afterwards',()=>{
 for(const phase of ['patrol','chat','window','inspect','watch']){
  const state=new LobbyState(),guards=new Guards(state,()=>{},()=>.4),g=state.guards.get('security')!;
  for(let i=0;i<5000&&g.phase!==phase;i++)guards.tick(.05);
  assert.equal(g.phase,phase);
  const p=new Player();p.hall=g.hall;p.x=700;p.y=550;state.players.set('offender',p);
  guards.enqueue('offender',{kind:'warning',until:999999});guards.tick(.05);
  assert(['approach','warn'].includes(g.phase));assert.equal(g.reply,'');assert.equal(g.target,'offender');assert.equal(p.security,'warning');
  let released=false,resumed=false;
  for(let i=0;i<1000;i++){guards.tick(.05);if(!p.security)released=true;if(released&&g.phase==='patrol')resumed=true;}
  assert(released);assert(resumed);
 }
});

test('one guard keeps its identity and crosses only through paired doors during a full club patrol',()=>{
 const state=new LobbyState(),guards=new Guards(state,()=>{},()=>.3),guard=state.guards.get('security')!;
 let crossings=0,previous={hall:guard.hall,x:guard.x,y:guard.y,phase:guard.phase};
 for(let i=0;i<8000;i++){
  guards.tick(.05);assert.equal(state.guards.size,1);assert.equal(state.guards.get('security'),guard);
  assert(walkable(guard.x,guard.y,hallObstacles(guard.hall)));
  if(previous.hall!==guard.hall){
   const link=hallLinks(previous.hall as HallId).find(link=>link.target===guard.hall)!;
   assert(link,'guard crosses connected rooms only');
   const exit=link.door.entry,entry=link.arrival.entry;
   assert.equal(previous.phase,'door');assert.equal(guard.phase,'enter');
   assert(Math.hypot(previous.x-exit.x,previous.y-exit.y)<.01);
   assert(Math.hypot(guard.x-entry.x,guard.y-entry.y)<.01);crossings++;
  }
  previous={hall:guard.hall,x:guard.x,y:guard.y,phase:guard.phase};
 }
 assert(crossings>=4);
});

test('one queue serves both halls via doors, survives a disconnected target and then resumes patrol',()=>{
 const state=new LobbyState(),done:string[]=[],guards=new Guards(state,id=>done.push(id),()=>.3),g=state.guards.get('security')!;
 const a=new Player();a.hall='tables';a.x=700;a.y=550;state.players.set('a',a);
 guards.enqueue('a',{kind:'warning',until:999999,reason:'spam'});guards.tick(.05);
 assert.equal(g.phase,'transit');assert.equal(g.hall,'arcade');assert.equal(g.target,'a');
 state.players.delete('a');guards.tick(.05);assert.equal(g.phase,'return');
 const b=new Player();b.hall='tables';b.x=700;b.y=550;state.players.set('b',b);
 const c=new Player();c.x=700;c.y=550;state.players.set('c',c);
 guards.enqueue('b',{kind:'warning',until:999999});guards.enqueue('c',{kind:'warning',until:999999});
 let transitions=0,previous=g.hall;
 for(let i=0;i<1800;i++){
  guards.tick(.05);assert.equal(state.guards.size,1);
  if(g.hall!==previous){transitions++;previous=g.hall;}
  if(g.phase==='warn')assert.equal(g.hall,state.players.get(g.target)!.hall);
 }
 assert.deepEqual(done,['b','c']);assert(transitions>=2);assert.equal(b.security,'');assert.equal(c.security,'');
 assert.notEqual(g.phase,'return');assert.equal(g.target,'');
});
