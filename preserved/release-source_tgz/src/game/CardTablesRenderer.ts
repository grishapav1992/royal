import Phaser from 'phaser';
import { dealerForGame, type DealerAction, type DealerProfile } from '../shared/cardTables';
import type { Cabinet } from '../shared/cabinets';
import { DEALER_ACTIONS, DEALER_SIZE, drawDealer } from './dealerArt';

const TABLE_SIZE = { width: 232, height: 126 };
const DEALER_SCALE = .8;
const BODY_HEIGHT = 60;
const HAND_TOP = 52;
const HAND_HEIGHT = 52;
const ink = '#312a35';
type Paint = CanvasRenderingContext2D;
type TableActor = { cabinet: Cabinet; profile: DealerProfile; body: Phaser.GameObjects.Image; hands: Phaser.GameObjects.Image; cards: Phaser.GameObjects.Image[]; action: DealerAction; actionAt: number; frame: string };

function ellipse(c: Paint, x: number, y: number, rx: number, ry: number, color: string, edge = 1.2) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
  if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); }
}
function panel(c: Paint, x: number, y: number, w: number, h: number, color: string, radius = 0, edge = 1.2) {
  c.beginPath(); c.roundRect(x, y, w, h, radius); c.fillStyle = color; c.fill();
  if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); }
}
function paintTable(c: Paint, profile: DealerProfile) {
  ellipse(c, 116, 115, 108, 9, '#17162033', 0);
  for (const x of [49, 170]) { panel(c, x, 82, 12, 32, '#634736', 3); panel(c, x + 2, 86, 3, 26, '#bb8d57', 1, 0); }
  // A broad horseshoe rail and a deep wooden apron read as furniture from above.
  ellipse(c, 116, 64, 111, 48, '#4a3032');
  ellipse(c, 116, 55, 111, 46, '#966442');
  ellipse(c, 116, 52, 106, 43, '#d6b275');
  ellipse(c, 116, 49, 101, 39, '#352d35');
  ellipse(c, 116, 46, 94, 33, profile.tableColor);
  c.beginPath(); c.ellipse(116, 46, 87, 27, 0, 0, Math.PI); c.strokeStyle = '#e9d59d88'; c.lineWidth = 1; c.stroke();
  c.font = 'bold 10px Georgia, serif'; c.textAlign = 'center'; c.fillStyle = '#f1dbac99'; c.fillText('R O Y A L', 116, 34);
  for (const x of [63, 94, 125, 156]) { c.beginPath(); c.arc(x, 64, 9, 0, Math.PI * 2); c.strokeStyle = '#d7d7a370'; c.lineWidth = .9; c.stroke(); }
  // Card shoe and chip tray are casino props, with no screen or machine controls.
  panel(c, 170, 28, 25, 15, '#d5b581', 2); panel(c, 174, 29, 16, 8, '#322733', 1);
  panel(c, 177, 31, 13, 8, '#f1e4c7', 1, .6); panel(c, 178, 32, 10, 5, profile.uniform, .7, .3);
  panel(c, 39, 25, 28, 17, '#261f29', 2);
  for (let n = 0; n < 4; n++) for (let chip = 0; chip < 3; chip++) {
    ellipse(c, 45 + n * 6, 38 - chip * 3, 3, 1.7, ['#e0bf76', '#ba6178', '#83aea5', '#7f9aba'][n]!, .5);
  }
  panel(c, 72, 91, 88, 10, '#3d2e34', 2, .7);
  c.fillStyle = profile.accent; c.font = 'bold 6px Arial'; c.fillText('C A R D   S A L O N', 116, 98);
  for (const x of [28, 204]) { c.beginPath(); c.moveTo(x, 50); c.lineTo(x, 68); c.strokeStyle = '#f1d191'; c.lineWidth = 1.6; c.stroke(); }
}

/** Static furniture and small, bounded character atlases preserve mobile texture memory. */
export function createCardTableArt(scene: Phaser.Scene, cabinets: readonly Cabinet[]) {
  const make = (key: string, w: number, h: number, paint: (c: Paint) => void, density = 1) => {
    if (scene.textures.exists(key)) return;
    const texture = scene.textures.createCanvas(key, w * density, h * density)!;
    texture.context.scale(density, density); texture.context.lineJoin = 'round'; paint(texture.context); texture.refresh();
  };
  make('card-salon-chair', 44, 48, c => {
    for (const x of [10, 31]) panel(c, x, 27, 3, 18, '#9f7e51', 1);
    panel(c, 4, 3, 36, 25, '#6b3d4c', 7); panel(c, 7, 6, 30, 18, '#976174', 5);
    ellipse(c, 22, 31, 19, 8, '#56323f'); ellipse(c, 22, 27, 19, 7, '#a0677b');
    for (const x of [11, 33]) panel(c, x, 24, 2, 11, '#d0ad70', 1, .5);
  }, 2);
  make('card-salon-card', 18, 24, c => {
    panel(c, 1, 1, 16, 22, '#f8e7be', 2, .8); panel(c, 3, 3, 12, 18, '#426674', 1, .5);
    for (const y of [7, 12, 17]) { c.beginPath(); c.moveTo(5, y); c.lineTo(9, y - 3); c.lineTo(13, y); c.lineTo(9, y + 3); c.closePath(); c.strokeStyle = '#d7c68b'; c.lineWidth = .7; c.stroke(); }
  }, 2);
  cabinets.forEach(cabinet => {
    const profile = dealerForGame(cabinet.id); if (!profile) return;
    make('card-table-' + cabinet.id, TABLE_SIZE.width, TABLE_SIZE.height, c => paintTable(c, profile), 1.5);
    for (const layer of ['body', 'hands'] as const) {
      const height = layer === 'body' ? BODY_HEIGHT : HAND_HEIGHT;
      const key = profile.id + '-' + layer;
      if (scene.textures.exists(key)) continue;
      // Four small frames per action need about 0.6 MiB per dealer, including both layers.
      const texture = scene.textures.createCanvas(key, DEALER_SIZE.width * 4, height * 4)!;
      DEALER_ACTIONS.forEach((action, row) => {
        for (let frame = 0; frame < 4; frame++) {
          const ctx = texture.context, sourceFrame = action === 'idle' ? [0, 2, 4, 5][frame]! : frame * 5 / 3;
          ctx.save(); ctx.translate(frame * DEALER_SIZE.width, row * height);
          ctx.beginPath(); ctx.rect(0, 0, DEALER_SIZE.width, height); ctx.clip();
          if (layer === 'hands') ctx.translate(0, -HAND_TOP);
          drawDealer(ctx, profile, action, sourceFrame, layer); ctx.restore();
          texture.add(action + '-' + frame, 0, frame * DEALER_SIZE.width, row * height, DEALER_SIZE.width, height);
        }
      }); texture.refresh();
    }
  });
}

/** Dealers have personal identities and respond only to explicit game presentation events. */
export class CardTablesRenderer {
  private actors = new Map<string, TableActor>();
  private reducedMotion: boolean;
  constructor(private scene: Phaser.Scene, cabinets: readonly Cabinet[], onApproach: (id: string) => void) {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const cabinet of cabinets) {
      const profile = dealerForGame(cabinet.id); if (!profile) continue;
      const x = cabinet.x, y = cabinet.y;
      this.scene.add.ellipse(x, y + 2, 260, 142, Phaser.Display.Color.HexStringToColor(profile.tableColor).color, .12).setDepth(.08).setName('card-table-rug-' + cabinet.id);
      for (const side of [-1, 1]) this.scene.add.image(x + side * 94, y - 7, 'card-salon-chair').setOrigin(.5, 1).setDisplaySize(35, 38).setDepth(y - 8).setAngle(side * 12);
      this.scene.add.image(x, y + 39, 'card-salon-chair').setOrigin(.5, 1).setDisplaySize(40, 44).setDepth(y + 30).setName('card-player-chair-' + cabinet.id);
      const top = y - 72 - DEALER_SIZE.height * DEALER_SCALE;
      const body = this.scene.add.image(x, top, profile.id + '-body', 'idle-0').setOrigin(.5, 0).setScale(DEALER_SCALE).setDepth(y - 103).setName(profile.id + '-body');
      this.scene.add.image(x, y + 10, 'card-table-' + cabinet.id).setOrigin(.5, 1).setDisplaySize(TABLE_SIZE.width, TABLE_SIZE.height).setDepth(y + 10).setName('card-table-' + cabinet.id);
      const hands = this.scene.add.image(x, top + HAND_TOP * DEALER_SCALE, profile.id + '-hands', 'idle-0').setOrigin(.5, 0).setScale(DEALER_SCALE).setDepth(y + 11).setName(profile.id + '-hands');
      const cards = Array.from({ length: 3 }, (_, index) => this.scene.add.image(x - 22 + index * 22, y - 49, 'card-salon-card').setDisplaySize(14, 19).setAngle((index - 1) * 8).setDepth(y + 12).setName('card-deck-' + cabinet.id + '-' + index));
      this.scene.add.text(x, y - 170, 'КРУПЬЕ ' + profile.name.toLocaleUpperCase('ru-RU'), { fontFamily: 'Arial', fontSize: '9px', fontStyle: 'bold', color: profile.accent, backgroundColor: '#282231', padding: { x: 8, y: 4 }, letterSpacing: 1 }).setOrigin(.5).setDepth(y + 13).setName('card-dealer-name-' + cabinet.id);
      this.scene.add.text(x, y - 7, cabinet.name, { fontFamily: 'Arial', fontSize: '10px', fontStyle: 'bold', color: '#f0dbad', align: 'center', wordWrap: { width: 185 } }).setOrigin(.5, 1).setDepth(y + 13).setName('card-table-name-' + cabinet.id);
      this.scene.add.zone(x, y - 62, 238, 220).setDepth(y + 14).setInteractive({ useHandCursor: true }).on('pointerdown', () => onApproach(cabinet.id)).setName('card-table-hit-' + cabinet.id);
      this.actors.set(cabinet.id, { cabinet, profile, body, hands, cards, action: 'idle', actionAt: 0, frame: '' });
    }
  }
  setAction(gameId: string, action: DealerAction) {
    const actor = this.actors.get(gameId); if (!actor) return;
    actor.action = action; actor.actionAt = this.scene.time.now; actor.frame = '';
  }
  update(time: number) {
    for (const actor of this.actors.values()) {
      const elapsed = Math.max(0, time - actor.actionAt);
      if (actor.action !== 'idle' && elapsed > 1500) { actor.action = 'idle'; actor.actionAt = time; }
      const action = actor.action;
      const idleAt = (time + actor.profile.index * 347) % 4600;
      const index = this.reducedMotion ? action === 'idle' ? 0 : 2 : action === 'idle' ? idleAt > 4210 && idleAt < 4330 ? 2 : idleAt < 1700 ? 0 : idleAt < 3200 ? 1 : 3 : Math.min(3, Math.floor(elapsed / 240));
      const frame = action + '-' + index;
      if (actor.frame !== frame) { actor.body.setFrame(frame); actor.hands.setFrame(frame); actor.frame = frame; }
      for (let index = 0; index < actor.cards.length; index++) {
        const card = actor.cards[index]!, progress = action === 'deal' && !this.reducedMotion ? Phaser.Math.Clamp((elapsed - index * 120) / 600, 0, 1) : 1;
        card.setPosition(actor.cabinet.x + 69 + (-91 + index * 22) * progress, actor.cabinet.y - 83 + 34 * progress).setAngle(-20 + (12 + index * 8) * progress);
      }
    }
  }
}
