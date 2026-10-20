type HairPalette = { hair: string; hairLight: string; light: string };
type Haircut = 'swept' | 'bob' | 'ponytail' | 'tousled';

export function isNewCitizenHair(look?: string): look is Haircut {
  return look === 'swept' || look === 'bob' || look === 'ponytail' || look === 'tousled';
}

/** Four complete cutout hairstyles, with matching silhouettes in every direction. */
export function drawCitizenHair(c: CanvasRenderingContext2D, p: HairPalette, look: string | undefined, side: boolean, back: boolean, step: number, layer: 'behind' | 'front') {
  if (!isNewCitizenHair(look)) return;
  c.save(); c.lineJoin = 'round'; c.lineCap = 'round';
  const fill = () => { c.fillStyle = p.hair; c.fill(); c.strokeStyle = '#39332c'; c.lineWidth = .6; c.stroke(); };
  const strand = (x: number, y: number, cx: number, cy: number, ex: number, ey: number, width = 1) => {
    c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(cx, cy, ex, ey);
    c.strokeStyle = p.hairLight; c.lineWidth = width; c.stroke();
  };
  if (layer === 'behind') {
    if (look === 'bob') {
      c.beginPath(); c.moveTo(9, 22);
      if (side) {
        c.quadraticCurveTo(11, 8, 30, 11); c.lineTo(31, 47);
        c.quadraticCurveTo(21, 56, 7, 47);
      } else {
        c.bezierCurveTo(6, -3, 57, -3, 56, 25); c.lineTo(57, 47);
        c.quadraticCurveTo(32, 58, 7, 47);
      }
      c.closePath(); fill();
    } else if (look === 'ponytail') {
      const x = side ? 15 : back ? 34 : 52;
      c.beginPath(); c.moveTo(x - 4, 10); c.quadraticCurveTo(x + 10, 7, x + 8, 25);
      c.quadraticCurveTo(x + 4 + step, 39, x + 6 + step, 49);
      c.lineTo(x - 3 + step, 45); c.quadraticCurveTo(x - 8, 28, x - 4, 10); c.closePath(); fill();
      strand(x + 2, 20, x - 1, 33, x + 2 + step, 43, 1.1);
      c.beginPath(); c.roundRect(x - 5, 12, 10, 3, 1); c.fillStyle = p.light; c.fill();
    }
    c.restore(); return;
  }
  if (back) {
    c.beginPath(); c.moveTo(10, 25); c.bezierCurveTo(5, -4, 58, -4, 55, 25);
    if (look === 'bob') {
      c.lineTo(56, 47); c.quadraticCurveTo(33, 54, 8, 47); c.closePath(); fill();
      for (const x of [16, 25, 39, 48]) strand(x, 20, x - 2, 35, x, 46, .8);
    } else {
      c.lineTo(53, 37); c.lineTo(46, 37); c.lineTo(42, 41); c.lineTo(35, 38);
      c.lineTo(30, 42); c.lineTo(24, 38); c.lineTo(17, 40); c.lineTo(11, 36); c.closePath(); fill();
      strand(17, 21, 28, 10, 45, 19, 1.5);
      strand(20, 32, 26, 35, 29, 33, .8);
      strand(37, 33, 43, 35, 47, 30, .8);
      if (look === 'ponytail') {
        c.beginPath(); c.roundRect(29, 12, 10, 4, 1); c.fillStyle = p.light; c.fill();
      }
    }
  } else if (side) {
    c.beginPath(); c.moveTo(14, 31); c.bezierCurveTo(6, 10, 22, 1, 36, 5);
    if (look === 'tousled') {
      c.lineTo(40, 1); c.lineTo(42, 8); c.lineTo(49, 5); c.lineTo(47, 13);
      c.lineTo(54, 14); c.lineTo(48, 21); c.lineTo(42, 17); c.lineTo(35, 21); c.lineTo(33, 14);
    } else if (look === 'swept') {
      c.quadraticCurveTo(51, 2, 54, 16); c.lineTo(47, 20); c.lineTo(44, 14);
      c.lineTo(34, 20); c.lineTo(30, 17);
    } else if (look === 'bob') {
      c.quadraticCurveTo(52, 3, 53, 19); c.lineTo(46, 20); c.lineTo(35, 13);
      c.lineTo(28, 20); c.lineTo(29, 47); c.lineTo(16, 51); c.lineTo(11, 45); c.closePath(); fill();
      strand(18, 24, 16, 36, 19, 46, 1.2);
      strand(25, 23, 25, 37, 25, 45, .8);
    } else {
      c.quadraticCurveTo(50, 2, 53, 17); c.lineTo(47, 19); c.lineTo(38, 13);
      c.lineTo(31, 20); c.lineTo(28, 18);
    }
    if (look !== 'bob') {
      c.lineTo(25, 36); c.lineTo(19, 40); c.closePath(); fill();
      strand(17, 18, 24, 9, 38, 10, 1.3);
      if (look === 'swept') strand(28, 13, 35, 10, 44, 12, .8);
    }
  } else {
    c.beginPath(); c.moveTo(10, 27); c.quadraticCurveTo(6, 7, 23, 5);
    if (look === 'tousled') {
      c.lineTo(27, 0); c.lineTo(32, 7); c.lineTo(40, 1); c.lineTo(41, 8);
      c.lineTo(50, 6); c.lineTo(48, 13); c.lineTo(56, 18); c.lineTo(51, 26);
      c.lineTo(44, 18); c.lineTo(38, 21); c.lineTo(33, 14); c.lineTo(27, 21);
      c.lineTo(23, 16); c.lineTo(17, 23); c.closePath(); fill();
      strand(28, 10, 33, 10, 36, 15, 1.3);
    } else if (look === 'swept') {
      c.quadraticCurveTo(48, -1, 55, 18); c.lineTo(53, 27); c.lineTo(47, 18);
      c.lineTo(40, 15); c.lineTo(29, 21); c.lineTo(29, 14); c.lineTo(18, 22); c.closePath(); fill();
      strand(18, 15, 30, 5, 43, 10, 1.5);
      strand(33, 13, 41, 8, 49, 17, .8);
    } else if (look === 'bob') {
      c.quadraticCurveTo(48, -2, 55, 18); c.lineTo(56, 45); c.lineTo(49, 48);
      c.lineTo(48, 21); c.lineTo(36, 14); c.lineTo(30, 21); c.lineTo(27, 14);
      c.lineTo(17, 23); c.lineTo(15, 48); c.lineTo(8, 45); c.closePath(); fill();
      strand(18, 13, 23, 7, 30, 8, 1.2);
      strand(45, 24, 49, 33, 51, 43, .8);
    } else {
      c.quadraticCurveTo(48, -2, 55, 22); c.lineTo(48, 20); c.lineTo(38, 12);
      c.lineTo(30, 19); c.lineTo(25, 15); c.lineTo(17, 24); c.closePath(); fill();
      strand(20, 13, 28, 7, 35, 8, 1.2);
      strand(39, 9, 46, 12, 49, 17, 1);
    }
  }
  c.restore();
}
