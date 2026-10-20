export type CitizenFacePalette = { skin: string; shade: string; hair: string; glasses?: boolean };
type FaceAction = 'game' | 'win' | 'lose';
type Brow = 'easy' | 'skeptic' | 'firm' | 'high' | 'soft' | 'sleepy' | 'calm' | 'bright' | 'crooked' | 'lifted' | 'kind' | 'straight' | 'laughing';
type Mouth = 'flat' | 'skeptic' | 'pressed' | 'surprised' | 'warm' | 'sleepy' | 'calm' | 'slack' | 'smirk' | 'pout' | 'grumble' | 'quiet' | 'open';
type Face = { rx: number; ry: number; shape?: 'almond'; lift?: number; lid?: number; asymmetry?: number; brow: Brow; mouth: Mouth; pupil?: number; blush?: boolean };

const ink = '#39332c', white = '#fffdf5', pupilInk = '#252724', mouthInk = '#51372e';

/** Expressions belong to individuals, while every face uses the same animation anchors. */
const faces: Record<number, Face> = {
  0: { rx: 8, ry: 9, brow: 'easy', mouth: 'flat' },
  1: { rx: 7.6, ry: 8.3, lid: .12, asymmetry: -1.4, brow: 'skeptic', mouth: 'skeptic' },
  2: { rx: 7.4, ry: 8.1, lid: .21, brow: 'firm', mouth: 'pressed' },
  3: { rx: 7.6, ry: 10.2, brow: 'high', mouth: 'surprised', pupil: 1.2 },
  4: { rx: 7.8, ry: 8.5, brow: 'soft', mouth: 'warm', blush: true },
  5: { rx: 8.1, ry: 8.2, lid: .49, brow: 'sleepy', mouth: 'sleepy' },
  7: { rx: 6.1, ry: 8.7, lid: .12, brow: 'calm', mouth: 'calm' },
  8: { rx: 6.3, ry: 9.15, brow: 'bright', mouth: 'slack', pupil: 1.45 },
  9: { rx: 7.8, ry: 7.8, lid: .17, asymmetry: -1.1, brow: 'crooked', mouth: 'smirk' },
  10: { rx: 7.6, ry: 5.4, shape: 'almond', lift: .75, brow: 'lifted', mouth: 'pressed' },
  11: { rx: 8.1, ry: 8, lid: .25, brow: 'firm', mouth: 'pout' },
  12: { rx: 7.7, ry: 7.7, lid: .12, brow: 'kind', mouth: 'grumble', pupil: 1.25 },
  13: { rx: 7.8, ry: 3.25, shape: 'almond', lift: .1, brow: 'straight', mouth: 'quiet', pupil: 1.5 },
  14: { rx: 7.4, ry: 5.1, shape: 'almond', lift: 1.35, brow: 'lifted', mouth: 'skeptic' },
  15: { rx: 7.45, ry: 8.25, brow: 'soft', mouth: 'flat', pupil: 1.65 },
  16: { rx: 8, ry: 3.8, shape: 'almond', lift: .35, brow: 'laughing', mouth: 'open', pupil: 1.5 },
};

export function drawCitizenFace(c: CanvasRenderingContext2D, p: CitizenFacePalette, person: number, side: boolean, frame: number, sip = -1, action?: FaceAction) {
  const face = faces[person] ?? faces[0];
  const eyes = side ? [45] : [24, 40], eyeY = 27.3, mouthX = side ? 49 : 32;
  const glance = frame === 7 ? -1.7 : frame === 9 ? 1.7 : 0;
  const curve = (x: number, y: number, cx: number, cy: number, xx: number, yy: number, color = ink, width = .85) => {
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(cx, cy, xx, yy); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  };
  const oval = (x: number, y: number, rx: number, ry: number, color: string, edge = 0) => {
    c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); }
  };
  const eyePath = (x: number, rx: number, ry: number, index: number) => {
    c.beginPath();
    if (face.shape === 'almond' && !p.glasses) {
      const lift = (face.lift ?? 0) * (side || index === 0 ? -1 : 1);
      c.moveTo(x - rx, eyeY + lift); c.quadraticCurveTo(x, eyeY - ry * 2, x + rx, eyeY - lift);
      c.quadraticCurveTo(x, eyeY + ry * 2, x - rx, eyeY + lift); c.closePath();
    } else c.ellipse(x, eyeY, rx, ry, p.glasses ? 0 : side ? -.06 : index === 0 ? .075 : -.075, 0, Math.PI * 2);
  };

  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  if (face.blush) {
    c.save(); c.globalAlpha *= .18;
    for (const x of side ? [41] : [16.5, 47.5]) oval(x, 38.7, 3.2, 1.5, '#c66d67');
    c.restore();
  }

  eyes.forEach((x, index) => {
    const rx = p.glasses ? Math.min(face.rx, side ? 6.4 : 6.4) : side ? face.rx * .82 : face.rx;
    const ry = Math.min(face.ry + (!side && index === 1 ? face.asymmetry ?? 0 : 0), p.glasses ? 9.4 : 11);
    if (action === 'win') curve(x - rx * .84, 28.1, x, 21.4, x + rx * .84, 28.1, ink, 1.05);
    else if (frame === 8) curve(x - rx * .83, 28, x, 28.8, x + rx * .83, 28.2, ink, .95);
    else {
      eyePath(x, rx, ry, index); c.fillStyle = white; c.fill(); c.strokeStyle = ink; c.lineWidth = face.shape === 'almond' ? .55 : .32; c.stroke();
      c.save(); eyePath(x, rx, ry, index); c.clip();
      const pupilY = face.brow === 'sleepy' ? 29.1 : face.brow === 'high' ? 27.2 : 28;
      oval(x + (side ? 1.85 + glance * .35 : glance), pupilY, face.pupil ?? 1.35, face.shape === 'almond' ? 1.75 : 1.65, pupilInk);
      const lid = frame === 24 ? Math.max(.56, (face.lid ?? 0) + .1) : face.lid ?? 0;
      if (lid) {
        const cut = eyeY - ry + ry * 2 * lid;
        c.fillStyle = p.skin; c.fillRect(x - rx - 2, eyeY - ry - 2, rx * 2 + 4, cut - eyeY + ry + 2);
        curve(x - rx - 1, cut, x, cut + .35, x + rx + 1, cut, ink, .72);
      }
      c.restore();
      if (face.shape === 'almond' && !p.glasses && frame !== 24) {
        const lift = (face.lift ?? 0) * (side || index === 0 ? -1 : 1);
        curve(x - rx, eyeY + lift, x, eyeY - ry * 2, x + rx, eyeY - lift, ink, person === 14 ? .95 : .7);
      }
    }

    const outer = side || index === 1 ? 1 : -1;
    const low = face.brow === 'sleepy' ? 21 : face.shape === 'almond' ? 20 : 17.2;
    if (action === 'lose') curve(x - 4.5, side || index === 1 ? 18.5 : 21, x, 19.2, x + 4.5, side || index === 1 ? 21 : 18.5, p.hair, 1.2);
    else if (face.brow === 'skeptic') {
      if (side || index === 1) curve(x - 4.8, 16.6, x, 13.6, x + 4.8, 16.6, p.hair, 1.15);
      else curve(x - 4.8, 20.1, x, 19.2, x + 4.8, 20, p.hair, 1.1);
    } else if (face.brow === 'firm') curve(x - 4.8, 18.7 - outer * .6, x, 18.4, x + 4.8, 18.7 + outer * .6, p.hair, 1.5);
    else if (face.brow === 'high' || face.brow === 'bright') curve(x - 4.4, 16.4, x, face.brow === 'high' ? 12.5 : 13.8, x + 4.4, 16.4, p.hair, 1.15);
    else if (face.brow === 'crooked') curve(x - 4.8, index === 0 && !side ? 19.5 : 17, x, 17.7, x + 4.8, index === 0 && !side ? 18.2 : 20, p.hair, 1.3);
    else if (face.brow === 'lifted') curve(x - 4.8, low + outer * .8, x, low - 1.2, x + 4.8, low - outer * .8, p.hair, person === 14 ? 1.05 : .9);
    else if (face.brow === 'straight') curve(x - 4.8, 20.8, x, 20.2, x + 4.8, 20.6, p.hair, 1.2);
    else if (face.brow === 'laughing') curve(x - 4.4, side || index === 0 ? 20.6 : 19.7, x, 18, x + 4.4, 20.4, p.hair, 1.05);
    else if (face.brow === 'sleepy') curve(x - 4.9, 21, x, 21.5, x + 4.9, 21.2, p.hair, 1.15);
    else curve(x - 4.6, low + .1, x, low - (face.brow === 'soft' || face.brow === 'kind' ? 2.2 : 1), x + 4.6, low + .5, p.hair, face.brow === 'kind' ? 1.45 : .95);

    if (person === 12 && action !== 'win') curve(x - 3.8, 36.9, x, 38, x + 3.3, 36.9, p.shade, .55);
  });

  const width = side ? 3.2 : face.mouth === 'open' ? 5.4 : 4.2;
  const smile = (w = width, y = 42.8, depth = 4) => curve(mouthX - w, y, mouthX, y + depth, mouthX + w, y, ink, .9);
  const openSmile = () => {
    c.beginPath(); c.moveTo(mouthX - width, 41.1); c.quadraticCurveTo(mouthX, 43, mouthX + width, 41.1);
    c.quadraticCurveTo(mouthX, 50, mouthX - width, 41.1); c.closePath(); c.fillStyle = mouthInk; c.fill(); c.strokeStyle = ink; c.lineWidth = .65; c.stroke();
    curve(mouthX - width * .7, 42, mouthX, 43.4, mouthX + width * .7, 42, white, 1.35);
  };
  if (action === 'win') openSmile();
  else if (action === 'lose') curve(mouthX - width * .9, 44.6, mouthX, 39.1, mouthX + width * .9, 44.6, ink, 1.05);
  else if (sip === 2 || sip === 3) oval(mouthX, 43, side ? 2.2 : 2.65, 2, '#633e31', .55);
  else if (frame === 23) {
    oval(mouthX, 43.4, side ? 2.5 : 3.1, 3.7, mouthInk, .6);
    curve(mouthX - 1.2, 45.7, mouthX, 44.9, mouthX + 1.2, 45.7, '#bc7d75', .9);
  } else if (face.mouth === 'surprised') oval(mouthX, 43.4, side ? 1.9 : 2.3, 2.65, mouthInk, .6);
  else if (face.mouth === 'open') openSmile();
  else if (face.mouth === 'smirk') curve(mouthX - width, 44.2, mouthX + 1, 45.2, mouthX + width, 41.5, ink, 1.05);
  else if (face.mouth === 'skeptic') curve(mouthX - width * .9, 43.5, mouthX, 42.8, mouthX + width * .85, 44.3, ink, .9);
  else if (face.mouth === 'sleepy') curve(mouthX - width * .85, 44.2, mouthX, 43.3, mouthX + width * .85, 44.2, ink, .9);
  else if (face.mouth === 'pressed') {
    curve(mouthX - width, 43.2, mouthX, 43.1, mouthX + width, 43.2, ink, 1.15);
    curve(mouthX + width, 43.2, mouthX + width + .4, 43.7, mouthX + width + .3, 44.1, ink, .7);
  } else if (face.mouth === 'pout') {
    curve(mouthX - width * .75, 44.3, mouthX, 41.7, mouthX + width * .75, 44.3, ink, 1);
    curve(mouthX - 1.4, 45.9, mouthX, 46.1, mouthX + 1.4, 45.9, p.shade, .65);
  } else if (face.mouth === 'grumble') {
    c.beginPath(); c.moveTo(mouthX - width, 44.6); c.lineTo(mouthX - width * .5, 42.8);
    c.lineTo(mouthX + width * .55, 42.8); c.lineTo(mouthX + width, 44.3);
    c.strokeStyle = ink; c.lineWidth = 1.05; c.stroke();
  } else if (face.mouth === 'slack') oval(mouthX, 43.5, side ? 1.9 : 2.5, 1.45, mouthInk, .55);
  else if (face.mouth === 'quiet') curve(mouthX - width * .65, 43.5, mouthX, 43.5, mouthX + width * .65, 43.5, ink, .9);
  else if (face.mouth === 'warm') smile(width, 42.5, 4.6);
  else if (face.mouth === 'calm') curve(mouthX - width * .85, 43.3, mouthX, 43.3, mouthX + width * .85, 43.3, ink, .95);
  else curve(mouthX - width * .8, 43.3, mouthX, 43.5, mouthX + width * .8, 43.7, ink, .95);

  if ((person === 12 && action === 'win') || person === 16) {
    const w = side ? 4 : 5.8;
    curve(mouthX - w, 41.9, mouthX - w - .8, 43.3, mouthX - w + .1, 44.3, p.shade, .55);
    if (!side) curve(mouthX + w, 41.9, mouthX + w + .8, 43.3, mouthX + w - .1, 44.3, p.shade, .55);
  }
  c.restore();
}
