/** A complete stride advances with distance, including interpolated online movement. */
export class CatWalkCycle {
  private phase = 0;
  private previous?: { x: number; y: number };
  private walking = false;
  update(position: { x: number; y: number }, walking: boolean, snap = false): number {
    const distance = this.previous ? Math.hypot(position.x-this.previous.x,position.y-this.previous.y) : 0;
    this.previous = { x: position.x, y: position.y };
    if (!walking || !this.walking || snap || distance > 120) this.phase = 0;
    else this.phase = (this.phase + distance / 48) % 1;
    this.walking = walking;
    return Math.floor(this.phase * 8);
  }
}
