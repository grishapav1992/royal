import type {Request} from 'express';
import {
  DEFAULT_MAX_GAME_STAKE_CENTS, MAX_GAME_STAKE_CENTS, ROYAL_STAKE_LIMIT_HEADER,
  gameBetCents, gameStakeMaximum,
} from '../src/shared/gameStakes';
import {COSMIC_STAKE_LIMIT_HEADER} from '../src/shared/cosmicStakeProtocol';
import {CARAMEL_GAME, CARAMEL_STAKE_LIMIT_HEADER} from '../src/shared/caramelCarnival';

const earlierStakeHeaders = new Map([
  ['studio-cosmic-escape', COSMIC_STAKE_LIMIT_HEADER],
  [CARAMEL_GAME, CARAMEL_STAKE_LIMIT_HEADER],
]);

const legacyHundredDollarStakes = new Set([
  'studio-cosmic-escape', CARAMEL_GAME, 'studio-velvet-reign', 'studio-last-convoy',
  'studio-afterglow', 'studio-nitro-run', 'studio-meme-overload', 'studio-dracona',
  'studio-neopolis', 'studio-forest-heart', 'original-cr-vs-leo', 'original-jackie-chan',
  'studio-flooded-temple', 'github-crash',
]);

export function supportsRoyalStake(req: Request, gameId: string): boolean {
  const earlierHeader = earlierStakeHeaders.get(gameId);
  return req.get(ROYAL_STAKE_LIMIT_HEADER) === '1' || !!earlierHeader && req.get(earlierHeader) === '1';
}

export function extendedRoyalWager(op: unknown): boolean {
  const value = op as {gameId?: unknown; action?: unknown; kind?: unknown; stakeUnits?: unknown; amount?: unknown} | null;
  if (typeof value?.gameId !== 'string' || gameStakeMaximum(value.gameId) !== MAX_GAME_STAKE_CENTS) return false;
  const cents = value.action === 'start' && typeof value.stakeUnits === 'string' && /^[1-9]\d{0,4}$/.test(value.stakeUnits)
    ? Number(value.stakeUnits) : value.kind === 'play' ? gameBetCents(value.amount) : undefined;
  return cents !== undefined && cents > DEFAULT_MAX_GAME_STAKE_CENTS && cents <= MAX_GAME_STAKE_CENTS;
}

// Older bundles validate the entire list, including sessions for games outside the open window.
export function compatibleStakeSessions<T extends {sessions: {gameId: string; stakeUnits: string}[]}>(result: T, req: Request): T {
  if (req.get(ROYAL_STAKE_LIMIT_HEADER) === '1') return result;
  return {...result, sessions: result.sessions.filter(session =>
    !extendedRoyalWager({...session, action: 'start'}) || supportsRoyalStake(req, session.gameId)
    || Number(session.stakeUnits) === MAX_GAME_STAKE_CENTS && legacyHundredDollarStakes.has(session.gameId)
  )};
}
