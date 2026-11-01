export const SESSION_GAMES = ['github-hilo'] as const;
export type SessionGameId = typeof SESSION_GAMES[number];
export type CasinoAsset = 'demo' | 'usdt';
export const HILO_MAX_GUESSES = 2;
export type CasinoAction =
  | { id: string; gameId: SessionGameId; action: 'start'; stakeUnits: string; settings: Record<string, never> }
  | { id: string; gameId: SessionGameId; action: 'pick'; sessionId: string; choice: 'higher' | 'lower' }
  | { id: string; gameId: SessionGameId; action: 'cashout'; sessionId: string };
export type CasinoSession = {
  id: string; gameId: SessionGameId; rulesVersion: 1; state: 'active' | 'lost' | 'cashed_out';
  stakeUnits: string; payoutUnits: string; multiplier: number; steps: number;
  cards?: { rank: number; suit: number }[]; next?: { higher: number | null; lower: number | null };
};
export function isSessionGame(id: unknown): id is SessionGameId { return (SESSION_GAMES as readonly unknown[]).includes(id); }
export function casinoActionKey(op: CasinoAction): string {
  return JSON.stringify(op.action === 'start'
    ? [op.id, op.gameId, op.action, op.stakeUnits, null]
    : op.action === 'pick' ? [op.id, op.gameId, op.action, op.sessionId, op.choice]
    : [op.id, op.gameId, op.action, op.sessionId]);
}
const uuid = (id: unknown) => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
export function validCasinoAction(value: unknown): value is CasinoAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const r = value as CasinoAction;
  if (!uuid(r.id) || !isSessionGame(r.gameId)) return false;
  const keys = Object.keys(r).sort().join(',');
  if (r.action === 'start') {
    if (keys !== 'action,gameId,id,settings,stakeUnits' || typeof r.stakeUnits !== 'string' || !/^[1-9][0-9]{0,15}$/.test(r.stakeUnits)
      || !r.settings || typeof r.settings !== 'object' || Array.isArray(r.settings)) return false;
    return Object.keys(r.settings).length === 0;
  }
  if (!('sessionId' in r) || !uuid(r.sessionId)) return false;
  if (r.action === 'cashout') return keys === 'action,gameId,id,sessionId';
  return r.action === 'pick' && keys === 'action,choice,gameId,id,sessionId' && (r.choice === 'higher' || r.choice === 'lower');
}
export function validCasinoSession(value: unknown): value is CasinoSession {
  const s = value as CasinoSession;
  if (!s || !uuid(s.id) || !isSessionGame(s.gameId) || s.rulesVersion !== 1 || !['active', 'lost', 'cashed_out'].includes(s.state)
    || typeof s.stakeUnits !== 'string' || typeof s.payoutUnits !== 'string'
    || !/^[1-9][0-9]{0,15}$/.test(s.stakeUnits) || !/^(0|[1-9][0-9]{0,21})$/.test(s.payoutUnits)
    || !Number.isFinite(s.multiplier) || s.multiplier < 0 || !Number.isInteger(s.steps) || s.steps < 0) return false;
  const allowed = ['id','gameId','rulesVersion','state','stakeUnits','payoutUnits','multiplier','steps','cards','next'];
  if (Object.keys(s).some(key => !allowed.includes(key))) return false;
  return s.steps <= HILO_MAX_GUESSES && (s.state !== 'active' || s.steps < HILO_MAX_GUESSES)
    && (s.state === 'active' ? !!s.next && Object.keys(s.next).sort().join(',') === 'higher,lower'
      && Object.values(s.next).every(n => n === null || typeof n === 'number' && Number.isFinite(n) && n > 0) : s.next === undefined)
    && Array.isArray(s.cards) && s.cards.length === s.steps + 1
    && s.cards.every(c => !!c && Object.keys(c).sort().join(',') === 'rank,suit' && Number.isInteger(c.rank) && c.rank >= 1 && c.rank <= 13 && Number.isInteger(c.suit) && c.suit >= 0 && c.suit <= 3);
}
