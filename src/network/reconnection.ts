import { MatchMakeError, type Room } from '@colyseus/sdk';
import { LOBBY_MATCHMAKING_TIMEOUT_MS } from '../shared/lobbyConnection';

type Settings = Pick<Room['reconnection'], 'minUptime' | 'minDelay' | 'maxDelay' | 'maxRetries' | 'delay' | 'backoff'>;

export function configureReconnection(settings: Settings, random: () => number = Math.random) {
  settings.minUptime = 0;
  settings.minDelay = 250;
  settings.maxDelay = 3000;
  settings.maxRetries = 20;
  settings.delay = 250;
  settings.backoff = (attempt, initialDelay) => {
    const window = Math.min(settings.maxDelay, initialDelay * 2 ** Math.min(attempt, settings.maxRetries));
    return Math.floor(window / 2 + random() * window / 2);
  };
}

// Matchmaking only. Wallet operations use their own transport and operation IDs.
export async function lobbyMatchmakingFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController(), signal = init?.signal;
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, LOBBY_MATCHMAKING_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    // Keep the deadline active until the small matchmaking body has arrived too.
    await response.clone().arrayBuffer();
    return response;
  }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function matchmakingError(error: unknown): unknown {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (code === 429) return new MatchMakeError('Слишком много подключений. Подожди немного и попробуй снова.', code);
  if (code === 503) return new MatchMakeError('Сервер сейчас занят. Подожди немного и попробуй войти снова.', code);
  return error;
}
