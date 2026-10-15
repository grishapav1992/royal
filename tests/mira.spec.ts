import { test, expect } from '@playwright/test';

test('Mira chat shows replies safely, retains failed input and resets on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = false, spoke = false;
  await page.route('**/api/npc/mira', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { turns: spoke ? [{ role: 'user', content: 'Привет' }, { role: 'assistant', content: '<b>Привет</b>, рада видеть!' }] : [{ role: 'assistant', content: 'Ну? Чем удивишь?' }] } });
    if (!fail) spoke = true;
    return route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: 'Разговор пока не настроен.' } : { reply: '<b>Привет</b>, рада видеть!' } });
  });
  await page.route('**/api/npc/mira/reset', route => { spoke = false; return route.fulfill({ json: { ok: true } }); });
  await page.goto('/?offline=1'); await page.locator('#loading').waitFor({ state: 'detached' });
  await page.locator('#visit-bar').click(); await expect(page.locator('#bar-dialog')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.mira-log')).toHaveText('Ну? Чем удивишь?');
  await expect(page.locator('[data-drink="coffee"]')).toBeHidden();
  await page.getByRole('button', { name: 'Напитки', exact: true }).click();
  await expect(page.locator('[data-drink="coffee"]')).toBeVisible();
  await expect(page.locator('.mira-talk')).toBeHidden();
  await page.getByRole('button', { name: 'Разговор', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Твоя реплика Мире' });
  await input.fill('Привет'); await page.getByRole('button', { name: 'Сказать', exact: true }).click();
  await expect(page.locator('.mira-log')).toContainText('<b>Привет</b>'); await expect(page.locator('.mira-log b')).toHaveCount(0);
  await page.getByRole('button', { name: 'История', exact: true }).click();
  await expect(page.locator('.mira-history')).toContainText('Ты: Привет');
  await expect(page.locator('.mira-history b')).toHaveCount(0);
  await page.getByRole('button', { name: 'Уйти', exact: true }).click();
  await page.locator('#visit-bar').click();
  await expect(input).toBeVisible();
  await expect(page.locator('.mira-log')).toContainText('<b>Привет</b>');
  fail = true; await input.fill('Извини'); await page.getByRole('button', { name: 'Сказать', exact: true }).click();
  await expect(page.locator('.mira-status')).toContainText('не настроен'); await expect(input).toHaveValue('Извини');
  await page.locator('.mira-options summary').click();
  await page.getByRole('button', { name: 'Начать заново' }).click(); await expect(page.locator('.mira-log')).toHaveText('Ну? Чем удивишь?');
  const box = (await page.locator('#bar-dialog').boundingBox())!; expect(box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'artifacts/mira-mobile.png' });
});

test('Mira stays centered and stable while the player uses the room chat during a reply', async ({ page }) => {
  test.setTimeout(90000);
  let finish: (() => void) | undefined;
  await page.route('**/api/npc/mira', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { turns: [{ role: 'assistant', content: 'Ну? Чем удивишь?' }] } });
    await new Promise<void>(resolve => { finish = resolve; });
    await route.fulfill({ json: { reply: 'Ты уже спрашивал. Пока ничего не поменялось.' } });
  });
  await page.goto('/');
  await page.getByLabel('Почта', { exact: true }).fill(`mira-layout-${crypto.randomUUID()}@example.test`);
  await page.getByLabel('Пароль', { exact: true }).fill('Royal-demo-123!');
  await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(page.locator('#character-step')).toBeVisible();
  await page.getByRole('button', { name: 'Войти в зал', exact: true }).click();
  await expect(page.locator('#join-dialog')).toBeHidden();
  const room = page.locator('.room-panel'), dialogue = page.locator('#bar-dialog');
  const choice = page.getByRole('button', { name: '› Как твоя смена?', exact: true });
  const chat = page.getByLabel('Сообщение в общий чат');
  await page.locator('#visit-bar').click(); await expect(dialogue).toBeVisible({ timeout: 15000 });
  for (const size of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 390, height: 500 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size); await expect(chat).toBeInViewport();
    await expect.poll(async () => {
      const outer = (await room.boundingBox())!, inner = (await dialogue.boundingBox())!;
      return Math.abs(inner.y + inner.height / 2 - outer.y - outer.height / 2);
    }).toBeLessThan(1);
    const before = (await choice.boundingBox())!, panelBefore = (await dialogue.boundingBox())!;
    await choice.click(); await expect(page.locator('.mira-status')).toHaveText('Мира отвечает…');
    const during = (await choice.boundingBox())!; expect(during.y).toBeCloseTo(before.y, 0);
    const text = `Привет залу ${size.width} на ${size.height}`;
    await chat.fill(text); await chat.press('Enter');
    await expect(page.locator('#chat-log')).toContainText(text, { timeout: 20000 });
    await expect(chat).toBeEnabled();
    await chat.fill('Продолжаю писать в чат'); await expect(chat).toBeFocused();
    finish!(); await expect(page.locator('.mira-status')).toBeEmpty();
    await expect(page.locator('.mira-log')).toBeInViewport();
    expect((await page.locator('.mira-log').boundingBox())!.height).toBeGreaterThanOrEqual(36);
    await expect(chat).toBeFocused(); await expect(chat).toHaveValue('Продолжаю писать в чат');
    const after = (await choice.boundingBox())!, panelAfter = (await dialogue.boundingBox())!;
    expect(after.y).toBeCloseTo(before.y, 0); expect(panelAfter).toEqual(panelBefore);
    await expect(dialogue).toBeVisible();
    await page.screenshot({ path: `artifacts/mira-stable-${size.width}.png` });
  }
});

test('RPG reply choices send real messages and dialogue fits desktop and landscape', async ({ page }) => {
  let message = '';
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/npc/mira', route => { if (route.request().method() === 'GET') return route.fulfill({ json: { turns: [{ role: 'assistant', content: 'Ну? Чем удивишь?' }] } }); message = route.request().postDataJSON().message; return route.fulfill({ json: { reply: 'Длинная. С тобой уже веселее.' } }); });
  await page.goto('/?offline=1'); await page.locator('#loading').waitFor({ state: 'detached' });
  await page.locator('#visit-bar').click(); await expect(page.locator('#bar-dialog')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '› Как твоя смена?', exact: true }).click();
  await expect(page.locator('.mira-log')).toHaveText('Длинная. С тобой уже веселее.');
  expect(message).toBe('Как твоя смена?');
  await page.screenshot({ path: 'artifacts/mira-rpg-desktop.png' });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => { const bounds = (await page.locator('#bar-dialog').boundingBox())!; return bounds.y + bounds.height; }).toBeLessThanOrEqual(390);
  const box = (await page.locator('#bar-dialog').boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(390);
  await expect(page.getByRole('button', { name: 'Сказать', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'artifacts/mira-rpg-landscape.png' });
  await page.keyboard.press('Escape'); await expect(page.locator('#bar-dialog')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).royalDemo.getState().locked)).toBe(false);
  expect(errors).toEqual([]);
});

test('Mira restores past conversations after reload, changes reply choices and keeps her pause', async ({ page }) => {
  let turns = [{ role: 'user', content: 'Люблю джаз' }, { role: 'assistant', content: '5 дней без тебя. Стаканы справлялись лучше.' }];
  let cooldownUntil = 0; const choices = ['Расскажи про джаз', 'Прости, пропал', 'Я вернулся за лимонадом']; let message = '';
  await page.route('**/api/npc/mira', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { turns, choices, cooldownUntil } });
    message = route.request().postDataJSON().message;
    turns.push({ role: 'user', content: message }, { role: 'assistant', content: 'На сегодня хватит. Я займусь стаканами.' });
    cooldownUntil = Date.now() + 2000;
    return route.fulfill({ json: { reply: turns.at(-1)!.content, choices, cooldownUntil } });
  });
  await page.goto('/?offline=1'); await page.locator('#loading').waitFor({ state: 'detached' });
  await page.locator('#visit-bar').click();
  await expect(page.locator('.mira-log')).toContainText('5 дней');
  await page.getByRole('button', { name: 'История', exact: true }).click();
  await expect(page.locator('.mira-history')).toContainText('Люблю джаз');
  await page.getByRole('button', { name: 'Разговор', exact: true }).click();
  await page.getByRole('button', { name: '› Расскажи про джаз', exact: true }).click();
  await expect(page.locator('.mira-status')).toContainText('занялась стаканами');
  expect(message).toBe('Расскажи про джаз');
  await expect(page.getByRole('button', { name: 'Сказать', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Напитки', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Сказать', exact: true })).toBeEnabled({ timeout: 5000 });
  await page.reload(); await page.locator('#loading').waitFor({ state: 'detached' }); await page.locator('#visit-bar').click();
  await expect(page.locator('.mira-log')).toHaveText('На сегодня хватит. Я займусь стаканами.');
});
