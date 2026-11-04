import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accounts } from '../server/accounts';
import { LobbyRoom } from '../server/LobbyRoom';
import { BAR_APPROACH } from '../src/shared/world';

test('sip and service appear only after drink persistence succeeds',async context=>{
  const login=await accounts.login(`bar-confirm-${crypto.randomUUID()}@example.test`,'BarConfirmation2026!');
  await accounts.select(login.account.id,0);
  const client:any={sessionId:'bar-confirm',auth:(await accounts.session(login.token))!,send(){},leave(){}};
  const room=new LobbyRoom(),handlers=new Map<string,any>();
  context.mock.method(room,'onMessage',(name:string,handler:any)=>handlers.set(name,handler));
  context.mock.method(room,'setPatchRate',()=>{});context.mock.method(room,'setSimulationInterval',()=>{});
  context.mock.method(room,'broadcast',()=>{});context.mock.method(room.clock,'setInterval',()=>({clear(){}}));
  room.onCreate();await room.onJoin(client,{},client.auth);
  try{
    const p=room.state.players.get(client.sessionId)!;Object.assign(p,BAR_APPROACH);
    const consume=accounts.drinking.consume.bind(accounts.drinking);
    let entered!:()=>void,release!:()=>void;
    const pending=new Promise<void>(resolve=>{entered=resolve;});const commit=new Promise<void>(resolve=>{release=resolve;});
    context.mock.method(accounts.drinking,'consume',async(...args:Parameters<typeof consume>)=>{entered();await commit;return consume(...args);});
    const command=handlers.get('drink')(client,'wine');await pending;
    assert.equal(p.action,'idle');assert.equal(p.drink,'');
    release();await command;
    assert.equal(p.action,'drink');assert.equal(p.drink,'wine');assert.ok(p.soberAt>Date.now());
  }finally{room.onDispose();room.clock.clear();await accounts.logout(login.token);}
});
