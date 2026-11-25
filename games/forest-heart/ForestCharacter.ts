import { forestIdleMotion } from './ForestIdleMotion';

export const FOREST_POSES = ['idle', 'choice', 'channel', 'flower', 'bonus', 'win', 'big'] as const;
export type ForestPose = typeof FOREST_POSES[number];
/** Everything she answers. Reactions without a pose of their own move the current one. */
export type ForestReaction = ForestPose | 'awaken' | 'land' | 'energy' | 'turn' | 'hold' | 'pulse' | 'partial' | 'loss';
const poses: ForestPose[] = [...FOREST_POSES];
const reactionPose: Partial<Record<ForestReaction, ForestPose>> = { awaken: 'channel', turn: 'channel', energy: 'bonus', partial: 'idle', loss: 'idle' };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = (value: number) => { const t = clamp(value); return t * t * t * (t * (t * 6 - 15) + 10); };
type GestureKey = [number, number, number, number, number];
// Time, reach, shoulder lift, head acknowledgement and light. These are local art curves, not game rules.
const gestures: Partial<Record<ForestReaction, GestureKey[]>> = {
  awaken: [[.2,-.25,-.12,.3,.12],[.65,1,.45,-.35,1],[1,.75,.25,-.1,.8]],
  land: [[.3,.95,.1,.35,.9],[.6,.35,-.1,.2,.4],[1,.5,.1,0,.45]],
  energy: [[.25,0,.5,.45,.6],[.55,.1,.9,.3,1.2],[1,0,.2,0,.4]],
  channel: [[.28,.7,.3,-.15,.65],[.7,.85,.2,0,.8],[1,.45,.1,0,.35]],
  turn: [[.2,-.3,-.1,.2,.2],[.55,1.1,.4,-.25,1.1],[1,.3,.1,0,.3]],
  flower: [[.36,.12,.3,.55,.4],[.7,0,.18,-.12,.3],[1,0,0,0,0]],
  pulse: [[.35,.35,.22,.4,.6],[1,0,0,0,.15]],
  hold: [[.3,.1,.3,.5,.7],[1,0,0,0,.2]],
  bonus: [[.18,-.12,-.15,.35,.15],[.5,.5,1,-.4,1.1],[.8,.25,.5,-.1,.7],[1,0,0,0,0]],
  win: [[.18,-.12,-.12,.4,.12],[.48,.3,1,-.45,1],[.75,.12,.4,-.1,.6],[1,0,0,0,0]],
  big: [[.12,-.15,-.15,.4,.15],[.3,.75,1.35,-.6,1.3],[.46,.2,.5,.1,.7],[.64,.75,1.2,-.5,1.2],[.82,.4,.6,-.1,.85],[1,0,0,0,0]],
  partial: [[.35,0,.15,.55,.12],[.7,0,.05,.2,.06],[1,0,0,0,0]],
  loss: [[.35,-.1,-.45,.75,0],[.7,-.05,-.4,.6,0],[1,0,0,0,0]],
};
/** Measured on v3 artwork: middle of the eyes, the acting hand and the crystal, as fractions of the picture. */
const eyes: Record<ForestPose, [number, number]> = { idle: [.503,.144], choice: [.503,.132], channel: [.501,.139], flower: [.505,.15], bonus: [.502,.16], win: [.495,.155], big: [.498,.129] };
const hands: Record<ForestPose, [number, number]> = { idle: [.27,.84], choice: [.165,.6], channel: [.32,.24], flower: [.355,.24], bonus: [.55,.34], win: [.55,.36], big: [.295,.23] };
const crystals: Record<ForestPose, [number, number]> = { idle: [.715,.64], choice: [.72,.6], channel: [.7,.6], flower: [.71,.62], bonus: [.55,.335], win: [.7,.67], big: [.705,.665] };
/** Room above the drawing, so a raised head never reaches the edge of the canvas. */
export const FOREST_HEADROOM = .04;
const blinkPause = [3400, 4700, 2900, 5300, 3900], blinkLength = 190;

const vertex = `
attribute vec2 aUv;
uniform float uTime;
uniform float uMotion;
uniform vec4 uGesture;
#define HEADROOM ${FOREST_HEADROOM.toFixed(3)}
${forestIdleMotion}
varying vec2 vUv;
void main(){
  vUv=aUv;
  vec2 p=aUv;
  p+=uMotion*forestIdleShift(aUv,uTime);
  float hair=smoothstep(.55,.77,aUv.x)*smoothstep(.14,.34,aUv.y)*(1.-smoothstep(.74,.99,aUv.y));
  float upper=1.-smoothstep(.52,.96,p.y);
  float arm=exp(-pow((aUv.x-.24)/.19,2.))*exp(-pow((aUv.y-.38)/.24,2.));
  float head=exp(-pow((aUv.x-.5)/.15,2.))*exp(-pow((aUv.y-.15)/.13,2.));
  // Feet stay anchored; the arm leads and hair trails the shoulder and head gesture.
  p.x+=(-uGesture.x*.024*arm-uGesture.y*.005*upper);
  p.y+=(-uGesture.y*.012*upper-uGesture.x*.018*arm+uGesture.z*.009*head);
  p.x+=hair*.004*uGesture.y*sin(uTime*2.1+aUv.y*6.);
  gl_Position=vec4(p.x*2.-1.,1.-(p.y+HEADROOM)/(1.+HEADROOM)*2.,0.,1.);
}`;
const fragment = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform sampler2D uLidsArt;
uniform float uProgress;
uniform float uLids;
uniform float uShimmer;
uniform vec2 uEyeFrom;
uniform vec2 uEyeTo;
uniform vec2 uOrigin;
uniform vec4 uAnchorsFrom;
uniform vec4 uAnchorsTo;
uniform vec2 uMagic;
uniform vec2 uSwirl;
uniform vec3 uRim;
varying vec2 vUv;
// The painted magic and the held crystal breathe and take the colour of the confirmed energy.
vec4 magic(vec4 art,vec2 uv,vec4 anchors,float swirl){
  if(art.a<.02)return art;
  vec3 c=art.rgb/art.a;
  float green=smoothstep(.06,.3,min(c.g,c.b*1.25)-c.r);
  vec2 k=vec2(.83,1.);
  float gem=1.-smoothstep(.06,.095,distance(uv*k,anchors.zw*k)),hand=swirl*(1.-smoothstep(.22,.36,distance(uv*k,(anchors.xy+vec2(0.,.08))*k)));
  float mask=green*max(gem,hand),level=max(c.g,max(c.r,c.b));
  vec3 tinted=mix(uRim,vec3(1.),smoothstep(.55,1.,c.r))*level*1.05;
  float wave=.5+.5*sin(uShimmer*5.2-distance(uv,anchors.xy)*26.),beat=.5+.5*sin(uShimmer*2.6);
  c=mix(c,mix(c,tinted,.82),mask*uMagic.y);
  // Light lifts the middle tones only, so a bright crystal keeps its facets.
  c+=c*(1.-c)*mask*uMagic.x*(hand*(1.-gem)*.5*wave+gem*.3*beat);
  return vec4(c*art.a,art.a);
}
void main(){
  // One head travels between both drawings, so two faces are never visible side by side.
  vec2 eye=mix(uEyeFrom,uEyeTo,smoothstep(0.,1.,uProgress));
  vec2 face=(vUv-eye)/vec2(.17,.16);
  float head=exp(-dot(face,face));
  vec4 from=texture2D(uFrom,vUv-head*(eye-uEyeFrom));
  vec4 to=texture2D(uTo,vUv-head*(eye-uEyeTo));
  if(uLids>.001){
    vec2 l=(vUv-vec2(.472,.156))/vec2(.034,.024),r=(vUv-vec2(.534,.135))/vec2(.034,.024);
    float eyesMask=clamp(exp(-dot(l,l))+exp(-dot(r,r)),0.,1.);
    from=mix(from,texture2D(uLidsArt,vUv),smoothstep(.25,.6,eyesMask)*uLids);
  }
  // Changed parts are woven in light from the acting hand. Equal parts stay equal during the whole change.
  float weave=.5+.25*sin(vUv.x*31.+vUv.y*23.)+.25*sin(vUv.x*53.-vUv.y*47.+1.7);
  float order=clamp(distance(vUv*vec2(.83,1.),uOrigin*vec2(.83,1.))*1.15,0.,1.)*.72+weave*.28;
  float soft=mix(.12,.3,head);
  order=mix(order,.45,smoothstep(.25,.7,head));
  float blend=smoothstep(order-soft,order+soft,uProgress*(1.+2.*soft)-soft);
  from=magic(from,vUv,uAnchorsFrom,step(.5,uSwirl.x));
  to=magic(to,vUv,uAnchorsTo,step(.5,uSwirl.y));
  vec4 color=mix(from,to,blend);
  float change=smoothstep(.1,.7,length(from.rgb-to.rgb)+abs(from.a-to.a));
  float rim=4.*blend*(1.-blend)*change*(1.-smoothstep(.2,.7,head));
  color.rgb+=uRim*rim*max(from.a,to.a)*(.5+.12*sin(uShimmer*23.+order*40.));
  gl_FragColor=color;
}`;

/** Owned presentation renderer. It has no transport, wallet, game entropy or outcome calculation. */
export class ForestCharacter {
  private canvas: HTMLCanvasElement;
  private images = new Map<ForestPose, HTMLImageElement>();
  private lidsArt: HTMLImageElement;
  private gl?: WebGLRenderingContext;
  private program?: WebGLProgram;
  private vertices?: WebGLBuffer;
  private indices?: WebGLBuffer;
  private textures = new Map<ForestPose | 'lids', WebGLTexture>();
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
  private queued?: ForestPose;
  private resting: ForestPose = 'idle';
  private frameCount = 0;
  private reaction?: ForestReaction;
  private gestureAt = 0;
  private gestureDuration = 0;
  private gestureKeys: GestureKey[] = [[0,0,0,0,0],[1,0,0,0,0]];
  private events: { pose: ForestPose; reaction: ForestReaction; atMs: number }[] = [];
  private blinkAt = blinkPause[0];
  private blinks = 0;
  private lowerFrom = -Infinity;
  private lowerUntil = -Infinity;
  private rim: [number, number, number] = [.39, .96, .82];
  private tinted = false;
  private sway = 0;

  constructor(private host: HTMLElement) {
    const document = host.ownerDocument;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fh-character-canvas'; this.canvas.width = 640; this.canvas.height = Math.round(768 * (1 + FOREST_HEADROOM));
    this.canvas.setAttribute('aria-hidden', 'true'); host.prepend(this.canvas);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    const loads = FOREST_POSES.map(pose => {
      const image = document.createElement('img');
      image.className = 'fh-elf'; image.alt = ''; image.draggable = false; image.dataset.pose = pose;
      image.src = `/assets/forest-heart/v3/elf-${pose}.webp`;
      this.images.set(pose, image); host.prepend(image);
      return image.decode().catch(() => {});
    });
    // Lids are optional: without them she simply does not blink.
    this.lidsArt = document.createElement('img'); this.lidsArt.src = '/assets/forest-heart/v3/elf-blink.webp';
    const lids = this.lidsArt.decode().catch(() => {});
    this.host.dataset.pose = 'idle'; this.host.dataset.renderer = 'loading';
    this.canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault(); this.stop(); this.gl = undefined; this.host.dataset.renderer = 'image'; this.fallback(); this.run();
    }, { signal: this.controller.signal });
    this.canvas.addEventListener('webglcontextrestored', () => { if (this.alive) { this.setup(); this.draw(); this.run(); } }, { signal: this.controller.signal });
    void Promise.all([...loads, lids]).then(() => {
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
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); this.textures.clear();
      const upload = (name: ForestPose | 'lids', image: HTMLImageElement) => {
        const texture = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); this.textures.set(name, texture);
      };
      for (const [pose, image] of this.images) upload(pose, image);
      if (this.lidsArt.complete && this.lidsArt.naturalWidth > 0) upload('lids', this.lidsArt);
      for (const name of ['uTime', 'uMotion', 'uGesture', 'uFrom', 'uTo', 'uLidsArt', 'uProgress', 'uLids', 'uShimmer', 'uEyeFrom', 'uEyeTo', 'uOrigin', 'uAnchorsFrom', 'uAnchorsTo', 'uMagic', 'uSwirl', 'uRim']) this.uniforms[name] = gl.getUniformLocation(program, name);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.host.dataset.renderer = 'webgl';
      this.resize();
    } catch { this.releaseGl(); this.host.dataset.renderer = 'image'; }
  }
  private resize() {
    if (!this.alive) return;
    const dpr = Math.min(1.5, this.host.ownerDocument.defaultView!.devicePixelRatio || 1);
    const height = Math.min(this.canvas.clientHeight, this.canvas.clientWidth * 768 / 640);
    const width = Math.max(128, Math.min(640, Math.round(height * dpr * 640 / 768)));
    if (width === this.canvas.width) return;
    this.canvas.width = width; this.canvas.height = Math.round(width * 768 / 640 * (1 + FOREST_HEADROOM));
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height); this.draw();
  }
  private fallback() {
    const weights = this.weights();
    for (const [pose, image] of this.images) image.style.opacity = String(weights[poses.indexOf(pose)]);
  }
  private get still() { return this.reduced || this.paused; }
  /** Closed lids belong to the calm drawing only: the other drawings have their own eyes. */
  private lids() {
    if (this.still || this.from !== 'idle' || this.pose !== 'idle') return 0;
    const since = this.elapsed - this.blinkAt, blink = since < 0 || since > blinkLength ? 0 : Math.sin(Math.PI * clamp(since / blinkLength)) ** .6;
    const lowered = smooth((this.elapsed - this.lowerFrom) / 240) * (1 - smooth((this.elapsed - this.lowerUntil) / 260));
    return Math.max(blink, lowered);
  }
  private draw() {
    if (!this.alive || !this.ready) return;
    const gesture = this.gesture();
    this.host.style.setProperty('--fh-character-light', String(this.still ? 0 : gesture[3]));
    const gl = this.gl;
    if (!gl || !this.program) { this.fallback(); return; }
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.program);
    const bind = (name: ForestPose | 'lids', unit: number, uniform: string) => {
      gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, this.textures.get(name) ?? this.textures.get('idle')!); gl.uniform1i(this.uniforms[uniform], unit);
    };
    bind(this.from, 0, 'uFrom'); bind(this.pose, 1, 'uTo'); bind('lids', 2, 'uLidsArt');
    gl.uniform1f(this.uniforms.uProgress, this.progress()); gl.uniform1f(this.uniforms.uLids, this.textures.has('lids') ? this.lids() : 0);
    gl.uniform2fv(this.uniforms.uEyeFrom, eyes[this.from]); gl.uniform2fv(this.uniforms.uEyeTo, eyes[this.pose]); gl.uniform2fv(this.uniforms.uOrigin, hands[this.pose === 'idle' ? this.from : this.pose]);
    const magic = (pose: ForestPose) => [...hands[pose], ...crystals[pose]], swirl = (pose: ForestPose) => Number(pose === 'channel' || pose === 'bonus');
    gl.uniform4fv(this.uniforms.uAnchorsFrom, magic(this.from)); gl.uniform4fv(this.uniforms.uAnchorsTo, magic(this.pose)); gl.uniform2f(this.uniforms.uSwirl, swirl(this.from), swirl(this.pose)); gl.uniform2f(this.uniforms.uMagic, this.still ? 0 : 1, this.tinted ? 1 : 0);
    gl.uniform3fv(this.uniforms.uRim, this.rim); gl.uniform4fv(this.uniforms.uGesture, gesture); gl.uniform1f(this.uniforms.uShimmer, this.elapsed / 1000);
    gl.uniform1f(this.uniforms.uTime, this.elapsed / 1000); gl.uniform1f(this.uniforms.uMotion, this.still ? 0 : .6);
    gl.drawElements(gl.TRIANGLES, 24 * 32 * 6, gl.UNSIGNED_SHORT, 0); this.frameCount++;
  }
  private get changing() { return !!this.transitionDuration && this.elapsed - this.transitionAt < this.transitionDuration; }
  private progress() { return this.transitionDuration ? smooth((this.elapsed - this.transitionAt) / this.transitionDuration) : 1; }
  /** A started change always finishes, then the newest requested pose follows. Two drawings are the most ever shown. */
  private setPose(pose: ForestPose, immediate = false) {
    if (immediate || this.still) { this.queued = undefined; this.from = this.pose = pose; this.transitionDuration = 0; }
    else if (this.changing) { this.queued = pose === this.pose ? undefined : pose; return; }
    else if (pose === this.pose) return;
    else { this.from = this.pose; this.pose = pose; this.transitionAt = this.elapsed; this.transitionDuration = pose === 'idle' ? 560 : 420; }
    this.host.dataset.pose = this.pose; this.fallback(); this.draw(); this.run();
  }
  rest(pose: ForestPose, immediate = false) {
    this.resting = pose;
    if (immediate) this.reset(pose, true);
    else if (this.holdUntil <= this.elapsed) this.setPose(pose);
  }
  private weights() {
    const blend = this.progress();
    return poses.map(pose => this.from === this.pose ? Number(pose === this.pose) : pose === this.pose ? blend : pose === this.from ? 1 - blend : 0);
  }
  private gestureBase() {
    if (!this.gestureDuration || this.still) return [0,0,0,0];
    const t = clamp((this.elapsed - this.gestureAt) / this.gestureDuration);
    const end = this.gestureKeys.findIndex((key, i) => i > 0 && key[0] >= t);
    const b = this.gestureKeys[end < 0 ? this.gestureKeys.length - 1 : end], a = this.gestureKeys[Math.max(0, end - 1)];
    const p = smooth((t - a[0]) / (b[0] - a[0] || 1));
    return a.slice(1).map((value, i) => value + (b[i + 1] - value) * p);
  }
  /** A long action keeps living: the arm guides, the shoulders follow and the light swells. */
  private gesture() {
    const result = this.gestureBase(), time = this.elapsed / 1000;
    result[0] += this.sway * .3 * Math.sin(time * 2.7); result[1] += this.sway * .2 * Math.sin(time * 2.7 + .9); result[2] += this.sway * .14 * Math.sin(time * 1.9); result[3] += this.sway * .12 * Math.sin(time * 3.4);
    return result;
  }
  private finishGesture(immediate = false) {
    const current = this.gestureBase();
    this.reaction = undefined; delete this.host.dataset.reaction;
    this.gestureKeys = [[0,...current] as GestureKey,[1,0,0,0,0]];
    this.gestureAt = this.elapsed; this.gestureDuration = immediate ? 0 : 640;
  }
  reset(pose: ForestPose = 'idle', immediate = false) {
    this.holdUntil = 0; this.resting = pose; this.lowerUntil = Math.min(this.lowerUntil, this.elapsed); this.finishGesture(immediate); this.setPose(pose, immediate);
  }
  /** Light of the woven change and of the hand. It follows the confirmed energy. */
  color(hex: string, tinted = false) { this.tinted = tinted; this.rim = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]; this.host.style.setProperty('--fh-character-color', this.rim.map(v => Math.round(v * 255)).join(',')); }
  /** holdMs Infinity keeps the action until the next reaction or release(). */
  react(reaction: ForestReaction, holdMs: number) {
    if (!this.alive || this.paused) return;
    const pose = reactionPose[reaction] ?? (poses.includes(reaction as ForestPose) ? reaction as ForestPose : undefined);
    this.events.push({ pose: pose ?? this.queued ?? this.pose, reaction, atMs: this.elapsed }); this.events = this.events.slice(-32);
    if (this.reduced) { if (pose) this.setPose(pose); return; }
    const current = this.gestureBase();
    this.gestureKeys = [[0,...current] as GestureKey, ...(gestures[reaction] ?? [[1,0,0,0,0] as GestureKey])]; this.gestureAt = this.elapsed;
    this.gestureDuration = Number.isFinite(holdMs) ? holdMs : 1000;
    this.reaction = reaction; this.host.dataset.reaction = reaction;
    // A small reaction moves the current action and never shortens it.
    const until = this.elapsed + holdMs; this.holdUntil = pose ? until : Math.max(this.holdUntil, until);
    if (reaction === 'loss') { this.lowerFrom = this.elapsed + (this.pose === 'idle' ? 160 : 620); this.lowerUntil = Math.max(this.lowerFrom + 380, this.elapsed + holdMs - 320); }
    if (pose) this.setPose(pose); else this.run();
  }
  /** Ends a sustained action when its event is over. */
  release() { if (this.holdUntil === Infinity) this.holdUntil = this.elapsed; }
  /** Keeps the shown celebration after its event. Infinity lasts until release(). */
  linger(holdMs: number) { if (!this.still && (this.pose === 'win' || this.pose === 'big' || this.queued === 'win' || this.queued === 'big')) { this.holdUntil = Math.max(this.holdUntil, this.elapsed + holdMs); this.run(); } }
  /** Fractions of the picture, for effects that start in her hand or crystal. */
  anchor(part: 'hand' | 'crystal') { return (part === 'hand' ? hands : crystals)[this.progress() > .5 ? this.pose : this.from]; }
  mode(paused: boolean, reduced: boolean) {
    this.paused = paused; this.reduced = reduced;
    if (paused || reduced) {
      this.stop(); this.holdUntil = 0; this.from = this.pose; this.queued = undefined; this.transitionDuration = 0; this.sway = 0; this.finishGesture(true); this.draw();
    } else this.run();
  }
  private tick = (stamp: number) => {
    this.raf = 0;
    if (!this.alive || this.still || this.host.ownerDocument.hidden) { this.last = 0; return; }
    if (this.last) this.elapsed += Math.min(80, stamp - this.last);
    this.sway += ((this.holdUntil === Infinity ? 1 : 0) - this.sway) * Math.min(1, Math.max(0, stamp - (this.last || stamp)) / 420);
    this.last = stamp;
    if (this.transitionDuration && !this.changing) {
      this.transitionDuration = 0; this.from = this.pose;
      if (this.queued) { const next = this.queued; this.queued = undefined; this.setPose(next); }
    }
    if (this.holdUntil && this.elapsed >= this.holdUntil) { this.holdUntil = 0; this.finishGesture(); this.setPose(this.resting); }
    if (this.elapsed > this.blinkAt + blinkLength) { if (this.pose === 'idle' && this.from === 'idle') this.blinks++; this.blinkAt = this.elapsed + blinkPause[this.blinks % blinkPause.length]; }
    const active = this.holdUntil > this.elapsed || this.changing || this.lids() > 0 || this.gestureDuration > this.elapsed - this.gestureAt || this.elapsed >= this.blinkAt - 40;
    if (stamp - this.paintedAt >= 1000 / (active ? 60 : 30) - 1) { this.draw(); this.paintedAt = stamp; }
    this.run();
  };
  private run() {
    if (!this.raf && this.alive && this.ready && !this.still && !this.host.ownerDocument.hidden)
      this.raf = this.host.ownerDocument.defaultView!.requestAnimationFrame(this.tick);
  }
  private stop() { this.host.ownerDocument.defaultView?.cancelAnimationFrame(this.raf); this.raf = 0; this.last = 0; }
  state() { return { ready: this.ready, renderer: this.host.dataset.renderer, pose: this.pose, resting: this.resting, queued: this.queued ?? null, reaction: this.reaction ?? null, gesture: this.gesture(), weights: this.weights(), paused: this.paused, reduced: this.reduced, running: !!this.raf, elapsedMs: this.elapsed, frames: this.frameCount, renderSize: [this.canvas.width, this.canvas.height], blinks: this.blinks, lids: this.lids(), transition: this.progress(), events: [...this.events] }; }
  private releaseGl() {
    const gl = this.gl; if (!gl) return;
    for (const texture of this.textures.values()) gl.deleteTexture(texture); this.textures.clear();
    if (this.vertices) gl.deleteBuffer(this.vertices); if (this.indices) gl.deleteBuffer(this.indices); if (this.program) gl.deleteProgram(this.program);
    this.gl = undefined; this.program = undefined;
  }
  destroy() { this.alive = false; this.stop(); this.observer.disconnect(); this.controller.abort(); this.releaseGl(); this.images.clear(); }
}
