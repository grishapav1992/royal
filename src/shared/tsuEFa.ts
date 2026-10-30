export const TSU_E_FA_CHOICES = ['rock', 'scissors', 'paper'] as const;
export type TsuEFaChoice = typeof TSU_E_FA_CHOICES[number];
export type TsuEFaMove = { kind: 'choose'; round: number; choice: TsuEFaChoice };
export type TsuEFaResult = { round: number; choices: [TsuEFaChoice, TsuEFaChoice]; winner: 0 | 1 | null };
export type TsuEFaView = {
  rulesVersion: 1; revision: number; phase: 'playing' | 'finished'; round: number;
  self: 0 | 1; score: [number, number]; target: 2; locked: [boolean, boolean];
  choice: TsuEFaChoice | null; last: TsuEFaResult | null; winner: 0 | 1 | null;
};
export const isTsuEFaChoice = (value: unknown): value is TsuEFaChoice => TSU_E_FA_CHOICES.some(choice => choice === value);
export function tsuEFaWinner(a: TsuEFaChoice, b: TsuEFaChoice): 0 | 1 | null {
  if (a === b) return null;
  return ({ rock: 'scissors', scissors: 'paper', paper: 'rock' })[a] === b ? 0 : 1;
}
