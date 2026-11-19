import {expect} from '@playwright/test';
import {test} from './themed-room';
import {chooseGame, enterGameHall} from './game-layout-host';
import {walletSnapshot} from './wallet-snapshot';

const gameId = 'studio-cosmic-escape';

test('Cosmic Escape racer reacts to confirmed outcomes and the portal in the connected host', async ({page, roomPath}) => {
  await enterGameHall(page, roomPath);
  await chooseGame(page, gameId);
  const game = page.locator('#mini-game > .cx-game');
  const actor = game.locator('[data-cosmic-alien]');
  const spin = game.locator('[data-lg-spin]');
  const chat = page.locator('#club-chat-dock');
  const toggle = page.locator('#mini-dialog .game-chat-toggle');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(game).toHaveAttribute('data-asset-state', 'ready');
  await game.locator('[data-lg-dialog-action=enter]').click();
  if (!await chat.isVisible()) await toggle.click();
  await expect(chat.locator('#chat-input')).toBeVisible();
  await expect(actor).toHaveAttribute('data-racer-cue', 'idle');
  await expect(actor).toHaveAttribute('data-racer-animated', 'false');
  await page.emulateMedia({reducedMotion: 'no-preference'});
  await expect(actor).toHaveAttribute('data-racer-animated', 'true');
  await expect(actor).toHaveJSProperty('naturalWidth', 272);
  expect(await actor.evaluate(el => getComputedStyle(el.parentElement!, '::before').backgroundImage)).toContain('radial-gradient');
  expect(await game.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('/cosmic-guardians/v1/background.webp');
  await game.locator('[data-cx-speed=fast]').click();

  for (const cue of ['calm', 'win', 'big-win']) {
    const seed = await page.request.post('/__test/layout/bonus', {data: {gameId, scenario: cue}});
    expect(seed.ok()).toBe(true);
    await spin.click();
    await expect(actor).toHaveAttribute('data-racer-cue', 'focus');
    await expect(actor).toHaveAttribute('data-racer-cue', cue, {timeout: 15000});
    await expect(actor).toHaveAttribute('data-racer-animated', 'true');
    await expect(actor).toHaveAttribute('data-racer-cue', 'idle');
  }
  const snapshot = await walletSnapshot(page);
  const bets = snapshot.entries.filter((entry: {kind: string}) => entry.kind === 'bet');
  expect(bets).toHaveLength(3);
  expect(bets.map((entry: {amount: number}) => entry.amount)).toEqual([-.1, -.1, -.1]);

  await page.setViewportSize({width: 393, height: 852});
  await expect(game).toHaveAttribute('data-slot-priority', 'portrait');
  if (await chat.isVisible()) await chat.locator('.game-chat-close').click();
  await expect(actor).toBeVisible();
  const portal = await page.request.post('/__test/layout/bonus', {data: {gameId}});
  expect(portal.ok()).toBe(true);
  await spin.click();
  await expect(actor).toHaveAttribute('data-racer-cue', 'bonus', {timeout: 15000});
  await expect(actor).toHaveAttribute('data-racer-animated', 'true');
  await expect(game.locator('[data-lg-dialog=bonus], .ce-dialog[data-dialog=bonus]')).toBeVisible();
  await page.emulateMedia({reducedMotion: 'reduce'});
  await expect(actor).toHaveAttribute('data-racer-animated', 'false');

  await page.locator('#studio-game-list').click();
  await chooseGame(page, gameId);
  await expect(game).toHaveAttribute('data-asset-state', 'ready');
  await expect(actor).toHaveAttribute('data-racer-cue', 'idle');
  expect(errors).toEqual([]);
});
