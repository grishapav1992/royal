import { t as translateText } from '../i18n/index';
import Phaser from 'phaser';
import type { Cabinet } from '../shared/cabinets';
import { cabinetSeat } from '../shared/cabinetSeating';

export type CabinetStool = {
  container: Phaser.GameObjects.Container;
  setOccupied: (occupied: boolean) => void;
  destroy: () => void;
};

/** Leather, brass and a raised foot ring match the club's cabinet furniture. */
export function drawCabinetStool(scene: Phaser.Scene, cabinet: Cabinet, onClick: () => void, options: { label?: string; width?: number } = {}): CabinetStool {
  const key = `cabinet-barstool-${cabinet.color.toString(16)}`;
  if (!scene.textures.exists(key)) {
    const texture = scene.textures.createCanvas(key, 156, 156)!;
    const c = texture.context;
    c.scale(3, 3); c.lineCap = 'round'; c.lineJoin = 'round';
    const oval = (x: number, y: number, rx: number, ry: number, color: string, edge = '') => {
      c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
      if (edge) { c.strokeStyle = edge; c.lineWidth = .8; c.stroke(); }
    };
    const line = (x: number, y: number, endX: number, endY: number, color: string, width: number) => {
      c.beginPath(); c.moveTo(x, y); c.lineTo(endX, endY); c.strokeStyle = color; c.lineWidth = width; c.stroke();
    };
    oval(26, 48, 21, 3.7, '#10192355');
    oval(26, 46, 13.8, 4, '#483c33', '#292731');
    oval(26, 44.8, 12.8, 3.5, '#b28b52', '#3a3030');
    oval(26, 44.2, 9.7, 2.3, '#ddbe85');
    line(26, 30, 26, 44.4, '#3c3030', 6.5);
    line(26, 30, 26, 44.2, '#c49b5f', 4.7);
    line(24.9, 31, 24.9, 43, '#f3d69d', 1.1);
    c.beginPath(); c.ellipse(26, 39.5, 12, 3.5, 0, 0, Math.PI * 2); c.strokeStyle = '#4c3932'; c.lineWidth = 2.8; c.stroke();
    c.strokeStyle = '#d9b779'; c.lineWidth = 1.5; c.stroke();
    // A low curved back leaves the player's shoulders and moving arms visible.
    for (const x of [12.5, 39.5]) {
      line(x, 28, x, 19, '#382d31', 3.2);
      line(x, 28, x, 19, '#bd945b', 1.8);
    }
    c.beginPath(); c.roundRect(11, 13, 30, 10, 4.7); c.fillStyle = '#492737'; c.fill(); c.strokeStyle = '#cca56a'; c.lineWidth = 1; c.stroke();
    line(15, 16, 37, 16, '#a05a63', .8);
    for (const x of [19, 26, 33]) oval(x, 19.1, .65, .65, '#d2ac75');
    oval(26, 31, 18.3, 6.5, '#302630', '#211e29');
    oval(26, 29.3, 18.3, 6, '#956d45', '#302630');
    oval(26, 27.2, 17.8, 5.9, '#71374a', '#d1aa6d');
    oval(26, 26.3, 15.9, 4.6, '#9b4a5b');
    c.beginPath(); c.ellipse(26, 26.2, 14.3, 3.5, 0, Math.PI * 1.06, Math.PI * 1.94); c.strokeStyle = '#bf7880'; c.lineWidth = .8; c.stroke();
    line(13.5, 32.5, 38.5, 32.5, '#' + cabinet.color.toString(16).padStart(6, '0'), .8);
    texture.refresh();
  }
  const seat = cabinetSeat(cabinet);
  const glow = scene.add.ellipse(0, -3, 47, 15, cabinet.color, .2).setVisible(false);
  const stool = scene.add.image(0, 0, key).setOrigin(.5, 1).setDisplaySize(options.width ?? 52, 52);
  const occupiedMark = scene.add.graphics().setVisible(false);
  occupiedMark.fillStyle(0x302332).fillCircle(22, -27, 5.4);
  occupiedMark.lineStyle(1, 0xe2bd82).strokeCircle(22, -27, 5.4);
  occupiedMark.fillStyle(0xd98a73).fillCircle(22, -27, 2.5);
  const hit = scene.add.zone(0, -22, 45, 43).setInteractive({ useHandCursor: true });
  hit.on('pointerdown', onClick).on('pointerover', () => glow.setVisible(true)).on('pointerout', () => glow.setVisible(false));
  const container = scene.add.container(seat.x, seat.y, [glow, stool, occupiedMark, hit]).setDepth(seat.y - .5).setName(`cabinet-stool-${cabinet.id}`);
  const label = options.label ? scene.add.text(0, 5, options.label, {
    fontFamily: 'Arial', fontSize: '9px', color: '#f0d39a', backgroundColor: '#282231', padding: { x: 6, y: 3 },
  }).setOrigin(.5, 0).setInteractive({ useHandCursor: true }).on('pointerdown', onClick).setName(`cabinet-stool-label-${cabinet.id}`) : undefined;
  if (label) container.add(label);
  return {
    container,
    setOccupied: occupied => { occupiedMark.setVisible(occupied); label?.setText(occupied ? translateText('Занято') : options.label!); },
    destroy: () => container.destroy(),
  };
}
