import { getIntoxication } from '../shared/intoxication';
import { PLAYER_SPRINT_SPEED } from '../shared/world';
import type { Point } from '../game/navigation';
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
  step(body: MovementBody, x: number, y: number, ms: number, sprint = false, guards:readonly GuardCollider[] = [], route = false) {
    // Stop speculative movement if the server has not acknowledged input for several seconds.
    // Reserve one slot for releasing the keys or handing control to a UI action.
    if (this.pending.length >= MAX_PENDING_MOVEMENT_INPUTS - (x || y ? 1 : 0)) { body.moving = false; return; }
    this.active = true; this.finishing = false;
    const input = { seq: ++this.sequence, x, y, ms: Math.min(MAX_MOVEMENT_INPUT_MS, Math.max(0, ms)), sprint, route: route || undefined };
    this.pending.push(input); this.outgoing.push(input);
    applyMovementInput(body, input, guards);
  }
  finish(body: MovementBody) {
    if (!this.active || this.finishing) return;
    this.step(body, 0, 0, 0);
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

/** Follow a checked click path using the same acknowledged inputs as keyboard movement. */
export function advanceClickMovement(body: MovementBody, path: Point[], ms: number, prediction: MovementPrediction, guards: readonly GuardCollider[] = []) {
  let remaining = Math.min(50, Math.max(0, ms));
  if (!path.length || !remaining) return;
  if (body.seat || body.action === 'drink') {
    const count = prediction.pendingCount;
    prediction.step(body, 1, 0, 0, true, guards, true);
    if (prediction.pendingCount === count) return;
  }
  const speed = PLAYER_SPRINT_SPEED * (1 - getIntoxication(body.soberAt ?? 0).level * .28);
  for (let steps = 0; path.length && remaining > 1e-6 && steps < 32; steps++) {
    const target = path[0], dx = target.x - body.x, dy = target.y - body.y;
    const distance = Math.hypot(dx, dy);
    if (distance < .05) { path.shift(); continue; }
    const duration = Math.min(remaining, distance / speed * 1000);
    const beforeX = body.x, beforeY = body.y, count = prediction.pendingCount;
    prediction.step(body, dx / distance, dy / distance, duration, true, guards, true);
    if (prediction.pendingCount === count) break;
    remaining -= duration;
    if (Math.hypot(body.x - beforeX, body.y - beforeY) < 1e-6) { path.length = 0; break; }
    if (Math.hypot(target.x - body.x, target.y - body.y) < .05) path.shift();
  }
}
