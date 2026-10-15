import { test, expect, type Page } from '@playwright/test';
import { CARD_GAME_IDS } from '../src/shared/cardTables';
import { DEALER_HANDS_SIZE, DEALER_RELEASE, DEALER_CARD_WIDTH } from '../src/game/dealerHandsArt';

const game = 'github-three-card';
const wallet = { balance: 1000, entries: [] };
const artifacts = process.env.ROYAL_DEALER_HANDS_ARTIFACTS || 'artifacts/game-window-redesign-20261014/dealer-hands';
function session(phase = 1, cards = ['AS', 'KH', '2C']) {
  return {
    id: '10000000-0000-4000-8000-000000000001', gameId: game, rulesVersion: 2,
    state: 'active', stakeUnits: '1000', spentUnits: '1000', returnedUnits: '0',
    view: { player: cards, dealer: ['QS'], community: [], actions: [{ move: 'fold', label: 'Пас', cost: 0 }], phase, ended: false, message: 'Твой ход' },
  };
}
async function ready(page: Page, reduced = false) {
  await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(() => {
    const motions: any[] = [];
    (window as any).dealerHandsMotions = motions;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, options) {
      if (this.matches('.github-card,.expansion-card,.expansion-back,.casino-card,.next-playing-card,.batch-card')) {
        const hands = document.querySelector('.card-dealer-hands')?.getBoundingClientRect();
        const target = this.getBoundingClientRect();
        const style = getComputedStyle(this);
        motions.push({ frames, options, hands: hands?.toJSON(), target: target.toJSON(), nominalWidth: (this as HTMLElement).offsetWidth, restingTransform: style.transform, restingOrigin: style.transformOrigin, action: document.querySelector('[data-dealer-action]')?.getAttribute('data-dealer-action'), time: performance.now() });
      }
      return animate.call(this, frames, options);
    };
  });
  await page.route('**/api/**', route => route.fulfill({ json: new URL(route.request().url()).pathname === '/api/demo-wallet' ? wallet : { wallet, sessions: [], session: null } }));
  await page.goto('/tests/fixtures/game-window.html?game=' + game);
  await page.waitForFunction(() => (window as any).windowPreview);
  await page.evaluate(() => {
    const p = (window as any).windowPreview;
    p.expansionClient.refresh = async () => {};
    p.expansionClient.accountId = 'dealer-hands-fixture';
    p.expansionClient.wallet = { balance: 1000, entries: [] };
    p.demoWallet.accountId = p.expansionClient.accountId;
    p.demoWallet.wallet = p.expansionClient.wallet;
    p.expansionClient.dispatchEvent(new Event('change'));
  });
}
const motions = (page: Page) => page.evaluate(() => (window as any).dealerHandsMotions);
async function update(page: Page, value: ReturnType<typeof session>, options: { pending?: boolean; account?: string } = {}) {
  await page.evaluate(({ value, options }) => {
    const c = (window as any).windowPreview.expansionClient;
    if (options.account) c.accountId = options.account;
    c.pending = options.pending ? { id: '20000000-0000-4000-8000-000000000001', gameId: 'github-three-card', action: 'move', sessionId: value.id, move: 'play' } : undefined;
    c.sessions = [value]; c.dispatchEvent(new Event('change'));
  }, { value, options });
}
async function stableFrames(page: Page, count = 4, spacing = 90) {
  return page.evaluate(async ({ count, spacing }) => {
    const frames: string[] = [];
    for (let i = 0; i < count; i++) {
      await new Promise(resolve => setTimeout(resolve, spacing));
      frames.push(document.querySelector<HTMLCanvasElement>('.card-dealer-hands')!.toDataURL());
    }
    return frames;
  }, { count, spacing });
}
async function fits(page: Page) {
  const errors = await page.evaluate(() => {
    const bounds = document.querySelector('#mini-dialog')!.getBoundingClientRect();
    const errors: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('#mini-dialog,#mini-game')) {
      if (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2) errors.push('overflow:' + el.id);
    }
    for (const el of document.querySelectorAll<HTMLElement>('#mini-game button,#mini-game select,.card-dealer-hands')) {
      if (el.closest('.game-window-sheet')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
      if (r.top < bounds.top - 1 || r.left < bounds.left - 1 || r.right > bounds.right + 1 || r.bottom > bounds.bottom + 1) errors.push('outside:' + el.className);
      if (el.matches('button,select')) {
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        if (hit !== el && !el.contains(hit)) errors.push('covered:' + el.className);
      }
    }
    return errors;
  });
  expect(errors).toEqual([]);
}

test('all card tables expose only overhead hands and fit a phone and desktop', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page, true);
  for (const viewport of [{ width: 375, height: 667 }, { width: 1366, height: 768 }]) {
    await page.setViewportSize(viewport);
    for (const id of CARD_GAME_IDS) {
      await test.step(`${id} ${viewport.width}`, async () => {
        await page.evaluate(id => (window as any).windowPreview.mount(id), id);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(page.locator('.card-dealer-portrait')).toHaveCount(0);
        await expect(page.locator('.card-dealer-hands')).toBeVisible();
        const canvas = await page.locator('.card-dealer-hands').evaluate((element: HTMLCanvasElement) => {
          const bounds = element.getBoundingClientRect();
          return { nativeRatio: element.width / element.height, displayedRatio: bounds.width / bounds.height };
        });
        expect(canvas.nativeRatio).toBeCloseTo(DEALER_HANDS_SIZE.width / DEALER_HANDS_SIZE.height, 3);
        expect(canvas.displayedRatio).toBeCloseTo(canvas.nativeRatio, 2);
        await fits(page);
        if (id === 'github-blackjack') {
          await page.locator('[data-action="start"]').click();
          await fits(page);
          await page.screenshot({ path: `${artifacts}/blackjack-${viewport.width < 500 ? 'phone' : 'desktop'}.png` });
        }
      });
    }
  }
  expect(errors).toEqual([]);
});

test('hands reach before visible cards leave them and confirmed cards deal in sequence', async ({ page }) => {
  await ready(page);
  await update(page, session());
  await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', 'deal');
  await expect.poll(async () => (await motions(page)).length).toBe(4);
  const evidence = await motions(page);
  const delays = evidence.map((entry: any) => Number(entry.options.delay ?? 0));
  expect(delays[0]).toBeGreaterThanOrEqual(200);
  for (let i = 1; i < delays.length; i++) expect(delays[i] - delays[i - 1]).toBeGreaterThanOrEqual(350);
  const cycle = delays[1] - delays[0];
  expect(delays[0]).toBeCloseTo(cycle * DEALER_RELEASE.phase, 3);
  const visibility = await page.evaluate(() => document.getAnimations()
    .filter(animation => (animation.effect as KeyframeEffect)?.target instanceof Element && ((animation.effect as KeyframeEffect).target as Element).matches('.card-being-dealt'))
    .map(animation => {
      const effect = animation.effect as KeyframeEffect, target = effect.target as HTMLElement;
      const timing = effect.getTiming(), currentTime = animation.currentTime;
      animation.pause();
      animation.currentTime = Number(timing.delay) - .5;
      const waiting = getComputedStyle(target).opacity;
      animation.currentTime = Number(timing.delay) + Number(timing.duration) * .02;
      const released = getComputedStyle(target).opacity;
      animation.currentTime = currentTime; animation.play();
      return { waiting, released };
    }));
  expect(visibility).toHaveLength(4);
  for (const card of visibility) {
    expect(Number(card.waiting), 'a card waits invisibly until the hand releases it').toBe(0);
    expect(Number(card.released), 'a released card is visible during its flight').toBe(1);
  }
  for (const entry of evidence) {
    const first = entry.frames.find((frame: any) => frame.opacity > 0) ?? entry.frames[0];
    const match = /translate\(([-.\d]+)px,\s*([-.\d]+)px\)/.exec(first.transform);
    expect(match, 'a dealt card starts at the dealer hand').not.toBeNull();
    const x = entry.target.left + entry.target.width / 2 + Number(match![1]);
    const y = entry.target.top + entry.target.height / 2 + Number(match![2]);
    const releaseX = entry.hands.left + entry.hands.width * DEALER_RELEASE.x / DEALER_HANDS_SIZE.width;
    const releaseY = entry.hands.top + entry.hands.height * DEALER_RELEASE.y / DEALER_HANDS_SIZE.height;
    expect(x, 'flight begins at the held card, without a position jump').toBeCloseTo(releaseX, 2);
    expect(y, 'flight begins at the held card, without a position jump').toBeCloseTo(releaseY, 2);
    const scale = /scale\(([-.\d]+)\)/.exec(first.transform);
    expect(scale, 'a dealt card has an initial scale').not.toBeNull();
    const heldWidth = DEALER_CARD_WIDTH * entry.hands.width / DEALER_HANDS_SIZE.width;
    expect(entry.nominalWidth * Number(scale![1]), 'flight begins at the size of the held card').toBeCloseTo(heldWidth, 1);
    const angle = /rotate\(([-.\d]+)rad\)/.exec(first.transform);
    expect(angle, 'a dealt card preserves the held card rotation').not.toBeNull();
    expect(Number(angle![1])).toBeCloseTo(DEALER_RELEASE.angle, 3);
    expect(entry.action).toBe('deal');
  }
  expect(new Set(await stableFrames(page)).size).toBeGreaterThan(1);
  await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', 'idle', { timeout: 5000 });
  expect(new Set(await stableFrames(page)).size).toBe(1);
  await fits(page);
});

test('rotated cards leave the hand with its pose and restore their resting transform without a jump', async ({ page }) => {
  await ready(page);
  await page.addStyleTag({ content: '#mini-dialog .expansion-card { transform: rotate(-7deg) translateY(-3px); transform-origin: 25% 75%; }' });
  await update(page, session());
  await expect.poll(async () => (await motions(page)).length).toBe(4);
  const evidence = await motions(page);
  const samples = await page.evaluate(async () => {
    const animations = document.getAnimations().filter(animation => (animation.effect as KeyframeEffect)?.target instanceof Element && ((animation.effect as KeyframeEffect).target as Element).matches('.card-being-dealt'));
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.expansion-card'));
    const samples = animations.map(animation => {
      const effect = animation.effect as KeyframeEffect, target = effect.target as HTMLElement;
      const timing = effect.getTiming();
      animation.pause(); effect.updateTiming({ easing: 'linear' });
      animation.currentTime = Number(timing.delay) + Number(timing.duration) * .01;
      const source = target.getBoundingClientRect(), style = getComputedStyle(target), matrix = new DOMMatrixReadOnly(style.transform);
      const start = { x: source.left + source.width / 2, y: source.top + source.height / 2, scale: Math.hypot(matrix.a, matrix.b), angle: Math.atan2(matrix.b, matrix.a), opacity: Number(style.opacity), nominalWidth: target.offsetWidth };
      animation.currentTime = Number(timing.delay) + Number(timing.duration) - .001;
      const nearEnd = target.getBoundingClientRect().toJSON();
      return { index: cards.indexOf(target), start, nearEnd, animation, target };
    });
    for (const sample of samples) sample.animation.finish();
    await Promise.all(samples.map(sample => sample.animation.finished));
    return samples.map(({ index, start, nearEnd, target }) => ({ index, start, nearEnd, end: target.getBoundingClientRect().toJSON(), transform: getComputedStyle(target).transform, origin: getComputedStyle(target).transformOrigin }));
  });
  expect(samples).toHaveLength(4);
  for (const sample of samples) {
    const entry = evidence[sample.index];
    const releaseX = entry.hands.left + entry.hands.width * DEALER_RELEASE.x / DEALER_HANDS_SIZE.width;
    const releaseY = entry.hands.top + entry.hands.height * DEALER_RELEASE.y / DEALER_HANDS_SIZE.height;
    expect(Math.abs(sample.start.x - releaseX), 'the visible card remains under the hand at release').toBeLessThan(.75);
    expect(Math.abs(sample.start.y - releaseY), 'the visible card remains under the hand at release').toBeLessThan(.75);
    expect(sample.start.angle, 'resting card rotation does not leak into the hand pose').toBeCloseTo(DEALER_RELEASE.angle, 4);
    expect(sample.start.nominalWidth * sample.start.scale).toBeCloseTo(DEALER_CARD_WIDTH * entry.hands.width / DEALER_HANDS_SIZE.width, 2);
    expect(sample.start.opacity).toBe(1);
    expect(sample.transform).toBe(entry.restingTransform);
    expect(sample.origin).toBe(entry.restingOrigin);
    for (const edge of ['left', 'top', 'right', 'bottom'] as const) expect(Math.abs(sample.nearEnd[edge] - sample.end[edge]), 'resting card placement survives animation cleanup').toBeLessThan(.05);
  }
  await expect(page.locator('.card-being-dealt')).toHaveCount(0);
});

test('wallet refresh, duplicate responses and restored rounds do not repeat hands or card flights', async ({ page }) => {
  await ready(page); await update(page, session());
  await expect.poll(async () => (await motions(page)).length).toBe(4);
  await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', 'idle', { timeout: 5000 });
  await update(page, session());
  await page.evaluate(() => { const p = (window as any).windowPreview; p.demoWallet.dispatchEvent(new Event('change')); p.mount('github-three-card'); });
  await page.waitForTimeout(150);
  expect((await motions(page)).length).toBe(4);
  await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', 'idle');
  await update(page, session(2, ['AS', 'KH', '4C']), { account: 'another-dealer-hands-account' });
  await page.waitForTimeout(150);
  expect((await motions(page)).length).toBe(4);
  await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', 'idle');
});

test('pending new cards wait, then confirmation animates both hands and the newly confirmed card', async ({ page }) => {
  await ready(page); await update(page, session());
  await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', 'idle', { timeout: 5000 });
  const before = (await motions(page)).length;
  await update(page, session(2, ['AS', 'KH', '4C']), { pending: true });
  await page.waitForTimeout(200);
  expect((await motions(page)).length).toBe(before);
  await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', 'idle');
  await update(page, session(2, ['AS', 'KH', '4C']));
  await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', 'deal');
  await expect.poll(async () => (await motions(page)).length).toBe(before + 1);
  expect(new Set(await stableFrames(page)).size).toBeGreaterThan(1);
});

test('reduced motion leaves readable cards static and destroying a deal cancels pending flight', async ({ page }) => {
  await ready(page, true); await update(page, session());
  await page.waitForTimeout(100);
  expect(await motions(page)).toHaveLength(0);
  expect(new Set(await stableFrames(page)).size).toBe(1);
  await expect(page.locator('.expansion-card')).toHaveCount(4);
  for (const card of await page.locator('.expansion-card').all()) expect(await card.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
  await update(page, session(2, ['AS', 'KH', '4C']));
  await expect.poll(async () => (await motions(page)).length).toBe(1);
  await page.evaluate(() => (window as any).windowPreview.mount('royal-fruits'));
  await page.waitForTimeout(800);
  await expect(page.locator('.card-dealer-hands')).toHaveCount(0);
  expect(await page.evaluate(() => document.getAnimations().filter(animation => (animation.effect as KeyframeEffect)?.target instanceof Element && ((animation.effect as KeyframeEffect).target as Element).matches('.card-being-dealt')).length)).toBe(0);
  expect((await motions(page)).length).toBe(1);
});

test('changing motion preference during a deal reveals every card and never replays a flight', async ({ page }) => {
  await ready(page); await update(page, session());
  await expect.poll(async () => (await motions(page)).length).toBe(4);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  for (const card of await page.locator('.expansion-card').all()) expect(await card.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
  expect(new Set(await stableFrames(page, 3, 75)).size).toBe(1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForTimeout(800);
  expect((await motions(page)).length).toBe(4);
  expect(await page.evaluate(() => document.getAnimations().filter(animation => (animation.effect as KeyframeEffect)?.target instanceof Element && ((animation.effect as KeyframeEffect).target as Element).matches('.card-being-dealt')).length)).toBe(0);
});

test('confirmed wins and losses animate the hands once, then rest through balance refreshes', async ({ page }) => {
  await ready(page); await update(page, session());
  await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', 'idle', { timeout: 5000 });
  const flights = (await motions(page)).length;
  for (const [index, outcome] of [{ action: 'win', returned: '2000' }, { action: 'lose', returned: '0' }].entries()) {
    const result = session(index + 2);
    result.state = 'settled'; result.returnedUnits = outcome.returned;
    result.view.ended = true; result.view.actions = []; result.view.message = 'Партия завершена';
    await update(page, result);
    await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', outcome.action);
    expect(new Set(await stableFrames(page)).size, `${outcome.action} produces a visible hand gesture`).toBeGreaterThan(1);
    await page.waitForTimeout(400);
    expect(new Set(await stableFrames(page, 3, 75)).size, `${outcome.action} rests after the gesture`).toBe(1);
    await page.evaluate(() => {
      const p = (window as any).windowPreview;
      p.demoWallet.wallet.balance += 1; p.demoWallet.dispatchEvent(new Event('change'));
    });
    await update(page, result);
    const restingFrames = new Set(await stableFrames(page, 3, 75)).size;
    expect(restingFrames, 'balance and duplicate responses do not replay the gesture').toBe(1);
    expect((await motions(page)).length, 'a result without new cards does not redeal').toBe(flights);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const result = session(4); result.state = 'settled'; result.returnedUnits = '2000';
  result.view.ended = true; result.view.actions = [];
  await update(page, result);
  await expect(page.locator('[data-dealer-action]')).toHaveAttribute('data-dealer-action', 'win');
  expect(new Set(await stableFrames(page)).size, 'reduced motion keeps result hands still').toBe(1);
  expect((await motions(page)).length).toBe(flights);
});

test('long card layouts keep four split hands and seven-card Pai Gow fully visible on small phones', async ({ page }) => {
  await ready(page, true);
  await page.waitForLoadState('networkidle');
  for (const viewport of [{ width: 375, height: 667 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    for (const id of ['github-spanish', 'github-pai-gow']) {
      await test.step(`${id} ${viewport.width}x${viewport.height}`, async () => {
        await page.evaluate(id => {
          const p = (window as any).windowPreview;
          const seven = id === 'github-pai-gow', cards = ['AS', '2H', '3C', '4S', '5H', '6C', '7D'];
          p.expansionClient.pending = undefined;
          p.expansionClient.sessions = [{
            id: '10000000-0000-4000-8000-000000000001', gameId: id, rulesVersion: seven ? 2 : 1,
            state: 'active', stakeUnits: '1000', spentUnits: seven ? '1000' : '4000', returnedUnits: '0',
            view: {
              player: seven ? cards : [], dealer: seven ? cards : ['AS', '5H', '6C', '7D'], community: [],
              hands: seven ? undefined : Array.from({ length: 4 }, (_, i) => ({ label: 'Рука ' + (i + 1), score: 12, active: i === 1, cards: ['AS', 'AD', 'QH'] })),
              actions: seven ? [{ move: 'set', label: 'Разделить руки', cost: 0 }] : [{ move: 'hit', label: 'Ещё карту', cost: 0 }, { move: 'stand', label: 'Хватит', cost: 0 }, { move: 'double', label: 'Удвоить', cost: 1000 }, { move: 'split', label: 'Разделить', cost: 1000 }],
              phase: 2, ended: false, message: seven ? 'Выбери две карты младшей руки.' : 'Сыграй активную руку.',
            },
          }];
          p.mount(id);
        }, id);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await expect(page.locator('.expansion-card')).toHaveCount(id === 'github-pai-gow' ? 14 : 16);
        await fits(page);
        const covered = await page.locator('.expansion-card').evaluateAll(cards => {
          const board = document.querySelector('.expansion-board')!.getBoundingClientRect();
          return cards.flatMap((card, index) => {
            const r = card.getBoundingClientRect(), issues: string[] = [];
            if (r.top < board.top - 1 || r.left < board.left - 1 || r.right > board.right + 1 || r.bottom > board.bottom + 1) issues.push(`${index}:outside-board`);
            for (const [dx, dy] of [[.2, .2], [.8, .2], [.2, .8], [.8, .8]]) {
              const hit = document.elementFromPoint(r.left + r.width * dx, r.top + r.height * dy);
              if (hit !== card && !card.contains(hit)) issues.push(`${index}:covered`);
            }
            return issues;
          });
        });
        expect(covered).toEqual([]);
        await page.screenshot({ path: `${artifacts}/${id}-${viewport.width}-long.png` });
      });
    }
  }
});
