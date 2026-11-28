import { drawGeneratedSkin, loadSkinSheet } from '../game/generatedSkinArt';
import { advanceCharacterMotion, characterRestScale, createCharacterMotion } from '../game/characterAnimation';
import { ATELIER_EMPTY_SPRITE, TAILOR_SPRITE } from '../game/TailorRenderer';
import { PLAYER_SPEED } from '../shared/world';
import { movementFacing, type Facing } from '../shared/movement';
import { t } from '../i18n/index';

const directions: Record<string, [number, number]> = {
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
};

/** The fitting room stands in front of the seller: the atelier booth or Zhora's tiled corner. */
export type FittingScene = 'atelier' | 'janitor';
/** Decorative tailor state. It never reflects payment progress beyond what the order panel already shows. */
export type TailorMood = 'idle' | 'working' | 'greet';

const booth = new Image(), tailor = new Image();
booth.decoding = tailor.decoding = 'async';
const loadArt = () => { if (!booth.src) { booth.src = ATELIER_EMPTY_SPRITE; tailor.src = TAILOR_SPRITE; } };
const ready = (image: HTMLImageElement) => image.complete && image.naturalWidth > 0;
// Same frame alignment as the tailor in the hall (TailorRenderer).
const poseBottom = [303, 303, 305, 305, 300, 298, 292, 301];
const workFrames = [5, 0, 6, 0, 3, 0];

/** Uses the game's skin renderer without equipping or moving the real player. */
export class SkinFittingRoom {
  readonly element = document.createElement('section');
  private canvas = document.createElement('canvas');
  private caption = document.createElement('strong');
  private pose = document.createElement('button');
  private keys = new Set<string>();
  private pointer?: [number, number];
  private target?: [number, number];
  private id = '';
  private loaded = false;
  private active = false;
  private frame = 0;
  private previous = 0;
  private motion = createCharacterMotion();
  private width = 640;
  private height = 440;
  private x = 320;
  private y = 400;
  private facing: Facing = 'down';
  private seated = false;
  private kind: FittingScene = 'atelier';
  private mood: TailorMood = 'idle';
  private moodSince = 0;
  private clock = 0;
  private placed = false;

  constructor(private reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    this.element.className = 'skin-fitting-room'; this.element.dataset.scene = this.kind;
    this.caption.className = 'skin-fitting-caption'; this.caption.setAttribute('role', 'status');
    const hint = document.createElement('span'); hint.id = 'skin-fitting-hint'; hint.className = 'skin-fitting-hint';
    hint.textContent = t('Нажми на пол или используй WASD, стрелки и кнопки, чтобы пройтись.');
    this.canvas.tabIndex = 0; this.canvas.setAttribute('aria-label', t('Площадка для примерки скина'));
    this.canvas.setAttribute('aria-describedby', hint.id);
    const text = document.createElement('div'); text.className = 'skin-fitting-text'; text.append(this.caption, hint);
    const controls = document.createElement('div'); controls.className = 'skin-fitting-controls';
    const pad = document.createElement('div'); pad.className = 'skin-fitting-pad'; pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', t('Движение в примерочной'));
    for (const [key, symbol, label] of [['ArrowUp', '↑', 'Идти назад'], ['ArrowLeft', '←', 'Идти влево'], ['ArrowDown', '↓', 'Идти вперёд'], ['ArrowRight', '→', 'Идти вправо']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol;
      let pressedAt = 0;
      button.setAttribute('aria-label', t(label)); button.dataset.direction = key;
      button.onpointerdown = event => {
        if (!this.loaded) return;
        pressedAt = performance.now();
        button.setPointerCapture(event.pointerId); this.pointer = directions[key]; this.target = undefined; this.stand();
      };
      button.onlostpointercapture = button.onpointerup = button.onpointercancel = () => { this.pointer = undefined; };
      button.onclick = event => {
        if (!this.loaded || (event.detail && performance.now() - pressedAt > 180)) return;
        this.stand(); this.target = [this.x + directions[key][0] * 60, this.y + directions[key][1] * 60];
      };
      pad.append(button);
    }
    this.pose.type = 'button'; this.pose.className = 'skin-fitting-pose'; this.pose.textContent = t('Сесть');
    this.pose.setAttribute('aria-pressed', 'false');
    this.pose.onclick = () => {
      this.stopMotion(); this.seated = !this.seated; this.updatePose();
    };
    controls.append(pad, this.pose);
    const stage = document.createElement('div'); stage.className = 'skin-fitting-stage'; stage.append(this.canvas);
    const bar = document.createElement('div'); bar.className = 'skin-fitting-bar'; bar.append(text, controls);
    this.element.append(stage, bar);
    this.setButtons(false);
    this.caption.textContent = t('Здесь можно примерить образ');
    this.canvas.onpointerdown = event => {
      if (!this.loaded) return;
      const box = this.canvas.getBoundingClientRect();
      this.target = [event.clientX - box.left, event.clientY - box.top]; this.stand();
      this.canvas.focus({ preventScroll: true });
    };
    this.element.addEventListener('keydown', event => {
      if (!directions[event.code] || !this.loaded) return;
      event.preventDefault(); event.stopPropagation(); this.keys.add(event.code); this.target = undefined; this.stand();
    });
    this.element.addEventListener('keyup', event => {
      if (!directions[event.code]) return;
      event.preventDefault(); event.stopPropagation(); this.keys.delete(event.code);
    });
    this.element.addEventListener('focusout', event => {
      if (!this.element.contains(event.relatedTarget as Node | null)) this.stopMotion();
    });
    window.addEventListener('blur', () => this.stopMotion());
    document.addEventListener('visibilitychange', () => { this.stopMotion(); this.previous = 0; });
  }

  /** The seller's corner behind the player. Switching shops keeps the tried skin. */
  setScene(kind: FittingScene) { this.kind = kind; this.element.dataset.scene = kind; }

  /** Greeting or working poses for the tailor. Ignored in Zhora's corner. */
  setMood(mood: TailorMood) {
    if (mood === this.mood) return;
    this.mood = mood; this.moodSince = this.clock; this.element.dataset.tailor = mood;
  }

  setSkin(id: string, label: string, empty = t('Здесь можно примерить образ')) {
    if (!id) {
      this.id = ''; this.loaded = false; this.stopMotion(); this.setButtons(false);
      this.caption.textContent = empty; return;
    }
    if (id === this.id) {
      if (this.loaded) this.caption.textContent = t('Примеряешь: ') + label;
      return;
    }
    this.id = id; this.loaded = false; this.stopMotion(); this.motion = createCharacterMotion(); this.stand(); this.facing = 'down';
    this.placed = false; this.caption.textContent = label + t(': загружаем…');
    this.setButtons(false);
    void loadSkinSheet(id).then(() => {
      if (id !== this.id) return;
      this.loaded = true; this.caption.textContent = t('Примеряешь: ') + label;
      this.setButtons(true);
    }).catch(() => {
      if (id === this.id) this.caption.textContent = t('Не удалось загрузить образ. Закрой и открой окно, чтобы повторить.');
    });
  }

  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active; this.stopMotion(); this.previous = 0; this.motion = createCharacterMotion();
    cancelAnimationFrame(this.frame);
    if (active) { loadArt(); this.frame = requestAnimationFrame(time => this.draw(time)); }
  }

  private setButtons(enabled: boolean) { this.element.querySelectorAll('button').forEach(button => { button.disabled = !enabled; }); }
  private stopMotion() { this.keys.clear(); this.pointer = undefined; this.target = undefined; }
  private stand() { this.seated = false; this.updatePose(); }
  private updatePose() { this.pose.textContent = t(this.seated ? 'Встать' : 'Сесть'); this.pose.setAttribute('aria-pressed', String(this.seated)); }

  /** Booth box and the floor in front of it, recomputed for every canvas size. */
  private layout() {
    const width = this.width, height = this.height, aspect = 1188 / 829;
    const boothHeight = Math.min(width / aspect, height * .72), boothWidth = boothHeight * aspect;
    const box = { x: (width - boothWidth) / 2, y: 0, w: boothWidth, h: boothHeight };
    const floorTop = this.kind === 'atelier' ? box.h * .97 : height * .32;
    const scale = Math.max(2.1, Math.min(3.4, height / 160));
    return { box, floorTop, scale, minY: floorTop + 12, maxY: height - 10 };
  }

  private drawBackdrop(c: CanvasRenderingContext2D, view: ReturnType<SkinFittingRoom['layout']>, time: number) {
    const { width, height } = this, { box, floorTop } = view;
    if (this.kind === 'janitor') {
      c.fillStyle = '#c9d4d4'; c.fillRect(0, 0, width, floorTop);
      c.strokeStyle = '#aebcbc'; c.lineWidth = 1;
      for (let y = 22; y < floorTop; y += 22) { c.beginPath(); c.moveTo(0, y); c.lineTo(width, y); c.stroke(); }
      for (let x = 0; x < width; x += 22) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, floorTop); c.stroke(); }
      c.fillStyle = '#7f8c8a'; c.fillRect(0, floorTop - 6, width, 6);
      c.fillStyle = '#9aa5a0'; c.fillRect(0, floorTop, width, height - floorTop);
      c.strokeStyle = '#8a9490';
      for (let x = -height; x < width + height; x += 64) { c.beginPath(); c.moveTo(x, floorTop); c.lineTo(x + 90, height); c.stroke(); }
      return;
    }
    c.fillStyle = '#2d1a12'; c.fillRect(0, 0, width, floorTop);
    // Parquet in front of the counter, lit from the booth.
    c.fillStyle = '#7d5135'; c.fillRect(0, floorTop, width, height - floorTop);
    c.fillStyle = '#6a4329';
    for (let x = (width / 2) % 68; x < width; x += 68) c.fillRect(x, floorTop, 2, height - floorTop);
    for (let y = floorTop + 34; y < height; y += 34) c.fillRect(0, y, width, 1);
    const glow = c.createLinearGradient(0, floorTop, 0, height);
    glow.addColorStop(0, '#00000066'); glow.addColorStop(.25, '#00000000'); glow.addColorStop(1, '#0000002a');
    c.fillStyle = glow; c.fillRect(0, floorTop, width, height - floorTop);
    if (!ready(booth)) return;
    c.drawImage(booth, box.x, box.y, box.w, box.h);
    if (ready(tailor)) {
      const frame = this.tailorFrame(time);
      const w = box.w * .224, h = box.h * .442;
      const align = frame === 4 ? 0 : Math.max(0, 303 - poseBottom[frame]) * h / 384;
      const breath = this.reducedMotion() ? 0 : Math.sin(time * .0022) * .6;
      c.drawImage(tailor, frame % 4 * 256, Math.floor(frame / 4) * 384, 256, 384,
        box.x + box.w * .47 - w / 2, box.y + box.h * .406 + align + breath, w, h);
    }
    // The counter is a crop of the same plate, so the tailor's waist stays hidden behind it.
    const top = booth.naturalHeight * .748;
    c.drawImage(booth, 0, top, booth.naturalWidth, booth.naturalHeight - top, box.x, box.y + box.h * .748, box.w, box.h * .252);
  }

  private tailorFrame(time: number) {
    if (this.reducedMotion()) return 0;
    const since = time - this.moodSince;
    if (this.mood === 'greet' && since < 1400) return 1;
    if (this.mood === 'working') return workFrames[Math.floor(since / 900) % workFrames.length];
    return time % 3900 < 150 ? 4 : 0;
  }

  private draw(time: number) {
    if (!this.active) return;
    // A frame clock that jumps backwards must never walk the figure the other way.
    const dt = this.previous ? Math.max(0, Math.min((time - this.previous) / 1000, .05)) : 0; this.previous = time; this.clock = time;
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (width > 0 && height > 0 && (width !== this.width || height !== this.height)) {
      this.x *= width / this.width;
      if (this.target) this.target[0] *= width / this.width;
      this.width = width; this.height = height;
    }
    const view = this.layout();
    if (!this.placed) { this.x = this.width / 2; this.y = view.maxY - 8; this.placed = true; }
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(this.width * dpr) || this.canvas.height !== Math.round(this.height * dpr)) {
      this.canvas.width = Math.round(this.width * dpr); this.canvas.height = Math.round(this.height * dpr);
    }
    let dx = this.pointer?.[0] ?? 0, dy = this.pointer?.[1] ?? 0;
    for (const key of this.keys) { dx += directions[key][0]; dy += directions[key][1]; }
    const clampX = (value: number) => Math.max(40, Math.min(this.width - 40, value));
    const clampY = (value: number) => Math.max(view.minY, Math.min(view.maxY, value));
    if (this.target) {
      this.target = [clampX(this.target[0]), clampY(this.target[1])];
      dx = this.target[0] - this.x; dy = this.target[1] - this.y;
      if (Math.hypot(dx, dy) < 2) { dx = dy = 0; this.target = undefined; }
    }
    const distance = Math.hypot(dx, dy), beforeX = this.x, beforeY = this.y;
    if (distance && this.loaded && !document.hidden) {
      const step = Math.min(PLAYER_SPEED * dt, this.target ? distance : Infinity);
      this.x += dx / distance * step; this.y += dy / distance * step;
      this.facing = movementFacing(dx, dy, this.facing);
    }
    this.x = clampX(this.x); this.y = clampY(this.y);
    const travel = Math.hypot(this.x - beforeX, this.y - beforeY), moving = travel > .01;
    const motion = advanceCharacterMotion(this.motion, { mode: moving ? 'walk' : 'rest', distance: travel, time, normalSpeed: PLAYER_SPEED });
    const rest = characterRestScale(this.motion, time, 0, this.reducedMotion());
    const c = this.canvas.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop(c, view, time);
    if (this.target) { c.strokeStyle = '#8fd6cf'; c.lineWidth = 2; c.beginPath(); c.ellipse(...this.target, 12, 5, 0, 0, Math.PI * 2); c.stroke(); }
    if (this.loaded) {
      const s = view.scale;
      c.fillStyle = '#0000003a'; c.beginPath(); c.ellipse(this.x, this.y, 10 * s * rest.x, 3 * s, 0, 0, Math.PI * 2); c.fill();
      c.save(); c.translate(this.x, this.y); c.scale(s * rest.x, s * rest.y); c.translate(-16, -40);
      drawGeneratedSkin(c, this.id, this.facing, motion.frame, this.seated); c.restore();
    }
    this.canvas.dataset.facing = this.facing; this.canvas.dataset.moving = String(moving);
    this.canvas.dataset.floorTop = String(Math.round(view.floorTop * dpr));
    this.frame = requestAnimationFrame(next => this.draw(next));
  }
}
