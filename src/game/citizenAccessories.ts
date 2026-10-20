export type CitizenAccessoryPalette = { dark: string; light: string; shirt: string };

/** The fixed citizens share these eye and ear anchors in their rigid head piece. */
export function drawCitizenGlasses(c: CanvasRenderingContext2D, p: CitizenAccessoryPalette, side: boolean, back: boolean) {
  c.save();
  c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = p.dark; c.lineWidth = 1.15;
  if (back) {
    // Only the hooks around the exposed outer ears are visible from the rear.
    for (const sign of [-1, 1]) {
      c.beginPath(); c.moveTo(32 + sign * 22, 31.8);
      c.bezierCurveTo(32 + sign * 23.8, 31.4, 32 + sign * 24.2, 34.2, 32 + sign * 23, 35.7);
      c.stroke();
    }
    c.restore(); return;
  }

  const eyeY = 27.3;
  if (side) {
    // The temple passes behind the lens and curls over the visible ear at (26, 34).
    c.beginPath(); c.moveTo(38.15, 25.6);
    c.quadraticCurveTo(31.3, 26.9, 26.2, 31.5);
    c.bezierCurveTo(24.7, 32.1, 24.8, 34.7, 26.1, 35.3); c.stroke();
    c.beginPath(); c.ellipse(45, eyeY, 7.05, 9.65, -.045, 0, Math.PI * 2); c.stroke();
    // A short nose saddle completes the frame without suggesting a second lens.
    c.beginPath(); c.moveTo(52.05, 27.2); c.quadraticCurveTo(53, 27.6, 53.1, 28.8); c.stroke();
  } else {
    for (const sign of [-1, 1]) {
      const hinge = 32 + sign * 15.02;
      c.beginPath(); c.moveTo(hinge, 25.55);
      c.quadraticCurveTo(32 + sign * 20.1, 26.7, 32 + sign * 21.8, 31.6);
      c.bezierCurveTo(32 + sign * 23, 32.1, 32 + sign * 22.7, 34.6, 32 + sign * 21.7, 35.2);
      c.stroke();
    }
    for (const x of [24, 40]) {
      c.beginPath(); c.ellipse(x, eyeY, 7.15, 9.65, 0, 0, Math.PI * 2); c.stroke();
    }
    c.beginPath(); c.moveTo(31.03, 25.65); c.quadraticCurveTo(32, 24.6, 32.97, 25.65); c.stroke();
  }
  c.restore();
}

/** Sparse seams stay inside the existing flat hat silhouette. */
export function drawCitizenHatStitch(c: CanvasRenderingContext2D, p: CitizenAccessoryPalette, side: boolean, back: boolean, look?: string) {
  if (look !== 'beanie' && look !== 'baseball') return;
  c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath();
  if (side) {
    c.moveTo(12, 21); c.bezierCurveTo(11, -1, 54, -1, 54, 21);
  } else if (back) {
    c.moveTo(8, 34); c.bezierCurveTo(3, -5, 60, -5, 56, 34); c.quadraticCurveTo(33, 41, 8, 34);
  } else {
    c.moveTo(8, 21); c.bezierCurveTo(7, -2, 56, -2, 56, 21);
  }
  c.closePath(); c.clip();
  c.strokeStyle = p.light; c.globalAlpha *= .3; c.lineWidth = .7;
  const startX = side ? 15 : 12, endX = side ? 52 : 54, rimY = back ? 32 : 16;
  if (look === 'beanie') {
    for (let x = startX; x < endX; x += 6) {
      c.beginPath(); c.moveTo(32 + (x - 32) * .3, 3.5);
      c.quadraticCurveTo(x - 1, 10, x, rimY); c.stroke();
    }
  } else {
    c.beginPath(); c.moveTo(32, 3.5); c.quadraticCurveTo(side ? 39 : 31, 9, side ? 44 : 32, rimY); c.stroke();
    if (!side) for (const x of [17, 47]) {
      c.beginPath(); c.moveTo(32, 3.5); c.quadraticCurveTo(x, 8, x, rimY); c.stroke();
    }
  }
  c.restore();
}
