import Phaser from 'phaser';
import { t } from '../i18n/index';
import { HALL_WALL } from '../shared/clubGeometry';
import { RESTROOM } from '../shared/restroom';

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
  scene.add.text(1040, 240, t('РАКОВИНЫ'), { fontFamily: 'Arial', fontSize: '12px', color: '#5b7267', letterSpacing: 2 }).setOrigin(.5).setDepth(1);
  scene.add.text(530, 740, 'WC', { fontFamily: 'Georgia', fontSize: '64px', color: '#70897a' }).setOrigin(.5).setAlpha(.4).setDepth(1);
}
