import { CrLeoScene } from '../../src/ui/CrLeoScene';
import { drawFootball } from '../../src/ui/crLeoBall';
import { CrLeoAudio } from '../../src/ui/CrLeoAudio';
import { gameAudio } from '../../src/game/GameAudio';
import { drawGoalFrame, drawGoalNet, goalNetPoint, goalBallPosition, NET_TRAVEL, NET_SETTLE } from '../../src/ui/crLeoGoal';
import { penaltyZone, type PenaltyHero, type PenaltyRisk, type PenaltyShot } from '../../src/shared/crLeo';

const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const audio = new CrLeoAudio();
let audiblePaint = false, selectedHero: PenaltyHero = 'cr';
const scene = new CrLeoScene(canvas, event => { if (audiblePaint && !document.hidden) audio.event(event, selectedHero); });
const hero = document.querySelector<HTMLSelectElement>('#hero')!;
const risk = document.querySelector<HTMLSelectElement>('#risk')!;
const time = document.querySelector<HTMLInputElement>('#time')!;
const speed = document.querySelector<HTMLSelectElement>('#speed')!;
const finishSelect = document.querySelector<HTMLSelectElement>('#finish')!;
const seriesSelect = document.querySelector<HTMLSelectElement>('#series')!;
const sound = document.querySelector<HTMLButtonElement>('#sound')!;
const zoneSelect = document.querySelector<HTMLSelectElement>('#zone')!;
zoneSelect.innerHTML = Array.from({ length: 18 }, (_, id) => { const z = penaltyZone(id); return `<option value="${id}">${['Верх','Середина','Низ'][z.row]} · ${z.column + 1}</option>`; }).join(''); zoneSelect.value = '7';
let started = 0, playing = false, soundStarted = false;
type Frame = { hero: PenaltyHero; risk: PenaltyRisk; t: number; zone?: number; finish?: PenaltyShot['finish']; complete?: boolean; goals?: number; banked?: boolean; restored?: boolean; previousRisks?: PenaltyRisk[] };
function begin(frame: Frame) {
  const finish = frame.finish ?? 'goal', zone = frame.zone ?? 7;
  const count = frame.complete ? 5 : frame.goals ?? 1;
  const shots: PenaltyShot[] = Array.from({ length: count }, (_, index) => ({ index, goal: index < count - 1 || finish === 'goal', finish: index < count - 1 ? 'goal' : finish, side: penaltyZone(zone).side, risk: frame.previousRisks?.[index] ?? frame.risk, zone }));
  shots[count - 1].risk = frame.risk;
  selectedHero = frame.hero;
  scene.select(frame.hero, frame.risk);
  scene.show({ version: 2, hero: frame.hero, risk: frame.risk, revision: count + Number(!!frame.banked), shots,
    status: finish === 'goal' ? frame.complete ? 'complete' : frame.banked ? 'banked' : 'playing' : 'lost', availableUnits: '0' }, !frame.restored, frame.banked);
}
function advance(t: number, audible = false) {
  const now = performance.now();
  audiblePaint = audible;
  try { scene.paint(now - scene.state(now).t * 1000 + t * 1000); } finally { audiblePaint = false; }
  return { ...canvas.dataset };
}
function render(frame: Frame) { begin(frame); return advance(frame.t); }
function controls() {
  time.max = seriesSelect.value === 'complete' ? '8' : '4.6';
  if (Number(time.value) > Number(time.max)) time.value = time.max;
  document.querySelector('#elapsed')!.textContent = Number(time.value).toFixed(2) + ' s';
  render({ hero: hero.value as PenaltyHero, risk: risk.value as PenaltyRisk, t: Number(time.value), finish: finishSelect.value as PenaltyShot['finish'], zone: Number(zoneSelect.value), complete: seriesSelect.value === 'complete' });
}
for (const input of [hero, risk, time, speed, finishSelect, zoneSelect, seriesSelect]) input.addEventListener('input', () => { playing = false; audio.silence(); if (soundStarted && audio.enabled) void audio.unlock(); controls(); });
sound.addEventListener('click', () => {
  if (!soundStarted) { soundStarted = true; if (!audio.enabled) audio.toggle(); else void audio.unlock(); }
  else audio.toggle();
  sound.textContent = audio.enabled ? 'Звук ON' : 'Звук OFF';
});
document.querySelector('#play')!.addEventListener('click', () => {
  if (soundStarted && audio.enabled) void audio.unlock();
  begin({ hero: hero.value as PenaltyHero, risk: risk.value as PenaltyRisk, t: 0, finish: finishSelect.value as PenaltyShot['finish'], zone: Number(zoneSelect.value), complete: seriesSelect.value === 'complete' });
  started = performance.now(); playing = true;
});
function tick() {
  if (playing) {
    time.value = String(Math.min(Number(time.max), (performance.now() - started) / 1000 * Number(speed.value)));
    document.querySelector('#elapsed')!.textContent = Number(time.value).toFixed(2) + ' s';
    advance(Number(time.value), soundStarted && audio.enabled); if (Number(time.value) >= Number(time.max)) playing = false;
  }
  else if (scene.ready() && !canvas.dataset.renderedFrames) controls();
  requestAnimationFrame(tick);
}
tick();
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.silence(); else { scene.skipPastSounds(); if (soundStarted && audio.enabled) void audio.unlock(); } });
window.addEventListener('pagehide', () => { audio.destroy(); scene.destroy(); });
(window as any).crLeoRendering = { scene, audio, Audio: CrLeoAudio, gameAudio, begin, advance, render, ready: () => scene.ready(),
  drawGoalFrame, drawGoalNet, goalNetPoint, goalBallPosition, NET_TRAVEL, NET_SETTLE,
  drawFootball: (c: CanvasRenderingContext2D, x: number, y: number, radius: number, rotation: number, alpha = 1) =>
    drawFootball(c, (scene as any).frames.get('ball'), x, y, radius, rotation, alpha) };
