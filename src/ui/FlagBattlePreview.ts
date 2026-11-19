import { FlagPhysics } from '../../games/flag-battle/FlagPhysics';
import { flagCountries } from '../shared/flagBattle';

const seeds = [48, 587, 2049, 9001];
const timeScale = 4.2;
const winnerSeconds = 1.1;
const refillSeconds = .78;
const tau = Math.PI * 2;

function ease(progress: number) {
  const value = Math.max(0, Math.min(1, progress));
  return value * value * (3 - 2 * value);
}

export function createFlagBattlePreview(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const c = context;
  const countries = flagCountries();
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const radius = canvas.height * .405;
  const backdrop = c.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.28);
  backdrop.addColorStop(0, '#164144');
  backdrop.addColorStop(.77, '#102d34');
  backdrop.addColorStop(1, '#0c222b');

  let images: HTMLImageElement[] | undefined;
  let ready = false;
  let playing = false;
  let frame: number | undefined;
  let previous: number | undefined;
  let round = 1;
  let world = new FlagPhysics(seeds[0]);
  let phase: 'battle' | 'winner' | 'refill' = 'battle';
  let phaseTime = 0;
  let champion = 0;

  function setPhase(next: typeof phase) {
    phase = next;
    phaseTime = 0;
    canvas.dataset.phase = phase;
  }

  function drawBall(id: number, x: number, y: number, scale: number, opacity = 1, gold = false) {
    const size = world.radius * radius * scale;
    c.save();
    c.globalAlpha = opacity;
    c.shadowColor = '#04131b';
    c.shadowBlur = 7;
    c.fillStyle = gold ? '#f1cf7c' : '#f4efda';
    c.beginPath();
    c.arc(x, y, size + (gold ? 2.7 : 1.2), 0, tau);
    c.fill();
    c.shadowBlur = 0;
    c.beginPath();
    c.arc(x, y, size, 0, tau);
    c.clip();
    const image = images![id];
    if (image.naturalWidth) c.drawImage(image, x - size * 1.5, y - size, size * 3, size * 2);
    c.restore();
  }

  function paint() {
    c.fillStyle = backdrop;
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = '#5a827d80';
    for (let i = 0; i < 48; i++) {
      const angle = i / 48 * tau;
      c.beginPath();
      c.arc(cx + Math.cos(angle) * radius * 1.12, cy + Math.sin(angle) * radius * 1.12, 1.2, 0, tau);
      c.fill();
    }
    c.strokeStyle = '#638a813f';
    c.lineWidth = 1;
    for (const fraction of [.2, .55]) {
      c.beginPath();
      c.arc(cx, cy, radius * fraction, 0, tau);
      c.stroke();
    }

    const winnerEase = phase === 'winner' ? ease(phaseTime / .48) : 0;
    const halfGap = phase === 'refill' ? 0 : world.halfGap * (1 - winnerEase);
    c.lineWidth = 3.8;
    c.lineCap = 'round';
    c.strokeStyle = '#d9f3e3';
    c.shadowColor = '#77d9b57f';
    c.shadowBlur = 16;
    c.beginPath();
    c.arc(cx, cy, radius, world.gap + halfGap, world.gap + tau - halfGap);
    c.stroke();
    c.shadowBlur = 0;
    if (halfGap > .02) {
      c.strokeStyle = '#f39373';
      c.lineWidth = 2.1;
      c.beginPath();
      c.arc(cx, cy, radius * 1.055, world.gap - halfGap, world.gap + halfGap);
      c.stroke();
    }

    const refill = phase === 'refill' ? ease(phaseTime / refillSeconds) : 1;
    for (const body of world.bodies) {
      if (phase === 'refill') {
        const isChampion = body.id === champion;
        const spread = isChampion ? refill : .55 + .45 * refill;
        drawBall(body.id, cx + body.x * radius * spread, cy + body.y * radius * spread,
          isChampion ? 1 + 1.7 * (1 - refill) : .7 + .3 * refill, isChampion ? 1 : refill,
          isChampion && refill < .6);
        continue;
      }

      const escapeTime = body.escapedAt === null ? 0 : world.time - body.escapedAt;
      const tail = phase === 'winner' ? phaseTime * timeScale : 0;
      const age = body.escapedAt === null ? 0 : escapeTime + tail;
      if (age >= .95) continue;
      const alpha = world.finished ? 1 : world.interpolation;
      let x = body.previousX + (body.x - body.previousX) * alpha;
      let y = body.previousY + (body.y - body.previousY) * alpha;
      if (body.escapedAt !== null) {
        x += body.vx * tail;
        y += body.vy * tail;
      }
      const isChampion = phase === 'winner' && body.id === champion;
      const spread = isChampion ? 1 - winnerEase : 1;
      drawBall(body.id, cx + x * radius * spread, cy + y * radius * spread,
        isChampion ? 1 + 1.7 * winnerEase : 1, 1 - age / .95, isChampion);
    }
  }

  function tick(now: number) {
    const delta = previous === undefined ? 0 : Math.min(.05, (now - previous) / 1000);
    previous = now;
    phaseTime += delta;
    if (phase === 'battle') {
      world.advance(delta * timeScale);
      if (world.finished) {
        champion = world.bodies.find(body => body.escapedAt === null)!.id;
        setPhase('winner');
      }
    } else if (phase === 'winner' && phaseTime >= winnerSeconds) {
      world = new FlagPhysics(seeds[round % seeds.length]);
      round++;
      canvas.dataset.round = String(round);
      setPhase('refill');
    } else if (phase === 'refill' && phaseTime >= refillSeconds) {
      setPhase('battle');
    }
    paint();
    if (canvas.dataset.hasFrame === undefined) canvas.dataset.hasFrame = '';
    const remaining = String(world.count - world.exits.length);
    if (canvas.dataset.remaining !== remaining) canvas.dataset.remaining = remaining;
    frame = requestAnimationFrame(tick);
  }

  function requestFrame() {
    if (ready && playing && frame === undefined) frame = requestAnimationFrame(tick);
  }

  return {
    play() {
      playing = true;
      if (!images) {
        images = countries.map(country => {
          const image = new Image();
          image.src = '/assets/flag-battle/flags/' + country.id.toLowerCase() + '.svg';
          return image;
        });
        void Promise.all(images.map(image => image.decode())).then(() => {
          ready = true;
          canvas.dataset.round = String(round);
          setPhase('battle');
          requestFrame();
        }).catch(() => { /* Keep the poster if the flag art fails to load. */ });
      }
      requestFrame();
    },
    pause() {
      playing = false;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      previous = undefined;
    },
  };
}
