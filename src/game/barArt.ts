type Paint = CanvasRenderingContext2D;
type Make = (key: string, width: number, height: number, draw: (c: Paint) => void) => void;
const brass = '#c8944e', edge = '#261d29';
const rect = (c: Paint, x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
const line = (c: Paint, x: number, y: number, ex: number, ey: number, color: string, width = 1) => {
  c.beginPath(); c.moveTo(x, y); c.lineTo(ex, ey); c.strokeStyle = color; c.lineWidth = width; c.stroke();
};
const ellipse = (c: Paint, x: number, y: number, rx: number, ry: number, color: string) => {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
};
function panel(c: Paint, x: number, y: number, w: number, h: number) {
  rect(c, x, y, w, h, '#3a242b'); rect(c, x + 1, y + 1, w - 2, h - 2, '#875332');
  rect(c, x + 3, y + 3, w - 6, h - 6, '#4e3030');
  c.strokeStyle = '#ac7745'; c.lineWidth = .65; c.strokeRect(x + 5, y + 5, w - 10, h - 10);
  for (let n = 0; n < w - 12; n += 4) line(c, x + 6 + n, y + 6, x + 6 + n, y + h - 6, n % 3 ? '#603b31' : '#6c4131', .45);
}
function bottle(c: Paint, x: number, bottom: number, width: number, height: number, color: string) {
  rect(c, x - 1, bottom - height + 5, width + 2, height - 5, edge);
  rect(c, x, bottom - height + 5, width, height - 6, color);
  rect(c, x + width * .33, bottom - height, width * .34, 7, color);
  rect(c, x + width * .3, bottom - height, width * .4, 2, brass);
  rect(c, x + 1, bottom - 10, width - 2, 6, '#d5b77f');
  rect(c, x + 2, bottom - height + 7, 1, Math.max(1, height - 20), '#b6bb9a');
  line(c, x + 2, bottom - 2, x + width - 1, bottom - 2, '#baab79', .5);
}
function glass(c: Paint, x: number, y: number) {
  c.strokeStyle = '#d4c1a0'; c.lineWidth = .8;
  c.beginPath(); c.moveTo(x - 3, y + 7); c.lineTo(x - 3, y + 3); c.lineTo(x, y); c.lineTo(x + 3, y + 3); c.lineTo(x + 3, y + 7); c.closePath(); c.stroke();
  line(c, x, y, x, y - 4, '#e4c394', .8); line(c, x - 2, y - 4, x + 2, y - 4, '#e4c394', .8);
}

/** Native, layered room art retains the existing collision and seating footprints. */
export function createBarArt(make: Make) {
  make('bar-back', 248, 99, c => {
    rect(c, 0, 0, 248, 99, edge); rect(c, 2, 2, 244, 95, '#744d35'); rect(c, 4, 3, 240, 93, brass);
    rect(c, 7, 6, 234, 87, '#223338');
    const shade = c.createLinearGradient(0, 8, 0, 94); shade.addColorStop(0, '#27363a'); shade.addColorStop(.6, '#263d40'); shade.addColorStop(1, '#17292d');
    c.fillStyle = shade; c.fillRect(9, 7, 230, 84);
    for (const x of [11, 85, 163, 237]) { rect(c, x, 8, 2, 81, '#172c30'); line(c, x + 2, 8, x + 2, 88, '#425451', .6); }
    for (const [x, w, h, color] of [[18,7,27,'#477766'],[34,12,23,'#9c6635'],[131,7,30,'#8e4053'],[146,12,24,'#9f753c'],[164,8,21,'#547b86']] as const) bottle(c, x, 39, w, h, color);
    for (const [x, w, h, color] of [[17,8,28,'#527c63'],[112,7,25,'#77845b'],[128,10,29,'#8d4950'],[146,8,22,'#a77b3b']] as const) bottle(c, x, 88, w, h, color);
    for (const y of [40, 89]) {
      rect(c, 7, y, 234, 5, '#69432d'); rect(c, 7, y, 234, 1, '#ddae61');
      rect(c, 9, y + 5, 230, 1, '#f0bd62');
      const warm = c.createLinearGradient(0, y + 6, 0, y + 16); warm.addColorStop(0, '#dfa14e35'); warm.addColorStop(1, '#dfa14e00');
      c.fillStyle = warm; c.fillRect(9, y + 6, 230, 10);
    }
    for (const x of [61, 71, 81, 173, 183]) glass(c, x, 58);
    line(c, 55, 49, 87, 49, brass, 1.5); line(c, 168, 49, 188, 49, brass, 1.5);
    // Small espresso machine, with feet and a cup beneath its group head.
    rect(c, 193, 59, 39, 28, edge); rect(c, 195, 60, 35, 8, '#9e8061'); rect(c, 197, 69, 31, 17, '#3d3432');
    for (const x of [201, 209, 217, 225]) ellipse(c, x, 64, 1.2, 1.2, '#e1b77b');
    rect(c, 208, 69, 10, 3, '#bba589'); line(c, 218, 71, 226, 71, '#d0b291', 1.7);
    rect(c, 207, 76, 9, 7, '#efe2bc'); ellipse(c, 217, 79, 2.5, 2.5, '#d3c7a7'); rect(c, 208, 77, 7, 5, '#efe2bc');
    rect(c, 194, 84, 38, 3, '#a98b64'); rect(c, 198, 54, 8, 5, '#e9dbb4'); rect(c, 210, 54, 8, 5, '#e9dbb4');
    // One plant is a personal detail, leaving air around the bottle groups.
    rect(c, 218, 31, 12, 8, '#a47749'); rect(c, 216, 30, 16, 2, '#d4a365');
    for (const [x, y, angle] of [[220,28,-.8],[226,26,.6],[215,25,-.4],[230,22,.7],[222,20,-.8],[233,29,.4]] as const) {
      c.save(); c.translate(x, y); c.rotate(angle); ellipse(c, 0, 0, 5, 2, '#7a8b49'); ellipse(c, 1, -.4, 3, .7, '#b2ad5c'); c.restore();
    }
  });
  make('bar-lamps', 262, 138, c => {
    for (const x of [64, 207]) {
      const light = c.createRadialGradient(x, 49, 2, x, 49, 57); light.addColorStop(0, '#ffcc7038'); light.addColorStop(1, '#ffcc7000');
      c.fillStyle = light; c.fillRect(x - 55, 39, 110, 98);
      line(c, x, 0, x, 37, '#2b2026', 2.6); line(c, x - .5, 0, x - .5, 36, brass, .7);
      rect(c, x - 2, 34, 4, 5, '#b67a3c');
      c.beginPath(); c.moveTo(x - 4, 38); c.lineTo(x - 13, 48); c.lineTo(x + 13, 48); c.lineTo(x + 4, 38); c.closePath();
      c.fillStyle = '#65432d'; c.fill(); c.strokeStyle = '#d3a05a'; c.lineWidth = 1; c.stroke();
      ellipse(c, x, 49, 13, 2, '#d7a158'); ellipse(c, x, 50, 8, 2, '#f8d28b'); ellipse(c, x, 51, 3, 3, '#ffe5aa');
    }
  });
  make('bar-front', 262, 72, c => {
    ellipse(c, 132, 67, 121, 4, '#211a2780');
    rect(c, 6, 26, 250, 42, '#36252c');
    panel(c, 10, 31, 64, 35); panel(c, 77, 31, 108, 35); panel(c, 188, 31, 64, 35);
    rect(c, 12, 30, 238, 2, '#a46b3c');
    const wood = c.createLinearGradient(0, 12, 0, 28); wood.addColorStop(0, '#65402e'); wood.addColorStop(.5, '#96603b'); wood.addColorStop(1, '#4d302b');
    c.fillStyle = wood; c.fillRect(1, 13, 260, 16);
    for (let y = 15; y < 25; y += 2) line(c, 4, y, 258, y, y % 3 ? '#b17b454a' : '#3e27298a', .5);
    line(c, 2, 14, 260, 14, '#c18b48', 1.3); line(c, 2, 28, 260, 28, '#bc8244', 1.5);
    rect(c, 91, 40, 80, 16, '#4b2d32'); c.strokeStyle = brass; c.lineWidth = .7; c.strokeRect(89, 39, 84, 18);
    for (const x of [17, 73, 188, 246]) { line(c, x, 62, x, 70, '#b68547', 2); ellipse(c, x, 62, 2, 1.2, '#e3bb73'); }
    line(c, 16, 67, 247, 67, '#cf9b51', 2); line(c, 16, 66, 247, 66, '#ebc586', .6);
    // Contact shadows, flowers, cup and lemon stay in the counter layer.
    ellipse(c, 89, 17, 5, 1.4, '#2f202b80'); rect(c, 86, 7, 6, 9, '#75917b');
    for (const [x, y] of [[85,4],[90,2],[94,5],[88,7]] as const) { line(c, x, y, 89, 11, '#718658', .7); ellipse(c, x, y, 2.4, 2, '#b87579'); ellipse(c, x, y - .5, 1, .8, '#e0aa8c'); }
    ellipse(c, 130, 17, 8, 2, '#c9af7f'); ellipse(c, 137, 11, 2.4, 2.7, '#f2ddb0');
    rect(c, 125, 8, 9, 8, '#efe0bb'); ellipse(c, 129.5, 8, 4.5, 1.8, '#543b2c'); line(c, 126, 12, 126, 15, '#fff1d2', .8);
    ellipse(c, 153, 17, 7, 2, '#c7b087');
    for (const x of [150, 154]) { c.beginPath(); c.arc(x, 13, 3, 0, Math.PI); c.closePath(); c.fillStyle = '#e4b84a'; c.fill(); c.strokeStyle = '#f8d77d'; c.lineWidth = .8; c.stroke(); }
    // Small menu has symbolic lines, with no baked-in locale text.
    rect(c, 177, 1, 18, 18, '#b3824f'); rect(c, 179, 3, 14, 14, '#27312f');
    for (const y of [6, 10, 14]) { rect(c, 181, y, 3, 1, '#d8c49b'); rect(c, 186, y, 5, .6, '#a6a88c'); }
  });
  make('bar-stool', 48, 44, c => {
    ellipse(c, 24, 40, 17, 3.5, '#211a2765');
    rect(c, 22, 13, 4, 24, '#92713f'); rect(c, 23, 14, 1, 23, '#e1bb73');
    ellipse(c, 24, 38, 13, 3, '#574b3b'); ellipse(c, 24, 37, 12, 2, '#b18b50'); ellipse(c, 24, 37, 6, 1, '#dfb979');
    ellipse(c, 24, 11, 18, 7, '#482938'); ellipse(c, 24, 9, 18, 6, '#804255');
    ellipse(c, 24, 7, 17, 5, '#ad5e73'); line(c, 9, 12, 39, 12, '#c99b62', .8);
    for (const x of [12, 18, 25, 32, 37]) ellipse(c, x, 5 + x % 3, .5, .35, '#d48c99');
  });
}
