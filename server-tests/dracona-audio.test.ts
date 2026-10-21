import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { DraconaAudio } from '../games/dracona/audio';

class Parameter {
  value = 0;
  targets: number[] = [];
  setValueAtTime(value: number) { this.value = value; }
  linearRampToValueAtTime(value: number) { this.targets.push(value); }
  cancelScheduledValues() {}
  setTargetAtTime(value: number) { this.targets.push(value); }
}
class Source {
  buffer: any;
  onended?: () => void;
  started = false;
  stops: number[] = [];
  disconnected = false;
  connect() {}
  disconnect() { this.disconnected = true; }
  start() { this.started = true; }
  stop(at: number) { this.stops.push(at); }
  end() { this.onended?.(); }
}
class Context extends EventTarget {
  state = 'running'; currentTime = 1;
  sources: Source[] = [];
  gains: { gain: Parameter; connect: (target: unknown) => void; disconnect: () => void }[] = [];
  decode: (bytes: ArrayBuffer) => Promise<any> = async bytes => ({ duration: .8, tag: new Uint8Array(bytes)[0] });
  decodeAudioData(bytes: ArrayBuffer) { return this.decode(bytes); }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source; }
  createGain() { const gain = { gain: new Parameter(), connect() {}, disconnect() {} }; this.gains.push(gain); return gain; }
}
class Visibility extends EventTarget { hidden = false; }
function setup() {
  const context = new Context(), document = new Visibility();
  const preferences = { muted: false, volume: .35, casinoEnabled: true };
  const listeners = new Set<(value: typeof preferences) => void>();
  const fetched: string[] = [];
  const host = { context, output: {}, getPreferences: () => ({ ...preferences }), unlock: async () => {},
    onPreferences(listener: (value: typeof preferences) => void) { listeners.add(listener); listener(preferences); return () => listeners.delete(listener); } };
  const fetcher = async function(this: unknown, url: string) { assert.equal(this, globalThis); fetched.push(url); return new Response(new Uint8Array([url.includes('-quick') ? 2 : 1])); };
  const audio = new DraconaAudio(host as any, document as any, fetcher as any);
  const mute = (muted: boolean) => { preferences.muted = muted; for (const listener of listeners) listener(preferences); };
  return { context, document, audio, preferences, listeners, fetched, mute };
}

test('magic uses the shared context and output without changing the common volume', async () => {
  const f = setup();
  await f.audio.play('cast');
  assert.equal(f.context.sources.length, 1); assert.ok(f.context.sources[0].started);
  assert.equal(f.audio.getState().played.cast, 1); assert.equal(f.preferences.volume, .35);
  assert.equal(f.audio.getState().context, 'running'); f.audio.destroy();
});

test('mute cancels current voices and prevents a decoded sound from arriving late', async () => {
  const f = setup();
  await f.audio.play('cast');
  let resolve!: (value: any) => void;
  f.context.decode = () => new Promise(done => { resolve = done; });
  const pending = f.audio.play('portal'); await setImmediate();
  f.mute(true); resolve({ duration: 2 }); await pending;
  assert.equal(f.context.sources.length, 1);
  assert.ok(f.context.sources[0].stops.includes(1.04)); assert.equal(f.audio.getState().active, 0);
  f.mute(false); await setImmediate(); assert.equal(f.context.sources.length, 1); f.audio.destroy();
});

test('hidden and suspended pages cancel audio and do not replay old events on return', async () => {
  const f = setup(); await f.audio.play('portal');
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'));
  await f.audio.play('bonus'); assert.equal(f.context.sources.length, 1); assert.equal(f.audio.getState().active, 0);
  f.document.hidden = false; f.context.state = 'suspended'; f.context.dispatchEvent(new Event('statechange'));
  await f.audio.play('finish'); assert.equal(f.context.sources.length, 1);
  f.context.state = 'running'; f.context.dispatchEvent(new Event('statechange')); await setImmediate();
  assert.equal(f.context.sources.length, 1); f.audio.destroy();
});

test('fast and turbo use short recordings at unchanged pitch and a lower level', async () => {
  const f = setup(); f.audio.begin('turbo'); await f.audio.play('cast');
  assert.equal(f.context.sources[0].buffer.tag, 2);
  assert.ok(f.context.gains[0].gain.targets.some(value => value > 0 && value < .58));
  assert.equal(f.audio.getState().quick, true);
  f.audio.begin('normal'); await f.audio.play('cast'); assert.equal(f.context.sources[1].buffer.tag, 1); f.audio.destroy();
});

test('a new spin and the bonus flourish retire earlier voices and bound overlapping effects', async () => {
  const f = setup();
  for (const cue of ['cast', 'settle', 'cascade', 'portal', 'fizzle'] as const) await f.audio.play(cue);
  assert.ok(f.audio.getState().active <= 3);
  f.audio.begin('normal'); assert.equal(f.audio.getState().active, 0);
  await f.audio.play('bonus'); assert.equal(f.audio.getState().active, 1);
  await f.audio.play('bonus'); assert.equal(f.audio.getState().active, 1);
  f.audio.destroy();
});

test('closing the game stops owned sources and releases subscriptions without closing shared audio', async () => {
  const f = setup(); await f.audio.play('cascade'); f.audio.destroy();
  assert.equal(f.listeners.size, 0); assert.equal(f.audio.getState().active, 0);
  assert.equal(f.context.state, 'running'); assert.ok(f.context.sources.every(source => source.stops.includes(1.04)));
  f.context.sources.forEach(source => source.end()); assert.ok(f.context.sources.every(source => source.disconnected));
  await f.audio.play('bonus'); assert.equal(f.context.sources.length, 1);
});

test('a canceled unconfirmed load never creates a sound after the next spin starts', async () => {
  const f = setup();
  let resolve!: (value: any) => void;
  f.context.decode = () => new Promise(done => { resolve = done; });
  const first = f.audio.play('cast'); await setImmediate(); f.audio.begin('turbo');
  resolve({ duration: 1.35 }); await first;
  assert.equal(f.context.sources.length, 0); f.audio.destroy();
});
