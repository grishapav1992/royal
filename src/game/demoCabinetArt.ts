import Phaser from 'phaser';
import type { Cabinet } from '../shared/cabinets';
import { watchCabinetDemoGame } from './demoGames';
import { CABINET_SCALE, CABINET_SIZE, cabinetScreen } from './cabinetArt';

export function addDemoCabinetArt(scene: Phaser.Scene, cabinet: Cabinet) {
  const title = scene.add.text(0, -148, 'Luelon Play', {
    fontFamily: 'Arial', fontSize: '11px', fontStyle: 'bold', color: '#ffe5aa',
    backgroundColor: '#171d2b', align: 'center', wordWrap: { width: 108 }, padding: { x: 5, y: 4 },
  }).setOrigin(.5, 1);
  const bounds = cabinetScreen(cabinet);
  const screenX = (bounds.x + bounds.width / 2 - CABINET_SIZE.width / 2) * CABINET_SCALE;
  const screenY = (bounds.y + bounds.height / 2 - CABINET_SIZE.height) * CABINET_SCALE;
  const screenWidth = bounds.width * CABINET_SCALE;
  const backing = scene.add.rectangle(screenX, screenY, screenWidth, bounds.height * CABINET_SCALE, 0x081420).setVisible(false);
  const cover = scene.add.image(screenX, screenY, '__DEFAULT').setVisible(false);
  // The container participates in hall visibility; its children retain their loading state.
  scene.add.container(cabinet.x, cabinet.y, [title, backing, cover]).setDepth(cabinet.y + .5).setName('demo-cabinet-preview');
  let alive = true, version = 0;
  const stop = watchCabinetDemoGame(game => {
    title.setText(game.name);
    const request = ++version;
    cover.setVisible(false); backing.setVisible(false);
    if (!game.artworkUrl) return;
    const key = `demo-cover:${game.artworkUrl}`;
    const show = () => {
      if (!alive || request !== version) return;
      backing.setVisible(true);
      cover.setTexture(key).setDisplaySize(screenWidth, screenWidth / 1.5).setVisible(true);
    };
    if (scene.textures.exists(key)) { show(); return; }
    const image = new Image();
    image.crossOrigin = 'anonymous'; image.referrerPolicy = 'no-referrer';
    image.onload = () => {
      if (!alive || request !== version) return;
      if (!scene.textures.exists(key)) scene.textures.addImage(key, image);
      show();
    };
    image.src = game.artworkUrl;
  });
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { alive = false; stop(); });
}
