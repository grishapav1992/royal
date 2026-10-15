type Options = {
  initialDelayMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  jitterMarginMs?: number;
  now?: () => number;
};

/** Maps authoritative room timestamps onto one buffered, monotonic render clock. */
export class NpcTimeline {
  private readonly initialDelayMs: number;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly jitterMarginMs: number;
  private readonly now: () => number;
  private offsets: { at: number; offset: number }[] = [];
  private offsetMs?: number;
  private delayMs: number;
  private latestServerAt?: number;
  private latestArrivalAt = -Infinity;
  private renderAt?: number;
  private renderedAt?: number;

  constructor(options: Options = {}) {
    this.minDelayMs = Math.max(0, options.minDelayMs ?? 350);
    this.maxDelayMs = Math.max(this.minDelayMs, options.maxDelayMs ?? 650);
    this.initialDelayMs = Math.min(this.maxDelayMs, Math.max(this.minDelayMs, options.initialDelayMs ?? 400));
    this.jitterMarginMs = Math.max(0, options.jitterMarginMs ?? 200);
    this.delayMs = this.initialDelayMs;
    this.now = options.now ?? (() => performance.now());
  }

  reset() {
    this.offsets = [];
    this.offsetMs = undefined;
    this.delayMs = this.initialDelayMs;
    this.latestServerAt = undefined;
    this.latestArrivalAt = -Infinity;
    this.renderAt = this.renderedAt = undefined;
  }

  receive(serverAt: number, arrivalAt = this.now()) {
    if (!Number.isFinite(serverAt) || !Number.isFinite(arrivalAt) || arrivalAt < this.latestArrivalAt || (this.latestServerAt !== undefined && serverAt < this.latestServerAt)) return;
    const offset = arrivalAt - serverAt;
    this.offsets.push({ at: arrivalAt, offset });
    while (this.offsets.length > 1 && (this.offsets[0].at < arrivalAt - 10000 || this.offsets.length > 256)) this.offsets.shift();
    const minimum = Math.min(...this.offsets.map(sample => sample.offset));
    const maximum = Math.max(...this.offsets.map(sample => sample.offset));
    this.offsetMs = minimum;
    if (this.offsets.length >= 5) this.delayMs = Math.min(this.maxDelayMs, Math.max(this.minDelayMs, maximum - minimum + this.jitterMarginMs));
    this.latestServerAt = serverAt;
    this.latestArrivalAt = arrivalAt;
    if (this.renderAt === undefined) {
      this.renderAt = serverAt - this.delayMs;
      this.renderedAt = arrivalAt;
    }
  }

  renderTime(arrivalNow = this.now(), latestSampleAt?: number): number | undefined {
    if (this.renderAt === undefined || this.renderedAt === undefined || this.offsetMs === undefined || this.latestServerAt === undefined) return;
    if (!Number.isFinite(arrivalNow) || arrivalNow <= this.renderedAt) return this.renderAt;
    const latestRenderableAt = latestSampleAt !== undefined && Number.isFinite(latestSampleAt)
      ? Math.min(this.latestServerAt, latestSampleAt) : this.latestServerAt;
    const target = arrivalNow - this.offsetMs - this.delayMs;
    if (arrivalNow - this.renderedAt > 1000) {
      // A suspended tab can receive packets while its render history expires.
      // Resume at the buffered present instead of replaying discarded history.
      this.renderAt = Math.max(this.renderAt, Math.min(latestRenderableAt, target));
      this.renderedAt = arrivalNow;
      return this.renderAt;
    }
    const elapsed = Math.min(100, arrivalNow - this.renderedAt);
    const error = target - (this.renderAt + elapsed);
    // Buffer and offset changes adjust playback speed instead of rewinding or skipping history.
    const rate = Math.min(1.1, Math.max(.9, 1 + error / 1000));
    this.renderAt = Math.max(this.renderAt, Math.min(latestRenderableAt, this.renderAt + elapsed * rate));
    this.renderedAt = arrivalNow;
    return this.renderAt;
  }

  getState() {
    return { delayMs: this.delayMs, offsetMs: this.offsetMs, renderAt: this.renderAt, latestServerAt: this.latestServerAt };
  }
}
