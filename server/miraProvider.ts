import { miraText, type MiraLanguage } from './miraLanguages';
import { DRINKS } from '../src/shared/world';
import type { MiraTurn } from './miraMemory';

type Provider = { name: 'venice' | 'codex-sale'; key: string; model: string };

export function miraProvider(): Provider | undefined {
  const name = process.env.MIRA_PROVIDER?.trim() || 'codex-sale';
  if (name !== 'venice' && name !== 'codex-sale') return;
  const key = (name === 'venice' ? process.env.VENICE_API_KEY : process.env.CODEX_SALE_API_KEY)?.trim();
  if (!key) return;
  const model = name === 'venice'
    ? process.env.VENICE_NPC_MODEL?.trim() || 'venice-uncensored-role-play'
    : process.env.CODEX_SALE_NPC_MODEL?.trim() || 'gpt-6-luna';
  return { name, key, model };
}

const replySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    reply: { type: 'string', minLength: 1, maxLength: 1000, description: 'Прямая речь Миры, обычно одна фраза до 20 слов, без имени и ремарок.' },
    facts: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 160 } },
    impression: { type: 'string', maxLength: 240 },
    tone: { type: 'string', enum: ['neutral', 'interest', 'rude', 'apology', 'confiding'] },
    choices: { type: 'array', maxItems: 3, description: 'Возможные следующие реплики ПОСЕТИТЕЛЯ, обращённые к Мире. Не ответы Миры. Если нет подходящих, верни пустой массив.', items: { type: 'string', maxLength: 70 } },
    endConversation: { type: 'boolean' },
    drinkOffer: { enum: [null, ...DRINKS.map(drink => drink.id)] },
    emotion: { type: 'string', enum: ['neutral', 'smile', 'tease', 'concern'] },
  },
  required: ['reply', 'facts', 'impression', 'tone', 'choices', 'endConversation', 'drinkOffer', 'emotion'],
};

export async function requestMiraReply(request: typeof fetch, provider: Provider, instructions: string, input: MiraTurn[], language: MiraLanguage = 'ru', appearance?: { description: string } | null): Promise<string> {
  const venice = provider.name === 'venice';
  const current = input.at(-1);
  const observedInput = appearance !== undefined && current ? [...input.slice(0, -1), { ...current,
    content: JSON.stringify({ serverObservation: { currentAppearance: appearance }, playerMessage: current.content }) }] : input;
  const response = await request(venice ? 'https://api.venice.ai/api/v1/chat/completions' : 'https://codex.sale/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(venice ? {
      model: provider.model, messages: [{ role: 'system', content: instructions }, ...observedInput],
      max_tokens: 1000, temperature: 0.65, stream: false, store: false,
      response_format: { type: 'json_schema', json_schema: { name: 'mira_reply', strict: true, schema: { ...replySchema, properties: { ...replySchema.properties, reply: { ...replySchema.properties.reply, description: miraText[language].replyDescription }, choices: { ...replySchema.properties.choices, description: miraText[language].choicesDescription } } } } },
      venice_parameters: { include_venice_system_prompt: false, enable_web_search: 'off' },
    } : { model: provider.model, instructions, input: observedInput, max_output_tokens: 1000, stream: false, store: false }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('Mira provider failed');
  if (venice) {
    const data = await response.json() as { choices?: { finish_reason?: string; message?: { role?: string; content?: unknown } }[] };
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== 'stop' || choice.message?.role !== 'assistant' || typeof choice.message.content !== 'string') {
      throw new Error('Incomplete Mira reply');
    }
    return choice.message.content.trim();
  }
  const data = await response.json() as { output?: { type?: string; role?: string; content?: { type?: string; text?: string }[] }[] };
  return data.output?.filter(item => item.type === 'message' && item.role === 'assistant').flatMap(item => item.content ?? [])
    .filter(item => item.type === 'output_text').map(item => item.text ?? '').join('').trim() ?? '';
}
