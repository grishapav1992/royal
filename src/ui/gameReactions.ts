import type { ExpansionSession } from '../shared/casinoExpansion';

export const GAME_REACTION_EVENT = 'royal-game-reaction';
export type GameReaction = 'win' | 'lose';
export type GameReactionSnapshot = {
  gameId: string; account: string; sessionId: string; active: boolean;
  busy: boolean; pending: boolean; spentUnits: string; returnedUnits: string;
};
type ObservedGame = { account: string; armed: boolean; sessions: Map<string, 'active' | 'done'> };
const observed = new WeakMap<HTMLElement, Map<string, ObservedGame>>();

export function resetGameOutcomes(host: HTMLElement) {
  observed.delete(host);
}

export function emitGameReaction(host: HTMLElement, reaction: GameReaction) {
  host.dispatchEvent(new CustomEvent<{ reaction: GameReaction }>(GAME_REACTION_EVENT, { detail: { reaction }, bubbles: true }));
}

/** Compare the total return with the full stake; returning exactly the stake is neutral. */
export function gameReactionForAmounts(spentUnits: string, returnedUnits: string): GameReaction | undefined {
  if (!/^\d+$/.test(spentUnits) || !/^\d+$/.test(returnedUnits)) return;
  const spent = BigInt(spentUnits), returned = BigInt(returnedUnits);
  if (spent <= 0n || returned === spent) return;
  return returned > spent ? 'win' : 'lose';
}

export function emitGameOutcome(host: HTMLElement, spentUnits: string, returnedUnits: string) {
  const reaction = gameReactionForAmounts(spentUnits, returnedUnits);
  if (reaction) emitGameReaction(host, reaction);
}

/** Saved results establish a baseline. Only an observed party or pending action can react. */
export function observeGameOutcome(host: HTMLElement, snapshot: GameReactionSnapshot) {
  let games = observed.get(host);
  if (!games) { games = new Map(); observed.set(host, games); }
  let game = games.get(snapshot.gameId);
  if (!game || game.account !== snapshot.account) {
    game = { account: snapshot.account, armed: false, sessions: new Map() };
    games.set(snapshot.gameId, game);
  }
  if (snapshot.pending) game.armed = true;
  if (snapshot.busy || snapshot.pending) return;
  if (!snapshot.sessionId) { game.armed = false; return; }
  const prior = game.sessions.get(snapshot.sessionId);
  if (snapshot.active) game.sessions.set(snapshot.sessionId, 'active');
  else {
    game.sessions.set(snapshot.sessionId, 'done');
    if (prior !== 'done' && (prior === 'active' || game.armed)) emitGameOutcome(host, snapshot.spentUnits, snapshot.returnedUnits);
  }
  game.armed = false;
  if (game.sessions.size > 128) game.sessions.delete(game.sessions.keys().next().value!);
}

export function observeExpansionOutcome(host: HTMLElement, gameId: string, session: ExpansionSession | undefined, account: string | null, busy: boolean, pending: boolean) {
  observeGameOutcome(host, { gameId, account: account ?? '', sessionId: session?.id ?? '', active: session?.state === 'active', busy, pending,
    spentUnits: session?.spentUnits ?? '0', returnedUnits: session?.returnedUnits ?? '0' });
}
