import {test,expect} from '@playwright/test';

test('LobbyClient clears a note from a fresh snapshot even when no notes patch follows',async({page})=>{
  test.skip(!!process.env.TEST_BASE_URL,'Replaying client messages requires the local Vite module loader.');
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const path='/src/network/LobbyClient.ts';const {LobbyClient}=await import(path);
    const handlers=new Map<string,(value:any)=>void>();const noteEvents:any[]=[],states:any[]=[];
    let reconnect=()=>{};
    const room={
      roomId:'piano-test',sessionId:'listener',reconnection:{minUptime:0},send:()=>{},
      onMessage:(type:string,handler:(value:any)=>void)=>handlers.set(type,handler),
      onStateChange:()=>{},onDrop:()=>{},onLeave:()=>{},onError:()=>{},onReconnect:(handler:()=>void)=>{reconnect=handler;},
    };
    const noop=()=>{};
    const client=new LobbyClient({guards:noop,mira:noop,security:noop,ejected:noop,checking:noop,status:noop,
      joined:noop,players:noop,chat:noop,history:noop,notice:noop,activities:(state:any)=>states.push(state),note:(note:any)=>noteEvents.push(note)});
    client.client={joinOrCreate:async()=>room};await client.join();
    const snapshot={tables:[],pianist:'pianist',notes:[60],chess:{clock:{remainingMs:[900000,900000],running:null}}};
    const receive=(type:string,value:any)=>handlers.get(type)!(value);
    receive('activities',snapshot);
    receive('piano-note',{player:'pianist',note:60,down:false});
    const released=states.at(-1);
    receive('activities',{patch:true,pianist:''});
    const left=states.at(-1);
    reconnect();
    receive('activities',{patch:true,notes:[64]});
    receive('piano-note',{player:'pianist',note:64,down:true});
    const beforeSnapshot=states.length;
    receive('activities',{...snapshot,notes:[64]});
    receive('piano-note',{player:'pianist',note:64,down:false});
    return {released:released.notes,left:{pianist:left.pianist,notes:left.notes},reconnected:states.at(-1).notes,
      original:snapshot.notes,unchangedGames:released.tables===snapshot.tables&&released.chess===snapshot.chess,
      beforeSnapshot,noteEvents:noteEvents.length};
  });
  expect(result).toEqual({released:[],left:{pianist:'',notes:[]},reconnected:[],original:[60],unchangedGames:true,beforeSnapshot:3,noteEvents:3});
});
