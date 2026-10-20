import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { LobbyRoom } from '../server/LobbyRoom';
import { Player } from '../server/state';
import { MovementInputs } from '../server/movementInputs';
import { accounts } from '../server/accounts';
import { chatModerator } from '../server/moderation';
import { chatSpam } from '../server/chatSpam';

function fixture(context: TestContext) {
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, value?: unknown) => any>();
  const published: any[] = [], packets: { type: string; value: any }[] = [];
  const id = context.name;
  const client: any = { sessionId: id, auth: { account: { id }, hash: id },
    send(type: string, value: unknown) { packets.push({ type, value }); }, leave() {} };
  context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', (type: string, value: unknown) => { if (type === 'chat') published.push(value); });
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  context.mock.method(room, 'allowReconnection', async () => undefined as any);
  context.mock.method(accounts, 'active', async () => true);
  const record = context.mock.method(accounts.moderation, 'record', async () => ({ kind: 'warning' as const, until: 0 }));
  const checks: { text: string; resolve: (violation: boolean) => void; reject: (error: Error) => void }[] = [];
  context.mock.method(chatModerator, 'check', (_id: string, text: string) => new Promise<boolean>((resolve, reject) => checks.push({ text, resolve, reject })));
  room.onCreate(); room.state.guards.clear(); room.clients.push(client);
  const player = new Player(); player.name = 'Игрок'; room.state.players.set(id, player);
  (room as any).controls.set(id, { dx: 0, dy: 0, at: 0, path: [], lastTarget: 0, chatRevision: 0, inputs: new MovementInputs(), predicted: false });
  (room as any).access.set(id, { active: true, banUntil: 0, pendingEject: false, revision: 0 });
  context.after(async () => { chatSpam.clear(id); await room.onDispose(); room.clock.clear(); });
  const send = (text: string) => handlers.get('chat')!(client, text) as Promise<void>;
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  return { room, client, player, packets, published, checks, record, send, flush };
}

test('background chat stays pending until ordered messages pass moderation', async context => {
  const { send, checks, published, packets, flush } = fixture(context);
  const first = send('Первое сообщение'), second = send('Второе сообщение');
  await flush();
  assert.deepEqual(checks.map(check => check.text), ['Первое сообщение']);
  assert.equal(published.length, 0);
  checks[0].resolve(false); await first; await flush();
  assert.deepEqual(published.map(message => message.text), ['Первое сообщение']);
  assert.equal(packets.some(packet => packet.type === 'chat-check' && packet.value === false), false);
  assert.deepEqual(checks.map(check => check.text), ['Первое сообщение', 'Второе сообщение']);
  checks[1].resolve(false); await second;
  assert.deepEqual(published.map(message => message.text), ['Первое сообщение', 'Второе сообщение']);
  assert.equal(packets.at(-1)?.type, 'chat-check'); assert.equal(packets.at(-1)?.value, false);
});

test('provider failures leave later messages sendable without adding sanctions', async context => {
  const { send, checks, published, packets, record, flush } = fixture(context);
  const first = send('Первая реплика'), second = send('Другая реплика');
  await flush(); checks[0].reject(new Error('Проверка недоступна')); await first; await flush();
  assert(packets.some(packet => packet.type === 'notice' && packet.value === 'Проверка недоступна'));
  checks[1].resolve(false); await second;
  assert.equal(record.mock.callCount(), 0);
  assert.deepEqual(published.map(message => message.text), ['Другая реплика']);
});

test('a moderation violation cancels queued messages after the warning', async context => {
  const { send, checks, published, record, flush } = fixture(context);
  const first = send('Первый текст'), second = send('Следующий текст');
  await flush(); checks[0].resolve(true); await Promise.all([first, second]);
  assert.equal(checks.length, 1);
  assert.equal(record.mock.callCount(), 1);
  assert.equal(published.filter(message => message.senderId !== 'security').length, 0);
});

test('disconnecting cancels both the in-flight message and its queue', async context => {
  const { room, client, send, checks, published, flush } = fixture(context);
  const first = send('Первая фраза'), second = send('Вторая фраза');
  await flush(); room.onDrop(client); checks[0].resolve(false); await Promise.all([first, second]);
  assert.equal(checks.length, 1); assert.equal(published.length, 0);
});

test('a full queue rejects overflow and still detects spam at arrival time', async context => {
  const { send, checks, published, packets, record, flush } = fixture(context);
  const requests = Array.from({ length: 8 }, (_, index) => send('Разные сообщения ' + index));
  await flush();
  assert(packets.some(packet => packet.type === 'notice' && /Очередь проверки заполнена/.test(packet.value)));
  assert.equal(record.mock.callCount(), 1);
  for (const check of checks) check.resolve(false);
  await Promise.all(requests);
  assert.equal(published.filter(message => message.senderId !== 'security').length, 0);
});
