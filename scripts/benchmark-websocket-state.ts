import {ClientState} from '@colyseus/core';
import {SchemaSerializer} from '@colyseus/core/serializer/SchemaSerializer';
import {LobbyState,Player} from '../server/state';
import {Guards} from '../server/guards';
import {Bartender} from '../server/bartender';
import {AmbientGuests} from '../server/ambientGuests';
import {applyMovementInput} from '../src/shared/movement';

// Measure actual Colyseus state frames without sockets, account data or a database.
// NPC routines run unchanged; moving players use the shared collision integrator.
const warmupSeconds=30,durationSeconds=60,startTime=1_700_000_000_000;
const scenarios=[
  {name:'idle-clock-only',players:1,moving:0,npcs:false,clock:true},
  {name:'idle-no-clock-no-NPC',players:1,moving:0,npcs:false,clock:false},
  {name:'one-player-idle-world',players:1,moving:0,npcs:true,clock:true},
  {name:'ten-players-idle-world',players:10,moving:0,npcs:true,clock:true},
  {name:'thirty-players-idle-world',players:30,moving:0,npcs:true,clock:true},
  {name:'thirty-players-one-walking',players:30,moving:1,npcs:true,clock:true},
  {name:'thirty-players-all-walking',players:30,moving:30,npcs:true,clock:true},
];
const rows=[];
for(const scenario of scenarios){
  const state=new LobbyState();state.serverNow=startTime;
  const players:InstanceType<typeof Player>[]=[];
  for(let i=0;i<scenario.players;i++){
    const player=new Player();player.name='Player '+i;player.hall=(['arcade','tables','github'] as const)[i%3];
    player.x=540;player.y=760+i%3*20;state.players.set('p'+i,player);players.push(player);
  }
  const guards=scenario.npcs?new Guards(state,()=>{},()=>.42):undefined;
  const bartender=scenario.npcs?new Bartender(state):undefined;
  const guests=scenario.npcs?new AmbientGuests(state):undefined;
  const serializer=new SchemaSerializer<LobbyState>();serializer.reset(state);
  let bytes=0,packets=0,maxPacketBytes=0,initialSnapshotBytes=0,measuring=false;
  const packetSizes:number[]=[];
  const clients=players.map((_,i)=>({state:ClientState.JOINED,sessionId:'p'+i,raw(data:Uint8Array){
    if(measuring&&i===0){bytes+=data.byteLength;packets++;maxPacketBytes=Math.max(maxPacketBytes,data.byteLength);packetSizes.push(data.byteLength);}
  }}));
  const before=performance.now();
  for(let step=1;step<=(warmupSeconds+durationSeconds)*60;step++){
    if(scenario.clock&&step%60===0)state.serverNow=startTime+Math.round(step*1000/60);
    guards?.tick(1/60);bartender?.tick(1/60);guests?.tick(1/60);
    if(step%3===0){
      for(let i=0;i<scenario.moving;i++){
        const player=players[i];
        applyMovementInput(player,{seq:step/3,x:Math.floor(step/180)%2?1:-1,y:0,ms:50});player.inputSeq=step/3;
      }
      serializer.applyPatches(clients as any);
    }
    if(step===warmupSeconds*60){initialSnapshotBytes=serializer.getFullState().byteLength;measuring=true;}
  }
  packetSizes.sort((a,b)=>a-b);
  rows.push({scenario:scenario.name,players:scenario.players,movingPlayers:scenario.moving,npcCount:state.guests.size+state.guards.size+(scenario.npcs?1:0),
    seconds:durationSeconds,initialSnapshotBytes,packets,packetsPerSecond:packets/durationSeconds,
    bytesPerClient:bytes,bytesPerSecondPerClient:Number((bytes/durationSeconds).toFixed(1)),
    roomBytesPerSecond:Number((bytes*scenario.players/durationSeconds).toFixed(1)),
    meanPacketBytes:packets?Number((bytes/packets).toFixed(1)):0,p95PacketBytes:packetSizes[Math.floor(packetSizes.length*.95)]??0,
    maxPacketBytes,simulationMs:Number((performance.now()-before).toFixed(1))});
}
console.log(JSON.stringify({encoding:'Actual Colyseus SchemaSerializer state frames; excludes activities, chat, client inputs, handshake, ping, WebSocket/TLS headers',
  simulation:'60 Hz NPC routines, 1 Hz clock sampling, 20 Hz collision-integrated player movement and state flush, 30 s warmup, deterministic NPC seed',rows},null,2));
