import type { frontalArmPose } from './frontalWalk';
import { drawProfileArm, type profileArmPose } from './profileWalk';

type Point = readonly [x: number, y: number];
type Cloth = { light: string; dark: string };

/** Paint details in the current torso path, which already follows the animated shoulders. */
export function drawPresetClothing(
  c: CanvasRenderingContext2D, person: number, cloth: Cloth, side: boolean, back: boolean,
  rearSleeves: ReadonlyArray<ReturnType<typeof frontalArmPose>> = [],
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
    // The side panel spans the back and the front edge visible beside the sleeve.
    const depth = c.createLinearGradient(18, 0, 43, 0);
    depth.addColorStop(0, 'rgba(47, 28, 46, .34)');
    depth.addColorStop(1, 'rgba(47, 28, 46, 0)');
    c.fillStyle = depth; c.fillRect(17, 45, 30, 25);
    switch (person) {
      case 0:
        for (const y of [54, 59, 64]) {
          stroke(seam, 1.6, [19, y - 1], [29, y + .2], [42, y]);
          stroke(shine, .85, [35, y - 1.2], [42, y - 1.4]);
        }
        stroke(brass, 1.25, [44, 51], [43, 65]);
        break;
      case 1:
      case 4: {
        const lining = person === 1 ? light : '#bc7382';
        panel(lining, [36, 48], [45, 49], [43, 56], [39, 54]);
        stroke(seam, 1.25, [24, 52], [25, 61], [23, 67]);
        pocket(35, 59, 9, dark);
        stroke(lining, 1.1, [37, 60], [43, 60]);
        break;
      }
      case 2:
        panel(dark, [19, 49], [44, 50], [44, 55], [20, 54]);
        pocket(35, 56, 9);
        stroke(light, 1.1, [36, 65], [43, 64]);
        break;
      case 3:
        panel(dark, [21, 49], [31, 49], [37, 64], [31, 68], [20, 65]);
        stroke('#f4dba9', 1.6, [35, 51], [39, 64]);
        stroke(light, 1.8, [28, 65], [42, 65]);
        break;
      case 5:
        panel('#965470', [19, 49], [45, 51], [44, 56], [20, 54]);
        for (const y of [57, 63]) {
          stroke(seam, 2.8, [37, y], [44, y + .6]);
          stroke(light, 1.2, [39, y - .15], [44, y + .35]);
        }
        break;
      case 7:
        panel(dark, [20, 49], [29, 49], [32, 65], [27, 67], [20, 64]);
        panel(light, [38, 48], [45, 48], [44, 55], [42, 57]);
        pocket(36, 58, 9);
        stroke(brass, 1.2, [35, 61], [39, 63], [43, 61]);
        break;
      case 8:
        panel(light, [22, 47], [44, 48], [45, 53], [23, 52]);
        panel(light, [37, 51], [44, 51], [45, 63], [39, 64]);
        for (const y of [55, 59, 62]) stroke('#ad773d', .85, [39, y], [44, y - .6]);
        stroke(dark, 1.3, [34, 54], [36, 58], [35, 63], [37, 67]);
        break;
      case 9:
        panel(dark, [19, 49], [31, 47], [37, 52], [30, 57], [20, 54]);
        stroke('#988395', 1.4, [22, 54], [31, 56], [37, 52]);
        stroke(brass, 1.25, [39, 52], [44, 65]);
        button(42, 56, '#f1dbc0', 1);
        break;
      case 10:
        for (const y of [55, 62, 68]) {
          stroke(light, 3.2, [20, y - 1], [31, y], [44, y - .5]);
          stroke(dark, .8, [21, y + 1.2], [34, y + 1.7], [43, y + 1.2]);
        }
        break;
      case 11:
        panel(dark, [20, 60], [32, 59], [41, 58], [45, 64], [43, 68], [20, 68]);
        stroke(shine, 1.25, [32, 61], [39, 60], [43, 64]);
        stroke(light, 1.35, [40, 49], [40, 55]);
        break;
      case 12:
        panel(dark, [35, 48], [46, 48], [45, 57], [40, 62], [39, 55]);
        panel(light, [40, 56], [43, 54], [45, 56], [44, 57.5]);
        stroke(seam, 1.4, [23, 52], [26, 60], [23, 67]);
        button(42, 64, '#dac392', 1.15);
        break;
    }
  } else if (back) {
    switch (person) {
      case 0:
      case 11:
        c.beginPath(); c.moveTo(19, 44);
        c.quadraticCurveTo(32, 47, 45, 44);
        c.quadraticCurveTo(44, 55, 32, 58);
        c.quadraticCurveTo(21, 55, 19, 44);
        c.fillStyle = dark; c.fill();
        stroke(light, 1.45, [23, 51], [32, 55], [41, 51]);
        if (person === 0) {
          for (const y of [59, 65]) stroke(seam, 1.6, [15, y - .6], [32, y], [49, y - .6]);
        } else {
          panel(dark, [16, 64], [32, 66], [48, 64], [48, 70], [16, 70]);
          stroke(shine, 1.1, [21, 65], [32, 66], [43, 65]);
        }
        break;
      case 1:
      case 4: {
        const lining = person === 1 ? light : '#bc7382';
        stroke(seam, 1.15, [32, 55], [32, 68]);
        panel(dark, [16, 62], [48, 62], [47, 66], [17, 66]);
        stroke(lining, 1.65, [19, 63], [32, 64], [45, 63]);
        button(26, 64, lining, 1.25);
        button(38, 64, lining, 1.25);
        break;
      }
      case 2:
        panel(dark, [17, 47], [32, 49], [47, 47], [45, 55], [32, 57], [19, 55]);
        stroke(light, 1.35, [19, 54], [32, 56], [45, 54]);
        stroke(seam, 1.45, [32, 56], [32, 67]);
        break;
      case 3:
        panel(dark, [17, 47], [47, 47], [46, 54], [32, 58], [18, 54]);
        stroke('#f4dba9', 1.6, [20, 53], [32, 56], [44, 53]);
        stroke(light, 1.65, [17, 65], [32, 67], [47, 65]);
        break;
      case 5:
        panel('#965470', [18, 48], [46, 48], [45, 55], [32, 59], [19, 55]);
        stroke(dark, 2.8, [21, 53], [32, 57], [43, 53]);
        stroke(shine, 1.1, [22, 54], [32, 57], [42, 54]);
        stroke(seam, 1.35, [32, 59], [32, 68]);
        break;
      case 7:
        panel(dark, [23, 47], [41, 47], [39, 64], [43, 68], [21, 68], [25, 64]);
        stroke(shine, 1.15, [24, 57], [32, 61], [40, 57]);
        stroke(brass, 1.5, [25, 64], [32, 63], [39, 64]);
        button(32, 63, brass, 1.35);
        break;
      case 8:
        for (const x of [23, 31, 39]) stroke(dark, 1.25, [x, 54], [x + 2, 58], [x, 63], [x + 2, 67]);
        panel(light, [17, 45], [47, 45], [45, 52], [32, 54], [19, 52]);
        panel(light, [20, 49], [28, 51], [27, 64], [20, 63]);
        for (const y of [54, 58, 62]) stroke('#ad773d', .9, [21, y], [27, y + .5]);
        break;
      case 9:
        panel(dark, [17, 47], [32, 50], [47, 47], [45, 56], [32, 60], [19, 56]);
        stroke('#988395', 1.45, [19, 54], [32, 58], [45, 54]);
        stroke(seam, 1.4, [32, 60], [32, 68]);
        break;
      case 10:
        for (const y of [55, 62, 68]) {
          stroke(light, 3.2, [14, y - .8], [32, y], [50, y - .8]);
          stroke(dark, .8, [18, y + 1.1], [32, y + 1.7], [46, y + 1.1]);
        }
        break;
      case 12:
        stroke(dark, 2.7, [18, 50], [26, 53], [38, 53], [46, 50]);
        stroke(shine, 1.05, [20, 51], [27, 54], [37, 54], [44, 51]);
        stroke(dark, 1.5, [32, 55], [32, 64], [34, 68]);
        stroke(shine, .8, [31, 58], [31, 64], [32, 67]);
        break;
    }
    for (const { wrist } of rearSleeves) {
      stroke(seam, 1.6, [wrist.x - 2.65, wrist.y - 1.6], [wrist.x + 2.65, wrist.y - 1.6]);
      stroke(shine, .7, [wrist.x - 2.2, wrist.y - 2.4], [wrist.x + 2.2, wrist.y - 2.4]);
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
  if (person === 8 && !side && !back) {
    c.beginPath(); c.roundRect(19, 46, 26, 7, 2.5);
    c.fillStyle = light; c.fill();
    const x = 37;
    panel(light, [x, 50], [x + 6.5, 50], [x + 7, 62], [x, 63]);
    for (const y of [54, 58, 61]) stroke('#ad773d', .9, [x + .5, y], [x + 6.2, y - .5]);
  }
  stroke(shine, .75, [22, 67], [32, 68], [42, 67]);
  c.restore();
}

/** The sleeve's trim follows the same elbow and cuff as the walking arm. */
export function drawPresetProfileSleeve(
  c: CanvasRenderingContext2D, pose: ReturnType<typeof profileArmPose>,
  palette: { shirt: string; skin: string }, ink: string, far: boolean,
) {
  const { shirt, skin } = palette;
  if (far) {
    const color = Number.parseInt(shirt.slice(1), 16);
    const red = Math.round((color >>> 16) * .75 + 13);
    const green = Math.round((color >>> 8 & 255) * .75 + 8);
    const blue = Math.round((color & 255) * .75 + 12);
    drawProfileArm(c, pose, `rgb(${red}, ${green}, ${blue})`, skin, ink);
    return;
  }
  drawProfileArm(c, pose, shirt, skin, ink);
  const { elbow, wrist } = pose;
  const dx = wrist.x - elbow.x;
  const dy = wrist.y - elbow.y;
  const length = Math.hypot(dx, dy);
  const normalX = dy / length;
  const normalY = -dx / length;
  const cuffX = wrist.x - dx * .19;
  const cuffY = wrist.y - dy * .19;

  c.beginPath(); c.moveTo(elbow.x - normalX * 2.4, elbow.y - normalY * 2.4);
  c.quadraticCurveTo(elbow.x - 2, cuffY - 2.7, cuffX - normalX * 2.05, cuffY - normalY * 2.05);
  c.strokeStyle = 'rgba(255, 234, 192, .34)'; c.lineWidth = 1.15; c.stroke();
  c.beginPath(); c.moveTo(cuffX - normalX * 2.35, cuffY - normalY * 2.35);
  c.lineTo(cuffX + normalX * 2.35, cuffY + normalY * 2.35);
  c.strokeStyle = 'rgba(52, 30, 44, .49)'; c.lineWidth = 1.2; c.stroke();
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
  if (back) {
    c.moveTo(-width * .36, -height * .38);
    c.quadraticCurveTo(0, height * .13, width * .36, -height * .38);
    c.moveTo(0, -height * .72); c.lineTo(0, height * .12);
  } else if (side) {
    c.moveTo(-width * .65, -height * .54);
    c.lineTo(-width * .51, height * .16);
    c.moveTo(width * .38, -height * .56);
    c.quadraticCurveTo(width * .49, -height * .28, width * .73, -height * .18);
  } else if (dress) {
    c.moveTo(-3, -height * .35); c.quadraticCurveTo(0, -height * .92, 3, -height * .35);
  } else {
    for (const offset of [-2, 1]) {
      c.moveTo(offset - .6, -height * .68);
      c.lineTo(offset + 1, -height * .13);
    }
  }
  c.stroke(); c.restore();
  c.beginPath(); c.ellipse(0, 0, width, height, 0, 0, Math.PI * 2);
  c.strokeStyle = ink; c.lineWidth = .6; c.stroke();
  c.restore();
}
