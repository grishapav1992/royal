import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/cr-leo-rendering.html');
  await page.waitForFunction(() => (window as any).crLeoRendering?.ready());
});
async function enable(page: import('@playwright/test').Page) {
  await page.locator('#sound').click();
  await page.waitForFunction(() => (window as any).crLeoRendering.audio.state().ready === 6);
}
test('ordinary goals only get the crowd reaction and every loss gets disappointment', async ({ page }) => {
  await enable(page);
  const frames = await page.evaluate(async () => {
    const { audio, begin, advance } = (window as any).crLeoRendering, results = [];
    for (const hero of ['cr', 'leo']) for (const risk of ['safe', 'sharp', 'extreme']) for (const finish of ['goal', 'save', 'post', 'wide']) {
      audio.silence(); await audio.unlock();
      begin({ hero, risk, finish, zone: 0 });
      const end = risk === 'safe' ? 1.7 : risk === 'sharp' ? 2.12 : 2.5;
      const before = audio.state(); advance(1.119, true); const windup = audio.state();
      advance(1.121, true); advance(1.16, true); const contact = audio.state();
      advance(end - .002, true); const flight = audio.state();
      advance(end + .002, true); advance(end + .05, true); advance(end + .7, true);
      results.push({ hero, risk, finish, before, windup, contact, flight, after: audio.state() });
    }
    return results;
  });
  for (const frame of frames) {
    expect(frame.windup.played).toEqual(frame.before.played);
    expect(frame.contact.played).toEqual({ ...frame.before.played, kick: (frame.before.played.kick ?? 0) + 1 });
    expect(frame.flight.played).toEqual(frame.contact.played);
    const clip = frame.hero === 'cr' ? 'siuuu' : 'ankara-messi', other = frame.hero === 'cr' ? 'ankara-messi' : 'siuuu';
    expect(frame.after.played[clip] ?? 0).toBe(frame.before.played[clip] ?? 0);
    expect(frame.after.played[other] ?? 0).toBe(frame.before.played[other] ?? 0);
    const reaction = frame.finish === 'goal' ? 'goal' : 'miss';
    expect(frame.after.played[reaction]).toBe((frame.before.played[reaction] ?? 0) + 1);
    expect(frame.after.voices).toBe(0);
    expect(frame.after.crowd).toBe(true);
  }
  // Wall collision uses the earlier existing result clock and the same missed-chance audience.
  const wall = await page.evaluate(() => {
    const { audio, begin, advance } = (window as any).crLeoRendering;
    begin({ hero: 'cr', risk: 'sharp', finish: 'wide', zone: 8 }); const before = audio.state();
    advance(1.54, true); const flight = audio.state(); advance(1.56, true);
    return { before, flight, after: audio.state() };
  });
  expect(wall.flight.played).toEqual({ ...wall.before.played, kick: wall.before.played.kick + 1 });
  expect(wall.after.played.miss).toBe(wall.before.played.miss + 1);
  expect(wall.after.voices).toBe(0);
  const resumed = await page.evaluate(() => {
    const { audio, scene, begin, advance } = (window as any).crLeoRendering;
    begin({ hero: 'leo', risk: 'safe', finish: 'goal', complete: true });
    const before = audio.state().played;
    scene.skipPastSounds(performance.now() + (2 - scene.state().t) * 1000);
    advance(2.1, true);
    return { before, after: audio.state().played };
  });
  expect(resumed.after).toEqual(resumed.before);
  // Exercise the visible play button and its animation clock, including many successive RAFs.
  const beforePlay = await page.evaluate(() => (window as any).crLeoRendering.audio.state().played);
  await page.locator('#hero').selectOption('leo');
  await page.locator('#finish').selectOption('goal');
  await page.locator('#play').click();
  const endTime = Number(await page.locator('#time').getAttribute('max')).toFixed(2) + ' s';
  await expect(page.locator('#elapsed')).toHaveText(endTime);
  const played = await page.evaluate(() => (window as any).crLeoRendering.audio.state().played);
  expect(played['ankara-messi']).toBe(beforePlay['ankara-messi']);
  expect(played.goal).toBe(beforePlay.goal + 1); expect(played.siuuu).toBe(beforePlay.siuuu);
});
test('only a newly paid five-goal series gets the hero phrase once at every distance', async ({ page }) => {
  await enable(page);
  const frames = await page.evaluate(async () => {
    const { audio, begin, advance } = (window as any).crLeoRendering, results = [];
    for (const hero of ['cr', 'leo']) for (const risk of ['safe', 'sharp', 'extreme']) {
      const end = risk === 'safe' ? 1.7 : risk === 'sharp' ? 2.12 : 2.5;
      for (let goals = 1; goals <= 4; goals++) for (const banked of [false, true]) {
        audio.silence(); await audio.unlock();
        begin({ hero, risk, finish: 'goal', goals, banked });
        const before = audio.state().played;
        advance(0, true); advance(end + .7, true); advance(5, true);
        results.push({ hero, risk, kind: 'early', before, after: audio.state() });
      }
      for (const mixed of [false, true]) {
        audio.silence(); await audio.unlock();
        begin({ hero, risk, finish: 'goal', complete: true, previousRisks: mixed ? ['safe', 'sharp', 'extreme', 'safe'] : undefined });
        const before = audio.state().played;
        advance(end + .002, true); advance(end + .19, true); const goal = audio.state();
        advance(end + .21, true); advance(end + .3, true); advance(end + 1, true); advance(5, true);
        results.push({ hero, risk, kind: 'complete', before, goal, after: audio.state() });
      }
      audio.silence(); await audio.unlock();
      begin({ hero, risk, finish: 'goal', complete: true, restored: true });
      const before = audio.state().played; advance(0, true); advance(5, true);
      results.push({ hero, risk, kind: 'restored', before, after: audio.state() });
    }
    return results;
  });
  for (const frame of frames) {
    const clip = frame.hero === 'cr' ? 'siuuu' : 'ankara-messi', other = frame.hero === 'cr' ? 'ankara-messi' : 'siuuu';
    expect(frame.after.played[clip] ?? 0, JSON.stringify(frame)).toBe((frame.before[clip] ?? 0) + Number(frame.kind === 'complete'));
    expect(frame.after.played[other] ?? 0).toBe(frame.before[other] ?? 0);
    expect(frame.after.voices).toBe(Number(frame.kind === 'complete'));
    if (frame.goal) {
      expect(frame.goal.played[clip] ?? 0).toBe(frame.before[clip] ?? 0);
      expect(frame.goal.played.goal).toBe((frame.before.goal ?? 0) + 1);
      expect(frame.after.played.goal).toBe(frame.goal.played.goal);
    }
    if (frame.kind === 'restored') expect(frame.after.played).toEqual(frame.before);
  }
});

test('CR lands on the trimmed Siuuu cue and the complete recording finishes before the next shot', async ({ page }) => {
  await enable(page);
  for (const width of [1100, 390]) {
    await page.setViewportSize({ width, height: 860 });
    const frames = await page.evaluate(() => {
      const { render, scene } = (window as any).crLeoRendering, rows = [];
      for (const risk of ['safe', 'sharp', 'extreme']) {
        const celebration = (risk === 'safe' ? 1.7 : risk === 'sharp' ? 2.12 : 2.5) + .2;
        const poses = [0, 1.2, 2.0, 2.49, 2.51].map(t => render({ hero: 'cr', risk, finish: 'goal', complete: true, t: celebration + t }).pose);
        render({ hero: 'cr', risk, finish: 'goal', complete: true, t: celebration + 4.62 });
        const busy = scene.state(performance.now() + ((celebration + 4.62) - scene.state().t) * 1000).busy;
        rows.push({ risk, poses, busy });
      }
      return rows;
    });
    for (const frame of frames) { expect(frame.poses).toEqual(['7', '8', '10', '10', '11']); expect(frame.busy).toBe(true); }
  }
  await page.setViewportSize({ width: 1100, height: 860 });
  await page.locator('#hero').selectOption('cr');
  await page.locator('#risk').selectOption('sharp');
  await page.locator('#series').selectOption('complete');
  await page.evaluate(() => {
    const { audio } = (window as any).crLeoRendering, original = audio.celebrate.bind(audio);
    const probe: any = { before: audio.state().played.siuuu ?? 0 };
    (window as any).crLeoSync = probe;
    audio.celebrate = (hero: string) => { original(hero); if (hero === 'cr') probe.start = audio.context.currentTime; };
    let previous = '';
    const tick = () => {
      const pose = document.querySelector<HTMLCanvasElement>('#scene')!.dataset.pose;
      if (probe.start !== undefined && pose === '11') { probe.delta = audio.context.currentTime - probe.start; probe.previous = previous; probe.played = audio.state().played.siuuu; return; }
      previous = pose ?? ''; requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.locator('#play').click();
  await page.waitForFunction(() => (window as any).crLeoSync.delta !== undefined, undefined, { timeout: 12000 });
  const result = await page.evaluate(() => (window as any).crLeoSync);
  expect(result.previous).toBe('10'); expect(Math.abs(result.delta - 2.5)).toBeLessThan(.08);
  expect(result.played).toBe(result.before + 1);
});

test('local and host mute cancel voices, preserve the shared context and resume only neutral ambience', async ({ page }) => {
  await enable(page);
  const result = await page.evaluate(async () => {
    const { audio, gameAudio } = (window as any).crLeoRendering;
    audio.kick(); audio.goal(); audio.celebrate('cr'); const goal = audio.state();
    gameAudio.setMuted(true); const muted = audio.state(); audio.celebrate('leo');
    gameAudio.setMuted(false); const unmuted = audio.state();
    audio.celebrate('leo'); gameAudio.setVolume(0); const zero = audio.state();
    gameAudio.setVolume(.35); const volume = audio.state();
    audio.toggle(); const local = audio.state(); audio.celebrate('cr'); audio.toggle(); await audio.unlock();
    return { goal, muted, unmuted, zero, volume, local, resumed: audio.state(), host: gameAudio.context.state };
  });
  expect(result.goal.voices).toBe(1);
  for (const state of [result.muted, result.zero, result.local]) expect(state.sources).toBe(0);
  for (const state of [result.unmuted, result.volume, result.resumed]) { expect(state.crowd).toBe(true); expect(state.voices).toBe(0); }
  expect(result.resumed.played.siuuu).toBe(1); expect(result.resumed.played['ankara-messi']).toBe(1);
  expect(result.resumed.played.kick).toBe(1);
  expect(result.host).toBe('running');
});
test('closing a window cancels its sources and a new owner reuses all six decoded recordings', async ({ page }) => {
  const requests: string[] = []; page.on('request', r => { if (r.url().includes('/cr-vs-leo/audio/')) requests.push(r.url()); });
  await enable(page);
  const result = await page.evaluate(async () => {
    const { audio, Audio, gameAudio } = (window as any).crLeoRendering;
    audio.kick(); audio.celebrate('leo'); const context = gameAudio.context; audio.destroy(); audio.destroy();
    const closed = audio.state(), next = new Audio(); await next.unlock();
    const reopened = next.state(); next.destroy();
    return { closed, reopened, disposed: next.state(), sameContext: context === gameAudio.context, host: context.state };
  });
  expect(result.closed.sources).toBe(0); expect(result.disposed.sources).toBe(0);
  expect(result.reopened.ready).toBe(6); expect(result.reopened.crowd).toBe(true); expect(result.reopened.voices).toBe(0);
  expect(result.sameContext).toBe(true); expect(result.host).toBe('running'); expect(requests).toHaveLength(6);
});
test('a failed voice can retry without blocking play or replaying a stale celebration', async ({ page }) => {
  let requests = 0;
  await page.route('**/audio/v1/siuuu.mp3', async route => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, body: '' });
    else await route.fulfill({ body: await readFile('public/assets/cr-vs-leo/audio/v1/siuuu.mp3'), contentType: 'audio/mpeg' });
  });
  await page.locator('#sound').click();
  await page.waitForFunction(() => { const a = (window as any).crLeoRendering.audio.state(); return !a.loading && a.ready === 5; });
  const result = await page.evaluate(async () => {
    const { audio } = (window as any).crLeoRendering;
    audio.goal(); audio.celebrate('cr'); const missing = audio.state(); await audio.unlock(); const loaded = audio.state();
    audio.celebrate('cr'); const fresh = audio.state(); audio.destroy(); return { missing, loaded, fresh };
  });
  expect(result.missing.crowd).toBe(true); expect(result.missing.played.goal).toBe(1); expect(result.missing.voices).toBe(0);
  expect(result.loaded.ready).toBe(6); expect(result.loaded.voices).toBe(0); expect(result.loaded.played.siuuu).toBeUndefined();
  expect(result.fresh.played.siuuu).toBe(1); expect(requests).toBe(2);
});
test('actual recordings render at distinct crowd levels without clipping or an audible loop discontinuity', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { Audio } = (window as any).crLeoRendering, results: any[] = [];
    for (const mode of ['neutral', 'cr', 'leo', 'kick', 'miss', 'close']) {
      const duration = mode === 'neutral' ? 48.2 : 7, c = new OfflineAudioContext(2, 44100 * duration, 44100);
      const output = c.createGain(); output.gain.value = .35; output.connect(c.destination);
      const audio = new Audio({ context: () => c, output: () => output, allowed: () => true, unlock: () => Promise.resolve(), subscribe: () => () => {}, fetch: (url: string) => fetch(url) });
      await audio.unlock();
      if (mode === 'cr' || mode === 'leo') { audio.goal(); audio.celebrate(mode); }
      else if (mode === 'kick') audio.kick();
      else if (mode === 'miss' || mode === 'close') audio.miss(false);
      const pause = mode === 'close' ? c.suspend(.3) : undefined, rendering = c.startRendering();
      if (pause) { await pause; audio.destroy(); await c.resume(); }
      const buffer = await rendering, data = buffer.getChannelData(0); let sum = 0, peak = 0, tail = 0;
      for (let i = 0; i < data.length; i++) { sum += data[i] ** 2; peak = Math.max(peak, Math.abs(data[i])); if (i > 44100) tail = Math.max(tail, Math.abs(data[i])); }
      const seam = 44100 * 24, seamJump = Math.abs(data[seam] - data[seam - 1]);
      results.push({ mode, rms: Math.sqrt(sum / data.length), peak, tail, seamJump: mode === 'neutral' ? seamJump : 0 }); audio.destroy();
    }
    return results;
  });
  for (const row of results) { expect(row.peak).toBeLessThan(.65); expect(row.rms).toBeGreaterThan(.0001); }
  const neutral = results.find(r => r.mode === 'neutral')!;
  for (const mode of ['cr', 'leo', 'miss']) expect(results.find(r => r.mode === mode)!.rms).toBeGreaterThan(neutral.rms * 1.5);
  expect(results.find(r => r.mode === 'kick')!.peak).toBeGreaterThan(neutral.peak * 1.5);
  expect(neutral.seamJump).toBeLessThan(.015); expect(results.find(r => r.mode === 'close')!.tail).toBeLessThan(1e-7);
});

test('a slow voice does not delay neutral ambience and finishing a download after close cannot play an old celebration', async ({ page }) => {
  let held: import('@playwright/test').Route | undefined, voiceRequests = 0;
  await page.route('**/audio/v1/siuuu.mp3', route => { held = route; voiceRequests++; });
  await page.locator('#sound').click();
  await page.waitForFunction(() => { const s = (window as any).crLeoRendering.audio.state(); return s.ready === 5 && s.loading && s.crowd; });
  const closed = await page.evaluate(() => { const { audio } = (window as any).crLeoRendering; audio.celebrate('cr'); audio.destroy(); return audio.state(); });
  expect(closed.sources).toBe(0);
  await held!.fulfill({ body: await readFile('public/assets/cr-vs-leo/audio/v1/siuuu.mp3'), contentType: 'audio/mpeg' });
  await page.waitForFunction(() => !(window as any).crLeoRendering.audio.state().loading);
  const result = await page.evaluate(async () => {
    const { audio, Audio, gameAudio } = (window as any).crLeoRendering, next = new Audio(); await next.unlock();
    const fresh = next.state(); next.destroy(); return { old: audio.state(), fresh, host: gameAudio.context.state };
  });
  expect(result.old.sources).toBe(0); expect(result.old.ready).toBe(0); expect(result.old.played.siuuu).toBeUndefined();
  expect(result.fresh.ready).toBe(6); expect(result.fresh.crowd).toBe(true); expect(result.fresh.voices).toBe(0);
  expect(voiceRequests).toBe(1); expect(result.host).toBe('running');
});
