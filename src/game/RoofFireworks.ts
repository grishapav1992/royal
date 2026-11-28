import Phaser from 'phaser';
import { t } from '../i18n';
import { ROOF_FIREWORKS, type FireworkEvent } from '../shared/streetPlay';
import type { Point } from './navigation';

const INK = 0x302d35, SNOW = 0xf8fbff;
const RISE_MS = 900, BURST_MS = 1700;

/**
 * Shared roof fireworks: the server picks the burst point and colour, so everyone on the roof
 * sees the same rocket. Decoration only, without sound, stake or reward.
 */
export class RoofFireworks {
  private crate: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private zone: Phaser.GameObjects.Zone;
  private shows: { g: Phaser.GameObjects.Graphics; event: FireworkEvent; started: number }[] = [];
  private time = 0;
  private launched = 0;
  constructor(private scene: Phaser.Scene, approach: () => void) {
    const { x, y } = ROOF_FIREWORKS.crate;
    const g = this.crate = scene.add.graphics().setPosition(x, y).setDepth(y);
    g.fillStyle(0x27202c, .16).fillEllipse(0, 0, 86, 14);
    g.fillStyle(0x8a5a3c).fillRect(-35, -36, 70, 36).lineStyle(2.5, INK).strokeRect(-35, -36, 70, 36);
    g.lineStyle(1.5, 0x6b4430).lineBetween(-35, -18, 35, -18).lineBetween(-12, -36, -12, 0).lineBetween(12, -36, 12, 0);
    g.fillStyle(0x7a1f3a).fillRect(-30, -31, 60, 10).lineStyle(1.2, INK).strokeRect(-30, -31, 60, 10);
    for (const [dx, color] of [[-20, 0xf6cf58], [-4, 0x75cbd9], [12, 0xeb91af], [26, 0x7bcaa1]] as const) {
      g.fillStyle(color).fillRect(dx - 3, -58, 7, 24).lineStyle(1.3, INK).strokeRect(dx - 3, -58, 7, 24);
      g.fillStyle(0xf3dcb1).fillTriangle(dx - 4, -58, dx + 4, -58, dx + .5, -66);
    }
    g.fillStyle(SNOW).fillRoundedRect(-37, -40, 74, 6, 3);
    this.label = scene.add.text(x, y - 74, t('Фейерверк'), { fontFamily: 'Arial', fontSize: '10px', color: '#f5dfaa', backgroundColor: '#302832e8', padding: { x: 6, y: 4 } }).setOrigin(.5, 1).setDepth(3000);
    this.zone = scene.add.zone(x, y - 30, 90, 80).setDepth(y + 2).setInteractive({ useHandCursor: true }).on('pointerdown', approach);
  }
  /** Rocket from the crate to the server's burst point, then a ring of sparks. */
  show(event: FireworkEvent) {
    this.shows.push({ g: this.scene.add.graphics().setDepth(3200), event, started: this.time });
    this.launched++;
  }
  update(delta: number, overview: boolean, reducedMotion: boolean, near: (p: Point) => boolean) {
    this.time += delta;
    const { x, y } = ROOF_FIREWORKS.crate;
    this.label.setVisible(!overview && near({ x, y }));
    for (let i = this.shows.length - 1; i >= 0; i--) {
      const show = this.shows[i], e = show.event, age = this.time - show.started;
      const rise = reducedMotion ? 1 : Math.min(1, age / RISE_MS), burstAge = reducedMotion ? age : age - RISE_MS;
      const color = Phaser.Display.Color.HSLToColor(e.hue / 360, .85, .62).color, light = Phaser.Display.Color.HSLToColor(e.hue / 360, .9, .82).color;
      const g = show.g.clear().setVisible(!overview);
      if (burstAge > BURST_MS) { g.destroy(); this.shows.splice(i, 1); continue; }
      if (rise < 1) {
        const k = Phaser.Math.Easing.Cubic.Out(rise), rx = x + (e.x - x) * k, ry = y - 60 + (e.y - (y - 60)) * k;
        for (let n = 1; n <= 6; n++) g.fillStyle(0xffe39a, .5 - n * .07).fillCircle(rx - (e.x - x) * .02 * n, ry + 9 * n, 3 - n * .3);
        g.fillStyle(0xfff6d8).fillCircle(rx, ry, 3.5);
        continue;
      }
      // Sparks spread, slow down and fall a little while fading.
      const k = Math.min(1, burstAge / BURST_MS), spread = Phaser.Math.Easing.Cubic.Out(k) * 120, fall = k * k * 40, alpha = 1 - k;
      for (let n = 0; n < 24; n++) {
        const a = n / 24 * Math.PI * 2, r = spread * (n % 2 ? .72 : 1);
        const px = e.x + Math.cos(a) * r, py = e.y + Math.sin(a) * r + fall;
        g.fillStyle(n % 3 ? color : light, alpha).fillCircle(px, py, 3 * (1 - k * .6));
        if (!reducedMotion) g.lineStyle(1.4, color, alpha * .5).lineBetween(e.x + Math.cos(a) * r * .7, e.y + Math.sin(a) * r * .7 + fall * .7, px, py);
      }
      if (k < .18) g.fillStyle(0xffffff, (.18 - k) * 4).fillCircle(e.x, e.y, 26);
    }
  }
  setActive(active: boolean) {
    if (!active) { for (const s of this.shows) s.g.destroy(); this.shows = []; }
  }
  getState() { return { shows: this.shows.length, launched: this.launched, zone: this.zone.visible }; }
}
