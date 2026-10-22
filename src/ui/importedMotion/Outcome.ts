export const IMPORTED_MOTION_GAMES = ['royal-fruits', 'royal-dice', 'royal-limbo', 'royal-mines', 'royal-keno', 'github-craps', 'github-tower', 'github-diamonds', 'github-sic-bo'] as const;
export type ImportedMotionGame = typeof IMPORTED_MOTION_GAMES[number];
export type WinTier = 'none' | 'return' | 'win' | 'big' | 'epic';
export type ImportedOutcome = { gameId: string; spentUnits: string; returnedUnits: string; decimals?: 2 | 6; unit?: 'coins' | 'chips' | 'USDT' };
export const IMPORTED_OUTCOME_EVENT = 'royal-imported-confirmed-outcome';
export const isImportedMotionGame = (game: string): game is ImportedMotionGame => (IMPORTED_MOTION_GAMES as readonly string[]).includes(game);

export function importedOutcomeTier(spentUnits: string, returnedUnits: string): WinTier | undefined {
  if (!/^\d{1,24}$/.test(spentUnits) || !/^\d{1,24}$/.test(returnedUnits)) return;
  const stake = BigInt(spentUnits), returned = BigInt(returnedUnits);
  if (stake <= 0n) return;
  if (returned < stake) return 'none';
  if (returned === stake) return 'return';
  return returned >= stake * 20n ? 'epic' : returned >= stake * 5n ? 'big' : 'win';
}

// Called beside the existing reaction only after an owned presentation has landed.
// Restoring a saved result never calls this hook. It owns no wallet or game state.
export function emitImportedOutcome(host: HTMLElement, result: ImportedOutcome): void {
  if (!isImportedMotionGame(result.gameId) || !importedOutcomeTier(result.spentUnits, result.returnedUnits)) return;
  host.dispatchEvent(new CustomEvent<ImportedOutcome>(IMPORTED_OUTCOME_EVENT, { detail: result, bubbles: true }));
}
