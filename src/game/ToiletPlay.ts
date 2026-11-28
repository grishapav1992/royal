import type Phaser from 'phaser';
import { t } from '../i18n';
import { HAND_DRYER, TOILET_ACT_MS, TOILET_CUBICLE_SEATS, TOILET_SINKS, cubicleOfSeat, nearDryer, nearSink, type ToiletActEvent } from '../shared/toiletPlay';
import type { Point } from './navigation';
import './street-play.css';

const INK = 0x302d35;

export type ToiletPlaySelf = Point & { hall: string; seat?: string; playing?: boolean; action?: string };
export type ToiletPlayHooks = {
  send(type: string): boolean;
  approach(point: Point, arrive: () => void): void;
  sit(seat: string): void;
  stand(): void;
  selfie(): void;
  online(): boolean;
};

/** Restroom actions: wash, dry, lock a cubicle, mirror selfie. */
export class ToiletPlay {
  private dryer: Phaser.GameObjects.Graphics;
  private effects: { g: Phaser.GameObjects.Graphics; event: ToiletActEvent; started: number }[] = [];
  private time = 0;
  private self?: ToiletPlaySelf;
  private active = false;
  private bar = document.createElement('div');
  private washButton = document.createElement('button');
  private selfieButton = document.createElement('button');
  private dryButton = document.createElement('button');
  private lockButton = document.createElement('button');
  private leaveButton = document.createElement('button');
  private renderKey = '';
  constructor(private scene: Phaser.Scene, private hooks: ToiletPlayHooks) {
    const { x, y } = HAND_DRYER;
    const g = this.dryer = scene.add.graphics().setPosition(x, y).setDepth(y - 30);
    g.fillStyle(0xd8dde2).fillRoundedRect(-8, -42, 26, 34, 5).lineStyle(2, INK).strokeRoundedRect(-8, -42, 26, 34, 5);
    g.fillStyle(0x9aa6b6).fillRoundedRect(4, -14, 12, 9, 3).lineStyle(1.5, INK).strokeRoundedRect(4, -14, 12, 9, 3);
    g.fillStyle(0xc95b51).fillCircle(5, -34, 2.2);
    scene.add.zone(x + 14, y - 26, 54, 56).setDepth(y + 1).setInteractive({ useHandCursor: true })
      .on('pointerdown', () => { if (this.hooks.online()) this.hooks.approach(HAND_DRYER.approach, () => this.hooks.send('dry')); });
    TOILET_SINKS.forEach(sink => {
      scene.add.zone(sink.x, 272, 70, 42).setDepth(300).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => { if (this.hooks.online()) this.hooks.approach(sink, () => this.hooks.send('wash')); });
    });
    this.bar.className = 'street-play-bar'; this.bar.id = 'toilet-play-bar'; this.bar.hidden = true;
    this.bar.setAttribute('aria-label', t('Туалет: что можно сделать'));
    const buttons: [HTMLButtonElement, string, string, () => void][] = [
      [this.washButton, 'toilet-wash', 'Умыться · E', () => this.hooks.send('wash')],
      [this.selfieButton, 'toilet-selfie-button', 'Селфи в зеркале', () => this.hooks.selfie()],
      [this.dryButton, 'toilet-dry', 'Сушилка · E', () => this.hooks.send('dry')],
      [this.lockButton, 'toilet-lock', 'Закрыться в кабинке · E', () => { const seat = this.freeCubicle(); if (seat) this.hooks.sit(seat); }],
      [this.leaveButton, 'toilet-leave', 'Выйти из кабинки · E', () => this.hooks.stand()],
    ];
    for (const [button, id, label, run] of buttons) { button.type = 'button'; button.id = id; button.textContent = t(label); button.hidden = true; button.onclick = run; this.bar.append(button); }
    document.querySelector('.room-panel')?.append(this.bar);
    scene.events.once('shutdown', () => this.bar.remove());
  }
  private freeCubicle() {
    const self = this.self;
    return self ? TOILET_CUBICLE_SEATS.find(seat => Math.hypot(seat.entry.x - self.x, seat.entry.y - self.y) < 50)?.id : undefined;
  }
  /** E in the restroom: wash at a sink or use the dryer. Cubicles use the ordinary seat key. */
  interact() {
    const self = this.self;
    if (!self || !this.active || self.seat) return false;
    if (nearSink(self) >= 0) return this.hooks.send('wash');
    if (nearDryer(self)) return this.hooks.send('dry');
    return false;
  }
  act(event: ToiletActEvent) { this.effects.push({ g: this.scene.add.graphics().setDepth(event.kind === 'wash' ? 330 : 540), event, started: this.time }); }
  setActive(active: boolean) {
    this.active = active;
    if (!active) { for (const e of this.effects) e.g.destroy(); this.effects = []; }
    this.render();
  }
  update(delta: number, overview: boolean, reducedMotion: boolean, self: ToiletPlaySelf | undefined) {
    this.time += delta; this.self = self;
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i], age = this.time - fx.started, length = TOILET_ACT_MS[fx.event.kind], k = age / length;
      const g = fx.g.clear().setVisible(!overview);
      if (k >= 1) { g.destroy(); this.effects.splice(i, 1); continue; }
      if (fx.event.kind === 'wash') {
        // Water runs from the tap and splashes in the basin.
        const sink = TOILET_SINKS[fx.event.sink] ?? TOILET_SINKS[0], x = sink.x, y = 270;
        g.lineStyle(3, 0x9bd3e6, .9).lineBetween(x, y - 16, x, y - 4);
        const n = reducedMotion ? 4 : 8;
        for (let d = 0; d < n; d++) {
          const a = Math.PI + d / (n - 1) * Math.PI, r = 6 + ((age / 90 + d * 3) % 10);
          g.fillStyle(0xbfe7f4, .9 * (1 - k)).fillCircle(x + Math.cos(a) * r, y + Math.sin(a) * r * .6, 2.2);
        }
      } else {
        // Warm air below the dryer nozzle.
        const { x, y } = HAND_DRYER;
        for (let n = 0; n < 4; n++) {
          const p = reducedMotion ? .5 : (age / 500 + n / 4) % 1;
          g.lineStyle(2, 0xf3c48c, .7 * (1 - p)).beginPath();
          g.moveTo(x + 6 + n * 3, y - 4 + p * 30); g.lineTo(x + 14 + n * 3, y + 2 + p * 30); g.lineTo(x + 6 + n * 3, y + 8 + p * 30); g.strokePath();
        }
      }
    }
    this.render();
  }
  private render() {
    const self = this.self, online = this.hooks.online(), on = !!self && this.active && online;
    const seatedHere = on && cubicleOfSeat(self!.seat ?? '') !== undefined;
    const free = on && !self!.seat && !self!.playing && self!.action !== 'drink';
    const sink = free && nearSink(self!) >= 0, dryer = free && nearDryer(self!), lock = free && !!this.freeCubicle();
    const key = JSON.stringify([on, seatedHere, sink, dryer, lock]);
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.bar.hidden = !(sink || dryer || lock || seatedHere);
    const toolbar = document.querySelector<HTMLElement>('.room-toolbar');
    if (toolbar) this.bar.style.setProperty('--street-play-top', toolbar.offsetTop + toolbar.offsetHeight + 8 + 'px');
    this.washButton.hidden = !sink; this.selfieButton.hidden = !sink; this.dryButton.hidden = !dryer;
    this.lockButton.hidden = !lock; this.leaveButton.hidden = !seatedHere;
  }
  getState() {
    return { bar: !this.bar.hidden, effects: this.effects.map(e => e.event.kind), buttons: { wash: !this.washButton.hidden, dry: !this.dryButton.hidden, lock: !this.lockButton.hidden, leave: !this.leaveButton.hidden } };
  }
}
