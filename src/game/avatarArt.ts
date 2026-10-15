import { CLOTHING_COLORS, SKIN_COLORS, type Appearance } from '../shared/appearance';
import type { Facing } from '../shared/movement';
import { drawAvatarHairBack, drawAvatarHead } from './avatarHead';
import { drawAvatarGarmentDetails, drawAvatarScarf } from './avatarClothing';

const ink = '#39332c';
export function characterGamePose(frame: number) {
  if (frame < 28 || frame > 45) return null;
  const phase = (frame - 28) % 6;
  return {
    action: (['game', 'win', 'lose'] as const)[Math.floor((frame - 28) / 6)],
    phase,
    pulse: [0, 1, 2, 1, 0, -1][phase],
    sway: [0, -1, -1, 0, 1, 1][phase],
  };
}

/** Bent limbs stay attached while visitors tap controls, cheer, or hold their head. */
export function drawSeatedGameArm(c: CanvasRenderingContext2D, pose: NonNullable<ReturnType<typeof characterGamePose>>, x: number, y: number, side: boolean, far: boolean, sleeve: string, skin: string, bare = false) {
  const sign = side ? (far ? 1 : -1) : far ? -1 : 1;
  let elbowX: number, elbowY: number, handX: number, handY: number;
  if (pose.action === 'win') {
    elbowX = x + sign * 10; elbowY = y - 9 - pose.pulse;
    handX = Math.max(4, Math.min(60, x + sign * 11)); handY = y - 25 - pose.pulse * 1.5;
  } else if (pose.action === 'lose' && !far) {
    elbowX = Math.min(60, x + 10); elbowY = y + 7;
    handX = side ? 46 : 55; handY = y - 16 + pose.pulse;
  } else if (pose.action === 'lose') {
    elbowX = x + sign * 5; elbowY = y + 10;
    handX = x + sign * 6; handY = y + 17 + pose.pulse;
  } else {
    elbowX = side ? x + 8 : x + sign * 9;
    elbowY = y + 11;
    handX = side ? Math.min(59, x + 19) : x + sign * 10;
    handY = y + 1 - (far ? -pose.pulse : pose.pulse) * 1.8;
    if (!far && pose.phase === 4) {
      elbowX = Math.max(5, Math.min(59, x + sign * 10)); elbowY = y + 5;
      handX = Math.max(4, Math.min(60, x + sign * 11)); handY = y - 9;
    }
  }
  const limb = (endX: number, endY: number, color: string, width: number) => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(elbowX, elbowY); c.lineTo(endX, endY);
    c.strokeStyle = ink; c.lineWidth = width + 1.1; c.stroke();
    c.strokeStyle = color; c.lineWidth = width; c.stroke();
  };
  limb(handX, handY, bare ? skin : sleeve, 7);
  if (!bare) {
    c.beginPath(); c.moveTo(elbowX + (handX - elbowX) * .72, elbowY + (handY - elbowY) * .72); c.lineTo(handX, handY);
    c.strokeStyle = skin; c.lineWidth = 5.3; c.stroke();
  }
  c.beginPath(); c.ellipse(handX, handY, pose.action === 'win' ? 3.6 : 3.2, 3.9, 0, 0, Math.PI * 2);
  c.fillStyle = skin; c.fill(); c.strokeStyle = ink; c.lineWidth = .6; c.stroke();
  if (pose.action === 'win') {
    c.beginPath(); c.moveTo(handX - 1.4, handY - 1); c.lineTo(handX + 1.5, handY - 1);
    c.strokeStyle = ink; c.lineWidth = .55; c.stroke();
  }
}

function shade(hex: string, amount: number) {
  const value = parseInt(hex.slice(1), 16);
  return '#' + [16, 8, 0].map(shift => Math.max(0, Math.min(255, ((value >> shift) & 255) + amount)).toString(16).padStart(2, '0')).join('');
}

/** All wardrobe layers use the same body anchors in previews and the game atlas. */
export function drawAvatar(c: CanvasRenderingContext2D, a: Appearance, facing: Facing, frame: number, seated = false, sip = -1) {
  const game = characterGamePose(frame);
  seated ||= !!game;
  const side = facing === 'left' || facing === 'right', back = facing === 'up';
  const tall = a.body === 2, broad = a.body === 1;
  const step = frame < 6 ? [0, 1, .55, 0, -1, -.55][frame] : 0;
  const bounce = frame < 6 ? [0, -1.2, -.5, 0, -1.2, -.5][frame] : 0;
  const skin = SKIN_COLORS[a.skinTone], top = CLOTHING_COLORS[a.topColor];
  const bottom = CLOTHING_COLORS[a.bottomColor], shoe = CLOTHING_COLORS[a.shoeColor];
  const half = side ? (broad ? 18 : tall ? 11 : 14) : (broad ? 26 : tall ? 16.5 : 20);
  const shoulderY = tall ? 40 : 44, hem = a.top === 4 ? 71 : 66;
  const headY = tall ? 25.5 : 27;
  const center = side ? 36 : 32;
  const left = center - half, right = center + half;
  const fill = (color: string, edge = .8) => {
    c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); }
  };
  const oval = (x: number, y: number, rx: number, ry: number, color: string, edge = .8) => {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); fill(color, edge);
  };
  const box = (x: number, y: number, w: number, h: number, color: string, r = 1, edge = .8) => {
    c.beginPath(); c.roundRect(x, y, w, h, r); fill(color, edge);
  };
  const line = (x: number, y: number, endX: number, endY: number, color = ink, weight = .8) => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(endX, endY); c.strokeStyle = color; c.lineWidth = weight; c.stroke();
  };
  const curve = (x: number, y: number, midX: number, midY: number, endX: number, endY: number, color = ink, weight = .8) => {
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(midX, midY, endX, endY); c.strokeStyle = color; c.lineWidth = weight; c.stroke();
  };
  const path = (points: number[][], color: string, edge = .8) => {
    c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x, y) : c.moveTo(x, y)); c.closePath(); fill(color, edge);
  };
  c.save(); c.beginPath(); c.rect(0, -8, 32, 48); c.clip(); c.scale(.5, .5);
  if (facing === 'left') { c.translate(64, 0); c.scale(-1, 1); }
  c.translate(32, 76); c.scale(.94, .94); c.translate(-32, -76);
  c.lineJoin = 'round'; c.lineCap = 'round';

  // Feet share a ground anchor; knees bend independently of the upper body.
  for (const leg of [-1, 1]) {
    const swing = step * leg;
    const hipX = center + leg * (side ? 3 : broad ? 12 : tall ? 7 : 9);
    const kneeX = hipX + (side ? swing * 4.5 + (seated ? 6 : 0) : swing + (seated ? leg * 1.5 : 0));
    const footY = 76 - Math.max(0, swing) * 2;
    const width = side ? 8 : broad ? 15 : tall ? 10 : 12;
    const kneeY = seated ? 65 : 69;
    const hipY = game ? 54 : seated ? 60 : 62 + bounce;
    const bareLeg = a.bottom !== 0;
    const fabric = side && leg < 0 ? shade(bottom, -20) : bottom;
    const legColor = bareLeg ? skin : fabric;
    c.beginPath(); c.moveTo(hipX - width * .5, hipY);
    c.quadraticCurveTo(kneeX - width * .52, kneeY - 1, kneeX - width * .4, footY - 1);
    c.lineTo(kneeX + width * .4, footY - 1);
    c.quadraticCurveTo(kneeX + width * .55, kneeY, hipX + width * .5, hipY); c.closePath(); fill(legColor);
    if (seated && side) {
      line(hipX, 63, kneeX, kneeY, bareLeg ? skin : fabric, width);
      line(hipX, 62, kneeX, kneeY - 1, bareLeg ? shade(skin, 15) : shade(fabric, 15), 1);
    }
    if (!bareLeg) {
      line(kneeX - width * .2, 70, kneeX - width * .25, footY - 3, shade(fabric, 24), .8);
      line(kneeX - width * .4, footY - 3, kneeX + width * .4, footY - 3, shade(fabric, -30), .65);
    } else if (a.bottom === 1) {
      c.beginPath(); c.moveTo(hipX - width * .55, hipY); c.lineTo(hipX + width * .55, hipY);
      c.lineTo(kneeX + width * .58, seated ? 66 : 69); c.quadraticCurveTo(kneeX, seated ? 67 : 70, kneeX - width * .58, seated ? 66 : 69); c.closePath(); fill(fabric);
      line(kneeX - width * .4, seated ? 65 : 68, kneeX + width * .4, seated ? 65 : 68, shade(fabric, 30), .8);
    }
    const footX = kneeX + (side ? 2 : 0), footW = side ? 8 : broad ? 9 : tall ? 7 : 8;
    if (a.shoes === 1) {
      box(kneeX - width * .43, footY - 7, width * .86, 7, shoe, 1.5);
      line(kneeX - width * .4, footY - 6, kneeX + width * .4, footY - 6, shade(shoe, 35), 1);
    } else if (a.shoes === 0) box(kneeX - width * .35, footY - 4, width * .7, 3, '#eee7d1', .5, .5);
    c.beginPath(); c.moveTo(footX - footW, footY - 1.8);
    c.quadraticCurveTo(footX - footW + 2, footY - 5.5, footX + (side ? 1 : 0), footY - 3.3);
    c.quadraticCurveTo(footX + footW + 2, footY - 3.3, footX + footW, footY + 1.5);
    c.quadraticCurveTo(footX, footY + 3.2, footX - footW, footY + 1.2); c.closePath(); fill(shoe);
    curve(footX - footW + 1, footY + .6, footX, footY + 2, footX + footW - .7, footY + .5, a.shoes === 0 ? '#f6eed9' : shade(shoe, -36), 1.4);
    if (a.shoes === 0 && !back) {
      curve(footX + (side ? 3 : 0), footY - 3, footX + footW - 1, footY - 2, footX + footW - 1, footY, '#f6eed9', 1);
      for (const dy of [-2.4, -.8]) line(footX - 2, footY + dy, footX + 1, footY + dy - .5, '#fff7e3', .8);
    } else if (a.shoes === 0 && back) {
      line(footX - 3, footY - 2, footX + 3, footY - 2, '#f6eed9', 1);
    } else if (a.shoes === 1 && !back) {
      for (const dy of [-4, -2]) line(kneeX - 1.8, footY + dy, kneeX + 1.8, footY + dy, shade(shoe, 65), .75);
    } else if (a.shoes === 2) {
      oval(footX - 3, footY - 2.2, 2.3, 1.1, skin, .45);
      curve(footX, footY - 3.3, footX + 3, footY - 1, footX + 4, footY - .2, shade(shoe, 40), 1);
    }
  }


  const lift = game ? -8 + (game.action === 'win' ? -game.pulse : game.action === 'lose' ? 3 + game.pulse * .5 : game.pulse * .3) : seated ? 2 : 0;
  c.save(); c.translate(0, bounce + lift);
  c.translate(32, 64); c.rotate((game ? game.sway * (game.action === 'lose' ? 3.5 : 1.6) : step * (side ? 2.2 : 1.1)) * Math.PI / 180); c.translate(-32, -64);
  if (a.bottom === 2) {
    const skirtHalf = side ? half - 1 : half - 3;
    c.beginPath(); c.moveTo(center - skirtHalf + 4, 61); c.lineTo(center + skirtHalf - 4, 61);
    c.lineTo(center + skirtHalf + 2, seated ? 70 : 71.5); c.quadraticCurveTo(center, seated ? 72 : 74, center - skirtHalf - 2, seated ? 70 : 71.5); c.closePath(); fill(bottom);
    for (const dx of [-.6, 0, .6]) line(center + dx * skirtHalf * .7, 65, center + dx * skirtHalf, 71, shade(bottom, -24), .7);
    curve(center - skirtHalf, 71, center, 73, center + skirtHalf, 71, shade(bottom, 35), .8);
  }
  const head = (draw: () => void) => {
    c.save(); c.translate(32, headY); c.rotate((game ? game.sway * (game.action === 'lose' ? 5 : 1.5) : frame < 6 ? -step * 1.2 : frame === 9 ? 1 : 0) * Math.PI / 180); c.translate(-32, -27); draw(); c.restore();
  };
  head(() => drawAvatarHairBack(c, a, side, back, step));
  const sleeve = a.top === 5 ? '#eee1bf' : top;
  const armTattoo = (x: number, y: number) => {
    if (a.tattoo === 3) {
      oval(x, y, 2.4, 1.3, '#557d85', .4);
      path([[x - 1.5, y], [x - 3.5, y - 1.5], [x - 3.5, y + 1.5]], '#557d85', .4);
      oval(x + 1, y - .2, .3, .3, ink, 0);
    } else if (a.tattoo === 4) {
      oval(x, y, 2.1, 2.8, '#a18451', .4);
      for (const dx of [-.7, .7]) oval(x + dx, y + dx, .35, .4, '#675940', 0);
    }
  };
  const arm = (far: boolean) => {
    const sign = far ? -1 : 1;
    const shoulder = side ? (far ? center + 4 : center - 7) : center + sign * (half - 3.5);
    const y = shoulderY + 3;
    let elbowX = shoulder + (side ? 0 : sign * 1.6), elbowY = y + 10;
    let handX = shoulder + (side ? 0 : sign * 1.8), handY = 66;
    if (game) {
      const direction = side ? (far ? 1 : -1) : sign;
      if (game.action === 'win') {
        elbowX = shoulder + direction * 6; elbowY = y - 9 - game.pulse;
        handX = Math.max(5, Math.min(59, shoulder + direction * 8)); handY = y - 24 - game.pulse * 1.4;
      } else if (game.action === 'lose' && !far) {
        elbowX = Math.min(58, shoulder + 8); elbowY = y + 7;
        handX = side ? 46 : 50; handY = y - 15 + game.pulse;
      } else {
        elbowX = shoulder + (side ? 7 : direction * 6); elbowY = y + 10;
        handX = Math.max(6, Math.min(58, shoulder + (side ? 16 : direction * 7))); handY = y + 1 + (far ? 1 : -1) * game.pulse * 1.5;
        if (game.action === 'lose') { handX = shoulder + direction * 5; handY = y + 16 + game.pulse; }
      }
    } else if (!far && sip >= 0) {
      const raise = [0, 6, 17, 18, 8, 0][sip];
      elbowX = side ? shoulder + 8 : Math.min(57, shoulder + 2); elbowY = y + 11;
      handX = 44; handY = 61 - raise;
    } else if (step) {
      elbowX += sign * step * (side ? 4 : 1); handX += sign * step * (side ? 6 : 1.8);
      handY -= Math.abs(step) * .5;
    }
    const armColor = side && far ? shade(sleeve, -22) : sleeve;
    const point = (t: number) => ({
      x: (1 - t) ** 2 * shoulder + 2 * (1 - t) * t * elbowX + t * t * handX,
      y: (1 - t) ** 2 * y + 2 * (1 - t) * t * elbowY + t * t * handY,
    });
    const strokeLimb = (t: number, color: string, width: number) => {
      const end = point(t);
      c.beginPath(); c.moveTo(shoulder, y); c.quadraticCurveTo(shoulder + (elbowX - shoulder) * t, y + (elbowY - y) * t, end.x, end.y);
      c.strokeStyle = ink; c.lineWidth = width + 1.3; c.stroke(); c.strokeStyle = color; c.lineWidth = width; c.stroke();
    };
    // The skin is continuous under the sleeve, including bent and raised poses.
    strokeLimb(1, skin, 5.8);
    if (a.top === 0) {
      const cuff = point(.32);
      const dx = .68 * (elbowX - shoulder) + .32 * (handX - elbowX), dy = .68 * (elbowY - y) + .32 * (handY - elbowY);
      const length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
      const rootDX = elbowX - shoulder, rootDY = elbowY - y, rootLength = Math.hypot(rootDX, rootDY) || 1;
      const rootNX = -rootDY / rootLength, rootNY = rootDX / rootLength;
      c.beginPath(); c.moveTo(shoulder + rootNX * 4.4, y + rootNY * 4.4);
      c.quadraticCurveTo(shoulder - rootDX * .2, y - rootDY * .2, shoulder - rootNX * 4.4, y - rootNY * 4.4);
      c.lineTo(cuff.x - nx * 4.1, cuff.y - ny * 4.1); c.quadraticCurveTo(cuff.x + dx / length, cuff.y + dy / length, cuff.x + nx * 4.1, cuff.y + ny * 4.1); c.closePath(); fill(armColor);
      line(cuff.x - nx * 3.4, cuff.y - ny * 3.4, cuff.x + nx * 3.4, cuff.y + ny * 3.4, shade(top, -24), .65);
      if (!far && (a.tattoo === 3 || a.tattoo === 4)) { const tattoo = point(.72); armTattoo(tattoo.x, tattoo.y); }
    } else {
      const cuff = point(.83), cuffX = cuff.x, cuffY = cuff.y;
      strokeLimb(.83, armColor, 7.7);
      const dx = .17 * (elbowX - shoulder) + .83 * (handX - elbowX), dy = .17 * (elbowY - y) + .83 * (handY - elbowY), length = Math.hypot(dx, dy) || 1;
      line(cuffX - dy / length * 3.5, cuffY + dx / length * 3.5, cuffX + dy / length * 3.5, cuffY - dx / length * 3.5, shade(armColor, -30), 1.3);
      if (a.top === 3) for (const t of [.38, .64]) {
        const stripe = point(t), sx = (1 - t) * (elbowX - shoulder) + t * (handX - elbowX), sy = (1 - t) * (elbowY - y) + t * (handY - elbowY);
        const span = Math.hypot(sx, sy) || 1;
        line(stripe.x - sy / span * 3, stripe.y + sx / span * 3, stripe.x + sy / span * 3, stripe.y - sx / span * 3, shade(top, 48), 2.2);
      }
    }
    oval(handX, handY, 3.2, game?.action === 'win' ? 3.5 : 3.8, skin, .7);
    curve(handX - 1.8, handY - 1, handX - .1, handY - .2, handX - .9, handY + 1.2, shade(skin, -36), .55);
    if (!far && sip >= 0) {
      c.save(); c.translate(handX + 4, handY - 1); c.rotate(-[0, 6, 17, 18, 8, 0][sip] * .014);
      c.beginPath(); c.moveTo(-4.5, -10); c.lineTo(4.5, -10); c.lineTo(3.5, 3); c.quadraticCurveTo(0, 5, -3.5, 3); c.closePath(); fill('#faf0d5');
      box(-3.1, -4, 6.2, 6, '#dca447', .7, 0); oval(0, -10, 4.5, 1.4, '#fff8e3', .6);
      line(-2, -8, -2.4, -2, '#fffdf4', 1.2); oval(-4, 0, 2.7, 3.2, skin, .6); c.restore();
    }
  };
  arm(true);
  if (back && !game && sip < 0) arm(false);
  box(center - 5, shoulderY - 5, 10, 12, skin, 3);
  const torso = () => {
    c.beginPath(); c.moveTo(center - 7, shoulderY - 1);
    c.quadraticCurveTo(left + 3, shoulderY, left + 2, shoulderY + 7);
    c.quadraticCurveTo(left - (broad ? 1 : 0), hem - 8, left, hem - 1);
    c.quadraticCurveTo(center, hem + 3.5, right, hem - 1);
    c.quadraticCurveTo(right + (broad ? 1 : 0), hem - 8, right - 2, shoulderY + 7);
    c.quadraticCurveTo(right - 3, shoulderY, center + 7, shoulderY - 1); c.closePath();
  };
  torso(); fill(top, .9);
  const fit = { center, half, shoulderY, hem, side, back };
  c.save(); torso(); c.clip(); drawAvatarGarmentDetails(c, a, fit); c.restore();
  drawAvatarScarf(c, a, fit);
  const raised = !!game || sip >= 0;
  if (!back && !raised) arm(false);
  if (raised && back && game?.action !== 'lose') arm(false);
  head(() => drawAvatarHead(c, a, side, back, frame, sip, game));
  if (raised && (!back || game?.action === 'lose')) arm(false);
  c.restore(); c.restore();
}
