import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatModerator } from '../server/moderation';
import { chatModerationProvider, requestChatVerdict } from '../server/chatModerationProvider';

const names = ['VENICE_API_KEY', 'CODEX_SALE_API_KEY', 'CODEX_SALE_NPC_MODEL', 'CHAT_MODERATION_PROVIDER', 'CHAT_MODERATION_MODEL', 'CHAT_MODERATION_BACKUP_MODEL', 'NODE_ENV'];
const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
before(() => { for (const name of names) delete process.env[name]; process.env.VENICE_API_KEY = 'private-synthetic-key'; });
after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } });
const response = (verdict: unknown, finish = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { role: 'assistant', content: JSON.stringify(verdict) } }] }));

test('chat uses its own fast models and permits an explicit legacy provider', () => {
 process.env.CODEX_SALE_NPC_MODEL = 'npc-model';
 assert.deepEqual(chatModerationProvider(), { name: 'venice', key: 'private-synthetic-key', model: 'qwen3-next-80b', backupModel: 'mistral-small-3-2-24b-instruct' });
 process.env.CHAT_MODERATION_PROVIDER = 'codex-sale'; process.env.CODEX_SALE_API_KEY = 'legacy-key';
 assert.equal(chatModerationProvider()?.name, 'codex-sale');
 assert.equal(chatModerationProvider()?.model, 'npc-model');
 delete process.env.CHAT_MODERATION_PROVIDER;
});

test('reported ordinary phrase is untrusted input and uses strict private classification', async () => {
 for (const violation of [false, true]) {
  let count = 0;
  const service = new ChatModerator((async (url, init) => {
   count++; assert.equal(url, 'https://api.venice.ai/api/v1/chat/completions');
   const body = JSON.parse(init!.body as string);
   assert.equal(body.messages[1].content, 'Все гуд итс вери гуд');
   assert.equal(body.messages[0].content.includes('Все гуд итс вери гуд'), false);
   assert.equal(body.response_format.json_schema.strict, true);
   assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
   assert.equal(body.store, false); assert.equal(body.stream, false);
   assert.equal(body.venice_parameters.include_venice_system_prompt, false);
   return response({ violation });
  }) as typeof fetch);
  assert.equal(await service.check('a', 'Все гуд итс вери гуд'), violation);
  assert.equal(count, 1, 'valid verdict must not be retried');
 }
});

test('transport, HTTP and malformed verdicts use the same policy on the backup', async () => {
 for (const failed of [() => new Response('', { status: 503 }), () => response({ violation: false }, 'length'),
  () => response({ violation: 'false' }), () => response({ violation: false, extra: 'x' }), () => { throw new Error('sensitive raw detail'); }]) {
  const bodies: any[] = [];
  const service = new ChatModerator((async (_url, init) => {
   bodies.push(JSON.parse(init!.body as string));
   return bodies.length === 1 ? failed() : response({ violation: true });
  }) as typeof fetch);
  assert.equal(await service.check('a', 'ты дебил'), true);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0].model, 'qwen3-next-80b'); assert.equal(bodies[1].model, 'mistral-small-3-2-24b-instruct');
  assert.deepEqual(bodies[0].messages, bodies[1].messages);
 }
});

test('a stalled primary is aborted, backup wins and late primary cannot change its verdict', async () => {
 let count = 0, release!: (value: Response) => void, signal: AbortSignal | undefined;
 const service = new ChatModerator((async (_url, init) => {
  if (++count > 1) return response({ violation: false });
  signal = init!.signal as AbortSignal;
  return new Promise<Response>(resolve => { release = resolve; });
 }) as typeof fetch, 100);
 const start = Date.now();
 assert.equal(await service.check('a', 'Привет'), false);
 assert.ok(Date.now() - start < 250);
 assert.equal(signal?.aborted, true); assert.equal(count, 2);
 release(response({ violation: true })); await new Promise(resolve => setImmediate(resolve));
 assert.equal(await service.check('a', 'Ещё привет'), false);
});

test('all attempts share one deadline and failure releases the account without a verdict', async () => {
 let count = 0;
 const service = new ChatModerator((async () => { count++; return new Promise<Response>(() => {}); }) as typeof fetch, 60);
 const start = Date.now();
 await assert.rejects(service.check('a', 'Не отправлять без проверки'), /не отправлено.*не начислено/);
 assert.equal(count, 2); assert.ok(Date.now() - start < 200);
 await assert.rejects(service.check('a', 'Повтор'), /не отправлено.*не начислено/);
 assert.equal(count, 4);
});

test('diagnostics omit text, keys and raw provider errors', async () => {
 const saved = console.warn, events: unknown[][] = [];
 console.warn = (...args) => { events.push(args); };
 try {
  const service = new ChatModerator((async () => { throw new Error('RAW SECRET'); }) as typeof fetch);
  await assert.rejects(service.check('private-account', 'PRIVATE MESSAGE'));
  const log = JSON.stringify(events);
  for (const secret of ['RAW SECRET', 'private-synthetic-key', 'PRIVATE MESSAGE', 'private-account']) assert.equal(log.includes(secret), false);
  assert.equal(events.length, 2);
 } finally { console.warn = saved; }
});

test('oversized bodies, malformed JSON and nonfinal verdicts are not accepted', async () => {
 const provider = chatModerationProvider()!;
 for (const fixture of [new Response('x'.repeat(65537)), new Response('{}', { headers: { 'Content-Length': '65537' } }),
  new Response('{'), response(null), response([]), response({ violation: true }, 'content_filter')]) {
  await assert.rejects(requestChatVerdict((async () => fixture) as typeof fetch, provider, 'rules', 'text', 100));
 }
});

test('production without a selected provider key fails closed', async () => {
 process.env.NODE_ENV = 'production'; process.env.CHAT_MODERATION_PROVIDER = 'venice'; delete process.env.VENICE_API_KEY;
 try { await assert.rejects(new ChatModerator().check('a', 'Привет'), /не отправлено.*не начислено/); }
 finally { process.env.VENICE_API_KEY = 'private-synthetic-key'; delete process.env.CHAT_MODERATION_PROVIDER; delete process.env.NODE_ENV; }
});
