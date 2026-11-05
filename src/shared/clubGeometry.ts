// The exterior and navigation grid share a coordinate envelope.
export const WORLD = { width: 5260, height: 1380 };
export const BOUNDS = { left: 70, right: WORLD.width - 70, top: 225, bottom: 1300 };
export const FLOOR = { x: 55, y: 175, width: WORLD.width - 110, height: 1145 };
// Taller visual wall, while floor movement and server coordinates stay stable.
export const HALL_WALL = { top: -100, height: 275, viewTop: -175, doorOffset: -59 } as const;

const HALL_WIDTHS: Readonly<Record<string, number>> = { arcade: 2070, tables: 2110, github: 2080 };
export const hallSize = (hall: string) => ({ width: HALL_WIDTHS[hall] ?? WORLD.width, height: WORLD.height });
export const hallBounds = (hall: string) => ({ ...BOUNDS, right: hallSize(hall).width - BOUNDS.left });
export const hallFloor = (hall: string) => ({ ...FLOOR, width: hallSize(hall).width - 2 * FLOOR.x });

// The shared obstacle list constrains movement, pathfinding and server recovery.
export const hallRightWall = (hall: string) => {
  const x = hallBounds(hall).right + 12;
  return { x, y: 0, w: WORLD.width - x, h: WORLD.height };
};
