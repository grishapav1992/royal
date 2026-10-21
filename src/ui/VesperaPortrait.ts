import { VESPERA_MEDIA, VESPERA_POSTER } from './vesperaMedia';

/** Quiet idle motion with one-shot gestures driven by player and game events. */
export class VesperaPortrait {
  private idle = document.createElement('video');
  private gesture = document.createElement('video');
  private abort = new AbortController();
  private media = matchMedia('(prefers-reduced-motion: reduce)');
  private resize = new ResizeObserver(() => this.sync());
  private intersection = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.target === this.host) this.inView = entry.isIntersecting;
    this.sync();
  });
  private host: HTMLElement;
  private intro = true;
  private inView = true;
  private dead = false;
  private idleReady = false;
  private gestureReady = false;
  private mode: 'idle' | 'reaction' | 'preview' = 'idle';
  private state = 'loading';
  private starting?: HTMLVideoElement;
  private playVersion = 0;
  private callback = 0;
  private observedVideo?: HTMLVideoElement;
  private fadeTimer?: ReturnType<typeof setTimeout>;
  private lastTime = 0;
  private loops = 0;
  private reactions = 0;
  private lastReaction = '';
  private lastActivation = -Infinity;
  private pendingReaction?: { reason: 'enter' | 'touch'; until: number };
  private pendingTimer?: ReturnType<typeof setTimeout>;
  private warmTimer?: ReturnType<typeof setTimeout>;
  private gestureRequested = false;
  private gestureFailed = false;
  private gestureSource: string;
  private profile: 'mobile' | 'desktop';
  private startedAt = performance.now();
  private firstFrameMs = 0;
  private idleReadyMs = 0;
  private gestureReadyMs = 0;
  private previewTime?: number;
  private readonly cooldown = 18_000;

  constructor(private welcome: HTMLElement, private sidebar: HTMLElement, intro: boolean) {
    this.host = welcome;
    const gameWidth = welcome.closest('.volcanic-plinko')?.getBoundingClientRect().width ?? 1000;
    this.profile = gameWidth <= 650 ? 'mobile' : 'desktop';
    const sources = VESPERA_MEDIA[this.profile]; this.gestureSource = sources.gesture;
    const signal = this.abort.signal;
    for (const [video, kind, source] of [
      [this.idle, 'idle', sources.idle],
      [this.gesture, 'gesture', sources.gesture],
    ] as const) {
      video.className = 'vp-character-video vp-character-' + kind;
      video.setAttribute('aria-hidden', 'true');
      video.muted = video.defaultMuted = true; video.playsInline = true;
      video.loop = kind === 'idle'; video.autoplay = false; video.preload = kind === 'idle' ? 'auto' : 'none';
      video.poster = VESPERA_POSTER;
      video.addEventListener('loadeddata', () => {
        if (video === this.idle) { this.idleReady = true; this.idleReadyMs ||= performance.now() - this.startedAt; }
        else { this.gestureReady = true; this.gestureReadyMs ||= performance.now() - this.startedAt; }
        this.sync();
      }, { signal });
      video.addEventListener('error', () => {
        if (this.dead) return;
        if (video === this.idle) { this.idleReady = false; this.stop(); this.state = 'fallback'; delete this.host.dataset.live; }
        else { this.gestureReady = false; this.gestureRequested = false; this.gestureFailed = true; this.clearPending(); this.returnToIdle(); }
      }, { signal });
      video.addEventListener('timeupdate', () => {
        if (video === this.active && !video.paused && typeof video.requestVideoFrameCallback !== 'function') this.observeTime(video.currentTime);
      }, { signal });
      video.addEventListener('seeked', () => {
        if (!this.dead && this.mode === 'preview' && video === this.gesture && !this.media.matches) {
          this.host.dataset.live = 'true'; this.host.dataset.portraitMode = 'gesture'; this.state = 'preview';
        }
      }, { signal });
      if (kind === 'idle') { video.src = source; video.load(); }
    }
    this.gesture.addEventListener('ended', () => { if (this.mode === 'reaction') this.returnToIdle(); }, { signal });
    document.addEventListener('visibilitychange', this.sync, { signal });
    this.media.addEventListener('change', this.sync, { signal });
    this.resize.observe(welcome); this.resize.observe(sidebar);
    this.setIntro(intro);
  }

  private get active() { return this.mode === 'idle' ? this.idle : this.gesture; }
  private get visible() { return !this.dead && !document.hidden && this.inView && !this.media.matches; }

  setIntro(intro: boolean) {
    this.intersection.unobserve(this.host);
    this.host.removeAttribute('aria-busy');
    delete this.host.dataset.live; delete this.host.dataset.portraitMode;
    this.intro = intro; this.host = intro ? this.welcome : this.sidebar;
    this.host.append(this.idle, this.gesture); this.inView = true;
    this.intersection.observe(this.host); this.sync();
  }

  private fit() {
    const rect = this.host.getBoundingClientRect();
    const aspect = this.idle.videoWidth / this.idle.videoHeight || 786 / 1178;
    const width = Math.min(rect.width, rect.height * aspect), height = width / aspect;
    const align = Number(getComputedStyle(this.host).getPropertyValue('--vp-character-align')) || 0;
    const left = (rect.width - width) / 2, top = (rect.height - height) * align;
    // Continue the spell's low-intensity glow beyond the encoded frame boundary.
    const backdrop = this.host.parentElement!;
    const backdropRect = backdrop.getBoundingClientRect();
    backdrop.style.setProperty('--vp-glow-x', rect.left - backdropRect.left + left + width * .88 + 'px');
    backdrop.style.setProperty('--vp-glow-y', rect.top - backdropRect.top + top + height * .23 + 'px');
    backdrop.style.setProperty('--vp-glow-width', width * .86 + 'px');
    backdrop.style.setProperty('--vp-glow-height', height * .5 + 'px');
    for (const video of [this.idle, this.gesture]) Object.assign(video.style, {
      width: width + 'px', height: height + 'px', left: left + 'px', top: top + 'px',
    });
    return rect.width > 0 && rect.height > 0;
  }

  react(reason: 'enter' | 'touch' | 'win', multiplier = 0) {
    const now = performance.now();
    if (reason === 'win' && (!Number.isFinite(multiplier) || multiplier < 3)) return false;
    if (!this.visible || this.previewTime !== undefined || this.mode === 'reaction' || now - this.lastActivation < this.cooldown) return false;
    if (!this.idleReady || !this.gestureReady) {
      if (reason !== 'win') {
        this.clearPending(); this.pendingReaction = { reason, until: now + 8_000 };
        this.host.setAttribute('aria-busy', 'true');
        this.pendingTimer = setTimeout(() => this.clearPending(), 8_000);
      }
      if (this.idleReady || reason === 'touch') this.ensureGesture();
      return false;
    }
    this.clearPending(); this.cancelWatch(); clearTimeout(this.fadeTimer);
    this.mode = 'reaction'; this.lastTime = 0; this.reactions++; this.lastReaction = reason; this.lastActivation = now;
    this.gesture.currentTime = 0; this.sync();
    return true;
  }

  private returnToIdle() {
    if (this.dead) return;
    this.cancelWatch(); this.previewTime = undefined; this.mode = 'idle'; this.lastTime = 0; this.idle.currentTime = 0; this.sync();
  }

  private clearPending() {
    clearTimeout(this.pendingTimer); this.pendingReaction = undefined;
    this.host.removeAttribute('aria-busy');
  }
  private ensureGesture() {
    if (this.gestureRequested || this.dead || this.media.matches) return;
    clearTimeout(this.warmTimer); this.warmTimer = undefined;
    this.gestureRequested = true; this.gestureFailed = false; this.gesture.preload = 'auto';
    this.gesture.src = this.gestureSource; this.gesture.load();
  }

  private sync = () => {
    if (this.dead) return;
    const hasSize = this.fit();
    if (this.media.matches) {
      this.stop(); this.mode = 'idle'; this.clearPending();
      delete this.host.dataset.live; delete this.host.dataset.portraitMode; this.state = 'reduced'; return;
    }
    if (!hasSize || document.hidden || !this.inView) { this.stop(); this.clearPending(); this.state = 'paused'; return; }
    if (!this.idleReady) { this.state = 'loading'; return; }
    if (this.pendingReaction && this.gestureReady) {
      const { reason, until } = this.pendingReaction; this.clearPending();
      if (performance.now() <= until && this.react(reason)) return;
    }
    if (this.previewTime !== undefined) {
      this.stop(); this.mode = 'preview';
      if (!this.gestureReady) { this.ensureGesture(); return; }
      const duration = this.gesture.duration;
      this.gesture.currentTime = Number.isFinite(duration) && duration > 0 ? Math.max(0, this.previewTime) % duration : 0;
      this.host.dataset.live = 'true'; this.host.dataset.portraitMode = 'gesture'; this.state = 'preview'; return;
    }
    const video = this.active;
    if (this.starting === video) return;
    if (!video.paused) { this.reveal(video); this.watchFrames(video); return; }
    const version = ++this.playVersion; this.starting = video; video.muted = true;
    void video.play().then(() => {
      if (version !== this.playVersion || this.dead) return;
      this.starting = undefined;
      if (!this.visible || this.active !== video || this.previewTime !== undefined) { video.pause(); return; }
      this.reveal(video); this.lastTime = video.currentTime; this.watchFrames(video);
    }).catch(error => {
      if (version !== this.playVersion || this.dead) return;
      this.starting = undefined;
      if (this.visible && error?.name !== 'AbortError') {
        if (video === this.gesture) this.returnToIdle();
        else { this.state = 'blocked'; delete this.host.dataset.live; }
      }
    });
  };

  private reveal(video: HTMLVideoElement) {
    const gesture = video === this.gesture;
    this.host.dataset.live = 'true'; this.host.dataset.portraitMode = gesture ? 'gesture' : 'idle';
    this.state = gesture ? 'reaction' : 'idle';
    if (gesture) this.idle.pause();
    else {
      this.firstFrameMs ||= performance.now() - this.startedAt;
      if (!this.gestureRequested && !this.gestureFailed && !this.warmTimer) this.warmTimer = setTimeout(() => {
        this.warmTimer = undefined; if (this.visible) this.ensureGesture();
      }, 250);
      clearTimeout(this.fadeTimer);
      this.fadeTimer = setTimeout(() => {
        if (!this.dead && this.mode === 'idle') this.gesture.pause();
      }, 400);
    }
  }

  private observeTime(time: number) {
    if (this.mode === 'idle' && time + .2 < this.lastTime) this.loops++;
    this.lastTime = time;
  }
  private watchFrames(video: HTMLVideoElement) {
    if (this.observedVideo === video && this.callback) return;
    this.cancelWatch();
    if (!this.visible || video.paused || typeof video.requestVideoFrameCallback !== 'function') return;
    this.observedVideo = video;
    this.callback = video.requestVideoFrameCallback((_now, frame) => {
      this.callback = 0;
      if (!this.visible || this.active !== video || this.previewTime !== undefined) return;
      this.observeTime(frame.mediaTime); this.watchFrames(video);
    });
  }
  private cancelWatch() {
    if (this.callback && this.observedVideo && typeof this.observedVideo.cancelVideoFrameCallback === 'function') this.observedVideo.cancelVideoFrameCallback(this.callback);
    this.callback = 0; this.observedVideo = undefined;
  }
  private stop() {
    this.playVersion++; this.starting = undefined; this.cancelWatch(); clearTimeout(this.fadeTimer);
    this.idle.pause(); this.gesture.pause();
    clearTimeout(this.warmTimer); this.warmTimer = undefined;
  }
  preview(seconds?: number) {
    this.stop(); this.previewTime = seconds !== undefined && Number.isFinite(seconds) ? seconds : undefined;
    this.mode = this.previewTime === undefined ? 'idle' : 'preview'; this.sync();
  }
  getState() {
    const video = this.active;
    return { state: this.state, scene: this.intro ? 'intro' : 'sidebar', mode: this.mode,
      frames: (this.idle.getVideoPlaybackQuality?.().totalVideoFrames ?? 0) + (this.gesture.getVideoPlaybackQuality?.().totalVideoFrames ?? 0),
      fps: 24, time: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : 0,
      loops: this.loops, paused: video.paused, muted: video.muted, readyState: video.readyState,
      reactions: this.reactions, lastReaction: this.lastReaction,
      profile: this.profile, firstFrameMs: this.firstFrameMs, idleReadyMs: this.idleReadyMs, gestureReadyMs: this.gestureReadyMs,
      cooldown: Math.max(0, this.cooldown - (performance.now() - this.lastActivation)) };
  }
  destroy() {
    if (this.dead) return;
    this.dead = true; this.abort.abort(); this.stop(); this.resize.disconnect(); this.intersection.disconnect();
    this.clearPending();
    for (const video of [this.idle, this.gesture]) { video.removeAttribute('src'); video.load(); video.remove(); }
    delete this.host.dataset.live; delete this.host.dataset.portraitMode; this.state = 'closed';
  }
}
