import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MiraService, MiraError } from '../server/mira';

const variables = ['MIRA_PROVIDER', 'VENICE_API_KEY', 'VENICE_NPC_MODEL', 'CODEX_SALE_API_KEY', 'CODEX_SALE_NPC_MODEL'];
let previous: (string | undefined)[];
beforeEach(() => { previous = variables.map(name => process.env[name]); for (const name of variables) delete process.env[name]; });
afterEach(() => { variables.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; }); });
const answer = { reply: 'Джаз? Уже интереснее.', facts: ['Гость любит джаз'], impression: 'Любит джаз', tone: 'interest', choices: ['Расскажи про джаз'], endConversation: false, drinkOffer: null, emotion: 'tease' };
const completion = (finish = 'stop', content = JSON.stringify(answer)) => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { role: 'assistant', content } }] }));

test('Venice keeps the Mira persona, server context, history and structured game response', async () => {
  process.env.MIRA_PROVIDER = 'venice'; process.env.VENICE_API_KEY = 'synthetic-venice-key'; process.env.CODEX_SALE_API_KEY = 'synthetic-codex-key';
  let now = 100000; const calls: { url: string; options: RequestInit; body: any }[] = [];
  const request = (async (url: unknown, options: RequestInit) => {
    calls.push({ url: String(url), options, body: JSON.parse(String(options.body)) }); return completion();
  }) as typeof fetch;
  const service = new MiraService(request, undefined, () => now);
  const result = await service.respond('a', 'Люблю джаз'); now += 3000;
  await service.respond('a', 'Что посоветуешь?');
  assert.equal(result.reply, answer.reply); assert.equal(result.emotion, 'tease'); assert.deepEqual(result.choices, answer.choices);
  assert.equal(calls[0].url, 'https://api.venice.ai/api/v1/chat/completions');
  assert.equal(new Headers(calls[0].options.headers).get('Authorization'), 'Bearer synthetic-venice-key');
  assert.equal(calls[0].body.model, 'venice-uncensored-role-play');
  assert.match(calls[0].body.messages[0].content, /Ты Мира/); assert.match(calls[0].body.messages[0].content, /Серверное наблюдение/);
  assert.deepEqual(calls[0].body.messages.slice(1), [{ role: 'user', content: 'Люблю джаз' }]);
  assert.deepEqual(calls[1].body.messages.slice(1).map((m: any) => m.role), ['user', 'assistant', 'user']);
  assert.match(calls[1].body.messages[0].content, /Гость любит джаз/);
  assert.equal(calls[0].body.store, false); assert.equal(calls[0].body.stream, false);
  assert.equal(calls[0].body.response_format.type, 'json_schema');
  assert.equal(calls[0].body.venice_parameters.include_venice_system_prompt, false);
  assert.equal(calls[0].body.venice_parameters.enable_web_search, 'off');
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  now += 3000; await service.respond('b', 'Привет'); assert.equal(calls.at(-1)!.body.messages.length, 2);
});

for (const failure of ['http', 'length', 'invalid-json', 'invalid-fields']) {
  test(`Venice ${failure} failure preserves memory and never silently sends the dialogue to codex.sale`, async () => {
    process.env.MIRA_PROVIDER = 'venice'; process.env.VENICE_API_KEY = 'synthetic-venice-key'; process.env.CODEX_SALE_API_KEY = 'synthetic-codex-key';
    let now = 100000, fail = false; const urls: string[] = [];
    const service = new MiraService((async (url: unknown) => {
      urls.push(String(url));
      if (!fail) return completion();
      if (failure === 'http') return new Response('{}', { status: 429 });
      if (failure === 'length') return completion('length');
      return completion('stop', failure === 'invalid-json' ? 'broken' : JSON.stringify({ reply: 'broken' }));
    }) as typeof fetch, undefined, () => now);
    await service.respond('a', 'Люблю джаз'); const before = await service.resume('a'); now += 3000; fail = true;
    await assert.rejects(service.respond('a', 'Не сохраняй ошибку'), (e: unknown) => e instanceof MiraError && e.status === 502);
    assert.deepEqual((await service.resume('a')).turns, before.turns); assert.equal(urls.length, 2);
    assert.ok(urls.every(url => url.startsWith('https://api.venice.ai/')));
    now += 3000; fail = false; assert.equal((await service.respond('a', 'Продолжим')).reply, answer.reply);
  });
}

for (const provider of ['venice', 'unknown-provider']) {
  test(`Missing or invalid ${provider} configuration cannot use the codex credential`, async () => {
    process.env.MIRA_PROVIDER = provider; process.env.CODEX_SALE_API_KEY = 'synthetic-codex-key';
    const service = new MiraService((async () => { assert.fail('Must not contact a provider'); }) as typeof fetch);
    await assert.rejects(service.respond('a', 'Привет'), (e: unknown) => e instanceof MiraError && e.status === 503);
  });
}

test('The selected Venice model can be changed without changing the moderation model', async () => {
  process.env.MIRA_PROVIDER = 'venice'; process.env.VENICE_API_KEY = 'synthetic-venice-key'; process.env.VENICE_NPC_MODEL = 'venice-uncensored-1-2';
  process.env.CODEX_SALE_NPC_MODEL = 'gpt-6-luna';
  const service = new MiraService((async (_url: unknown, options: RequestInit) => {
    assert.equal(JSON.parse(String(options.body)).model, 'venice-uncensored-1-2'); return completion();
  }) as typeof fetch);
  await service.respond('a', 'Привет'); assert.equal(process.env.CODEX_SALE_NPC_MODEL, 'gpt-6-luna');
});
