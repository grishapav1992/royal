export const FOREST_POSES = ['idle', 'blink', 'choice', 'channel', 'flower', 'bonus', 'win', 'big'] as const;
export type ForestPose = Exclude<typeof FOREST_POSES[number], 'blink'>;

const vertex = `
attribute vec2 aUv;
uniform float uTime;
uniform float uMotion;
varying vec2 vUv;
void main(){
  vUv=aUv;
  vec2 p=aUv;
  // Local weights keep the eyes and central body anchored. Hair and fabric move independently.
  float hair=smoothstep(.55,.77,p.x)*smoothstep(.14,.34,p.y)*(1.-smoothstep(.74,.99,p.y));
  float cloth=smoothstep(.62,.96,p.y)*smoothstep(.06,.26,abs(p.x-.5));
  float breath=exp(-pow((p.y-.41)/.16,2.))*exp(-pow((p.x-.5)/.23,2.));
  p.x+=uMotion*(hair*.004*sin(uTime*.83+p.y*8.)+cloth*.003*sin(uTime*.67+p.y*6.)+breath*(p.x-.5)*.009*sin(uTime*1.25));
  p.y-=uMotion*breath*.0018*sin(uTime*1.25);
  gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);
}`;
const fragment = `
precision mediump float;
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform sampler2D uEyes;
uniform float uBlend;
uniform float uBlink;
varying vec2 vUv;
void main(){
  vec4 color=mix(texture2D(uFrom,vUv),texture2D(uTo,vUv),uBlend);
  // The blink changes a feathered eye region only. Clothes and hands never dissolve to a blink frame.
  float eyes=(1.-smoothstep(.052,.078,abs(vUv.x-.5)))*(1.-smoothstep(.018,.034,abs(vUv.y-.143)));
  gl_FragColor=mix(color,texture2D(uEyes,vUv),uBlink*eyes);
}`;

/** Owned presentation renderer. It has no transport, wallet, game entropy or outcome calculation. */
export class ForestCharacter {
  private canvas: HTMLCanvasElement;
  private images = new Map<typeof FOREST_POSES[number], HTMLImageElement>();
  private gl?: WebGLRenderingContext;
  private program?: WebGLProgram;
  private vertices?: WebGLBuffer;
  private indices?: WebGLBuffer;
  private textures = new Map<typeof FOREST_POSES[number], WebGLTexture>();
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private controller = new AbortController();
  private observer: ResizeObserver;
  private alive = true;
  private ready = false;
  private paused = false;
  private reduced = false;
  private raf = 0;
  private last = 0;
  private paintedAt = -Infinity;
  private elapsed = 0;
  private transitionAt = 0;
  private transitionDuration = 0;
  private holdUntil = 0;
  private from: ForestPose = 'idle';
  private pose: ForestPose = 'idle';
  private resting: ForestPose = 'idle';
  private nextBlink = 4600;
  private blinkAt = -Infinity;
  private blinkValue = 0;
  private blinkCount = 0;
  private frameCount = 0;
  private events: { pose: ForestPose; atMs: number }[] = [];

  constructor(private host: HTMLElement) {
    const document = host.ownerDocument;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fh-character-canvas'; this.canvas.width = 640; this.canvas.height = 768;
    this.canvas.setAttribute('aria-hidden', 'true'); host.prepend(this.canvas);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    const loads = FOREST_POSES.map(pose => {
      const image = document.createElement('img');
      image.className = 'fh-elf'; image.alt = ''; image.draggable = false; image.dataset.pose = pose;
      image.src = `/assets/forest-heart/v3/elf-${pose}.webp`;
      this.images.set(pose, image); host.prepend(image);
      return image.decode().catch(() => {});
    });
    this.host.dataset.pose = 'idle'; this.host.dataset.renderer = 'loading';
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.stop(); this.gl = undefined; this.host.dataset.renderer = 'image'; this.fallback(); this.run();
    }, { signal: this.controller.signal });
    this.canvas.addEventListener('webglcontextrestored', () => { if (this.alive) { this.setup(); this.draw(); this.run(); } }, { signal: this.controller.signal });
    void Promise.all(loads).then(() => {
      if (!this.alive) return;
      this.ready = [...this.images.values()].every(image => image.complete && image.naturalWidth > 0);
      if (this.ready) this.setup(); else this.host.dataset.renderer = 'image';
      this.fallback(); this.draw(); this.run();
    });
  }
  private setup() {
    try {
      const gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
      if (!gl) throw Error('No character WebGL');
      const shader = (type: number, source: string) => {
        const value = gl.createShader(type)!; gl.shaderSource(value, source); gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) { gl.deleteShader(value); throw Error('Character shader'); }
        return value;
      };
      const vs = shader(gl.VERTEX_SHADER, vertex), fs = shader(gl.FRAGMENT_SHADER, fragment), program = gl.createProgram()!;
      gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program); gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteProgram(program); throw Error('Character program'); }
      this.gl = gl; this.program = program; gl.useProgram(program);
      const vertices: number[] = [], indices: number[] = [], columns = 24, rows = 32;
      for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) vertices.push(x / columns, y / rows);
      for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
        const a = y * (columns + 1) + x, b = a + columns + 1; indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
      this.vertices = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.vertices); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
      const uv = gl.getAttribLocation(program, 'aUv'); gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
      this.indices = gl.createBuffer()!; gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indices); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      for (const [pose, image] of this.images) {
        const texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); this.textures.set(pose, texture);
      }
      for (const name of ['uTime', 'uMotion', 'uFrom', 'uTo', 'uEyes', 'uBlend', 'uBlink']) this.uniforms[name] = gl.getUniformLocation(program, name);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.host.dataset.renderer = 'webgl';
      this.resize();
    } catch { this.release(); this.host.dataset.renderer = 'image'; }
  }
  private resize() {
    if (!this.alive) return;
    const dpr = Math.min(1.5, this.host.ownerDocument.defaultView!.devicePixelRatio || 1);
    const height = Math.min(this.canvas.clientHeight, this.canvas.clientWidth * 768 / 640);
    const width = Math.max(128, Math.min(640, Math.round(height * dpr * 640 / 768)));
    if (width === this.canvas.width) return;
    this.canvas.width = width; this.canvas.height = Math.round(width * 768 / 640);
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height); this.draw();
  }
  private fallback() {
    for (const [pose, image] of this.images) {
      image.style.opacity = pose === this.pose ? '1' : '0';
      image.classList.toggle('fh-blink-eyes', pose === 'blink');
      if (pose === 'blink') image.style.opacity = this.pose === 'idle' ? String(this.blinkValue) : '0';
    }
  }
  private draw() {
    if (!this.alive || !this.ready) return;
    const gl = this.gl;
    if (!gl || !this.program) { this.fallback(); return; }
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.program);
    const bind = (pose: typeof FOREST_POSES[number], unit: number, uniform: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.textures.get(pose)!); gl.uniform1i(this.uniforms[uniform], unit);
    };
    bind(this.from, 0, 'uFrom'); bind(this.pose, 1, 'uTo'); bind('blink', 2, 'uEyes');
    const t = this.transitionDuration ? Math.min(1, (this.elapsed - this.transitionAt) / this.transitionDuration) : 1;
    gl.uniform1f(this.uniforms.uBlend, t * t * (3 - 2 * t));
    gl.uniform1f(this.uniforms.uTime, this.elapsed / 1000); gl.uniform1f(this.uniforms.uMotion, this.reduced || this.paused ? 0 : 1);
    gl.uniform1f(this.uniforms.uBlink, this.pose === 'idle' && t >= 1 ? this.blinkValue : 0);
    gl.drawElements(gl.TRIANGLES, 24 * 32 * 6, gl.UNSIGNED_SHORT, 0); this.frameCount++;
  }
  private setPose(pose: ForestPose, immediate = false) {
    if (pose === this.pose && !immediate) return;
    const progress = this.transitionDuration ? (this.elapsed - this.transitionAt) / this.transitionDuration : 1;
    if (progress >= .5) this.from = this.pose;
    this.pose = pose; this.host.dataset.pose = pose; this.blinkValue = 0; this.blinkAt = -Infinity;
    this.transitionAt = this.elapsed; this.transitionDuration = immediate || this.reduced || this.paused ? 0 : 320;
    if (!this.transitionDuration) this.from = pose;
    this.fallback(); this.draw(); this.run();
  }
  rest(pose: ForestPose, immediate = false) {
    this.resting = pose;
    if (immediate) { this.holdUntil = 0; this.setPose(pose, true); }
    else if (this.holdUntil <= this.elapsed) this.setPose(pose);
  }
  react(pose: ForestPose, holdMs: number) {
    if (!this.alive || this.paused) return;
    this.events.push({ pose, atMs: this.elapsed }); this.events = this.events.slice(-32);
    this.holdUntil = this.elapsed + (this.reduced ? 0 : holdMs); this.setPose(pose);
  }
  mode(paused: boolean, reduced: boolean) {
    this.paused = paused; this.reduced = reduced;
    if (paused || reduced) {
      this.stop(); this.holdUntil = 0; this.from = this.pose; this.transitionDuration = 0; this.blinkValue = 0; this.blinkAt = -Infinity; this.draw();
    } else this.run();
  }
  private tick = (stamp: number) => {
    this.raf = 0;
    if (!this.alive || this.paused || this.reduced || this.host.ownerDocument.hidden) { this.last = 0; return; }
    if (this.last) this.elapsed += Math.min(80, stamp - this.last);
    this.last = stamp;
    if (this.holdUntil && this.elapsed >= this.holdUntil) { this.holdUntil = 0; this.setPose(this.resting); }
    if (this.pose === 'idle') {
      if (this.elapsed >= this.nextBlink) { this.blinkAt = this.elapsed; this.blinkCount++; this.nextBlink = this.elapsed + [6800, 5400, 7900][(this.blinkCount - 1) % 3]; }
      const blink = this.elapsed - this.blinkAt;
      this.blinkValue = blink < 70 ? blink / 70 : blink < 115 ? 1 : blink < 235 ? 1 - (blink - 115) / 120 : 0;
    } else this.blinkValue = 0;
    if (stamp - this.paintedAt >= 1000 / 30) { this.draw(); this.paintedAt = stamp; }
    this.run();
  };
  private run() {
    if (!this.raf && this.alive && this.ready && !this.paused && !this.reduced && !this.host.ownerDocument.hidden)
      this.raf = this.host.ownerDocument.defaultView!.requestAnimationFrame(this.tick);
  }
  private stop() { this.host.ownerDocument.defaultView!.cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0; }
  state() { return { ready: this.ready, renderer: this.host.dataset.renderer, pose: this.pose, resting: this.resting, paused: this.paused, reduced: this.reduced, running: !!this.raf, elapsedMs: this.elapsed, frames: this.frameCount, renderSize:[this.canvas.width,this.canvas.height], blinks: this.blinkCount, blink: this.blinkValue, transition: this.transitionDuration ? Math.min(1, (this.elapsed - this.transitionAt) / this.transitionDuration) : 1, events: [...this.events] }; }
  private release() {
    const gl = this.gl; if (!gl) return;
    for (const texture of this.textures.values()) gl.deleteTexture(texture); this.textures.clear();
    if (this.vertices) gl.deleteBuffer(this.vertices); if (this.indices) gl.deleteBuffer(this.indices); if (this.program) gl.deleteProgram(this.program);
    this.gl = undefined; this.program = undefined;
  }
  destroy() { this.alive = false; this.stop(); this.observer.disconnect(); this.controller.abort(); this.release(); this.images.clear(); }
}
