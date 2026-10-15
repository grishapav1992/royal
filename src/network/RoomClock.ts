export class RoomClock {
  private anchor?: { serverNow: number; monotonicNow: number };

  constructor(private wallNow = () => Date.now(), private monotonicNow = () => performance.now()) {}

  reset() { this.anchor = undefined; }

  snapshot(sample: number) {
    const localNow = this.wallNow(), monotonicNow = this.monotonicNow();
    if (Number.isFinite(sample) && sample > 0 && sample !== this.anchor?.serverNow) {
      this.anchor = { serverNow: sample, monotonicNow };
    }
    const serverNow = this.anchor
      ? this.anchor.serverNow + Math.max(0, monotonicNow - this.anchor.monotonicNow)
      : localNow;
    return { serverNow, localNow };
  }
}
