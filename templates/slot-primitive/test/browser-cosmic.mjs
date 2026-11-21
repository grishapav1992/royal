import assert from 'node:assert/strict';

export async function checkCosmic(page, expect) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://slot-primitive.test/cosmic.html');
  const cabinet = page.getByRole('region', { name: 'Cosmic Escape' });
  const field = name => cabinet.locator(`[data-cosmic="${name}"]`);
  const scene = page.locator('#cosmic-scenario');
  const size = page.locator('#cosmic-size');
  const primary = field('primary');
  const auto = field('auto');
  const balance = field('balance');
  const stake = field('stake');
  await expect(cabinet).toHaveAttribute('data-layout', 'wide');
  for (const [width, height, layout] of [[1440, 900, 'wide'], [390, 844, 'portrait'], [844, 390, 'short'], [320, 568, 'portrait']]) {
    await page.setViewportSize({ width, height });
    await expect(cabinet).toHaveAttribute('data-layout', layout);
    await expect(cabinet.getByRole('img')).toHaveCount(15);
    const frame = await cabinet.locator('.cosmic-frame').boundingBox();
    const button = await primary.boundingBox();
    const panel = await cabinet.boundingBox();
    assert.ok(frame && button && panel && frame.width > 120 && frame.height > 100,
      `${width}×${height}: поле не помещается ${JSON.stringify({ frame, button, panel })}`);
    assert.ok(button.width >= 44 && button.height >= 44 && button.y + button.height <= panel.y + panel.height, `${width}×${height}: пульт обрезан`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const ratio = layout === 'wide' ? 820 / 470 : layout === 'short' ? 500 / 282 : 5 / 4;
    assert.ok(Math.abs(frame.width / frame.height - ratio) < .02, `${layout}: пропорции изменились`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await size.selectOption('short');
  await expect(cabinet).toHaveAttribute('data-layout', 'short');
  await size.selectOption('auto');
  await expect(cabinet).toHaveAttribute('data-layout', 'wide');

  await stake.fill('0,101');
  await expect(stake).toHaveAttribute('aria-invalid', 'true');
  await expect(primary).toBeDisabled();
  await stake.press('Enter');
  await expect(balance).toHaveText('50,00');
  await stake.fill('0,10');
  await stake.press('Enter');
  await expect(balance).toHaveText('49,90');
  await expect(field('return')).toHaveText('0,00');
  await scene.selectOption('win');
  await primary.click();
  await expect(balance).toHaveText('50,02');
  await expect(field('return')).toHaveText('0,12');
  await expect(cabinet.locator('[data-highlight]')).toHaveCount(4);

  await scene.selectOption('portal');
  await expect(field('portals')).toHaveText('3 / 5');
  await expect(primary).toHaveText('Начать бонус');
  await primary.click();
  await expect(field('energy')).toHaveText('×2');
  await expect(balance).toHaveText('49,90');
  await scene.selectOption('echo');
  await expect(field('cue')).toHaveText('Эхо');
  await expect(field('mode')).toContainText('8 из 10');
  await scene.selectOption('result');
  await expect(field('return')).toHaveText('8,30');
  await expect(primary).toHaveText('Подтвердить итог');
  await primary.click();
  await expect(balance).toHaveText('58,20');

  await scene.selectOption('recovery');
  await primary.click();
  await expect(primary).toHaveText('Проверить прежний ход');
  await expect(balance).toHaveText('50,00');
  const reopen = page.locator('#cosmic-reopen');
  await reopen.click();
  await expect(cabinet).toHaveCount(0);
  await reopen.click();
  await expect(primary).toHaveText('Проверить прежний ход');
  await primary.click();
  await expect(balance).toHaveText('50,02');
  await expect(primary).toHaveText('Вращать');

  await scene.selectOption('ordinary');
  await auto.focus();
  await page.keyboard.press('Enter');
  await expect(cabinet.getByRole('dialog', { name: 'Автоигра' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(auto).toBeFocused();
  await expect(balance).toHaveText('50,00');
  await auto.click();
  await field('auto-start').click();
  await expect(auto).toHaveText('Стоп · 9');
  await auto.click();
  await expect(auto).toHaveText('Авто');
  await expect(balance).toHaveText('49,90');

  await scene.selectOption('bonus');
  await auto.click();
  await field('auto-start').click();
  await expect(primary).toHaveText('Подтвердить итог', { timeout: 8000 });
  await expect(auto).toHaveText('Стоп · 9');
  await expect(balance).toHaveText('58,20');
  await primary.click();
  await expect(balance).toHaveText('57,30', { timeout: 8000 });
  await expect(auto).toHaveText('Авто');
  await expect(cabinet).toHaveAttribute('data-awaiting', 'false');
  console.log('Cosmic Escape: размеры, фокус, выигрыш, 10 бесплатных ходов, автоигра, повтор, локальные ресурсы.');
}
