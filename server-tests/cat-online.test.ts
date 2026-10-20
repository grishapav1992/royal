import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineServer, defineRoom, matchMaker } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import { LobbyRoom } from '../server/LobbyRoom';
import type { LobbyState } from '../server/state';
import { accounts } from '../server/accounts';
import { SafeWebSocketTransport } from '../server/websocketSafety';
import { lobbyRoutes } from '../server/lobbyRoutes';
import { CAT_HOME } from '../src/shared/catHome';
import type { RoomCat } from '../server/cat';
import type { CatMood } from '../src/shared/cat';
import { CABINETS } from '../src/shared/cabinets';
import { cabinetSeat } from '../src/shared/cabinetSeating';
import { walkable } from '../src/game/navigation';
import { hallObstacles } from '../src/shared/world';

async function until(check: () => boolean) {
  const end=Date.now()+5000;
  while(!check()) { if(Date.now()>end)throw new Error('Shared cat state did not arrive');await new Promise(resolve=>setTimeout(resolve,25)); }
}

test('real lobby clients share habits and stationary hugs, reject movement and share the cooldown', {timeout:20000}, async () => {
  const transport=new SafeWebSocketTransport({pingInterval:0});
  const server=defineServer({transport,rooms:{lobby:defineRoom(LobbyRoom)},routes:lobbyRoutes(),greet:false,gracefullyShutdown:false});
  const clients:Room<LobbyState>[]=[];
  await accounts.ready;
  try {
    await server.listen(0,'127.0.0.1');
    const address=transport.server!.address();assert(address&&typeof address!=='string');
    const endpoint='http://127.0.0.1:'+address.port;
    for(let i=0;i<2;i++) {
      const auth=await accounts.login('cat-'+crypto.randomUUID()+'@example.test','Cat-test-123!');
      await accounts.select(auth.account.id,0);
      const client=new Client(endpoint,{headers:{Cookie:'royal_session='+auth.token}});
      const room=i ? await client.joinById<LobbyState>(clients[0].roomId,{activityProtocol:1}) : await client.create<LobbyState>('lobby',{activityProtocol:1});
      room.reconnection.enabled=false;room.onMessage('*',()=>{});clients.push(room);
    }
    const [a,b]=clients;
    await until(()=>a.state.players.size===2&&b.state.players.size===2&&Boolean(a.state.cat));
    const authoritative=matchMaker.getLocalRoomById(a.roomId) as LobbyRoom;
    const simulation=(authoritative as unknown as {cat:RoomCat}).cat;
    async function reach(mood:CatMood) {
      for(let i=0;i<8000&&authoritative.state.cat.mood!==mood;i++)simulation.tick(.1);
      assert.equal(authoritative.state.cat.mood,mood,'the natural routine reaches '+mood);
      await until(()=>a.state.cat.mood===mood&&b.state.cat.mood===mood);
      assert.equal(a.state.cat.x,b.state.cat.x);assert.equal(a.state.cat.y,b.state.cat.y);
    }
    const seated=authoritative.state.players.get(a.sessionId)!,machine=CABINETS.find(c=>c.id==='royal-fruits')!;
    Object.assign(seated,cabinetSeat(machine).entry);
    a.send('cabinet-play',{id:machine.id,requestId:58});
    await until(()=>seated.playing&&a.state.players.get(a.sessionId)?.cabinet===machine.id);
    await reach('purring');
    for(const client of [a,b]) {
      assert.equal(client.state.cat.surfaceId,'cabinet:'+machine.id);assert.equal(client.state.cat.targetId,a.sessionId);
      assert.equal(client.state.players.get(a.sessionId)!.playing,true,'the cat does not interrupt the game');
    }
    a.send('playing',false);
    await until(()=>a.state.cat.jumpingDown&&b.state.cat.jumpingDown);
    for(let i=0;i<25&&authoritative.state.cat.surfaceId;i++)simulation.tick(.1);
    assert.equal(authoritative.state.cat.surfaceId,'');
    assert(walkable(authoritative.state.cat.x,authoritative.state.cat.y,hallObstacles(authoritative.state.cat.hall)));
    await reach('belly-up');assert.equal(a.state.cat.onPillow,true);assert.equal(b.state.cat.onPillow,true);
    await reach('eating-bowl');assert.equal(a.state.cat.onBar,false);assert.equal(b.state.cat.onBar,false);
    await reach('scratching');assert.equal(a.state.cat.surfaceId,'');assert.equal(b.state.cat.moving,false);
    await reach('drinking');assert.equal(a.state.cat.onBar,true);assert.equal(b.state.cat.onBar,true);
    await reach('sleeping');assert.equal(a.state.cat.onBar,false);assert.equal(b.state.cat.onPillow,true);
    const first=authoritative.state.players.get(a.sessionId)!, second=authoritative.state.players.get(b.sessionId)!;
    Object.assign(first,CAT_HOME.approach);Object.assign(second,CAT_HOME.approach);
    a.send('cat','hurt');await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(a.state.cat.mood,'sleeping');assert.equal(b.state.cat.onPillow,true);
    a.send('cat','hug');a.send('cat','feed');
    await new Promise(resolve=>setTimeout(resolve,100));assert.equal(a.state.cat.onPillow,true);assert.equal(a.state.cat.mood,'sleeping');
    await reach('resting');
    const origin={hall:authoritative.state.cat.hall,x:authoritative.state.cat.x,y:authoritative.state.cat.y};
    Object.assign(first,origin);Object.assign(second,origin);
    // The earlier pillow request has a one second interaction throttle.
    simulation.tick(.25);simulation.tick(.25);simulation.tick(.25);simulation.tick(.25);
    a.send('cat','hug');
    await until(()=>a.state.cat.carriedBy===a.sessionId&&b.state.cat.carriedBy===a.sessionId);
    b.send('cat','hug');await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(b.state.cat.carriedBy,a.sessionId,'a second player cannot take her away');
    let cabinetReply: {accepted:boolean}|undefined;
    a.onMessage('cabinet-play-result',value=>{cabinetReply=value;});
    const revision=first.hallRevision;
    a.send('move',{x:1,y:0,revision});a.send('target',{x:900,y:240,revision});
    a.send('inputs',{revision,inputs:[{seq:1,x:1,y:0,ms:50,directions:2}]});
    a.send('playing',true);a.send('sit','bar-1');a.send('activity',{type:'join',id:'piano'});
    a.send('cabinet-play',{id:'crash',requestId:71});
    await until(()=>Boolean(cabinetReply));await new Promise(resolve=>setTimeout(resolve,150));
    assert.equal(cabinetReply!.accepted,false);assert.equal(first.x,origin.x);assert.equal(first.y,origin.y);
    assert.equal(first.hall,origin.hall);assert.equal(first.moving,false);assert.equal(first.playing,false);assert.equal(first.activity,'');assert.equal(first.seat,'');
    a.send('cat','release');await until(()=>!a.state.cat.carriedBy&&!b.state.cat.carriedBy);
    assert.equal(a.state.cat.mood,'stretching');assert.equal(a.state.cat.x,origin.x);assert.equal(b.state.cat.y,origin.y);
    assert(a.state.cat.hugCooldown>=20&&a.state.cat.hugCooldown<=30);assert.equal(a.state.cat.hugCooldown,b.state.cat.hugCooldown);
    b.send('cat','hug');await new Promise(resolve=>setTimeout(resolve,100));assert.equal(b.state.cat.carriedBy,'');
    for(let i=0;i<8000;i++) {
      const view=authoritative.state.cat;
      if(!view.hugCooldown&&!view.onPillow&&!view.onBar&&view.mood==='resting')break;
      simulation.tick(.1);
    }
    const next={hall:authoritative.state.cat.hall,x:authoritative.state.cat.x,y:authoritative.state.cat.y};Object.assign(first,next);
    a.send('cat','hug');await until(()=>b.state.cat.carriedBy===a.sessionId);
    await a.leave();await until(()=>!b.state.cat.carriedBy);
    assert.equal(b.state.cat.hall,next.hall);assert.equal(b.state.cat.x,next.x);assert.equal(b.state.cat.mood,'stretching');
  } finally {
    await Promise.allSettled(clients.filter(client=>client.connection.isOpen).map(client=>client.leave()));
    await server.gracefullyShutdown(false);await accounts.close();
  }
});
