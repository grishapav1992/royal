import { ForestVideo } from './ForestVideo';

export const FOREST_POSES = ['idle', 'blink', 'choice', 'channel', 'flower', 'bonus', 'win', 'big'] as const;
export type ForestPose = Exclude<typeof FOREST_POSES[number], 'blink'>;
type ForestReaction = ForestPose | 'awaken';
const poses: ForestPose[] = FOREST_POSES.filter((pose): pose is ForestPose => pose !== 'blink');
const smooth = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * t * (t * (t * 6 - 15) + 10); };
type GestureKey = [number, number, number, number, number];
// Reach, shoulder lift, head acknowledgement and light. These are local art curves, not game rules.
const gestures: Partial<Record<ForestReaction, GestureKey[]>> = {
  awaken: [[.2,-.25,-.12,.3,.12],[.65,1,.45,-.35,1],[1,.65,.2,0,.55]],
  channel: [[.28,.7,.3,-.15,.65],[.7,.85,.2,0,.8],[1,.45,.1,0,.35]],
  flower: [[.36,.12,.3,.55,.4],[.7,0,.18,-.12,.3],[1,0,0,0,0]],
  bonus: [[.18,-.12,-.15,.35,.15],[.5,.5,1,-.4,1.1],[.8,.25,.5,-.1,.7],[1,0,0,0,0]],
  win: [[.18,-.12,-.12,.4,.12],[.48,.3,1,-.45,1],[.75,.12,.4,-.1,.6],[1,0,0,0,0]],
  big: [[.16,-.15,-.15,.4,.15],[.44,.75,1.35,-.6,1.3],[.73,.4,.6,-.15,.85],[1,0,0,0,0]],
};

const vertex = `
attribute vec2 aUv;
uniform float uTime;
uniform float uMotion;
uniform vec4 uGesture;
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
  float upper=1.-smoothstep(.52,.96,p.y);
  float arm=exp(-pow((aUv.x-.24)/.19,2.))*exp(-pow((aUv.y-.38)/.24,2.));
  float head=exp(-pow((aUv.x-.5)/.15,2.))*exp(-pow((aUv.y-.15)/.13,2.));
  // Feet stay anchored; the arm leads and hair trails the shoulder and head gesture.
  p.x+=uMotion*(-uGesture.x*.024*arm-uGesture.y*.005*upper);
  p.y+=uMotion*(-uGesture.y*.015*upper-uGesture.x*.018*arm+uGesture.z*.009*head);
  p.x+=uMotion*hair*.004*uGesture.y*sin(uTime*2.1+aUv.y*6.);
  gl_Position=vec4(p.x*2.-1.,1.-p.y*2.,0.,1.);
}`;
const fragment = `
precision mediump float;
${poses.map((_, i) => `uniform sampler2D uPose${i};`).join('\n')}
uniform sampler2D uEyes;
uniform vec4 uWeightsA;
uniform vec4 uWeightsB;
uniform float uBlink;
varying vec2 vUv;
void main(){
  vec4 color=vec4(0.);
  ${poses.map((_, i) => `if(uWeights${i < 4 ? 'A' : 'B'}[${i % 4}]>.00001)color+=texture2D(uPose${i},vUv)*uWeights${i < 4 ? 'A' : 'B'}[${i % 4}];`).join('\n')}
  // The blink changes a feathered eye region only. Clothes and hands never dissolve to a blink frame.
  float eyes=(1.-smoothstep(.052,.078,abs(vUv.x-.5)))*(1.-smoothstep(.018,.034,abs(vUv.y-.143)));
  gl_FragColor=mix(color,texture2D(uEyes,vUv),uBlink*eyes);
}`;

/** Owned presentation renderer. It has no transport, wallet, game entropy or outcome calculation. */
export class ForestCharacter {
  private canvas: HTMLCanvasElement;
  private video: ForestVideo;
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
  private fromWeights: number[] = poses.map(pose => pose === 'idle' ? 1 : 0);
  private pose: ForestPose = 'idle';
  private resting: ForestPose = 'idle';
  private nextBlink = 4600;
  private blinkAt = -Infinity;
  private blinkValue = 0;
  private blinkCount = 0;
  private frameCount = 0;
  private reaction?: ForestReaction;
  private gestureAt = 0;
  private gestureDuration = 0;
  private gestureKeys: GestureKey[] = [[0,0,0,0,0],[1,0,0,0,0]];
  private events: { pose: ForestPose; reaction: ForestReaction; atMs: number }[] = [];

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
    this.video = new ForestVideo(host);
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
      for (const name of ['uTime', 'uMotion', 'uGesture', 'uEyes', 'uWeightsA', 'uWeightsB', 'uBlink', ...poses.map((_, i) => 'uPose' + i)]) this.uniforms[name] = gl.getUniformLocation(program, name);
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
    const weights = this.weights();
    for (const [pose, image] of this.images) {
      image.style.opacity = String(pose === 'blink' ? 0 : weights[poses.indexOf(pose)]);
      image.classList.toggle('fh-blink-eyes', pose === 'blink');
      if (pose === 'blink') image.style.opacity = this.pose === 'idle' ? String(this.blinkValue) : '0';
    }
  }
  private draw() {
    if (!this.alive || !this.ready) return;
    const gesture = this.gesture();
    this.host.style.setProperty('--fh-character-light', String(this.reduced || this.paused ? 0 : gesture[3]));
    const gl = this.gl;
    this.video.suspend(this.paused || this.reduced || !gl || !this.program);
    this.video.update(this.pose, this.elapsed);
    if (!gl || !this.program) { this.fallback(); return; }
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.program);
    const bind = (pose: typeof FOREST_POSES[number], unit: number, uniform: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.textures.get(pose)!); gl.uniform1i(this.uniforms[uniform], unit);
    };
    poses.forEach((pose, i) => bind(pose, i, 'uPose' + i)); bind('blink', 7, 'uEyes');
    const t = this.transitionDuration ? Math.min(1, (this.elapsed - this.transitionAt) / this.transitionDuration) : 1;
    const weights = this.weights();
    gl.uniform4f(this.uniforms.uWeightsA, weights[0], weights[1], weights[2], weights[3]);
    gl.uniform4f(this.uniforms.uWeightsB, weights[4], weights[5], weights[6], 0);
    gl.uniform4fv(this.uniforms.uGesture, gesture);
    gl.uniform1f(this.uniforms.uTime, this.elapsed / 1000); gl.uniform1f(this.uniforms.uMotion, this.reduced || this.paused ? 0 : 1);
    gl.uniform1f(this.uniforms.uBlink, this.pose === 'idle' && t >= 1 ? this.blinkValue : 0);
    gl.drawElements(gl.TRIANGLES, 24 * 32 * 6, gl.UNSIGNED_SHORT, 0); this.frameCount++;
  }
  private setPose(pose: ForestPose, immediate = false) {
    if (pose === this.pose && !immediate) return;
    // Preserve the complete visible blend when a new event interrupts an unfinished transition.
    this.fromWeights = this.weights();
    this.pose = pose; this.host.dataset.pose = pose; this.blinkValue = 0; this.blinkAt = -Infinity;
    this.transitionAt = this.elapsed; this.transitionDuration = immediate || this.reduced || this.paused ? 0 : pose === 'idle' ? 640 : 420;
    this.fallback(); this.draw(); this.run();
  }
  rest(pose: ForestPose, immediate = false) {
    this.resting = pose;
    if (immediate) this.reset(pose, true);
    else if (this.holdUntil <= this.elapsed) this.setPose(pose);
  }
  private weights() {
    const blend = this.transitionDuration ? smooth((this.elapsed - this.transitionAt) / this.transitionDuration) : 1;
    return this.fromWeights.map((weight, i) => weight * (1 - blend) + (poses[i] === this.pose ? blend : 0));
  }
  private gesture() {
    if (!this.gestureDuration || this.reduced || this.paused) return [0,0,0,0];
    const t = Math.max(0, Math.min(1, (this.elapsed - this.gestureAt) / this.gestureDuration));
    const end = this.gestureKeys.findIndex((key, i) => i > 0 && key[0] >= t);
    const b = this.gestureKeys[end < 0 ? this.gestureKeys.length - 1 : end], a = this.gestureKeys[Math.max(0, end - 1)];
    const p = smooth((t - a[0]) / (b[0] - a[0] || 1));
    return a.slice(1).map((value, i) => value + (b[i + 1] - value) * p);
  }
  private finishGesture(immediate = false) {
    const current = this.gesture();
    this.reaction = undefined; delete this.host.dataset.reaction;
    this.gestureKeys = [[0,...current] as GestureKey,[1,0,0,0,0]];
    this.gestureAt = this.elapsed; this.gestureDuration = immediate ? 0 : 640;
  }
  reset(pose: ForestPose = 'idle', immediate = false) {
    this.holdUntil = 0; this.resting = pose; this.finishGesture(immediate); this.setPose(pose, immediate);
  }
  react(reaction: ForestReaction, holdMs: number) {
    if (!this.alive || this.paused) return;
    const pose = reaction === 'awaken' ? 'channel' : reaction;
    this.events.push({ pose, reaction, atMs: this.elapsed }); this.events = this.events.slice(-32);
    const repeatedFlower = reaction === 'flower' && this.reaction === reaction && this.holdUntil > this.elapsed;
    this.holdUntil = this.elapsed + (this.reduced ? 0 : holdMs);
    if (!repeatedFlower) {
      const current = this.gesture();
      this.gestureKeys = [[0,...current] as GestureKey, ...(gestures[reaction] ?? [[1,0,0,0,0] as GestureKey])];
      this.gestureAt = this.elapsed; this.gestureDuration = this.reduced ? 0 : holdMs;
      this.reaction = reaction; this.host.dataset.reaction = reaction;
    }
    this.setPose(pose);
  }
  mode(paused: boolean, reduced: boolean) {
    this.paused = paused; this.reduced = reduced;
    this.video.suspend(paused || reduced);
    if (paused || reduced) {
      this.stop(); this.holdUntil = 0; this.transitionDuration = 0; this.finishGesture(true); this.blinkValue = 0; this.blinkAt = -Infinity; this.draw();
    } else this.run();
  }
  private tick = (stamp: number) => {
    this.raf = 0;
    if (!this.alive || this.paused || this.reduced || this.host.ownerDocument.hidden) { this.last = 0; return; }
    if (this.last) this.elapsed += Math.min(80, stamp - this.last);
    this.last = stamp;
    if (this.holdUntil && this.elapsed >= this.holdUntil) { this.holdUntil = 0; this.finishGesture(); this.setPose(this.resting); }
    if (this.pose === 'idle') {
      if (this.elapsed >= this.nextBlink) { this.blinkAt = this.elapsed; this.blinkCount++; this.nextBlink = this.elapsed + [6800, 5400, 7900][(this.blinkCount - 1) % 3]; }
      const blink = this.elapsed - this.blinkAt;
      this.blinkValue = blink < 70 ? blink / 70 : blink < 115 ? 1 : blink < 235 ? 1 - (blink - 115) / 120 : 0;
    } else this.blinkValue = 0;
    const active = this.holdUntil > this.elapsed || this.elapsed - this.transitionAt < this.transitionDuration;
    if (stamp - this.paintedAt >= 1000 / (active ? 60 : 30) - 1) { this.draw(); this.paintedAt = stamp; }
    this.run();
  };
  private run() {
    if (!this.raf && this.alive && this.ready && !this.paused && !this.reduced && !this.host.ownerDocument.hidden)
      this.raf = this.host.ownerDocument.defaultView!.requestAnimationFrame(this.tick);
  }
  private stop() { this.host.ownerDocument.defaultView!.cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0; }
  state() { return { ready: this.ready, renderer: this.host.dataset.renderer, pose: this.pose, resting: this.resting, reaction: this.reaction ?? null, gesture:this.gesture(), weights:this.weights(), paused: this.paused, reduced: this.reduced, running: !!this.raf, elapsedMs: this.elapsed, frames: this.frameCount, renderSize:[this.canvas.width,this.canvas.height], blinks: this.blinkCount, blink: this.blinkValue, transition: this.transitionDuration ? Math.min(1, (this.elapsed - this.transitionAt) / this.transitionDuration) : 1, events: [...this.events], video: this.video.state() }; }
  private release() {
    const gl = this.gl; if (!gl) return;
    for (const texture of this.textures.values()) gl.deleteTexture(texture); this.textures.clear();
    if (this.vertices) gl.deleteBuffer(this.vertices); if (this.indices) gl.deleteBuffer(this.indices); if (this.program) gl.deleteProgram(this.program);
    this.gl = undefined; this.program = undefined;
  }
  destroy() { this.alive = false; this.stop(); this.video.destroy(); this.observer.disconnect(); this.controller.abort(); this.release(); this.images.clear(); }
}
