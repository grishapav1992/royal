import { t as translateText, tr } from '../../i18n/index';
import {gameAudio} from '../../game/GameAudio';

interface StakeOptions {
  values: readonly string[];
  select: HTMLSelectElement;
  steps: readonly HTMLButtonElement[];
  direction: (button: HTMLButtonElement) => number;
  current: () => string;
  locked: () => boolean;
  changed: (stake: string) => void;
}

export function slotStakeStep(values: readonly string[], current: string, direction: number) {
  const at = values.indexOf(current);
  return at >= 0 && (direction === 1 || direction === -1) ? values[at + direction] : undefined;
}

/** UI changes never create a wager. Only the existing session driver submits one. */
export class SlotStakeControls {
  private disposed = false;
  constructor(private options: StakeOptions) {
    options.select.onchange = () => this.select(options.select.value);
    for (const button of options.steps) button.onclick = () => this.step(options.direction(button));
  }

  step(direction: number) {
    const {values, current} = this.options;
    return this.select(slotStakeStep(values, current(), direction));
  }

  private select(value: string | undefined) {
    const {values, locked, changed} = this.options;
    if (this.disposed || locked() || value === undefined || !values.includes(value)) {
      this.update();
      return false;
    }
    changed(value);
    return true;
  }

  update() {
    if (this.disposed) return;
    const {select, steps, values, current, direction, locked} = this.options;
    select.value = current();
    select.disabled = locked();
    const at = values.indexOf(current());
    for (const button of steps) {
      const delta = direction(button);
      button.disabled = select.disabled || at < 0 || (delta !== 1 && delta !== -1) || values[at + delta] === undefined;
    }
  }

  destroy() {
    this.disposed = true;
    this.options.select.onchange = null;
    for (const button of this.options.steps) button.onclick = null;
  }
}

interface SlotMusic {
  enter: () => Promise<unknown>;
  musicEnabled: () => boolean;
  setMusic: (enabled: boolean) => void;
}
interface AudioOptions {
  sound: HTMLButtonElement;
  music: HTMLButtonElement;
  volume: HTMLInputElement;
  audio: SlotMusic;
  entered: () => boolean;
  dynamicGlyph?: boolean;
}

export class SlotAudioControls {
  private disposed = false;
  constructor(private options: AudioOptions, private preferences = gameAudio) {
    options.sound.onclick = () => {
      if (this.disposed) return;
      preferences.setMuted(!preferences.getPreferences().muted);
      if (!preferences.getPreferences().muted && options.entered()) void options.audio.enter();
      this.update();
    };
    options.music.onclick = () => {
      if (this.disposed) return;
      options.audio.setMusic(!options.audio.musicEnabled());
      if (options.entered()) void options.audio.enter();
      this.update();
    };
    options.volume.oninput = () => {
      if (this.disposed) return;
      const value = Number(options.volume.value);
      if (Number.isFinite(value)) preferences.setVolume(Math.max(0, Math.min(100, value)) / 100);
    };
  }

  update() {
    if (this.disposed) return;
    const {sound, music, volume, audio, dynamicGlyph} = this.options;
    const prefs = this.preferences.getPreferences();
    if (dynamicGlyph) { sound.textContent = prefs.muted ? '♩' : '♪'; music.textContent = '♫'; }
    sound.setAttribute('aria-label', prefs.muted ? translateText('Включить звук') : translateText('Выключить звук'));
    sound.setAttribute('aria-pressed', String(!prefs.muted));
    music.setAttribute('aria-label', audio.musicEnabled() ? translateText('Выключить музыку') : translateText('Включить музыку'));
    music.setAttribute('aria-pressed', String(audio.musicEnabled()));
    volume.value = String(Math.round(prefs.volume * 100));
  }

  destroy() {
    this.disposed = true;
    this.options.sound.onclick = null;
    this.options.music.onclick = null;
    this.options.volume.oninput = null;
  }
}

export interface SlotTransportState {
  blocked: boolean; active: boolean; live: boolean; dialog: boolean; entered: boolean;
  fast: boolean; autoRemaining: number; bonusRunning: boolean; paidBonus: boolean;
  pending: boolean; busy: boolean; hidden: boolean; ready: boolean;
}

export function updateSlotTransport(root: HTMLElement, prefix: 'lg' | 'cc', state: SlotTransportState) {
  const button = (name: string) => root.querySelector<HTMLButtonElement>(`[data-${prefix}-${name}]`)!;
  const {blocked, active, live, dialog, entered, fast, autoRemaining, bonusRunning} = state;
  const speed = button('speed');
  speed.textContent = fast ? translateText('БЫСТРО ×2') : translateText('ОБЫЧНО ×1');
  speed.disabled = live;
  speed.setAttribute('aria-pressed', String(fast));
  const auto = button('auto');
  auto.textContent = autoRemaining ? tr`Стоп · ${autoRemaining}` : translateText('Авто');
  auto.disabled = !autoRemaining && (blocked || active || dialog || !entered || state.paidBonus);
  auto.setAttribute('aria-pressed', String(autoRemaining > 0));
  root.querySelector<HTMLSelectElement>(`[data-${prefix}-auto-count]`)!.disabled = live || active || autoRemaining > 0 || dialog;
  const pause = button('pause');
  pause.disabled = !bonusRunning;
  pause.textContent = bonusRunning ? translateText('Пауза серии') : translateText('На паузе');
  if (prefix === 'cc') pause.hidden = !active;
  for (const id of ['info', 'history', 'refresh']) button(id).disabled = live || state.busy;
  const retry = button('retry');
  retry.hidden = !state.pending;
  retry.disabled = !state.ready || live || state.busy || state.hidden;
}
