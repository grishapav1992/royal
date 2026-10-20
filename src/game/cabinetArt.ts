import type { Cabinet } from '../shared/cabinets';

import { CABINET_SCALE, CABINET_SIZE } from '../shared/cabinetGeometry';
export { CABINET_SCALE, CABINET_SIZE };

export function paintGirlhubLogo(c: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  c.save();
  c.translate(x, y); c.scale(width / 128, height / 32);
  c.beginPath(); c.roundRect(1, 1, 126, 30, 5);
  c.fillStyle = '#101010'; c.fill(); c.strokeStyle = '#ff9900'; c.lineWidth = 1.5; c.stroke();
  c.font = '900 20px Arial, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
  const girlWidth = c.measureText('GIRL').width, hubWidth = c.measureText('HUB').width;
  const start = (128 - girlWidth - hubWidth - 12) / 2;
  c.fillStyle = '#ffffff'; c.fillText('GIRL', start, 17);
  c.beginPath(); c.roundRect(start + girlWidth + 3, 4, hubWidth + 9, 24, 3);
  c.fillStyle = '#ff9900'; c.fill();
  c.fillStyle = '#101010'; c.fillText('HUB', start + girlWidth + 7, 17);
  c.restore();
}

// Screen coordinates belong to the same drawing as the cabinet body.
export function cabinetScreen(cabinet: Cabinet) {
  return cabinet.provider
    ? { x: 14, y: 28, width: 56, height: 43 }
    : { x: 19, y: 29, width: 46, height: 42 };
}

export function paintCabinet(c: CanvasRenderingContext2D, cabinet: Cabinet) {
  const accent = '#' + cabinet.color.toString(16).padStart(6, '0');
  const panel = (x: number, y: number, w: number, h: number, color: string, radius = 2) => {
    c.beginPath(); c.roundRect(x, y, w, h, radius);
    c.fillStyle = color; c.fill(); c.strokeStyle = '#192430'; c.lineWidth = 1.4; c.stroke();
  };
  const line = (x: number, y: number, x2: number, y2: number, color: string, width = 1) => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  };
  const text = (value: string, y: number, size: number, color: string) => {
    c.font = `bold ${size}px Arial, sans-serif`; c.textAlign = 'center'; c.fillStyle = color; c.fillText(value, 42, y);
  };
  if (cabinet.provider) {
    // A lit casino cabinet has a brass frame and a full burgundy base.
    panel(5, 3, 74, 87, '#ca9f52', 8);
    panel(8, 6, 68, 78, '#572338', 6);
    panel(11, 9, 62, 15, '#271826', 3);
    text('ROYAL CASINO', 19, 7, '#ffe2a0');
    panel(10, 25, 64, 50, '#171e26', 4);
    line(8, 28, 8, 72, '#f2ca78', 2); line(76, 28, 76, 72, '#f2ca78', 2);
    panel(5, 78, 74, 14, '#a4804f', 3);
    panel(13, 80, 21, 8, '#332833', 2);
    for (const [x, color] of [[45, '#75d8be'], [56, '#f4c76b'], [67, '#e28799']] as const) {
      c.beginPath(); c.ellipse(x, 85, 3.1, 2.3, 0, 0, Math.PI * 2); c.fillStyle = color; c.fill();
    }
    panel(10, 93, 64, 20, '#442032', 2);
    line(16, 97, 68, 97, '#c19b5a');
    panel(45, 100, 17, 5, '#241d28', 1);
    line(48, 102, 59, 102, '#f0d199');
    for(const x of [21,25,29])line(x,101,x,109,'#af854b');
    panel(7, 114, 70, 6, '#2c1925', 2);
    line(12, 116, 72, 116, '#f2ca78', 1.5);
  } else {
    // A brass and walnut slot cabinet with a stepped Art Deco crown.
    panel(8, 9, 68, 108, '#564037', 4);
    panel(15, 3, 54, 10, '#cba568', 2);
    panel(23, 1, 38, 6, '#f0d397', 1);
    panel(13, 13, 58, 12, '#302b32', 2);
    text(cabinet.demo ? 'ROYAL PLAY' : cabinet.id === 'royal-coins' ? 'ROYAL GAMES' : cabinet.name.toUpperCase(), 22, 6.3, accent);
    panel(15, 26, 54, 48, '#d0ad72', 3);
    for (const x of [11, 73]) line(x, 28, x, 76, '#f0d598', 2);
    panel(8, 78, 68, 15, '#b78650', 2);
    for (const x of [28, 42, 56]) {
      c.beginPath(); c.ellipse(x, 85, 4, 2.6, 0, 0, Math.PI * 2); c.fillStyle = x === 42 ? '#a54256' : '#efd49b'; c.fill();
    }
    panel(14, 96, 56, 17, '#382c32', 2);
    for (const x of [22, 26, 30]) line(x, 101, x, 108, '#a9855d');
    panel(45, 100, 15, 5, '#1d222b', 1);
    line(48, 102, 57, 102, '#dfc387');
    panel(8, 115, 68, 5, '#302731', 1);
    line(14, 117, 70, 117, accent, 1.5);
  }
  const screen = cabinetScreen(cabinet);
  c.fillStyle = '#0c1e2a'; c.fillRect(screen.x, screen.y, screen.width, screen.height);
}
