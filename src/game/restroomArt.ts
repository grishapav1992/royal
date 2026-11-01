import Phaser from 'phaser';
import { t } from '../i18n/index';
import { HALL_WALL } from '../shared/clubGeometry';
import { RESTROOM, RESTROOM_BALCONY, RESTROOM_WINDOW } from '../shared/restroom';

export function drawRestroom(scene: Phaser.Scene) {
  const { width, height } = RESTROOM.size;
  const floor = scene.add.graphics().setDepth(.01);
  floor.fillStyle(0x18292e).fillRect(0, HALL_WALL.viewTop, width, height - HALL_WALL.viewTop);
  floor.fillStyle(0xddd9c9).fillRect(55, 175, width - 110, 900);
  for (let y = 175, row = 0; y < 1075; y += 60, row++) {
    for (let x = 55, col = 0; x < width - 55; x += 60, col++) {
      floor.fillStyle((row + col) % 2 ? 0xcbd5ce : 0xe6e6d9).fillRect(x + 2, y + 2, Math.min(56, width - 57 - x), 56);
      if(x + 34 < width - 55)floor.fillStyle(0x839c91, .5).fillRect(x + 26, y + 26, 8, 8);
    }
  }
  floor.lineStyle(4, 0xa58b58).strokeRect(63, 183, width - 126, 884);
  const wall = scene.add.graphics().setDepth(2);
  wall.fillStyle(0x305950).fillRect(55, HALL_WALL.top, width - 110, 275);
  for (let y = -90; y < 165; y += 35) {
    wall.lineStyle(1, 0x6e9483, .5).lineBetween(55, y, width - 55, y);
    for (let x = 55 + (y % 2 ? 45 : 0); x < width - 55; x += 90) wall.lineBetween(x, y, x, y + 35);
  }
  wall.fillStyle(0xbca270).fillRect(55, 164, width - 110, 11).fillRect(55, -100, width - 110, 8);
  wall.fillStyle(0x25453f).fillRect(40, -100, 15, 1175).fillRect(width - 55, -100, 15, 1175);
  wall.fillStyle(0xbca270).fillRect(40, 1068, 800, 8).fillRect(960, 1068, 440, 8);
  scene.add.text(520, 50, t('ТУАЛЕТ · ЭТАЖ 3'), { fontFamily: 'Georgia', fontSize: '28px', color: '#f1e4bf', letterSpacing: 3 }).setOrigin(.5).setDepth(3);
  for (const x of RESTROOM.stalls) {
    const fixture = scene.add.graphics().setDepth(325);
    fixture.fillStyle(0x142927, .16).fillEllipse(x, 316, 98, 35);
    fixture.fillStyle(0xa4b6ae).fillRoundedRect(x - 32, 210, 64, 45, 8);
    fixture.fillStyle(0xf0f2e8).fillRoundedRect(x - 32, 205, 64, 42, 8).fillEllipse(x, 280, 67, 83);
    fixture.lineStyle(7, 0xf6f7ef).strokeEllipse(x, 278, 52, 63);
    fixture.fillStyle(0xa1b9b3).fillEllipse(x, 278, 36, 45);
    fixture.fillStyle(0xb8a375).fillRect(x + 17, 218, 8, 5);
    const partition = scene.add.graphics().setDepth(515);
    partition.fillStyle(0x476b5c).fillRect(x - 110, 195, 14, 320).fillRect(x + 96, 195, 14, 320);
    partition.fillStyle(0xc6ac7d).fillRect(x - 110, 195, 14, 7).fillRect(x + 96, 195, 14, 7);
    // Open doors leave a visible, walkable opening into each cubicle.
    partition.fillStyle(0x748d77).fillRoundedRect(x - 93, 454, 58, 60, 3);
    partition.lineStyle(2, 0xc6ac7d).strokeRoundedRect(x - 93, 454, 58, 60, 3);
    partition.fillStyle(0xe0c98d).fillCircle(x - 45, 490, 4);
  }
  for (const y of RESTROOM.sinks) {
    const sink = scene.add.graphics().setDepth(y + 65);
    sink.fillStyle(0x1c3530, .18).fillRoundedRect(1190, y - 58, 178, 139, 10);
    sink.fillStyle(0xa98d64).fillRoundedRect(1200, y - 65, 160, 130, 8);
    sink.fillStyle(0xeee9d9).fillRoundedRect(1200, y - 72, 160, 122, 8);
    sink.fillStyle(0xd9e5df).fillEllipse(1260, y - 4, 91, 74);
    sink.lineStyle(3, 0xffffff).strokeEllipse(1260, y - 4, 91, 74);
    sink.fillStyle(0x647c77).fillCircle(1260, y + 6, 5);
    sink.lineStyle(8, 0xa8bcb7).lineBetween(1310, y - 8, 1290, y - 8);
    sink.fillStyle(0xbca270).fillRoundedRect(1320, y - 124, 38, 74, 5);
    sink.fillStyle(0x93c2c0).fillRoundedRect(1325, y - 119, 28, 64, 3);
    sink.lineStyle(2, 0xd9eeea, .7).lineBetween(1329, y - 69, 1347, y - 107);
    sink.fillStyle(0x567c71).fillRoundedRect(1215, y - 54, 17, 23, 3);
    sink.fillStyle(0xc9b482).fillRect(1219, y - 60, 13, 5);
  }
  scene.add.text(1250, 240, t('РАКОВИНЫ'), { fontFamily: 'Arial', fontSize: '12px', color: '#5b7267', letterSpacing: 2 }).setOrigin(.5).setDepth(1);
  scene.add.text(530, 740, 'WC', { fontFamily: 'Georgia', fontSize: '64px', color: '#70897a' }).setOrigin(.5).setAlpha(.4).setDepth(1);
}

export function drawRestroomWindow(scene: Phaser.Scene, outside: boolean, onClimb: () => void) {
  const x = RESTROOM_WINDOW.entry.x, g = scene.add.graphics().setDepth(225);
  g.fillStyle(0x13222b).fillRoundedRect(x - 60, 27, 120, 140, 4);
  g.fillStyle(outside ? 0xe4d8b1 : 0x23374c).fillRect(x - 50, 37, 100, 118);
  if (outside) {
    g.fillStyle(0x426b5e).fillRect(x - 50, 37, 100, 50);
    g.lineStyle(1, 0x91a792, .6).lineBetween(x - 50, 70, x + 50, 70);
    g.fillStyle(0xb4c5af).fillRect(x - 38, 107, 76, 48);
  } else {
    g.fillStyle(0xf3dc99).fillCircle(x + 24, 59, 12);
    g.fillStyle(0x152433).fillRect(x - 50, 114, 34, 41).fillRect(x - 10, 97, 31, 58).fillRect(x + 26, 121, 24, 34);
    for (const [dx, y] of [[-38, 128], [0, 110], [0, 135], [34, 137]]) g.fillStyle(0xeac48a, .65).fillRect(x + dx, y, 6, 7);
  }
  // The hinged sash is visibly swung away from the clear opening.
  g.fillStyle(0x91b8b4, .65).fillPoints([{ x: x - 55, y: 35 }, { x: x - 99, y: 58 }, { x: x - 99, y: 164 }, { x: x - 55, y: 155 }], true);
  g.lineStyle(5, 0xc3b18a).strokePoints([{ x: x - 55, y: 35 }, { x: x - 99, y: 58 }, { x: x - 99, y: 164 }, { x: x - 55, y: 155 }, { x: x - 55, y: 35 }]);
  g.lineStyle(2, 0xe2f1e4, .65).lineBetween(x - 86, 144, x - 65, 66);
  g.lineStyle(6, 0xc3b18a).strokeRect(x - 55, 32, 110, 126);
  g.fillStyle(0xe4d3a5).fillRoundedRect(x - 66, 158, 132, 14, 3);
  g.lineStyle(3, 0xb6a37c).lineBetween(x - 65, 174, x + 65, 174);
  const label = outside ? t('Залезть обратно') : t('Вылезти через окно');
  scene.add.text(x, 5, label, { fontFamily: 'Arial', fontSize: '13px', color: '#f5e6c0', backgroundColor: '#243d36', padding: { x: 8, y: 5 } }).setOrigin(.5).setDepth(226);
  scene.add.zone(x - 15, 98, 170, 170).setDepth(230).setName('restroom-open-window').setInteractive({ useHandCursor: true }).on('pointerdown', onClimb);
}

export function drawRestroomBalcony(scene: Phaser.Scene) {
  const { width, height } = RESTROOM_BALCONY.size;
  const sky = scene.add.graphics().setDepth(.01);
  sky.fillStyle(0x18243b).fillRect(0, HALL_WALL.viewTop, width, height - HALL_WALL.viewTop);
  for (let i = 0; i < 28; i++) sky.fillStyle(0xe3debe, .6).fillCircle(25 + i * 53 % width, 640 + i * 17 % 110, i % 3 ? 1 : 2);
  for (let i = 0; i < 13; i++) {
    const x = i * 120, y = 710 + i % 3 * 14;
    sky.fillStyle(0x111d30).fillRect(x, y, 100, height - y);
    sky.fillStyle(0xbda775, .45).fillRect(x + 18, y + 10, 6, 9).fillRect(x + 65, y + 20, 6, 9);
  }
  sky.fillStyle(0x314550).fillRect(55, 175, width - 110, 460);
  for (let y = 182; y < 630; y += 35) {
    sky.fillStyle(0x697d7d).fillRect(63, y, width - 126, 30);
    sky.lineStyle(1, 0xa7a99c, .45).lineBetween(64, y + 2, width - 64, y + 2);
  }
  const wall = scene.add.graphics().setDepth(2);
  wall.fillStyle(0x586b69).fillRect(55, -100, width - 110, 275);
  for (let y = -94; y < 170; y += 32) {
    wall.lineStyle(2, 0x344c4b).lineBetween(55, y, width - 55, y);
    for (let x = 55 + (y % 3 ? 48 : 0); x < width - 55; x += 96) wall.lineBetween(x, y, x, y + 32);
  }
  wall.fillStyle(0xb7a478).fillRect(55, 165, width - 110, 10);
  scene.add.text(480, 55, t('СЛУЖЕБНЫЙ БАЛКОН · ЭТАЖ 3'), { fontFamily: 'Georgia', fontSize: '22px', color: '#e6dbba' }).setOrigin(.5).setDepth(3);
  const rail = scene.add.graphics().setDepth(635);
  rail.lineStyle(8, 0x253e40).lineBetween(55, 195, 55, 633).lineBetween(width - 55, 195, width - 55, 633).lineBetween(55, 633, width - 55, 633);
  rail.lineStyle(3, 0xa0b6ab).lineBetween(55, 598, width - 55, 598);
  for (let x = 70; x < width - 55; x += 48) rail.lineStyle(4, 0x8a9e96).lineBetween(x, 600, x, 632);
}
