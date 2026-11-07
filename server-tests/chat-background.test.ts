import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LobbyRoom } from '../server/LobbyRoom';
import { Player } from '../server/state';
import { MovementInputs } from '../server/movementInputs';
import { accounts } from '../server/accounts';
import { chatSpam } from '../server/chatSpam';
import { chatLanguageWindow } from '../server/chatLanguageWindow';
import { ROOM_CHAT_PROTOCOL } from '../src/shared/chat';
import type { HallId } from '../src/shared/world';
type SessionCheck = { hash: string; resolve: (active: boolean) => void; reject: (error: Error) => void };

function fixture(context: TestContext, options: { suffix?: string; account?: string; checks?: SessionCheck[] } = {}) {
  const room = new LobbyRoom(), handlers = new Map<string, (client: any, value?: unknown) => any>();
  const published: any[] = [], packets: { type: string; value: any }[] = [];
  const id = context.name + (options.suffix ?? ""), account = options.account ?? id;
  const client: any = { sessionId: id, auth: { account: { id: account, name: 'Игрок', skin: 0, appearance: null }, hash: id },
    send(type: string, value: unknown) {
      packets.push({ type, value });
      if (type === 'chat') published.push(value);
    }, leave() {} };
  context.mock.method(room, 'onMessage', (type: string, handler: any) => { handlers.set(type, handler); });
  context.mock.method(room, 'setPatchRate', () => {});
  context.mock.method(room, 'setSimulationInterval', () => {});
  context.mock.method(room, 'broadcast', () => {});
  context.mock.method(room.clock, 'setInterval', () => ({ clear() {} }));
  context.mock.method(room, 'allowReconnection', async () => undefined as any);
  context.mock.method(accounts, 'currentAccount', async () => client.auth.account);
  context.mock.method(accounts.clubSanctions, 'active', async () => null);
  context.mock.method(accounts.drinking, 'read', async () => ({ soberAt: 0, lastDrink: '', lastDrinkAt: 0 }));
  const sanction = () => ({
    outcome: { opened: true, sanction: { id: randomUUID(), until: Date.now() + 20 * 60_000, amountCents: 1000, revision: 1 } },
    replayed: false,
  });
  const record = context.mock.method(accounts.clubSanctions, 'recordViolation', async (
    _account: string, _event: Parameters<typeof accounts.clubSanctions.recordViolation>[1],
  ) => sanction());
  const checks: SessionCheck[] = options.checks ?? [];
  const active = context.mock.method(accounts, 'active', (hash: string) => new Promise<boolean>((resolve, reject) => checks.push({ hash, resolve, reject })));
  room.onCreate(); room.clients.push(client);
  const player = new Player(); player.name = 'Игрок'; room.state.players.set(id, player);
  (room as any).controls.set(id, { dx: 0, dy: 0, at: 0, path: [], lastTarget: 0, chatRevision: 0, inputs: new MovementInputs(), predicted: false });
  (room as any).access.set(id, { active: true, pendingEject: false, revision: 0, profileRevision: { name: 0, skin: 0, appearance: 0 }, drinking: { soberAt: 0, lastDrink: '', lastDrinkAt: 0 } });
  (room as any).updateChatVisit(id, player.hall);
  const requestHistory = (target: any, version?: number) => handlers.get('history')!(target, version === undefined ? undefined : { version });
  requestHistory(client, ROOM_CHAT_PROTOCOL);
  packets.length = 0;
  context.after(async () => { chatSpam.clear(account); chatLanguageWindow.clear(account); await room.onDispose(); room.clock.clear(); });
  const send = (text: unknown) => handlers.get('chat')!(client, text) as Promise<void>;
  const move = (hall: HallId) => { player.hall = hall; player.hallRevision++; (room as any).updateChatVisit(id, hall); };
  const observe = (name: string, hall: HallId, modern = true) => {
    const observerId = id + ':' + name, received: typeof packets = [];
    const observer: any = { sessionId: observerId, send(type: string, value: unknown) { received.push({ type, value }); } };
    const guest = new Player(); guest.hall = hall; guest.name = name;
    room.clients.push(observer);
    room.state.players.set(observerId, guest);
    (room as any).access.set(observerId, { active: true });
    (room as any).controls.set(observerId, {});
    (room as any).updateChatVisit(observerId, hall);
    if (modern) requestHistory(observer, ROOM_CHAT_PROTOCOL);
    return { received, history: (version = modern ? ROOM_CHAT_PROTOCOL : undefined) => requestHistory(observer, version),
      send: (text: unknown) => handlers.get('chat')!(observer, text) };
  };
  const history = (version = ROOM_CHAT_PROTOCOL) => requestHistory(client, version);
  const flush = () => new Promise<void>(resolve => setImmediate(resolve));
  return { room, client, player, packets, published, checks, active, record, sanction, send, flush, move, observe, history };
}

test('an unversioned client receives no floor history or messages and cannot post', async context => {
  const { send, checks, flush, observe } = fixture(context);
  const legacy = observe('legacy', 'arcade', false);
  legacy.history();
  assert.deepEqual(legacy.received, [{ type: 'history', value: [] }]);
  await legacy.send('Message from an unversioned client');
  assert.equal(checks.length, 0);
  const published = send('Message scoped to the floor visit');
  await flush(); checks[0].resolve(true); await published;
  assert.equal(legacy.received.some(packet => packet.type === 'chat' || packet.type === 'chat-visit'), false);
  legacy.history(ROOM_CHAT_PROTOCOL);
  const visit = legacy.received.find(packet => packet.type === 'chat-visit')!.value;
  const history = legacy.received.at(-1)!.value;
  assert.deepEqual(history.map((message: { text: string; visitId: number }) => [message.text, message.visitId]),
    [['Message scoped to the floor visit', visit.id]]);
});

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
  assert.equal(valid.record.mock.callCount(), 0);
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

test('an insult after nine profane words ejects once across rooms without counting a retried request', async context => {
  const checks: SessionCheck[] = [];
  const account = context.name, a = fixture(context, { suffix: '-a', account, checks }), b = fixture(context, { suffix: '-b', account, checks });
  const first = { id: randomUUID(), text: 'fuck shit kurwa merde cazzo' };
  const five = a.send(first);
  await a.flush(); checks[0].resolve(true); await five;
  await a.send(first);
  const replay = b.send({ ...first, id: first.id.toUpperCase() });
  await replay;
  assert.equal(checks.length, 1);
  assert.equal(b.published.length, 0);
  const nine = b.send({ id: randomUUID(), text: 'coño caralho putain klootzak' });
  await a.flush(); checks[1].resolve(true); await nine;
  assert.equal(b.record.mock.callCount(), 0);

  const last = { id: randomUUID(), text: 'Ты идиот' };
  const ten = b.send(last);
  await a.flush(); checks[2].resolve(true); await ten;
  await b.send(last);
  assert.equal(b.record.mock.callCount(), 1);
  assert.equal(b.record.mock.calls[0].arguments[1].reason, 'profanity');
  assert(b.published.some(message => message.senderId === 'security' && message.text.includes('грубых слов')));
  assert.equal(a.published.some(message => message.senderId === 'security'), false);
  assert.equal(b.player.security, '');
  assert(b.packets.some(packet => packet.type === 'chat-result' && packet.value.id === last.id && packet.value.status === 'rejected'));
  assert.equal(b.published.some(message => message.requestId === last.id), false);
});

test('addressed and standalone insults are delivered below the same threshold', async context => {
  const { room, send, checks, published, packets, record, flush } = fixture(context);
  const other = new Player(); other.name = 'Грифа';
  room.state.players.set('other', other);
  const messages = ['Грифа, ты дебил!', 'idiot'];
  for (const [index, text] of messages.entries()) {
    const delivery = send({ id: randomUUID(), text });
    await flush(); checks[index].resolve(true); await delivery;
  }
  assert.deepEqual(published.map(message => message.text), messages);
  assert.equal(record.mock.callCount(), 0);
  assert.equal(packets.some(packet => packet.type === 'security'), false);
});

test('the first confirmed spam episode records one sanction and immediately dispatches security', async context => {
  const { send, checks, published, packets, record, sanction, flush } = fixture(context);
  let commit!: () => void;
  record.mock.mockImplementation(() => new Promise(resolve => { commit = () => resolve(sanction()); }));
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
  assert.equal(record.mock.calls[0].arguments[1].reason, 'spam');
  assert(packets.some(packet => packet.type === 'notice' && /отклонено за спам/.test(packet.value)));
  checks[0].resolve(true);
  commit();
  await Promise.all([first, ...rest]);
  assert(published.some(message => message.senderId === 'security' && message.text.includes('спам')));
  assert.equal(packets.some(packet => packet.type === 'club-capture'), false);
  assert.equal(published.filter(message => message.senderId !== 'security').length, 0);
});

test('a delayed toilet violation records the mark without dispatching a guard after a floor change', async context => {
  const { send, move, checks, published, record, flush } = fixture(context);
  move('toilet');
  const message = send({ id: randomUUID(), text: 'fuck shit Scheiße putain coño cazzo kurwa caralho klootzak idiot' });
  await flush();
  move('tables');
  checks[0].resolve(true); await message;
  assert.equal(record.mock.callCount(), 1);
  assert.deepEqual(record.mock.calls[0].arguments[1].pursuitId, undefined);
  assert.equal(published.some(message => message.senderId === 'security'), false);
});

test('a persisted violation cannot dispatch its old pursuit after the player escapes and reenters', async context => {
  const { send, move, checks, published, record, sanction, flush } = fixture(context);
  let commit!: () => void;
  record.mock.mockImplementation(() => new Promise(resolve => { commit = () => resolve(sanction()); }));
  const message = send({ id: randomUUID(), text: 'fuck shit Scheiße putain coño cazzo kurwa caralho klootzak idiot' });
  await flush(); checks[0].resolve(true); await flush();
  assert.equal(record.mock.callCount(), 1);
  assert.equal(typeof record.mock.calls[0].arguments[1].pursuitId, 'string');
  move('toilet');
  move('github');
  commit();
  await message;
  assert.equal(published.some(message => message.senderId === 'security'), false);
});

test('the collision threshold uses the same account sanction store', async context => {
  const { room, client, checks, published, record, flush } = fixture(context);
  const pending = (room as any).ejectForCollision(client);
  await flush(); checks[0].resolve(true); await pending;
  assert.equal(record.mock.callCount(), 1);
  assert.equal(record.mock.calls[0].arguments[1].reason, 'collision');
  assert(published.some(message => message.senderId === 'security' && message.text.includes('толчков')));
});

test('a confirmed physical capture places a dropped session on the street and reconnect replays the escort', async context => {
  const { room, client, player, send, checks, packets, sanction, record, active, flush } = fixture(context);
  const saved = sanction();
  record.mock.mockImplementation(async () => saved);
  context.mock.method(accounts.clubSanctions, 'enforcement', async () => ({ sanction: saved.outcome.sanction, disguiseSkinId: null }));
  let commit!: () => void;
  const capture = context.mock.method(accounts.clubSanctions, 'recordCapture', () => new Promise(resolve => {
    commit = () => resolve({ outcome: { sanction: saved.outcome.sanction, kind: 'initial' }, replayed: false });
  }));
  const guard = room.state.guards.get('security')!;
  guard.x = player.x + 30; guard.y = player.y;
  const violation = send({ id: randomUUID(), text: 'fuck shit Scheiße putain coño cazzo kurwa caralho klootzak idiot' });
  await flush(); checks[0].resolve(true); await violation;
  assert.equal(player.security, '');
  (room as any).guards.tick(.05);
  assert.equal(player.security, 'ejecting');
  assert.equal(capture.mock.callCount(), 1);
  assert.equal(capture.mock.calls[0].arguments[1].pursuitId, record.mock.calls[0].arguments[1].pursuitId);
  room.onDrop(client);
  commit(); await flush();
  for (let i = 0; i < 300 && player.hall !== 'street'; i++) (room as any).guards.tick(.05);
  assert.equal(player.hall, 'street');
  assert.equal(player.security, '');
  assert.equal(packets.some(packet => packet.type === 'club-ejected'), false);
  active.mock.mockImplementation(async () => true);
  await room.onReconnect(client);
  assert.deepEqual(packets.filter(packet => packet.type.startsWith('club-')).map(packet => packet.type),
    ['club-sanction-changed', 'club-capture', 'club-ejected']);
});

test('cross-room retries while delivery is pending return the outcome without counting as repeated spam', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: 1_000 });
  const checks: SessionCheck[] = [], account = context.name;
  const a = fixture(context, { suffix: '-a', account, checks }), b = fixture(context, { suffix: '-b', account, checks });
  const id = randomUUID(), text = 'Please check this announcement t.me/OneSharedChannel';
  b.move('tables');
  const first = a.send({ id, text, visitId: 1 });
  await a.flush();
  context.mock.timers.tick(31_000);
  const retries = [b.send({ id, text, visitId: 1 }), b.send({ id: id.toUpperCase(), text, visitId: 1 })];
  await a.flush();
  assert.equal(checks.length, 1);
  checks[0].resolve(true);
  await Promise.all([first, ...retries]);
  assert.equal(a.published.length, 1);
  assert.equal(b.published.length, 0);
  assert.equal(b.record.mock.callCount(), 0);
  assert.equal(b.packets.filter(packet => packet.type === 'chat-result' && packet.value.status === 'published').length, 2);
  context.mock.timers.tick(31_000);
  const recovered = fixture(context, { suffix: '-recovered', account, checks });
  recovered.move('github');
  await recovered.send({ id, text, visitId: 1 });
  assert.equal(checks.length, 1);
  assert.equal(recovered.published.length, 0);
  assert(recovered.packets.some(packet => packet.type === 'chat-result' && packet.value.status === 'published'));
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
  assert(packets.some(packet => packet.type === 'notice' && packet.value === 'Сообщение не отправлено. Текст сохранён.'));
  for (const check of checks) check.resolve(true);
  await Promise.all([first, ...rest]);
  assert.equal(record.mock.callCount(), 1);
  assert.equal(published.filter(message => message.senderId !== 'security').length, 0);
});

test('a queued message stays on the source floor and excludes later arrivals from live delivery and history', async context => {
  const { send, move, observe, history, checks, packets, published, flush } = fixture(context);
  const original = observe('On the floor before sending', 'arcade');
  const otherFloor = observe('On the destination floor', 'tables');
  const id = randomUUID(), pending = send({ id, text: 'Синтетическая проверка этажа' });
  await flush(); assert.equal(checks.length, 1);
  move('tables');
  const late = observe('On the floor after sending', 'arcade');
  checks[0].resolve(true); await pending;
  assert.equal(published.length, 0);
  assert.deepEqual(original.received.filter(packet => packet.type === 'chat').map(packet => packet.value.requestId), [id]);
  assert.equal(otherFloor.received.some(packet => packet.type === 'chat'), false);
  assert.equal(late.received.some(packet => packet.type === 'chat'), false);
  late.history();
  assert.deepEqual(late.received.at(-1), { type: 'history', value: [] });
  original.history();
  assert.deepEqual(original.received.at(-1)?.value.map((message: any) => message.requestId), [id]);
  move('arcade');
  history();
  assert.deepEqual(packets.at(-1), { type: 'history', value: [] });
  assert.deepEqual(packets.filter(packet => packet.type === 'chat-result').map(packet => packet.value), [{ id, status: 'queued' }, { id, status: 'published' }]);
});

test('the toilet has a private chat visit and exterior locations reject send and history', async context => {
  const { send, move, observe, history, checks, packets, published, flush } = fixture(context);
  const floor = observe('Floor', 'arcade');
  const toilet = observe('Toilet', 'toilet');
  const firstVisit = toilet.received[0].value.id;
  move('toilet');
  const ownVisit = packets.at(-1)?.value.id;
  const id = randomUUID();
  const pending = send({ id, text: 'Привет в туалете', visitId: ownVisit });
  await flush(); checks[0].resolve(true); await pending;
  assert.deepEqual(published.map(message => message.requestId), [id]);
  assert.equal(toilet.received.find(packet => packet.type === 'chat')?.value.visitId, firstVisit);
  assert.equal(floor.received.some(packet => packet.type === 'chat'), false);
  for (const hall of ['street', 'roof'] as const) {
    move(hall);
    const exterior = randomUUID();
    await send({ id: exterior, text: 'Попытка написать снаружи', visitId: ownVisit });
    assert(packets.some(packet => packet.type === 'chat-result' && packet.value.id === exterior && packet.value.status === 'rejected'));
    history();
    assert.deepEqual(packets.at(-1), { type: 'history', value: [] });
  }
  move('toilet');
  const stale = randomUUID();
  await send({ id: stale, text: 'Запрос с прошлого визита', visitId: ownVisit });
  assert(packets.some(packet => packet.type === 'chat-result' && packet.value.id === stale && packet.value.status === 'cancelled'));
  assert.equal(checks.length, 1);
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
  const { room, client, send, checks, active, packets, published, flush, history } = fixture(context);
  const ids = [randomUUID(), randomUUID()];
  const first = send({ id: ids[0], text: 'Синтетическая первая проверка связи' });
  const second = send({ id: ids[1], text: 'Синтетическая вторая проверка связи' });
  await flush(); room.onDrop(client); checks[0].resolve(true); await Promise.all([first, second]);
  assert.equal(checks.length, 1); assert.equal(published.length, 0);
  for (const id of ids) assert.equal(packets.filter(packet => packet.type === 'chat-result' && packet.value.id === id && packet.value.status === 'cancelled').length, 1);
  packets.length = 0; active.mock.mockImplementation(async () => true); await room.onReconnect(client);
  assert.deepEqual(packets.filter(packet => packet.type === 'chat-result').map(packet => packet.value.id), ids);
  history(0);
  assert.deepEqual(packets.at(-1), { type: 'history', value: [] });
  assert.equal(packets.some(packet => packet.type === 'chat-visit'), false, 'a resumed socket must negotiate again');
  history();
  assert.equal(packets.at(-2)?.type, 'chat-visit');
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
