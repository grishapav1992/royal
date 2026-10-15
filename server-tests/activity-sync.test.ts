import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Activities} from '../server/activities';
import {ACTIVITIES,CHESS_TIME_MS,mergeActivities,mergePianoNote,type ActivitiesMessage,type ActivitiesState,type ActivitiesUpdate} from '../src/shared/activities';
import {activityHall,type HallId} from '../src/shared/world';

function setup(){
  const people=new Map<string,{hall:HallId;x:number;y:number;playing:boolean;connected:boolean;activity:string;ears:boolean;seat:string;action:string;facing:string;moving:boolean}>();
  let now=0;
  const events:{type:string;value:any;hall:HallId}[]=[];
  const service=new Activities(id=>people.get(id),()=>{},(type,value,hall)=>events.push({type,value:structuredClone(value),hall}),()=>{},()=>now);
  const join=(id:string,activity:keyof typeof ACTIVITIES)=>{
    people.set(id,{hall:activityHall(activity),...ACTIVITIES[activity].entry,playing:false,connected:true,activity:'',ears:false,seat:'',action:'idle',facing:'down',moving:false});
    service.handle(id,{type:'join',id:activity});
  };
  const tick=(seconds:number)=>{for(let i=0;i<Math.round(seconds*60);i++){now+=1000/60;service.tick(1/60);}};
  const updates=()=>events.filter(e=>e.type==='activities');
  return {service,events,join,tick,updates};
}

test('idle, waiting and stopped games send no repeated activity packets; invalid actions send none',()=>{
  const {service,events,join,tick}=setup();tick(2);assert.equal(events.length,0);
  for(const [id,activity] of [['p','piano'],['h','hockey'],['b','pool'],['c','chess']] as const)join(id,activity);
  events.length=0;tick(2);assert.equal(events.length,0);
  service.handle('b',{type:'shot',angle:0,power:80});service.handle('h',{type:'rematch'});service.leave('missing');
  assert.equal(events.length,0);
});

test('chess sends only clock corrections each second, moves immediately and timeout exactly once',()=>{
  const {service,events,join,tick,updates}=setup();join('a','chess');join('b','chess');
  let state=structuredClone(service.snapshot());events.length=0;tick(3);
  assert.equal(updates().length,3);
  for(const event of updates()){
    assert.equal(event.hall,'tables');assert.deepEqual(Object.keys(event.value),['patch','chess']);
    assert.deepEqual(Object.keys(event.value.chess),['clock']);state=mergeActivities(state,event.value);
  }
  assert.equal(state.chess.clock.remainingMs[0],service.chess.state.clock.remainingMs[0]);
  assert.equal(state.chess.clock.remainingMs[1],CHESS_TIME_MS);
  events.length=0;service.handle('a',{type:'chess-move',from:'e2',to:'e4'});
  assert.equal(updates().length,1);state=mergeActivities(state,updates()[0].value);
  assert.deepEqual(state.chess,service.snapshot().chess);assert.equal(state.chess.turn,'b');
  events.length=0;service.chess.state.clock.remainingMs[1]=1;tick(.1);
  assert.equal(updates().length,1);assert.equal(updates()[0].value.chess.phase,'finished');
  assert.equal(updates()[0].value.chess.clock.running,null);
  events.length=0;tick(2);assert.equal(events.length,0);
});

test('hockey and pool have independent rates and patches reconstruct the authoritative final frame',()=>{
  const {service,events,join,tick,updates}=setup();
  join('h1','hockey');join('h2','hockey');join('p1','pool');join('p2','pool');
  let state=structuredClone(service.snapshot());events.length=0;
  service.handle('p1',{type:'shot',angle:0,power:850});tick(1);
  const packets=updates();
  assert.equal(packets.filter(e=>e.value.tables?.some((t:any)=>t.id==='hockey')).length,30);
  assert.equal(packets.filter(e=>e.value.tables?.some((t:any)=>t.id==='pool')).length,21);
  for(const event of packets){
    assert.equal(event.hall,'tables');assert.equal(event.value.chess,undefined);assert.equal(event.value.pianist,undefined);
    for(const table of event.value.tables){assert.equal(table.players,undefined);assert.equal(table.ready,undefined);}
    state=mergeActivities(state,event.value);
  }
  assert.deepEqual(state.tables,service.snapshot().tables);
  const fullBytes=packets.reduce(sum=>sum+Buffer.byteLength(JSON.stringify(service.snapshot())),0);
  const patchBytes=packets.reduce((sum,e)=>sum+Buffer.byteLength(JSON.stringify(e.value)),0);
  assert(patchBytes<fullBytes*.55,`patch bytes ${patchBytes}, full bytes ${fullBytes}`);
  events.length=0;tick(13);const poolPackets=updates().filter(e=>e.value.tables?.some((t:any)=>t.id==='pool'));
  assert.equal(poolPackets.at(-1)?.value.tables.find((t:any)=>t.id==='pool').moving,false);
  events.length=0;tick(2);assert.equal(updates().filter(e=>e.value.tables?.some((t:any)=>t.id==='pool')).length,0);
});

test('a hockey match finishing between send intervals publishes the goal and final result',()=>{
  const {service,events,join,tick,updates}=setup();join('a','hockey');join('b','hockey');
  const table=service.tables[0].state;table.serveDelay=0;table.score[0]=6;
  Object.assign(table.balls[0],{x:694,y:200,vx:900,vy:0});events.length=0;
  tick(1/60);assert.equal(table.phase,'finished');assert.equal(updates().length,0);
  tick(1/60);assert.equal(updates().length,1);assert.equal(updates()[0].value.tables[0].winner,'a');
  assert.deepEqual(updates()[0].value.tables[0].score,[7,0]);events.length=0;tick(2);assert.equal(events.length,0);
});

test('piano notes stay in the arcade, release and note expiry update the snapshot without idle traffic',context=>{
  let now=10000;context.mock.method(Date,'now',()=>now);
  const {service,events,join,tick,updates}=setup();join('a','piano');events.length=0;
  service.handle('a',{type:'note',note:60,down:true});tick(.05);
  assert(events.every(e=>e.hall==='arcade'));assert.deepEqual(updates()[0].value.notes,[60]);
  events.length=0;tick(1);assert.equal(events.length,0);
  now+=4001;tick(.05);assert.deepEqual(updates()[0].value.notes,[]);
  assert(events.some(e=>e.type==='piano-note'&&e.value.down===false));
  service.handle('a',{type:'note',note:62,down:true});tick(.05);events.length=0;service.leave('a');
  assert.equal(updates().length,1);assert.equal(updates()[0].value.pianist,'');assert.deepEqual(updates()[0].value.notes,[]);
});

test('client merges only changed games, preserves clock anchors and full snapshots replace stale state',()=>{
  const {service}=setup();const state=structuredClone(service.snapshot());
  const patch:ActivitiesUpdate={patch:true,tables:[{id:'hockey',score:[1,0]}]};
  const next=mergeActivities(state,patch);assert.equal(next.chess,state.chess);assert.equal(next.tables[1],state.tables[1]);
  assert.equal(next.tables[0].balls,state.tables[0].balls);assert.deepEqual(state.tables[0].score,[0,0]);
  const clock=mergeActivities(next,{patch:true,chess:{clock:{remainingMs:[890000,900000],running:'w'}}});
  assert.equal(clock.chess.board,state.chess.board);assert.notEqual(clock.chess.clock,state.chess.clock);
  assert.equal(mergeActivities(clock,{patch:true,chess:{ready:['a']}}).chess.clock,clock.chess.clock);
  const fresh:ActivitiesState=structuredClone(service.snapshot());fresh.pianist='new-player';
  const reconnect:ActivitiesMessage=fresh;assert.equal(mergeActivities(clock,reconnect),fresh);
});

test('a snapshot between a short note press and release converges without a notes patch',()=>{
  for(const ending of ['release','leave'] as const){
    const {service,events,join,tick}=setup();join('a','piano');events.length=0;
    service.handle('a',{type:'note',note:60,down:true});
    let state=structuredClone(service.snapshot());assert.deepEqual(state.notes,[60]);
    const original=state;events.length=0;
    if(ending==='release')service.handle('a',{type:'note',note:60,down:false});else service.leave('a');
    tick(.05);
    assert.equal(events.filter(event=>event.type==='activities'&&event.value.notes!==undefined).length,0);
    for(const event of events)state=event.type==='piano-note'?mergePianoNote(state,event.value):mergeActivities(state,event.value);
    assert.deepEqual(state.notes,service.snapshot().notes);assert.equal(state.pianist,service.pianist);
    assert.deepEqual(original.notes,[60]);assert.equal(state.tables,original.tables);assert.equal(state.chess,original.chess);
    events.length=0;tick(2);assert.equal(events.length,0);
  }
});

test('piano note events are idempotent, preserve other notes and ignore a previous pianist',()=>{
  const {service}=setup();const state={...structuredClone(service.snapshot()),pianist:'a',notes:[60]};
  const chord=mergePianoNote(state,{player:'a',note:64,down:true});assert.deepEqual(chord.notes,[60,64]);
  assert.equal(mergePianoNote(chord,{player:'a',note:64,down:true}),chord);
  const released=mergePianoNote(chord,{player:'a',note:60,down:false});assert.deepEqual(released.notes,[64]);
  assert.equal(mergePianoNote(released,{player:'a',note:60,down:false}),released);
  assert.equal(mergePianoNote(released,{player:'previous',note:64,down:false}),released);
  assert.equal(mergePianoNote(released,{player:'previous',note:62,down:true}),released);
});
