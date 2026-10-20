import { applyMovementInput, type MovementBody, type MovementInput } from '../shared/movement';
import type { GuardCollider } from '../shared/guardCollision';
import { MAX_MOVEMENT_BATCH, MAX_MOVEMENT_INPUT_MS, MAX_PENDING_MOVEMENT_INPUTS, MAX_QUEUED_MOVEMENT_MS } from '../shared/movementLimits';

export class MovementPrediction {
  private sequence = 0;
  private pending: MovementInput[] = [];
  private outgoing: MovementInput[] = [];
  private sentThrough = 0;
  active = false;
  finishing = false;
  reset() { this.active = false; this.finishing = false; this.pending = []; this.outgoing = []; }
  step(body: MovementBody, x: number, y: number, ms: number, sprint = false, guards:readonly GuardCollider[] = [], directions?: number) {
    // Stop speculative movement if the server has not acknowledged input for several seconds.
    // Reserve one slot for releasing the keys or handing control to a UI action.
    if (this.pending.length >= MAX_PENDING_MOVEMENT_INPUTS - (x || y || directions ? 1 : 0)) { body.moving = false; return; }
    this.active = true; this.finishing = false;
    const input: MovementInput = { seq: ++this.sequence, x, y, ms: Math.min(MAX_MOVEMENT_INPUT_MS, Math.max(0, ms)), sprint, ...(directions === undefined ? {} : { directions }) };
    this.pending.push(input); this.outgoing.push(input);
    applyMovementInput(body, input, guards);
  }
  finish(body: MovementBody) {
    if (!this.active || this.finishing) return;
    this.step(body, 0, 0, 0, false, [], 0);
    this.finishing = true;
  }
  flush(send: (inputs: MovementInput[]) => void) {
    const inFlight = this.pending.filter(input => input.seq <= this.sentThrough);
    let count = inFlight.length, ms = inFlight.reduce((sum, input) => sum + input.ms, 0);
    while (this.outgoing.length) {
      const batch: MovementInput[] = [];
      for (const input of this.outgoing) {
        // Unacknowledged steps include everything the server could still have queued.
        if (batch.length >= MAX_MOVEMENT_BATCH || count >= MAX_PENDING_MOVEMENT_INPUTS - MAX_MOVEMENT_BATCH || ms + input.ms > MAX_QUEUED_MOVEMENT_MS - MAX_MOVEMENT_INPUT_MS) break;
        batch.push(input); count++; ms += input.ms;
      }
      if (!batch.length) break;
      this.outgoing.splice(0, batch.length); this.sentThrough = batch[batch.length - 1].seq;
      send(batch);
    }
  }
  reconcile<T extends MovementBody>(server: T, acknowledged: number, guards:readonly GuardCollider[] = []): T {
    this.sequence = Math.max(this.sequence, acknowledged);
    this.pending = this.pending.filter(input => input.seq > acknowledged);
    const predicted = { ...server };
    for (const input of this.pending) applyMovementInput(predicted, input, guards);
    if (this.finishing && !this.pending.length) { this.active = false; this.finishing = false; }
    return predicted;
  }
  get pendingCount() { return this.pending.length; }
}
