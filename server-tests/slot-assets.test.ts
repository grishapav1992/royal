import test from 'node:test';
import assert from 'node:assert/strict';
import { SlotAssets } from '../src/ui/slotKit/SlotAssets';

class FakeImage extends EventTarget {
  static created: FakeImage[] = [];
  naturalWidth = 1000; naturalHeight = 1000; complete = false; decoding = ''; fetchPriority = '';
  src = ''; removed = false; decodes = 0;
  constructor() { super(); FakeImage.created.push(this); }
  decode() { this.decodes++; return Promise.resolve(); }
  removeAttribute(name: string) { if (name === 'src') { this.removed = true; this.src = ''; } }
  loaded() { this.complete = true; this.dispatchEvent(new Event('load')); }
  failed() { this.dispatchEvent(new Event('error')); }
}
const factory = () => new FakeImage() as unknown as HTMLImageElement;
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('critical images become ready without downloading unopened gallery images', async () => {
  FakeImage.created = [];
  const states: string[] = [], assets = new SlotAssets({ board: '/board', current: '/current', album: '/album' }, state => states.push(state.status), factory);
  const load = assets.load(['board', 'current']);
  assert.deepEqual(FakeImage.created.map(image => image.src), ['/board', '/current']);
  FakeImage.created.forEach(image => image.loaded());
  assert.equal(await load, true);
  assert.deepEqual(assets.state, { status: 'ready', loaded: 2, total: 2 });
  assert.equal(assets.has('album'), false);
  const before = states.length, first = assets.ensure(['album']), second = assets.ensure(['album']);
  assert.equal(FakeImage.created.length, 3);
  assert.equal(assets.ready, true);
  FakeImage.created[2].loaded();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(states.length, before);
  assets.trim(); assert.equal(assets.has('album'), false);
  assets.destroy();
});

test('failed optional artwork retries without disabling the current game', async () => {
  FakeImage.created = [];
  const assets = new SlotAssets({ board: '/board', album: '/album' }, () => {}, factory);
  const load = assets.load(['board']); FakeImage.created[0].loaded(); await load;
  const failed = assets.ensure(['album']); FakeImage.created[1].failed();
  assert.equal(await failed, false); assert.equal(assets.ready, true);
  const retried = assets.ensure(['album']); FakeImage.created[2].loaded();
  assert.equal(await retried, true); assert.equal(assets.has('album'), true);
  assets.destroy();
});

test('retry preserves decoded successes and a closed game never reports stale readiness', async () => {
  FakeImage.created = [];
  const states: string[] = [], assets = new SlotAssets({ a: '/a', b: '/b' }, state => states.push(state.status), factory);
  const first = assets.load(); FakeImage.created[0].loaded(); await tick(); FakeImage.created[1].failed();
  assert.equal(await first, false); assert.equal(assets.state.loaded, 1);
  const retry = assets.load(); assert.equal(FakeImage.created.length, 3);
  const pending = FakeImage.created[2]; assets.destroy(); pending.loaded();
  assert.equal(await retry, false); assert.equal(pending.removed, true);
  assert.equal(assets.ready, false); assert.equal(states.at(-1), 'loading');
});

test('immutable decoded images survive reopen, respect versions and evict beyond 64 MiB', async () => {
  const previous = (globalThis as any).Image, key = Symbol.for('royal.slot.decoded-images.v1');
  delete (globalThis as any)[key]; FakeImage.created = []; (globalThis as any).Image = FakeImage;
  const url = (name: string) => `/game-modules/test/versions/1.0.0-0123456789ab/media/${name}.webp`;
  const loaded = async (name: string) => {
    const assets = new SlotAssets({ art: url(name) }, () => {}), before = FakeImage.created.length;
    const task = assets.load();
    if (FakeImage.created.length > before) { const image = FakeImage.created.at(-1)!; image.naturalWidth = 2048; image.naturalHeight = 4096; image.loaded(); }
    assert.equal(await task, true); assets.destroy();
  };
  try {
    await loaded('a'); await loaded('a'); assert.equal(FakeImage.created.length, 1);
    await loaded('b'); await loaded('c');
    assert.equal((globalThis as any)[key].bytes, 64 * 1024 * 1024);
    await loaded('a'); assert.equal(FakeImage.created.length, 4);
    const other = new SlotAssets({ art: url('a').replace('0123456789ab', 'abcdef012345') }, () => {});
    const pending = other.load(); assert.equal(FakeImage.created.length, 5); other.destroy(); assert.equal(await pending, false);
  } finally { (globalThis as any).Image = previous; delete (globalThis as any)[key]; }
});
