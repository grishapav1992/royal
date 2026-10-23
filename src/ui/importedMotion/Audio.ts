import { gameAudio } from '../../game/GameAudio';
import type { MotionProfile } from './Profiles';
import type { WinTier } from './Outcome';

/** Short voices connected to the host's existing master volume and limiter. */
export class ImportedMotionAudio {
  private voices = new Set<{ oscillator: OscillatorNode; gain: GainNode }>();
  constructor(private profile: MotionProfile) {}
  private tone(frequency: number, delay: number, duration: number, level = .035) {
    const context = gameAudio.context, output = gameAudio.output, preferences = gameAudio.getPreferences();
    if (!context || !output || context.state !== 'running' || document.hidden || preferences.muted || preferences.volume === 0) return;
    try {
      const oscillator = context.createOscillator(), gain = context.createGain(), start = context.currentTime + delay;
      oscillator.type = this.profile.wave; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(level, start + .012);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(gain); gain.connect(output);
      const voice = { oscillator, gain }; this.voices.add(voice);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.voices.delete(voice); };
      oscillator.start(start); oscillator.stop(start + duration + .02);
    } catch { /* Visual playback remains available when the audio device is unavailable. */ }
  }
  contact(index = 0) {
    if (!this.profile.nativeAudio) this.tone(this.profile.notes[index % 4] / 2, 0, .085, .014);
  }
  reveal(index = 0) {
    if (!this.profile.nativeAudio) this.tone(this.profile.notes[index % 4], 0, .16, .023);
  }
  celebrate(tier: WinTier) {
    if (tier !== 'win' && tier !== 'big' && tier !== 'epic') return;
    const count = tier === 'epic' ? 8 : tier === 'big' ? 6 : 3;
    for (let i = 0; i < count; i++) this.tone(this.profile.notes[i % 4] * (i >= 4 ? 2 : 1), i * .065, .32, tier === 'win' ? .023 : .03);
    if (tier !== 'win') this.profile.notes.slice(0, 3).forEach(frequency => this.tone(frequency / 2, .4, .55, .012));
  }
  stop() {
    for (const { oscillator, gain } of this.voices) {
      try { oscillator.stop(); } catch { /* The voice may have ended naturally. */ }
      oscillator.disconnect(); gain.disconnect();
    }
    this.voices.clear();
  }
}
