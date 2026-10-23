import { SkinStudioUI } from '../../src/ui/SkinStudioUI';
import type { Account } from '../../server/accounts';
import type { RoomScene } from '../../src/game/RoomScene';
import Phaser from 'phaser';
import { characterTexture, createCharacters, pruneCharacterTextures } from '../../src/game/characters';
import { SKIN_THEME } from '../../src/shared/skinStudio';
let account: Account | null = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Игрок', email: 'skin@example.test', skin: 0, appearance: null };
const studio = new SkinStudioUI({ setLocked: () => {} } as unknown as RoomScene, () => account, async () => {});
(window as any).skinPreview = { studio, setAccount(value: Account | null) { account = value; window.dispatchEvent(new Event('royal-account')); },
  async render(id: string) {
    const host = document.createElement('div'); host.id = 'skin-game-preview'; document.body.append(host);
    const scene = new Phaser.Scene('skin-preview');
    let game: Phaser.Game;
    await new Promise<void>(resolve => {
      scene.create = function () {
        createCharacters(this);
        const key = characterTexture(this, 0, JSON.stringify({ version: 2, skinId: id, theme: SKIN_THEME.id }));
        this.add.sprite(160, 350, key, 'down-6').setScale(3);
        (window as any).skinPreview.scene = this; (window as any).skinPreview.key = key;
        resolve();
      };
      game = new Phaser.Game({ type: Phaser.CANVAS, width: 320, height: 480, parent: host, scene: [scene], audio: { noAudio: true } });
    });
    return (window as any).skinPreview.key;
  },
  pixels(frame: string) {
    const scene = (window as any).skinPreview.scene as Phaser.Scene, key = (window as any).skinPreview.key;
    const texture = scene.textures.get(key) as Phaser.Textures.CanvasTexture, f = texture.get(frame);
    return Array.from(texture.context.getImageData(f.cutX, f.cutY, f.cutWidth, f.cutHeight).data);
  },
  prune() { const scene = (window as any).skinPreview.scene as Phaser.Scene; scene.children.removeAll(true); pruneCharacterTextures(scene, new Set()); return scene.textures.exists((window as any).skinPreview.key); },
};
window.dispatchEvent(new Event('royal-account'));
