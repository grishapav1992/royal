import { test, expect, type Page } from '@playwright/test';
import { ROOF, ROOF_STAIRS, STREET_ROOF_STAIRS, ROOF_STAIR_ROUTE } from '../src/shared/rooftop';
import { projectStreetPoint } from '../src/game/streetView';

const state = (page: Page) => page.evaluate(() => (window as any).royalDemo.getState());
async function overview(page: Page, on: boolean) {
  const button = page.locator('#room-overview');
  if ((await button.getAttribute('aria-pressed') === 'true') !== on) await button.click();
  await expect.poll(async () => (await state(page)).view.overview).toBe(on);
}
async function clickWorld(page: Page, x: number, y: number) {
  await page.bringToFront();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const box = (await page.locator('#game canvas').boundingBox())!, current=await state(page), { view } = current;
  const point=current.hall==='street'?projectStreetPoint({x,y},current.street.view.orientation):{x,y};
  await page.mouse.click(box.x + (point.x - view.x) * view.zoom * box.width / view.width, box.y + (point.y - view.y) * view.zoom * box.height / view.height);
}
async function walk(page: Page, x: number, y: number) {
  const tolerance = Math.max(5, 2 / (await state(page)).view.zoom);
  await clickWorld(page, x, y);
  await expect.poll(async () => { const p = await state(page); return Math.hypot(p.x - x, p.y - y); }, { timeout: 25000 }).toBeLessThan(tolerance);
  await expect.poll(async () => { const p = await state(page); return Math.hypot(p.serverX - p.x, p.serverY - p.y); }).toBeLessThan(3);
}

test('climb rear stairs, explore roof, reconnect and return with chat and wallet intact', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`roof-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Roof-browser-test!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect.poll(async () => (await state(page)).online).toBe(true);
  const balance = await page.locator('#wallet-balance').textContent();
  const network = await page.evaluate(() => (window as any).royalDemo.getNetworkState());
  await page.locator('[data-floor-target="street"]').click();
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('street');
  await expect(page.locator('[data-floor-target="roof"]')).toHaveCount(0);
  await overview(page, true);
  for (const p of [{ x: 480, y: 1050 }, { x: 480, y: 360 }, { x: 1660, y: 360 }]) await walk(page, p.x, p.y);
  expect((await state(page)).hall).toBe('street');
  await overview(page, false);
  await page.screenshot({ path: `../roof-${info.project.name}-stairs.png` });
  // A real click on the staircase approaches its bottom, then walks up.
  await page.evaluate(() => {
    (window as any).__roofClimb = [];
    const record = () => { const s = (window as any).royalDemo.getState(); (window as any).__roofClimb.push({ hall:s.hall, x:s.x, y:s.y }); if(s.hall==='street')requestAnimationFrame(record); };
    requestAnimationFrame(record);
  });
  await clickWorld(page, STREET_ROOF_STAIRS.click.x, STREET_ROOF_STAIRS.click.y);
  await expect.poll(async () => (await state(page)).stairStep,{timeout:10000}).toBeGreaterThanOrEqual(3);
  expect((await state(page)).renderDepth).toBeGreaterThan(620);
  expect((await state(page)).street.frontRoadVisible).toBe(false);
  await page.screenshot({path:`../roof-${info.project.name}-climb.png`});
  const prefix=await page.evaluate(()=>(window as any).__roofClimb as {hall:string;x:number;y:number}[]);
  await page.reload();
  await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
  await expect.poll(async ()=>(await state(page)).hall).toBe('street');
  expect((await state(page)).stairStep).toBeGreaterThan(0);
  await page.evaluate(()=>{
    (window as any).__roofClimb=[];
    const record=()=>{const s=(window as any).royalDemo.getState();(window as any).__roofClimb.push({hall:s.hall,x:s.x,y:s.y});if(s.hall==='street')requestAnimationFrame(record);};requestAnimationFrame(record);
  });
  await page.keyboard.press('e');
  await expect.poll(async () => (await state(page)).hall, { timeout: 15000 }).toBe('roof');
  const continuation = await page.evaluate(() => (window as any).__roofClimb as {hall:string;x:number;y:number}[]);
  const climb=[...prefix,...continuation];
  for(const waypoint of ROOF_STAIR_ROUTE.slice(1,-1))expect(climb.some(p=>p.hall==='street'&&Math.hypot(p.x-waypoint.x,p.y-waypoint.y)<10)).toBe(true);
  const bottom = climb.findIndex(p => p.hall==='street' && Math.abs(p.x-STREET_ROOF_STAIRS.foot.x)<5 && p.y>475);
  expect(bottom).toBeGreaterThan(-1);
  expect(climb.slice(bottom).some(p=>p.hall==='street'&&p.y<430)).toBe(true);
  await expect(page.locator('h1')).toContainText('Крыша казино');
  await expect(page.locator('#games-tab')).toBeHidden();
  await expect(page.locator('#chat-panel')).toBeVisible(); await expect(page.locator('#chat-input')).toBeEnabled();
  await expect(page.locator('#elevator-shortcut')).toBeHidden();
  const floors = await page.evaluate(() => (window as any).royalDemo.getElevator().floors);
  expect(floors).not.toContain('roof');
  expect((await state(page)).x).toBe(ROOF.spawn.x);
  await page.screenshot({ path: `../roof-${info.project.name}-arrival.png` });
  await overview(page, true);
  await page.screenshot({ path: `../roof-${info.project.name}-overview.png` });
  for (const p of ROOF.loop) await walk(page, p.x, p.y);
  await walk(page, 960, 1050); await overview(page, false);
  await page.screenshot({ path: `../roof-${info.project.name}-terrace.png` });
  const before = await state(page); await page.emulateMedia({reducedMotion:'reduce'}); await page.reload();
  await expect(page.locator('#chat-input')).toBeEnabled({timeout:25000});
  await expect.poll(async () => (await state(page)).online).toBe(true);
  await expect.poll(async () => (await state(page)).hall).toBe('roof');
  const recovered = await state(page); expect(recovered.reducedMotion).toBe(true);
  expect(Math.hypot(recovered.x - before.x, recovered.y - before.y)).toBeLessThan(5);
  expect((await page.evaluate(() => (window as any).royalDemo.getNetworkState())).roomId).toBe(network.roomId);
  await expect(page.locator('#chat-input')).toBeEnabled();
  await overview(page, true);
  await clickWorld(page, ROOF_STAIRS.click.x, ROOF_STAIRS.click.y);
  await expect.poll(async () => (await state(page)).hall, { timeout: 15000 }).toBe('street');
  await expect.poll(async () => (await state(page)).y).toBe(STREET_ROOF_STAIRS.arrival.y);
  // The narrow strip is outside the normal rear circulation route.
  for (const p of [{ x: 1760, y: 470 }, { x: 2320, y: 360 }, { x: 2320, y: 1050 }]) await walk(page, p.x, p.y);
  await page.locator('[data-floor-target="arcade"]').click();
  await expect.poll(async () => (await state(page)).hall, { timeout: 25000 }).toBe('arcade');
  await expect(page.locator('#wallet-balance')).toHaveText(balance!);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(errors).toEqual([]);
});
