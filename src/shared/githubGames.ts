import { blackjackScore } from '../vendor/github/blackjack/math';
import * as baccarat from '../vendor/github/baccarat/rules';
import type { Card, CardRank, CardSuit } from '../vendor/github/baccarat/types';
import PokerEngine from '../vendor/github/poker/engine';
import { rankFive } from '../vendor/github/video-poker/math';
export { blackjackScore };
export { VIDEO_NAMES, VIDEO_PAYOUTS, videoRank } from '../vendor/github/video-poker/math';
export type GithubGameId = 'github-blackjack' | 'github-poker' | 'github-video-poker' | 'github-baccarat' | 'github-craps';
export const GITHUB_GAME_IDS: GithubGameId[] = ['github-blackjack', 'github-poker', 'github-video-poker', 'github-baccarat', 'github-craps'];
export const isGithubGame = (value: string): value is GithubGameId => GITHUB_GAME_IDS.includes(value as GithubGameId);
export function randomInt(max: number): number {
  const limit = Math.floor(2 ** 32 / max) * max;
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % max;
}
export function shuffledDeck(joker = false, copies = 1): string[] {
  const cards: string[] = [];
  for (let copy = 0; copy < copies; copy++) for (const rank of 'A23456789TJQK') for (const suit of 'CDHS') cards.push(rank + suit);
  if (joker) cards.push('JJ');
  for (let i = cards.length; i > 1; i--) { const j = randomInt(i); [cards[i - 1], cards[j]] = [cards[j], cards[i - 1]]; }
  return cards;
}
const suits: Record<string, CardSuit> = { C: 'club', D: 'diamond', H: 'heart', S: 'spade' };
const toBaccarat = (card: string): Card => ({ rank: (card[0] === 'T' ? '10' : card[0]) as CardRank, suit: suits[card[1]] });
export function dealBaccarat(deck: string[]) {
  const player = [deck.pop()!, deck.pop()!], banker = [deck.pop()!, deck.pop()!];
  const hand = (cards: string[]) => cards.map(toBaccarat);
  if (!baccarat.isNatural(hand(player)) && !baccarat.isNatural(hand(banker))) {
    if (baccarat.shouldPlayerDraw(hand(player))) player.push(deck.pop()!);
    if (baccarat.shouldBankerDraw(hand(banker), player[2] ? toBaccarat(player[2]) : null)) banker.push(deck.pop()!);
  }
  const playerTotal = baccarat.calculateHandTotal(hand(player)), bankerTotal = baccarat.calculateHandTotal(hand(banker));
  return { player, banker, playerTotal, bankerTotal, result: baccarat.determineResult(playerTotal, bankerTotal) };
}
const poker = Object.create(PokerEngine) as typeof PokerEngine;
poker.init(10, 5, 10, 2);
export function pokerHand(cards: readonly string[]) {
  // Upstream identifies the category. Best-five enumeration fixes duplicate-rank
  // straights and complete kicker comparisons in the original seven-card evaluator.
  let best = { rank: -1, values: [] as number[] };
  for (let a = 0; a < cards.length - 4; a++) for (let b = a + 1; b < cards.length - 3; b++)
    for (let c = b + 1; c < cards.length - 2; c++) for (let d = c + 1; d < cards.length - 1; d++)
      for (let e = d + 1; e < cards.length; e++) {
        const five = [cards[a], cards[b], cards[c], cards[d], cards[e]];
        const upstream = poker.cardsValue(five.map(card => ({ type: 'A23456789TJQK'.indexOf(card[0]) + 1, color: suits[card[1]] })));
        const evaluated = rankFive(five);
        const candidate = { rank: upstream.value === evaluated.rank ? upstream.value : evaluated.rank, values: evaluated.values };
        if (comparePoker(candidate, best) > 0) best = candidate;
      }
  return best;
}
export function comparePoker(a: { rank: number; values: number[] }, b: { rank: number; values: number[] }): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.values.length, b.values.length); i++) if ((a.values[i] ?? 0) !== (b.values[i] ?? 0)) return (a.values[i] ?? 0) - (b.values[i] ?? 0);
  return 0;
}
