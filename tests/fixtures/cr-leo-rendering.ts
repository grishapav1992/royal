import { CrLeoScene } from '../../src/ui/CrLeoScene';
import { drawFootball } from '../../src/ui/crLeoBall';
import { penaltyZone, type PenaltyHero, type PenaltyRisk, type PenaltyShot } from '../../src/shared/crLeo';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const scene = new CrLeoScene(canvas, () => {});
const hero = document.querySelector<HTMLSelectElement>('#hero')!;
const risk = document.querySelector<HTMLSelectElement>('#risk')!;
const time = document.querySelector<HTMLInputElement>('#time')!;
const speed = document.querySelector<HTMLSelectElement>('#speed')!;
let started = 0, playing = false;
type Frame = { hero: PenaltyHero; risk: PenaltyRisk; t: number; zone?: number; finish?: PenaltyShot['finish'] };
function render(frame: Frame) {
  const finish = frame.finish ?? 'goal', zone = frame.zone ?? 7;
  scene.select(frame.hero, frame.risk);
  scene.show({ version: 2, hero: frame.hero, risk: frame.risk, revision: 1,
    shots: [{ index: 0, goal: finish === 'goal', finish, side: penaltyZone(zone).side, risk: frame.risk, zone }],
    status: finish === 'goal' ? 'playing' : 'lost', availableUnits: '0' }, true);
  const now = performance.now();
  scene.paint(now - scene.state(now).t * 1000 + frame.t * 1000);
  return { ...canvas.dataset };
}
function controls() {
  document.querySelector('#elapsed')!.textContent = Number(time.value).toFixed(2) + ' s';
  render({ hero: hero.value as PenaltyHero, risk: risk.value as PenaltyRisk, t: Number(time.value) });
}
for (const input of [hero, risk, time, speed]) input.addEventListener('input', () => { playing = false; controls(); });
document.querySelector('#play')!.addEventListener('click', () => { started = performance.now(); playing = true; });
function tick() {
  if (playing) { time.value = String(Math.min(3.2, (performance.now() - started) / 1000 * Number(speed.value))); controls(); if (Number(time.value) >= 3.2) playing = false; }
  else if (scene.ready() && !canvas.dataset.renderedFrames) controls();
  requestAnimationFrame(tick);
}
tick();
(window as any).crLeoRendering = { scene, render, ready: () => scene.ready(),
  drawFootball: (c: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation: number, alpha = 1) =>
    drawFootball(c, (scene as any).frames.get('ball'), x, y, radius, rotation, alpha) };
