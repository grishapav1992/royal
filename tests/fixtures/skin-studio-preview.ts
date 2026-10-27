import { SkinStudioUI } from '../../src/ui/SkinStudioUI';
import type { Account } from '../../server/accounts';
import type { RoomScene } from '../../src/game/RoomScene';
import Phaser from 'phaser';
import { characterTexture, createCharacters, createCharacterPortrait, pruneCharacterTextures } from '../../src/game/characters';
import { hasSkinSheet, loadSkinSheet } from '../../src/game/generatedSkinArt';
import { SKIN_THEME } from '../../src/shared/skinStudio';
import { createCharacterMotion } from '../../src/game/characterAnimation';
let account: Account | null = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Игрок', email: 'skin@example.test', skin: 0, appearance: null };
const studio = new SkinStudioUI({ setLocked: () => {} } as unknown as RoomScene, () => account, async () => {});
(window as any).skinPreview = { studio, setAccount(value: Account | null) { account = value; window.dispatchEvent(new Event('royal-account')); },
  async miraPortrait(id: string) {
    const [{ RoomScene }, { MiraChat }] = await Promise.all([import('../../src/game/RoomScene'), import('../../src/ui/MiraChat')]);
    const host = document.createElement('section'); host.className = 'room-panel'; host.style.cssText = 'width:640px;height:800px'; document.body.append(host);
    const dialog = document.createElement('dialog'); dialog.id = 'bar-dialog'; host.append(dialog);
    const appearance = JSON.stringify({ version: 2, skinId: id, theme: SKIN_THEME.id });
    const room = Object.create(RoomScene.prototype) as RoomScene;
    (room as any).player = { skin: 0, appearance, soberAt: 0, action: 'idle', drink: '', sprite: { texture: { key: 'avatar-generated-' + id } } };
    (room as any).portraitFrames = new Map();
    const chat = new MiraChat(dialog, { playerState: () => room.getDialoguePlayer(), portraitFrame: (action, frame) => room.getPortraitFrame(action, frame) });
    dialog.show(); chat.open();
    (window as any).skinPreview.portraitLoaded = () => hasSkinSheet(id);
    (window as any).skinPreview.portraitExpected = () => createCharacterPortrait(0, appearance, 6, 0).toDataURL();
    (window as any).skinPreview.portraitCached = () => room.getPortraitFrame('idle', 0);
    void loadSkinSheet(id);
    return dialog.querySelector<HTMLImageElement>('.mira-player-avatar')!.src;
  },
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
  async motion(id: string) {
    const preview = (window as any).skinPreview;
    await preview.render(id);
    const [{ RoomScene }, { gameAudio }, { CHARACTER_SCALE, characterScaleY }] = await Promise.all([
      import('../../src/game/RoomScene'), import('../../src/game/GameAudio'), import('../../src/game/characters'),
    ]);
    const scene = preview.scene as Phaser.Scene;
    const sprite = scene.add.sprite(160, 350, preview.key, 'down-6').setOrigin(.5, 1);
    const actor = { sprite, shadow: scene.add.ellipse(160, 350, 20, 8), blush: scene.add.graphics(),
      x: 160, y: 350, visualX: 160, visualY: 350, visualAt: 0, phase: 13, motion: createCharacterMotion(),
      moving: false, facing: 'down', appearance: id ? JSON.stringify({ version: 2, skinId: id, theme: SKIN_THEME.id }) : '',
      soberAt: 0, seat: '', action: 'idle', cabinet: '', gameReaction: '', gameReactionUntil: 0, visualSeat: '', seatedAt: 0 };
    let sounds = 0;
    gameAudio.effect = ((name: string) => { if (name === 'step') sounds++; }) as typeof gameAudio.effect;
    Object.assign(scene, { player: actor, correction: { x: 0, y: 0 }, reducedMotion: false });
    preview.advance = (input: { time: number; distance?: number; moving?: boolean; facing?: string; reduced?: boolean; seat?: string; action?: string }) => {
      actor.x += input.distance ?? 0;
      if (input.facing) actor.facing = input.facing;
      if (input.seat !== undefined) actor.seat = input.seat;
      if (input.action !== undefined) actor.action = input.action;
      (scene as any).reducedMotion = input.reduced ?? false;
      (RoomScene.prototype as any).animateActor.call(scene, actor, input.time, input.moving ?? true);
      return { frame: sprite.frame.name, sounds, x: sprite.x, y: sprite.y,
        scaleX: sprite.scaleX / CHARACTER_SCALE, scaleY: sprite.scaleY / characterScaleY(actor.appearance),
        phase: actor.motion.distance, playing: sprite.anims.isPlaying };
    };
    preview.motionFrame = () => sprite.frame.name;
  },
  prune() { const scene = (window as any).skinPreview.scene as Phaser.Scene; scene.children.removeAll(true); pruneCharacterTextures(scene, new Set()); return scene.textures.exists((window as any).skinPreview.key); },
};
window.dispatchEvent(new Event('royal-account'));
