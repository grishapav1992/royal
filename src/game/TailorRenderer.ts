import type Phaser from 'phaser';
import { ATELIER } from '../shared/atelier';

export const ATELIER_EMPTY_TEXTURE = 'atelier-empty-v1';
export const ATELIER_EMPTY_SPRITE = '/assets/atelier/wall-atelier-empty-v1.webp';
export const TAILOR_TEXTURE = 'atelier-tailor-poses-v1';
export const TAILOR_SPRITE = '/assets/atelier/tailor-poses-v1.png';

const phases = [
  { action: 'idle', duration: 4600, from: 0, to: 0 },
  { action: 'adjust', duration: 1700, from: 0, to: 0 },
  { action: 'idle', duration: 2300, from: 0, to: 0 },
  { action: 'walk-left', duration: 1800, from: 0, to: -20 },
  { action: 'inspect-left', duration: 1600, from: -20, to: -20 },
  { action: 'walk-right', duration: 1800, from: -20, to: 0 },
  { action: 'idle', duration: 3100, from: 0, to: 0 },
  { action: 'walk-right', duration: 1800, from: 0, to: 22 },
  { action: 'inspect-right', duration: 1600, from: 22, to: 22 },
  { action: 'walk-left', duration: 1800, from: 22, to: 0 },
  { action: 'idle', duration: 2600, from: 0, to: 0 },
] as const;
const cycle = phases.reduce((sum, phase) => sum + phase.duration, 0);
const smooth = (t: number) => t * t * (3 - 2 * t);
const poseBottom = [303, 303, 305, 305, 300, 298, 292, 301];

/** Decorative, frame-driven animation. No timers, network state, or payment effects. */
export class TailorRenderer {
  private body: Phaser.GameObjects.Sprite;
  private art: Phaser.GameObjects.Image;
  private motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  private clock = 0;
  private routineClock = 0;
  private blinkAt = 2600;
  private blinkUntil = 0;
  private greetingUntil = 0;
  private wasNear = false;
  private offset = 0;
  private blinks = 0;
  private frame = 0;
  private action = 'idle';
  private frozen = false;
  private readonly center = ATELIER.x - ATELIER.width * .03;
  private readonly bodyTop = ATELIER.top + ATELIER.height * .406;

  constructor(private scene: Phaser.Scene, open: () => void) {
    this.art = scene.add.image(ATELIER.x, ATELIER.top, ATELIER_EMPTY_TEXTURE)
      .setOrigin(.5, 0).setDisplaySize(ATELIER.width, ATELIER.height)
      .setDepth(180).setName('wall-atelier').setInteractive({ useHandCursor: true });
    this.art.on('pointerdown', () => { this.greet(); open(); });
    this.body = scene.add.sprite(this.center, this.bodyTop, TAILOR_TEXTURE, 0)
      .setOrigin(.5, 0).setDisplaySize(56, 84).setDepth(180.1).setName('atelier-tailor');
    // The foreground is a crop of the same clean plate, so seams cannot drift.
    const texture = scene.textures.get(ATELIER_EMPTY_TEXTURE).getSourceImage() as HTMLImageElement;
    const counterTop = Math.round(texture.height * .748);
    scene.add.image(ATELIER.x, ATELIER.top, ATELIER_EMPTY_TEXTURE)
      .setOrigin(.5, 0).setDisplaySize(ATELIER.width, ATELIER.height)
      .setCrop(0, counterTop, texture.width, texture.height - counterTop)
      .setDepth(180.2).setName('atelier-counter');
  }

  private greet() { this.greetingUntil = this.clock + 1200; }

  update(delta: number, active: boolean, playerNear: boolean, ordering: boolean) {
    if (!active || document.hidden || !this.art.visible || !this.art.active) { this.frozen = true; return; }
    const view = this.scene.cameras.main.worldView;
    if (view.right < ATELIER.x - ATELIER.width / 2 || view.left > ATELIER.x + ATELIER.width / 2
      || view.bottom < ATELIER.top || view.top > ATELIER.top + ATELIER.height) { this.frozen = true; return; }
    if (this.motionPreference.matches) {
      this.frozen = true; this.offset = 0; this.frame = 0; this.action = 'still';
      this.body.setFrame(0).setFlipX(false).setPosition(this.center, this.bodyTop).setDisplaySize(56, 84);
      this.wasNear = playerNear; return;
    }
    this.frozen = false;
    const dt = Math.max(0, Math.min(delta, 50));
    this.clock += dt;
    if (playerNear && !this.wasNear) this.greet();
    this.wasNear = playerNear;
    const greeting = this.clock < this.greetingUntil && !ordering;
    let frame = 0, flip = false, target = 0;
    this.action = 'idle';
    if (greeting || ordering) {
      this.action = greeting ? 'greet' : 'attend'; frame = greeting ? 1 : 0;
    } else {
      this.routineClock = (this.routineClock + dt) % cycle;
      let time = this.routineClock;
      for (const phase of phases) {
        if (time >= phase.duration) { time -= phase.duration; continue; }
        this.action = phase.action;
        target = phase.from + (phase.to - phase.from) * smooth(time / phase.duration);
        if (phase.action.startsWith('walk-')) { frame = Math.floor(time / 190) % 2 ? 7 : 3; flip = phase.to < phase.from; }
        else if (phase.action === 'inspect-left') frame = 6;
        else if (phase.action === 'inspect-right') frame = 3;
        else if (phase.action === 'adjust') frame = 5;
        break;
      }
    }
    if (!greeting && !ordering && Math.abs(target - this.offset) > .35) {
      this.action = target < this.offset ? 'walk-left' : 'walk-right';
      frame = Math.floor(this.clock / 190) % 2 ? 7 : 3; flip = target < this.offset;
    }
    this.offset += (target - this.offset) * (1 - Math.exp(-dt / 100));
    if (frame === 0) {
      if (this.clock >= this.blinkAt) {
        this.blinkUntil = this.clock + 150;
        this.blinkAt = this.clock + 3300 + (1 + Math.sin(this.clock * .013)) * 850;
        this.blinks++;
      }
      if (this.clock < this.blinkUntil) frame = 4;
    }
    const walking = this.action.startsWith('walk-');
    const breath = Math.sin(this.clock * .0022);
    const bob = walking ? Math.sin(this.clock * .017) * .35 : breath * .16;
    const align = frame === 4 ? 0 : Math.max(0, 303 - poseBottom[frame]) * 84 / 384;
    this.frame = frame;
    this.body.setFrame(frame).setFlipX(flip)
      .setPosition(this.center + this.offset + (walking ? 0 : Math.sin(this.clock * .0009) * .22), this.bodyTop + bob + align)
      .setDisplaySize(56, 84 * (1 + breath * .004));
  }

  getState() {
    return { action: this.action, frame: this.frame, offset: this.offset, blinks: this.blinks, clock: this.clock,
      frozen: this.frozen, x: this.body.x, y: this.body.y, width: this.body.displayWidth, height: this.body.displayHeight };
  }
}
