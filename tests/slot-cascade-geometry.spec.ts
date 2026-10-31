import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { nitroSurvivors } from '../src/shared/nitroRun';

let script: string, styles: string;
test.beforeAll(async () => {
  const bundle = await build({
    stdin: { contents: `
      import {NitroBoard} from './src/ui/NitroBoard';
      import {MemeBoard} from './src/ui/MemeBoard';
      import {CaramelBoard} from './src/ui/CaramelBoard';
      import {ConvoyBoard} from './src/ui/ConvoyBoard';
      import {AfterglowBoard} from './src/ui/AfterglowBoard';
      window.cascadeBoards={nr:NitroBoard,mo:MemeBoard,cc:CaramelBoard,cv:ConvoyBoard,ag:AfterglowBoard};
    `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife',
  });
  script = bundle.outputFiles[0].text;
  styles = (await Promise.all(['caramel-carnival', 'nitro-run', 'meme-overload', 'last-convoy', 'afterglow'].map(name => readFile(`src/ui/${name}.css`, 'utf8')))).join('\n');
});

const grid = Array.from({ length: 30 }, (_, i) => i % 6);
// Different removal depths also exercise drops whose destination is shrinking.
const removed = [0, 12, 24, 7, 25, 14, 26, 21, 28, 29];
const gravity = nitroSurvivors(grid, removed);
const frame = { drops: gravity.drops, refills: gravity.empty.map((position, i) => ({ position, symbol: i % 6 })) };
const after = Array<number>(30);
for (const drop of frame.drops) after[drop.to] = drop.symbol;
for (const refill of frame.refills) after[refill.position] = refill.symbol;

for (const theme of ['nr', 'mo', 'cc', 'cv', 'ag']) {
  for (const mobile of [false, true]) {
    test(`${theme}: cascades retain cell size and landing position on ${mobile ? 'phone' : 'desktop'}`, async ({ page }) => {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
      await page.setContent(`<style>${styles}</style><section class="cc-game ${theme}-game" style="width:${mobile ? 360 : 960}px;transform:scale(.83);transform-origin:top left"><div class="cc-board"></div></section>`);
      await page.addScriptTag({ content: script });
      await page.evaluate(({ theme, grid }) => {
        const board = new (window as any).cascadeBoards[theme](document.querySelector('.cc-board'), { phase() {}, stop() {} });
        (window as any).cascadeBoard = board; board.show(grid);
      }, { theme, grid });
      for (const fast of [false, true]) {
        const result = await page.evaluate(async ({ grid, removed, frame, after, fast }) => {
          const board = (window as any).cascadeBoard;
          board.clearOverlay(); board.show(grid);
          const rect = (element: Element) => { const b = element.getBoundingClientRect(); return { left: b.left, top: b.top, width: b.width, height: b.height }; };
          const cells = () => Array.from(document.querySelectorAll('[data-cc-cell]')).sort((a, b) => Number(a.getAttribute('data-cc-cell')) - Number(b.getAttribute('data-cc-cell'))).map(rect);
          const target = cells();
          board.remove(removed);
          // Check while the removal transform is active, before and after it completes.
          await new Promise(resolve => setTimeout(resolve, fast ? 110 : 260));
          const shrinkingWidth = rect(document.querySelector('[data-cc-cell="0"]')!).width;
          board.gravity(frame, fast);
          const tokens = Array.from(document.querySelectorAll<HTMLElement>('[data-cc-drop],[data-cc-refill]'));
          const sizes = () => tokens.map(token => ({ to: Number(token.dataset.to), ...rect(token) }));
          const initial = sizes();
          await new Promise(requestAnimationFrame);
          await new Promise(requestAnimationFrame);
          await Promise.all(tokens.flatMap(token => token.getAnimations().map(animation => animation.finished)));
          const landed = sizes();
          board.clearOverlay(); board.show(after);
          return { target, shrinkingWidth, initial, landed, final: cells(), symbols: Array.from(document.querySelectorAll<HTMLElement>('[data-cc-cell]')).sort((a, b) => Number(a.dataset.ccCell) - Number(b.dataset.ccCell)).map(cell => Number(cell.dataset.symbol)) };
        }, { grid, removed, frame, after, fast });
        expect(result.shrinkingWidth).toBeLessThan(result.target[0].width * .8);
        expect(result.initial).toHaveLength(30);
        for (const token of result.initial) {
          expect(Math.abs(token.width - result.target[token.to].width)).toBeLessThan(.1);
          expect(Math.abs(token.height - result.target[token.to].height)).toBeLessThan(.1);
        }
        for (const token of result.landed) {
          const target = result.target[token.to];
          for (const key of ['left', 'top', 'width', 'height'] as const) {
            expect(Math.abs(token[key] - target[key]), `${theme} ${fast} cell ${token.to} ${key}`).toBeLessThan(.1);
          }
        }
        expect(result.final).toEqual(result.target);
        expect(result.symbols).toEqual(after);
      }
      const cancelled = await page.evaluate(async removed => {
        const board = (window as any).cascadeBoard;
        const sizes = () => Array.from(document.querySelectorAll('[data-cc-cell]')).map(cell => cell.getBoundingClientRect().toJSON());
        const before = sizes();
        board.remove(removed); await new Promise(resolve => setTimeout(resolve, 110));
        board.cancel();
        return { before, after: sizes() };
      }, removed);
      expect(cancelled.after).toEqual(cancelled.before);
      await page.evaluate(() => (window as any).cascadeBoard.destroy());
      await expect(page.locator('[data-cc-drop],[data-cc-refill]')).toHaveCount(0);
    });
  }
}
