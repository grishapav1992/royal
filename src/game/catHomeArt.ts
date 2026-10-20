import type Phaser from 'phaser';
import { CAT_HOME } from '../shared/catHome';

const TEXTURE = 'cat-sunny-window';

/** The light stays constant, including when the rest of the club is at night. */
export function drawCatHome(scene: Phaser.Scene) {
  const { window } = CAT_HOME;
  if (!scene.textures.exists(TEXTURE)) {
    const texture = scene.textures.createCanvas(TEXTURE, 400, 300)!;
    const c = texture.context;
    c.scale(2, 2);
    c.lineJoin = 'round';
    c.lineCap = 'round';
    const rect = (x: number, y: number, w: number, h: number, color: string, radius = 0) => {
      c.fillStyle = color;
      c.beginPath(); c.roundRect(x, y, w, h, radius); c.fill();
    };
    rect(10, 4, 180, 118, '#342832', 6);
    rect(14, 7, 172, 112, '#f5f1e8', 4);
    const sky = c.createLinearGradient(0, 13, 0, 105);
    sky.addColorStop(0, '#a9d7e5'); sky.addColorStop(1, '#fff0c5');
    c.fillStyle = sky; c.fillRect(22, 14, 156, 93);
    // Low greenery leaves the sky and sunlight open above the sill.
    c.fillStyle = '#a9bc8b';
    c.beginPath(); c.moveTo(22, 100); c.quadraticCurveTo(63, 73, 100, 99);
    c.quadraticCurveTo(140, 82, 178, 96); c.lineTo(178, 108); c.lineTo(22, 108); c.fill();
    rect(96, 13, 7, 94, '#fffdf4');
    rect(22, 62, 156, 5, '#fffdf4');
    rect(18, 106, 164, 8, '#e8e5dc');
    // A deep white sill gives the cushion its own surface above the floor.
    rect(1, 115, 198, 16, '#d2d4d5', 4);
    rect(0, 110, 200, 14, '#fffdf7', 4);
    rect(8, 130, 184, 6, '#aeb4bb', 2);
    c.fillStyle = '#b5b5af55'; c.beginPath(); c.ellipse(100, 120, 70, 12, 0, 0, Math.PI * 2); c.fill();
    const pillow = c.createLinearGradient(0, 101, 0, 128);
    pillow.addColorStop(0, '#b5b7ba'); pillow.addColorStop(.6, '#93969b'); pillow.addColorStop(1, '#6f737b');
    c.fillStyle = pillow; c.beginPath(); c.roundRect(36, 100, 128, 27, 12); c.fill();
    c.strokeStyle = '#c6c7c8'; c.lineWidth = 1;
    c.beginPath(); c.roundRect(40, 103, 120, 19, 9); c.stroke();
    c.strokeStyle = '#747880'; c.lineWidth = 1.3;
    for (const x of [43, 157]) { c.beginPath(); c.moveTo(x, 109); c.lineTo(x + (x < 100 ? 7 : -7), 115); c.stroke(); }
    texture.refresh();
    scene.events.once('shutdown', () => scene.textures.remove(TEXTURE));
  }
  // Translucent panes cast one continuous, steady patch onto the carpet.
  const sunlight = scene.add.graphics().setDepth(.035).setName('cat-home-sunlight');
  sunlight.fillStyle(0xffe6a3, .12);
  sunlight.fillPoints([{ x: window.x - 70, y: 174 }, { x: window.x + 70, y: 174 },
    { x: window.x + 161, y: 314 }, { x: window.x - 53, y: 314 }], true);
  sunlight.fillStyle(0xffefbf, .09);
  for (const offset of [-60, 12]) {
    sunlight.fillPoints([{ x: window.x + offset, y: 178 }, { x: window.x + offset + 57, y: 178 },
      { x: window.x + offset + 129, y: 291 }, { x: window.x + offset + 56, y: 291 }], true);
  }
  return scene.add.image(window.x, window.y - 59, TEXTURE).setOrigin(.5, 0).setDisplaySize(200, 150)
    .setDepth(3).setName('cat-home-window');
}
