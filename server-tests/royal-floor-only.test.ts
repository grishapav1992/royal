import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ARCADE_HOUSE_GAMES,ARCHIVED_GITHUB_GAMES,RETIRED_ARCADE_GAMES,isCollectionGame} from '../src/shared/arcadeCatalog';
import {cabinetsInHall} from '../src/shared/cabinets';
import {CLUB_ZONES} from '../src/shared/clubLayout';
import {BAR_APPROACH,HALLS,HALL_DOORS,hallObstacles} from '../src/shared/world';
import {findPath,walkable} from '../src/game/navigation';
import {cabinetSeat} from '../src/shared/cabinetSeating';
process.env.AUTH_DB_PATH=':memory:';
const {accounts}=await import('../server/accounts');
const {installDemoWallet}=await import('../server/demoWalletRoutes');
test.after(()=>accounts.close());

test('the first floor has exactly the approved twelve games and every seat has a real walkable route',()=>{
 const approved=['studio-cosmic-escape','studio-caramel-carnival','studio-velvet-reign','studio-last-convoy','studio-nitro-run','studio-afterglow','studio-meme-overload','studio-dracona','studio-neopolis','github-crash','royal-plinko','original-cr-vs-leo'];
 assert.deepEqual([...ARCADE_HOUSE_GAMES].sort(),approved.sort());
 assert.deepEqual(cabinetsInHall('arcade').map(c=>c.id).sort(),approved);
 assert(CLUB_ZONES.arcade.every(z=>!/github|luelon|casino api/i.test(z.name)));
 const obstacles=hallObstacles('arcade');
 for(const cabinet of cabinetsInHall('arcade')){
  const seat=cabinetSeat(cabinet);
  assert(walkable(seat.entry.x,seat.entry.y,obstacles));
  for(const start of [HALLS.arcade.spawn,HALL_DOORS.arcade.arrival,BAR_APPROACH])assert(findPath(start,seat.entry,obstacles).length>0,cabinet.id);
 }
 for(const id of RETIRED_ARCADE_GAMES)assert(!isCollectionGame('royal',id));
 assert.equal(ARCHIVED_GITHUB_GAMES.length,9);
});

test('the mathematical archive preserves source hashes and correct authorship',()=>{
 const manifest=JSON.parse(readFileSync('docs/game-math/github-games/manifest.json','utf8'));
 assert.equal(manifest.label,'Игры с GitHub');
 assert.equal(manifest.games.filter((g:any)=>g.origin==='github-adaptation').length,9);
 assert.equal(manifest.games.filter((g:any)=>g.origin==='royal-studio').length,32);
 for(const [path,digest]of Object.entries(manifest.sources))assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),digest,path);
});

test('removed games reject new HTTP stakes, replay old receipts, and finish a saved Mines round once',async()=>{
 const app=express();installDemoWallet(app);const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const address=server.address();assert(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}/api/demo-wallet`;
 try{
  const login=await accounts.login('floor-only-'+randomUUID()+'@example.test','Floor-only-test-42!');
  const id=login.account.id,headers={'Cookie':'royal_session='+login.token,'X-Royal-Account-Id':id,'Content-Type':'application/json'};
  await accounts.wallet.operate(id,{id:randomUUID(),kind:'deposit',amount:1000});
  const dice={id:randomUUID(),kind:'play',amount:10,gameId:'royal-dice',rulesVersion:1,input:{gameMode:'rollUnder',sliderValue:50}};
  const savedDice=await accounts.wallet.operate(id,dice);
  const mineStart={id:randomUUID(),action:'start',amount:10,mineCount:1};
  const savedMine=await accounts.wallet.mines.operate(id,mineStart);assert(savedMine.session);
  const before=await accounts.wallet.snapshot(id);
  const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
  for(const [path,body]of [['/operations',{...dice,id:randomUUID()}],['/mines',{...mineStart,id:randomUUID()}],['/expansion',{id:randomUUID(),action:'start',gameId:'studio-fossil-trail',stakeUnits:'1000',settings:{studio:{}}}]] as const){const response=await post(path,body);assert.equal(response.status,409,path+' '+await response.text());}
  assert.deepEqual(await accounts.wallet.snapshot(id),before);
  const replay=await post('/operations',dice);assert.equal(replay.status,200);assert.deepEqual((await replay.json()).gameRound,savedDice.gameRound);
  assert.equal((await post('/mines',mineStart)).status,200);
  const cells=Reflect.get(accounts.wallet.mines,'db');const row=await cells.prepare('SELECT * FROM demo_mines_sessions WHERE account_id=? AND id=?').get(id,savedMine.session.id);
  const mines=JSON.parse(String(row.mine_cells));const safe=Array.from({length:25},(_,i)=>i).find(i=>!mines.includes(i))!;
  assert.equal((await post('/mines',{id:randomUUID(),action:'reveal',sessionId:savedMine.session.id,cell:safe})).status,200);
  const cashout={id:randomUUID(),action:'cashout',sessionId:savedMine.session.id};const done=await post('/mines',cashout);assert.equal(done.status,200);
  const balance=(await done.json()).wallet.balance;assert.equal((await (await post('/mines',cashout)).json()).wallet.balance,balance);
  const plinko={id:randomUUID(),kind:'play',amount:10,gameId:'royal-plinko',rulesVersion:1,input:{rows:12,risk:'easy'}};
  assert.equal((await post('/operations',plinko)).status,200);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
