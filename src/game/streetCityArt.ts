import { STREET } from '../shared/street';

export const STREET_CITY_HEIGHT = 1200;

// Heights and lighting are fixed so the neighborhood stays in place as the camera follows the stairs.
export function paintStreetCity(c: CanvasRenderingContext2D) {
  const { width } = STREET;
  c.translate(0, STREET_CITY_HEIGHT);

  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  };
  const shape = (points: [number, number][], color: string | CanvasGradient) => {
    c.beginPath();
    c.moveTo(...points[0]);
    for (const point of points.slice(1)) c.lineTo(...point);
    c.closePath();
    c.fillStyle = color;
    c.fill();
  };
  const glow = (x: number, y: number, radius: number, color: string) => {
    const light = c.createRadialGradient(x, y, 0, x, y, radius);
    light.addColorStop(0, color);
    light.addColorStop(1, 'transparent');
    c.fillStyle = light;
    c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };

  const sky = c.createLinearGradient(0, -STREET_CITY_HEIGHT, 0, -260);
  sky.addColorStop(0, '#222d49');
  sky.addColorStop(.45, '#414d6c');
  sky.addColorStop(.78, '#786984');
  sky.addColorStop(1, '#ba8c92');
  c.fillStyle = sky;
  c.fillRect(0, -STREET_CITY_HEIGHT, width, STREET_CITY_HEIGHT);
  glow(535, -325, 330, '#e6a99e66');
  glow(2245, -325, 400, '#e6a99e55');

  for (let i = 0; i < 46; i++) {
    const x = (i * 197 + 51) % width;
    const y = -1180 + (i * 113) % 520;
    rect(x, y, i % 4 === 0 ? 2 : 1, 1, '#edf0ff65');
  }
  for (const [x, y, w] of [[0, -622, 475], [290, -510, 530], [1820, -590, 570], [2280, -458, 480]]) {
    shape([[x, y], [x + w * .68, y - 9], [x + w, y - 3], [x + w * .83, y + 8], [x + w * .13, y + 12]], '#dfb3be20');
  }

  const towers = [66, 118, 88, 160, 76, 102, 54, 131, 82];
  for (let i = 0, x = -26; x < width; i++) {
    const w = 38 + (i * 19) % 58;
    const base = -278;
    const top = base - towers[(i + Math.floor(i / 6)) % towers.length];
    rect(x, top, w, base - top, i % 2 ? '#59556f' : '#655b75');
    rect(x + 8, top - 8, w - 20, 8, '#655b75');
    if (i % 5 === 3) rect(x + w * .65, top - 28, 2, 25, '#655b75');
    for (let y = top + 14; y < base - 4; y += 14) {
      for (let wx = x + 10; wx < x + w - 7; wx += 13) {
        if ((wx + y + i) % 7 < 2) rect(wx, y, 3, 3, '#d7b6a3');
      }
    }
    x += w - 5;
  }

  const haze = c.createLinearGradient(0, -365, 0, -200);
  haze.addColorStop(0, 'transparent');
  haze.addColorStop(.56, '#ab8b9d');
  haze.addColorStop(1, '#838aa1');
  c.fillStyle = haze;
  c.fillRect(0, -365, width, 365);

  // Low roofs break up the horizon between the distant towers and the blocks by the road.
  for (let i = 0, x = -16; x < width; i++) {
    const w = 41 + (i * 17) % 55;
    const base = -185 - i % 4 * 9;
    const y = base - 35 - i % 5 * 8;
    rect(x, y, w, base - y, i % 2 ? '#75778e' : '#6c728a');
    shape([[x - 3, y], [x + w * .4, y - 16], [x + w + 2, y], [x + w - 7, y + 2]], '#a0a0b2');
    for (let wx = x + 9; wx < x + w - 6; wx += 14) {
      if ((wx + i) % 4 !== 0) rect(wx, y + 13, 4, 5, '#d3ae95');
    }
    x += w + 8;
  }

  // Snowy lots and short side streets lead from the skyline to the far curb of the casino road.
  rect(0, -155, width, 155, '#8d99ac');
  rect(0, -29, width, 21, '#a2acbb');
  for (let x = 42; x < width; x += 58) rect(x, -29, 1, 21, '#8794a6');
  rect(0, -8, width, 4, '#ced4dd');
  rect(0, -4, width, 4, '#738398');
  const asphalt = c.createLinearGradient(0, -210, 0, 0);
  asphalt.addColorStop(0, '#778197');
  asphalt.addColorStop(1, '#303d50');
  for (const [x, farWidth, nearWidth] of [[185, 18, 45], [595, 20, 52], [1050, 20, 60], [1750, 20, 54], [2260, 18, 50], [2640, 21, 58]]) {
    shape([[x - 5, -202], [x + farWidth + 4, -202], [x + nearWidth + 8, 0], [x - 20, 0]], '#aab4c3');
    shape([[x, -202], [x + farWidth, -202], [x + nearWidth, 0], [x - 12, 0]], asphalt);
  }

  const blocks = [
    [-22, -70, 152, 100], [251, -118, 98, 115], [366, -90, 169, 88], [674, -71, 155, 112],
    [858, -111, 123, 132], [1129, -82, 145, 99], [1290, -121, 124, 131], [1478, -74, 190, 118],
    [1830, -94, 142, 117], [1999, -67, 165, 88], [2345, -90, 127, 126], [2495, -114, 106, 96], [2709, -71, 122, 100],
  ];
  blocks.forEach(([x, base, w, h], i) => {
    const y = base - h;
    const side = 14;
    shape([[x, y], [x + w, y], [x + w + side, y - 13], [x + side, y - 13]], '#aeb4c3');
    shape([[x + w, y], [x + w + side, y - 13], [x + w + side, base - 12], [x + w, base]], '#404c65');
    rect(x, y, w, h, ['#555d76', '#62637c', '#515c75'][i % 3]);
    rect(x - 2, y, w + 3, 4, '#c2c4d0');
    for (let floor = 0, wy = y + 17; wy < base - 10; floor++, wy += 20) {
      for (let column = 0, wx = x + 11; wx < x + w - 11; column++, wx += 19) {
        const lamp = (i * 5 + floor * 7 + column * 3 + floor * column) % 11;
        if (lamp < 4) {
          glow(wx + 4, wy + 5, 11, '#ffc58448');
          rect(wx, wy, 8, 10, lamp === 0 ? '#f6cb94' : '#cfab8e');
          rect(wx + 3, wy, 1, 10, '#836d71');
        } else {
          rect(wx, wy, 8, 10, '#424e67');
        }
      }
    }
    rect(x + 5, base - 3, w - 8, 3, '#707f94');
  });

  for (const [x, y, h] of [[149, -42, 36], [286, -47, 45], [540, -56, 40], [738, -43, 30], [1351, -56, 42], [1977, -50, 37], [2204, -48, 36], [2523, -46, 41]]) {
    rect(x - 2, y - 12, 4, 13, '#566378');
    shape([[x, y - h], [x + h * .31, y - 6], [x, y - 2], [x - h * .31, y - 6]], '#566b7b');
    shape([[x, y - h], [x + h * .2, y - 13], [x - 2, y - 19], [x - h * .2, y - 13]], '#b5beca');
  }
  for (const x of [62, 310, 570, 846, 1120, 1572, 1851, 2100, 2365, 2600]) {
    glow(x, -19, 37, '#ffd69a70');
    rect(x, -53, 2, 33, '#435268');
    rect(x - 4, -55, 10, 4, '#ffe0a8');
    glow(x + 1, -53, 13, '#ffd69a80');
  }
}
