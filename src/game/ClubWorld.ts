import Phaser from 'phaser';
import { RoomScene } from './RoomScene';
import { WORLD } from './navigation';

/** Imported only when the player enters the walkable club. */
export function createClubWorld(options: Omit<ConstructorParameters<typeof RoomScene>[0], 'onReady'>) {
  return new Promise<{ scene: RoomScene; game: Phaser.Game }>(resolve => {
    const parent = document.querySelector<HTMLElement>('#game')!;
    const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const scene = new RoomScene({ ...options, onReady: () => {
      const observer = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        if (width <= 0 || height <= 0) return;
        const rasterWidth = Math.round(width * density);
        const rasterHeight = Math.round(height * density);
        if (rasterWidth !== game.scale.width || rasterHeight !== game.scale.height) {
          game.scale.resize(rasterWidth, rasterHeight);
        }
      });
      observer.observe(parent);
      game.events.once(Phaser.Core.Events.DESTROY, () => observer.disconnect());
      resolve({ scene, game });
    } });
    const game = new Phaser.Game({
      type: Phaser.AUTO, parent,
      width: Math.round((parent.clientWidth || WORLD.width) * density),
      height: Math.round((parent.clientHeight || WORLD.height) * density),
      backgroundColor: '#191d35', pixelArt: false, roundPixels: false,
      // Keep input coordinates and the backing canvas in the same pixel space.
      scale: { mode: Phaser.Scale.NONE, zoom: 1 / density, autoCenter: Phaser.Scale.NO_CENTER },
      input: { windowEvents: false }, scene: [scene], audio: { noAudio: true }, banner: false,
    });
  });
}
