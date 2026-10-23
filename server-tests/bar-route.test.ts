import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LobbyRoom } from '../server/LobbyRoom';
import { accounts } from '../server/accounts';
import { Guard } from '../server/state';
import { atBar, BAR_APPROACH } from '../src/shared/world';
import { MAX_SOBER_TIME_MS } from '../src/shared/intoxication';

test('an intoxicated approach resumes after a passing guard instead of losing the route', async context => {
  const login = await accounts.login(`bar-route-${crypto.randomUUID()}@example.test`, 'bar-route-password');
  (await accounts.select(login.account.id, 0));
  const client: any = { sessionId:'bar-route',auth:(await accounts.session(login.token))!,send(){},leave(){} };
  const room = new LobbyRoom(), handlers = new Map<string,any>();
  context.mock.method(room,'onMessage',(name:string,handler:any)=>handlers.set(name,handler));
  context.mock.method(room,'setPatchRate',()=>{});
  context.mock.method(room,'setSimulationInterval',()=>{});
  context.mock.method(room,'broadcast',()=>{});
  context.mock.method(room.clock,'setInterval',()=>({clear(){}}));
  room.onCreate();(await room.onJoin(client,{},client.auth));
  try {
    const player = room.state.players.get(client.sessionId)!;
    Object.assign(player,{x:550,y:BAR_APPROACH.y,soberAt:Date.now()+MAX_SOBER_TIME_MS});
    room.state.guards.clear();
    const guard = new Guard(); Object.assign(guard,{x:450,y:BAR_APPROACH.y,hall:'arcade',phase:'patrol'});room.state.guards.set('passing',guard);
    context.mock.method((room as any).guards,'contact',()=>{});
    (await handlers.get('target')(client,{...BAR_APPROACH,revision:player.hallRevision}));
    for(let i=0;i<100;i++)(room as any).tick(.05);
    assert.ok(player.x>450,'a patrol remains a solid obstacle');
    assert.ok((room as any).controls.get(client.sessionId).path.length>0,'the pending bar route is retained');
    guard.y=400;
    for(let i=0;i<100;i++)(room as any).tick(.05);
    assert.ok(atBar(player),'the guest reaches Mira once the patrol passes');
  } finally { room.onDispose();room.clock.clear();(await accounts.logout(login.token)); }
});
