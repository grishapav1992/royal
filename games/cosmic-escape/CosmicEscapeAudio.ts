import {SlotAudio, type SlotBackgroundMusic} from '../../src/ui/slotKit/SlotAudio';
import {cosmicSlot} from '../../src/ui/slotKit/nativeSlots';

const tracks = [
  '/assets/cosmic-guardians/music/orbital-drift.m4a',
  '/assets/cosmic-guardians/music/ion-runner.m4a',
  '/assets/cosmic-guardians/music/far-beacon.m4a',
] as const;
const nextTrackKey = 'royal-cosmic-next-track';

class FlightPlaylist implements SlotBackgroundMusic {
  private index = 0;
  private player?: HTMLAudioElement;
  private source?: MediaElementAudioSourceNode;
  private gain?: GainNode;
  private requested = false;
  private failures = 0;
  private remembered = false;
  playing = false;

  constructor() {
    try {
      const next = Number(localStorage.getItem(nextTrackKey));
      if (Number.isInteger(next) && next >= 0 && next < tracks.length) this.index = next;
    } catch { /* Playback also works without storage. */ }
  }

  start(context: AudioContext, output: GainNode, onPlay: () => void) {
    if (this.requested) return;
    if (!this.player) {
      const player = new Audio();
      player.preload = 'none';
      this.gain = context.createGain();
      this.gain.gain.value = 0.065;
      this.source = context.createMediaElementSource(player);
      this.source.connect(this.gain);
      this.gain.connect(output);
      this.player = player;
      player.onplaying = () => {
        if (!this.requested || player.paused) return;
        this.failures = 0;
        this.playing = true;
        if (this.remembered) return;
        this.remembered = true;
        try { localStorage.setItem(nextTrackKey, String((this.index + 1) % tracks.length)); } catch {}
        onPlay();
      };
      player.onended = () => {
        if (this.requested && player.ended) this.advance();
      };
      player.onerror = () => {
        if (!this.requested || !player.error) return;
        if (++this.failures < tracks.length) this.advance();
        else this.stop();
      };
      player.src = tracks[this.index];
    }
    this.requested = true;
    this.failures = 0;
    if (this.player.error) this.player.load();
    this.play();
  }

  private advance() {
    this.playing = false;
    this.remembered = false;
    this.index = (this.index + 1) % tracks.length;
    this.player!.src = tracks[this.index];
    this.play();
  }

  private play() {
    const player = this.player!;
    void player.play().catch(error => {
      // A later gesture can unlock playback. Load errors are handled by onerror.
      if (error.name === 'NotAllowedError' && player.paused) this.stop();
    });
  }

  stop() {
    this.requested = false;
    this.playing = false;
    this.player?.pause();
  }

  destroy() {
    this.stop();
    if (!this.player) return;
    this.player.onended = this.player.onplaying = this.player.onerror = null;
    this.source?.disconnect();
    this.gain?.disconnect();
    this.player.removeAttribute('src');
    this.player.load();
    this.player = undefined;
  }
}

export class CosmicEscapeAudio extends SlotAudio {
  constructor() { super(cosmicSlot.audio, new FlightPlaylist()); }
}
