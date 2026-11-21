export const COSMIC_GAME = 'studio-cosmic-escape';
export const COSMIC_RULES = 2;
export const COSMIC_FREE_SPIN = 'luelon-spin';
export const COSMIC_COLUMNS = 5;
export const COSMIC_ROWS = 3;
export const COSMIC_LINES = 20;

export type CosmicFrame = Readonly<{
  symbols: readonly number[];
  highlights: readonly number[];
  line: readonly number[];
  cue?: 'expand' | 'echo';
}>;

export type CosmicView = Readonly<{
  frames: readonly CosmicFrame[];
  portals: number;
  energy: number;
  series: Readonly<{ awarded: number; played: number; remaining: number }> | null;
  accumulatedCents: string;
}>;
