import type Phaser from 'phaser';
import { t } from '../i18n';
import { ALL_DRINKS } from '../shared/world';
import {
  STREET_KIOSK, KIOSK_DRINK_IDS, KIOSK_LINES, MAX_SNOWBALLS, snowDrifts, type SnowHall, atStreetKiosk, inSnowField, nearSnowDrift,
  snowballAim, type SnowmanView,
} from '../shared/streetPlay';
import { CHARACTER_SCALE, characterTexture } from './characters';
import type { StreetView } from './streetView';
import type { Facing } from '../shared/movement';
import type { Point } from './navigation';
import './street-play.css';

const INK = 0x302d35, SNOW = 0xf8fbff, SNOW_SHADE = 0xd7e1ec, BURGUNDY = 0x7a1f3a, CREAM = 0xf3dcb1, GOLD = 0xe9cf78;
const FIGHT_KEY = 'royal.street.snow-fight.v1';

export type StreetPlaySelf = Point & { hall: string; facing: string; stairStep?: number; seat?: string; action?: string; playing?: boolean;
  snowballs: number; snowRoll: number; snowFight: boolean };
export type StreetPlayActor = { id: string; x: number; y: number; depth: number; visible: boolean; facing: string; seated: boolean; snowballs: number; snowRoll: number; snowHit: boolean };
export type SnowballFlight = { id: number; hall?: string; from: string; sx: number; sy: number; tx: number; ty: number; hits: string[]; flightMs: number };
/** The street's projection, or the identity view of a flat location such as the roof. */
export type PlayView = Pick<StreetView, 'point' | 'depth' | 'visible' | 'orientation' | 'facing'>;
export const FLAT_VIEW: PlayView = { point: p => ({ x: p.x, y: p.y }), depth: p => p.y, visible: () => true, orientation: 'front', facing: (f: Facing) => f };
export type StreetPlayOptions = { hall: SnowHall; kiosk: boolean; roll: boolean; extra?: { id: string; label: () => string; visible: (self: StreetPlaySelf) => boolean; run: () => void } };
export type StreetPlayHooks = {
  send(type: string, value?: unknown): boolean;
  approach(point: Point, arrive: () => void): void;
  landed(point: Point): void;
  focus(): void;
  stand(): void;
  online(): boolean;
};

function ball(g: Phaser.GameObjects.Graphics, x: number, y: number, r: number, line = 2.5) {
  g.fillStyle(SNOW).fillCircle(x, y, r);
  g.fillStyle(SNOW_SHADE).slice(x, y, r, Math.PI * .05, Math.PI * .95, false).fillPath();
  g.fillStyle(SNOW).fillEllipse(x - r * .08, y - r * .05, r * 1.75, r * 1.6);
  g.lineStyle(line, INK).strokeCircle(x, y, r);
}

/** Draws a snowman from its stacked radii; the hat, scarf and face appear once it is finished. */
export function drawSnowman(g: Phaser.GameObjects.Graphics, parts: readonly number[], complete: boolean) {
  g.clear();
  if (!parts.length) return;
  g.fillStyle(0x27202c, .15).fillEllipse(0, 0, parts[0] * 2.4, 16);
  let base = 0;
  const centers: number[] = [];
  parts.forEach((r, i) => { const cy = base - r + (i ? r * .22 : 0); centers.push(cy); ball(g, 0, cy, r); base = cy - r * .78; });
  if (!complete) return;
  const [r0, r1, r2] = parts, mid = centers[1], head = centers[2];
  g.lineStyle(3, 0x6b4a33).lineBetween(-r1 * .85, mid - 6, -r1 * 2, mid - 26).lineBetween(r1 * .85, mid - 6, r1 * 1.95, mid - 22);
  g.fillStyle(BURGUNDY).fillRoundedRect(-r2 - 3, head + r2 * .55, r2 * 2 + 6, 9, 4).fillRect(r2 * .3, head + r2 * .55 + 4, 9, 20);
  g.lineStyle(1.5, INK).strokeRoundedRect(-r2 - 3, head + r2 * .55, r2 * 2 + 6, 9, 4);
  g.fillStyle(INK).fillCircle(-r2 * .33, head - r2 * .2, 2.4).fillCircle(r2 * .33, head - r2 * .2, 2.4);
  for (const dy of [-.25, .2]) g.fillCircle(0, mid + r1 * dy, 2.6);
  for (let i = -2; i <= 2; i++) g.fillCircle(i * 4, head + r2 * .45 - Math.abs(i), 1.4);
  g.fillStyle(0xee8b2d).fillTriangle(0, head - 2, 0, head + 3, 16, head + 2);
  g.fillStyle(0x2b2730).fillRect(-r2 * .72, head - r2 - 20, r2 * 1.44, 20).fillRect(-r2 * 1.05, head - r2 - 2, r2 * 2.1, 5);
  g.fillStyle(GOLD).fillRect(-r2 * .72, head - r2 - 7, r2 * 1.44, 4);
  void r0;
}

export class StreetPlay {
  private kiosk: Phaser.GameObjects.GameObject[] = [];
  private kioskBack?: Phaser.GameObjects.Container;
  private kioskFront?: Phaser.GameObjects.Container;
  private vendor?: Phaser.GameObjects.Sprite;
  private kioskZone?: Phaser.GameObjects.Zone;
  private steam?: Phaser.GameObjects.Graphics;
  private extraButton = document.createElement('button');
  private drifts: { g: Phaser.GameObjects.Graphics; zone: Phaser.GameObjects.Zone; point: Point }[] = [];
  private snowmen = new Map<string, { g: Phaser.GameObjects.Graphics; label: Phaser.GameObjects.Text; key: string; view: SnowmanView }>();
  private flights: { g: Phaser.GameObjects.Graphics; flight: SnowballFlight; started: number }[] = [];
  private puffs: { g: Phaser.GameObjects.Graphics; point: Point; started: number }[] = [];
  private overlays = new Map<string, Phaser.GameObjects.Graphics>();
  private time = 0;
  private aiming = false;
  private fightPreference = false;
  private lastFightSync = 0;
  private self?: StreetPlaySelf;
  private active = false;
  private bar = document.createElement('div');
  private fightButton = document.createElement('button');
  private pickButton = document.createElement('button');
  private throwButton = document.createElement('button');
  private rollButton = document.createElement('button');
  private standButton = document.createElement('button');
  private kioskDialog = document.createElement('aside');
  private kioskLine = document.createElement('p');
  private kioskOpen = false;
  private kioskLineIndex = 0;
  private renderKey = '';
  private escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    if (this.aiming) { this.setAiming(false); event.preventDefault(); }
    else if (this.kioskOpen) { this.closeKiosk(); event.preventDefault(); }
  };
  constructor(private scene: Phaser.Scene, private hooks: StreetPlayHooks, private options: StreetPlayOptions = { hall: 'street', kiosk: true, roll: true }) {
    try { this.fightPreference = localStorage.getItem(FIGHT_KEY) === '1'; } catch { /* The preference is optional. */ }
    if (options.kiosk) this.createKiosk(scene);
    this.createDrifts(scene);
    this.buildDom();
    document.addEventListener('keydown', this.escape);
    scene.events.once('shutdown', () => { document.removeEventListener('keydown', this.escape); this.bar.remove(); this.kioskDialog.remove(); });
  }
  private createKiosk(scene: Phaser.Scene) {
    // Kiosk: back wall and vendor behind the counter, then the counter and awning in front of her.
    const kx = 0, ky = 0, w = STREET_KIOSK.width;
    const back = scene.add.graphics();
    back.fillStyle(0x27202c, .16).fillEllipse(kx, ky, w + 30, 22);
    back.fillStyle(0x8a5a3c).fillRect(kx - w / 2, ky - 150, w, 110).lineStyle(2.5, INK).strokeRect(kx - w / 2, ky - 150, w, 110);
    for (let x = kx - w / 2 + 22; x < kx + w / 2; x += 22) back.lineStyle(1, 0x6b4430).lineBetween(x, ky - 150, x, ky - 40);
    back.fillStyle(0x2b2730).fillRoundedRect(kx + 20, ky - 140, 58, 48, 3).lineStyle(2, 0xbca98d).strokeRoundedRect(kx + 20, ky - 140, 58, 48, 3);
    const menu = scene.add.text(kx + 49, ky - 136, [t('Какао'), t('Кофе'), t('Глинтвейн')].join('\n'), { fontFamily: 'Arial', fontSize: '9px', color: '#f4f8fc', align: 'center', lineSpacing: 1 }).setOrigin(.5, 0);
    this.kioskBack = scene.add.container(0, 0, [back, menu]);
    this.vendor = scene.add.sprite(0, 0, characterTexture(scene, 6), 'down-6').setOrigin(.5, 1).setScale(CHARACTER_SCALE);
    const front = scene.add.graphics();
    front.fillStyle(0x6b3d2b).fillRect(kx - w / 2 - 6, ky - 58, w + 12, 58).lineStyle(2.5, INK).strokeRect(kx - w / 2 - 6, ky - 58, w + 12, 58);
    front.fillStyle(GOLD).fillRect(kx - w / 2 - 6, ky - 62, w + 12, 7).lineStyle(2, INK).strokeRect(kx - w / 2 - 6, ky - 62, w + 12, 7);
    for (let x = kx - w / 2 + 8; x < kx + w / 2; x += 42) front.lineStyle(1.5, 0x52301f).strokeRect(x, ky - 48, 30, 38);
    front.fillStyle(0x9aa6b6).fillRoundedRect(kx + 30, ky - 84, 34, 24, 4).lineStyle(2, INK).strokeRoundedRect(kx + 30, ky - 84, 34, 24, 4);
    front.fillStyle(0x6d7981).fillRect(kx + 27, ky - 88, 40, 5);
    for (const dx of [-70, -54]) { front.fillStyle(CREAM).fillRect(kx + dx, ky - 76, 11, 14).lineStyle(1.5, INK).strokeRect(kx + dx, ky - 76, 11, 14); front.fillStyle(BURGUNDY).fillRect(kx + dx, ky - 72, 11, 4); }
    const stripes = 8, sw = (w + 28) / stripes, left = kx - w / 2 - 14, ay = ky - 176;
    for (let i = 0; i < stripes; i++) { front.fillStyle(i % 2 ? CREAM : BURGUNDY).fillRect(left + i * sw, ay, sw, 30); front.fillCircle(left + i * sw + sw / 2, ay + 30, sw / 2); }
    front.lineStyle(2.5, INK).strokeRect(left, ay, w + 28, 30);
    front.fillStyle(SNOW).fillRoundedRect(left - 4, ay - 8, w + 36, 12, 6);
    for (let x = left; x < left + w + 28; x += 26) front.fillEllipse(x + 13, ay - 6, 30, 12);
    front.fillStyle(BURGUNDY).fillRoundedRect(kx - 62, ay - 40, 124, 30, 5).lineStyle(2.5, GOLD).strokeRoundedRect(kx - 62, ay - 40, 124, 30, 5);
    for (let i = 0; i <= 9; i++) { const x = left + 6 + i * (w + 16) / 9, y = ay + 46 + Math.sin(i / 9 * Math.PI) * 6; front.fillStyle(0xffe39a).fillCircle(x, y, 3.2); front.lineStyle(1, INK, .6).strokeCircle(x, y, 3.2); }
    const sign = scene.add.text(kx, ay - 25, t('ГОРЯЧЕЕ'), { fontFamily: 'Georgia, serif', fontSize: '17px', fontStyle: 'bold', color: '#f6cf58' }).setOrigin(.5);
    this.steam = scene.add.graphics();
    this.kioskFront = scene.add.container(0, 0, [front, sign, this.steam]);
    this.kioskZone = scene.add.zone(0, 0, w + 20, 200).setOrigin(.5, 1).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.approachKiosk());
    this.kiosk.push(this.kioskBack, this.vendor, this.kioskFront, this.kioskZone);
  }
  private createDrifts(scene: Phaser.Scene) {
    // Drifts by the curb; they hide while their snow is being used, like the janitor's piles.
    for (const point of snowDrifts(this.options.hall)) {
      const g = scene.add.graphics();
      g.fillStyle(SNOW).fillEllipse(0, 0, 120, 40).fillEllipse(-25, -12, 64, 34).fillEllipse(23, -9, 56, 26);
      g.lineStyle(2, INK, .5).strokeEllipse(0, 0, 120, 40);
      g.fillStyle(SNOW_SHADE).fillEllipse(11, 8, 86, 14);
      const zone = scene.add.zone(0, 0, 124, 52).setInteractive({ useHandCursor: true }).on('pointerdown', () => this.approachDrift(point));
      this.drifts.push({ g, zone, point });
    }
  }
  private buildDom() {
    this.bar.className = 'street-play-bar'; this.bar.hidden = true; this.bar.id = this.options.hall + '-play-bar';
    this.bar.setAttribute('aria-label', t('Игра в снег'));
    for (const button of [this.fightButton, this.pickButton, this.throwButton, this.rollButton, this.extraButton, this.standButton]) { button.type = 'button'; this.bar.append(button); }
    const extra = this.options.extra; this.extraButton.hidden = true;
    if (extra) { this.extraButton.id = extra.id; this.extraButton.onclick = () => extra.run(); }
    this.standButton.id = this.options.hall + '-stand'; this.standButton.textContent = t('Встать · E'); this.standButton.onclick = () => this.hooks.stand();
    const prefix = this.options.hall;
    this.fightButton.id = prefix + '-snow-fight'; this.fightButton.className = 'snow-fight';
    this.pickButton.id = prefix + '-snow-pick'; this.throwButton.id = prefix + '-snow-throw'; this.rollButton.id = prefix + '-snow-roll';
    this.fightButton.onclick = () => this.setFight(!this.fightPreference);
    this.pickButton.onclick = () => this.pick();
    this.throwButton.onclick = () => this.setAiming(!this.aiming);
    this.rollButton.onclick = () => this.rollOrDrop();
    if (this.options.kiosk) this.buildKiosk();

    const panel = document.querySelector('.room-panel');
    panel?.append(this.bar);
    if (this.options.kiosk) panel?.append(this.kioskDialog);
  }
  private buildKiosk() {
    this.kioskDialog.className = 'street-conversation street-kiosk'; this.kioskDialog.hidden = true; this.kioskDialog.id = 'street-kiosk';
    this.kioskDialog.setAttribute('aria-label', t('Ларёк «Горячее»'));
    const heading = document.createElement('div'); heading.className = 'street-conversation-heading';
    const name = document.createElement('strong'); name.textContent = t('Ларёк «Горячее»');
    const role = document.createElement('span'); role.textContent = STREET_KIOSK.vendor;
    heading.append(name, role);
    this.kioskLine.setAttribute('aria-live', 'polite');
    const actions = document.createElement('div'); actions.className = 'street-conversation-actions street-kiosk-actions';
    for (const id of KIOSK_DRINK_IDS) {
      const drink = ALL_DRINKS.find(d => d.id === id)!, button = document.createElement('button');
      button.type = 'button'; button.dataset.kioskDrink = id;
      button.textContent = drink.strength > 0 ? t(drink.name) + ' · ' + t('опьяняет') : t(drink.name);
      button.title = t(drink.description);
      button.onclick = () => { if (this.self && atStreetKiosk(this.self) && this.hooks.send('drink', id)) this.closeKiosk(); };
      actions.append(button);
    }
    const close = document.createElement('button'); close.type = 'button'; close.textContent = t('Отойти'); close.onclick = () => this.closeKiosk();
    actions.append(close);
    this.kioskDialog.append(heading, this.kioskLine, actions);
  }
  private setFight(on: boolean) {
    this.fightPreference = on;
    try { localStorage.setItem(FIGHT_KEY, on ? '1' : '0'); } catch { /* Optional. */ }
    this.hooks.send('snow-fight', on); this.lastFightSync = performance.now();
    this.render();
  }
  private setAiming(on: boolean) {
    this.aiming = on && Boolean(this.self?.snowballs);
    this.scene.game.canvas.classList.toggle('street-aiming', this.aiming);
    this.render();
  }
  get isAiming() { return this.aiming; }
  /** The aimed click throws instead of walking. */
  aimAt(point: Point) {
    if (!this.aiming) return false;
    this.setAiming(false);
    this.hooks.send('snow-throw', { x: Math.round(point.x), y: Math.round(point.y) });
    return true;
  }
  throwForward() {
    const self = this.self;
    if (!self || !this.active || !self.snowballs) return false;
    this.hooks.send('snow-throw', snowballAim({ x: self.x, y: self.y - 48 }, self.facing));
    return true;
  }
  private approachKiosk() {
    if (!this.hooks.online() || this.aiming) return;
    this.hooks.approach(STREET_KIOSK.approach, () => this.openKiosk());
  }
  private approachDrift(point: Point) {
    if (!this.hooks.online() || this.aiming) return;
    this.hooks.approach({ x: point.x, y: point.y - 18 }, () => this.pick());
  }
  private pick() { if (this.self && nearSnowDrift(this.self)) this.hooks.send('snow-pick'); }
  private rollOrDrop() {
    if (!this.self) return;
    this.hooks.send(this.self.snowRoll > 0 ? 'snow-drop' : 'snow-roll');
  }
  openKiosk() {
    if (!this.options.kiosk || !this.self || !atStreetKiosk(this.self)) return false;
    this.kioskOpen = true; this.kioskLine.textContent = KIOSK_LINES[this.kioskLineIndex++ % KIOSK_LINES.length];
    this.render();
    this.kioskDialog.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    return true;
  }
  private closeKiosk() { if (!this.kioskOpen) return; this.kioskOpen = false; this.render(); this.hooks.focus(); }
  /** E on the street: kiosk, then the rolled ball, then the drift. Returns true when handled. */
  interact() {
    const self = this.self;
    if (!self || !this.active || (self.stairStep ?? 0) > 0) return false;
    if (this.options.kiosk && atStreetKiosk(self)) return this.openKiosk();
    if (this.options.extra?.visible(self)) { this.options.extra.run(); return true; }
    if (self.snowRoll > 0) { this.hooks.send('snow-drop'); return true; }
    if (nearSnowDrift(self) && self.snowballs < MAX_SNOWBALLS && !self.seat) { this.hooks.send('snow-pick'); return true; }
    return false;
  }
  setSnowmen(list: readonly SnowmanView[]) {
    const seen = new Set<string>();
    for (const view of list) {
      seen.add(view.id);
      let entry = this.snowmen.get(view.id);
      if (!entry) {
        const g = this.scene.add.graphics();
        const label = this.scene.add.text(0, 0, '', { fontFamily: 'Arial', fontSize: '10px', color: '#f5dfaa', backgroundColor: '#302832e8', padding: { x: 6, y: 4 } }).setOrigin(.5, 1).setDepth(3000);
        entry = { g, label, key: '', view };
        this.snowmen.set(view.id, entry);
      }
      entry.view = view;
      const key = view.parts.join(',') + ':' + view.complete;
      if (key !== entry.key) { drawSnowman(entry.g, view.parts, view.complete); entry.key = key; }
      entry.label.setText(view.complete ? t('Снеговик') + ' · ' + view.builder : t('Ком для снеговика') + ' · ' + view.parts.length + ' ' + t('из 3'));
    }
    for (const [id, entry] of this.snowmen) if (!seen.has(id)) { entry.g.destroy(); entry.label.destroy(); this.snowmen.delete(id); }
  }
  snowball(flight: SnowballFlight) {
    const g = this.scene.add.graphics().setDepth(3500);
    this.flights.push({ g, flight, started: this.time });
  }
  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      this.kioskOpen = false; this.setAiming(false);
      for (const entry of this.snowmen.values()) { entry.g.setVisible(false); entry.label.setVisible(false); }
      for (const g of this.overlays.values()) g.destroy(); this.overlays.clear();
      for (const f of this.flights) f.g.destroy(); this.flights = [];
      for (const p of this.puffs) p.g.destroy(); this.puffs = [];
    }
    this.render();
  }
  update(view: PlayView, overview: boolean, delta: number, reducedMotion: boolean, self: StreetPlaySelf | undefined, actors: readonly StreetPlayActor[]) {
    this.time += delta;
    this.self = self;
    const front = !overview && view.orientation === 'front';
    // Kiosk and drifts live on the front sidewalk only.
    if (this.kioskBack && this.vendor && this.kioskFront && this.kioskZone && this.steam) {
      const kp = view.point({ x: STREET_KIOSK.x, y: STREET_KIOSK.y }), kd = view.depth({ x: STREET_KIOSK.x, y: STREET_KIOSK.y });
      this.kioskBack.setPosition(kp.x, kp.y).setDepth(kd - 40).setVisible(front);
      this.vendor.setPosition(kp.x - 36, kp.y - 30).setDepth(kd - 30).setVisible(front);
      this.kioskFront.setPosition(kp.x, kp.y).setDepth(kd).setVisible(front);
      this.kioskZone.setPosition(kp.x, kp.y).setDepth(kd + 2).setVisible(front);
      if (this.kioskZone.input) this.kioskZone.input.enabled = front;
      this.steam.clear();
      if (front && !reducedMotion) for (let i = 0; i < 3; i++) {
        const p = (this.time / 1600 + i / 3) % 1;
        this.steam.fillStyle(0xffffff, .55 * (1 - p)).fillCircle(47 + Math.sin((p + i) * 5) * 4, -92 - p * 26, 3 + p * 4);
      }
    }
    for (const drift of this.drifts) {
      const p = view.point(drift.point), visible = front && view.visible(drift.point);
      drift.g.setPosition(p.x, p.y).setDepth(view.depth(drift.point) - 4).setVisible(visible);
      drift.zone.setPosition(p.x, p.y - 8).setDepth(view.depth(drift.point) + 1).setVisible(visible);
      if (drift.zone.input) drift.zone.input.enabled = visible;
    }
    for (const entry of this.snowmen.values()) {
      const point = { x: entry.view.x, y: entry.view.y }, p = view.point(point), visible = !overview && view.visible(point);
      const height = entry.view.parts.reduce((sum, r) => sum + r * 1.6, 0) + (entry.view.complete ? 26 : 0);
      entry.g.setPosition(p.x, p.y).setDepth(view.depth(point)).setVisible(visible);
      entry.label.setPosition(p.x, p.y - height - 10).setVisible(visible && !!self && Math.hypot(self.x - point.x, self.y - point.y) < 260);
    }
    // Snowballs in flight follow a short arc in world space, then burst at the landing point.
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i], k = Math.min(1, (this.time - f.started) / f.flight.flightMs);
      const from = view.point({ x: f.flight.sx, y: f.flight.sy }), to = view.point({ x: f.flight.tx, y: f.flight.ty });
      const lift = Math.min(90, Math.hypot(to.x - from.x, to.y - from.y) * .25);
      const x = from.x + (to.x - from.x) * k, y = from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * lift;
      f.g.clear().setVisible(!overview);
      f.g.fillStyle(SNOW).fillCircle(x, y, 6).lineStyle(1.6, INK).strokeCircle(x, y, 6);
      if (k >= 1) {
        f.g.destroy(); this.flights.splice(i, 1);
        const point = { x: f.flight.tx, y: f.flight.ty };
        this.puffs.push({ g: this.scene.add.graphics().setDepth(3400), point, started: this.time });
        this.hooks.landed(point);
      }
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i], k = (this.time - puff.started) / 420, p = view.point(puff.point);
      puff.g.clear().setVisible(!overview);
      if (k >= 1) { puff.g.destroy(); this.puffs.splice(i, 1); continue; }
      for (let n = 0; n < 6; n++) { const a = n / 6 * Math.PI * 2; puff.g.fillStyle(SNOW, 1 - k).fillCircle(p.x + Math.cos(a) * (6 + k * 16), p.y + Math.sin(a) * (4 + k * 10), 3 * (1 - k) + 1); }
    }
    // Held snowballs, the rolled ball and snow on clothes, drawn with each character.
    const seen = new Set<string>();
    for (const actor of actors) {
      if (!actor.visible || overview || (!actor.snowballs && !actor.snowRoll && !actor.snowHit)) continue;
      seen.add(actor.id);
      let g = this.overlays.get(actor.id);
      if (!g) { g = this.scene.add.graphics(); this.overlays.set(actor.id, g); }
      g.clear().setPosition(actor.x, actor.y).setDepth(actor.depth + .3).setVisible(true);
      const facing = actor.facing, side = facing === 'left' ? -1 : 1;
      if (actor.snowballs && !actor.seated) for (let n = 0; n < actor.snowballs; n++) {
        const x = side * (15 - n * 5), y = -40 - n * 3;
        g.fillStyle(SNOW).fillCircle(x, y, 4.5).lineStyle(1.3, INK).strokeCircle(x, y, 4.5);
      }
      if (actor.snowRoll) {
        // The ball rolls beside the feet, on the side the player faces; behind the body when walking away.
        const r = actor.snowRoll, bx = side * (r + 16), by = -r + 2;
        g.setDepth(actor.depth + (facing === 'up' ? -.5 : .4));
        g.fillStyle(0x27202c, .14).fillEllipse(bx, by + r, r * 2.2, 10);
        ball(g, bx, by, r, 2);
      }
      if (actor.snowHit) for (const [dx, dy, r] of [[-4, -50, 6], [5, -45, 4.5], [-9, -42, 3.5], [3, -57, 3]] as const) g.fillStyle(SNOW, .95).fillCircle(dx, dy, r);
    }
    for (const [id, g] of this.overlays) if (!seen.has(id)) { g.destroy(); this.overlays.delete(id); }
    // Keep the server's opt-in in step with the saved preference, also after reconnection.
    if (self && this.active && self.snowFight !== this.fightPreference && performance.now() - this.lastFightSync > 1500) {
      if (this.hooks.send('snow-fight', this.fightPreference)) this.lastFightSync = performance.now();
    }
    if (this.kioskOpen && (!self || !atStreetKiosk(self))) this.kioskOpen = false;
    if (this.aiming && !self?.snowballs) this.setAiming(false);
    this.render();
  }
  private render() {
    const self = this.self, online = this.hooks.online();
    const free = !!self && this.active && online && !(self.stairStep ?? 0) && !self.seat && !self.playing;
    const canPick = free && !self!.snowRoll && nearSnowDrift(self!) && self!.snowballs < MAX_SNOWBALLS;
    const canThrow = free && self!.snowballs > 0;
    const canRoll = this.options.roll && free && (self!.snowRoll > 0 || (!self!.snowballs && inSnowField(self!)));
    const extra = this.options.extra, canExtra = !!extra && free && extra.visible(self!);
    const seated = !!self && this.active && online && !!self.seat && !self.playing;
    const key = JSON.stringify([seated, this.active && online && !(self?.stairStep ?? 0), this.fightPreference, canPick, canThrow, self?.snowballs, canRoll, self?.snowRoll ? 1 : 0, this.aiming, this.kioskOpen, canExtra, canExtra ? extra!.label() : '']);
    if (key === this.renderKey) return;
    this.renderKey = key;
    this.bar.hidden = !(this.active && online && self && !(self.stairStep ?? 0));
    const toolbar = document.querySelector<HTMLElement>('.room-toolbar');
    if (toolbar) this.bar.style.setProperty('--street-play-top', toolbar.offsetTop + toolbar.offsetHeight + 8 + 'px');
    this.fightButton.textContent = this.fightPreference ? t('❄ Снежки: играю') : t('❄ Снежки: не играю');
    this.fightButton.setAttribute('aria-pressed', String(this.fightPreference));
    this.fightButton.title = t('Когда включено, в тебя можно попасть снежком, а ты можешь попасть в других игроков, которые тоже играют.');
    this.pickButton.hidden = !canPick; this.pickButton.textContent = t('Слепить снежок · E');
    this.throwButton.hidden = !canThrow;
    this.throwButton.textContent = this.aiming ? t('Нажми, куда бросить · Esc') : t('Бросить · F') + ' · ❄' + (self?.snowballs ?? 0);
    this.throwButton.setAttribute('aria-pressed', String(this.aiming));
    this.rollButton.hidden = !canRoll; this.rollButton.textContent = self?.snowRoll ? t('Поставить ком · E') : t('Катить ком');
    this.standButton.hidden = !seated;
    this.extraButton.hidden = !canExtra; if (canExtra) this.extraButton.textContent = extra!.label();
    this.kioskDialog.hidden = !this.kioskOpen;
  }
  getState() {
    return {
      self: this.self ? { snowballs: this.self.snowballs, snowRoll: this.self.snowRoll, snowFight: this.self.snowFight } : null,
      bar: !this.bar.hidden, fight: this.fightPreference, aiming: this.aiming, kiosk: this.kioskOpen,
      buttons: { pick: !this.pickButton.hidden, throw: !this.throwButton.hidden, roll: !this.rollButton.hidden, rollLabel: this.rollButton.textContent },
      snowmen: [...this.snowmen.values()].map(s => ({ ...s.view, visible: s.g.visible, x: s.view.x, y: s.view.y })),
      flights: this.flights.length, kioskVisible: Boolean(this.kioskFront?.visible),
    };
  }
}
