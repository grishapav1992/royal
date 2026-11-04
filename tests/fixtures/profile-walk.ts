import Phaser from 'phaser';
import { createCharacters } from '../../src/game/characters';
import { drawAvatar } from '../../src/game/avatarArt';
import { DEFAULT_APPEARANCE, type Appearance } from '../../src/shared/appearance';
import type { Facing } from '../../src/shared/movement';
import { CHARACTER_WALK_FRAME_RATE } from '../../src/game/characterAnimation';

type Sample = { skin: number; label?: string } | { appearance: Partial<Appearance>; label?: string };
let scene: Phaser.Scene;
function render(sample: Sample, facing: Facing, frame: number, avatarRenderer = drawAvatar) {
  const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 144;
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  if ('skin' in sample) {
    const texture = scene.textures.get(`citizen-${sample.skin}`), cell = texture.get(`${facing}-${frame}`);
    c.drawImage(texture.getSourceImage() as HTMLCanvasElement, cell.cutX, cell.cutY, cell.cutWidth, cell.cutHeight, 0, 0, 96, 144);
  } else {
    const seated = frame === 10 || frame >= 17 && frame <= 22 || frame >= 25;
    const sip = frame >= 11 && frame <= 22 ? (frame - 11) % 6 : -1;
    const pose = frame >= 10 && frame <= 22 ? 6 : frame >= 25 && frame <= 27 ? [8, 7, 9][frame - 25] : frame;
    c.scale(3, 3); c.translate(0, 8);
    avatarRenderer(c, { ...DEFAULT_APPEARANCE, ...sample.appearance }, facing, pose, seated, sip);
  }
  return canvas;
}

const samples: Sample[] = [
  { skin: 2, label: 'НПС в куртке' }, { skin: 0, label: 'НПС в худи' }, { skin: 1, label: 'НПС с длинными волосами' },
  { skin: 7, label: 'НПС в жилете' }, { appearance: { topColor: 9, glasses: 3 }, label: 'Стандартный аватар' },
  { appearance: { body: 1, top: 1, bottom: 1, shoes: 1 }, label: 'Полный, шорты' },
  { appearance: { body: 2, top: 0, tattoo: 3 }, label: 'Высокий, футболка' },
  { appearance: { hair: 2, top: 4, bottom: 2, shoes: 2 }, label: 'Пальто, юбка' },
];
new Phaser.Game({ type: Phaser.CANVAS, width: 1, height: 1, parent: 'atlas', banner: false, audio: { noAudio: true }, scene: {
  create() {
    scene = this; createCharacters(scene);
    const cards = samples.map(sample => {
      const card = document.createElement('figure'), canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 144;
      const label = document.createElement('figcaption'); label.textContent = sample.label!;
      card.append(canvas, label); document.querySelector('#characters')!.append(card); return canvas;
    });
    const phases = document.createElement('canvas'); phases.width = 96 * 6; phases.height = 144 * 2;
    document.querySelector('#phases')!.append(phases);
    let playing = true, resting = false, frame = 0;
    document.querySelector('#play')!.addEventListener('click', () => { playing = !playing; document.querySelector('#play')!.textContent = playing ? 'Пауза' : 'Продолжить'; });
    document.querySelector('#rest')!.addEventListener('click', () => { resting = !resting; document.querySelector('#rest')!.textContent = resting ? 'Идти' : 'Стоять'; });
    function tick(time: number) {
      if (playing) frame = Math.floor(time / 1000 * CHARACTER_WALK_FRAME_RATE) % 6;
      const facing = (document.querySelector('#direction') as HTMLSelectElement).value as Facing;
      cards.forEach((canvas, i) => { const c = canvas.getContext('2d')!; c.clearRect(0, 0, 96, 144); c.drawImage(render(samples[i], facing, resting ? 6 : frame), 0, 0); });
      const c = phases.getContext('2d')!; c.clearRect(0, 0, phases.width, phases.height);
      for (let f = 0; f < 6; f++) { c.drawImage(render(samples[0], facing, f), f * 96, 0); c.drawImage(render(samples[4], facing, f), f * 96, 144); }
      requestAnimationFrame(tick);
    }
    Object.assign(window, { profileWalk: { render, scene, ready: true } }); requestAnimationFrame(tick);
  },
} });
