import { extractSpriteFrames, type SpriteFrame } from '../../../../../src/ui/crLeoSprites';
import { bakeCrowd, type CrowdFrames } from './crowd';

export type Assets = { images: Map<string, HTMLImageElement>; frames: Map<string, SpriteFrame[]>; crowd: CrowdFrames };
const LIST: [key: string, file: string, bytes: number][] = [
  ['plate', 'stadium-clear.webp', 534746], ['clouds', 'clouds.webp', 11134], ['mask', 'crowd-mask.webp', 28696],
  ['cr', 'cr-white.webp', 867484], ['leo', 'leo.webp', 783588], ['keeper', 'keeper-empty.webp', 582340],
  ['keeper-reach', 'keeper-reach.webp', 530760], ['keeper-dive', 'keeper-dive.webp', 533804],
  ['wall', 'wall.webp', 1159788], ['wall-far', 'wall-far.webp', 1118900], ['ball', 'ball-ordem-v-atlas.webp', 598728],
];
const PLATES = new Set(['plate', 'clouds', 'mask']);
const yieldPaint = () => new Promise(r => setTimeout(r, 0));

/** Heads of the last row reach above their cell, so whole figures are picked. Only two of them touch: a boot and a head. */
function separated(image: HTMLImageElement): HTMLImageElement {
  const n = document.createElement('canvas'), k = image.width / 1254; n.width = image.width; n.height = image.height;
  const c = n.getContext('2d')!; c.drawImage(image, 0, 0);
  c.clearRect(690 * k, 620.5 * k, 180 * k, 3 * k);
  return n as unknown as HTMLImageElement;
}

export async function loadAssets(base: string, progress: (percent: number) => void): Promise<Assets> {
  const images = new Map<string, HTMLImageElement>(), frames = new Map<string, SpriteFrame[]>();
  const total = LIST.reduce((n, x) => n + x[2], 0); let done = 0;
  const queue = [...LIST];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const [key, file, bytes] = job, image = new Image();
      image.src = base + file; await image.decode(); await yieldPaint();
      images.set(key, image);
      if (!PLATES.has(key)) {
        const two = key.startsWith('keeper-') || key.startsWith('wall');
        frames.set(key, extractSpriteFrames(key === 'cr' ? separated(image) : image, two ? 2 : 4, key.startsWith('keeper') || two ? 2 : 4,
          key === 'ball' || key.startsWith('wall'),
          key === 'keeper' ? [undefined, undefined, 'left', 'left', undefined, 'right', 'right', undefined]
            : key === 'keeper-reach' ? ['left', 'right', 'high', 'center']
            : key === 'keeper-dive' ? ['left', 'right', 'left', 'right'] : undefined,
          key === 'wall-far' ? 3 : key === 'wall' ? 5 : 1));
      }
      done += bytes; progress(Math.min(98, Math.floor(done / total * 98)));
    }
  };
  await Promise.all([worker(), worker()]);
  const crowd = await bakeCrowd(images.get('plate')!, images.get('mask')!, yieldPaint);
  progress(100);
  return { images, frames, crowd };
}
