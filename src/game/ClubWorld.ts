import Phaser from 'phaser';
import { RoomScene } from './RoomScene';

/** Imported only when the player enters the walkable club. */
export function createClubWorld(options: Omit<ConstructorParameters<typeof RoomScene>[0], 'onReady'>) {
  return new Promise<{ scene: RoomScene; game: Phaser.Game }>(resolve => {
    const scene = new RoomScene({ ...options, onReady: () => resolve({ scene, game }) });
    const parent = document.querySelector<HTMLElement>('#game')!;
    const game = new Phaser.Game({
      type: Phaser.AUTO, parent, width: Math.max(1,parent.clientWidth), height: Math.max(1,parent.clientHeight),
      backgroundColor: '#191d35', pixelArt: false, roundPixels: false,
      scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
      input: { windowEvents: false }, scene: [scene], audio: { noAudio: true }, banner: false,
    });
  });
}
