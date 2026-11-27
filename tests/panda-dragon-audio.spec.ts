import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';

/**
 * Техническая проверка звука модуля «Путь дракона».
 *
 * Каждое действие рендерится в OfflineAudioContext тем же движком, что и в игре.
 * Проверяются измеримые свойства: наличие сигнала, отсутствие перегрузки и щелчков,
 * различие масштаба событий, пространственная позиция и полная тишина после отмены.
 * Субъективная приятность звучания здесь не проверяется.
 */

const moduleRoot = resolve('games/panda-dragon');
/** Длительность рендера: длиннее самого события, чтобы поймать хвост реверберации. */
const RENDER_SECONDS = 7;
let bundle: string;

type Action = 'click' | 'spin' | 'stop' | 'strike' | 'whoosh' | 'clink' | 'spark' | 'charge'
  | 'win' | 'bigwin' | 'bonus' | 'loss' | 'partial' | 'return';

test.beforeAll(async () => {
  const result = await build({
    entryPoints: [resolve(moduleRoot, 'sound.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'RoyalPandaSound',
    target: 'es2022',
  });
  bundle = result.outputFiles[0].text;
});

interface Render {
  rms: number;
  peak: number;
  mean: number;
  tail: number;
  seamJump: number;
  left: number;
  right: number;
}

async function render(page: Page, actions: { name: Action; pan?: number; variant?: number }[]): Promise<Render> {
  await page.addScriptTag({ content: bundle });
  return page.evaluate(async ({ actions, seconds }) => {
    const context = new OfflineAudioContext(2, 44100 * seconds, 44100);
    const output = context.createGain();
    output.gain.value = 0.35;
    output.connect(context.destination);
    // OfflineAudioContext отдаёт состояние suspended, поэтому контекст-обёртка
    // сообщает running – иначе движок не примет события до начала рендера.
    const running = new Proxy(context, {
      get(target, property) {
        if (property === 'state') return 'running';
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const host = {
      context: running,
      output,
      onPreferences(listener: (value: unknown) => void) {
        listener({ muted: false, volume: 0.8 });
        return () => {};
      },
      getPreferences: () => ({ muted: false, volume: 0.8 }),
      setMuted: () => {},
      unlock: async () => {},
    };
    const { createPandaAudio } = (window as unknown as {
      RoyalPandaSound: {
        createPandaAudio: (host: unknown) => { play: (name: string, options?: unknown) => void; cancel: () => void };
      };
    }).RoyalPandaSound;
    const audio = createPandaAudio(host);
    for (const action of actions) audio.play(action.name, { pan: action.pan, variant: action.variant });
    const buffer = await context.startRendering();
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    let squares = 0, peak = 0, mean = 0, tail = 0, leftSquares = 0, rightSquares = 0;
    const tailFrom = Math.floor(left.length * 0.97);
    for (let i = 0; i < left.length; i++) {
      const value = left[i];
      squares += value * value;
      peak = Math.max(peak, Math.abs(value));
      mean += value;
      leftSquares += value * value;
      rightSquares += right[i] * right[i];
      if (i >= tailFrom) tail = Math.max(tail, Math.abs(value), Math.abs(right[i]));
    }
    let seamJump = 0;
    for (let i = 1; i < left.length; i++) seamJump = Math.max(seamJump, Math.abs(left[i] - left[i - 1]));
    return {
      rms: Math.sqrt(squares / left.length),
      peak,
      mean: mean / left.length,
      tail,
      seamJump,
      left: Math.sqrt(leftSquares / left.length),
      right: Math.sqrt(rightSquares / right.length),
    };
  }, { actions, seconds: RENDER_SECONDS });
}

test('каждое действие даёт сигнал без перегрузки и без щелчков', async ({ page }) => {
  const actions: Action[] = ['click', 'spin', 'stop', 'strike', 'whoosh', 'clink', 'spark', 'charge',
    'win', 'bigwin', 'bonus', 'loss', 'partial', 'return'];
  const results: Record<string, Render> = {};
  for (const name of actions) {
    const result = await render(page, [{ name }]);
    results[name] = result;
    expect(result.rms, `${name}: сигнал должен звучать`).toBeGreaterThan(0.0002);
    expect(result.peak, `${name}: пик не должен перегружать выход`).toBeLessThan(0.4);
    expect(Math.abs(result.mean), `${name}: постоянная составляющая должна быть нулевой`).toBeLessThan(0.002);
    expect(result.tail, `${name}: звук должен заканчиваться`).toBeLessThan(0.0005);
    expect(result.seamJump, `${name}: стык отрезка не должен щелкать`).toBeLessThan(0.2);
  }
  // Масштаб событий различим: проигрыш тише выигрыша, крупный итог громче обычного.
  expect(results.loss.rms).toBeLessThan(results.win.rms);
  expect(results.return.rms).toBeLessThan(results.win.rms);
  expect(results.partial.rms).toBeLessThan(results.win.rms);
  expect(results.win.rms).toBeLessThan(results.bigwin.rms);
});

test('частичный возврат и возврат ставки не звучат как выигрыш', async ({ page }) => {
  const partial = await render(page, [{ name: 'partial' }]);
  const returned = await render(page, [{ name: 'return' }]);
  const win = await render(page, [{ name: 'win' }]);
  // Возврат и частичный возврат не должны быть громче выигрыша и не держат длинный хвост.
  expect(partial.rms).toBeLessThan(win.rms);
  expect(returned.rms).toBeLessThan(win.rms);
  expect(partial.peak).toBeLessThan(win.peak);
  expect(returned.peak).toBeLessThan(win.peak);
});

test('остановка барабана звучит из своей колонки', async ({ page }) => {
  const left = await render(page, [{ name: 'stop', pan: -0.7, variant: 0 }]);
  const right = await render(page, [{ name: 'stop', pan: 0.7, variant: 4 }]);
  // Левый барабан тяжелее в левом канале, правый – в правом.
  expect(left.left).toBeGreaterThan(left.right);
  expect(right.right).toBeGreaterThan(right.left);
});

test('отмена хода оставляет полную тишину', async ({ page }) => {
  await page.addScriptTag({ content: bundle });
  const peak = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 44100 * 3, 44100);
    const output = context.createGain();
    output.gain.value = 0.35;
    output.connect(context.destination);
    const running = new Proxy(context, {
      get(target, property) {
        if (property === 'state') return 'running';
        const value = target[property];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const host = {
      context: running,
      output,
      onPreferences(listener: (value: unknown) => void) {
        listener({ muted: false, volume: 0.8 });
        return () => {};
      },
      getPreferences: () => ({ muted: false, volume: 0.8 }),
      setMuted: () => {},
      unlock: async () => {},
    };
    const { createPandaAudio } = (window as unknown as {
      RoyalPandaSound: {
        createPandaAudio: (host: unknown) => { play: (name: string) => void; cancel: () => void };
      };
    }).RoyalPandaSound;
    const audio = createPandaAudio(host);
    audio.play('bigwin');
    audio.play('strike');
    audio.cancel();
    const buffer = await context.startRendering();
    const data = buffer.getChannelData(0);
    let value = 0;
    for (let i = 0; i < data.length; i++) value = Math.max(value, Math.abs(data[i]));
    return value;
  });
  expect(peak).toBeLessThan(0.0005);
});
