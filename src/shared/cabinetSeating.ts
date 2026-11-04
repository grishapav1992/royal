import type { Cabinet } from './cabinets';
import { isCardGame, cardTableSeat, cardTableApproach } from './cardTables';
import { BOUNDS } from './clubGeometry';

export type GameReaction = 'win' | 'lose';
export type CabinetPlayResult = { id: string; requestId: number; accepted: boolean; reason?: string };

/** Shared ground anchors keep the stool, approach route and server seat aligned. */
export const cabinetSeat = (cabinet: Pick<Cabinet, 'x' | 'y'> & Partial<Pick<Cabinet, 'id'>>) => {
  // Keep the player beside the front rail, clear of the next row's dealer.
  if (isCardGame(cabinet.id)) return { ...cardTableSeat(cabinet), entry: cardTableApproach(cabinet) };
  return {
    x: cabinet.x, y: cabinet.y + 43,
    // The Diamonds aisle has a planter in front, so approach its stool from the right.
    entry: { x: cabinet.x + (cabinet.id === 'github-diamonds' ? 48 : 0), y: Math.min(cabinet.y + 65, BOUNDS.bottom) },
  };
};
