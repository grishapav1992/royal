// Подтверждённые снимки раундов. Только отображение: расчёты и правила не переносятся.
import { assetUrl } from "./media";
export const symbolSrc = (s: number) => assetUrl(`symbol-${s}.webp`);
export const SYMBOL_NAMES = ["Энергетический клинок", "Куб знаний", "Звёздный компас", "Реликтовая маска", "Космический кристалл", "Медальон", "Башня WILD", "Портал SCATTER"];

export type LineWin = [number, number, number, number[]];
export type Nudge = [number, number, number[][], number];
export interface Fixture { rows: number[]; pre: number[]; lines: LineWin[]; nudges: Nudge[]; points: number }

export const FIXTURES = {"initial":{"rows":[2,1,4,1,4,1,2,2,1,0,3,3,0,1,2],"pre":[2,1,4,1,4,1,2,2,1,0,3,3,0,1,2],"lines":[[10,3,10,[0,1,1]]],"nudges":[],"points":10},"zero":{"rows":[2,0,0,0,1,7,0,3,1,2,4,2,0,0,4],"pre":[2,0,0,0,1,7,0,3,1,2,4,2,0,0,4],"lines":[],"nudges":[],"points":0},"two":{"rows":[0,1,7,0,3,5,7,3,2,2,0,0,3,1,2],"pre":[0,1,7,0,3,5,7,3,2,2,0,0,3,1,2],"lines":[],"nudges":[],"points":0},"nudge":{"rows":[2,3,1,6,0,2,0,4,6,0,0,1,1,6,3],"pre":[2,3,1,6,0,2,0,4,2,0,0,1,1,2,3],"lines":[],"nudges":[[3,-1,[[6,2,2],[6,6,2],[6,6,6]],3]],"points":0},"partial":{"rows":[1,0,0,0,3,0,2,1,0,1,0,0,4,7,2],"pre":[1,0,0,0,3,0,2,1,0,1,0,0,4,7,2],"lines":[[8,4,20,[1,0,0,0]]],"nudges":[],"points":20},"bonus":{"rows":[4,1,3,1,0,7,0,1,2,0,1,3,7,0,7],"pre":[4,1,3,1,0,7,0,1,2,0,1,3,7,0,7],"lines":[],"nudges":[],"points":0},"even":{"rows":[6,2,3,1,1,6,1,2,4,0,6,2,0,4,1],"pre":[2,2,3,1,1,6,1,2,4,0,6,2,0,4,1],"lines":[[6,3,20,[0,0,1]],[7,3,20,[2,2,1]],[12,3,20,[1,0,1]],[13,3,20,[1,2,1]],[20,3,20,[0,2,1]]],"nudges":[[0,1,[[2,6,6],[6,6,6]],2]],"points":100},"multi":{"rows":[3,6,0,6,1,0,6,1,6,4,2,6,4,6,2],"pre":[3,0,0,3,1,0,6,1,0,4,2,6,4,6,2],"lines":[[8,4,80,[1,0,0,0]],[16,4,80,[1,1,0,1]]],"nudges":[[1,1,[[0,6,6],[6,6,6]],2],[3,1,[[3,0,6],[0,6,6],[6,6,6]],3]],"points":160},"large":{"rows":[0,6,1,6,0,1,6,1,6,1,1,6,2,6,1],"pre":[0,0,1,0,0,1,0,1,6,1,1,6,2,6,1],"lines":[[1,5,308,[1,1,1,1,1]],[5,5,308,[2,1,0,1,2]],[7,4,104,[2,2,1,0]],[8,5,308,[1,0,0,0,1]],[11,5,308,[2,1,1,1,2]],[12,5,308,[1,0,1,2,1]],[13,5,308,[1,2,1,0,1]],[16,5,308,[1,1,0,1,1]]],"nudges":[[1,1,[[0,0,6],[0,6,6],[6,6,6]],3],[3,1,[[0,6,6],[6,6,6]],2]],"points":2260}} as const satisfies Record<string, Fixture>;
export type FixtureKey = keyof typeof FIXTURES;

export const STAKE_CENTS = 10;
export const START_BALANCE_CENTS = 10000;
/** Порог крупного итога: только для демонстрации на стенде. */
export const LARGE_MULTIPLIER = 20;

export const payoutCents = (f: Fixture) => f.points / 10;
export type Outcome = "none" | "partial" | "return" | "positive" | "large";
/** Класс исхода по подтверждённой выплате относительно полной исходной ставки. */
export function classify(payout: number, stake: number = STAKE_CENTS): Outcome {
  if (payout <= 0) return "none";
  if (payout < stake) return "partial";
  if (payout === stake) return "return";
  if (payout >= stake * LARGE_MULTIPLIER) return "large";
  return "positive";
}

export const column = (cells: readonly number[], c: number) => [cells[c]!, cells[5 + c]!, cells[10 + c]!];
export const formatMoney = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

export const HEROES = [
  { id: "lyra", side: "light", name: "Лира Восс" },
  { id: "aeliri", side: "light", name: "Аэлири" },
  { id: "vespera", side: "dark", name: "Дарт Веспера" },
  { id: "nyxara", side: "dark", name: "Дарт Никсара" },
] as const;
export type HeroId = (typeof HEROES)[number]["id"];
export type Side = "light" | "dark";
