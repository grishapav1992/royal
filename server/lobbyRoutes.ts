import { createRouter } from '@colyseus/core';
import { allowedOrigin, cookieToken } from './accounts';
import { lobbyAdmission, SERVER_BUSY, type LobbyAdmission } from './lobbyAdmission';

const methods = new Set(['joinOrCreate', 'create', 'join', 'joinById', 'reconnect']);
const reject = (status: number, error: string) => Response.json({ code: status, error }, {
  status,
  headers: { 'Cache-Control': 'no-store', ...(status === 429 ? { 'Retry-After': '2' } : {}) },
});

export function lobbyRoutes(admission: LobbyAdmission = lobbyAdmission, options: { acceptNewConnections?: boolean; isReady?: () => boolean } = {}) {
  // Framework matchmaking routes run before Express; this hook also precedes JSON parsing.
  return createRouter({}, { onRequest(request) {
    if (request.method !== 'POST') return;
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/matchmake/')) return;
    if (!allowedOrigin(request.headers.get('origin') || undefined)) return reject(403, 'Недопустимый источник подключения.');
    if (options.isReady && !options.isReady()) return reject(503, SERVER_BUSY);
    const method = path.split('/')[2];
    if (options.acceptNewConnections === false && method !== 'reconnect') return reject(403, 'Вход в зал доступен через главный адрес игры.');
    if (!admission.allowMatchmaking()) return reject(429, SERVER_BUSY);
    if (method !== 'reconnect' && !cookieToken(request.headers.get('cookie') || undefined)) return reject(401, 'Сначала войди по почте и паролю.');
    if (!methods.has(method)) return reject(403, 'Недоступный способ подключения.');
  } });
}
