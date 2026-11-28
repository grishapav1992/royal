import type { Obstacle } from '../game/navigation';

/**
 * How a player may cross an obstacle with a leap. Walls, columns, counters and
 * large fixtures stay solid. Guards never leap, so they always walk around.
 */
export type ObstacleKind = 'solid' | 'vault' | 'under';

const kinds = new WeakMap<Obstacle, ObstacleKind>();

/** Low furniture and arcade cabinets that a jump clears. */
export const vault = <T extends Obstacle>(obstacle: T): T => { kinds.set(obstacle, 'vault'); return obstacle; };
/** Tables that a slide passes beneath. */
export const under = <T extends Obstacle>(obstacle: T): T => { kinds.set(obstacle, 'under'); return obstacle; };
export const obstacleKind = (obstacle: Obstacle): ObstacleKind => kinds.get(obstacle) ?? 'solid';
