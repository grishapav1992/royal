import { forestHeartBase, forestHeartBoard, forestHeartFlow, forestHeartHeld, FOREST_HEART_ROTORS } from '../../src/shared/forestHeartMath';
import type { ForestHeartView } from '../../src/shared/forestHeart';

/** Presentation reads only the confirmed public view. It never generates an outcome. */
export function forestScene(view?: ForestHeartView) {
  const base = view ? forestHeartBase(view.base.bits, view.base.ability, view.base.rotation) : undefined;
  const last = view?.bonus.at(-1), bits = last?.bits ?? base?.finalBits ?? 1771;
  const board = forestHeartBoard(bits), flow = forestHeartFlow(board);
  const held = forestHeartHeld(last?.heldState ?? 0);
  return { bits, board, flow, paidMask: last?.receiverMask ?? base?.paidReceiverMask ?? 0,
    energy: last?.energy ?? view?.base.energy ?? 1,
    lockedCells: FOREST_HEART_ROTORS.filter((_, i) => held.mask & (1 << i)),
    totalUnits: view ? Number(view.totalPayoutUnits) : 0 };
}
export function forestRoundTier(payout: number, stake: number) {
  return payout === 0 ? 'loss' : payout < stake ? 'partial' : payout === stake ? 'even' : payout >= stake * 10 ? 'big' : 'win';
}
/** One continuous root from the centre to each actual contact, including edge ports. */
export function rootPaths(mask: number) {
  const arms = [
    'M50 50 C43 33 57 20 50 0', 'M50 50 C66 42 82 57 100 50',
    'M50 50 C57 68 42 82 50 100', 'M50 50 C32 57 18 43 0 50',
  ];
  return arms.filter((_, i) => mask & (1 << i)).join(' ');
}
