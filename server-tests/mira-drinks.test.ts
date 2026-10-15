import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MiraService } from '../server/mira';
import { MAX_SOBER_TIME_MS } from '../src/shared/intoxication';
import type { MiraMemory, MiraMemoryRepository } from '../server/miraMemory';

test('Mira receives server sobriety, validates offers and emotions, and never consumes a drink through dialogue', async () => {
  const previous = process.env.CODEX_SALE_API_KEY; process.env.CODEX_SALE_API_KEY = 'test-only-key';
  let now = 1800000000000, offer: unknown = 'wine', emotion: unknown = 'tease';
  const bodies: any[] = [];
  const drinking = { soberAt: now + MAX_SOBER_TIME_MS, lastDrink: 'whisky', lastDrinkAt: now };
  const service = new MiraService((async (_url: unknown, options: RequestInit) => {
    bodies.push(JSON.parse(String(options.body)));
    return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({
      reply: 'Как насчёт вина?', facts: [], impression: '', tone: 'interest', choices: [], endConversation: false, drinkOffer: offer, emotion,
    }) }] }] }));
  }) as typeof fetch, undefined, () => now, () => drinking);
  try {
    const result = await service.respond('a', 'Что посоветуешь?');
    assert.equal(result.drinkOffer, 'wine'); assert.equal(result.emotion, 'tease');
    assert.match(bodies[0].instructions, /Сильное опьянение/); assert.match(bodies[0].instructions, /Виски/);
    assert.deepEqual(drinking, { soberAt: now + MAX_SOBER_TIME_MS, lastDrink: 'whisky', lastDrinkAt: now });
    assert.equal((await service.resume('a')).drinkOffer, 'wine');
    now += 2100;
    assert.equal((await service.respond('a', 'А джаз любишь?')).drinkOffer, null);
    now += 2100;
    assert.equal((await service.respond('a', 'Не хочу пить, больше не предлагай.')).drinkOffer, null);
    now += 120000;
    assert.equal((await service.respond('a', 'Расскажи про смену')).drinkOffer, null);
    assert.match(bodies.at(-1).instructions, /Сейчас не предлагай напитки/);
    now += 2100;
    assert.equal((await service.respond('a', 'Налей вино')).drinkOffer, 'wine');
    now += 2100; offer = 'imaginary'; emotion = 'invented';
    const invalid = await service.respond('a', 'Хочу выпить');
    assert.equal(invalid.drinkOffer, null); assert.equal(invalid.emotion, 'smile');
  } finally { if (previous === undefined) delete process.env.CODEX_SALE_API_KEY; else process.env.CODEX_SALE_API_KEY = previous; }
});

test('Mira scopes refusal to drinks and preserves alcohol exclusion through soft orders and service restarts', async () => {
  const previous = process.env.CODEX_SALE_API_KEY; process.env.CODEX_SALE_API_KEY = 'test-only-key';
  const memories = new Map<string, MiraMemory>();
  const repository: MiraMemoryRepository = {
    read: id => memories.has(id) ? structuredClone(memories.get(id)!) : undefined,
    write: (id, memory) => { memories.set(id, structuredClone(memory)); },
    delete: id => { memories.delete(id); },
  };
  let now = 1800000000000, offer = 'whisky';
  const bodies: any[] = [];
  const request = (async (_url: unknown, options: RequestInit) => {
    bodies.push(JSON.parse(String(options.body)));
    return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({
      reply: 'Выбирай напиток.', facts: [], impression: '', tone: 'neutral', choices: [], endConversation: false, drinkOffer: offer,
    }) }] }] }));
  }) as typeof fetch;
  let service = new MiraService(request, repository, () => now);
  const ask = (id: string, message: string) => { now += 120000; return service.respond(id, message); };
  try {
    assert.equal((await ask('a', 'Не хочу играть, налей виски')).drinkOffer, 'whisky');
    offer = 'wine';
    assert.equal((await ask('a', 'Не пью алкоголь')).drinkOffer, null);
    assert.equal(memories.get('a')!.alcoholRefused, true);
    assert.equal(memories.get('a')!.drinkRefused, false);
    service = new MiraService(request, repository, () => now);
    offer = 'lemonade';
    assert.equal((await ask('a', 'Давай лимонад')).drinkOffer, 'lemonade');
    assert.equal(memories.get('a')!.alcoholRefused, true);
    service = new MiraService(request, repository, () => now);
    offer = 'wine';
    assert.equal((await ask('a', 'Расскажи про джаз')).drinkOffer, null);
    assert.match(bodies.at(-1).instructions, /Гость отказался от алкоголя/);
    offer = 'whisky';
    assert.equal((await ask('a', 'Налей виски')).drinkOffer, 'whisky');
    assert.equal(memories.get('a')!.alcoholRefused, false);
    assert.equal((await ask('b', 'Не хочу играть')).drinkOffer, 'whisky', 'unrelated refusal does not ban drinks');
    assert.equal((await ask('b', 'Не хочу')).drinkOffer, null, 'a short refusal answers the current offer');
    assert.equal((await ask('b', 'Хочу поговорить о музыке')).drinkOffer, null);
    assert.equal((await ask('b', 'Не хочу выпить')).drinkOffer, null, 'a negated request cannot clear a refusal');
    offer = 'whisky';
    assert.equal((await ask('c', 'Не предлагай алкоголь')).drinkOffer, null);
    assert.equal(memories.get('c')!.alcoholRefused, true);
    assert.equal((await ask('c', 'Хочу виноградный сок')).drinkOffer, null);
    assert.equal(memories.get('c')!.alcoholRefused, true, 'grape juice does not count as wine');
    offer = 'lemonade';
    assert.equal((await ask('c', 'Хочу выпить лимонад')).drinkOffer, 'lemonade');
    assert.equal(memories.get('c')!.alcoholRefused, true, 'a soft drink request does not cancel alcohol refusal');
    offer = 'wine';
    assert.equal((await ask('c', 'Хочу выпить')).drinkOffer, null, 'an unspecified drink does not override alcohol refusal');
    assert.equal((await ask('c', 'Как прошла смена?')).drinkOffer, null);
    assert.equal((await ask('c', 'Давай вино')).drinkOffer, 'wine');
  } finally { if (previous === undefined) delete process.env.CODEX_SALE_API_KEY; else process.env.CODEX_SALE_API_KEY = previous; }
});
