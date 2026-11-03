import type Phaser from 'phaser';
import { t } from '../i18n';
import { ROOF, ROOF_STAIRS, STREET_ROOF_STAIRS, ROOF_STAIR_ROUTE } from '../shared/rooftop';
import { paintStreetCrown } from './streetArt';

type Paint = CanvasRenderingContext2D;
const ink = '#292b36', snow = '#f4f8fc', gold = '#edc566';
function box(c: Paint, x: number, y: number, w: number, h: number, color: string, stroke = ink, line = 3) {
  c.fillStyle = color; c.fillRect(x, y, w, h);
  if (line) { c.strokeStyle = stroke; c.lineWidth = line; c.strokeRect(x, y, w, h); }
}
function line(c: Paint, x: number, y: number, x2: number, y2: number, color = ink, width = 3) {
  c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke();
}
function oval(c: Paint, x: number, y: number, rx: number, ry: number, color: string) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
}
function label(c: Paint, text: string, x: number, y: number, size: number, color = gold) {
  c.font = `bold ${size}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(text, x, y);
}
function texture(scene: Phaser.Scene, key: string, w: number, h: number, paint: (c: Paint) => void) {
  if (!scene.textures.exists(key)) {
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    paint(canvas.getContext('2d')!); scene.textures.addCanvas(key, canvas);
  }
  return scene.textures.get(key).getSourceImage() as HTMLCanvasElement;
}
function ground(c: Paint) {
  box(c, 0, 0, ROOF.width, ROOF.height, '#222d46', ink, 0);
  // Layered cut-paper skyline has no perspective or numbered casino storeys.
  for (let n = 0; n < 70; n++) oval(c, 23 + (n * 173) % ROOF.width, 15 + (n * 47) % 210, n % 7 ? 1.5 : 3, n % 7 ? 1.5 : 3, n % 7 ? '#8fa5bd' : '#f6db9d');
  oval(c, 1880, 85, 35, 35, '#f3deaa'); oval(c, 1892, 76, 33, 33, '#222d46');
  c.beginPath(); c.moveTo(0, 262);
  for (const p of [[0, 210], [190, 115], [330, 220], [580, 122], [780, 234], [1100, 110], [1320, 218], [1530, 143], [1780, 235], [2020, 126], [2240, 205]]) c.lineTo(p[0], p[1]);
  c.lineTo(ROOF.width, 320); c.closePath(); c.fillStyle = '#44536b'; c.fill();
  for (const [x, y] of [[190, 115], [580, 122], [1100, 110], [1530, 143], [2020, 126]]) {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x - 42, y + 35); c.lineTo(x - 7, y + 28); c.lineTo(x + 12, y + 41); c.lineTo(x + 43, y + 31); c.closePath(); c.fillStyle = '#c0cedb'; c.fill();
  }
  for (let n = 0; n < 27; n++) {
    const x = n * 90 - 20, h = 35 + n * 31 % 90;
    box(c, x, 290 - h, 65, h, '#304255', ink, 1);
    for (let dx = 12; dx < 60; dx += 20) for (let dy = 13; dy < h - 5; dy += 23) box(c, x + dx, 290 - h + dy, 7, 9, (n + dy) % 3 ? '#e5c778' : '#6a8391', ink, 0);
    box(c, x - 2, 287 - h, 69, 5, '#c2d0d8', ink, 0);
  }
  const d = ROOF.deck;
  box(c, d.x, d.y, d.w, d.h, '#5c6875', '#252f3d', 6);
  box(c, 177, 337, 1886, 826, '#7f8991', ink, 0);
  for (let y = 355; y < 1160; y += 125) line(c, 180, y, 2060, y, '#6b7781', 2);
  for (let x = 195; x < 2060; x += 235) line(c, x, 338, x, 1160, '#6b7781', 2);
  // Parapet and snow stay outside the walkable inner rectangle.
  box(c, 140, 294, 1960, 36, '#743346', ink, 4);
  box(c, 140, 291, 1960, 9, '#dfc69b', ink, 2);
  box(c, 140, 330, 30, 870, '#c5b59f', ink, 3); box(c, 2070, 330, 30, 870, '#c5b59f', ink, 3);
  box(c, 140, 1170, 1960, 30, '#743346', ink, 4); box(c, 140, 1170, 1960, 8, '#dfc69b', ink, 2);
  for (let x = 155; x < 2090; x += 33) oval(c, x, 294, 24, 6, snow);
  for (const [x, y, w] of [[215, 365, 64], [1980, 365, 60], [220, 1115, 80], [1940, 1128, 95], [690, 350, 70], [1700, 1145, 85]]) {
    oval(c, x, y, w, 14, snow); oval(c, x - 20, y - 8, w * .5, 12, snow);
  }
  for (const [x, y] of [[740, 780], [1260, 1060], [1950, 810]]) {
    box(c, x, y, 38, 22, '#515e69', ink, 2);
    for (let i = 6; i < 35; i += 7) line(c, x + i, y + 4, x + i, y + 18, '#9ba8b0', 2);
  }
  // Cables and yellow maintenance markings are painted flush with the deck.
  line(c, 1160, 590, 1160, 640, '#58636b', 5); line(c, 1160, 640, 1650, 640, '#58636b', 5); line(c, 1650, 640, 1650, 940, '#58636b', 5);
  for (const [x, y, w, h] of [[1040, 440, 240, 180], [1350, 440, 240, 180], [1420, 860, 220, 165]]) {
    c.setLineDash([15, 10]); c.strokeStyle = '#d4bf76'; c.lineWidth = 3; c.strokeRect(x, y, w, h); c.setLineDash([]);
  }
  for (let n = 0; n < 5; n++) {
    oval(c, 580 + n * 29, 730 + n % 2 * 12, 4, 7, '#a4adb4'); oval(c, 590 + n * 29, 750 + n % 2 * 12, 4, 7, '#a4adb4');
  }
  // Warm static bulbs avoid flashes and remain readable with reduced motion.
  for (let x = 260; x < 1990; x += 73) {
    line(c, x, 304, x, 321, ink, 2); oval(c, x, 323, 4, 6, x % 2 ? '#f4d18a' : '#f2a995');
  }
  box(c, 860, 220, 520, 70, '#542b40', '#d6b875', 4);
  paintStreetCrown(c, 955, 242, 70, 42); label(c, 'ROYAL', 1165, 257, 47);
  label(c, t('КРЫША КАЗИНО'), 1120, 1114, 27, '#c1cbd1');
}
function vent(c: Paint, w: number, h: number, plan = false) {
  const top = plan ? 0 : 32;
  box(c, 0, top, w, h, '#718d8d', ink, 3);
  if (!plan) { box(c, 0, top, w, 20, '#b5c3bd', ink, 2); box(c, 8, top + h - 14, w - 16, 14, '#536c72', ink, 2); }
  for (const x of [w * .27, w * .73]) {
    oval(c, x, top + h * .53, 26, 26, '#354d56'); oval(c, x, top + h * .53, 22, 22, '#a4b4ad');
    for (const a of [0, Math.PI / 3, Math.PI * 2 / 3]) line(c, x - Math.cos(a) * 21, top + h * .53 - Math.sin(a) * 21, x + Math.cos(a) * 21, top + h * .53 + Math.sin(a) * 21, '#4b666d', 6);
    oval(c, x, top + h * .53, 5, 5, '#d7d9c5');
  }
  oval(c, w * .3, top, w * .28, 6, snow);
}
function hatch(c: Paint) {
  box(c, 0, 0, 180, 170, '#6b3647', ink, 4); box(c, 0, 0, 180, 17, '#dfc79d', ink, 3);
  box(c, 36, 34, 108, 132, '#293e4c', ink, 4); box(c, 44, 42, 92, 121, '#78918f', ink, 2);
  for (let y = 61; y < 107; y += 9) line(c, 56, y, 124, y, '#3e5e65', 3);
  box(c, 110, 125, 19, 5, gold, ink, 1); box(c, 24, 20, 132, 24, gold, ink, 2);
  label(c, t('ВО ДВОР'), 90, 32, 15, ink); oval(c, 60, 2, 59, 7, snow); oval(c, 139, 3, 39, 6, snow);
}
function bench(c: Paint) {
  for (const x of [14, 167]) box(c, x, 30, 9, 42, '#35434d', ink, 2);
  for (const y of [0, 17, 34]) box(c, 0, y, 190, 13, '#aa7451', ink, 2);
  for (let x = 12; x < 190; x += 54) oval(c, x, 6, 2, 2, '#e4bd80');
  oval(c, 44, 0, 35, 5, snow); oval(c, 143, 0, 40, 5, snow);
}
function antenna(c: Paint) {
  box(c, 6, 128, 88, 18, '#747c83', ink, 3); line(c, 50, 134, 50, 18, '#bfc3b4', 7);
  oval(c, 50, 57, 45, 34, '#c7cfca'); oval(c, 50, 57, 30, 22, '#91a7ac');
  line(c, 50, 57, 80, 31, '#4f6971', 5); oval(c, 82, 29, 6, 6, gold);
  line(c, 19, 138, 50, 83, ink, 4); line(c, 81, 138, 50, 83, ink, 4);
}

/** Unmarked flat fire escape with three flights and real switchback landings. */
export class StreetRoofStairs {
  private close: Phaser.GameObjects.Graphics;
  private plan: Phaser.GameObjects.Graphics;
  constructor(scene: Phaser.Scene, enter: () => void) {
    const paint=(g:Phaser.GameObjects.Graphics,plan:boolean)=>{
      // Thin supports leave the street lane visible through the open structure.
      for(const x of [1560,1770]){
        g.lineStyle(plan?2:5,0x36464d).lineBetween(x,255,x,499);
        if(!plan)g.lineStyle(2,0x85918f).lineBetween(x+1,256,x+1,498);
        g.fillStyle(0x435359).fillRect(x-10,493,20,7);
      }
      ROOF_STAIR_ROUTE.slice(1).forEach((to,index)=>{
        const from=ROOF_STAIR_ROUTE[index],dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
        const nx=-dy/length*18,ny=dx/length*18;
        const points=[{x:from.x+nx,y:from.y+ny},{x:to.x+nx,y:to.y+ny},{x:to.x-nx,y:to.y-ny},{x:from.x-nx,y:from.y-ny}];
        g.fillStyle(0x627575).fillPoints(points,true);
        g.lineStyle(2,0x303e45).strokePoints(points,true);
        for(let distance=5;distance<length;distance+=9){
          const t=distance/length,x=from.x+dx*t,y=from.y+dy*t;
          g.lineStyle(plan?1:2,0x9aa8a3).lineBetween(x+nx*.85,y+ny*.85,x-nx*.85,y-ny*.85);
          if(!plan)g.lineStyle(1,0x45585b).lineBetween(x+nx*.65-2,y+ny*.65,x-nx*.65-2,y-ny*.65);
        }
        // Flat parallel rails, never an isometric staircase or a facade sign.
        for(const side of [-1,1]){
          const ax=from.x+nx*side,ay=from.y+ny*side-10,bx=to.x+nx*side,by=to.y+ny*side-10;
          g.lineStyle(plan?2:4,0x35474e).lineBetween(ax,ay,bx,by);
          if(!plan)g.lineStyle(1.5,0x9eaba5).lineBetween(ax,ay-1,bx,by-1);
          for(let t=0;t<=1;t+=.25){const x=from.x+dx*t+nx*side,y=from.y+dy*t+ny*side;g.lineStyle(1.5,0x485b60).lineBetween(x,y,x,y-10);}
        }
      });
      for(const index of [0,2,4,6,7]){
        const p=ROOF_STAIR_ROUTE[index];g.fillStyle(0x53696c).fillRect(p.x-23,p.y-12,46,24);
        g.lineStyle(2,0x35474e).strokeRect(p.x-23,p.y-12,46,24);
        for(let x=p.x-16;x<p.x+20;x+=7)g.lineStyle(1,0x8c9c98).lineBetween(x,p.y-9,x,p.y+9);
        if(!plan){g.fillStyle(0xe5edf0).fillEllipse(p.x-8,p.y-14,26,4);g.fillStyle(0x9b7759).fillRect(p.x+19,p.y+5,3,4);}
      }
    };
    this.close=scene.add.graphics().setDepth(620);paint(this.close,false);
    this.plan=scene.add.graphics().setDepth(.15);paint(this.plan,true);
    // Only the bottom platform accepts a click; the circulation lane has no hitbox.
    const foot=STREET_ROOF_STAIRS.foot;
    scene.add.zone(foot.x,foot.y-2,76,32).setDepth(700).setInteractive().on('pointerdown',enter);
  }
  update(overview:boolean){this.close.setVisible(!overview);this.plan.setVisible(overview);}
}

export class RooftopRenderer {
  readonly mapCanvas: HTMLCanvasElement;
  constructor(scene: Phaser.Scene, leave: () => void) {
    const lang = t('КРЫША КАЗИНО'), groundKey = 'casino-roof-ground-' + lang;
    const base = texture(scene, groundKey, ROOF.width, ROOF.height, ground);
    scene.add.image(0, 0, groundKey).setOrigin(0).setDepth(0);
    this.mapCanvas = document.createElement('canvas'); this.mapCanvas.width = ROOF.width; this.mapCanvas.height = ROOF.height;
    const map = this.mapCanvas.getContext('2d')!; map.drawImage(base, 0, 0);
    const prop = (key: string, x: number, y: number, w: number, h: number, paint: (c: Paint) => void) => {
      const art = texture(scene, key, w, h, paint);
      scene.add.image(x, y, key).setOrigin(0, 1).setDepth(y); map.drawImage(art, x, y - h, w, h);
    };
    prop('casino-roof-hatch-' + lang, ROOF.hatch.x, 580, 180, 170, hatch);
    for (const v of ROOF.vents) prop('casino-roof-vent-' + v.w, v.x, v.y + v.h, v.w, v.h + 32, c => vent(c, v.w, v.h));
    for (const b of ROOF.benches) prop('casino-roof-bench', b.x, b.y + b.h, 190, 74, bench);
    prop('casino-roof-antenna', ROOF.antenna.x, ROOF.antenna.y + ROOF.antenna.h, 100, 148, antenna);
    const stairs = scene.add.graphics().setDepth(.1);
    stairs.fillStyle(0x394a58).fillRect(477, 580, 106, 53);
    for (let y = 584; y < 635; y += 10) stairs.lineStyle(4, 0xb9c6bc).lineBetween(480, y, 580, y);
    for (const x of [472, 588]) stairs.lineStyle(5, 0xdec58a).lineBetween(x, 577, x, 637);
    const { click } = ROOF_STAIRS;
    scene.add.zone(click.x, click.y, 190, 245).setDepth(700).setInteractive({ useHandCursor: true }).on('pointerdown', leave);
  }
}
