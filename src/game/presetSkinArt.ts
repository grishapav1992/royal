type Point = readonly [x: number, y: number];
type Cloth = { light: string; dark: string };

/** Paint details in the current torso path, which already follows the animated shoulders. */
export function drawPresetClothing(
  c: CanvasRenderingContext2D, person: number, cloth: Cloth, side: boolean, back: boolean,
) {
  const { light, dark } = cloth;
  const seam = 'rgba(49, 31, 44, .44)';
  const shine = 'rgba(255, 237, 198, .28)';
  const brass = '#f0c57a';
  const stroke = (color: string, weight: number, [x, y]: Point, ...points: Point[]) => {
    c.beginPath(); c.moveTo(x, y);
    for (const [px, py] of points) c.lineTo(px, py);
    c.strokeStyle = color; c.lineWidth = weight; c.stroke();
  };
  const panel = (color: string, [x, y]: Point, ...points: Point[]) => {
    c.beginPath(); c.moveTo(x, y);
    for (const [px, py] of points) c.lineTo(px, py);
    c.closePath(); c.fillStyle = color; c.fill();
  };
  const button = (x: number, y: number, color = brass, radius = 1.35) => {
    c.beginPath(); c.arc(x, y, radius, 0, Math.PI * 2);
    c.fillStyle = color; c.fill();
    c.strokeStyle = seam; c.lineWidth = .55; c.stroke();
    stroke(shine, .55, [x - .45, y - .4], [x + .25, y - .55]);
  };
  const pocket = (x: number, y: number, width: number, color = dark) => {
    panel(color, [x, y], [x + width, y], [x + width - 1, y + 4], [x + 1, y + 4]);
    stroke(shine, .8, [x + 1, y + 1], [x + width - 1, y + 1]);
  };
  const zip = (x: number, y: number, bottomX = x) => {
    stroke(seam, 2.9, [x, y], [bottomX, 69]);
    stroke(brass, 1, [x, y], [bottomX, 69]);
    c.fillStyle = brass; c.fillRect(x - 1, y + 2, 2, 3.7);
  };

  c.save();
  c.clip();
  const shade = c.createLinearGradient(0, 55, 0, 71);
  shade.addColorStop(0, 'rgba(47, 28, 46, 0)');
  shade.addColorStop(1, 'rgba(47, 28, 46, .32)');
  c.fillStyle = shade; c.fillRect(0, 55, 64, 17);
  if (side) {
    // The closure sits towards the nose in profile. The outer panel remains visible.
    c.translate(24.5, 0); c.scale(.54, 1);
  }

  if (back) {
    if (person === 0 || person === 5 || person === 8 || person === 11) {
      c.beginPath(); c.moveTo(20, 44);
      c.quadraticCurveTo(32, 47, 44, 44);
      c.quadraticCurveTo(44, 53, 32, 57);
      c.quadraticCurveTo(20, 54, 20, 44);
      c.fillStyle = dark; c.fill();
      stroke(light, 1.25, [23, 50], [32, 55], [41, 50]);
    } else {
      stroke(dark, 2.6, [19, 50], [26, 53], [38, 53], [45, 50]);
      stroke(shine, .8, [21, 51], [27, 54], [37, 54], [43, 51]);
    }
    if (person === 0 || person === 10) {
      for (const y of [58, 64]) stroke(person === 10 ? light : seam, 2.35, [15, y - 1], [32, y], [49, y - 1]);
    } else if (person === 5 || person === 7 || person === 12) {
      stroke(seam, 1.2, [32, 55], [32, 67]);
      if (person === 7) stroke(dark, 2.4, [23, 61], [32, 63], [41, 61]);
    } else if (person === 3 || person === 11) {
      stroke(light, 1.45, [19, 65], [32, 66], [45, 65]);
    }
  } else {
    switch (person) {
      case 0: // Eddie's quilted parka
        for (const y of [55, 61, 66]) {
          stroke(seam, 1.45, [16, y - .9], [25, y], [39, y], [48, y - .9]);
          stroke(shine, .85, [20, y - 2], [28, y - 1.5], [39, y - 1.5], [45, y - 2]);
        }
        zip(32, 48);
        stroke(light, 1.8, [20, 62], [25, 59]);
        stroke(light, 1.8, [44, 62], [39, 59]);
        break;
      case 1: // Lizzie's tailored wool coat
      case 4: { // Emmy's pale coat and rose lining
        const lining = person === 1 ? light : '#bc7382';
        panel(dark, [21, 47], [32, 52], [43, 47], [39, 54], [32, 58], [25, 54]);
        panel(lining, [22, 47], [31, 50], [29, 56], [25, 52]);
        panel(lining, [42, 47], [33, 50], [35, 56], [39, 52]);
        stroke(seam, 1.2, [32, 54], [32, 69]);
        pocket(18, 59, 8, dark);
        pocket(38, 59, 8, dark);
        for (const y of [57, 62, 67]) {
          button(29, y, lining, 1);
          button(35, y, lining, 1);
        }
        break;
      }
      case 2: // Toby's work jacket
        panel(dark, [16, 50], [26, 49], [32, 52], [38, 49], [48, 50], [46, 55], [18, 55]);
        pocket(19, 55, 9);
        pocket(36, 55, 9);
        stroke(light, 1.6, [19, 63], [25, 62]);
        stroke(light, 1.6, [45, 63], [39, 62]);
        zip(32, 50);
        break;
      case 3: // Kevin's varsity jacket
        panel(dark, [18, 50], [25, 47], [25, 68], [17, 66]);
        panel(dark, [46, 50], [39, 47], [39, 68], [47, 66]);
        stroke('#f4dba9', 1.7, [24, 51], [24, 62]);
        stroke('#f4dba9', 1.7, [40, 51], [40, 62]);
        stroke(light, 2, [32, 49], [32, 68]);
        for (const y of [54, 60, 66]) button(32, y, '#fff0c8', .85);
        break;
      case 5: // Clyde's toggle coat
        panel('#965470', [16, 51], [27, 50], [32, 52], [37, 50], [48, 51], [46, 55], [18, 55]);
        stroke(dark, 2.7, [32, 50], [32, 69]);
        for (const y of [56, 62, 67]) {
          stroke(seam, 3.1, [27, y], [37, y]);
          stroke(light, 1.65, [30, y - .25], [35, y - .25]);
        }
        break;
      case 7: // Miles's waistcoat
        panel(light, [22, 48], [42, 48], [35, 59], [29, 59]);
        panel(dark, [30, 51], [34, 51], [35, 55], [32, 58], [29, 55]);
        stroke(dark, 1.45, [21, 49], [25, 58], [24, 68]);
        stroke(dark, 1.45, [43, 49], [39, 58], [40, 68]);
        pocket(37, 59, 8);
        stroke(brass, 1.3, [33, 60], [37, 63], [41, 60]);
        for (const y of [59, 64, 68]) button(32, y, '#67493d', 1);
        break;
      case 8: // Archie's sweater and woven scarf
        for (const x of [22, 30, 38]) {
          stroke(dark, 1.35, [x, 54], [x + 2, 58], [x, 62], [x + 2, 66]);
          stroke(shine, .8, [x + 1, 55], [x + 3, 58], [x + 1, 62]);
        }
        break;
      case 9: // Dylan's diagonal biker zipper
        panel(dark, [18, 49], [26, 47], [37, 61], [26, 57], [19, 59]);
        panel('#6e6174', [35, 50], [45, 49], [42, 55], [36, 54]);
        zip(25, 50, 39);
        stroke(light, 1.3, [17, 59], [24, 56]);
        stroke(light, 1.3, [41, 59], [46, 57]);
        button(20, 53, '#f1dbc0', 1);
        button(43, 53, '#f1dbc0', 1);
        break;
      case 10: // May's striped knit
        for (const y of [55, 62, 68]) {
          stroke(light, 3.2, [15, y - .8], [32, y], [49, y - .8]);
          stroke(dark, .8, [18, y + 1.45], [32, y + 2], [46, y + 1.45]);
        }
        break;
      case 11: // Jake's colour block hoodie
        panel(dark, [21, 58], [43, 58], [46, 67], [18, 67]);
        stroke(shine, 1.1, [20, 65], [23, 60], [41, 60], [44, 65]);
        stroke(light, 1.45, [27, 49], [27, 55]);
        stroke(light, 1.45, [37, 49], [37, 54]);
        break;
      case 12: // Gus's suit with folded lapels and a pocket square
        panel('#f0dfc2', [23, 47], [41, 47], [32, 64]);
        panel('#a44952', [30.4, 51], [33.6, 51], [34, 58], [32, 62], [30, 58]);
        panel(dark, [22, 47], [31, 60], [28, 58], [21, 53]);
        panel(dark, [42, 47], [33, 60], [36, 58], [43, 53]);
        pocket(38, 55, 8);
        panel(light, [40, 55], [42, 52.5], [45, 55]);
        for (const y of [62, 67]) button(32, y, '#dac392', 1);
        break;
    }
  }
  if (person === 8) {
    c.beginPath(); c.roundRect(19, 46, 26, 7, 2.5);
    c.fillStyle = light; c.fill();
    const x = back ? 23 : 37;
    panel(light, [x, 50], [x + 6.5, 50], [x + 7, 62], [x, 63]);
    for (const y of [54, 58, 61]) stroke('#ad773d', .9, [x + .5, y], [x + 6.2, y - .5]);
  }
  stroke(shine, .75, [22, 67], [32, 68], [42, 67]);
  c.restore();
}

/** Keep the existing oval and foot pivot so soles land on the same atlas rows. */
export function drawPresetShoe(
  c: CanvasRenderingContext2D, x: number, y: number, width: number, height: number,
  angle: number, color: string, ink: string, side: boolean, back: boolean, dress: boolean,
) {
  c.save(); c.translate(x, y); c.rotate(angle);
  c.beginPath(); c.ellipse(0, 0, width, height, 0, 0, Math.PI * 2);
  c.save(); c.clip();
  const upper = c.createLinearGradient(0, -height, 0, height);
  upper.addColorStop(0, dress ? '#6c5060' : color);
  upper.addColorStop(1, dress ? '#332830' : '#746052');
  c.fillStyle = upper; c.fillRect(-width, -height, width * 2, height * 2);
  c.fillStyle = dress ? '#2d252d' : '#f2d8ad';
  c.fillRect(-width, height * .28, width * 2, height);
  c.strokeStyle = dress ? '#aa7780' : '#fff1d1';
  c.lineWidth = .68;
  c.beginPath();
  if (back || dress) {
    const cap = side ? width * .5 : 0;
    c.moveTo(cap - 3, -height * .35); c.quadraticCurveTo(cap, -height * .92, cap + 3, -height * .35);
  } else {
    const lace = side ? width * .12 : 0;
    for (const offset of [-2, 1]) {
      c.moveTo(lace + offset - .6, -height * .68);
      c.lineTo(lace + offset + 1, -height * .13);
    }
  }
  c.stroke(); c.restore();
  c.beginPath(); c.ellipse(0, 0, width, height, 0, 0, Math.PI * 2);
  c.strokeStyle = ink; c.lineWidth = .6; c.stroke();
  c.restore();
}
