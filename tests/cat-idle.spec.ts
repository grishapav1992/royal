import { test, expect } from '@playwright/test';

const probe = `<!doctype html><html><head><style>
html,body{margin:0;background:#302233}canvas{display:block;max-width:100%;height:auto}
</style></head><body><script type="module">
import * as Phaser from '/node_modules/phaser/dist/phaser.esm.js';
import {CatRenderer,CAT_TEXTURE,CAT_HABITS_TEXTURE,CAT_CLIMB_TEXTURE,CAT_SCRATCH_TEXTURE,CAT_WALK_TEXTURE} from '/src/game/CatRenderer.ts';
import images from '/src/game/catImages.json';
import {CatRoutine} from '/src/shared/cat.ts';
import {drawCatHome} from '/src/game/catHomeArt.ts';
class Probe extends Phaser.Scene {
  preload(){
    for(const [key,url] of [[CAT_TEXTURE,images.body],[CAT_HABITS_TEXTURE,images.habits],[CAT_CLIMB_TEXTURE,images.climb],[CAT_SCRATCH_TEXTURE,images.scratch],[CAT_WALK_TEXTURE,images.walk]])this.load.image(key,url);
  }
  create(){
    drawCatHome(this);this.cameras.main.setZoom(2).centerOn(2330,65);
    const renderer=new CatRenderer(this),view=new CatRoutine().snapshot();
    const tick=(mood,seconds=0,reduced=false,hall='arcade')=>{
      view.mood=mood;
      view.surfaceId=['sleeping','belly-up'].includes(mood)?'pillow':'cabinet:studio-cosmic-escape';
      if(seconds===0)renderer.update(view,hall,0,0,reduced);
      for(let i=0;i<Math.round(seconds*60);i++)renderer.update(view,hall,i*1000/60,1/60,reduced);
      return this.children.getByName('cat');
    };
    tick('sleeping');window.catProbe={scene:this,renderer,view,tick};
  }
}
new Phaser.Game({type:location.search.includes('canvas')?Phaser.CANVAS:Phaser.WEBGL,width:540,height:340,scene:Probe,audio:{noAudio:true},banner:false,render:{preserveDrawingBuffer:true}});
</script></body></html>`;

for (const variant of [
  { name: 'desktop-canvas', width: 1000, height: 700, renderer: 'canvas' },
  { name: 'desktop-webgl', width: 1000, height: 700, renderer: 'webgl' },
  { name: 'mobile-webgl', width: 390, height: 844, renderer: 'webgl' },
]) test(`${variant.name}: breathing, seated motion, stable paws and lifecycle`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize(variant);
  await page.route('**/__cat_idle?*', route => route.fulfill({ contentType: 'text/html', body: probe }));
  await page.goto('/__cat_idle?' + variant.renderer);
  await page.waitForFunction(() => Boolean((window as any).catProbe));
  const result = await page.evaluate(() => {
    const { scene, tick } = (window as any).catProbe;
    scene.game.loop.stop();
    const sample = () => {
      const sprite = scene.children.getByName('cat'), texture = sprite.texture;
      const { width, height } = texture.getSourceImage();
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      const context = canvas.getContext('2d')!; context.drawImage(texture.getSourceImage(), 0, 0);
      return { pixels: context.getImageData(0, 0, width, height).data, width, height };
    };
    const diff = (a: ReturnType<typeof sample>, b: ReturnType<typeof sample>, x: number, y: number, w: number, h: number) => {
      let changed = 0;
      for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
        const offset = (row * a.width + col) * 4;
        if (a.pixels.slice(offset, offset + 4).some((value, channel) => value !== b.pixels[offset + channel])) changed++;
      }
      return changed;
    };
    const sleep = sample(), sprite = tick('sleeping', 1.8), inhale = sample();
    const atlas = scene.textures.get('zverochka'), sleeping = atlas.get('16'), seated = atlas.get('17');
    const sleepPawsY = 12 + Math.floor(sleeping.cutHeight * .74);
    const sleepingDiff = {
      back: diff(sleep, inhale, 150, 12, 120, 80),
      face: diff(sleep, inhale, 12, 12, 85, sleeping.cutHeight),
      paws: diff(sleep, inhale, 12, sleepPawsY, sleeping.cutWidth, sleeping.cutHeight + 12 - sleepPawsY),
    };
    const position = { x: sprite.x, y: sprite.y, depth: sprite.depth, scaleX: sprite.scaleX, scaleY: sprite.scaleY };
    tick('sleeping', 1.8);
    const loop = diff(sleep, sample(), 0, 0, sleep.width, sleep.height);
    const unchangedPosition = ['x', 'y', 'depth', 'scaleX', 'scaleY'].every(key => sprite[key] === position[key as keyof typeof position]);
    tick('purring'); const sit = sample(); tick('purring', 1.2); const later = sample();
    const seatedDiff = {
      head: diff(sit, later, 12, 12, seated.cutWidth, 100),
      chest: diff(sit, later, 12, 112, seated.cutWidth, 100),
      paws: diff(sit, later, 12, 12 + Math.ceil(seated.cutHeight * .83), seated.cutWidth, Math.floor(seated.cutHeight * .17)),
    };
    tick('sleeping', 0, true);
    const reduced = { key: sprite.texture.key, frame: sprite.frame.name, x: sprite.x, y: sprite.y, scaleX: sprite.scaleX, scaleY: sprite.scaleY };
    tick('sleeping', 4, true);
    const reducedStable = Object.entries(reduced).every(([key, value]) => key === 'key' ? sprite.texture.key === value : key === 'frame' ? sprite.frame.name === value : sprite[key] === value);
    tick('resting'); const resting = sprite.texture.key.startsWith('cat-idle-') && sprite.frame.name === 'seated';
    tick('perched'); const perched = sprite.frame.name === 'seated';
    tick('walking'); const walking = sprite.texture.key === 'zverochka-walk-v3';
    tick('sleeping', 1); const idleKey = sprite.texture.key, beforeHidden = sample();
    tick('sleeping', 3, false, 'tables'); const hidden = !sprite.visible;
    const hiddenStable = diff(beforeHidden, sample(), 0, 0, beforeHidden.width, beforeHidden.height) === 0;
    tick('sleeping');
    const returnNeutral = diff(sleep, sample(), 0, 0, sleep.width, sleep.height) === 0;
    // Keep an inhaled pose for visual review in the real sunny-window artwork.
    tick('sleeping', 1.8);scene.game.step(performance.now(), 16);
    return { sleepingDiff, seatedDiff, loop, unchangedPosition, reduced, reducedStable, resting, perched, walking, hidden, hiddenStable, returnNeutral, idleKey };
  });
  expect(result.sleepingDiff.back).toBeGreaterThan(100);
  expect(result.sleepingDiff.face).toBe(0);
  expect(result.sleepingDiff.paws).toBe(0);
  expect(result.seatedDiff.head).toBeGreaterThan(100);
  expect(result.seatedDiff.chest).toBeGreaterThan(100);
  expect(result.seatedDiff.paws).toBe(0);
  expect(result.loop).toBeLessThan(200);
  expect(result.unchangedPosition).toBe(true);
  expect(result.reduced.key).toBe('zverochka'); expect(result.reduced.frame).toBe('16');
  for (const key of ['reducedStable', 'resting', 'perched', 'walking', 'hidden', 'hiddenStable', 'returnNeutral'] as const) expect(result[key], key).toBe(true);
  await page.screenshot({ path: `artifacts/work/cat-idle-animation/${variant.name}.png` });
  expect(await page.evaluate(key => {
    const { scene } = (window as any).catProbe;
    scene.scene.stop(); scene.game.step(performance.now(), 16);
    return scene.textures.exists(key);
  }, result.idleKey)).toBe(false);
  expect(errors).toEqual([]);
});
