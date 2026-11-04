import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PostgresDatabase } from '../server/database';
import { DemoWalletStore } from '../server/demoWallet';
import { VirtualPvpLedger } from '../server/pvp/virtual-wallet';
import { PvpStore } from '../server/pvp/store';
import { PvpRoom } from '../server/pvp/room';
import { virtualPvpCommand } from '../server/pvp/virtual-service';
import { VIRTUAL_PVP_SCOPE, validPvpRequest } from '../src/shared/pvp';

test('historical invitations remain parseable; upfront offers accept only qualified stakes',()=>{
  const base={id:randomUUID(),action:'create',gameId:'tsu-e-fa',mode:'free',targetWins:3,stakeUnits:'0',targetId:randomUUID()};
  assert(validPvpRequest(base));
  for(const change of [{targetWins:2},{targetWins:4},{targetWins:100},{mode:'free',stakeUnits:'1000000'},{mode:'stake',stakeUnits:'0'},{gameId:'chess'},{mode:'free',amount:100}])assert(!validPvpRequest({...base,...change}));
  for(const targetWins of [3,5,7])assert(validPvpRequest({...base,targetWins}));
  const invite={id:randomUUID(),action:'invite',gameId:'tsu-e-fa',targetId:randomUUID()};assert(validPvpRequest(invite));assert(!validPvpRequest({...invite,mode:'free'}));assert(!validPvpRequest({...invite,stakeUnits:'0'}));
  for(const stakeUnits of ['100000','200000','500000','1000000','2000000','5000000','10000000','20000000','50000000'])assert(validPvpRequest({...invite,stakeUnits}));
  for(const stakeUnits of ['150000','-100000','500000000','NaN',100000,null])assert(!validPvpRequest({...invite,stakeUnits}));
});

test('trusted room enforces nearby invitations, gates money at readiness, and runs separate concurrent duels',async()=>{
  const db=new PostgresDatabase(':memory:');try{
    const ids=Array.from({length:4},()=>randomUUID());await db.exec('CREATE TABLE accounts(id TEXT PRIMARY KEY)');
    for(const id of ids)await db.prepare('INSERT INTO accounts VALUES(?)').run(id);
    const common=new DemoWalletStore(db);await common.ready;for(const id of ids)await common.operate(id,{id:randomUUID(),kind:'deposit',amount:200});const store=new PvpStore(new VirtualPvpLedger(db,common));await store.ready;
    const people=ids.map((accountId,index)=>({accountId,sessionId:'player'+index,name:'Игрок '+index,hall:'arcade',x:index*70,y:500,connected:true,available:true}));
    const sent=new Map<string,{type:string;value:any}[]>(),wagers=new Map<string,string[]>(),money:string[]=[];
    const activities:any={wagers,tables:[],chess:{state:{players:[]}},startWager:(key:string,players:string[])=>wagers.set(key,players),finishWager:(key:string)=>wagers.delete(key)};
    const room=new PvpRoom({roomId:()=> 'nearby-test',activities,people:()=>people,allowMoney:async id=>{money.push(id);},send:(id,type,value)=>sent.set(id,[...(sent.get(id)??[]),{type,value}])},virtualPvpCommand(store));
    const command=async(side:number,request:any)=>{await room.command(people[side].sessionId,{...request,id:randomUUID(),walletScope:VIRTUAL_PVP_SCOPE});return sent.get(people[side].sessionId)!.at(-1)!;};
    const offer=(target:number)=>({action:'invite',gameId:'tsu-e-fa',targetId:ids[target]});
    await store.syncRoom('nearby-test',people);people[1].x=900;
    const far=await command(0,offer(1));assert.equal(far.type,'pvp-result');assert.match(far.value.error,/ближе/);people[1].x=70;
    const first=await command(0,offer(1));assert.equal(first.type,'pvp');const firstId=first.value.active.id;
    assert.equal(first.value.people.find((p:any)=>p.accountId===ids[1]).sessionId,people[1].sessionId);
    people[1].hall='tables';assert.equal((await command(1,{action:'accept',challengeId:firstId})).type,'pvp-result');people[1].hall='arcade';
    await command(1,{action:'accept',challengeId:firstId});assert.equal(money.length,0);for(const side of [0,1])await command(side,{action:'duel-ready',challengeId:firstId,termsRevision:0});
    assert.equal((await store.snapshot({accountId:ids[0],name:'A',roomId:'nearby-test'})).active!.status,'playing');assert.equal(wagers.size,1);assert(wagers.has('tsu-e-fa:'+firstId));
    const second=await command(2,offer(3)),secondId=second.value.active.id;
    await command(3,{action:'accept',challengeId:secondId});for(const side of [2,3])await command(side,{action:'duel-ready',challengeId:secondId,termsRevision:0});
    assert.equal(wagers.size,2);assert.notEqual(firstId,secondId);assert.deepEqual(new Set(money),new Set(ids));
    await command(0,{action:'resign',challengeId:firstId});assert.equal(wagers.size,1);assert(wagers.has('tsu-e-fa:'+secondId));
    await command(2,{action:'resign',challengeId:secondId});assert.equal(wagers.size,0);
    assert.equal(Number((await db.prepare('SELECT count(*) AS n FROM virtual_pvp_banks').get())!.n),2);room.stop();
  }finally{await db.close();}
});
