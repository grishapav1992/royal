import { HALLS, hallObstacles, type HallId } from './world';
import { walkable, type Point } from '../game/navigation';

export type PlayerRecoveryResult = { requestId: number; accepted: boolean; revision?: number; reason?: string };

/** Choose a clear arrival near this floor's entrance without accepting client coordinates. */
export function playerRecoveryPoint(hall: HallId, occupied: readonly Point[] = []): Point | undefined {
  const spawn = HALLS[hall].spawn, obstacles = hallObstacles(hall);
  for (let radius = 0; radius <= 200; radius += 20) {
    for (let dx = -radius; dx <= radius; dx += 20) {
      for (let dy = -radius; dy <= radius; dy += 20) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const point = { x: spawn.x + dx, y: spawn.y + dy };
        if (walkable(point.x, point.y, obstacles, 16) && occupied.every(other => Math.hypot(point.x-other.x, point.y-other.y) >= 40)) return point;
      }
    }
  }
}
