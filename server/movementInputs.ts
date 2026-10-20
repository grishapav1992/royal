import { applyMovementInput, type MovementBody, type MovementInput } from '../src/shared/movement';
import type { GuardCollider } from '../src/shared/guardCollision';
import { MAX_MOVEMENT_BATCH, MAX_MOVEMENT_INPUT_MS, MAX_PENDING_MOVEMENT_INPUTS, MAX_QUEUED_MOVEMENT_MS } from '../src/shared/movementLimits';

export class MovementInputs {
  private budget = 100;
  private at: number;
  private received = 0;
  private pending: MovementInput[] = [];
  private pendingMs = 0;
  sequence = 0;
  constructor(now = Date.now()) { this.at = now; }
  takeDuration(ms: number, now = Date.now()) {
    this.refill(now);
    const duration = Math.min(ms, this.budget); this.budget -= duration;
    return duration;
  }
  private refill(now: number) {
    this.budget = Math.min(100, this.budget + Math.max(0, now-this.at)); this.at = Math.max(this.at, now);
  }
  get pendingCount() { return this.pending.length; }
  cancel() {
    this.pending = []; this.pendingMs = 0; this.sequence = this.received;
  }
  advance(body: MovementBody, now = Date.now(), guards:readonly GuardCollider[] = [], onContact=()=>{}) {
    this.refill(now);
    while (this.pending.length) {
      const input = this.pending[0];
      // Acknowledge only complete steps so replay never loses movement during a network burst.
      if (input.ms > this.budget) break;
      this.pending.shift(); this.pendingMs -= input.ms; this.budget -= input.ms;
      this.sequence = input.seq;
      if (applyMovementInput(body, input, guards)) onContact();
      if ((body as MovementBody & {security?:string}).security) { this.cancel(); break; }
    }
  }
  accept(body: MovementBody, data: unknown, now = Date.now(), guards:readonly GuardCollider[] = [], onContact=()=>{}) {
    if (!Array.isArray(data) || data.length > MAX_MOVEMENT_BATCH) return false;
    let accepted = false;
    for (const value of data) {
      if (!value || typeof value !== 'object') continue;
      const { seq, x, y, ms, sprint, directions } = value as MovementInput;
      if (sprint !== undefined && typeof sprint !== 'boolean') continue;
      if (!Number.isSafeInteger(seq) || seq <= this.received || ![-1,0,1].includes(x) || ![-1,0,1].includes(y) || !Number.isFinite(ms) || ms < 0 || ms > MAX_MOVEMENT_INPUT_MS) continue;
      if (directions !== undefined && (!Number.isInteger(directions) || directions < 0 || directions > 15
        || x !== Number(Boolean(directions & 2)) - Number(Boolean(directions & 8))
        || y !== Number(Boolean(directions & 4)) - Number(Boolean(directions & 1)))) continue;
      // Bound queued work as well as the existing per-packet and elapsed-time limits.
      if (this.pending.length >= MAX_PENDING_MOVEMENT_INPUTS || this.pendingMs + ms > MAX_QUEUED_MOVEMENT_MS) break;
      this.received = seq;
      this.pending.push({ seq, x, y, ms, sprint, ...(directions === undefined ? {} : { directions }) }); this.pendingMs += ms;
      accepted = true;
    }
    if (accepted) this.advance(body, now, guards, onContact);
    return accepted;
  }
}
