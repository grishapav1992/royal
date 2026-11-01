import { forestIdleMotion } from './ForestIdleMotion';

type Clip = 'look' | 'focus' | 'magic';
const clips: Clip[] = ['look', 'focus', 'magic'];
const sources: Record<Clip, string> = {
  look: '/assets/forest-heart/living-v14/look.mp4',
  focus: '/assets/forest-heart/living-v14/focus.mp4',
  magic: '/assets/forest-heart/living-v14/magic.mp4',
};
const episodeMs = 3000, standingMs = 6000, fadeMs = 640;
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

/** Three neutral-to-neutral gestures share one living idle and premultiplied compositor. */
export class ForestVideo {
  private canvas: HTMLCanvasElement;
  private videos = new Map<Clip, HTMLVideoElement>();
  private failed = new Set<Clip>();
  private controller = new AbortController();
  private gl?: WebGLRenderingContext;
  private program?: WebGLProgram;
  private buffer?: WebGLBuffer;
  private currentTexture?: WebGLTexture;
  private heldTexture?: WebGLTexture;
  private portraitTexture?: WebGLTexture;
  private weightsLocation: WebGLUniformLocation | null = null;
  private timeLocation: WebGLUniformLocation | null = null;
  private motionLocation: WebGLUniformLocation | null = null;
  private current: Clip | null = null;
  private heldClip: Clip | null = null;
  private heldActive = false;
  private returnAt: number | null = null;
  private phase: 'standing' | 'loading' | 'playing' | 'fading' = 'standing';
  private nextIndex = 0;
  private nextAt = standingMs;
  private loadingAt = 0;
  private episodeAt = 0;
  private failureAt = 0;
  private failureWeight = 0;
  private resumePending = false;
  private history: {clip: Clip; startMs: number; endMs?: number}[] = [];
  private suspended = false;
  private alive = true;
  private visible = false;
  private weights = { native: 1, held: 0, video: 0 };
  private last = 0;
  private uploadedTime = -1;
  private frames = 0;
  private draws = 0;
  private heldFrame = 0;
  private playing = new Set<Clip>();

  constructor(private host: HTMLElement) {
    const doc = host.ownerDocument;
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'fh-character-video';
    this.canvas.width = 640; this.canvas.height = 768;
    this.canvas.setAttribute('aria-hidden', 'true');
    host.prepend(this.canvas);
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.suspend(true); this.release();
    }, { signal: this.controller.signal });
    for (const kind of clips) {
      const video = doc.createElement('video');
      video.hidden = true; video.muted = true; video.defaultMuted = true; video.volume = 0;
      video.playsInline = true; video.disablePictureInPicture = true;
      video.preload = 'none'; video.loop = false;
      video.setAttribute('aria-hidden', 'true');
      video.addEventListener('error', () => { this.failed.add(kind); }, { signal: this.controller.signal });
      host.prepend(video); this.videos.set(kind, video);
    }
  }

  private setup() {
    try {
      const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, depth: false, stencil: false, antialias: false });
      if (!gl) return false;
      this.gl = gl;
      const shader = (type: number, source: string) => {
        const value = gl.createShader(type)!;
        gl.shaderSource(value, source); gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) { gl.deleteShader(value); throw Error('Video shader'); }
        return value;
      };
      const vs = shader(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 uv; void main(){uv=vec2((p.x+1.)*.5,(1.-p.y)*.5);gl_Position=vec4(p,0.,1.);}');
      // Add premultiplied colors once, rather than fading two DOM layers over each other.
      const fs = shader(gl.FRAGMENT_SHADER, `precision mediump float; varying vec2 uv; uniform sampler2D portrait; uniform sampler2D held; uniform sampler2D moving; uniform vec3 weights; uniform float time; uniform float motion; ${forestIdleMotion} vec4 unpackFrame(sampler2D image){vec2 p=uv-motion*forestIdleShift(uv,time);vec3 rgb=texture2D(image,vec2(p.x*.5,p.y)).rgb;float a=texture2D(image,vec2(.5+p.x*.5,p.y)).r;return vec4(rgb*a,a);} void main(){gl_FragColor=texture2D(portrait,uv)*weights.x+unpackFrame(held)*weights.y+unpackFrame(moving)*weights.z;}`);
      this.program = gl.createProgram()!;
      gl.attachShader(this.program, vs); gl.attachShader(this.program, fs); gl.linkProgram(this.program);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw Error('Video program');
      gl.useProgram(this.program);
      this.buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
      const p = gl.getAttribLocation(this.program, 'p');
      gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0);
      const texture = (unit: number, name: string) => {
        const value = gl.createTexture()!; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, value);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        gl.uniform1i(gl.getUniformLocation(this.program!, name), unit); return value;
      };
      this.portraitTexture = texture(0, 'portrait'); this.heldTexture = texture(1, 'held'); this.currentTexture = texture(2, 'moving');
      this.weightsLocation = gl.getUniformLocation(this.program, 'weights');
      this.timeLocation = gl.getUniformLocation(this.program, 'time'); this.motionLocation = gl.getUniformLocation(this.program, 'motion');
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      return true;
    } catch { this.release(); return false; }
  }

  private play(kind: Clip) {
    const video = this.videos.get(kind)!;
    if (!video.src) { video.src = sources[kind]; video.preload = 'auto'; video.load(); }
    if (video.ended) return;
    if (video.paused && !this.playing.has(kind)) {
      this.playing.add(kind);
      void video.play().catch(error => {
        if (error?.name !== 'AbortError') this.failed.add(kind);
      }).finally(() => this.playing.delete(kind));
    }
  }

  private finish(elapsed: number, failed = false) {
    if (this.current) this.videos.get(this.current)!.pause();
    const last = this.history.at(-1);
    if (this.phase === 'playing' && last && last.endMs === undefined) last.endMs = elapsed;
    if (failed && this.phase === 'playing') {
      this.failureWeight = smooth((elapsed - this.episodeAt) / fadeMs);
      this.failureAt = elapsed; this.phase = 'fading'; return;
    }
    if (this.phase === 'playing') {
      // Transfer the decoded final frame without a redraw, seek, or change of pose.
      [this.heldTexture, this.currentTexture] = [this.currentTexture, this.heldTexture];
      this.heldClip = this.current; this.heldActive = true; this.heldFrame++;
      this.returnAt = elapsed;
    }
    this.current = null; this.phase = 'standing'; this.nextAt = elapsed + standingMs;
  }

  private presentation(visible: boolean) {
    this.visible = visible;
    this.host.style.setProperty('--fh-video-visible', visible ? '1' : '0');
    this.host.dataset.video = visible ? this.current ?? 'held-' + this.heldClip : 'standing';
  }

  update(pose: string, elapsed: number, portrait: HTMLCanvasElement, motion: number) {
    if (!this.alive || this.suspended || this.host.ownerDocument.hidden) return;
    this.last = elapsed;
    if (this.resumePending) { this.nextAt = elapsed + standingMs; this.resumePending = false; }
    const eligible = pose === 'idle';
    if (this.phase === 'standing' && eligible && elapsed >= this.nextAt) {
      const kind = clips[this.nextIndex]; this.nextIndex = (this.nextIndex + 1) % clips.length;
      this.nextAt = elapsed + standingMs;
      if (!this.failed.has(kind)) {
        this.current = kind; this.uploadedTime = -1; this.loadingAt = elapsed; this.phase = 'loading';
        this.videos.get(kind)!.currentTime = 0;
      }
    }
    const video = this.current ? this.videos.get(this.current)! : undefined;
    if (this.current && (this.phase === 'loading' || this.phase === 'playing')) this.play(this.current);
    const ready = !!video && video.readyState >= 2 && !video.seeking && !this.failed.has(this.current!);
    if (ready && !this.gl && !this.setup()) this.failed.add(this.current!);
    if (ready && this.gl && video.currentTime !== this.uploadedTime && (this.phase === 'loading' || this.phase === 'playing')) {
      try {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.currentTexture!);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        this.uploadedTime = video.currentTime; this.frames++;
        if (this.phase === 'loading') {
          this.episodeAt = elapsed; this.phase = 'playing';
          this.history.push({clip:this.current!,startMs:elapsed}); this.history = this.history.slice(-12);
        }
      } catch { this.failed.add(this.current!); }
    }
    if ((this.phase === 'loading' && (!eligible || elapsed - this.loadingAt >= 8000)) || (this.current && this.failed.has(this.current) && this.phase !== 'fading')) this.finish(elapsed, true);
    if (this.phase === 'playing' && (elapsed - this.episodeAt >= episodeMs || video?.ended)) this.finish(elapsed);
    if (this.heldActive && this.phase !== 'playing' && !eligible && this.returnAt === null) this.returnAt = elapsed;
    const nativeReturn = this.returnAt === null ? 0 : smooth((elapsed - this.returnAt) / fadeMs);
    if (nativeReturn === 1) { this.heldActive = false; this.heldClip = null; this.returnAt = null; }
    let moving = this.phase === 'playing' ? smooth((elapsed - this.episodeAt) / fadeMs) : this.phase === 'fading' ? this.failureWeight * (1 - smooth((elapsed - this.failureAt) / fadeMs)) : 0;
    if (this.phase === 'fading' && moving === 0) { this.current = null; this.phase = 'standing'; this.nextAt = elapsed + standingMs; }
    const held = this.heldActive ? (1 - nativeReturn) * (1 - moving) : 0;
    this.weights = { native: 1 - moving - held, held, video: moving };
    if (!this.gl || moving + held === 0) { this.presentation(false); return; }
    try {
      const gl = this.gl;
      gl.useProgram(this.program!);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.portraitTexture!);
      if (this.weights.native > 0) {
        // Called immediately after the native renderer, before its drawing buffer is discarded.
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, portrait);
      }
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.heldTexture!);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.currentTexture!);
      gl.uniform3f(this.weightsLocation, this.weights.native, held, moving);
      gl.uniform1f(this.timeLocation, elapsed / 1000); gl.uniform1f(this.motionLocation, motion);
      // A held frame is redrawn too, so browser composition never exposes a cleared buffer.
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); this.draws++; this.presentation(true);
    } catch { if (this.current) this.failed.add(this.current); this.presentation(false); }
  }

  suspend(value: boolean) {
    if (value === this.suspended) return;
    if (value) {
      for (const video of this.videos.values()) video.pause();
      const last = this.history.at(-1); if (last && last.endMs === undefined) last.endMs = this.last;
      this.current = null; this.heldActive = false; this.heldClip = null; this.returnAt = null;
      this.phase = 'standing'; this.weights = {native:1,held:0,video:0};
      this.resumePending = true; this.presentation(false);
    }
    this.suspended = value;
  }

  get showing() { return this.visible; }
  state() { return { clip: this.current, heldClip: this.heldClip, heldFrame: this.heldFrame, phase: this.phase, nextClip: clips[this.nextIndex], nextAtMs: this.nextAt, episodeMs, standingMs, fadeMs, history: this.history.map(event=>({...event})), blend: this.weights.held + this.weights.video, weights: {...this.weights}, visible:this.visible, frames: this.frames, draws:this.draws, suspended: this.suspended, failed: [...this.failed], media: [...this.videos].map(([clip, video]) => ({ clip, paused: video.paused, time: video.currentTime, ready: video.readyState, muted: video.muted, loop: video.loop })) }; }
  private release() {
    const gl = this.gl;
    if (gl) { for (const texture of [this.currentTexture,this.heldTexture,this.portraitTexture]) if (texture) gl.deleteTexture(texture); if (this.buffer) gl.deleteBuffer(this.buffer); if (this.program) gl.deleteProgram(this.program); }
    this.gl = undefined; this.program = undefined; this.currentTexture = undefined; this.heldTexture = undefined; this.portraitTexture = undefined; this.buffer = undefined;
  }
  destroy() {
    this.alive = false; this.suspend(true); this.controller.abort();
    for (const video of this.videos.values()) { video.removeAttribute('src'); video.load(); video.remove(); }
    this.videos.clear(); this.release(); this.canvas.remove();
    this.host.style.removeProperty('--fh-video-visible'); delete this.host.dataset.video;
  }
}
