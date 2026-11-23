import type { ReelView } from '../../templates/slot-primitive/src/view.ts';
import { CARAMEL_GAME } from '../shared/caramelCarnival';
import type { GameHostV1 } from './GameHostContract';
import { createRoyalSlotServices } from './RoyalSlotServices';

export const gameId = CARAMEL_GAME;
export const rulesVersion = 2;

export function createCaramelSlotServices(host: GameHostV1) {
  return createRoyalSlotServices<ReelView>(host, {
    gameId, rulesVersion,
    ordinaryStart: () => ({ caramel: { mode: 'normal' } }),
    freeMoves: () => [{ id: 'caramel-spin' }],
    project(session) {
      const view = session.view.caramel;
      if (!view) return;
      return { revision: view.revision, view: {
        columns: 6,
        symbols: [...(view.spin?.finalGrid ?? [])],
        stages: view.spin?.frames.map(frame => ({
          symbols: [...frame.before], symbolsAfter: [...frame.after],
          highlights: frame.wins.flatMap(win => win.positions), removed: [...frame.removed],
          drops: frame.drops.map(drop => ({ ...drop })), refills: frame.refills.map(refill => ({ ...refill })),
        })),
      } };
    },
  });
}
