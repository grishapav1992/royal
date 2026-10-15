import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LobbyRoom} from '../server/LobbyRoom';
import {Player} from '../server/state';
import {accounts} from '../server/accounts';
import {ACTIVITIES} from '../src/shared/activities';
import {HALL_DOORS} from '../src/shared/world';

test('activity routing isolates halls, supports old pages and sends fresh snapshots on hall entry and request',async context=>{
  const room=new LobbyRoom();const handlers=new Map<string,(client:any,value?:unknown)=>unknown>();
  let simulation:((dt:number)=>void)|undefined;
  context.mock.method(room,'onMessage',(type:string,handler:any)=>handlers.set(type,handler));
  context.mock.method(room,'setPatchRate',()=>{});
  context.mock.method(room,'setSimulationInterval',(callback:any)=>{simulation=callback;});
  context.mock.method(room,'broadcast',(type:string,value:unknown,options?:{except:any[]})=>{
    for(const client of room.clients)if(!options?.except.includes(client))client.send(type,value);
  });
  context.mock.method(room.clock,'setInterval',()=>({clear(){}}));
  const logins:Awaited<ReturnType<typeof accounts.login>>[]=[];
  const packets=new Map<string,{type:string;value:any}[]>();
  const clients:any[]=[];
  room.onCreate();
  try{
    for(const [id,protocol] of [['pianist',1],['listener',1],['table-player',1],['old-page',0]] as const){
      const login=await accounts.login(`activity-${id}-${crypto.randomUUID()}@example.test`,'activity-room-password');logins.push(login);
      await accounts.select(login.account.id,0);const auth=(await accounts.session(login.token))!;packets.set(id,[]);
      const client:any={sessionId:id,auth,send(type:string,value:unknown){packets.get(id)!.push({type,value:structuredClone(value)});},leave(){}};
      await room.onJoin(client,{activityProtocol:protocol},auth);room.clients.push(client);clients.push(client);
    }
    const clear=()=>packets.forEach(values=>{values.length=0;});
    const messages=(id:string)=>packets.get(id)!.filter(p=>p.type==='activities');
    Object.assign(room.state.players.get('pianist')!,ACTIVITIES.piano.entry);
    Object.assign(room.state.players.get('table-player')!,{hall:'tables',...ACTIVITIES.chess.entry});
    const disconnected=new Player();disconnected.hall='tables';disconnected.connected=false;room.state.players.set('dropped',disconnected);
    const dropped={sessionId:'dropped',send(type:string){assert(!['activities','piano-note'].includes(type),'dropped clients must receive no activity packets');}};
    room.clients.push(dropped as any);clear();
    await handlers.get('activity')!(clients[0],{type:'join',id:'piano'});
    assert.equal(messages('pianist')[0].value.patch,true);assert.equal(messages('listener')[0].value.pianist,'pianist');
    assert(!('patch' in messages('old-page')[0].value));assert.equal(messages('table-player').length,0);
    clear();await handlers.get('activity')!(clients[0],{type:'note',note:60,down:true});
    assert.equal(packets.get('listener')![0].type,'piano-note');assert.equal(packets.get('table-player')!.length,0);
    simulation!(50);
    clear();await handlers.get('activity')!(clients[2],{type:'join',id:'chess'});
    assert.equal(messages('table-player')[0].value.patch,true);assert.equal(messages('listener').length,0);
    await handlers.get('activity')!(clients[2],{type:'leave'});clear();
    Object.assign(room.state.players.get('table-player')!,HALL_DOORS.tables.entry);
    simulation!(50);assert.equal(room.state.players.get('table-player')!.hall,'arcade');
    const entry=messages('table-player').find(p=>!('patch' in p.value));assert(entry);assert.equal(entry.value.pianist,'pianist');assert.deepEqual(entry.value.notes,[60]);
    clear();await handlers.get('activities')!(clients[2]);
    assert.equal(messages('table-player').length,1);assert(!('patch' in messages('table-player')[0].value));
    assert.equal(messages('table-player')[0].value.tables.length,2);
    assert.equal(messages('listener').length,0);
  }finally{
    for(const client of clients)room.onLeave(client);
    room.onDispose();room.clock.clear();await Promise.all(logins.map(login=>accounts.logout(login.token)));
  }
});
