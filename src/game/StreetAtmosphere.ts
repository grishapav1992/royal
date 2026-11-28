import type Phaser from 'phaser';
import { STREET } from '../shared/street';
import { streetEvening } from '../shared/streetPlay';
import { STREET_SIGN } from './streetArt';
import type { PlayView } from './StreetPlay';
import type { Point } from './navigation';

const INK = 0x302d35;
const GLOW = 'street-glow';
// Above the street and its people, below name labels (3000) and snowballs in flight.
const NIGHT_DEPTH = 2900, GLOW_DEPTH = 2901, SNOW_DEPTH = 2950;
const PIGEONS: readonly (Point & { flip: 1 | -1 })[] = [{ x: 700, y: 1090, flip: 1 }, { x: 732, y: 1104, flip: -1 }, { x: 672, y: 1112, flip: 1 }, { x: 1000, y: 1095, flip: -1 }];
const PIGEON_AWAY_MS = 25000, PIGEON_FLIGHT_MS = 1400, PIGEON_SCARE = 70;

/** Verification override: ?street-time=evening or ?street-time=day. */
function forcedEvening(): number | null {
  const value = typeof location === 'undefined' ? '' : new URLSearchParams(location.search).get('street-time');
  return value === 'evening' ? 1 : value === 'day' ? 0 : null;
}

/**
 * Evening by Moscow time, waves of snowfall and pigeons by the entrance.
 * Decoration only: no sound, no server state, the same light for every visitor.
 */
export class StreetAtmosphere {
  private night: Phaser.GameObjects.Rectangle;
  private dusk: Phaser.GameObjects.Rectangle;
  private glows: { image: Phaser.GameObjects.Image; point: Point; front: boolean; alpha: number }[] = [];
  private flakes: { dot: Phaser.GameObjects.Arc; u: number; v: number; speed: number; drift: number; size: number }[] = [];
  private pigeons: { g: Phaser.GameObjects.Graphics; home: Point & { flip: 1 | -1 }; state: 'peck' | 'flying' | 'away'; since: number }[] = [];
  private time = 0;
  private evening = 0;
  private forced = forcedEvening();
  /** The roof uses snowfall only: its art is already a night scene with its own lights. */
  constructor(private scene: Phaser.Scene, private options: { lights: boolean; pigeons: boolean } = { lights: true, pigeons: true }) {
    if (!scene.textures.exists(GLOW)) {
      const texture = scene.textures.createCanvas(GLOW, 256, 256)!, c = texture.context, g = c.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, 'rgba(255,255,255,.55)'); g.addColorStop(.6, 'rgba(255,255,255,.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 256, 256); texture.refresh();
    }
    const area = { x: -600, y: -2800, w: STREET.width + 1200, h: STREET.height + 3600 };
    this.night = scene.add.rectangle(area.x, area.y, area.w, area.h, 0x1a2140, .5).setOrigin(0).setDepth(NIGHT_DEPTH).setBlendMode(2 /* MULTIPLY */);
    this.dusk = scene.add.rectangle(area.x, area.y, area.w, area.h, 0x23305a, .18).setOrigin(0).setDepth(NIGHT_DEPTH);
    const glow = (point: Point, r: number, color: number, alpha: number, front = true) => {
      this.glows.push({ image: scene.add.image(point.x, point.y, GLOW).setDisplaySize(r * 2, r * 2).setTint(color).setDepth(GLOW_DEPTH).setBlendMode(1 /* ADD */), point, front, alpha });
    };
    for (const lamp of STREET.lamps) { glow({ x: lamp.x, y: lamp.y - 128 }, 120, 0xffd98a, .55, false); glow({ x: lamp.x, y: lamp.y - 4 }, 70, 0xffc970, .3, false); }
    for (const x of [702, 978]) glow({ x, y: 768 }, 95, 0xffd98a, .55);
    const b = STREET.building;
    glow({ x: b.x + STREET_SIGN.center, y: b.y + b.h + STREET_SIGN.baselineOffset - STREET_SIGN.baseline + 90 }, 210, 0xffd25a, .6);
    for (let x = b.x + 90; x < b.x + b.w; x += 270) glow({ x, y: 520 }, 80, 0xffe2a0, .35);
    glow({ x: STREET.entrance.x, y: 980 }, 120, 0xffc06a, .35);
    glow({ x: 2190, y: 1000 }, 110, 0xffd98a, .45);
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 180; i++) {
      const size = 1 + rand() * 2.4;
      this.flakes.push({ dot: scene.add.circle(0, 0, size, 0xffffff, .55 + rand() * .4).setDepth(SNOW_DEPTH), u: rand(), v: rand(), speed: .05 + size * .035, drift: rand() * Math.PI * 2, size });
    }
    if (options.pigeons) for (const home of PIGEONS) this.pigeons.push({ g: scene.add.graphics().setDepth(home.y), home, state: 'peck', since: 0 });
  }
  /** 0 in daylight, 1 in the evening. */
  get level() { return this.evening; }
  update(view: PlayView, overview: boolean, delta: number, reducedMotion: boolean, movers: readonly (Point & { moving: boolean })[]) {
    this.time += delta;
    this.evening = this.options.lights ? this.forced ?? streetEvening() : 0;
    const night = !overview && this.evening > 0;
    this.night.setVisible(night).setAlpha(.5 * this.evening);
    this.dusk.setVisible(night).setAlpha(.18 * this.evening);
    for (const glow of this.glows) {
      const visible = night && (!glow.front || view.orientation === 'front') && view.visible(glow.point);
      const p = view.point(glow.point);
      glow.image.setPosition(p.x, p.y).setVisible(visible).setAlpha(glow.alpha * this.evening);
    }
    // Snow falls across the camera view in slow waves; with reduced motion it stays still.
    const camera = this.scene.cameras.main, viewRect = camera.worldView;
    const wave = .35 + .65 * (.5 + .5 * Math.sin(this.time / 40000 * Math.PI * 2));
    this.flakes.forEach((flake, index) => {
      if (!reducedMotion) {
        flake.v = (flake.v + flake.speed * delta / 1000) % 1;
        flake.u = (flake.u + Math.sin(this.time / 1300 + flake.drift) * .00004 * delta + 1) % 1;
      }
      const visible = !overview && index / this.flakes.length < wave;
      flake.dot.setPosition(viewRect.x + flake.u * viewRect.width, viewRect.y + flake.v * viewRect.height).setVisible(visible);
    });
    // Pigeons peck by the carpet, fly off when someone comes close and return later.
    for (const pigeon of this.pigeons) {
      const home = pigeon.home, visible = !overview && view.orientation === 'front';
      if (pigeon.state === 'peck' && movers.some(m => m.moving && Math.hypot(m.x - home.x, m.y - home.y) < PIGEON_SCARE)) { pigeon.state = 'flying'; pigeon.since = this.time; }
      if (pigeon.state === 'flying' && this.time - pigeon.since > PIGEON_FLIGHT_MS) { pigeon.state = 'away'; pigeon.since = this.time; }
      if (pigeon.state === 'away' && this.time - pigeon.since > PIGEON_AWAY_MS && !movers.some(m => Math.hypot(m.x - home.x, m.y - home.y) < PIGEON_SCARE * 1.5)) { pigeon.state = 'peck'; pigeon.since = this.time; }
      const g = pigeon.g.clear();
      if (!visible || pigeon.state === 'away') { g.setVisible(false); continue; }
      const p = view.point(home);
      if (pigeon.state === 'flying') {
        const k = reducedMotion ? 1 : (this.time - pigeon.since) / PIGEON_FLIGHT_MS;
        const x = p.x - home.flip * k * 220, y = p.y - 12 - k * 260, flap = Math.sin(this.time / 60) > 0 ? 1 : -.4;
        g.setPosition(0, 0).setDepth(3000).setVisible(k < 1).setAlpha(1 - k * .3);
        g.fillStyle(0x8e96a8).fillEllipse(x, y, 20, 10).lineStyle(1.5, INK).strokeEllipse(x, y, 20, 10);
        g.fillStyle(0x7c8598).fillTriangle(x - 3, y - 2, x - 18, y - 18 * flap, x + 6, y - 4).fillTriangle(x + 2, y - 2, x + 16, y - 20 * flap, x + 9, y - 2);
        g.lineStyle(1.3, INK).strokeTriangle(x - 3, y - 2, x - 18, y - 18 * flap, x + 6, y - 4).strokeTriangle(x + 2, y - 2, x + 16, y - 20 * flap, x + 9, y - 2);
        g.fillStyle(0x6f7890).fillCircle(x - 10 * home.flip, y - 3, 4.5);
        continue;
      }
      const bob = reducedMotion ? 0 : Math.max(0, Math.sin(this.time / 380 + home.x)) * 3;
      const x = p.x, y = p.y, f = home.flip;
      g.setPosition(0, 0).setDepth(view.depth(home)).setVisible(true).setAlpha(1);
      g.fillStyle(0x27202c, .15).fillEllipse(x, y + 1, 20, 5);
      g.fillStyle(0x8e96a8).fillEllipse(x, y - 8, 22, 13).lineStyle(1.6, INK).strokeEllipse(x, y - 8, 22, 13);
      g.fillStyle(0x6f7890).fillCircle(x + 9 * f, y - 15 + bob, 5.5).lineStyle(1.6, INK).strokeCircle(x + 9 * f, y - 15 + bob, 5.5);
      g.fillStyle(0x7fb3a3).fillEllipse(x + 6 * f, y - 11, 6, 4);
      g.fillStyle(0xee8b2d).fillTriangle(x + 14 * f, y - 16 + bob, x + 14 * f, y - 13 + bob, x + 18 * f, y - 14 + bob);
      g.fillStyle(INK).fillCircle(x + 11 * f, y - 16 + bob, 1.2);
      g.lineStyle(1.5, 0xee8b2d).lineBetween(x - 2, y - 2, x - 3, y + 1).lineBetween(x + 3, y - 2, x + 3, y + 1);
    }
  }
  getState() {
    return { evening: this.evening, flakes: this.flakes.filter(f => f.dot.visible).length, pigeons: this.pigeons.map(p => p.state) };
  }
}
