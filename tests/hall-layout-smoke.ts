import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CABINETS, cabinetsInHall } from '../src/shared/cabinets';
import { selectHall, worldPoint } from './room-ui';

const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());

async function movementSnapshot(page: Page, point?: { x: number; y: number }) {
  return page.evaluate(point => {
    const snapshot = (window as any).royalDemo.getState();
    const canvas = document.querySelector<HTMLCanvasElement>('#game canvas');
    const box = canvas?.getBoundingClientRect();
    const hit = point ? document.elementFromPoint(point.x, point.y) : null;
    return {
      at: performance.now(), hall: snapshot.hall, view: snapshot.view,
      x: snapshot.x, y: snapshot.y, renderX: snapshot.renderX, renderY: snapshot.renderY,
      serverX: snapshot.serverX, serverY: snapshot.serverY, moving: snapshot.moving,
      locked: snapshot.locked, switching: snapshot.switching, seat: snapshot.seat,
      near: snapshot.near, action: snapshot.action, predicted: snapshot.predicted,
      pendingInputs: snapshot.pendingInputs, security: snapshot.security, guards: snapshot.guards,
      canvas: box ? { x: box.x, y: box.y, width: box.width, height: box.height,
        pixelWidth: canvas!.width, pixelHeight: canvas!.height } : null,
      viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
      activeElement: { tag: document.activeElement?.tagName, id: document.activeElement?.id },
      openDialogs: [...document.querySelectorAll('dialog[open]')].map(dialog => dialog.id),
      hitElement: hit ? { tag: hit.tagName, id: hit.id, parentId: hit.parentElement?.id } : null,
      worldAtClick: point && box ? {
        x: snapshot.view.x + (point.x - box.x) * snapshot.view.width / (snapshot.view.zoom * box.width),
        y: snapshot.view.y + (point.y - box.y) * snapshot.view.height / (snapshot.view.zoom * box.height),
      } : null,
    };
  }, point);
}

async function walkTo(page: Page, x: number, y: number) {
  const before = await movementSnapshot(page);
  const point = await worldPoint(page, x, y);
  const beforeClick = await movementSnapshot(page, point);
  await page.mouse.click(point.x, point.y);
  const samples = [await movementSnapshot(page, point)];
  try {
    await expect.poll(async () => {
      const current = await movementSnapshot(page, point);
      samples.push(current);
      return Math.hypot(current.x - x, current.y - y);
    }, { timeout: 15000 }).toBeLessThan(4);
  } catch (error) {
    const after = await movementSnapshot(page, point);
    const diagnostics = { target: { x, y }, screenClick: point, before, beforeClick, after, samples };
    const body = Buffer.from(JSON.stringify(diagnostics, null, 2));
    const path = `artifacts/layout-diagnostics/walk-to-${Date.now()}-${x}-${y}.json`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
    console.error(`walkTo(${x}, ${y}) failed: ${path}\n${body.toString()}`);
    await test.info().attach(`walk-to-${x}-${y}`, { contentType: 'application/json', body });
    throw error;
  }
}

export async function verifyHallLayout(page: Page, screenshotPrefix: string) {
  await expect(page.locator('#loading')).toHaveCount(0);
  await expect(page.locator('#sit-bar,#sit-sofa')).toHaveCount(0);
  await page.locator('#room-overview').click();
  await expect.poll(async () => (await state(page)).view.overview).toBe(true);
  await page.screenshot({ path: `${screenshotPrefix}-arcade-desktop.png` });

  for (const cabinet of cabinetsInHall('arcade')) {
    await page.locator('#games-tab').click();
    await expect(page.locator('[data-cabinet]:not([hidden])')).toHaveCount(10);
    await page.locator(`[data-cabinet="${cabinet.id}"]`).click();
    if (cabinet.provider) {
      await expect(page.locator('#casinoapipro-dialog')).toBeVisible({ timeout: 30000 });
      await page.locator('#capro-close').click();
    } else {
      await expect(page.locator('#mini-dialog')).toBeVisible({ timeout: 30000 });
      await expect(page.locator('#mini-title')).toHaveText(cabinet.name);
      await expect(page.locator('#mini-dialog')).toHaveAttribute('data-game', cabinet.id);
      await expect(page.locator('#mini-game')).not.toBeEmpty();
      expect((await state(page)).near).toBe(cabinet.id);
      await page.locator('#mini-dialog .mini-top [data-close]').click();
    }
    await expect.poll(async () => (await state(page)).locked).toBe(false);
  }

  // These were occupied by the sofa, a bar stool and the lower plant.
  for (const [x, y] of [[230, 430], [790, 544], [980, 621]]) {
    await walkTo(page, x!, y!);
    expect((await state(page)).seat).toBe('');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  }

  await page.locator('#visit-bar').click();
  await expect(page.locator('#bar-dialog')).toBeVisible({ timeout: 15000 });
  expect((await state(page)).seat).toBe('');
  await expect(page.locator('.mira-player')).toBeVisible();
  await page.locator('#bar-dialog [data-close]').click();
  const piano = await worldPoint(page, 120, 290); await page.mouse.click(piano.x, piano.y);
  await expect(page.locator('#shared-dialog')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#shared-title')).toHaveText('Рояль');
  await expect(page.locator('[data-note="60"]')).toBeEnabled();
  await page.locator('#shared-close').click();
  await expect.poll(async () => (await state(page)).locked).toBe(false);
  try { await selectHall(page, 'tables'); }
  catch (error) {
    const snapshot = await state(page);
    await test.info().attach('door-and-patrol-state', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
      hall: snapshot.hall, x: snapshot.x, y: snapshot.y, locked: snapshot.locked,
      serverX: snapshot.serverX, serverY: snapshot.serverY, security: snapshot.security, guards: snapshot.guards,
    }, null, 2)) });
    throw error;
  }
  await expect(page.locator('h1')).toContainText('Игры на двоих');
  await expect(page.locator('#visit-bar')).toBeHidden();
  await page.locator('#games-tab').click();
  await expect(page.locator('[data-cabinet]:not([hidden])')).toHaveCount(1);
  await expect(page.locator('[data-cabinet="luelon"]')).toBeVisible();
  await page.locator('#panel-close').click();
  await page.screenshot({ path: `${screenshotPrefix}-tables-desktop.png` });
  for (const [id, name, x, y] of [
    ['hockey', 'Аэрохоккей', 380, 400], ['pool', 'Бильярд', 560, 410], ['chess', 'Шахматы', 222, 550],
  ] as const) {
    const point = await worldPoint(page, x, y); await page.mouse.click(point.x, point.y);
    await expect(page.locator('#shared-dialog')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#shared-title')).toHaveText(name);
    expect(await page.evaluate(() => (window as any).royalDemo.getActivities().selected)).toBe(id);
    await page.locator('#shared-close').click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${screenshotPrefix}-tables-mobile.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await selectHall(page, 'arcade');
  await page.screenshot({ path: `${screenshotPrefix}-arcade-mobile.png` });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  return CABINETS.map(cabinet => cabinet.id);
}
