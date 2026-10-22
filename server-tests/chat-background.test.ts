import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LobbyRoom } from '../server/LobbyRoom';
import { Player } from '../server/state';
import { MovementInputs } from '../server/movementInputs';
import { accounts } from '../server/accounts';
import { chatModerator } from '../server/moderation';
import { chatSpam } from '../server/chatSpam';

function fixture(context: TestContext, options: { suffix?: string; account?: string; checks?: { text: string; resolve: (violation: boolean) => void; reject: (error: Error) => void }[] } = {}) {
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, value?: unknown) => any>();
  const published: any[] = [], packets: { type: string; value: any }[] = [];
  const id = context.name + (options.suffix ?? ""), account = options.account ?? id;
  const client: any = { sessionId: id, auth: { account: { id: account, name: 'Игрок', skin: 0, appearance: null }, hash: id },
    send(type: string, value: unknown) { packets.push({ type, value }); }, leave() {} };
  context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', (type: string, value: unknown) => { if (type === 'chat') published.push(value); });
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  context.mock.method(room, 'allowReconnection', async () => undefined as any);
  context.mock.method(accounts, 'active', async () => true);
  context.mock.method(accounts, 'currentAccount', async () => client.auth.account);
  context.mock.method(accounts.moderation, 'banUntil', async () => 0);
  context.mock.method(accounts.drinking, 'read', async () => ({ soberAt: 0, lastDrink: '', lastDrinkAt: 0 }));
  const record = context.mock.method(accounts.moderation, 'record', async () => ({ kind: 'warning' as const, until: 0 }));
  const checks: { text: string; resolve: (violation: boolean) => void; reject: (error: Error) => void }[] = options.checks ?? [];
  context.mock.method(chatModerator, 'check', (_id: string, text: string) => new Promise<boolean>((resolve, reject) => checks.push({ text, resolve, reject })));
  room.onCreate(); room.state.guards.clear(); room.clients.push(client);
  const player = new Player(); player.name = 'Игрок'; room.state.players.set(id, player);
  (room as any).controls.set(id, { dx: 0, dy: 0, at: 0, path: [], lastTarget: 0, chatRevision: 0, inputs: new MovementInputs(), predicted: false });
  (room as any).access.set(id, { active: true, banUntil: 0, pendingEject: false, revision: 0, profileRevision: { name: 0, skin: 0, appearance: 0 }, drinking: { soberAt: 0, lastDrink: '', lastDrinkAt: 0 } });
  context.after(async () => { chatSpam.clear(account); await room.onDispose(); room.clock.clear(); });
  const send = (text: unknown) => handlers.get('chat')!(client, text) as Promise<void>;
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

test('missing moderation verdict never publishes or adds sanctions', async context => {
  const { send, checks, published, packets, record, flush } = fixture(context);
  const id = randomUUID(), pending = send({ id, text: 'Синтетическая проверка обязательного вердикта' });
  await flush(); checks[0].resolve(undefined as unknown as boolean); await pending;
  assert.equal(published.length, 0); assert.equal(record.mock.callCount(), 0);
  assert(packets.some(packet => packet.type === 'chat-result' && packet.value.id === id && packet.value.status === 'rejected'));
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

test('an approved correlated message survives moving to another floor', async context => {
  const { send, player, checks, packets, published, flush } = fixture(context);
  const id = randomUUID(), pending = send({ id, text: 'Синтетическая проверка этажа' });
  await flush(); assert.equal(checks.length, 1);
  player.hall = 'tables'; player.hallRevision++;
  checks[0].resolve(false); await pending;
  assert.equal(published.length, 1); assert.equal(published[0].requestId, id);
  assert.deepEqual(packets.filter(packet => packet.type === 'chat-result').map(packet => packet.value), [{ id, status: 'queued' }, { id, status: 'published' }]);
});

test('correlated provider failures reject one message and allow the next without early checking completion', async context => {
  const { send, checks, packets, published, record, flush } = fixture(context);
  const firstId = randomUUID(), secondId = randomUUID();
  const first = send({ id: firstId, text: 'Синтетическая проверка сбоя' });
  const second = send({ id: secondId, text: 'Синтетическая проверка восстановления' });
  await flush(); checks[0].reject(new Error('Проверка недоступна')); await first; await flush();
  assert.equal(packets.some(packet => packet.type === 'chat-check' && packet.value === false), false);
  assert.equal(record.mock.callCount(), 0); assert.equal(published.length, 0);
  checks[1].resolve(false); await second;
  assert.equal(published.length, 1); assert.equal(published[0].requestId, secondId);
  assert.deepEqual(packets.filter(packet => packet.type === 'chat-result' && packet.value.status !== 'queued').map(packet => ({ id: packet.value.id, status: packet.value.status })), [{ id: firstId, status: 'rejected' }, { id: secondId, status: 'published' }]);
});

test('duplicate request IDs reuse their result without a second moderation or publication', async context => {
  const { send, checks, packets, published, flush } = fixture(context);
  const id = randomUUID(), value = { id, text: 'Синтетический уникальный запрос' };
  const first = send(value); await flush(); await send(value);
  assert.equal(checks.length, 1);
  checks[0].resolve(false); await first; await send(value);
  assert.equal(checks.length, 1); assert.equal(published.length, 1);
  assert.equal(packets.at(-1)?.type, 'chat-result'); assert.deepEqual(packets.at(-1)?.value, { id, status: 'published' });
});

test('disconnect cancels correlated messages and reconnect resynchronizes terminal results', async context => {
  const { room, client, send, checks, packets, published, flush } = fixture(context);
  const ids = [randomUUID(), randomUUID()];
  const first = send({ id: ids[0], text: 'Синтетическая первая проверка связи' });
  const second = send({ id: ids[1], text: 'Синтетическая вторая проверка связи' });
  await flush(); room.onDrop(client); checks[0].resolve(false); await Promise.all([first, second]);
  assert.equal(checks.length, 1); assert.equal(published.length, 0);
  for (const id of ids) assert.equal(packets.filter(packet => packet.type === 'chat-result' && packet.value.id === id && packet.value.status === 'cancelled').length, 1);
  packets.length = 0; await room.onReconnect(client);
  assert(packets.some(packet => packet.type === 'chat-check' && packet.value === false));
  assert.deepEqual(packets.filter(packet => packet.type === 'chat-result').map(packet => packet.value.id), ids);
  await send({ id: ids[0], text: 'Синтетическая первая проверка связи' });
  assert.equal(checks.length, 1); assert.equal(published.length, 0);
});

test('logout cancels queued and active messages without publication or discipline', async context => {
  const { room, client, send, checks, published, record, flush } = fixture(context);
  const first = send({ id: randomUUID(), text: 'Синтетический выход первый' });
  const second = send({ id: randomUUID(), text: 'Синтетический выход второй' });
  await flush(); (room as any).logoutListener(client.auth.hash); checks[0].resolve(false); await Promise.all([first, second]);
  assert.equal(checks.length, 1); assert.equal(published.length, 0); assert.equal(record.mock.callCount(), 0);
});

test('one account preserves FIFO order across different rooms', async context => {
  const checks: { text: string; resolve: (violation: boolean) => void; reject: (error: Error) => void }[] = [];
  const account = context.name, a = fixture(context, { suffix: '-a', account, checks }), b = fixture(context, { suffix: '-b', account, checks });
  const first = a.send({ id: randomUUID(), text: 'Синтетическая первая комната' });
  const second = b.send({ id: randomUUID(), text: 'Синтетическая вторая комната' });
  await a.flush(); assert.equal(checks.length, 1);
  checks[0].resolve(false); await first; await a.flush(); assert.equal(checks.length, 2);
  checks[1].resolve(false); await second;
  assert.equal(a.published.length, 1); assert.equal(b.published.length, 1);
});

test('a confirmed violation rejects its request and cancels the same account queue in another room', async context => {
  const checks: { text: string; resolve: (violation: boolean) => void; reject: (error: Error) => void }[] = [];
  const account = context.name, a = fixture(context, { suffix: '-a', account, checks }), b = fixture(context, { suffix: '-b', account, checks });
  const ids = [randomUUID(), randomUUID()];
  const first = a.send({ id: ids[0], text: 'Синтетический нарушающий запрос' });
  const second = b.send({ id: ids[1], text: 'Синтетический отменяемый запрос' });
  await a.flush(); checks[0].resolve(true); await Promise.all([first, second]);
  assert.equal(checks.length, 1);
  assert(a.packets.some(packet => packet.type === 'chat-result' && packet.value.id === ids[0] && packet.value.status === 'rejected'));
  assert(b.packets.some(packet => packet.type === 'chat-result' && packet.value.id === ids[1] && packet.value.status === 'cancelled'));
  assert.equal([...a.published, ...b.published].filter(message => message.senderId !== 'security').length, 0);
});

test('invalid payloads never reach moderation and terminal request history stays bounded', async context => {
  const { room, client, send, checks, packets } = fixture(context);
  for (const value of [{ id: 'bad', text: 'Синтетический текст' }, { id: 'x'.repeat(1000), text: 'Синтетический текст' }, { id: randomUUID(), text: '' }, { id: randomUUID(), text: 'x'.repeat(301) }]) await send(value);
  assert.equal(checks.length, 0);
  for (let index = 0; index < 40; index++) await send({ id: randomUUID(), text: '' });
  const control = (room as any).controls.get(client.sessionId);
  assert.equal((room as any).chatResults.get(control).size, 32);
  assert(packets.some(packet => packet.type === 'chat-result' && packet.value.status === 'rejected'));
});
