import Phaser from 'phaser';
import { t } from '../i18n/index';
import { STREET, streetFacadeAlpha } from '../shared/street';
import type { Point } from './navigation';

const ink = 0x27202c, burgundy = 0x671d36, cream = 0xf3dbad, gold = 0xf1ca61;

/** Flat paper scenery: the close camera never sees a roof or a final upper floor. */
export class StreetRenderer {
  private facade: Phaser.GameObjects.Container;
  private plan: Phaser.GameObjects.Container;
  constructor(scene: Phaser.Scene, enter: () => void) {
    const b = STREET.building, front = b.y + b.h;
    const ground = scene.add.graphics().setDepth(0);
    ground.fillStyle(0xe5edf2).fillRect(0, -200, STREET.width, STREET.height + 200);
    ground.fillStyle(0xb8bdc7).fillRect(320, 240, 2180, 960);
    ground.lineStyle(2, 0x9399a7);
    for (let x = 320; x <= 2500; x += 100) ground.lineBetween(x, 240, x, 1200);
    for (let y = 240; y <= 1200; y += 80) ground.lineBetween(320, y, 2500, y);
    ground.fillStyle(0x323d53).fillRect(0, 1210, STREET.width, 170);
    ground.fillStyle(0xf7fbff).fillRect(0, 1198, STREET.width, 12);
    ground.fillStyle(gold);
    for (let x = 25; x < STREET.width; x += 140) ground.fillRect(x, 1295, 68, 6);
    // Props live at the outer edge of the clear circulation lane.
    for (const p of STREET.benches) {
      ground.fillStyle(ink).fillRect(p.x - 57, p.y - 32, 114, 40);
      ground.fillStyle(0x925b3c).fillRect(p.x - 53, p.y - 28, 106, 13).fillRect(p.x - 53, p.y - 11, 106, 10);
      ground.fillStyle(ink).fillRect(p.x - 45, p.y + 5, 6, 12).fillRect(p.x + 39, p.y + 5, 6, 12);
    }
    for (const {x,y} of STREET.trees) {
      ground.fillStyle(0x4f3937).fillRect(x - 7, y - 22, 14, 40);
      ground.fillStyle(0x245549).fillTriangle(x - 55, y, x, y - 105, x + 55, y);
      ground.fillStyle(0x306b54).fillTriangle(x - 44, y - 38, x, y - 130, x + 44, y - 38);
      ground.fillStyle(0xf7fbff).fillTriangle(x - 20, y - 93, x, y - 130, x + 20, y - 93);
    }
    for (const {x,y} of STREET.lamps) {
      ground.fillStyle(ink).fillRect(x - 5, y - 93, 10, 95).fillRect(x - 16, y, 32, 9);
      ground.fillStyle(ink).fillRect(x - 19, y - 116, 38, 33);
      ground.fillStyle(0xffdf78).fillRect(x - 13, y - 110, 26, 21);
    }
    const footprint = scene.add.graphics();
    footprint.fillStyle(ink).fillRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
    footprint.fillStyle(burgundy).fillRect(b.x, b.y, b.w, b.h);
    footprint.lineStyle(7, cream).strokeRect(b.x + 13, b.y + 13, b.w - 26, b.h - 26);
    footprint.fillStyle(0xa63a4b).fillRect(788, front - 7, 104, 45);
    for(const side of [-1,1])footprint.fillStyle(0x306b54).fillCircle(STREET.entrance.x+side*126,front,24);
    const planLabel = scene.add.text(b.x + b.w / 2, b.y + b.h / 2, '♛\nROYAL', {
      fontFamily: 'Georgia', fontSize: '68px', color: '#f1ca61', align: 'center', fontStyle: 'bold',
    }).setOrigin(.5);
    this.plan = scene.add.container(0, 0, [footprint, planLabel]).setDepth(.1);

    const wall = scene.add.graphics();
    const rect = (color: number, x: number, y: number, w: number, h: number) => wall.fillStyle(color).fillRect(x, y, w, h);
    // Repeated wall sections extend beyond every camera bound, without a cap.
    rect(ink, b.x - 4, -2200, b.w + 8, front + 2204);
    rect(burgundy, b.x, -2200, b.w, front + 2200);
    for (let y = front - 270; y > -2300; y -= 250) {
      rect(cream, b.x, y, b.w, 18);
      rect(ink, b.x, y + 18, b.w, 3);
      for (let x = b.x; x <= b.x + b.w; x += 246) {
        rect(cream, x, y - 230, 22, 230);
        if (x < b.x + b.w - 150) {
          rect(ink, x + 74, y - 196, 98, 135);
          rect(0xffdf83, x + 79, y - 191, 88, 125);
          rect(ink, x + 121, y - 191, 4, 125);
          rect(ink, x + 79, y - 133, 88, 4);
        }
      }
    }
    for(let x=b.x;x<=b.x+b.w;x+=246)rect(cream,x,front-250,22,250);
    rect(cream, b.x, front - 16, b.w, 16);
    for (const x of [1160, 1550, 1900]) {
      rect(ink, x - 96, front - 186, 192, 151);
      rect(0xffdf83, x - 90, front - 180, 180, 139);
      rect(ink, x - 2, front - 180, 4, 139);
      rect(ink, x - 90, front - 114, 180, 4);
      rect(0x315d4c, x - 106, front - 39, 212, 25);
      rect(0xf7fbff, x - 106, front - 41, 212, 8);
    }
    const doorX = STREET.entrance.x;
    rect(ink, doorX - 77, front - 198, 154, 198);
    rect(0x68412f, doorX - 70, front - 191, 140, 191);
    rect(gold, doorX - 75, front - 198, 150, 8);
    rect(ink, doorX - 2, front - 191, 4, 191);
    rect(gold, doorX-76, front-191, 5, 191);
    rect(gold, doorX+71, front-191, 5, 191);
    rect(gold, doorX - 13, front - 105, 5, 37);
    rect(gold, doorX + 8, front - 105, 5, 37);
    wall.fillStyle(burgundy).fillEllipse(doorX, front - 207, 200, 96);
    wall.lineStyle(3, cream).strokeEllipse(doorX, front - 207, 200, 96);
    rect(burgundy, doorX - 100, front - 207, 200, 45);
    wall.lineStyle(2,cream).lineBetween(doorX-100,front-162,doorX+100,front-162);
    wall.fillStyle(gold).fillPoints([
      {x:doorX-24,y:front-230},{x:doorX-13,y:front-216},{x:doorX,y:front-241},
      {x:doorX+13,y:front-216},{x:doorX+24,y:front-230},{x:doorX+18,y:front-202},{x:doorX-18,y:front-202},
    ],true);
    for(const side of [-1,1]){
      const x=doorX+side*126;
      rect(ink,x-30,front-17,60,31);rect(0x9b633f,x-26,front-13,52,23);
      wall.fillStyle(0x2b5d48).fillTriangle(x-31,front-18,x,front-103,x+31,front-18);
      wall.fillStyle(0x39735b).fillTriangle(x-23,front-54,x,front-119,x+23,front-54);
      wall.fillStyle(0xf7fbff).fillTriangle(x-11,front-91,x,front-119,x+11,front-91);
      rect(ink,x-4,front-170,8,42);rect(ink,x-18,front-202,36,34);rect(0xffdf78,x-12,front-196,24,22);
    }
    const name = scene.add.text(doorX + 285, front - 221, 'ROYAL', {
      fontFamily: 'Georgia', fontSize: '40px', fontStyle: 'bold', color: '#f1ca61',
    }).setOrigin(.5);
    rect(0xaa3749, doorX - 78, front, 156, 28);
    const entry=scene.add.text(doorX,front-186,t('ВХОД'),{fontFamily:'Arial',fontSize:'12px',fontStyle:'bold',color:'#f1ca61'}).setOrigin(.5);
    this.facade = scene.add.container(0, 0, [wall, name, entry]).setDepth(front);
    scene.add.zone(doorX, front - 82, 170, 200).setDepth(front + 1).setInteractive({ useHandCursor: true }).on('pointerdown', enter);
  }
  update(player: Point, overview: boolean) {
    this.facade.setVisible(!overview).setAlpha(streetFacadeAlpha(player));
    this.plan.setVisible(true);
  }
  get alpha() { return this.facade.alpha; }
}
