import {expect} from '@playwright/test';
import {test} from './themed-room';
import {chooseGame, enterGameHall} from './game-layout-host';

declare global {
  interface Window { cosmicMusicPlayers: {media: HTMLMediaElement; meter: AnalyserNode}[] }
}

test('Cosmic Escape rotates three audible tracks and pauses with the host', async ({page, roomPath}) => {
  await page.addInitScript(() => {
    window.cosmicMusicPlayers = [];
    const create = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function(media) {
      const source = create.call(this, media);
      const meter = this.createAnalyser();
      source.connect(meter);
      window.cosmicMusicPlayers.push({media, meter});
      return source;
    };
  });

  await enterGameHall(page, roomPath);
  const game = 'studio-cosmic-escape';
  const enter = page.locator('[data-lg-dialog-action=enter]');
  const track = () => page.evaluate(() => {
    const player = window.cosmicMusicPlayers.at(-1);
    if (!player || player.media.paused) return '';
    const samples = new Float32Array(player.meter.fftSize);
    player.meter.getFloatTimeDomainData(samples);
    return samples.some(value => Math.abs(value) > 0.002) ? player.media.currentSrc.split('/').pop() : '';
  });
  const paused = () => page.evaluate(() => window.cosmicMusicPlayers.at(-1)!.media.paused);
  await chooseGame(page, game);
  await expect(enter).toBeEnabled();
  expect(await track()).toBe('');
  await enter.click();
  await expect.poll(track).toBe('orbital-drift.m4a');

  const chat = page.locator('#club-chat-dock');
  if (!await chat.isVisible()) await page.locator('#mini-dialog .game-chat-toggle').click();
  await expect(chat.locator('#chat-input')).toBeVisible();

  for (const next of ['ion-runner.m4a', 'far-beacon.m4a', 'orbital-drift.m4a']) {
    await page.evaluate(() => {
      const {media} = window.cosmicMusicPlayers.at(-1)!;
      media.currentTime = media.duration - 0.15;
    });
    await expect.poll(track).toBe(next);
  }

  if (await chat.isVisible() && (page.viewportSize()?.width ?? 0) < 600) {
    await chat.locator('.game-chat-close').click();
  }
  await page.locator('.slot-settings-button').click();
  const toggle = page.locator('.slot-settings-dialog [data-lg-music]');
  await toggle.click();
  await expect.poll(paused).toBe(true);
  await toggle.click();
  await expect.poll(track).toBe('orbital-drift.m4a');
  const volume = page.locator('.slot-settings-dialog [data-lg-volume]');
  await volume.focus();
  await volume.press('Home');
  await expect.poll(paused).toBe(true);
  await volume.press('End');
  await expect.poll(track).toBe('orbital-drift.m4a');
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {value: true, configurable: true});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(paused).toBe(true);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(track).toBe('orbital-drift.m4a');

  const before = await page.evaluate(() => window.cosmicMusicPlayers.length);
  await page.locator('#studio-game-list').click();
  await expect.poll(paused).toBe(true);
  expect(await page.evaluate(() => window.cosmicMusicPlayers.at(-1)!.media.hasAttribute('src'))).toBe(false);
  await chooseGame(page, game);
  await enter.click();
  await expect.poll(track).toBe('ion-runner.m4a');
  expect(await page.evaluate(() => window.cosmicMusicPlayers.length)).toBe(before + 1);
});
