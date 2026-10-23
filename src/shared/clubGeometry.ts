// All three floors share their physical scale with the server.
export const WORLD = { width: 5260, height: 1380 };
export const BOUNDS = { left: 70, right: WORLD.width - 70, top: 225, bottom: 1300 };
export const FLOOR = { x: 55, y: 175, width: WORLD.width - 110, height: 1145 };
// Taller visual wall, while floor movement and server coordinates stay stable.
export const HALL_WALL = { top: -100, height: 275, viewTop: -175, doorOffset: -59 } as const;
