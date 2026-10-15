import type { Room } from '@colyseus/sdk';

const key = 'royal-lobby-recovery';

export function savedSession(accountId: string | undefined, roomId: string | undefined): string | undefined {
  if (!accountId || !roomId) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (saved?.accountId === accountId && saved.roomId === roomId && typeof saved.token === 'string'
      && saved.token.startsWith(roomId + ':') && saved.token.split(':').length === 2) return saved.token;
  } catch { /* Storage may be unavailable in a private browser session. */ }
}

export function rememberSession(room: Pick<Room, 'roomId' | 'reconnectionToken'>, accountId?: string) {
  if (!accountId) return;
  try { sessionStorage.setItem(key, JSON.stringify({ accountId, roomId: room.roomId, token: room.reconnectionToken })); }
  catch { /* A storage failure must not interrupt a live connection. */ }
}

export function forgetSession() {
  try { sessionStorage.removeItem(key); } catch { /* Storage is optional. */ }
}
