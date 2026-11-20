import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

const root = fileURLToPath(new URL('../', import.meta.url));
const channel = process.env.SLOT_BROWSER_CHANNEL;
const browser = await chromium.launch({ ...(channel ? { channel } : {}), headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  page.setDefaultTimeout(4000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const asset = /^assets\/(?:[\w.-]+\/)*[\w.-]+\.(?:png|jpe?g|webp|avif|gif|svg|woff2?|ttf|mp3|ogg|wav|mp4|webm)$/i.test(file)
      && !file.split('/').some(part => part === '.' || part === '..');
    if (url.origin !== 'http://slot-primitive.test' || !(/^(index\.html|(?:demo|view)\.css|dist\/[\w/-]+\.js)$/.test(file) || asset)) {
      if (url.pathname !== '/favicon.ico') errors.push(`Unexpected request: ${url.href}`);
      return route.abort();
    }
    return route.fulfill({ path: join(root, file) });
  });
  await page.goto('http://slot-primitive.test/');
  const action = page.locator('[data-slot-action]');
  const feedback = page.locator('[data-slot-feedback]');
  const stake = page.locator('[data-slot-stake]');
  await expect(stake).toBeEnabled();
  await stake.fill('0.001');
  await expect(action).toBeDisabled();
  await stake.fill('0,13');
  await action.click();
  await expect(action).toHaveText('Бесплатный спин');
  await expect(feedback).toHaveAttribute('data-kind', 'bet');
  await action.click();
  await expect(action).toHaveText('Проверить ход');
  await expect(page.locator('[data-slot-round]')).toContainText('Ход 1');
  await action.click();
  await expect(page.locator('[data-slot-round]')).toContainText('Ход 2');
  await expect(feedback).toBeHidden();
  await expect(action).toBeDisabled();
  await page.getByRole('radio', { name: 'Символ 2' }).check();
  await action.click();
  await expect(page.locator('[data-slot-features]')).toContainText('добавлен символ 2');
  await expect(feedback).toHaveAttribute('data-kind', 'win');
  await expect(page.locator('#slot')).toHaveAttribute('data-slot-presentation', 'win');

  const scenario = page.locator('#scenario');
  await scenario.selectOption('ways');
  await expect(page.locator('#slot')).not.toHaveAttribute('data-slot-presentation');
  await action.click();
  await expect(feedback).toHaveAttribute('data-kind', 'partial');
  await expect(page.locator('[data-slot-grid] [data-void]')).toHaveCount(1);
  await scenario.selectOption('cascades');
  await action.click();
  await expect(feedback).toHaveAttribute('data-kind', 'bigwin');
  await expect(page.locator('#slot')).toHaveAttribute('data-slot-presentation', 'bigwin');
  await page.locator('[data-slot-stages]').selectOption('0');
  await expect(page.locator('[data-slot-grid] [data-removed]')).toHaveCount(3);
  await scenario.selectOption('hold');
  await action.click();
  await expect(page.locator('[data-slot-grid] [data-held]')).toHaveCount(3);
  await action.click();
  await expect(page.locator('[data-slot-grid] [data-held]')).toHaveCount(4);

  await scenario.selectOption('lines');
  const json = page.locator('[data-json]');
  await page.getByRole('button', { name: 'Барабан 1, ряд 1' }).click();
  await page.getByRole('button', { name: 'Сохранить линию' }).click();
  assert.deepEqual(JSON.parse(await json.inputValue()).paylines, [[0, 1, 1, 1, 1]]);
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Скачать JSON' }).click(),
  ]);
  assert.equal(download.suggestedFilename(), 'paylines.json');
  assert.equal(await download.failure(), null);
  await json.fill(JSON.stringify({ columns: 4, rows: 3, paylines: [[0, 1, 2, 1]] }));
  await page.getByRole('button', { name: 'Импортировать JSON' }).click();
  await expect(page.locator('[data-cells] button')).toHaveCount(12);
  await action.click();
  const highlighted = await page.locator('[data-slot-grid] span').evaluateAll(nodes =>
    nodes.flatMap((node, index) => node.hasAttribute('data-highlighted') ? [index] : []));
  assert.deepEqual(highlighted, [0, 5, 7, 10]);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }
  const pauseResult = await page.evaluate(async () => {
    const { mountSlot } = await import('/dist/view.js');
    const { createSlotActions } = await import('/dist/actions.js');
    const { createDemoServices } = await import('/dist/demo-services.js');
    const root = document.body.appendChild(document.createElement('div'));
    const state = createDemoServices('cascades');
    const commands = createSlotActions(state);
    let wins = 0;
    let cancelled = 0;
    let winningTile;
    const slot = mountSlot(root, state, commands, { win(_event, signal) {
      wins++;
      winningTile = root.querySelector('[data-slot-grid] span');
      signal.addEventListener('abort', () => { cancelled++; }, { once: true });
    } });
    const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));
    try {
      await nextTick();
      root.querySelector('[data-slot-action]').click();
      await nextTick();
      const retained = winningTile === root.querySelector('[data-slot-grid] span');
      slot.pause();
      const disabled = root.querySelector('[data-slot-action]').disabled;
      slot.resume();
      return { wins, cancelled, retained, disabled, hidden: root.querySelector('[data-slot-feedback]').hidden };
    } finally {
      slot.destroy();
      root.remove();
    }
  });
  assert.deepEqual(pauseResult, { wins: 1, cancelled: 1, retained: true, disabled: true, hidden: true });
  const optionalResult = await page.evaluate(async () => {
    const { mountSlot } = await import('/dist/view.js');
    const { createSlotActions } = await import('/dist/actions.js');
    const { createDemoServices } = await import('/dist/demo-services.js');
    const demoStyles = document.querySelector('link[href="demo.css"]');
    demoStyles.disabled = true;
    const root = document.body.appendChild(document.createElement('div'));
    const demo = createDemoServices('hold');
    await demo.spin('0.10');
    const state = { ...demo, read() {
      const snapshot = demo.read();
      return { ...snapshot, freeActions: snapshot.freeActions.map(action => ({ ...action,
        maxPicks: 1, choices: [{ value: 0, label: 'Тестовый символ' }],
      })) };
    } };
    const slot = mountSlot(root, state, createSlotActions(state));
    const nextTick = () => new Promise(resolve => setTimeout(resolve, 0));
    try {
      await nextTick();
      const grid = root.querySelector('[data-slot-grid]');
      const display = getComputedStyle(grid).display;
      const optional = root.querySelector('[data-slot-picks] input:not([data-no-pick])');
      const empty = root.querySelector('[data-no-pick]');
      const defaultEmpty = empty.checked;
      optional.click();
      const picked = optional.checked && !empty.checked;
      empty.click();
      const cleared = empty.checked && !optional.checked;
      root.querySelector('[data-slot-action]').click();
      await nextTick();
      return { display, defaultEmpty, picked, cleared, settled: state.read().round.state === 'settled' };
    } finally {
      demoStyles.disabled = false;
      slot.destroy();
      root.remove();
    }
  });
  assert.deepEqual(optionalResult, { display: 'grid', defaultEmpty: true, picked: true, cleared: true, settled: true });
  assert.deepEqual(errors, []);
  console.log('Browser: scenarios, effect lifetime, optional picks, isolated styles, line editing and offline layouts verified.');
} finally {
  await browser.close();
}
