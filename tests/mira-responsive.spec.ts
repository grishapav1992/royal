import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';

const dialogueHarness = build({ entryPoints: ['src/ui/MiraChat.ts'], bundle: true, write: false, format: 'iife', globalName: 'MiraChatTest', platform: 'browser' });

async function mountDialogue(page: Page) {
  await page.route('**/api/auth/me', route => route.fulfill({ json: { account: null } }));
  await page.route('**/api/npc/mira', route => route.fulfill({ json: route.request().method() === 'GET'
    ? { turns: [{ role: 'assistant', content: 'Тебе вино? Угощаю.' }], drinkOffer: 'wine' }
    : { reply: 'Слышу тебя.', drinkOffer: 'wine' } }));
  await page.goto('/');
  await page.locator('#loading').waitFor({ state: 'detached' });
  await expect(page.locator('#chat-panel')).toBeVisible();
  await page.addScriptTag({ content: (await dialogueHarness).outputFiles[0].text });
  await page.evaluate(() => {
    document.querySelector<HTMLDialogElement>('#join-dialog')!.close();
    const previous = document.querySelector<HTMLDialogElement>('#bar-dialog')!;
    previous.close(); previous.remove();
    const { MiraChat } = (window as any).MiraChatTest;
    const dialog = document.createElement('dialog'); dialog.id = 'bar-dialog'; dialog.className = 'bar-dialog';
    const fixture = { state: { skin: 0, soberAt: 0, action: 'idle', drink: '' }, accepted: true, calls: [] as string[] };
    const chat = new MiraChat(dialog, {
      playerState: () => fixture.state,
      onDrink: id => { fixture.calls.push(id); return fixture.accepted; },
    });
    dialog.querySelector('[data-close]')!.addEventListener('click', () => dialog.close());
    Object.assign(window, { miraFixture: fixture, miraChatFixture: chat });
    chat.open(); dialog.show();
  });
  await expect(page.locator('.mira-status')).toBeEmpty();
}

async function expectInsideDialogue(page: Page, selector: string, scrollable = false) {
  const result = await page.locator(selector).evaluate((element, scrollable) => {
    const bounds = element.getBoundingClientRect(), dialog = document.querySelector('#bar-dialog')!.getBoundingClientRect();
    const clip = scrollable ? element.closest('.mira-menu')!.getBoundingClientRect() : dialog;
    const topY = Math.max(bounds.top, clip.top), bottomY = Math.min(bounds.bottom, clip.bottom);
    const top = document.elementFromPoint(bounds.x + bounds.width / 2, (topY + bottomY) / 2);
    return { inside: (scrollable ? bottomY - topY > 4 : bounds.top >= dialog.top && bounds.bottom <= dialog.bottom) && bounds.left >= dialog.left && bounds.right <= dialog.right,
      clickable: !!top && (element === top || element.contains(top)) };
  }, scrollable);
  expect(result).toEqual({ inside: true, clickable: true });
}

test('short landscape dialogue keeps the composer, offer and drink menu usable', async ({ page }) => {
  await mountDialogue(page);
  for (const viewport of [{ width: 667, height: 375 }, { width: 568, height: 320 }, { width: 490, height: 350 }, { width: 390, height: 350 }, { width: 701, height: 300 }]) {
    await page.setViewportSize(viewport);
    await expect(page.locator('#bar-dialog')).toHaveClass(/mira-scroll/);
    await expectInsideDialogue(page, '.mira-answer input');
    await expectInsideDialogue(page, '.mira-answer button');
    await expectInsideDialogue(page, '.mira-leave');
    const offer = page.locator('.mira-drink-offer button');
    await expect(offer).toBeVisible();
    await offer.scrollIntoViewIfNeeded(); await offer.click({ timeout: 4000 });
    await expect.poll(() => page.evaluate(() => (window as any).miraFixture.calls.at(-1))).toBe('wine');
    await expect(offer).toBeDisabled();
    await expect(page.locator('.mira-player')).not.toHaveClass(/is-drinking/);
    await page.evaluate(() => {
      const fixture = (window as any).miraFixture;
      fixture.state.action = 'drink'; fixture.state.drink = 'wine';
    });
    await expect(page.locator('.mira-player')).toHaveClass(/is-drinking/);
    await page.evaluate(() => { (window as any).miraFixture.state.action = 'idle'; });
    await expect(offer).toBeEnabled();
    const input = page.getByRole('textbox', { name: 'Твоя реплика Мире' });
    await input.fill(`Привет ${viewport.width}`); await input.press('Enter');
    await expect(page.locator('.mira-log')).toHaveText('Слышу тебя.');
    await page.getByRole('button', { name: 'Напитки', exact: true }).click();
    const whisky = page.locator('[data-drink="whisky"]');
    await expectInsideDialogue(page, '.mira-leave');
    await whisky.scrollIntoViewIfNeeded(); await expectInsideDialogue(page, '[data-drink="whisky"]', true);
    await whisky.click();
    await expect.poll(() => page.evaluate(() => (window as any).miraFixture.calls.at(-1))).toBe('whisky');
    await page.evaluate(() => {
      const fixture = (window as any).miraFixture;
      fixture.state.action = 'drink'; fixture.state.drink = 'whisky';
    });
    await expect(page.locator('.mira-player')).toHaveClass(/is-drinking/);
    await page.evaluate(() => { (window as any).miraFixture.state.action = 'idle'; });
    await expect(whisky).toBeEnabled();
    await page.getByRole('button', { name: 'Разговор', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Уйти', exact: true }).click();
  await expect(page.locator('#bar-dialog')).toBeHidden();
});

test('drink animation waits for accepted room state and rejects a failed command', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mountDialogue(page);
  const offer = page.locator('.mira-drink-offer button'), player = page.locator('.mira-player');
  await page.evaluate(() => { (window as any).miraFixture.accepted = false; });
  await offer.click();
  await expect(player).not.toHaveClass(/is-drinking/);
  await expect(offer).toBeEnabled();
  await expect(page.locator('.mira-status')).toContainText('Не получилось взять напиток');
  await page.evaluate(() => { (window as any).miraFixture.accepted = true; });
  await offer.click();
  await expect(player).not.toHaveClass(/is-drinking/);
  await expect(offer).toBeDisabled();
  await expect(page.locator('.mira-player figcaption small')).toHaveText('Ждёшь напиток…');
  await page.evaluate(() => {
    const fixture = (window as any).miraFixture;
    fixture.state.action = 'drink'; fixture.state.drink = 'wine';
  });
  await expect(player).toHaveClass(/is-drinking/);
  await expect(page.locator('.mira-player figcaption small')).toHaveText('Пьёшь: Вино');
  await page.evaluate(() => { (window as any).miraFixture.state.action = 'idle'; });
  await expect(offer).toBeEnabled();
  await offer.click();
  await expect(offer).toBeDisabled();
  await expect(page.locator('.mira-status')).toHaveText('Напиток не получен. Попробуй ещё раз.', { timeout: 6500 });
  await expect(player).not.toHaveClass(/is-drinking/);
  await expect(offer).toBeEnabled();
});
