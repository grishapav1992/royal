type Clip = 'idle' | 'channel';
const sources: Record<Clip, string> = {
  idle: '/assets/forest-heart/kling-v1/idle.mp4',
  channel: '/assets/forest-heart/kling-v1/channel.mp4',
};

/** Silent local media only. The existing character clock and confirmed pose select a clip. */
export class ForestVideo {
  private canvas: HTMLCanvasElement;
  private videos = new Map<Clip, HTMLVideoElement>();
  private failed = new Set<Clip>();
  private controller = new AbortController();
  private gl?: WebGLRenderingContext;
  private program?: WebGLProgram;
  private buffer?: WebGLBuffer;
  private texture?: WebGLTexture;
  private current: Clip | null = null;
  private desired: Clip | null = null;
  private suspended = false;
  private alive = true;
  private blend = 0;
  private last = 0;
  private uploadedTime = -1;
  private frames = 0;
  private playing = new Set<Clip>();

  constructor(private host: HTMLElement) {
    const doc = host.ownerDocument;
    this.canvas = doc.createElement('canvas');
    this.canvas.className = 'fh-character-video';
    this.canvas.width = 640; this.canvas.height = 768;
    this.canvas.setAttribute('aria-hidden', 'true');
    host.prepend(this.canvas);
    for (const kind of ['idle', 'channel'] as const) {
      const video = doc.createElement('video');
      video.hidden = true; video.muted = true; video.defaultMuted = true; video.volume = 0;
      video.playsInline = true; video.disablePictureInPicture = true;
      video.preload = 'none'; video.loop = kind === 'idle';
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
      // The right half stores a grayscale alpha matte. Both halves share one decoder and frame.
      const fs = shader(gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 uv; uniform sampler2D image; void main(){vec3 rgb=texture2D(image,vec2(uv.x*.5,uv.y)).rgb;float a=texture2D(image,vec2(.5+uv.x*.5,uv.y)).r;gl_FragColor=vec4(rgb*a,a);}');
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
      this.texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(gl.getUniformLocation(this.program, 'image'), 0);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.suspend(true); this.release(); }, { signal: this.controller.signal });
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

  update(pose: string, elapsed: number) {
    if (!this.alive || this.suspended || this.host.ownerDocument.hidden) return;
    this.desired = pose === 'idle' ? 'idle' : pose === 'channel' ? 'channel' : null;
    if (this.desired && this.failed.has(this.desired)) this.desired = null;
    const dt = this.last ? Math.max(0, Math.min(80, elapsed - this.last)) : 0;
    this.last = elapsed;
    if (this.current !== this.desired && this.blend <= 0) {
      if (this.current) this.videos.get(this.current)!.pause();
      this.current = this.desired; this.uploadedTime = -1;
      if (this.current) { const video = this.videos.get(this.current)!; video.currentTime = 0; }
    }
    const video = this.current ? this.videos.get(this.current)! : undefined;
    if (this.current === this.desired && this.current) this.play(this.current);
    const ready = !!video && video.readyState >= 2 && !video.ended && !this.failed.has(this.current!);
    if (ready && !this.gl && !this.setup()) { this.failed.add(this.current!); return; }
    if (ready && this.gl && video.currentTime !== this.uploadedTime) {
      try {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.texture!);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        this.uploadedTime = video.currentTime; this.frames++;
      } catch { this.failed.add(this.current!); }
    }
    const target = ready && this.current === this.desired && !this.failed.has(this.current!) && this.frames > 0 ? 1 : 0;
    this.blend = Math.max(0, Math.min(1, this.blend + (target ? 1 : -1) * dt / 180));
    this.host.style.setProperty('--fh-video-blend', String(this.blend));
    this.host.dataset.video = this.blend > 0 ? this.current! : 'fallback';
  }

  suspend(value: boolean) {
    if (value) {
      for (const video of this.videos.values()) video.pause();
      this.current = null; this.desired = null; this.blend = 0; this.last = 0;
      this.host.style.setProperty('--fh-video-blend', '0'); this.host.dataset.video = 'fallback';
    }
    this.suspended = value;
  }

  state() { return { clip: this.current, blend: this.blend, frames: this.frames, suspended: this.suspended, failed: [...this.failed], media: [...this.videos].map(([clip, video]) => ({ clip, paused: video.paused, time: video.currentTime, ready: video.readyState, muted: video.muted })) }; }
  private release() {
    const gl = this.gl;
    if (gl) { if (this.texture) gl.deleteTexture(this.texture); if (this.buffer) gl.deleteBuffer(this.buffer); if (this.program) gl.deleteProgram(this.program); }
    this.gl = undefined; this.program = undefined; this.texture = undefined; this.buffer = undefined;
  }
  destroy() {
    this.alive = false; this.suspend(true); this.controller.abort();
    for (const video of this.videos.values()) { video.removeAttribute('src'); video.load(); video.remove(); }
    this.videos.clear(); this.release(); this.canvas.remove();
    this.host.style.removeProperty('--fh-video-blend'); delete this.host.dataset.video;
  }
}
