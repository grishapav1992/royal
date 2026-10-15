import { expect, type Page } from '@playwright/test';
import { worldPoint } from './room-ui';
const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
const speed = (page: Page) => page.evaluate(() => new Promise<number>(resolve => {
  const start = performance.now();
  let previous = (window as any).royalDemo.getState(), distance = 0;
  function sample() {
    const now = performance.now();
    const last = (window as any).royalDemo.getState();
    distance += Math.hypot(last.x-previous.x, last.y-previous.y); previous = last;
    if (now-start < 240) { requestAnimationFrame(sample); return; }
    resolve(distance*1000/(now-start));
  }
  requestAnimationFrame(sample);
}));
export async function verifySprint(page: Page) {
  await page.keyboard.down('d');
  await expect.poll(async () => (await state(page)).moving).toBe(true);
  const walking = await speed(page);
  expect(walking).toBeGreaterThan(125); expect(walking).toBeLessThan(185);
  await page.keyboard.down('Shift');
  const running = await speed(page);
  expect(running/walking).toBeGreaterThan(1.5); expect(running/walking).toBeLessThan(2);
  await page.keyboard.up('Shift');
  expect(await speed(page)).toBeLessThan(walking*1.2);
  await page.keyboard.up('d');
  await expect.poll(async () => (await state(page)).moving).toBe(false);
  const point = await worldPoint(page, 420, 570);
  await page.mouse.click(point.x, point.y);
  await expect.poll(async () => (await state(page)).moving).toBe(true);
  // Allow the online position interpolation to reach cruising speed.
  await page.waitForTimeout(120);
  expect(await speed(page), 'pointer route speed').toBeGreaterThan(walking*1.4);
  await expect.poll(async () => Math.hypot((await state(page)).x-420, (await state(page)).y-570)).toBeLessThan(4);
  await page.getByRole('button', {name:'Мини-бар', exact:true}).click();
  await expect.poll(async () => (await state(page)).moving).toBe(true);
  await page.waitForTimeout(120);
  expect(await speed(page), 'button route speed').toBeGreaterThan(walking*1.4);
  await expect(page.locator('#bar-dialog')).toBeVisible({timeout:10000});
  expect((await state(page)).seat).toBe('');
  await page.locator('#bar-dialog [data-close]').click();
  await expect.poll(async () => (await state(page)).locked).toBe(false);
  if ((await state(page)).online) {
    await expect.poll(async () => {
      const s = await state(page); return Math.hypot(s.x-s.serverX,s.y-s.serverY);
    }).toBeLessThan(1);
  }
}
