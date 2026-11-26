import {SlotAudio, type SlotSoundtrack} from '../../src/ui/slotKit/SlotAudio';
import {velvetSlot} from '../../src/ui/slotKit/nativeSlots';

const MUSIC_LEVEL = 0.30;

class VelvetSoundtrack implements SlotSoundtrack {
  private audio?: HTMLAudioElement;
  private source?: MediaElementAudioSourceNode;
  private gain?: GainNode;

  play(context: AudioContext, output: GainNode, onPlaying: () => void) {
    if (!this.audio) {
      const audio = new Audio();
      audio.loop = true;
      audio.preload = 'none';
      audio.src = '/assets/velvet-rebuild/audio/backbay-lounge.mp3';
      audio.onplaying = onPlaying;
      this.source = context.createMediaElementSource(audio);
      this.gain = context.createGain();
      this.gain.gain.value = MUSIC_LEVEL;
      this.source.connect(this.gain);
      this.gain.connect(output);
      this.audio = audio;
    }
    if (this.audio.error) this.audio.load();
    if (this.audio.paused) {
      // A later gesture can retry after an autoplay restriction or media failure.
      void this.audio.play().catch(() => {});
    }
  }

  duck(seconds: number) {
    if (!this.gain || !this.playing) return;
    const now = this.gain.context.currentTime;
    const level = this.gain.gain;
    level.cancelScheduledValues(now);
    level.setTargetAtTime(MUSIC_LEVEL * 0.45, now, 0.04);
    level.setTargetAtTime(MUSIC_LEVEL, now + seconds, 0.22);
  }

  get playing() {
    return !!this.audio && !this.audio.paused && !this.audio.error && this.audio.readyState >= 2;
  }

  pause() {
    this.audio?.pause();
    if (this.gain) {
      const now = this.gain.context.currentTime;
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(MUSIC_LEVEL, now);
    }
  }

  destroy() {
    if (!this.audio) return;
    this.audio.onplaying = null;
    this.audio.pause();
    this.source?.disconnect();
    this.gain?.disconnect();
    this.audio.removeAttribute('src');
    this.audio.load();
    this.audio = undefined;
    this.source = undefined;
    this.gain = undefined;
  }
}

export class VelvetReignAudio extends SlotAudio {
  constructor(private readonly score = new VelvetSoundtrack()) {
    super(velvetSlot.audio, score);
  }

  protected override cue(name: string) {
    super.cue(name);
    if (name === 'win' || name === 'tickets' || name === 'cascade') this.score.duck(0.65);
  }
}
