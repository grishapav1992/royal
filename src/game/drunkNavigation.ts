import { BOUNDS, findPath, walkable, type Obstacle, type Point } from './navigation';
import { getIntoxication } from '../shared/intoxication';
import { HALLS, hallLinks, hallObstacles, type HallId } from '../shared/world';

const floors = new Map<HallId, { obstacles: Obstacle[]; points: Point[] }>();

function safeFloor(hall: HallId) {
  let floor = floors.get(hall);
  if (floor) return floor;
  const obstacles = [...hallObstacles(hall), ...hallLinks(hall).map(({ door }) => ({
    x: door.left, y: door.top, w: door.right - door.left, h: door.bottom - door.top,
  }))];
  const points: Point[] = [];
  for (let y = BOUNDS.top + 35; y <= BOUNDS.bottom - 35; y += 80) {
    for (let x = BOUNDS.left + 35; x <= BOUNDS.right - 35; x += 80) {
      if (walkable(x, y, obstacles, 20)) points.push({ x, y });
    }
  }
  floor = { obstacles, points }; floors.set(hall, floor);
  return floor;
}

/** Floor clicks wander at the strongest stage; deliberate interactions keep their route. */
export function clickMovementPath(
  from: Point & { hall: string; soberAt: number }, clicked: Point, wander: boolean,
  random = Math.random, now = Date.now(),
): Point[] {
  if (!wander || getIntoxication(from.soberAt, now).stage !== 3) return findPath(from, clicked, hallObstacles(from.hall));
  if (!Object.hasOwn(HALLS, from.hall)) return [];
  const { points, obstacles } = safeFloor(from.hall as HallId);
  const sample = random(), start = Math.floor((Number.isFinite(sample) ? Math.max(0, Math.min(1 - Number.EPSILON, sample)) : 0) * points.length);
  for (let offset = 0; offset < points.length; offset++) {
    const target = points[(start + offset) % points.length];
    if (Math.hypot(target.x - clicked.x, target.y - clicked.y) < 140 || Math.hypot(target.x - from.x, target.y - from.y) < 100) continue;
    const path = findPath(from, target, obstacles);
    if (path.length) return path;
  }
  return [];
}
