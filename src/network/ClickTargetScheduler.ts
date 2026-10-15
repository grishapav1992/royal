export const CLICK_TARGET_INTERVAL_MS = 200;
type Timer = ReturnType<typeof setTimeout>;
type Clock = { now: () => number; later: (callback: () => void, milliseconds: number) => Timer; cancel: (timer: Timer) => void };

/** Keep the latest destination until the server can accept another click route. */
export class ClickTargetScheduler {
  private lastSentAt = -Infinity;
  private pending?: () => void;
  private timer?: Timer;
  constructor(private clock: Clock = { now: () => performance.now(), later: (callback, milliseconds) => setTimeout(callback, milliseconds), cancel: timer => clearTimeout(timer) }) {}
  request(send: () => void) {
    this.cancel(); this.pending = send; this.flush();
  }
  cancel() {
    if (this.timer !== undefined) this.clock.cancel(this.timer);
    this.timer = undefined; this.pending = undefined;
  }
  reset() { this.cancel(); this.lastSentAt = -Infinity; }
  private flush() {
    this.timer = undefined;
    if (!this.pending) return;
    const delay = CLICK_TARGET_INTERVAL_MS - (this.clock.now() - this.lastSentAt);
    if (delay > 0) { this.timer = this.clock.later(() => this.flush(), delay); return; }
    const send = this.pending; this.pending = undefined; this.lastSentAt = this.clock.now(); send();
  }
}
