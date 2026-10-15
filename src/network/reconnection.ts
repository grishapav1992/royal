import { MatchMakeError, type Room } from '@colyseus/sdk';

type Settings = Pick<Room['reconnection'], 'minUptime' | 'minDelay' | 'maxDelay' | 'maxRetries' | 'delay' | 'backoff'>;

export function configureReconnection(settings: Settings, random: () => number = Math.random) {
  settings.minUptime = 0;
  settings.minDelay = 150;
  settings.maxDelay = 3000;
  settings.maxRetries = 8;
  settings.delay = 250;
  settings.backoff = (attempt, initialDelay) => {
    const window = Math.min(settings.maxDelay, initialDelay * 2 ** Math.min(attempt, settings.maxRetries));
    // Spread retries across the upper half of each bounded window.
    return Math.floor(window / 2 + random() * window / 2);
  };
}

export function matchmakingError(error: unknown): unknown {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (code === 429) return new MatchMakeError('Слишком много подключений. Подожди немного и попробуй снова.', code);
  if (code === 503) return new MatchMakeError('Сервер сейчас занят. Подожди немного и попробуй войти снова.', code);
  return error;
}
