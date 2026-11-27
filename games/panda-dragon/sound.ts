import type { GameHostV1 } from '../../src/modules/GameHostContract';

type Sfx = "click" | "spin" | "stop" | "strike" | "win" | "bigwin" | "bonus" | "loss" | "partial" | "return"
  | "whoosh" | "clink" | "spark" | "charge";

export interface PandaSfxOptions {
  /** Положение в стерео: -1 слева, 1 справа. */
  pan?: number;
  /** Вариация тембра: номер барабана или шага серии. */
  variant?: number;
}

/** Пять барабанов останавливаются нисходящей ступенью: звучит как фраза, а не как щелчки. */
const REEL_STEPS = [9, 7, 4, 2, 0];
/** Простая мажорная квинта: основа всех победных мотивов. */
const WIN_STEPS = [0, 4, 7, 12];
/** Длительность подъёма общего уровня после отмены, с. */
const LEVEL_FADE = 0.02;

export function createPandaAudio(host: GameHostV1['gameAudio']) {
  let ctx: AudioContext | undefined;
  /** Сумма голосов: фильтр, компрессор и ограничитель образуют мастер-цепочку. */
  let dry: GainNode | undefined;
  let master: GainNode | undefined;
  let compressor: DynamicsCompressorNode | undefined;
  let limiter: DynamicsCompressorNode | undefined;
  /** Посыл на реверберацию и её возврат. */
  let reverbSend: GainNode | undefined;
  let reverb: ConvolverNode | undefined;
  let wet: GainNode | undefined;
  /** Шина фоновых mechanical-слоёв, которую приглушают сильные события. */
  let bed: GainNode | undefined;
  let disposed = false;
  let audible = false;
  const active = new Map<AudioScheduledSourceNode, () => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const stringCache = new Map<number, AudioBuffer>();
  let noiseBuffer: AudioBuffer | undefined;
  let whirr: { source: AudioScheduledSourceNode; nodes: AudioNode[]; gains: GainNode[] } | undefined;
  const unsubscribe = host.onPreferences(({ muted, volume }) => {
    audible = !muted && volume > 0;
    if (!audible) cancel();
  });

  /**
   * Импульсная характеристика комнаты: ранние отражения и тёмный экспоненциальный хвост.
   * Хвост темнеет со временем, поэтому реверберация звучит объёмно, а не как шум.
   */
  function makeImpulse(a: AudioContext) {
    const seconds = 2.2;
    const length = Math.floor(a.sampleRate * seconds);
    const impulse = a.createBuffer(2, length, a.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      const early = [0.011, 0.019, 0.028, 0.039, 0.052];
      early.forEach((time, index) => {
        const at = Math.floor(time * a.sampleRate * (channel ? 1.07 : 1));
        if (at < length) data[at] += (index % 2 ? -1 : 1) * (0.55 - index * 0.08);
      });
      let smooth = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const decay = Math.exp(-4.1 * t) * (1 - t);
        const white = Math.random() * 2 - 1;
        // Поглощение воздухом: сглаживание шума усиливается к концу хвоста.
        const keep = 0.62 - 0.46 * t;
        smooth += (white - smooth) * keep;
        data[i] += smooth * decay;
      }
    }
    return impulse;
  }

  /** Общий белый шум для ударов и шуршания барабанов. */
  function whiteNoise(a: AudioContext) {
    if (!noiseBuffer) {
      const length = Math.floor(a.sampleRate * 2);
      noiseBuffer = a.createBuffer(1, length, a.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1; // тембр, не исход
    }
    return noiseBuffer;
  }

  function startSource(source: AudioScheduledSourceNode, at: number, nodes: AudioNode[], onEnd?: () => void, offset?: number) {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      source.onended = null;
      active.delete(source);
      try { source.disconnect(); } catch { /* уже отключён */ }
      nodes.forEach(node => { try { node.disconnect(); } catch { /* уже отключён */ } });
      onEnd?.();
    };
    active.set(source, release);
    source.onended = release;
    // Оффсет читается только из буфера шума, у осцилляторов его нет.
    if (offset === undefined) source.start(at);
    else (source as AudioBufferSourceNode).start(at, offset);
  }

  function cancel() {
    timers.forEach(clearTimeout);
    timers.clear();
    for (const [source, release] of active) {
      try { source.stop(); } catch { /* источник не запущен */ }
      release();
    }
    stopWhirr(true);
    if (ctx && master) {
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setTargetAtTime(0, now, 0.015);
    }
  }

  function prepareBus() {
    if (host.context?.state !== 'running' || !host.output) return;
    if (!dry) {
      const context = host.context;
      ctx = context;
      dry = context.createGain();
      const highpass = context.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 48;
      highpass.Q.value = 0.7;
      compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 18;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.18;
      limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -1.5;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.05;
      master = context.createGain();
      master.gain.value = 1;
      dry.connect(highpass);
      highpass.connect(compressor);
      compressor.connect(limiter);
      limiter.connect(master);
      master.connect(host.output);
      reverbSend = context.createGain();
      reverbSend.gain.value = 1;
      reverb = context.createConvolver();
      reverb.buffer = makeImpulse(context);
      wet = context.createGain();
      wet.gain.value = 0.5;
      reverbSend.connect(reverb);
      reverb.connect(wet);
      wet.connect(limiter);
      bed = context.createGain();
      bed.gain.value = 1;
      bed.connect(dry);
    }
    return ctx;
  }

  /**
   * Возвращает общий уровень после паузы или отмены хода.
   * Уровень поднимается до единицы до начала атаки звука, иначе первый
   * звук после отмены звучал бы тише остальных.
   */
  function resumeLevel() {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(1, now + LEVEL_FADE);
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

  interface Voice {
    input: GainNode;
    add(source: AudioScheduledSourceNode, at: number, nodes: AudioNode[], offset?: number): void;
  }

  /**
   * Голос события: своя панорама, своя доля реверберации и своя огибающая.
   * Все узлы голоса отключаются, когда отзвучал последний его источник.
   */
  function voice(pan: number, send: number): Voice {
    const context = ctx!;
    const input = context.createGain();
    const panner = context.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    const sendGain = context.createGain();
    sendGain.gain.value = send;
    input.connect(panner);
    panner.connect(dry!);
    panner.connect(sendGain);
    sendGain.connect(reverbSend!);
    const state = { pending: 0, done: false, nodes: [input, panner, sendGain] as AudioNode[] };
    return {
      input,
      add(source, at, nodes, offset) {
        state.pending += 1;
        startSource(source, at, nodes, () => {
          state.pending -= 1;
          if (state.pending <= 0 && !state.done) {
            state.done = true;
            state.nodes.forEach(node => { try { node.disconnect(); } catch { /* уже отключён */ } });
          }
        }, offset);
      },
    };
  }

  /** Шумовой слой с фильтром и огибающей: треск, свист, шуршание. */
  function noiseBurst(at: number, dur: number, gain: number, from: number, to: number, type: BiquadFilterType, target: Voice, q = 1.2, shape: 'hit' | 'swell' = 'hit') {
    if (!ctx) return;
    const context = ctx;
    const source = context.createBufferSource();
    source.buffer = whiteNoise(context);
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), at + dur);
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, at);
    if (shape === 'swell') {
      // Нарастание: громкость поднимается к концу слоя и спадает вместе с ним.
      env.gain.linearRampToValueAtTime(gain, at + dur * 0.72);
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    } else {
      env.gain.linearRampToValueAtTime(gain, at + Math.min(0.025, dur * 0.3));
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    }
    source.connect(filter);
    filter.connect(env);
    env.connect(target.input);
    target.add(source, at, [filter, env], Math.random() * 1.5);
    // Шум зациклен, поэтому его нужно остановить вручную: иначе источник живёт до конца сессии.
    source.stop(at + dur + 0.05);
  }

  /** Тональный слой с падением или подъёмом высоты: тело удара, гул, обороты мотора. */
  function tone(at: number, freq: number, endFreq: number, dur: number, gain: number, type: OscillatorType, target: Voice, cutoff?: number) {
    if (!ctx) return;
    const context = ctx;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), at + dur * 0.85);
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(env);
    if (cutoff) {
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      env.connect(filter);
      filter.connect(target.input);
      target.add(osc, at, [env, filter]);
    } else {
      env.connect(target.input);
      target.add(osc, at, [env]);
    }
    osc.stop(at + dur + 0.02);
  }

  /** Щипок струны: короткая атака шума и тело гучжэна. */
  function pluck(freq: number, at: number, gain: number, target: Voice, bright = 2600) {
    if (!ctx) return;
    const buffer = stringBuffer(freq);
    if (!buffer) return;
    const context = ctx;
    const src = context.createBufferSource();
    src.buffer = buffer;
    const tone = context.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = bright;
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);
    src.connect(tone);
    tone.connect(env);
    env.connect(target.input);
    target.add(src, at, [tone, env]);
    // Щипок: короткий шумовой транзиент, чтобы струна читалась как удар по медиатору.
    noiseBurst(at, 0.03, gain * 0.35, 3200, 1400, 'bandpass', target, 1.4);
  }

  /** Металл: негармоничные обертоны гаона или гонга. */
  function metal(base: number, at: number, gain: number, decay: number, target: Voice, ratios = [1, 2.76, 5.4, 8.93]) {
    if (!ctx) return;
    const context = ctx;
    ratios.forEach((ratio, index) => {
      const osc = context.createOscillator();
      osc.frequency.value = base * ratio;
      const env = context.createGain();
      const part = gain / (1 + index * 0.9);
      env.gain.setValueAtTime(0.0001, at);
      env.gain.linearRampToValueAtTime(part, at + 0.006);
      env.gain.exponentialRampToValueAtTime(0.0001, at + decay / (1 + index * 0.8));
      osc.connect(env);
      env.connect(target.input);
      target.add(osc, at, [env]);
      osc.stop(at + decay + 0.02);
    });
  }

  /** Приглушение фонового слоя под сильным событием. */
  function duckBed(target: number, seconds: number) {
    if (!ctx || !bed) return;
    const now = ctx.currentTime;
    bed.gain.cancelScheduledValues(now);
    bed.gain.setTargetAtTime(target, now, 0.06);
    bed.gain.setTargetAtTime(1, now + seconds, 0.18);
  }

  /** Фоновой гул барабанов на время вращения. */
  function startWhirr() {
    if (!ctx || whirr) return;
    const context = ctx;
    const source = context.createBufferSource();
    source.buffer = whiteNoise(context);
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 620;
    filter.Q.value = 0.9;
    const air = context.createGain();
    air.gain.value = 0.05;
    const lfo = context.createOscillator();
    lfo.frequency.value = 5.4;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 130;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    const motor = context.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.value = 58;
    const motorFilter = context.createBiquadFilter();
    motorFilter.type = 'lowpass';
    motorFilter.frequency.value = 190;
    const motorGain = context.createGain();
    motorGain.gain.value = 0.012;
    source.connect(filter);
    filter.connect(air);
    air.connect(bed!);
    motor.connect(motorFilter);
    motorFilter.connect(motorGain);
    motorGain.connect(bed!);
    const now = context.currentTime;
    air.gain.setTargetAtTime(0.05, now, 0.09);
    motorGain.gain.setTargetAtTime(0.012, now, 0.12);
    source.start(now);
    lfo.start(now);
    motor.start(now);
    whirr = { source, nodes: [filter, air, lfo, lfoGain, motor, motorFilter, motorGain], gains: [air, motorGain] };
  }

  function stopWhirr(immediate = false) {
    if (!ctx || !whirr) return;
    const current = whirr;
    whirr = undefined;
    const now = ctx.currentTime;
    current.gains.forEach(gain => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0, now, immediate ? 0.01 : 0.08);
    });
    // Приглушение фона снимается: следующий раунд не должен начинаться тише.
    if (bed) {
      bed.gain.cancelScheduledValues(now);
      bed.gain.setValueAtTime(1, now);
    }
    const stopAt = now + (immediate ? 0.03 : 0.25);
    [current.source, ...current.nodes.filter(node => node instanceof OscillatorNode)].forEach(node => {
      try { node.stop(stopAt); } catch { /* уже остановлен */ }
    });
    const timer = setTimeout(() => {
      timers.delete(timer);
      current.nodes.forEach(node => { try { node.disconnect(); } catch { /* уже отключён */ } });
    }, immediate ? 60 : 320);
    timers.add(timer);
  }

  function play(name: Sfx, options: PandaSfxOptions = {}) {
    if (disposed || !audible || document.hidden) return;
    const a = prepareBus();
    if (!a) return;
    // Звук начинается после подъёма общего уровня, иначе атака была бы тише остальных.
    const t = a.currentTime + LEVEL_FADE + 0.005;
    resumeLevel();
    const pan = options.pan ?? 0;
    const variant = options.variant ?? 0;
    switch (name) {
      case "click": {
        const v = voice(pan, 0.06);
        noiseBurst(t, 0.05, 0.12, 2100, 1200, 'bandpass', v, 1.8);
        pluck(hz(12), t, 0.06, v, 3200);
        break;
      }
      case "spin": {
        // Запуск барабанов: рычаг, шелест ленты и узнаваемая тема гучжэна.
        const v = voice(pan, 0.12);
        tone(t, 140, 72, 0.24, 0.3, 'sine', v);
        noiseBurst(t, 0.45, 0.11, 320, 1600, 'bandpass', v, 0.9);
        noiseBurst(t, 0.05, 0.08, 2800, 1500, 'highpass', v, 0.8);
        pluck(hz(0), t, 0.12, v);
        break;
      }
      case "stop": {
        // Остановка барабана: дерево, металл и тело удара. Высота зависит от номера барабана.
        const step = REEL_STEPS[Math.min(variant, REEL_STEPS.length - 1)] ?? 0;
        const v = voice(pan, 0.3);
        tone(t, 190, 88, 0.14, 0.2, 'sine', v);
        noiseBurst(t, 0.1, 0.18, 900, 480, 'bandpass', v, 1.4);
        noiseBurst(t, 0.04, 0.07, 3200, 1800, 'highpass', v, 0.8);
        metal(hz(step + 12), t + 0.01, 0.045, 0.5, v);
        break;
      }
      case "charge": {
        // Заминка перед последним барабаном: напряжение растёт, фон отступает.
        const v = voice(pan, 0.2);
        noiseBurst(t, 0.55, 0.13, 260, 2400, 'bandpass', v, 1.6, 'swell');
        tone(t, 68, 112, 0.5, 0.07, 'sawtooth', v, 520);
        duckBed(0.35, 0.9);
        break;
      }
      case "whoosh": {
        // Замах посоха: воздух идёт со стороны мастера.
        const v = voice(pan, 0.18);
        noiseBurst(t, 0.16, 0.13, 500, 2300, 'bandpass', v, 2.2);
        noiseBurst(t + 0.14, 0.18, 0.1, 2300, 420, 'bandpass', v, 2.2);
        break;
      }
      case "strike": {
        // Удар посоха: тело, треск клинка и долгий металлический ответ.
        const v = voice(pan, 0.4);
        tone(t, 135, 52, 0.3, 0.42, 'sine', v);
        noiseBurst(t, 0.16, 0.22, 760, 420, 'bandpass', v, 1.2);
        noiseBurst(t, 0.07, 0.17, 3000, 8200, 'highpass', v, 0.7);
        metal(620, t + 0.01, 0.085, 1.5, v);
        duckBed(0.2, 0.6);
        break;
      }
      case "spark": {
        // Искры от клинка: короткие металлические искры и шипение.
        const v = voice(pan, 0.45);
        [2400, 3100, 4200].forEach((freq, index) => metal(freq, t + index * 0.05, 0.03, 0.22, v, [1, 2.4]));
        noiseBurst(t, 0.14, 0.05, 5200, 9000, 'highpass', v, 0.6);
        break;
      }
      case "clink": {
        // Мелкий металлический отклик: шаг пояса или отметка счётчика.
        const v = voice(pan, 0.3);
        noiseBurst(t, 0.05, 0.09, 3900, 2400, 'bandpass', v, 3);
        metal(2200, t, 0.05, 0.35, v, [1, 2.76]);
        break;
      }
      case "win": {
        // Обычная выплата: короткая фраза на струнах с мягким колоколом.
        const v = voice(pan, 0.5);
        WIN_STEPS.forEach((step, index) => pluck(hz(step + 7), t + index * 0.12, 0.3, v, 3000));
        metal(880, t + 0.36, 0.05, 2, v, [1, 2.76, 5.4]);
        duckBed(0.15, 1.4);
        break;
      }
      case "bigwin": {
        // Крупный итог: гонг, длинная восходящая фраза и светлый хвост.
        const v = voice(pan, 0.6);
        tone(t, 96, 58, 0.9, 0.34, 'sine', v);
        metal(196, t, 0.11, 3.2, v, [1, 1.48, 2.14, 2.9]);
        [0, 4, 7, 12, 16, 19].forEach((step, index) => pluck(hz(step + 7), t + 0.18 + index * 0.09, 0.26, v, 3200));
        metal(3520, t + 0.8, 0.035, 2.4, v, [1, 2.76]);
        duckBed(0, 2.6);
        break;
      }
      case "bonus": {
        // Бонус: гонг и восходящая фраза, отличимая от крупного итога ритмом.
        const v = voice(pan, 0.55);
        tone(t, 112, 74, 0.7, 0.26, 'sine', v);
        metal(147, t, 0.08, 2.4, v, [1, 1.48, 2.14]);
        [0, 4, 7, 12].forEach((step, index) => pluck(hz(step + 5), t + 0.16 + index * 0.14, 0.28, v, 3000));
        duckBed(0, 2);
        break;
      }
      case "loss": {
        // Проигрыш: глухой удар без подъёма тона и без колокола.
        const v = voice(pan, 0.05);
        tone(t, 124, 68, 0.28, 0.2, 'sine', v, 420);
        noiseBurst(t, 0.14, 0.05, 380, 220, 'lowpass', v, 0.8);
        break;
      }
      case "partial": {
        // Частичный возврат: ровный приглушённый отклик, не похожий на выигрыш.
        const v = voice(pan, 0.08);
        noiseBurst(t, 0.13, 0.13, 540, 300, 'bandpass', v, 1.2);
        pluck(hz(-2), t, 0.08, v, 900);
        break;
      }
      case "return": {
        // Возврат ставки: тот же нейтральный отклик, ещё короче и тише.
        const v = voice(pan, 0.08);
        noiseBurst(t, 0.11, 0.1, 400, 240, 'bandpass', v, 1.1);
        pluck(hz(-5), t, 0.07, v, 800);
        break;
      }
    }
  }

  function schedule(name: Sfx, delay: number, options: PandaSfxOptions = {}) {
    if (!audible || disposed || document.hidden) return () => {};
    const timer = setTimeout(() => {
      timers.delete(timer);
      play(name, options);
    }, delay);
    timers.add(timer);
    return () => { clearTimeout(timer); timers.delete(timer); };
  }

  return {
    play,
    schedule,
    cancel,
    /** Фоновый гул барабанов: включается на время вращения и гаснет вместе с остановкой. */
    spinning: (active: boolean) => {
      if (disposed || !audible || document.hidden) return;
      if (active) {
        prepareBus();
        resumeLevel();
        startWhirr();
      } else {
        stopWhirr();
      }
    },
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
      noiseBuffer = undefined;
      dry?.disconnect();
      master?.disconnect();
      compressor?.disconnect();
      limiter?.disconnect();
      reverbSend?.disconnect();
      reverb?.disconnect();
      wet?.disconnect();
      bed?.disconnect();
      dry = master = compressor = limiter = reverbSend = reverb = wet = bed = undefined;
    },
  };
}

export type PandaAudio = ReturnType<typeof createPandaAudio>;
