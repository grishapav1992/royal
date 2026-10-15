import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MiraService, MiraError } from '../server/mira';

test('Mira validates input, commits only valid replies, keeps server-owned context and isolates accounts', async () => {
  const previous = process.env.CODEX_SALE_API_KEY; process.env.CODEX_SALE_API_KEY = 'test-only-key';
  const bodies: any[] = []; let fail = false;
  const service = new MiraService((async (_url: unknown, options: RequestInit) => {
    bodies.push(JSON.parse(options.body as string));
    return new Response(JSON.stringify(fail ? { output: [] } : { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ reply: 'Привет!', facts: [], impression: '', tone: 'neutral', choices: [], endConversation: false }) }] }] }), { status: 200 });
  }) as typeof fetch);
  try {
    await assert.rejects(service.reply('a', ''), (error: unknown) => error instanceof MiraError && error.status === 400);
    assert.equal(await service.reply('a', 'Привет'), 'Привет!');
    await assert.rejects(service.reply('a', 'Ещё'), (error: unknown) => error instanceof MiraError && error.status === 429);
    assert.equal(await service.reply('b', 'Привет'), 'Привет!');
    assert.equal(bodies[1].input.length, 1);
    assert.equal(bodies[0].store, false);
    assert.match(bodies[0].instructions, /Первую грубость/);
    fail = true;
    await assert.rejects(service.reply('c', 'Привет'), (error: unknown) => error instanceof MiraError && error.status === 502);
    const states = (service as any).conversations;
    assert.equal(states.get('c').memory.turns.length, 0);
    fail = false; states.get('a').next = 0;
    await service.reply('a', 'Извини'); assert.equal(bodies.at(-1).input.length, 3);
    (await service.reset('a')); states.get('a').next = 0;
    await service.reply('a', 'Заново'); assert.equal(bodies.at(-1).input.length, 1);
    delete process.env.CODEX_SALE_API_KEY;
    await assert.rejects(service.reply('d', 'Привет'), (error: unknown) => error instanceof MiraError && error.status === 503);
  } finally { if (previous === undefined) delete process.env.CODEX_SALE_API_KEY; else process.env.CODEX_SALE_API_KEY = previous; }
});

test('Mira notices normalized repeats beyond recent context, without counting failures or sharing accounts', async () => {
  const previous = process.env.CODEX_SALE_API_KEY; process.env.CODEX_SALE_API_KEY = 'test-only-key';
  const bodies: any[] = []; let fail = false;
  const service = new MiraService((async (_url: unknown, options: RequestInit) => {
    bodies.push(JSON.parse(options.body as string));
    return new Response(JSON.stringify({ output: fail ? [] : [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ reply: 'На кофе держится.', facts: [], impression: '', tone: 'neutral', choices: [], endConversation: false }) }] }] }));
  }) as typeof fetch);
  const ask = async (id: string, message: string) => {
    const state = (service as any).conversations.get(id); if (state) state.next = 0;
    return service.reply(id, message);
  };
  try {
    await ask('a', 'Как твоя смена?');
    fail = true; await assert.rejects(ask('a', 'КАК ТВОЯ СМЕНА!')); fail = false;
    await ask('a', ' как  твоя смена?! ');
    assert.match(bodies.at(-1).instructions, /уже 2-й раз/);
    for (let i = 0; i < 9; i++) await ask('a', `Тема ${i}`);
    await ask('a', 'КАК ТВОЯ СМЕНА.');
    assert.match(bodies.at(-1).instructions, /уже 3-й раз/);
    assert.equal(bodies.at(-1).input.length, 17);
    await ask('b', 'Как твоя смена?');
    assert.doesNotMatch(bodies.at(-1).instructions, /Служебное наблюдение/);
    (await service.reset('a')); await ask('a', 'Как твоя смена?');
    assert.doesNotMatch(bodies.at(-1).instructions, /Служебное наблюдение/);
  } finally { if (previous === undefined) delete process.env.CODEX_SALE_API_KEY; else process.env.CODEX_SALE_API_KEY = previous; }
});
