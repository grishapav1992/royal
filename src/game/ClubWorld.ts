import Phaser from 'phaser';
import { RoomScene } from './RoomScene';
import { WORLD } from './navigation';

/** Imported only when the player enters the walkable club. */
export function createClubWorld(options: Omit<ConstructorParameters<typeof RoomScene>[0], 'onReady'>) {
  return new Promise<{ scene: RoomScene; game: Phaser.Game }>(resolve => {
    const scene = new RoomScene({ ...options, onReady: () => resolve({ scene, game }) });
    const game = new Phaser.Game({
      type: Phaser.AUTO, parent: 'game', width: WORLD.width, height: WORLD.height,
      backgroundColor: '#191d35', pixelArt: false, roundPixels: false,
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
      input: { windowEvents: false }, scene: [scene], audio: { noAudio: true }, banner: false,
    });
    new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) game.scale.setParentSize(Math.floor(width), Math.floor(height));
    }).observe(document.querySelector('#game')!);
  });
}
