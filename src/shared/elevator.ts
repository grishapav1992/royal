import { HALLS, HALL_DOORS, isCasinoFloor, type HallId } from './world';

/** Both the picker and scene creation follow the hall registry, including future floors. */
export function elevatorFloors() {
  return (Object.keys(HALLS) as HallId[]).filter(isCasinoFloor).sort((a, b) => HALLS[a].floor - HALLS[b].floor);
}

/** A dock beside the existing staircase, with a separate approach and safe exit. */
export function elevatorDock(hall: HallId) {
  const stairs = HALL_DOORS[hall];
  const x = stairs.entry.x + 160;
  const direction = stairs.facing === 'down' ? 1 : -1;
  return {
    x, y: stairs.entry.y, facing: stairs.facing,
    entry: { x, y: stairs.arrival.y },
    arrival: { x, y: stairs.arrival.y + direction * 50 },
  };
}

export function atElevator(player: { hall: string; x: number; y: number }) {
  if (!Object.hasOwn(HALLS, player.hall) || !isCasinoFloor(player.hall)) return false;
  const { entry } = elevatorDock(player.hall as HallId);
  return Math.hypot(player.x - entry.x, player.y - entry.y) <= 44;
}

export type ElevatorResult = { requestId: number; target: HallId; accepted: boolean; revision?: number; reason?: string };

export function canTravelByElevator(player: {
  hall: string; x: number; y: number; connected?: boolean; playing?: boolean;
  security?: string; seat?: string; cabinet?: string; activity?: string; action?: string;
}, target: unknown): target is HallId {
  return typeof target === 'string' && Object.hasOwn(HALLS, target) && isCasinoFloor(target) && target !== player.hall
    && player.connected !== false && !player.security && !player.playing && !player.cabinet
    && !player.activity && !player.seat && player.action !== 'drink' && atElevator(player);
}
