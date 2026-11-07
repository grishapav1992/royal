import assert from 'node:assert/strict';
import { Client, type Room } from '@colyseus/sdk';
import type { LobbyState } from '../server/state';
import { walkable } from '../src/game/navigation';
import { hallObstacles } from '../src/shared/world';
import { ROOM_CHAT_PROTOCOL, type ChatResult } from '../src/shared/chat';

const endpoint = process.env.SERVER_URL || 'http://127.0.0.1:2567';
const cookies: string[] = [];
async function authenticatedClient(index: number) {
  const response = await fetch(endpoint + '/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'load-'+crypto.randomUUID()+'@example.test',password:crypto.randomUUID()})});
  assert(response.ok,'Test account login must succeed');
  const cookie = response.headers.get('set-cookie')!.split(';')[0]; cookies.push(cookie);
  const profile = await fetch(endpoint + '/api/auth/character',{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({skin:index%6})});
  assert(profile.ok,'Character selection must succeed');
  return new Client(endpoint,{headers:{Cookie:cookie}});
}
const rooms: Room<LobbyState>[] = [];
const received = new Map<string, string[]>();
const chatReady = new Set<string>();
const chatResults = new Map<string, ChatResult>();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, timeout = 5000) {
  const end = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > end) throw new Error('Timed out waiting for shared state'); await delay(50); }
}
function attach(room: Room<LobbyState>) {
  rooms.push(room); const messages: string[] = []; received.set(room.sessionId, messages);
  room.onMessage('chat', message => messages.push(message.text));
  room.onMessage('chat-visit', visit => { if (visit?.hall === 'arcade') chatReady.add(room.sessionId); });
  room.onMessage('chat-result', (result: ChatResult) => chatResults.set(result.id, result));
  room.onMessage('history', () => {});
  room.onMessage('notice', () => {});
  room.onMessage('*', () => {});
  room.send('history', { version: ROOM_CHAT_PROTOCOL });
  return room;
}
try {
  const client = await authenticatedClient(0);
  const first = attach(await client.create<LobbyState>('lobby'));
  for (let i = 2; i <= 30; i++) attach(await (await authenticatedClient(i)).joinById<LobbyState>(first.roomId));
  await until(() => rooms.every(room => room.state.players?.size === 30));
  const extra = await authenticatedClient(31);
  await assert.rejects(extra.joinById(first.roomId));
  const isolated = attach(await extra.create<LobbyState>('lobby'));
  await until(() => isolated.state.players?.size === 1);
  await until(() => chatReady.size === rooms.length);
  first.send('chat', 'check-30-clients');
  await until(() => rooms.slice(0,30).every(room => received.get(room.sessionId)!.includes('check-30-clients')));
  assert(!received.get(isolated.sessionId)!.includes('check-30-clients'), 'Rooms must isolate chat');
  const before = new Map([...first.state.players].map(([id,p]) => [id, { x: p.x, y: p.y }]));
  let patches = 0; first.onStateChange(() => patches++);
  const started = Date.now();
  while (Date.now() - started < 10000) {
    const direction = Math.floor((Date.now() - started) / 1500) % 2 ? -1 : 1;
    rooms.slice(0,30).forEach(room => room.send('move', { x: direction, y: 0, revision: 0 }));
    await delay(150);
  }
  rooms.slice(0,30).forEach(room => room.send('stop'));
  await delay(250);
  assert(patches > 50, 'Active movement must keep producing state patches');
  for (const [id,p] of first.state.players) {
    assert(walkable(p.x,p.y,hallObstacles(p.hall)), 'Server must keep players in walkable space');
    assert(Math.hypot(p.x-before.get(id)!.x,p.y-before.get(id)!.y)>1, 'All clients must move');
  }
  const chatBefore = received.get(first.sessionId)!.length;
  first.send('chat', 'x'.repeat(301));
  await delay(100);
  assert.equal(received.get(first.sessionId)!.length, chatBefore, 'Oversized chat must be rejected');
  const burst = Array.from({ length: 5 }, (_, i) => ({ id: crypto.randomUUID(), text: `burst-${i}` }));
  for (const message of burst) first.send('chat', message);
  await until(() => burst.every(({ id }) => chatResults.has(id) && chatResults.get(id)!.status !== 'queued'));
  const delivered = received.get(first.sessionId)!.filter(text => text.startsWith('burst-')).length;
  assert(delivered > 0 && delivered < burst.length, 'The room should deliver some messages and reject overflow');
  assert.equal(delivered, burst.filter(({ id }) => chatResults.get(id)!.status === 'published').length);
  console.log(JSON.stringify({ ok: true, clients: 30, movementSeconds: 10, patches, capacityLimit: true, isolatedChat: true, chatLimits: true }));
} finally {
  await Promise.allSettled(rooms.map(room => room.leave()));
  await Promise.allSettled(cookies.map(cookie=>fetch(endpoint+'/api/auth/logout',{method:'POST',headers:{Cookie:cookie}})));
}
