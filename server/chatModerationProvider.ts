type ProviderName = 'venice' | 'codex-sale';
export type ChatModerationProvider = { name: ProviderName; key: string; model: string; backupModel?: string };
type FailureKind = 'timeout' | 'http' | 'invalid' | 'network';
export class ChatModerationFailure extends Error {
 constructor(readonly kind: FailureKind, readonly status?: number) { super('Chat moderation provider failed'); }
}

export function chatModerationProvider(): ChatModerationProvider | undefined {
 const name = process.env.CHAT_MODERATION_PROVIDER?.trim()
  || (process.env.VENICE_API_KEY?.trim() ? 'venice' : 'codex-sale');
 if (name !== 'venice' && name !== 'codex-sale') throw new Error('Unsupported chat moderation provider');
 const key = (name === 'venice' ? process.env.VENICE_API_KEY : process.env.CODEX_SALE_API_KEY)?.trim();
 if (!key) return;
 const model = process.env.CHAT_MODERATION_MODEL?.trim()
  || (name === 'venice' ? 'qwen3-next-80b' : process.env.CODEX_SALE_NPC_MODEL?.trim() || 'gpt-6-luna');
 const backupModel = name === 'venice' ? (process.env.CHAT_MODERATION_BACKUP_MODEL?.trim() || 'mistral-small-3-2-24b-instruct') : undefined;
 return { name, key, model, ...(backupModel && backupModel !== model ? { backupModel } : {}) };
}

const schema = { type: 'object', properties: { violation: { type: 'boolean' } }, required: ['violation'], additionalProperties: false };

export async function requestChatVerdict(request: typeof fetch, provider: ChatModerationProvider,
 instructions: string, text: string, budgetMs: number): Promise<boolean> {
 const controller = new AbortController();
 let timeout: ReturnType<typeof setTimeout> | undefined;
 const operation = async () => {
  const venice = provider.name === 'venice';
  const response = await request(venice ? 'https://api.venice.ai/api/v1/chat/completions' : 'https://codex.sale/v1/responses', {
   method: 'POST', headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
   body: JSON.stringify(venice ? {
    model: provider.model, messages: [{ role: 'system', content: instructions }, { role: 'user', content: text }],
    max_tokens: 128, temperature: 0, stream: false, store: false,
    response_format: { type: 'json_schema', json_schema: { name: 'chat_moderation', strict: true, schema } },
    venice_parameters: { include_venice_system_prompt: false, enable_web_search: 'off' },
   } : {
    model: provider.model, instructions, input: [{ role: 'user', content: text }],
    reasoning: { effort: 'low' }, max_output_tokens: 256, stream: false, store: false,
    text: { format: { type: 'json_schema', name: 'chat_moderation', strict: true, schema } },
   }),
   signal: controller.signal,
  });
  if (!response.ok) throw new ChatModerationFailure('http', response.status);
  if (Number(response.headers.get('Content-Length')) > 65536) throw new ChatModerationFailure('invalid');
  const body = await response.text();
  if (body.length > 65536) throw new ChatModerationFailure('invalid');
  let output: unknown;
  try {
   const data = JSON.parse(body);
   if (venice) {
    const choice = data.choices?.[0];
    if (choice?.finish_reason !== 'stop' || choice.message?.role !== 'assistant') throw new Error('Incomplete verdict');
    output = choice.message.content;
   } else {
    if (data.status !== 'completed') throw new Error('Incomplete verdict');
    output = data.output?.filter((item: { type?: string; role?: string }) => item.type === 'message' && item.role === 'assistant')
     .flatMap((item: { content?: unknown[] }) => item.content ?? [])
     .filter((item: { type?: string }) => item.type === 'output_text').map((item: { text?: string }) => item.text ?? '').join('');
   }
   if (typeof output !== 'string') throw new Error('Invalid output');
   const verdict = JSON.parse(output.trim());
   if (!verdict || Array.isArray(verdict) || typeof verdict.violation !== 'boolean' || Object.keys(verdict).length !== 1) throw new Error('Invalid verdict');
   return verdict.violation;
  } catch { throw new ChatModerationFailure('invalid'); }
 };
 try {
  return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
   timeout = setTimeout(() => { controller.abort(); reject(new ChatModerationFailure('timeout')); }, Math.max(1, budgetMs));
  })]);
 } catch (error) { throw error instanceof ChatModerationFailure ? error : new ChatModerationFailure('network'); }
 finally { clearTimeout(timeout); controller.abort(); }
}
