import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LobbyRoom } from '../server/LobbyRoom';
import { Player } from '../server/state';
import { MovementInputs } from '../server/movementInputs';
import { accounts } from '../server/accounts';
import { chatSpam } from '../server/chatSpam';
import { chatProfanity } from '../server/chatProfanity';
import { SECURITY_BAN_MS } from '../src/shared/security';
type SessionCheck = { hash: string; resolve: (active: boolean) => void; reject: (error: Error) => void };

function fixture(context: TestContext, options: { suffix?: string; account?: string; checks?: SessionCheck[] } = {}) {
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
  context.mock.method(accounts, 'currentAccount', async () => client.auth.account);
  context.mock.method(accounts.moderation, 'banUntil', async () => 0);
  context.mock.method(accounts.drinking, 'read', async () => ({ soberAt: 0, lastDrink: '', lastDrinkAt: 0 }));
  const record = context.mock.method(accounts.moderation, 'record', async () => ({ kind: 'warning' as const, until: 0 }));
  const eject = context.mock.method(accounts.moderation, 'eject', async (_id: string, now: number, reason: 'collision' | 'profanity') =>
    ({ kind: 'ejecting' as const, until: now + SECURITY_BAN_MS, reason }));
  const checks: SessionCheck[] = options.checks ?? [];
  const active = context.mock.method(accounts, 'active', (hash: string) => new Promise<boolean>((resolve, reject) => checks.push({ hash, resolve, reject })));
  room.onCreate(); room.state.guards.clear(); room.clients.push(client);
  const player = new Player(); player.name = 'Игрок'; room.state.players.set(id, player);
  (room as any).controls.set(id, { dx: 0, dy: 0, at: 0, path: [], lastTarget: 0, chatRevision: 0, inputs: new MovementInputs(), predicted: false });
  (room as any).access.set(id, { active: true, banUntil: 0, pendingEject: false, revision: 0, profileRevision: { name: 0, skin: 0, appearance: 0 }, drinking: { soberAt: 0, lastDrink: '', lastDrinkAt: 0 } });
  context.after(async () => { chatSpam.clear(account); chatProfanity.clear(account); await room.onDispose(); room.clock.clear(); });
  const send = (text: unknown) => handlers.get('chat')!(client, text) as Promise<void>;
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  return { room, client, player, packets, published, checks, active, record, eject, send, flush };
}

test('background delivery preserves account order without emitting a checking status', async context => {
  const { send, checks, published, packets, flush } = fixture(context);
  const first = send('Первое сообщение'), second = send('Второе сообщение');
  await flush();
  assert.equal(checks.length, 1);
  assert.equal(published.length, 0);
  checks[0].resolve(true); await first; await flush();
  assert.deepEqual(published.map(message => message.text), ['Первое сообщение']);
  assert.equal(checks.length, 2);
  checks[1].resolve(true); await second;
  assert.deepEqual(published.map(message => message.text), ['Первое сообщение', 'Второе сообщение']);
  assert.equal(packets.some(packet => packet.type === 'chat-check'), false);
});

test('session lookup failures leave later messages sendable without adding sanctions', async context => {
  const { send, checks, published, packets, record, flush } = fixture(context);
  const first = send('Первая реплика'), second = send('Другая реплика');
  await flush(); checks[0].reject(new Error('Database unavailable')); await first; await flush();
  assert(packets.some(packet => packet.type === 'notice' && /сообщение. Оно не отправлено/.test(packet.value)));
  checks[1].resolve(true); await second;
  assert.equal(record.mock.callCount(), 0);
  assert.deepEqual(published.map(message => message.text), ['Другая реплика']);
});

test('an expired session never publishes or adds sanctions', async context => {
  const { send, checks, published, packets, record, flush } = fixture(context);
  const id = randomUUID(), pending = send({ id, text: 'Синтетическое сообщение с просроченной сессией' });
  await flush(); checks[0].resolve(false); await pending;
  assert.equal(published.length, 0); assert.equal(record.mock.callCount(), 0);
  assert(packets.some(packet => packet.type === 'chat-result' && packet.value.id === id && packet.value.status === 'cancelled'));
});

test('profanity from an expired session cannot eject a later valid session', async context => {
  const checks: SessionCheck[] = [];
  const account = context.name, expired = fixture(context, { suffix: '-expired', account, checks });
  const valid = fixture(context, { suffix: '-valid', account, checks });
  const nine = expired.send({ id: randomUUID(), text: 'fuck shit Scheiße putain coño cazzo kurwa caralho klootzak' });
  await expired.flush(); checks[0].resolve(false); await nine;
  assert.equal(expired.published.length, 0);
  const one = valid.send({ id: randomUUID(), text: 'блять' });
  await valid.flush(); checks[1].resolve(true); await one;
  assert.equal(valid.eject.mock.callCount(), 0);
  assert.deepEqual(valid.published.map(message => message.text), ['б***ь']);
});

test('profanity is masked before broadcast without adding sanctions', async context => {
  const { send, checks, published, packets, record, flush } = fixture(context);
  const id = randomUUID(), pending = send({ id, text: 'Fuck, я идиот!' });
  await flush(); checks[0].resolve(true); await pending;
  assert.equal(record.mock.callCount(), 0);
  assert.equal(checks.length, 1);
  assert.deepEqual(packets.filter(packet => packet.type === 'chat-result').map(packet => packet.value), [
    { id, status: 'queued' }, { id, status: 'published' },
  ]);
  assert.deepEqual(published.map(message => [message.requestId, message.text]), [[id, 'F**k, я идиот!']]);
});

test('the tenth profane word ejects once across rooms without counting a retried request', async context => {
  const checks: SessionCheck[] = [];
  const account = context.name, a = fixture(context, { suffix: '-a', account, checks }), b = fixture(context, { suffix: '-b', account, checks });
  const first = { id: randomUUID(), text: 'fuck shit kurwa merde cazzo' };
  const five = a.send(first);
  await a.flush(); checks[0].resolve(true); await five;
  await a.send(first);
  const replay = b.send({ ...first, id: first.id.toUpperCase() });
  await a.flush(); checks[1].resolve(true); await replay;
  const nine = b.send({ id: randomUUID(), text: 'coño caralho putain klootzak' });
  await a.flush(); checks[2].resolve(true); await nine;
  assert.equal(b.record.mock.callCount(), 0);
  assert.equal(b.eject.mock.callCount(), 0);

  const last = { id: randomUUID(), text: 'блять' };
  const ten = b.send(last);
  await a.flush(); checks[3].resolve(true); await ten;
  await b.send(last);
  assert.equal(b.eject.mock.callCount(), 1);
  assert.equal(b.record.mock.callCount(), 0);
  for (const room of [a, b]) {
    assert(room.packets.some(packet => packet.type === 'security' && packet.value.kind === 'ejecting' && packet.value.reason === 'profanity'));
  }
  assert(b.packets.some(packet => packet.type === 'chat-result' && packet.value.id === last.id && packet.value.status === 'rejected'));
  assert.equal(b.published.some(message => message.requestId === last.id), false);
});

test('two separate addressed insults invoke the guard once each, even in different languages', async context => {
  const { room, send, checks, published, packets, record, flush, player } = fixture(context);
  const other = new Player(); other.name = 'Грифа';
  room.state.players.set('other', other);
  let offenses = 0;
  record.mock.mockImplementation(async () => ({ kind: ++offenses === 1 ? 'warning' : 'ejecting', until: Date.now() + 600000 }));
  const first = { id: randomUUID(), text: 'Грифа, ты дебил!' };
  const warning = send(first);
  await flush(); checks[0].resolve(true); await warning;
  await send(first);
  assert.equal(record.mock.callCount(), 1);
  assert(packets.some(packet => packet.type === 'security' && packet.value.reason === 'insult' && packet.value.kind === 'warning'));
  player.security = '';
  const second = { id: randomUUID(), text: 'You are an idiot. Leave the room.' };
  const ejection = send(second);
  await flush(); checks[1].resolve(true); await ejection;
  assert.equal(record.mock.callCount(), 2);
  assert(packets.some(packet => packet.type === 'security' && packet.value.reason === 'insult' && packet.value.kind === 'ejecting'));
  assert(packets.some(packet => packet.type === 'chat-result' && packet.value.id === second.id && packet.value.status === 'rejected'));
  assert.equal(published.filter(message => message.senderId !== 'security').length, 0);
});

test('a burst advertising the same channel records one offense while the warning is pending', async context => {
  const { send, checks, published, packets, record, flush } = fixture(context);
  let warn!: () => void;
  record.mock.mockImplementation(() => new Promise(resolve => { warn = () => resolve({ kind: 'warning', until: 0 }); }));
  const first = send('Смотрите анонсы https://t.me/RoyalExample');
  await flush();
  const rest = [
    send('Мой канал с бонусами t.me/s/royalexample/1'),
    send('Подписка здесь, телеграм @RoyalExample'),
    send('Подборка постов tg://resolve?domain=royalexample'),
    send('Новости выйдут в t.me/RoyalExample/4'),
    send('Кому нужны ссылки, вот https://telegram.me/royalexample'),
  ];
  await flush();
  assert.equal(checks.length, 2);
  checks[1].resolve(true);
  await flush();
  assert.equal(record.mock.callCount(), 1);
  assert(packets.some(packet => packet.type === 'notice' && /отклонено за спам/.test(packet.value)));
  checks[0].resolve(true);
  warn();
  await Promise.all([first, ...rest]);
  assert.equal(published.filter(message => message.senderId !== 'security').length, 0);
});

test('disconnecting cancels both the in-flight message and its queue', async context => {
  const { room, client, send, checks, published, flush } = fixture(context);
  const first = send('Первая фраза'), second = send('Вторая фраза');
  await flush(); room.onDrop(client); checks[0].resolve(true); await Promise.all([first, second]);
  assert.equal(checks.length, 1); assert.equal(published.length, 0);
});

test('a full queue rejects overflow and still detects spam at arrival time', async context => {
  const { send, checks, published, packets, record, flush } = fixture(context);
  const first = send('Разные сообщения 0');
  await flush();
  const rest = Array.from({ length: 7 }, (_, index) => send('Разные сообщения ' + (index + 1)));
  assert(packets.some(packet => packet.type === 'notice' && /Очередь отправки заполнена/.test(packet.value)));
  for (const check of checks) check.resolve(true);
  await Promise.all([first, ...rest]);
  assert.equal(record.mock.callCount(), 1);
  assert.equal(published.filter(message => message.senderId !== 'security').length, 0);
});

test('an approved correlated message survives moving to another floor', async context => {
  const { send, player, checks, packets, published, flush } = fixture(context);
  const id = randomUUID(), pending = send({ id, text: 'Синтетическая проверка этажа' });
  await flush(); assert.equal(checks.length, 1);
  player.hall = 'tables'; player.hallRevision++;
  checks[0].resolve(true); await pending;
  assert.equal(published.length, 1); assert.equal(published[0].requestId, id);
  assert.deepEqual(packets.filter(packet => packet.type === 'chat-result').map(packet => packet.value), [{ id, status: 'queued' }, { id, status: 'published' }]);
});

test('duplicate request IDs reuse their result without a second publication', async context => {
  const { send, checks, packets, published, flush } = fixture(context);
  const id = randomUUID(), value = { id, text: 'Синтетический уникальный запрос' };
  const first = send(value); await flush(); await send(value);
  assert.equal(checks.length, 1);
  checks[0].resolve(true); await first; await send(value);
  assert.equal(checks.length, 1); assert.equal(published.length, 1);
  assert.equal(packets.at(-1)?.type, 'chat-result'); assert.deepEqual(packets.at(-1)?.value, { id, status: 'published' });
});

test('disconnect cancels correlated messages and reconnect resynchronizes terminal results', async context => {
  const { room, client, send, checks, active, packets, published, flush } = fixture(context);
  const ids = [randomUUID(), randomUUID()];
  const first = send({ id: ids[0], text: 'Синтетическая первая проверка связи' });
  const second = send({ id: ids[1], text: 'Синтетическая вторая проверка связи' });
  await flush(); room.onDrop(client); checks[0].resolve(true); await Promise.all([first, second]);
  assert.equal(checks.length, 1); assert.equal(published.length, 0);
  for (const id of ids) assert.equal(packets.filter(packet => packet.type === 'chat-result' && packet.value.id === id && packet.value.status === 'cancelled').length, 1);
  packets.length = 0; active.mock.mockImplementation(async () => true); await room.onReconnect(client);
  assert.deepEqual(packets.filter(packet => packet.type === 'chat-result').map(packet => packet.value.id), ids);
  await send({ id: ids[0], text: 'Синтетическая первая проверка связи' });
  assert.equal(checks.length, 1); assert.equal(published.length, 0);
});

test('logout cancels queued and active messages without publication or discipline', async context => {
  const { room, client, send, checks, published, record, flush } = fixture(context);
  const first = send({ id: randomUUID(), text: 'Синтетический выход первый' });
  const second = send({ id: randomUUID(), text: 'Синтетический выход второй' });
  await flush(); (room as any).logoutListener(client.auth.hash); checks[0].resolve(true); await Promise.all([first, second]);
  assert.equal(checks.length, 1); assert.equal(published.length, 0); assert.equal(record.mock.callCount(), 0);
});

test('one account preserves FIFO order across different rooms', async context => {
  const checks: SessionCheck[] = [];
  const account = context.name, a = fixture(context, { suffix: '-a', account, checks }), b = fixture(context, { suffix: '-b', account, checks });
  const first = a.send({ id: randomUUID(), text: 'Синтетическая первая комната' });
  const second = b.send({ id: randomUUID(), text: 'Синтетическая вторая комната' });
  await a.flush(); assert.equal(checks.length, 1);
  checks[0].resolve(true); await first; await a.flush(); assert.equal(checks.length, 2);
  checks[1].resolve(true); await second;
  assert.equal(a.published.length, 1); assert.equal(b.published.length, 1);
});

test('spam rejection cancels the same account queue in another room', async context => {
  const checks: SessionCheck[] = [];
  const account = context.name, a = fixture(context, { suffix: '-a', account, checks }), b = fixture(context, { suffix: '-b', account, checks });
  const ids = [randomUUID(), randomUUID(), randomUUID()], text = 'Синтетический повторяющийся запрос';
  const first = a.send({ id: ids[0], text });
  await a.flush();
  const second = b.send({ id: ids[1], text });
  const third = a.send({ id: ids[2], text });
  assert.equal(checks.length, 2);
  for (const check of checks) check.resolve(true);
  await Promise.all([first, second, third]);
  assert(a.packets.some(packet => packet.type === 'chat-result' && packet.value.id === ids[2] && packet.value.status === 'rejected'));
  assert(b.packets.some(packet => packet.type === 'chat-result' && packet.value.id === ids[1] && packet.value.status === 'cancelled'));
  assert.equal([...a.published, ...b.published].filter(message => message.senderId !== 'security').length, 0);
});

test('invalid payloads never reach delivery and terminal request history stays bounded', async context => {
  const { room, client, send, checks, packets } = fixture(context);
  for (const value of [{ id: 'bad', text: 'Синтетический текст' }, { id: 'x'.repeat(1000), text: 'Синтетический текст' }, { id: randomUUID(), text: '' }, { id: randomUUID(), text: 'x'.repeat(301) }]) await send(value);
  assert.equal(checks.length, 0);
  for (let index = 0; index < 40; index++) await send({ id: randomUUID(), text: '' });
  const control = (room as any).controls.get(client.sessionId);
  assert.equal((room as any).chatResults.get(control).size, 32);
  assert(packets.some(packet => packet.type === 'chat-result' && packet.value.status === 'rejected'));
});
