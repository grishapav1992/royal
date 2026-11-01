import type Phaser from 'phaser';
import { t } from '../i18n';
import { HALLS, type HallId } from '../shared/world';
import { elevatorDock } from '../shared/elevator';
import { HALL_WALL } from '../shared/clubGeometry';

export function drawElevator(scene: Phaser.Scene, hall: HallId, approach: () => void) {
  const dock = elevatorDock(hall), front = dock.facing === 'down';
  const top = front ? 79 + HALL_WALL.doorOffset : dock.y - 14;
  const height = front ? 155 : 64, depth = front ? 225 : 3;
  const g = scene.add.graphics().setDepth(depth);
  g.fillStyle(0x30252d).fillRoundedRect(dock.x - 63, top - 7, 126, height + 12, 6);
  g.fillStyle(0xb99057).fillRoundedRect(dock.x - 57, top, 114, height, 3);
  g.fillStyle(0x252c35).fillRect(dock.x - 48, top + 9, 96, height - 18);
  for (const side of [-1, 1]) {
    const left = side < 0 ? dock.x - 45 : dock.x + 2;
    g.fillStyle(0x65737b).fillRect(left, top + 12, 43, height - 25);
    g.fillStyle(0x94a1a4, .5).fillRect(left + 5, top + 13, 3, height - 27);
    g.lineStyle(1, 0xd2bc89, .65).lineBetween(left + 12, top + 19, left + 12, top + height - 21);
  }
  g.fillStyle(0xf2d28d).fillRect(dock.x - 57, top, 114, 3);
  g.fillStyle(0xe2c17c).fillRect(dock.x - 59, top + height - 5, 118, 6);
  g.fillStyle(0x26373d).fillRoundedRect(dock.x + 67, top + height * .5 - 12, 15, 27, 3);
  g.fillStyle(0xe4ca8a).fillCircle(dock.x + 74.5, top + height * .5, 3);
  scene.add.text(dock.x, top - (front ? 21 : 31), `${t('ЛИФТ')} · ${HALLS[hall].floor}`, {
    fontFamily: 'Arial', fontSize: front ? '17px' : '14px', fontStyle: 'bold',
    color: '#f5dfb1', backgroundColor: '#302b32', padding: { x: 12, y: 5 },
  }).setOrigin(.5).setDepth(depth + 1);
  const rug = scene.add.graphics().setDepth(1);
  rug.fillStyle(0xb99057, .2).fillRoundedRect(dock.x - 54, dock.entry.y - 21, 108, 42, 8);
  rug.lineStyle(1, 0xe2c17c, .55).strokeRoundedRect(dock.x - 50, dock.entry.y - 17, 100, 34, 6);
  scene.add.text(dock.x, dock.entry.y, '↕', { fontFamily: 'Arial', fontSize: '22px', color: '#f5dfb1' }).setOrigin(.5).setDepth(2);
  scene.add.zone(dock.x + 8, top + height / 2, 155, height + 50).setDepth(depth + 5)
    .setInteractive({ useHandCursor: true }).on('pointerdown', approach);
  scene.add.zone(dock.entry.x, dock.entry.y, 112, 50).setDepth(4)
    .setInteractive({ useHandCursor: true }).on('pointerdown', approach);
}
