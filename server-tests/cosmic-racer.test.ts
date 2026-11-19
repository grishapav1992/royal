import assert from 'node:assert/strict';
import {setImmediate as flush} from 'node:timers/promises';
import {test} from 'node:test';
import {CosmicEscapeRacer, cosmicRacerOutcome} from '../src/ui/CosmicEscapeRacer';

test('the racer reads the complete round amount before celebrating', () => {
  for (const returned of ['0', '39', '40']) assert.equal(cosmicRacerOutcome('40', returned), 'calm');
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
  const deliver = (cue: string) => requests.get('/assets/cosmic-guardians/racer-v1/' + cue + '.webp')!(new Response('clip'));
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
