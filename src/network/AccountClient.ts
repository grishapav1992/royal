import type { Account } from '../../server/accounts';

export class AuthRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function requestAuth(path: string, body?: object): Promise<{ account: Account | null }> {
  const response = await fetch(`/api/auth${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json() as { account?: Account | null; error?: string };
  if (!response.ok) {
    throw new AuthRequestError(response.status, result.error || 'Не удалось выполнить запрос.');
  }
  return { account: result.account ?? null };
}
