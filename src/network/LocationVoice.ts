import type { LocalAudioTrack, RemoteParticipant, RemoteTrack, RemoteTrackPublication, Room } from 'livekit-client';
import type { HallId } from '../shared/world';
import type { VoiceCredentials, VoiceMember, VoiceResult } from '../shared/voice';

type VoiceTransport = { send(type: string, value?: unknown): boolean };
export type VoicePeer = VoiceMember & { speaking: boolean };
type VoiceStatus = 'idle' | 'connecting' | 'ready' | 'error';
const retryDelays = [1000, 2000, 5000, 10000];

function readMuteList(): Set<string> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem('royal-voice-muted') ?? '[]');
    if (Array.isArray(stored)) return new Set(stored.filter(key => typeof key === 'string' && /^[\w-]{43}$/.test(key)));
  } catch { /* Voice still works when storage is unavailable. */ }
  return new Set();
}

export class LocationVoice {
  private hall?: HallId;
  private room?: Room;
  private track?: LocalAudioTrack;
  private published = false;
  private capture?: Promise<void>;
  private held = false;
  private requestId = 0;
  private reconnects = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private playbackBlocked = false;
  private microphoneError = false;
  private readonly muted = readMuteList();
  private readonly audio = new Map<string, { track: RemoteTrack; element: HTMLMediaElement }>();
  status: VoiceStatus = 'idle';
  available = false;
  enabled = true;

  constructor(private readonly transport: VoiceTransport, private readonly changed: () => void) {
    try { this.enabled = sessionStorage.getItem('royal-voice-disabled') !== '1'; } catch { /* Storage is optional. */ }
  }

  get canTalk() { return this.enabled && this.status === 'ready'; }
  get needsPlayback() { return this.playbackBlocked; }
  get micError() { return this.microphoneError; }
  get holding() { return this.held; }
  get transmitting() { return this.published && this.held && this.track?.mediaStreamTrack.enabled === true; }

  private member(participant: RemoteParticipant): VoiceMember | undefined {
    try {
      const value = JSON.parse(participant.metadata ?? '') as VoiceMember;
      if (typeof value.playerId === 'string' && /^[\w-]{43}$/.test(value.muteKey)) return value;
    } catch { /* Ignore participants without Royal voice metadata. */ }
  }

  get peers(): VoicePeer[] {
    return [...(this.room?.remoteParticipants.values() ?? [])].flatMap(participant => {
      const member = this.member(participant);
      const live = [...participant.audioTrackPublications.values()].some(track => !track.isMuted);
      return member ? [{ ...member, speaking: live && !this.isMuted(member.muteKey) }] : [];
    });
  }

  isMuted(key: string) { return this.muted.has(key); }

  toggleMute(key: string) {
    if (!this.muted.delete(key)) this.muted.add(key);
    try { sessionStorage.setItem('royal-voice-muted', JSON.stringify([...this.muted])); } catch { /* Storage is optional. */ }
    for (const participant of this.room?.remoteParticipants.values() ?? []) {
      if (this.member(participant)?.muteKey === key) this.syncParticipant(participant);
    }
    this.changed();
  }

  setAvailable(available: boolean) {
    if (this.available === available) return;
    this.available = available;
    this.restart();
  }

  setHall(hall: HallId | undefined) {
    if (this.hall === hall) return;
    this.hall = hall;
    this.restart();
  }

  toggleEnabled() {
    this.enabled = !this.enabled;
    try { sessionStorage.setItem('royal-voice-disabled', this.enabled ? '0' : '1'); } catch { /* Storage is optional. */ }
    if (!this.enabled) this.transport.send('voice-leave');
    this.restart();
  }

  private restart() {
    this.close();
    this.reconnects = 0;
    this.status = 'idle';
    if (this.available && this.enabled && this.hall) this.requestCredentials();
    else this.changed();
  }

  private requestCredentials() {
    if (!this.hall || !this.available || !this.enabled) return;
    const id = ++this.requestId;
    if (!this.transport.send('voice-join', id)) return;
    this.status = 'connecting';
    this.changed();
    this.timer = setTimeout(() => this.retry(), 10000);
  }

  receive(result: VoiceResult) {
    if (result.requestId !== this.requestId || this.status !== 'connecting' || this.room) return;
    clearTimeout(this.timer);
    if (result.unavailable) this.setAvailable(false);
    else if (result.credentials?.hall === this.hall && result.credentials) void this.connect(result.credentials, result.requestId);
    else this.retry();
  }

  private async connect(credentials: VoiceCredentials, requestId: number) {
    try {
      const { Room, RoomEvent } = await import('livekit-client');
      if (requestId !== this.requestId) return;
      const room = this.room = new Room();
      const current = () => this.room === room;
      room.on(RoomEvent.TrackPublished, (_publication, participant) => {
        if (!current()) return;
        this.syncParticipant(participant);
        this.changed();
      });
      room.on(RoomEvent.ParticipantConnected, participant => {
        if (!current()) return;
        this.syncParticipant(participant);
        this.changed();
      });
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (!current() || track.kind !== 'audio' || !this.wantsAudio(participant)) return;
        this.detachAudio(publication.trackSid);
        const element = track.attach();
        document.body.append(element);
        this.audio.set(publication.trackSid, { track, element });
      });
      room.on(RoomEvent.TrackUnsubscribed, (_track, publication) => this.detachAudio(publication.trackSid));
      room.on(RoomEvent.ParticipantDisconnected, () => { if (current()) this.changed(); });
      const updateSpeakers = () => { if (current()) this.changed(); };
      room.on(RoomEvent.TrackMuted, updateSpeakers);
      room.on(RoomEvent.TrackUnmuted, updateSpeakers);
      room.on(RoomEvent.TrackUnpublished, updateSpeakers);
      room.on(RoomEvent.AudioPlaybackStatusChanged, playing => {
        if (!current()) return;
        this.playbackBlocked = !playing;
        this.changed();
      });
      room.on(RoomEvent.Reconnecting, () => {
        if (!current()) return;
        this.release();
        this.status = 'connecting';
        this.changed();
      });
      room.on(RoomEvent.Reconnected, () => { if (current()) this.ready(room); });
      room.on(RoomEvent.Disconnected, () => { if (current()) this.retry(); });
      await room.connect(credentials.url, credentials.token, { autoSubscribe: false, maxRetries: 0 });
      if (current()) this.ready(room);
      else await room.disconnect();
    } catch {
      if (requestId === this.requestId) this.retry();
    }
  }

  private ready(room: Room) {
    this.status = 'ready';
    this.reconnects = 0;
    for (const participant of room.remoteParticipants.values()) this.syncParticipant(participant);
    this.unlockPlayback();
    this.changed();
  }

  private wantsAudio(participant: RemoteParticipant) {
    const member = this.member(participant);
    return Boolean(member && !this.isMuted(member.muteKey));
  }

  private syncParticipant(participant: RemoteParticipant) {
    const subscribe = this.wantsAudio(participant);
    for (const publication of participant.audioTrackPublications.values()) {
      this.syncPublication(publication, subscribe);
    }
  }

  private syncPublication(publication: RemoteTrackPublication, subscribe: boolean) {
    if (!subscribe) this.detachAudio(publication.trackSid);
    publication.setSubscribed(subscribe);
  }

  private detachAudio(sid: string) {
    const audio = this.audio.get(sid);
    if (!audio) return;
    audio.track.detach(audio.element);
    audio.element.pause();
    audio.element.remove();
    this.audio.delete(sid);
  }

  unlockPlayback() {
    const room = this.room;
    if (!room || this.status !== 'ready') return;
    const update = () => {
      if (this.room === room) { this.playbackBlocked = !room.canPlaybackAudio; this.changed(); }
    };
    void room.startAudio().then(update, update);
  }

  press() {
    if (!this.canTalk || this.held || document.hidden) return false;
    this.held = true;
    this.microphoneError = false;
    this.unlockPlayback();
    if (this.track?.mediaStreamTrack.readyState === 'live') {
      const track = this.track;
      void track.unmute().catch(() => { if (this.track === track) this.failedMic(); });
      this.changed();
    } else if (!this.capture && this.room) {
      const room = this.room;
      const capture = this.openMicrophone(room).finally(() => {
        if (this.capture === capture) { this.capture = undefined; this.changed(); }
      });
      this.capture = capture;
    }
    return true;
  }

  private async openMicrophone(room: Room) {
    let track: LocalAudioTrack | undefined;
    try {
      const { createLocalAudioTrack, Track, TrackEvent, AudioPresets } = await import('livekit-client');
      if (!this.held || this.room !== room) return;
      track = await createLocalAudioTrack({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true });
      if (!this.held || this.room !== room || !this.canTalk) { track.stop(); return; }
      const microphone = track;
      this.published = false;
      this.track = microphone;
      microphone.on(TrackEvent.Unmuted, () => {
        if (!this.held || this.room !== room || !this.canTalk) microphone.mediaStreamTrack.enabled = false;
        this.changed();
      });
      await room.localParticipant.publishTrack(microphone, { source: Track.Source.Microphone, audioPreset: AudioPresets.speech, dtx: true });
      if (this.room === room && this.track === microphone) this.published = true;
    } catch {
      track?.stop();
      if (this.room === room) { this.track = undefined; this.failedMic(); }
    }
  }

  private failedMic() {
    this.microphoneError = true;
    this.release();
    this.changed();
  }

  release() {
    if (!this.held) return;
    this.held = false;
    if (this.track) {
      this.track.mediaStreamTrack.enabled = false;
      void this.track.mute().catch(() => {});
    }
    this.changed();
  }

  private retry() {
    this.close();
    this.status = 'error';
    this.changed();
    const delay = retryDelays[Math.min(this.reconnects++, retryDelays.length - 1)];
    this.timer = setTimeout(() => this.requestCredentials(), delay);
  }

  private close() {
    clearTimeout(this.timer);
    this.requestId++;
    this.release();
    this.track?.stop();
    this.track = undefined;
    this.published = false;
    this.capture = undefined;
    for (const sid of this.audio.keys()) this.detachAudio(sid);
    const room = this.room;
    this.room = undefined;
    this.playbackBlocked = false;
    this.microphoneError = false;
    if (room) void room.disconnect().catch(() => {});
  }
}
