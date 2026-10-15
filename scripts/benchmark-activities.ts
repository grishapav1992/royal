import {Activities} from '../server/activities';
import {activityHall} from '../src/shared/world';
import {getMessageBytes,Protocol} from '@colyseus/core';
import {ACTIVITIES,type ActivityId} from '../src/shared/activities';

// Compare room messages using the server's actual encoder.
// The baseline repeats the former full-snapshot scheduler for the same game state.
const bytes=(value:unknown)=>getMessageBytes.raw(Protocol.ROOM_DATA,'activities',value).byteLength;
const duration=10;
const rows=[];
for(const scenario of ['waiting-pool','idle-piano','chess','hockey','pool-shot'] as const){
  let now=0,newBytes=0,newPackets=0,oldBytes=0,oldPackets=0,elapsed=0;
  const people=new Map<string,any>();
  const service=new Activities(id=>people.get(id),()=>{},(type,value)=>{if(type==='activities'){newBytes+=bytes(value);newPackets++;}},()=>{},()=>now);
  const join=(id:string,activity:ActivityId)=>{
    people.set(id,{hall:activityHall(activity),...ACTIVITIES[activity].entry,playing:false,connected:true,activity:'',ears:false,seat:'',action:'idle',facing:'down',moving:false});
    service.handle(id,{type:'join',id:activity});
  };
  const activity:ActivityId=scenario==='waiting-pool'||scenario==='pool-shot'?'pool':scenario==='idle-piano'?'piano':scenario;
  join('a',activity);if(scenario!=='waiting-pool'&&scenario!=='idle-piano')join('b',activity);
  newBytes=0;newPackets=0;
  if(scenario==='pool-shot'){
    service.handle('a',{type:'shot',angle:0,power:850});oldBytes+=bytes(service.snapshot());oldPackets++;
  }
  for(let step=0;step<duration*60;step++){
    now+=1000/60;service.tick(1/60);elapsed+=1/60;
    const interval=service.tables[0].state.phase==='playing'?1/30:.05;
    if(elapsed>=interval){elapsed%=interval;oldBytes+=bytes(service.snapshot());oldPackets++;}
  }
  rows.push({scenario,seconds:duration,before:{packets:oldPackets,bytes:oldBytes},after:{packets:newPackets,bytes:newBytes},savedPercent:Number((100*(1-newBytes/oldBytes)).toFixed(1))});
}
console.log(JSON.stringify({encoding:'Colyseus room messages, one observer in the same hall; excludes WebSocket/TLS framing and character state',rows},null,2));
