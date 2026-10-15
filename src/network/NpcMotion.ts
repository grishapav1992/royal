type Position = { x: number; y: number; hall?: string };
type Frame<T> = { at: number; view: T };
type Options<T> = {
  delayMs?: number;
  teleportDistance?: number;
  now?: () => number;
  isMoving?: (view: T) => boolean;
};

/** Renders a short history of authoritative NPC positions without extrapolating. */
export class NpcMotion<T extends Position> {
  private frames: Frame<T>[] = [];
  private lastReceivedAt = -Infinity;
  private readonly delayMs: number;
  private readonly teleportDistance: number;
  private readonly now: () => number;
  private readonly isMoving?: (view: T) => boolean;

  constructor(options: Options<T> = {}) {
    this.delayMs = Math.max(0, options.delayMs ?? 150);
    this.teleportDistance = Math.max(0, options.teleportDistance ?? 160);
    this.now = options.now ?? (() => performance.now());
    this.isMoving = options.isMoving;
  }

  reset(view?: T, at = this.now()) {
    this.frames = [];
    this.lastReceivedAt = -Infinity;
    if (view) this.push(view, at);
  }

  push(view: T, at = this.now()) {
    if (!Number.isFinite(at) || !Number.isFinite(view.x) || !Number.isFinite(view.y) || at < this.lastReceivedAt) return;
    const previous = this.frames.at(-1);
    if (!previous) {
      this.frames.push({ at, view: { ...view } });
      this.lastReceivedAt = at;
      return;
    }
    if (view.hall !== previous.view.hall || Math.hypot(view.x - previous.view.x, view.y - previous.view.y) > this.teleportDistance) {
      this.reset(view, at);
      return;
    }
    const keys = Object.keys(view) as (keyof T)[];
    const unchanged = keys.length === Object.keys(previous.view).length && keys.every(key => view[key] === previous.view[key]);
    if (unchanged) {
      // Room patches can repeat guests between their less frequent position updates.
      this.lastReceivedAt = at;
      return;
    }
    if (at === previous.at) {
      this.frames[this.frames.length - 1] = { at, view: { ...view } };
      this.lastReceivedAt = at;
      return;
    }
    if (at - previous.at > Math.max(300, this.delayMs * 2)) {
      // A departure after a long hold starts near the new packet, not at the start of the idle period.
      const holdAt = Math.max(previous.at, this.lastReceivedAt, at - Math.max(100, this.delayMs));
      if (holdAt > previous.at && holdAt < at) this.frames.push({ at: holdAt, view: previous.view });
    }
    this.frames.push({ at, view: { ...view } });
    this.lastReceivedAt = at;
    if (this.frames.length > 64) this.frames.splice(0, this.frames.length - 64);
  }

  sample(at = this.now()): T | undefined {
    const renderAt = at - this.delayMs;
    while (this.frames.length > 2 && this.frames[1].at <= renderAt) this.frames.shift();
    const from = this.frames[0];
    if (!from) return;
    const to = this.frames[1];
    if (!to || renderAt <= from.at) return { ...from.view };
    if (renderAt >= to.at) return { ...to.view };
    const amount = (renderAt - from.at) / (to.at - from.at);
    const travels = from.view.x !== to.view.x || from.view.y !== to.view.y;
    // Departure and arrival retain walking metadata throughout the moving segment.
    const discrete = travels && this.isMoving && !this.isMoving(from.view) && this.isMoving(to.view) ? to.view : from.view;
    return {
      ...discrete,
      x: from.view.x + (to.view.x - from.view.x) * amount,
      y: from.view.y + (to.view.y - from.view.y) * amount,
    };
  }
}
