export type Point = { x: number; y: number };
export type Obstacle = { x: number; y: number; w: number; h: number };
import { WORLD, BOUNDS } from '../shared/clubGeometry';
export { WORLD, BOUNDS };
export function walkable(x: number, y: number, obstacles: Obstacle[], radius = 12): boolean {
  return x >= BOUNDS.left && x <= BOUNDS.right && y >= BOUNDS.top && y <= BOUNDS.bottom &&
    !obstacles.some(o => x > o.x - radius && x < o.x + o.w + radius && y > o.y - radius && y < o.y + o.h + radius);
}
type SearchNode = Point & { cost: number; priority: number };
class SearchQueue {
  private nodes: SearchNode[] = [];
  get length() { return this.nodes.length; }
  push(node: SearchNode) {
    this.nodes.push(node); let index = this.nodes.length - 1;
    while (index > 0) { const parent = (index - 1) >> 1; if (this.nodes[parent].priority <= node.priority) break; this.nodes[index] = this.nodes[parent]; index = parent; }
    this.nodes[index] = node;
  }
  pop(): SearchNode {
    const first = this.nodes[0], last = this.nodes.pop()!;
    if (this.nodes.length) {
      let index = 0;
      while (index * 2 + 1 < this.nodes.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.nodes.length && this.nodes[child + 1].priority < this.nodes[child].priority) child++;
        if (last.priority <= this.nodes[child].priority) break;
        this.nodes[index] = this.nodes[child]; index = child;
      }
      this.nodes[index] = last;
    }
    return first;
  }
}
export function findPath(from: Point, to: Point, obstacles: Obstacle[]): Point[] {
  const step = 20;
  const key = (p: Point) => p.x + ',' + p.y;
  const snap = (p: Point) => ({
    x: Math.max(Math.ceil(BOUNDS.left / step) * step, Math.min(Math.floor(BOUNDS.right / step) * step, Math.round(p.x / step) * step)),
    y: Math.max(Math.ceil(BOUNDS.top / step) * step, Math.min(Math.floor(BOUNDS.bottom / step) * step, Math.round(p.y / step) * step)),
  });
  const start = snap(from), goal = snap(to);
  if (!walkable(to.x, to.y, obstacles) || !walkable(goal.x, goal.y, obstacles)) return [];
  const heuristic = (point: Point) => Math.abs(point.x - goal.x) + Math.abs(point.y - goal.y);
  const open = new SearchQueue(); open.push({ ...start, cost: 0, priority: heuristic(start) });
  const parents = new Map<string, Point>(), costs = new Map<string, number>([[key(start), 0]]), closed = new Set<string>();
  const maxNodes = Math.ceil((BOUNDS.right - BOUNDS.left) / step + 1) * Math.ceil((BOUNDS.bottom - BOUNDS.top) / step + 1);
  while (open.length && closed.size <= maxNodes) {
    const current = open.pop(), currentKey = key(current);
    if (closed.has(currentKey) || current.cost !== costs.get(currentKey)) continue;
    if (currentKey === key(goal)) {
      const result = [to]; let cursor: Point = current;
      while (key(cursor) !== key(start)) { result.unshift({ x: cursor.x, y: cursor.y }); cursor = parents.get(key(cursor))!; }
      return result;
    }
    closed.add(currentKey);
    for (const [dx, dy] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
      const next = { x: current.x + dx, y: current.y + dy }, nextKey = key(next);
      if (!walkable(next.x, next.y, obstacles, 16) || closed.has(nextKey)) continue;
      const cost = current.cost + step;
      if (cost < (costs.get(nextKey) ?? Infinity)) {
        parents.set(nextKey, current); costs.set(nextKey, cost);
        open.push({ ...next, cost, priority: cost + heuristic(next) });
      }
    }
  }
  return [];
}
