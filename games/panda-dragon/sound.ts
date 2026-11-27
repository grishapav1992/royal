import type { GameHostV1 } from '../../src/modules/GameHostContract';

type Sfx = "click" | "spin" | "stop" | "strike" | "win" | "bigwin" | "bonus" | "loss" | "partial" | "return"
  | "whoosh" | "clink" | "spark" | "charge";

function makeReverb(a: AudioContext) {
  const seconds = 2.8;
  const length = Math.floor(a.sampleRate * seconds);
  const impulse = a.createBuffer(2, length, a.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3; // тембр, не исход
  }
  const node = a.createConvolver();
  node.buffer = impulse;
  return node;
}

export function createPandaAudio(host: GameHostV1['gameAudio']) {
  let ctx: AudioContext | undefined;
  let sfxBus: GainNode | undefined;
  let reverb: ConvolverNode | undefined;
  let wet: GainNode | undefined;
  let disposed = false;
  let audible = false;
  const active = new Map<AudioScheduledSourceNode, () => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const stringCache = new Map<number, AudioBuffer>();
  const unsubscribe = host.onPreferences(({ muted, volume }) => {
    audible = !muted && volume > 0;
    if (!audible) cancel();
  });

  function startSource(source: AudioScheduledSourceNode, at: number, ...nodes: AudioNode[]) {
    const release = () => {
      source.onended = null;
      active.delete(source);
      source.disconnect();
      nodes.forEach(node => node.disconnect());
    };
    active.set(source, release);
    source.onended = release;
    source.start(at);
  }

  function cancel() {
    timers.forEach(clearTimeout);
    timers.clear();
    for (const [source, release] of active) {
      source.stop();
      release();
    }
    sfxBus?.disconnect();
    reverb?.disconnect();
    wet?.disconnect();
    sfxBus = reverb = wet = undefined;
  }

  function prepareBus() {
    if (host.context?.state !== 'running' || !host.output) return;
    if (!sfxBus) {
      const context = host.context;
      ctx = context;
      sfxBus = context.createGain();
      sfxBus.gain.value = 0.55;
      sfxBus.connect(host.output);
      reverb = makeReverb(context);
      wet = context.createGain();
      wet.gain.value = 0.20;
      sfxBus.connect(reverb).connect(wet).connect(host.output);
    }
    return ctx;
  }

  const hz = (semi: number, base = 293.66) => base * 2 ** (semi / 12);

  /** Струна гучжэна по алгоритму Карплуса – Стронга: естественное затухание и тёплый тембр. */
  function stringBuffer(freq: number) {
    const key = Math.round(freq * 10);
    const cached = stringCache.get(key);
    if (cached || !ctx) return cached ?? null;
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * 2.4);
    const buffer = ctx.createBuffer(1, length, rate);
    const data = buffer.getChannelData(0);
    const period = Math.max(2, Math.round(rate / freq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1; // возбуждение струны, не исход
    let index = 0;
    for (let i = 0; i < length; i++) {
      const next = (index + 1) % period;
      const value = 0.4985 * ((ring[index] ?? 0) + (ring[next] ?? 0));
      data[i] = ring[index] ?? 0;
      ring[index] = value;
      index = next;
    }
    stringCache.set(key, buffer);
    return buffer;
  }

  function pluck(freq: number, at: number, vol = 0.3, out: AudioNode | undefined = sfxBus, bright = 2600) {
    if (!ctx || !out) return;
    const buffer = stringBuffer(freq);
    if (!buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = bright;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(tone).connect(gain).connect(out);
    startSource(src, at, tone, gain);
  }

  function noise(
    at: number,
    dur: number,
    vol: number,
    from: number,
    to: number,
    type: BiquadFilterType = "bandpass",
  ) {
    if (!ctx || !sfxBus) return;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1; // шум для тембра, не для исхода
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(vol, at + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(gain).connect(sfxBus);
    startSource(src, at, filter, gain);
  }

  function drum(at: number, freq = 110, vol = 0.5, out: AudioNode | undefined = sfxBus, decay = 0.35) {
    if (!ctx || !out) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq / 2, at + decay);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(vol, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(gain).connect(out);
    startSource(osc, at, gain);
    osc.stop(at + decay);
  }

  /** Металлический звон: неровные обертоны колокола/гонга. */
  function bell(base: number, at: number, vol = 0.2, decay = 3) {
    if (!ctx || !sfxBus) return;
    const a = ctx;
    const out = sfxBus;
    [1, 2.76, 5.4, 8.9].forEach((ratio, i) => {
      const osc = a.createOscillator();
      const gain = a.createGain();
      osc.frequency.value = base * ratio;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(vol / (i + 1), at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + decay / (i * 0.6 + 1));
      osc.connect(gain).connect(out);
      startSource(osc, at, gain);
      osc.stop(at + decay);
    });
  }

  function gong(at: number) {
    drum(at, 70, 0.5, sfxBus, 1.2);
    bell(98, at, 0.18, 4);
  }

  function play(name: Sfx) {
    if (disposed || !audible || document.hidden) return;
    const a = prepareBus();
    if (!a) return;
    const t = a.currentTime + 0.01;
    switch (name) {
      case "click":
        pluck(hz(19), t, 0.18, sfxBus, 4000);
        break;
      case "spin":
        noise(t, 0.45, 0.18, 300, 1800);
        pluck(hz(0), t, 0.2);
        pluck(hz(7), t + 0.06, 0.15);
        // Быстрая дробь: раунд начинается с напором, а не с тихого щелчка.
        [0, 0.09, 0.18].forEach((offset, index) => drum(t + offset, 140 + index * 26, 0.16 + index * 0.05, sfxBus, 0.14));
        break;
      case "stop":
        drum(t, 180, 0.22, sfxBus, 0.12);
        pluck(hz(-12 + ([0, 2, 4, 7, 9][Math.floor((t * 7) % 5)] ?? 0)), t, 0.12);
        // Металлический отскок барабана о край ленты.
        bell(1320, t + 0.01, 0.045, 0.5);
        noise(t, 0.07, 0.09, 2600, 5200, "highpass");
        break;
      case "strike":
        noise(t, 0.22, 0.35, 1200, 7000, "highpass"); // свист замаха
        drum(t + 0.16, 140, 0.55, sfxBus, 0.25); // удар
        bell(880, t + 0.18, 0.06, 1.2); // звон разреза
        // Искры от клинка: короткий металлический выброс поверх удара.
        noise(t + 0.17, 0.11, 0.14, 3200, 9000, "highpass");
        bell(1760, t + 0.18, 0.035, 0.45);
        break;
      case "whoosh":
        // Свист замаха перед ударом посоха.
        noise(t, 0.34, 0.22, 500, 4200);
        break;
      case "charge":
        // Нарастающее напряжение перед последним барабаном.
        noise(t, 0.5, 0.12, 180, 2400);
        drum(t, 62, 0.26, sfxBus, 0.5);
        break;
      case "clink":
        bell(1560, t, 0.05, 0.6);
        noise(t, 0.06, 0.08, 3000, 6400, "highpass");
        break;
      case "spark":
        noise(t, 0.13, 0.16, 3400, 9500, "highpass");
        bell(2100, t + 0.01, 0.045, 0.4);
        break;
      case "win":
        [0, 4, 7, 12].forEach((s, i) => pluck(hz(s + 12), t + i * 0.1, 0.3));
        break;
      case "bigwin":
        gong(t);
        [0, 2, 4, 7, 9, 12, 14, 16, 19].forEach((s, i) =>
          pluck(hz(s + 12), t + 0.2 + i * 0.09, 0.28),
        );
        break;
      case "bonus":
        gong(t);
        [0, 7, 12].forEach((s, i) => pluck(hz(s), t + 0.3 + i * 0.18, 0.3));
        break;
      case "partial":
      case "return":
        pluck(hz(0), t, 0.10, sfxBus, 1500);
        break;
      case "loss":
        pluck(hz(-5), t, 0.12, sfxBus, 1500);
        break;
    }
  }

  function schedule(name: Sfx, delay: number) {
    if (!audible || disposed || document.hidden) return () => {};
    const timer = setTimeout(() => {
      timers.delete(timer);
      play(name);
    }, delay);
    timers.add(timer);
    return () => { clearTimeout(timer); timers.delete(timer); };
  }

  return {
    play,
    schedule,
    cancel,
    unlock: () => { if (audible && !disposed) void host.unlock(); },
    muted: () => host.getPreferences().muted,
    subscribeMute: (change: () => void) => host.onPreferences(change),
    setMuted: (muted: boolean) => {
      host.setMuted(muted);
      if (!muted && !disposed) void host.unlock();
    },
    destroy() {
      disposed = true;
      unsubscribe();
      cancel();
      stringCache.clear();
    },
  };
}

export type PandaAudio = ReturnType<typeof createPandaAudio>;
