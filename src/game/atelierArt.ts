import type Phaser from 'phaser';
import { ATELIER } from '../shared/atelier';
import { TailorRenderer, ATELIER_EMPTY_TEXTURE, TAILOR_TEXTURE } from './TailorRenderer';

export const ATELIER_TEXTURE = 'wall-atelier-reference-v2';
export const ATELIER_SPRITE = '/assets/atelier/wall-atelier-v2.webp';

/** Use the same illustrated tailor in the room and in the order window. */
export function tailorPortrait() {
  const canvas = document.createElement('canvas'); canvas.width = 176; canvas.height = 200;
  canvas.setAttribute('aria-label', 'Пожилой портной в очках и жилете'); canvas.setAttribute('role', 'img');
  const image = new Image();
  image.onload = () => {
    canvas.getContext('2d')!.drawImage(image,
      image.naturalWidth * .355, image.naturalHeight * .40,
      image.naturalWidth * .23, image.naturalHeight * .35,
      0, 0, canvas.width, canvas.height);
  };
  image.src = ATELIER_SPRITE;
  return canvas;
}

export function drawAtelier(scene: Phaser.Scene, open: () => void) {
  if (scene.textures.exists(ATELIER_EMPTY_TEXTURE) && scene.textures.exists(TAILOR_TEXTURE)) return new TailorRenderer(scene, open);
  scene.add.image(ATELIER.x, ATELIER.top, ATELIER_TEXTURE)
    .setOrigin(.5, 0).setDisplaySize(ATELIER.width, ATELIER.height)
    .setDepth(180).setName('wall-atelier')
    .setInteractive({ useHandCursor: true }).on('pointerdown', open);
}
