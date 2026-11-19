import type { Account } from '../../server/accounts';

export class AuthRequestError extends Error {
  constructor(
    readonly status: number, message: string, readonly code?: string,
    readonly canRecover = false, readonly retryIn = 0,
  ) {
    super(message);
  }
}

type AuthResponse = { account?: Account | null; error?: string; code?: string; canRecover?: boolean; resetToken?: string };

async function authRequest(path: string, body?: object): Promise<AuthResponse> {
  const response = await fetch(`/api/auth${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json() as AuthResponse;
  if (!response.ok) {
    throw new AuthRequestError(response.status, result.error || 'Не удалось выполнить запрос.',
      result.code, result.canRecover, Number(response.headers.get('Retry-After')) || 0);
  }
  return result;
}

export async function requestAuth(path: string, body?: object): Promise<{ account: Account | null }> {
  return { account: (await authRequest(path, body)).account ?? null };
}

export function requestPasswordRecovery(step: '/request' | '/verify' | '/reset', body: object) {
  return authRequest('/recovery' + step, body);
}
