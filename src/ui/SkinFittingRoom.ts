import { drawGeneratedSkin, loadSkinSheet } from '../game/generatedSkinArt';
import { advanceCharacterMotion, characterRestScale, createCharacterMotion } from '../game/characterAnimation';
import { PLAYER_SPEED } from '../shared/world';
import { movementFacing, type Facing } from '../shared/movement';

const directions: Record<string, [number, number]> = {
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
};

/** Uses the game's skin renderer without equipping or moving the real player. */
export class SkinFittingRoom {
  readonly element = document.createElement('section');
  private canvas = document.createElement('canvas');
  private caption = document.createElement('p');
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
  private x = 320;
  private y = 200;
  private facing: Facing = 'down';
  private seated = false;

  constructor(private reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    this.element.className = 'skin-fitting-room'; this.element.hidden = true;
    const heading = document.createElement('h3'); heading.textContent = 'Примерочная';
    this.caption.className = 'skin-fitting-caption'; this.caption.setAttribute('role', 'status');
    const hint = document.createElement('p'); hint.id = 'skin-fitting-hint'; hint.className = 'skin-fitting-hint';
    hint.textContent = 'Нажми на пол, чтобы пройтись. Или используй WASD, стрелки и кнопки ниже.';
    this.canvas.tabIndex = 0; this.canvas.setAttribute('aria-label', 'Площадка для примерки скина');
    this.canvas.setAttribute('aria-describedby', hint.id);
    const controls = document.createElement('div'); controls.className = 'skin-fitting-controls';
    const pad = document.createElement('div'); pad.className = 'skin-fitting-pad'; pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', 'Движение в примерочной');
    for (const [key, symbol, label] of [['ArrowUp', '↑', 'Идти назад'], ['ArrowLeft', '←', 'Идти влево'], ['ArrowDown', '↓', 'Идти вперёд'], ['ArrowRight', '→', 'Идти вправо']]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = symbol;
      let pressedAt = 0;
      button.setAttribute('aria-label', label); button.dataset.direction = key;
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
    this.pose.type = 'button'; this.pose.className = 'skin-fitting-pose'; this.pose.textContent = 'Сесть';
    this.pose.setAttribute('aria-pressed', 'false');
    this.pose.onclick = () => {
      this.stopMotion(); this.seated = !this.seated; this.updatePose();
    };
    controls.append(pad, this.pose);
    this.element.append(heading, this.caption, this.canvas, hint, controls);
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

  setSkin(id: string, label: string) {
    this.element.hidden = !id;
    if (!id) { this.id = ''; this.loaded = false; this.setActive(false); return; }
    if (id === this.id) {
      if (this.loaded) this.caption.textContent = `${label}. Походи и посмотри со всех сторон.`;
      return;
    }
    this.id = id; this.loaded = false; this.stopMotion(); this.motion = createCharacterMotion(); this.stand(); this.facing = 'down';
    this.x = this.width / 2; this.y = 200; this.caption.textContent = `${label}: загружаем…`;
    this.element.querySelectorAll('button').forEach(button => { button.disabled = true; });
    void loadSkinSheet(id).then(() => {
      if (id !== this.id) return;
      this.loaded = true; this.caption.textContent = `${label}. Походи и посмотри со всех сторон.`;
      this.element.querySelectorAll('button').forEach(button => { button.disabled = false; });
    }).catch(() => {
      if (id === this.id) this.caption.textContent = 'Не удалось загрузить образ. Закрой и открой ателье, чтобы повторить.';
    });
  }

  setActive(active: boolean) {
    if (active === this.active) return;
    this.active = active; this.stopMotion(); this.previous = 0; this.motion = createCharacterMotion();
    cancelAnimationFrame(this.frame);
    if (active) this.frame = requestAnimationFrame(time => this.draw(time));
    else if (!this.loaded) this.id = '';
  }

  private stopMotion() { this.keys.clear(); this.pointer = undefined; this.target = undefined; }
  private stand() { this.seated = false; this.updatePose(); }
  private updatePose() { this.pose.textContent = this.seated ? 'Встать' : 'Сесть'; this.pose.setAttribute('aria-pressed', String(this.seated)); }
  private draw(time: number) {
    if (!this.active) return;
    const dt = this.previous ? Math.min((time - this.previous) / 1000, .05) : 0; this.previous = time;
    const width = this.canvas.clientWidth;
    if (width > 0 && width !== this.width) {
      this.x *= width / this.width;
      if (this.target) this.target[0] *= width / this.width;
      this.width = width;
    }
    const dpr = Math.min(devicePixelRatio || 1, 2), height = 280;
    if (this.canvas.width !== Math.round(this.width * dpr) || this.canvas.height !== height * dpr) {
      this.canvas.width = Math.round(this.width * dpr); this.canvas.height = height * dpr;
    }
    let dx = this.pointer?.[0] ?? 0, dy = this.pointer?.[1] ?? 0;
    for (const key of this.keys) { dx += directions[key][0]; dy += directions[key][1]; }
    if (this.target) {
      this.target = [Math.max(40, Math.min(this.width - 40, this.target[0])), Math.max(125, Math.min(255, this.target[1]))];
      dx = this.target[0] - this.x; dy = this.target[1] - this.y;
      if (Math.hypot(dx, dy) < 2) { dx = dy = 0; this.target = undefined; }
    }
    const distance = Math.hypot(dx, dy), beforeX = this.x, beforeY = this.y;
    if (distance && this.loaded && !document.hidden) {
      const step = Math.min(PLAYER_SPEED * dt, this.target ? distance : Infinity);
      this.x += dx / distance * step; this.y += dy / distance * step;
      this.facing = movementFacing(dx, dy, this.facing);
    }
    this.x = Math.max(40, Math.min(this.width - 40, this.x)); this.y = Math.max(125, Math.min(255, this.y));
    const travel = Math.hypot(this.x - beforeX, this.y - beforeY), moving = travel > .01;
    const motion = advanceCharacterMotion(this.motion, { mode: moving ? 'walk' : 'rest', distance: travel, time, normalSpeed: PLAYER_SPEED });
    const rest = characterRestScale(this.motion, time, 0, this.reducedMotion());
    const c = this.canvas.getContext('2d')!; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#d6c4aa'; c.fillRect(0, 0, this.width, height);
    c.fillStyle = '#f4e7d2'; c.fillRect(0, 0, this.width, 60);
    c.fillStyle = '#83674f'; c.fillRect(0, 58, this.width, 6);
    c.strokeStyle = '#bca58a'; c.lineWidth = 1;
    for (let y = 80; y < height; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(this.width, y); c.stroke(); }
    for (let x = -height; x < this.width + height; x += 80) { c.beginPath(); c.moveTo(x, 64); c.lineTo(x + 140, height); c.stroke(); }
    if (this.target) { c.strokeStyle = '#477d7c'; c.lineWidth = 2; c.beginPath(); c.ellipse(...this.target, 9, 4, 0, 0, Math.PI * 2); c.stroke(); }
    if (this.loaded) {
      c.fillStyle = '#59443530'; c.beginPath(); c.ellipse(this.x, this.y, 26 * rest.x, 7, 0, 0, Math.PI * 2); c.fill();
      c.save(); c.translate(this.x, this.y); c.scale(2.5 * rest.x, 2.5 * rest.y); c.translate(-16, -40);
      drawGeneratedSkin(c, this.id, this.facing, motion.frame, this.seated); c.restore();
    }
    this.canvas.dataset.facing = this.facing; this.canvas.dataset.moving = String(moving);
    this.frame = requestAnimationFrame(next => this.draw(next));
  }
}
