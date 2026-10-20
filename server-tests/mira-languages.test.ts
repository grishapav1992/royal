import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MiraService, MiraError } from '../server/mira';
import { miraLanguage, miraText, type MiraLanguage } from '../server/miraLanguages';
import { blankMiraMemory, type MiraMemory } from '../server/miraMemory';

let old: (string | undefined)[];
const variables = ['MIRA_PROVIDER', 'VENICE_API_KEY'];
beforeEach(() => { old = variables.map(name => process.env[name]); process.env.MIRA_PROVIDER = 'venice'; process.env.VENICE_API_KEY = 'synthetic-key'; });
afterEach(() => { variables.forEach((name, i) => { if (old[i] === undefined) delete process.env[name]; else process.env[name] = old[i]; }); });
const languages = Object.keys(miraText) as MiraLanguage[];
const completion = (reply: string, choices: string[]) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ reply, choices, facts: ['Гость любит кислый лимонад'], impression: 'Остроумный гость', tone: 'neutral', endConversation: false, drinkOffer: null, emotion: 'neutral' }) } }] }));

test('Mira resolves every game language, regional tags and weighted browser preferences', () => {
  for (const language of languages) assert.equal(miraLanguage(`${language.toUpperCase()}-XX`), language);
  assert.equal(miraLanguage('ru;q=0.2,en-US;q=0.9'), 'en');
  assert.equal(miraLanguage('fr-FR,en;q=0.8,ru;q=0.5'), 'en');
  for (const header of [undefined, '', 'fr-FR', 'en;q=0', 'en;q=invalid', 'en;q=2', '__proto__', 'constructor']) assert.equal(miraLanguage(header), 'ru');
});

for (const language of languages) {
  test(`Mira ${language} localizes greetings, schema and language rule despite opposite-language history`, async () => {
    let now = Date.parse('2026-10-20T12:00:00Z');
    const other = language === 'ru' ? 'en' : 'ru'; const body: any[] = [];
    const memories = new Map<string, MiraMemory>();
    const store = { read: (id: string) => memories.get(id), write: (id: string, value: MiraMemory) => { memories.set(id, value); }, delete: (id: string) => { memories.delete(id); } };
    const service = new MiraService((async (_url: unknown, options: RequestInit) => {
      body.push(JSON.parse(String(options.body)));
      return completion(language === 'ru' ? 'Кислый лимонад. Помню.' : 'Sour lemonade. I remember.', [...miraText[language].choices]);
    }) as typeof fetch, store, () => now);
    assert.equal((await service.resume('fresh', '', language)).turns.at(-1)?.content, miraText[language].first);
    await service.resume('a', '', other); now += 2100;
    const result = await service.respond('a', other === 'ru' ? 'Я люблю кислый лимонад' : 'I like sour lemonade', language);
    const request = body.at(-1); assert.ok(request.messages[0].content.endsWith(miraText[language].instruction));
    assert.equal(request.messages[1].content, miraText[other].first);
    assert.equal(request.response_format.json_schema.schema.properties.reply.description, miraText[language].replyDescription);
    assert.equal(request.response_format.json_schema.schema.properties.choices.description, miraText[language].choicesDescription);
    assert.deepEqual(result.choices, miraText[language].choices);
    const view = await service.resume('a', '', language); assert.equal(view.turns.at(-1)?.content, result.reply);
    now += 6 * 86400000;
    assert.equal((await service.resume('a', '', language)).turns.at(-1)?.content, miraText[language].absent(6));
    await assert.rejects(service.respond('a', '', language), (e: unknown) => e instanceof MiraError && e.message === miraText[language].input);
  });
}

test('Language changes survive restart and preserve original history, relationship, refusals, repeats, visits and cooldown', async () => {
  let now = Date.parse('2026-10-20T12:00:00Z');
  const original: MiraMemory = { ...blankMiraMemory(), turns: [{ role: 'user', content: 'Я люблю кислый лимонад' }, { role: 'assistant', content: 'Запомню.' }], facts: ['Кислый лимонад'], impression: 'Осторожна после грубости', warmth: -2, strikes: 1, visits: 4, lastSeen: now - 5000, cooldownUntil: now + 45000, alcoholRefused: true, drinkRefused: true, repeats: [{ key: 'как смена', count: 4, at: now }] };
  let saved = structuredClone(original);
  const store = { read: () => structuredClone(saved), write: (_id: string, value: MiraMemory) => { saved = structuredClone(value); }, delete: () => {} };
  let service = new MiraService(fetch, store, () => now);
  const english = await service.resume('a', '', 'en'); assert.equal(english.turns.at(-1)?.content, miraText.en.paused); assert.deepEqual(english.choices, []);
  assert.deepEqual(saved.turns.slice(0, 2), original.turns);
  for (const key of ['facts', 'impression', 'warmth', 'strikes', 'visits', 'cooldownUntil', 'alcoholRefused', 'drinkRefused', 'repeats'] as const) assert.deepEqual(saved[key], original[key], key);
  service = new MiraService(fetch, store, () => now);
  assert.deepEqual(await service.resume('a', '', 'en'), english);
  await assert.rejects(service.respond('a', 'Hello', 'en'), (e: unknown) => e instanceof MiraError && e.message === miraText.en.cooldown(45));
  const russian = await service.resume('a', '', 'ru'); assert.equal(russian.turns.at(-1)?.content, miraText.ru.paused);
  assert.equal(saved.visits, 4); assert.equal(saved.cooldownUntil, original.cooldownUntil);
  now += 46000;
  await service.resume('a', '', 'en'); assert.equal(saved.turns.at(-1)?.content, miraText.en.switched); assert.equal(saved.visits, 4);
});
