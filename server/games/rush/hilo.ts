import { randomInt } from "crypto";

/**
 * Hilo - guess whether the next card has a higher or lower RANK than the
 * current card. Ranks are 1..13 (Ace low). Suit is cosmetic.
 *
 * - "higher" wins when next rank > current rank.
 * - "lower"  wins when next rank < current rank.
 * - Same rank is a push (treated here as a loss for simplicity, like Stake).
 *
 * The cumulative multiplier compounds with the inverse of each correct
 * guess's true probability, then 0.99 RTP is folded in at cashout.
 */

export const RANKS = 13;
const RTP = 0.99;

export type Suit = "♠" | "♥" | "♦" | "♣";
export type Card = { rank: number; suit: Suit };
export type Direction = "higher" | "lower";

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];

export function drawCard(): Card {
  return {
    rank: randomInt(1, RANKS + 1),
    suit: SUITS[randomInt(0, SUITS.length)],
  };
}

/**
 * Probability that the next card's rank is STRICTLY higher / lower than
 * the current card's rank. Used to compute payout multipliers.
 */
export function probabilityOf(direction: Direction, currentRank: number): number {
  if (direction === "higher") {
    // ranks strictly > currentRank, out of 13 total
    return (RANKS - currentRank) / RANKS;
  }
  return (currentRank - 1) / RANKS;
}

/**
 * Per-step multiplier (before RTP) for a correct guess. Equals
 * 1 / probabilityOf(direction, currentRank). If probability is 0 (e.g.
 * "higher" on a king), this is +Infinity; caller is expected to disable
 * that direction in the UI.
 */
export function stepMultiplier(direction: Direction, currentRank: number): number {
  const p = probabilityOf(direction, currentRank);
  if (p === 0) return Infinity;
  return 1 / p;
}

/** Cumulative multiplier folded with the RTP house edge for cashout. */
export function withRtp(rawMultiplier: number): number {
  return rawMultiplier * RTP;
}
