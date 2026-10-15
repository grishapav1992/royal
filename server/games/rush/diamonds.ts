import { randomInt } from "crypto";

/**
 * Stake-style Diamonds. A 5-card hand of "gem" symbols is dealt. The
 * payout depends on the largest group of matching gems (3-of-a-kind,
 * 4-of-a-kind, 5-of-a-kind). Higher-tier gems pay more per group.
 */

export type Gem = "🟡" | "🟢" | "🔵" | "🟣" | "🟠" | "💎";

export const GEMS: Gem[] = ["🟡", "🟢", "🔵", "🟣", "🟠", "💎"];

const WEIGHTS: Record<Gem, number> = {
  "🟡": 30,
  "🟢": 25,
  "🔵": 20,
  "🟣": 15,
  "🟠": 8,
  "💎": 2,
};

const TIER: Record<Gem, number> = {
  "🟡": 1,
  "🟢": 2,
  "🔵": 3,
  "🟣": 4,
  "🟠": 6,
  "💎": 10,
};

function weightedPick(draw:(max:number)=>number): Gem {
  const total = GEMS.reduce((s, g) => s + WEIGHTS[g], 0);
  let r = draw(total);
  for (const g of GEMS) {
    if (r < WEIGHTS[g]) return g;
    r -= WEIGHTS[g];
  }
  return GEMS[0];
}

export function deal(draw:(max:number)=>number = randomInt): { hand: Gem[]; multiplier: number; cluster?: { gem: Gem; size: number } } {
  const hand: Gem[] = Array.from({ length: 5 }, () => weightedPick(draw));
  // Find largest cluster
  const counts = new Map<Gem, number>();
  for (const g of hand) counts.set(g, (counts.get(g) ?? 0) + 1);
  let best: { gem: Gem; size: number } | undefined;
  for (const [gem, size] of counts) {
    if (size >= 3 && (!best || size > best.size || (size === best.size && TIER[gem] > TIER[best.gem]))) {
      best = { gem, size };
    }
  }
  if (!best) return { hand, multiplier: 0 };
  // payout = tier * (size-2) - 3oak = 1x, 4oak = 2x, 5oak = 3x (times tier)
  const multi = TIER[best.gem] * (best.size - 2);
  return { hand, multiplier: multi, cluster: best };
}
