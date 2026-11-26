/** Road users: cosmetic dimensions and the mix for each location. Nothing here reads a round. */
export type Model = 'patrol' | 'coupe' | 'sedan' | 'taxi' | 'suv' | 'van' | 'box' | 'container' | 'tanker' | 'bus';
export type Spec = {
 /** Width and length against an ordinary car. */
 wide: number;
 len: number;
 /** Height of a rigid body against its own width. */
 tall: number;
 mass: number;
 /** Tall vehicles are heavy: they sway and lose paint, but they never spin or roll. */
 rigid: boolean;
 pace: readonly [number, number];
 tints: number;
};
const car = (over: Partial<Spec> = {}): Spec => ({ wide: 1, len: .44, tall: .65, mass: 1, rigid: false, pace: [.6, .72], tints: 4, ...over });
export const MODELS: Record<Model, Spec> = {
 patrol: car({ tints: 1 }),
 coupe: car({ pace: [.64, .78] }),
 sedan: car(),
 taxi: car({ tints: 1 }),
 suv: car({ wide: 1.04, mass: 1.35, tints: 3 }),
 van: car({ wide: 1.1, len: .62, tall: 1.08, mass: 2.4, rigid: true, pace: [.58, .68], tints: 3 }),
 box: car({ wide: 1.24, len: 1.15, tall: 1.3, mass: 4, rigid: true, pace: [.54, .62], tints: 3 }),
 container: car({ wide: 1.24, len: 1.6, tall: 1.36, mass: 5, rigid: true, pace: [.52, .6], tints: 2 }),
 tanker: car({ wide: 1.24, len: 1.5, tall: 1.2, mass: 5, rigid: true, pace: [.52, .6], tints: 2 }),
 bus: car({ wide: 1.26, len: 1.6, tall: 1.22, mass: 5, rigid: true, pace: [.54, .62], tints: 2 }),
};
/** Industrial zone, interchange, highway, last exit. */
export const MIX: readonly (readonly Model[])[] = [
 ['container', 'sedan', 'box', 'coupe', 'tanker', 'suv', 'van', 'sedan'],
 ['taxi', 'sedan', 'bus', 'suv', 'van', 'coupe', 'taxi', 'box'],
 ['suv', 'coupe', 'tanker', 'sedan', 'van', 'container', 'coupe', 'bus'],
 ['sedan', 'van', 'suv', 'coupe', 'box', 'taxi', 'bus', 'container'],
];
/** Seconds between two ordinary road users, by the heat of the chase. */
export const GAP = [2.5, 2.3, 2.1] as const;
/** Shuffled deck: one location shows its whole mix before a model repeats. */
export class TrafficDeck {
 private deck: Model[] = [];
 private zone = -1;
 private last?: Model;
 reset() { this.deck = []; this.zone = -1; this.last = undefined; }
 draw(zone: number, r: () => number, light = false): Model {
  if (zone !== this.zone || !this.deck.length) {
   this.zone = zone;
   this.deck = [...MIX[zone] ?? MIX[0]];
   for (let i = this.deck.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
   }
  }
  let at = this.deck.findIndex(m => m !== this.last && !(light && MODELS[m].rigid));
  if (at < 0) {
   const options = (MIX[zone] ?? MIX[0]).filter(m => !MODELS[m].rigid && m !== this.last);
   return this.last = options[Math.floor(r() * options.length)];
  }
  return this.last = this.deck.splice(at, 1)[0];
 }
}
/** A real wheel outruns any display: the visible turn is capped, the rest is shown as blur. */
export const WHEEL_CAP = 15;
export const wheelTurn = (speed: number) => WHEEL_CAP * (1 - Math.exp(-Math.abs(speed) / .3 / WHEEL_CAP)) * Math.sign(speed);
export const wheelBlur = (speed: number) => Math.max(0, Math.min(1, (Math.abs(speed) - 5) / 17));
