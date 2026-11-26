import { STREET } from '../shared/street';

export const STREET_CITY_HEIGHT = 1200;

const distantBuildings = [
  { x: -40, roof: -560, width: 250, wall: '#acb9cc', shade: '#9eacc2' },
  { x: 410, roof: -595, width: 270, wall: '#aebbd0', shade: '#a0aec4' },
  { x: 815, roof: -620, width: 235, wall: '#afbdd0', shade: '#a2b1c7' },
  { x: 1190, roof: -570, width: 290, wall: '#a9b8cb', shade: '#9cabc0' },
  { x: 1735, roof: -605, width: 280, wall: '#aebbd0', shade: '#a1afc5' },
  { x: 2090, roof: -557, width: 300, wall: '#a9b7cb', shade: '#9cabc2' },
  { x: 2605, roof: -590, width: 200, wall: '#aebcd0', shade: '#a0afc4' },
];

const courtyardBuildings = [
  { x: 350, roof: -540, width: 293, wall: '#929fb4', shade: '#808fa7' },
  { x: 747, roof: -501, width: 337, wall: '#94a1b5', shade: '#8594ab' },
  { x: 1352, roof: -475, width: 290, wall: '#919fb5', shade: '#8291a8' },
  { x: 1848, roof: -509, width: 320, wall: '#95a2b6', shade: '#8493aa' },
  { x: 2210, roof: -469, width: 300, wall: '#929fb3', shade: '#8190a7' },
];

type WinterBuilding = (typeof distantBuildings)[number];

// Paint in rear-view coordinates, where the far curb of the existing road is at y=0.
export function paintStreetCity(c: CanvasRenderingContext2D) {
  const { width } = STREET;
  c.translate(0, STREET_CITY_HEIGHT);

  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  };
  const oval = (x: number, y: number, rx: number, ry: number, color: string) => {
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
  };
  const line = (x: number, y: number, x2: number, y2: number, color: string, thickness: number) => {
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x2, y2);
    c.strokeStyle = color;
    c.lineWidth = thickness;
    c.stroke();
  };

  const sky = c.createLinearGradient(0, -STREET_CITY_HEIGHT, 0, -285);
  sky.addColorStop(0, '#b7c8dc');
  sky.addColorStop(.67, '#c6d4e3');
  sky.addColorStop(1, '#d7e1eb');
  c.fillStyle = sky;
  c.fillRect(0, -STREET_CITY_HEIGHT, width, STREET_CITY_HEIGHT);

  for (const [x, y, w] of [[-45, -911, 790], [630, -834, 830], [1660, -926, 715], [2085, -846, 710]]) {
    c.beginPath();
    c.moveTo(x, y + 15);
    c.bezierCurveTo(x + w * .12, y - 2, x + w * .23, y + 7, x + w * .32, y - 15);
    c.bezierCurveTo(x + w * .44, y - 53, x + w * .59, y - 28, x + w * .67, y - 4);
    c.bezierCurveTo(x + w * .77, y - 9, x + w * .9, y + 7, x + w, y + 16);
    c.bezierCurveTo(x + w * .73, y + 27, x + w * .28, y + 29, x, y + 15);
    c.fillStyle = '#e9eff64d';
    c.fill();
  }

  const snowRoof = (x: number, y: number, w: number, color: string, shadow: string) => {
    rect(x - 7, y, w + 14, 8, shadow);
    c.beginPath();
    c.moveTo(x - 9, y);
    c.quadraticCurveTo(x + w * .06, y - 17, x + w * .27, y - 14);
    c.quadraticCurveTo(x + w * .48, y - 25, x + w * .66, y - 15);
    c.quadraticCurveTo(x + w * .93, y - 17, x + w + 9, y);
    c.quadraticCurveTo(x + w * .66, y + 3, x + w * .38, y);
    c.quadraticCurveTo(x + w * .17, y + 4, x - 9, y);
    c.fillStyle = color;
    c.fill();
  };
  const chimney = (x: number, roof: number, h: number, color: string, cap: string) => {
    rect(x, roof - h, 22, h, color);
    rect(x - 4, roof - h, 30, 5, cap);
    oval(x + 11, roof - h, 15, 3, cap);
  };
  const drawBuildings = (buildings: WinterBuilding[], base: number, snow: string, pane: string) => {
    for (const { x, roof, width: w, wall, shade } of buildings) {
      rect(x, roof, w, base - roof, wall);
      rect(x + w - 12, roof, 12, base - roof, shade);
      chimney(x + w * .32, roof, 29, shade, snow);
      snowRoof(x, roof, w, snow, shade);
      for (let y = roof + 39; y + 47 < base; y += 86) {
        for (let left = x + 24; left + 31 < x + w - 10; left += 61) {
          rect(left, y, 25, 38, pane);
          rect(left + 11, y, 2, 38, wall);
          rect(left - 2, y + 38, 29, 4, snow);
        }
      }
    }
  };

  drawBuildings(distantBuildings, -403, '#d3dfed', '#9cabc0');
  drawBuildings(courtyardBuildings, -381, '#e1eaf4', '#77869e');

  rect(0, -390, width, 390, '#c5d1e0');
  const fenceTop = -419;
  for (const [x, w] of [[360, 342], [1042, 242], [1595, 283], [2065, 381]]) {
    rect(x, fenceTop, w, 62, '#a6b3c5');
    rect(x, fenceTop, w, 4, '#8799b0');
    for (let post = x + 18; post < x + w; post += 24) rect(post, fenceTop + 5, 1, 53, '#8e9eb3');
    rect(x - 3, fenceTop - 3, w + 6, 6, '#e3ecf6');
    oval(x + w * .26, fenceTop + 67, w * .28, 12, '#dce6f1');
    oval(x + w * .73, fenceTop + 62, w * .25, 13, '#dce6f1');
  }
  for (const [x, y, h] of [[436, fenceTop, 53], [602, fenceTop, 66], [943, -384, 53], [1650, fenceTop, 52], [2235, fenceTop, 59], [2380, fenceTop, 56]]) {
    const branch = '#a1aec1';
    line(x, y, x - 4, y - h, branch, 3);
    for (const side of [-1, 1]) {
      line(x, y - 8, x + side * 24, y - h + 18, branch, 2);
      line(x + side * 14, y - h + 31, x + side * 29, y - h + 27, branch, 2);
      line(x - 3, y - h + 18, x + side * 12, y - h + 1, '#e4ecf5', 2);
    }
  }

  // The nearest houses frame the view without covering the road.
  for (const [x, roof, w] of [[91, -672, 329], [2450, -641, 347]]) {
    const base = -278, wall = '#818da2', trim = '#66758a', snow = '#eaf1f8';
    rect(x, roof, w, base - roof, wall);
    rect(x + w - 16, roof, 16, base - roof, trim);
    chimney(x + w * .64, roof, 51, trim, snow);
    snowRoof(x, roof, w, snow, trim);
    for (let y = roof + 35; y + 65 < base; y += 101) {
      for (let left = x + 31; left + 42 < x + w - 19; left += 89) {
        rect(left - 3, y - 4, 48, 69, trim);
        rect(left, y, 42, 59, '#68768a');
        rect(left + 21, y, 3, 59, '#8391a5');
        rect(left, y + 24, 42, 3, '#8391a5');
        rect(left - 5, y + 59, 52, 4, snow);
      }
    }
    for (let y = roof + 29; y < base; y += 30) {
      const offset = y % 4 === 0 ? 9 : 15;
      line(x + offset, y, x + offset + 14, y, '#728096', 1);
      line(x + w - 42 - offset, y, x + w - 17, y, '#728096', 1);
    }
    oval(x + w * .37, base, w * .39, 12, snow);
  }

  rect(0, -24, width, 18, '#b0bbcb');
  rect(0, -6, width, 6, '#e6edf5');
}
