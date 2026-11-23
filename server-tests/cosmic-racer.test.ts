import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {test} from 'node:test';
import {CosmicEscapeRacer, cosmicRacerOutcome} from '../games/cosmic-escape/CosmicEscapeRacer';

test('the racer reads the complete round amount before celebrating', () => {
  for (const returned of ['0', '39']) assert.equal(cosmicRacerOutcome('40', returned), 'calm');
  assert.equal(cosmicRacerOutcome('40', '40'), 'even');
  assert.equal(cosmicRacerOutcome('0', '0'), 'calm');
  for (const returned of ['41', '799']) assert.equal(cosmicRacerOutcome('40', returned), 'win');
  assert.equal(cosmicRacerOutcome('40', '800'), 'big-win');
});

test('interrupting a reaction discards delayed animation and releases active resources', async t => {
  const releases: string[] = [];
  const requests = new Map<string, (response: Response) => void>();
  t.mock.method(globalThis, 'fetch', (input: string) => new Promise<Response>(resolve => requests.set(input, resolve)));
  t.mock.method(URL, 'createObjectURL', () => 'blob:racer-test');
  t.mock.method(URL, 'revokeObjectURL', (url: string) => releases.push(url));

  const image = {dataset: {} as DOMStringMap, src: ''} as HTMLImageElement;
  const racer = new CosmicEscapeRacer(image);
  const deliver = (cue: string) => requests.get('/assets/cosmic-guardians/racer-v2/' + cue + '.webp')!(new Response('clip'));
  racer.showArtwork();
  racer.context(true, true);
  deliver('idle');
  await flush();
  assert.equal(image.src, 'blob:racer-test');
  racer.show('win');
  assert.equal(image.dataset.racerCue, 'win');
  racer.context(false, false);
  deliver('win');
  await flush();
  assert.equal(image.dataset.racerCue, 'idle');
  assert.match(image.src, /idle-still\.webp$/);
  assert.equal(image.dataset.racerAnimated, 'false');
  assert.deepEqual(releases, ['blob:racer-test']);
  racer.destroy();
});

test('a feature pose survives a controls redraw and returns to rolling focus', t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const image = {dataset: {} as DOMStringMap, src: ''} as HTMLImageElement;
  const racer = new CosmicEscapeRacer(image);
  racer.showArtwork();
  racer.context(true, false, true);
  assert.equal(image.dataset.racerCue, 'focus');
  racer.show('energy');
  racer.context(true, false, true);
  assert.equal(image.dataset.racerCue, 'energy');
  t.mock.timers.tick(900);
  assert.equal(image.dataset.racerCue, 'focus');
  racer.show('wild');
  racer.context(true, false, false);
  racer.show('even');
  t.mock.timers.tick(850);
  assert.equal(image.dataset.racerCue, 'even');
  t.mock.timers.tick(250);
  assert.equal(image.dataset.racerCue, 'idle');
  racer.destroy();
});
