import { STREET_OBSTACLES } from '../src/shared/street';
import {
  MAX_SNOWBALLS, SNOW_HIT_RADIUS, SNOW_PICK_MS, SNOW_ROLL_START, SNOW_SPLAT_MS, SNOW_THROW_MS, SNOWMAN_COMPLETE_MS, SNOWMAN_IDLE_MS,
  ROOF_FIREWORKS, fireworkBurst, isSnowHall, nearFireworks, type FireworkEvent,
  inSnowField, nearSnowDrift, parseSnowmanParts, placeSnowball, snowballLanding, snowFlightMs, snowmanDropPoint, snowRollRadius, type SnowmanView,
} from '../src/shared/streetPlay';
import { Snowman, type LobbyState, type Player } from './state';

export type SnowballEvent = { id: number; hall: string; from: string; sx: number; sy: number; tx: number; ty: number; hits: string[]; flightMs: number };

/**
 * Street snow play. Snowballs and snowmen are room-local decoration: no wallet, stake,
 * reward or sanction. A hit on a real player requires both players to have opted in.
 */
export class StreetSnow {
  private rolling = new Map<string, { x: number; y: number; distance: number }>();
  private pickedAt = new Map<string, number>();
  private thrownAt = new Map<string, number>();
  private sequence = 0;
  private fireworkAt = -Infinity;
  constructor(private state: LobbyState, private send: (event: SnowballEvent) => void, private sendFirework: (event: FireworkEvent) => void = () => {}) {}

  private free(p: Player) {
    return p.connected && isSnowHall(p.hall) && !p.stairStep && !p.seat && !p.playing && !p.activity && !p.security && p.action !== 'drink';
  }
  fight(p: Player, value: unknown) { if (typeof value === 'boolean') p.snowFight = value; }
  pick(id: string, p: Player, now = Date.now()): string | void {
    if (!this.free(p) || p.snowRoll > 0) return;
    if (!nearSnowDrift(p)) return p.hall === 'roof' ? 'Подойди к сугробу у парапета, там можно слепить снежок.' : 'Подойди к сугробу у бордюра, там можно слепить снежок.';
    if (p.snowballs >= MAX_SNOWBALLS) return 'В руках уже три снежка. Брось один.';
    if (now < (this.pickedAt.get(id) ?? -Infinity) + SNOW_PICK_MS) return;
    this.pickedAt.set(id, now); p.snowballs++;
  }
  throw(id: string, p: Player, value: unknown, now = Date.now()): SnowballEvent | void {
    const aim = value as { x?: unknown; y?: unknown } | null;
    if (!this.free(p) || p.snowRoll > 0 || p.snowballs < 1 || !aim || typeof aim.x !== 'number' || typeof aim.y !== 'number' || !Number.isFinite(aim.x) || !Number.isFinite(aim.y)) return;
    if (now < (this.thrownAt.get(id) ?? -Infinity) + SNOW_THROW_MS) return;
    this.thrownAt.set(id, now); p.snowballs--;
    const from = { x: p.x, y: p.y - 48 }, landing = snowballLanding(from, { x: aim.x, y: aim.y }), flightMs = snowFlightMs(from, landing);
    const hits: string[] = [];
    if (p.snowFight) for (const [otherId, other] of this.state.players) {
      if (otherId === id || !other.connected || other.hall !== p.hall || other.stairStep || !other.snowFight) continue;
      if (Math.hypot(other.x - landing.x, other.y - 36 - landing.y) <= SNOW_HIT_RADIUS + 6) { hits.push(otherId); other.snowHitUntil = now + flightMs + SNOW_SPLAT_MS; }
    }
    const event = { id: ++this.sequence, hall: p.hall, from: id, sx: Math.round(from.x), sy: Math.round(from.y), tx: landing.x, ty: landing.y, hits, flightMs };
    this.send(event);
    return event;
  }
  roll(id: string, p: Player): string | void {
    if (!this.free(p) || p.snowRoll > 0) return;
    if (p.snowballs > 0) return 'Сначала брось снежки из рук.';
    if (p.hall !== 'street' || !inSnowField(p)) return 'Ком можно катать только по снегу перед казино.';
    this.rolling.set(id, { x: p.x, y: p.y, distance: 0 }); p.snowRoll = SNOW_ROLL_START;
  }
  snowmen(): SnowmanView[] {
    return [...this.state.snowmen].map(([id, s]) => ({ id, x: s.x, y: s.y, parts: parseSnowmanParts(s.parts), builder: s.builder, complete: s.complete, meltAt: s.meltAt }));
  }
  drop(id: string, p: Player, now = Date.now()): string | void {
    if (p.snowRoll <= 0 || !this.free(p)) return;
    const radius = Math.round(p.snowRoll), point = snowmanDropPoint(p, p.facing);
    const placement = placeSnowball(point, radius, this.snowmen(), STREET_OBSTACLES);
    if (placement.kind === 'refused') return placement.reason;
    p.snowRoll = 0; this.rolling.delete(id);
    if (placement.kind === 'stack') {
      const snowman = this.state.snowmen.get(placement.id)!;
      const parts = [...parseSnowmanParts(snowman.parts), radius];
      snowman.parts = parts.join(',');
      snowman.complete = parts.length >= 3;
      snowman.meltAt = now + (snowman.complete ? SNOWMAN_COMPLETE_MS : SNOWMAN_IDLE_MS);
      if (snowman.complete) snowman.builder = p.name;
      return;
    }
    const snowman = new Snowman();
    Object.assign(snowman, { x: point.x, y: point.y, parts: String(radius), builder: p.name, complete: false, meltAt: now + SNOWMAN_IDLE_MS });
    this.state.snowmen.set('snowman-' + (++this.sequence), snowman);
  }
  /** A ball grows only while it moves over the snow; leaving the street or sitting down crumbles it. */
  tick(now = Date.now()) {
    for (const [id, p] of this.state.players) {
      if (!isSnowHall(p.hall) && p.snowballs) p.snowballs = 0;
      if (p.snowHitUntil && now >= p.snowHitUntil) p.snowHitUntil = 0;
      if (p.snowRoll <= 0) { this.rolling.delete(id); continue; }
      const roll = this.rolling.get(id);
      if (!roll || !this.free(p)) { p.snowRoll = 0; this.rolling.delete(id); continue; }
      const step = Math.hypot(p.x - roll.x, p.y - roll.y);
      if (step < 200 && inSnowField(p)) roll.distance += step;
      roll.x = p.x; roll.y = p.y;
      const radius = Math.round(snowRollRadius(roll.distance) * 2) / 2;
      if (radius !== p.snowRoll) p.snowRoll = radius;
    }
    for (const [id, s] of this.state.snowmen) if (now >= s.meltAt) this.state.snowmen.delete(id);
  }
  /** One shared launcher: a short pause between rockets keeps the sky readable for everyone. */
  firework(id: string, p: Player, now = Date.now()): string | FireworkEvent | void {
    if (!p.connected || p.hall !== 'roof' || p.stairStep || p.seat || p.playing || p.security || p.snowRoll > 0) return;
    if (!nearFireworks(p)) return 'Подойди к ящику с фейерверком у парапета.';
    if (now < this.fireworkAt + ROOF_FIREWORKS.cooldownMs) return 'Следующую ракету можно запустить через несколько секунд.';
    this.fireworkAt = now;
    const sequence = ++this.sequence, burst = fireworkBurst(sequence);
    const event = { id: sequence, x: burst.x, y: burst.y, hue: burst.hue, by: p.name };
    this.sendFirework(event);
    return event;
  }
  leave(id: string) { this.rolling.delete(id); this.pickedAt.delete(id); this.thrownAt.delete(id); }
}
