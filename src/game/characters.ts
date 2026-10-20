import { characterGamePose, drawAvatar, drawSeatedGameArm } from './avatarArt';
import { appearanceKey, parseAppearance, SKIN_COLORS, CLOTHING_COLORS } from '../shared/appearance';
import Phaser from 'phaser';
import { drawMira } from './miraArt';
import { drawCitizenGlasses, drawCitizenHatStitch } from './citizenAccessories';
import { drawCitizenHair, isNewCitizenHair } from './citizenHair';
import { drawCitizenFace } from './citizenFace';

import type { Facing } from '../shared/movement';
export type { Facing } from '../shared/movement';
export const DIRECTIONS: Facing[] = ['down', 'left', 'right', 'up'];
export const CHARACTER_RESOLUTION = 3;
export const CHARACTER_SCALE = 1.8 / CHARACTER_RESOLUTION;
const W = 32, H = 48, TOP_PADDING = 8, ATLAS_COLUMNS = 23;

type Palette = { skin: string; shade: string; hair: string; hairLight: string; shirt: string; light: string; dark: string; pants: string; shoes: string; style: 'hoodie' | 'long' | 'cap' | 'jacket'; bartender?: boolean; look?: 'curls' | 'beanie' | 'punk' | 'buns' | 'baseball' | 'silver' | 'swept' | 'bob' | 'ponytail' | 'tousled'; width?: number; glasses?: boolean; hat?: boolean };
const palettes: Palette[] = [
  { skin: '#e8b18b', shade: '#c78468', hair: '#343044', hairLight: '#514255', shirt: '#e94b38', light: '#f4d24b', dark: '#3a9da9', pants: '#3f4967', shoes: '#f0e8d1', style: 'hoodie' },
  { skin: '#efc2a1', shade: '#cd917e', hair: '#644760', hairLight: '#956b8a', shirt: '#996ac5', light: '#d3b6ed', dark: '#725b9b', pants: '#39475e', shoes: '#e9dcdb', style: 'long' },
  { skin: '#a66e53', shade: '#7d4c43', hair: '#292b38', hairLight: '#41414a', shirt: '#ee8b2d', light: '#e9b58a', dark: '#955d49', pants: '#435168', shoes: '#e9d9b7', style: 'jacket' },
  { skin: '#e2ae8d', shade: '#bd7f69', hair: '#4f3c39', hairLight: '#795449', shirt: '#4777b9', light: '#eb5245', dark: '#325b99', pants: '#353a52', shoes: '#e1dcca', style: 'cap' },
  { skin: '#cc946f', shade: '#9f6956', hair: '#c87991', hairLight: '#efabb2', shirt: '#ddc9a9', light: '#f2e4c7', dark: '#a39484', pants: '#726479', shoes: '#eadbd7', style: 'long' },
  { skin: '#e4bd98', shade: '#bf8d73', hair: '#a58251', hairLight: '#ccb177', shirt: '#e05d8c', light: '#f4cd5b', dark: '#528b54', pants: '#3c455c', shoes: '#d9d8c1', style: 'hoodie' },
  { skin: '#efc4a6', shade: '#c58b7d', hair: '#64364a', hairLight: '#a25e6b', shirt: '#f0e0c2', light: '#fff0d9', dark: '#588e85', pants: '#345f5e', shoes: '#efd2a2', style: 'long', bartender: true },
  { skin:'#89563f',shade:'#633d32',hair:'#332728',hairLight:'#715043',shirt:'#bd8b46',light:'#f5dfaa',dark:'#735041',pants:'#37495b',shoes:'#ead9ba',style:'jacket',look:'curls',width:2,glasses:true },
  { skin:'#f0c4ac',shade:'#cd9380',hair:'#ac673a',hairLight:'#dca374',shirt:'#6c99af',light:'#f4c65b',dark:'#325f78',pants:'#394357',shoes:'#faf0d1',style:'hoodie',look:'beanie',width:-2,glasses:true },
  { skin:'#d4a183',shade:'#ac735c',hair:'#a74777',hairLight:'#ea82af',shirt:'#45444f',light:'#e2ce8c',dark:'#272c38',pants:'#604d6a',shoes:'#d9cbb9',style:'jacket',look:'punk',width:-1 },
  { skin:'#bc825a',shade:'#915538',hair:'#39473a',hairLight:'#748260',shirt:'#6cac93',light:'#e9deb6',dark:'#3d7768',pants:'#715b74',shoes:'#e9dfcb',style:'jacket',look:'buns',width:0 },
  { skin:'#e0ab85',shade:'#b77b5d',hair:'#4f3c31',hairLight:'#8d6550',shirt:'#c16d45',light:'#f3cf78',dark:'#327a76',pants:'#3e5163',shoes:'#ebdbb5',style:'hoodie',look:'baseball',width:1 },
  { skin:'#e8c4aa',shade:'#bd917a',hair:'#b4b8b7',hairLight:'#e9e6d9',shirt:'#695e80',light:'#f4e7cf',dark:'#3f3d57',pants:'#3a3b4e',shoes:'#ded0ba',style:'jacket',look:'silver',width:3 },
  { skin:'#d6ad89',shade:'#ae7b60',hair:'#272d36',hairLight:'#505563',shirt:'#388e91',light:'#f2e0b6',dark:'#245b67',pants:'#394655',shoes:'#eee1c7',style:'jacket',look:'swept',width:0 },
  { skin:'#ecc4a4',shade:'#c38c70',hair:'#34303b',hairLight:'#67556a',shirt:'#d16f68',light:'#f5dba9',dark:'#934a52',pants:'#4c485f',shoes:'#f1dfcd',style:'long',look:'bob',width:-2 },
  { skin:'#b77f5c',shade:'#8e573f',hair:'#2d292c',hairLight:'#64504c',shirt:'#9c81b5',light:'#e8cf9e',dark:'#655278',pants:'#475b63',shoes:'#e4d7bc',style:'jacket',look:'ponytail',width:1 },
  { skin:'#e0b08a',shade:'#b77c59',hair:'#30332e',hairLight:'#626751',shirt:'#dfb942',light:'#f6e4af',dark:'#80713e',pants:'#4d5869',shoes:'#f3e8cd',style:'hoodie',look:'tousled',width:-1,hat:false },
];

/** Paper cutout frames keep the same ground anchor in every pose. */
export function createCharacters(scene: Phaser.Scene) {
  palettes.forEach((_, person) => createCharacterTexture(scene, `citizen-${person}`, (ctx, direction, frame, seated, sip) => drawCitizen(ctx, person, direction, frame, seated, sip), person));
}

export function characterTexture(scene: Phaser.Scene, skin: number, serialized = ''): string {
  const appearance = parseAppearance(serialized);
  if (!appearance) return `citizen-${skin}`;
  const key = appearanceKey(appearance);
  if (!scene.textures.exists(key)) createCharacterTexture(scene, key, (ctx, direction, frame, seated, sip) => drawAvatar(ctx, appearance, direction, frame, seated, sip), 0);
  return key;
}

export function characterScaleY(serialized = ''): number {
  return CHARACTER_SCALE * (parseAppearance(serialized)?.body === 2 ? 1.12 : 1);
}

/** The short hug uses the same sleeves and hands as the player's own outfit. */
export function characterHugColors(skin = 0, serialized = '') {
  const appearance=parseAppearance(serialized),palette=palettes[skin]??palettes[0];
  const color=(value:string)=>Number.parseInt(value.slice(1),16);
  return {skin:color(appearance?SKIN_COLORS[appearance.skinTone]:palette.skin),sleeve:color(appearance?CLOTHING_COLORS[appearance.topColor]:palette.shirt)};
}

/** Share the native citizen artwork between map sprites, selection cards and detail previews. */
export function drawCitizen(context: CanvasRenderingContext2D, skin: number, facing: Facing, frame: number, seated = false, sip = -1) {
  const person = Number.isInteger(skin) && skin >= 0 && skin < palettes.length ? skin : 0;
  context.save(); drawFrame(context, palettes[person], facing, frame, seated, sip, person); context.restore();
}

/** Render dialogue portraits from the drawing paths instead of enlarging a room atlas cell. */
export function createCharacterPortrait(skin: number, serialized: string, frame: number, stage = 0): HTMLCanvasElement {
  const resolution = 16;
  const canvas = document.createElement('canvas');
  canvas.width = W * resolution; canvas.height = H * resolution;
  const context = canvas.getContext('2d')!;
  const appearance = parseAppearance(serialized);
  const sipping = frame >= 11 && frame <= 16;
  context.save();
  context.scale(resolution, resolution); context.translate(0, TOP_PADDING);
  if (appearance) drawAvatar(context, appearance, 'down', sipping ? 6 : frame, false, sipping ? frame - 11 : -1);
  else {
    const person = Number.isInteger(skin) && skin >= 0 && skin < palettes.length ? skin : 0;
    drawCitizen(context, person, 'down', sipping ? 6 : frame, false, sipping ? frame - 11 : -1);
  }
  context.restore();
  if (stage) {
    context.fillStyle = `rgba(211, 65, 64, ${.12 + stage * .1})`;
    for (const x of [22, 42]) {
      context.beginPath();
      context.ellipse(x / 64 * canvas.width, canvas.height - 42 / 64 * canvas.width, canvas.width * .069, canvas.width * .0375, 0, 0, Math.PI * 2);
      context.fill();
    }
  }
  return canvas;
}

/** Remove abandoned custom atlases after actors have changed textures or left the hall. */
export function pruneCharacterTextures(scene: Phaser.Scene, active: Set<string>) {
  for (const key of scene.textures.getTextureKeys()) {
    if (!key.startsWith('avatar-v1-') || active.has(key)) continue;
    for (const direction of DIRECTIONS) for (const action of ['walk', 'idle', 'sit', 'drink', 'sitdrink', 'game', 'win', 'lose']) scene.anims.remove(`${key}-${action}-${direction}`);
    scene.textures.remove(key);
  }
}

function createCharacterTexture(scene: Phaser.Scene, key: string, draw: (ctx: CanvasRenderingContext2D, direction: Facing, frame: number, seated: boolean, sip: number) => void, person: number) {
  // Two rows per direction keep every atlas below common mobile texture limits.
  const texture = scene.textures.createCanvas(key, W * ATLAS_COLUMNS * CHARACTER_RESOLUTION, H * 8 * CHARACTER_RESOLUTION)!;
  const ctx = texture.context;
  ctx.scale(CHARACTER_RESOLUTION, CHARACTER_RESOLUTION);
  DIRECTIONS.forEach((direction, row) => {
    const addFrame = (index: number, pose = index, seated = false, sip = -1) => {
      const x = index % ATLAS_COLUMNS * W, y = (row * 2 + Math.floor(index / ATLAS_COLUMNS)) * H;
      ctx.save(); ctx.translate(x, y + TOP_PADDING);
      draw(ctx, direction, pose, seated, sip); ctx.restore();
      texture.add(`${direction}-${index}`, 0, x * CHARACTER_RESOLUTION, y * CHARACTER_RESOLUTION, W * CHARACTER_RESOLUTION, H * CHARACTER_RESOLUTION);
    };
    const animationFrames = (start: number, count: number) => Array.from({ length: count }, (_, i) => ({ key, frame: `${direction}-${start + i}` }));
    for (let frame = 0; frame < 10; frame++) addFrame(frame);
    for (let special = 0; special < 13; special++) {
      addFrame(10 + special, 6, special === 0 || special >= 7, special === 0 ? -1 : (special - 1) % 6);
    }
    for (const [action, start] of [['drink', 11], ['sitdrink', 17]] as const) {
      scene.anims.create({ key: `${key}-${action}-${direction}`, frames: animationFrames(start, 6), frameRate: 6, repeat: -1 });
    }
    scene.anims.create({ key: `${key}-walk-${direction}`, frames: animationFrames(0, 6), frameRate: 12, repeat: -1 });
    for (const extra of [23, 24, 25, 26, 27]) addFrame(extra, extra >= 25 ? [8, 7, 9][extra - 25] : extra, extra >= 25);
    const idle = (index: number, duration: number) => ({ key, frame: `${direction}-${index}`, duration });
    scene.anims.create({ key: `${key}-sit-${direction}`, frames: [
      idle(10, 1800 + person * 163), idle(25, 83), idle(10, 1400), idle(26, 700), idle(27, 500),
    ], frameRate: 12, repeat: -1 });
    scene.anims.create({ key: `${key}-idle-${direction}`, frames: [
      idle(6, 1400 + person * 137), idle(7, 650), idle(24, 83), idle(8, 83),
      idle(6, 1700 + person * 193), idle(9, 800), idle(23, 350), idle(6, 500), idle(24, 83), idle(6, 750),
    ], frameRate: 12, repeat: -1 });
    for (const [action, start] of [['game', 28], ['win', 34], ['lose', 40]] as const) {
      for (let phase = 0; phase < 6; phase++) addFrame(start + phase, start + phase, true);
      scene.anims.create({ key: `${key}-${action}-${direction}`, frames: animationFrames(start, 6), frameRate: action === 'game' ? 7 : 6, repeat: -1 });
    }
  });
  texture.refresh();
}

function drawFrame(c: CanvasRenderingContext2D, p: Palette, facing: Facing, frame: number, seated = false, sip = -1, person = 0) {
  if (p.bartender) { drawMira(c, facing, frame, sip); return; }
  const game = characterGamePose(frame);
  seated ||= !!game;
  const side = facing === 'left' || facing === 'right', back = facing === 'up';
  const hasHat = (p.style === 'hoodie' || p.style === 'cap') && p.hat !== false;
  const newHair = isNewCitizenHair(p.look);
  const walking = frame < 6;
  const step = walking ? [0, 1, .55, 0, -1, -.55][frame] : 0;
  const bounce = walking ? [0, -1.4, -.6, 0, -1.4, -.6][frame] : 0;
  const lean = walking ? [-1.8, 1.8, 2.8, 1.8, -1.8, -2.8][frame] : 0;
  const width = p.width ?? [3, -1, 1, 0, -2, 2, -1][person] ?? 0;
  const headRadius = 22.4 + width * .22;
  const ink = '#39332c';
  // Draw at twice the logical size, and clip each atlas cell before rotating pieces.
  c.beginPath(); c.rect(0, -TOP_PADDING, W, H); c.clip(); c.scale(.5, .5);
  if (facing === 'left') { c.translate(W * 2, 0); c.scale(-1, 1); }
  c.lineJoin = 'round'; c.lineCap = 'round';
  const fill = (color: string, edge = .6) => {
    c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); }
  };
  const oval = (x: number, y: number, rx: number, ry: number, color: string, angle = 0, edge = .6) => {
    c.beginPath(); c.ellipse(x, y, rx, ry, angle, 0, Math.PI * 2); fill(color, edge);
  };
  const box = (x: number, y: number, w: number, h: number, color: string, r = 0) => {
    c.beginPath(); c.roundRect(x, y, w, h, r); fill(color);
  };
  const line = (x: number, y: number, x2: number, y2: number, color = ink, weight = .9) => {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = weight; c.stroke();
  };
  const piece = (x: number, y: number, angle: number, draw: () => void) => {
    c.save(); c.translate(x, y); c.rotate(angle * Math.PI / 180); draw(); c.restore();
  };
  // The planted shoe stays on the ground; the other changes pose in discrete steps.
  for (const leg of [-1, 1]) {
    const swing = step * leg;
    const x = 32 + leg * (side ? 3 : 10) + (side ? swing * 5.5 : swing * 1.3) + (seated ? (side ? 7 : leg * 2) : 0);
    const y = 76 - Math.max(0, swing) * 2.5;
    const legWidth = side ? 10 : 14;
    box(x - legWidth / 2, seated ? 64 : 63 + bounce, legWidth, y - (seated ? 64 : 63 + bounce), p.pants, 1);
    if (game) line(32 + leg * (side ? 3 : 8), 58, x, 65, p.pants, legWidth);
    piece(x + (side ? 2 : 0), y, swing * (side ? -6 : 3), () => {
      const shoeWidth = (side ? 9 : 10) + width * .2;
      oval(0, 0, shoeWidth, 2.7, '#272823');
      c.beginPath(); c.moveTo(-shoeWidth + .8, -.6);
      c.quadraticCurveTo(-shoeWidth + 1, -4.7, side ? -2 : 0, -4.2);
      c.quadraticCurveTo(shoeWidth - 1, -4.5, shoeWidth - .5, -.4);
      c.quadraticCurveTo(0, 1.4, -shoeWidth + .8, -.6); c.closePath(); fill(p.shoes, .5);
      line(-shoeWidth + 2, .5, shoeWidth - 1.5, .5, '#fff5dd', .55);
      if (!back) {
        for (const lace of [-1.5, 1]) line(lace - 1.5, -3.1, lace + 1, -1.5, p.pants, .55);
      } else line(-2.5, -3.2, 2.5, -3.2, p.pants, .7);
    });
  }
  const bodyY = game ? -8 + (game.action === 'win' ? -game.pulse : game.action === 'lose' ? 3 + game.pulse * .5 : game.pulse * .3) : (seated ? 3 : 0) + bounce;
  piece(32, 66 + bodyY, game ? game.sway * (game.action === 'lose' ? 3.5 : 1.6) : lean, () => {
    c.translate(-32, -66);
    const left = side ? 19 - width * .3 : 11 - width;
    const right = side ? 45 + width * .3 : 53 + width;
    const arm = (far: boolean) => {
      const shoulder = side ? (far ? 38 : 29) : far ? left + 6 : right - 6;
      if (game) {
        drawSeatedGameArm(c, game, shoulder, 48, side, far, far && side ? p.dark : p.shirt, p.skin);
        return;
      }
      const armAngle = (far ? -1 : 1) * step * (side ? 19 : 10);
      piece(shoulder, 48, armAngle, () => {
        // Mirrored sleeves taper into the wrist; a small thumb faces the body.
        if (far && !side) c.scale(-1, 1);
        c.beginPath(); c.moveTo(-4.5, 0); c.quadraticCurveTo(-5, 7, -3.5, 15);
        c.lineTo(3.5, 15); c.quadraticCurveTo(6, 8, 4.5, 1);
        c.closePath(); fill(far && side ? p.dark : p.shirt);
        line(-3.5, 13, 3.7, 13, p.dark, .8);
        if (p.look === 'buns') line(-4, 8, 4.8, 8, p.light, 2.2);
        if (p.look === 'swept') {
          line(-1.5, 2, -1, 11.5, p.light, 1);
          line(1, 2, 1.5, 11.5, p.light, 1);
        }
        if (p.look === 'ponytail') line(-3.3, 11.5, 3.9, 11.5, p.light, .8);
        c.beginPath(); c.moveTo(-2.3, 15.2); c.lineTo(2.8, 15.2);
        c.quadraticCurveTo(4.7, 17, 4.3, 20.1); c.quadraticCurveTo(3.8, 23, .7, 22.9);
        c.quadraticCurveTo(-2, 22.7, -2.3, 20.5); c.quadraticCurveTo(-4, 19.4, -3.4, 17.8);
        c.quadraticCurveTo(-3, 17, -2, 17.4); c.closePath(); fill(p.skin);
        c.beginPath(); c.moveTo(-2, 17.5); c.quadraticCurveTo(-1.3, 18.5, -1.6, 19.5);
        c.strokeStyle = p.shade; c.lineWidth = .55; c.stroke();
      });
    };
    if (side) arm(true);
    if (p.style === 'long' && !newHair) oval(side ? 23 : 31, 36, side ? 12 : 24, 25, p.hair);
    const traceTorso = () => {
      c.beginPath(); c.moveTo(side ? 28 : 20, 42);
      c.quadraticCurveTo(side ? 20 : 10, 43, left, 57);
      c.lineTo(left - 1, 66); c.quadraticCurveTo(side ? 34 : 31, 72, right + 1, 66);
      c.lineTo(right, 55); c.quadraticCurveTo(side ? 44 : 51, 43, side ? 39 : 43, 42);
      c.closePath();
    };
    traceTorso(); fill(p.shirt);
    // Cloth details share the garment outline, including in profile and seated poses.
    c.save(); traceTorso(); c.clip();
    if (!back) {
      const seam = side ? 41.5 : 32;
      if (p.style === 'hoodie' || p.look === 'swept' || p.look === 'ponytail') {
        if (p.look !== 'baseball' && p.look !== 'tousled') {
          line(seam, 48, seam, 67, p.dark, .8);
          box(seam - 1, 54, 2, 2.5, p.light, .4);
          if (!side) line(18, 63, 26, 61, p.dark, .7);
          line(side ? 33 : 38, 61, side ? 39 : 46, 63, p.dark, .7);
        }
      } else if (p.look !== 'buns') {
        line(seam, 48, seam, 68, p.dark, .8);
        for (const y of [53, 59, 65]) oval(seam + (side ? .9 : 2.6), y, .75, .9, p.dark, 0, 0);
      }
      line(left + 3, 66, right - 3, 66, p.dark, .65);
      if (p.style === 'jacket' && p.look !== 'swept' && p.look !== 'ponytail') {
        if (!side) line(19, 53, 26, 53, p.dark);
        line(side ? 37 : 40, 53, side ? 42 : 47, 53, p.dark);
        c.beginPath(); c.moveTo(side ? 35 : 22, 44);
        c.lineTo(side ? 41 : 29, 50); c.lineTo(side ? 43 : 32, 44); fill(p.light);
      }
      if (p.look === 'curls' || p.look === 'silver') {
        c.beginPath();c.moveTo(side?35:24,44);c.lineTo(side?44:40,44);c.lineTo(side?42:32,63);c.closePath();fill(p.light);
        c.beginPath();c.moveTo(side?40:29,49);c.lineTo(side?44:35,49);c.lineTo(side?43:34,60);c.lineTo(side?41:31,64);c.lineTo(side?40:29,60);c.closePath();fill(p.dark);
        if(!side)line(21,46,26,60,p.dark,1.2);
        line(side?34:43,46,38,60,p.dark,1.2);
        if (p.look === 'silver') {
          box(side ? 34 : 42, 54, 6, 1.4, p.dark, .3);
          c.beginPath(); c.moveTo(side ? 35 : 43, 53); c.lineTo(side ? 36 : 44, 50);
          c.lineTo(side ? 38 : 46, 53); c.closePath(); fill(p.light, .35);
        } else for (const y of [60, 65]) oval(side ? 41 : 33, y, .8, .9, p.light, 0, .3);
      }
      if (p.look === 'punk') {
        line(side?30:23,47,side?43:38,67,p.light,1.8);line(side?30:23,47,side?26:19,52,p.light,1.5);
        for(const x of side?[40]:[18,45])oval(x,48,1.4,1.4,p.light,0,0);
      }
      if (p.look === 'baseball' || p.look === 'tousled') {
        box(side?34:23,58,side?10:19,8,p.dark,2);
        if(!side){line(24,60,28,63,p.light);line(27,46,27,53,p.light,1.4);}
        line(side?43:41,60,side?40:37,63,p.light);
        line(side?41:38,46,side?41:38,53,p.light,1.4);
      }
      if (p.look === 'buns') {
        for(const y of [54,61])line(side?20:17,y,side?44:48,y,p.light,3);
        line(left + 3, 67, right - 3, 67, p.dark, 1.5);
      }
      if (person === 0 || person === 3) {
        const badgeX = side ? 35 : 23;
        oval(badgeX, 55, 2.5, 2.7, p.light, 0, .45);
        line(badgeX - 1, 55, badgeX + 1, 55, p.dark, .8);
      }
      if (person === 1 || person === 4) {
        const pocketX = side ? 34 : 40;
        box(pocketX, 58, 7, 5, p.dark, 1);
        line(pocketX + 1, 59, pocketX + 6, 59, p.light, .65);
      }
      if (person === 2) {
        line(side ? 35 : 22, 55, side ? 40 : 26, 58, p.dark, .8);
        box(side ? 36 : 42, 56, 5, 2, p.light, .4);
      }
      if (p.look === 'swept') {
        line(side ? 34 : 23, 46, side ? 39 : 29, 49, p.light, 1.5);
        if (!side) line(35, 49, 41, 46, p.light, 1.5);
        box(side ? 34 : 42, 54, 5, 2, p.light, .5);
      }
      if (p.look === 'bob') {
        if (!side) for (const y of [55, 61, 66]) oval(29.5, y, .75, .9, p.dark, 0, 0);
        line(side ? 34 : 40, 60, side ? 40 : 47, 60, p.dark, .9);
      }
      if (p.look === 'ponytail') {
        line(left + 2, 66, right - 2, 66, p.dark, 2.5);
        line(side ? 32 : 20, 57, side ? 37 : 25, 62, p.light, 1.2);
        if (!side) line(43, 57, 38, 62, p.light, 1.2);
        oval(side ? 35 : 24, 51, 1.6, 1.6, p.light, 0, .4);
      }
      if (p.bartender) { box(20, 48, 25, 20, '#e3e9cc', 1); box(27, 57, 12, 7, '#628c70', 1); }
    } else {
      // Rear clothing has its own construction, without front buttons or pockets.
      if (p.style === 'hoodie') {
        oval(32, 50, 11, 7, p.shirt);
        line(25, 53, 32, 56, p.dark, .8); line(32, 56, 39, 53, p.dark, .8);
      } else {
        c.beginPath(); c.moveTo(21, 46); c.quadraticCurveTo(32, 53, 43, 46);
        c.lineTo(42, 51); c.quadraticCurveTo(32, 56, 22, 51); c.closePath(); fill(p.dark, .4);
      }
      line(32, 57, 32, 67, p.dark, .6);
      line(left + 5, 66, right - 5, 66, p.dark, .7);
      if (p.bartender) {
        line(left + 3, 62, right - 3, 62, '#e3e9cc', 2);
        c.beginPath(); c.moveTo(32, 62); c.lineTo(26, 59); c.lineTo(26, 65); c.closePath(); fill('#e3e9cc');
        c.beginPath(); c.moveTo(32, 62); c.lineTo(38, 59); c.lineTo(38, 65); c.closePath(); fill('#e3e9cc');
      }
    }
    if(back&&p.look==='buns')for(const y of [56,63])line(17,y,48,y,p.light,3);
    c.restore();
    if(p.look==='beanie'){
      box(side?24:18,43,side?21:29,6,p.light,2);box(back?21:39,47,6,13,p.light,1);
      line(back?22:40,56,back?25:43,56,p.dark,.8);
      for (const x of [back ? 22 : 40, back ? 24 : 42, back ? 26 : 44]) line(x, 59, x, 61, p.light, .65);
    }
    if (!side) arm(true);
    const drawNearArm = () => {
      if (sip >= 0) {
        const raise = [0, 6, 17, 18, 8, 0][sip];
        // A bent paper sleeve joins the shoulder to the cup instead of detaching the hand.
        line(side ? 29 : right - 6, 49, side ? 35 : 50, 61, p.shirt, 8);
        line(side ? 35 : 50, 61, 43, 63 - raise, p.shirt, 6);
        piece(48, 63 - raise, [0,-8,-21,-25,-10,0][sip], () => {
          box(-5,-10,10,14,'#fff1ca',1); box(-4,-5,8,8,'#e7a632');
          oval(0,-10,5,1.5,'#fff8de'); oval(-4.5,0,3.2,3.5,p.skin);
        });
      } else arm(false);
    };
    if (back && !game) drawNearArm();
    // The head is a rigid paper disc. Eyes and mouth switch independently of the torso.
    piece(32, 30, game ? game.sway * (game.action === 'lose' ? 5 : 1.5) : walking ? -lean * .32 : frame === 9 ? 1.2 : 0, () => {
      c.translate(-32, -30);
      if (newHair) drawCitizenHair(c, p, p.look, side, back, step, 'behind');
      if (side) {
        // A single eye, an exposed ear and the nose outline define a true profile.
        c.beginPath(); c.moveTo(20, 14); c.quadraticCurveTo(32, 2, 44, 10);
        c.quadraticCurveTo(53, 15, 52, 28); c.lineTo(58, 34);
        c.quadraticCurveTo(59, 35.5, 53, 36); c.lineTo(53, 39);
        c.quadraticCurveTo(55, 40, 51, 41); c.quadraticCurveTo(49, 49, 38, 50);
        c.quadraticCurveTo(25, 51, 18, 41); c.quadraticCurveTo(10, 23, 20, 14);
        c.closePath(); fill(p.skin);
        const hat = hasHat;
        if (newHair) drawCitizenHair(c, p, p.look, true, false, step, 'front');
        else if (p.style === 'long') {
          c.beginPath(); c.moveTo(14, 26); c.quadraticCurveTo(9, 7, 28, 4);
          c.quadraticCurveTo(48, 1, 52, 18); c.lineTo(46, 20); c.lineTo(39, 13);
          c.lineTo(30, 20); c.quadraticCurveTo(27, 37, 27 + step, 57);
          c.lineTo(20 + step, 61); c.lineTo(13 + step, 57);
          c.quadraticCurveTo(9, 42, 14, 26); c.closePath(); fill(p.hair);
          line(18, 28, 17 + step, 54, p.hairLight, 1.2);
          line(24, 23, 23 + step, 56, p.hairLight, .8);
        } else if (!hat && p.look !== 'punk') {
          c.beginPath(); c.moveTo(14, 32); c.quadraticCurveTo(7, 17, 19, 7);
          c.quadraticCurveTo(34, -2, 46, 8); c.quadraticCurveTo(53, 13, 53, 23);
          c.lineTo(47, 19); c.lineTo(39, 13); c.lineTo(27, 20);
          c.lineTo(25, 36); c.lineTo(18, 41); c.closePath(); fill(p.hair);
          if (p.look === 'silver') {
            line(18, 13, 30, 9, p.hairLight, 2);
            line(30, 9, 43, 13, p.hairLight, 2);
          }
        } else {
          c.beginPath(); c.moveTo(13, 20); c.lineTo(27, 20); c.lineTo(25, 38);
          c.lineTo(19, 41); c.lineTo(14, 34); c.closePath(); fill(p.hair, .4);
        }
        if (p.look === 'curls') {
          for (const [x, y] of [[14, 22], [15, 14], [22, 8], [31, 6], [40, 9], [47, 14]]) {
            oval(x, y, 5.4, 5.8, p.hair);
          }
          for (const [x, y] of [[19, 12], [29, 8], [40, 12]]) line(x, y, x + 2, y + 2, p.hairLight, 1.2);
        }
        if (p.look === 'buns') {
          oval(12, 16, 8, 9, p.hair);
          line(9, 13, 14, 19, p.hairLight, 1.4); box(9, 23, 9, 3, p.light, 1);
        }
        if (p.look === 'punk') {
          oval(18, 23, 3.3, 10, p.hairLight);
          c.beginPath(); c.moveTo(24, 18); c.lineTo(23, 10); c.lineTo(28, 2);
          c.lineTo(32, 8); c.lineTo(37, 1); c.lineTo(39, 9); c.lineTo(44, 5);
          c.lineTo(47, 18); c.lineTo(39, 16); c.closePath(); fill(p.hair);
          line(33, 10, 36, 16, p.hairLight, 2);
        }
        if (hat) {
          c.save();
          if (p.look === 'beanie') c.translate(0, -4);
          c.beginPath(); c.moveTo(12, 21); c.bezierCurveTo(11, -1, 54, -1, 54, 21);
          c.closePath(); fill(p.dark);
          c.beginPath(); c.moveTo(12, 17); c.quadraticCurveTo(33, 14, 54, 17);
          c.lineTo(54, 22); c.quadraticCurveTo(33, 20, 12, 23); c.closePath(); fill(p.light);
          if (p.look === 'baseball') {
            c.beginPath(); c.moveTo(38, 19); c.lineTo(62, 20); c.lineTo(61, 25);
            c.lineTo(38, 23); c.closePath(); fill(p.dark); box(37, 9, 10, 6, p.light, 1);
          } else if (p.look === 'beanie') {
            for (let x = 16; x < 54; x += 5) line(x, 18, x, 22, p.dark, .6);
            box(43, 17, 5, 5, p.shirt, 1);
          } else if (person === 5) {
            box(18, 20, 7, 12, p.dark, 2); line(21, 23, 21, 29, p.light, .7);
          } else {
            for (const [x, y] of [[27, 4], [31, 3], [34, 4], [30, 6]]) oval(x + step * .6, y, 3, 2.6, p.light, 0, .3);
          }
          drawCitizenHatStitch(c, p, true, false, p.look);
          c.restore();
        }
        oval(26, 34, 3.2, 4.4, p.skin);
        c.beginPath(); c.moveTo(25.5, 32); c.quadraticCurveTo(28, 33, 26, 36);
        c.strokeStyle = p.shade; c.lineWidth = .65; c.stroke();
        drawCitizenFace(c, p, person, true, frame, sip, game?.action);
        if (p.look === 'beanie') for (const [x, y] of [[45, 39], [48, 38], [51, 39]]) oval(x, y, .55, .5, p.shade, 0, 0);
        if (p.look === 'silver') oval(50, 39, 4.8, 2.4, p.hair);
        if (p.glasses) drawCitizenGlasses(c, p, true, false);
        return;
      }
      // Skin, ears, hair and hats remain separate pieces in every direction.
      for (const earX of [10, 54]) {
        oval(earX, 34, 3.7, 5.1, p.skin);
        line(earX, 32, earX + (earX < 32 ? 1 : -1), 36, p.shade, .7);
      }
      if(p.look==='curls'){
        oval(32,21,26,19,p.hair);
        for(let n=0;n<9;n++)oval(10+n*5.5,15-Math.sin(n/8*Math.PI)*9,5.5,6,p.hair);
      }
      if(p.look==='buns')for(const x of [10,54]){
        oval(x,13,8,9,p.hair);line(x-3,10,x+2,16,p.hairLight,1.4);box(x-5,20,10,3,p.light,1);
      }
      oval(32, 27, headRadius, 23.1, p.skin);
      if (back) {
        if (newHair) drawCitizenHair(c, p, p.look, false, true, step, 'front');
        else if (p.style === 'long') {
          const sway = walking ? step * 1.3 : 0;
          c.beginPath(); c.moveTo(10, 24); c.bezierCurveTo(8, -3, 55, -3, 55, 24);
          c.bezierCurveTo(54, 38, 59 + sway, 48, 51 + sway, 59);
          c.lineTo(43 + sway, 57); c.lineTo(36 + sway, 61); c.lineTo(28 + sway, 58);
          c.lineTo(19 + sway, 60); c.quadraticCurveTo(6 + sway, 57, 9, 39); c.closePath(); fill(p.hair);
          // Broad paper locks keep even the darkest hair readable at room scale.
          c.beginPath(); c.moveTo(17, 17); c.quadraticCurveTo(24, 8, 32, 9);
          c.quadraticCurveTo(23, 27, 24 + sway, 55); c.lineTo(17 + sway, 55);
          c.quadraticCurveTo(13, 33, 17, 17); c.closePath(); fill(p.hairLight, 0);
          for (const x of [31, 42, 49]) {
            c.beginPath(); c.moveTo(x, 20); c.quadraticCurveTo(x-4, 38, x+sway, 54);
            c.strokeStyle=p.hairLight; c.lineWidth=1; c.stroke();
          }
        } else if (p.style === 'jacket') {
          c.beginPath(); c.moveTo(10, 29); c.bezierCurveTo(5, 1, 53, -6, 55, 22);
          c.lineTo(53, 39); c.lineTo(47, 37); c.lineTo(45, 42); c.lineTo(38, 39);
          c.lineTo(32, 43); c.lineTo(25, 39); c.lineTo(20, 41); c.lineTo(17, 36);
          c.lineTo(11, 38); c.closePath(); fill(p.hair);
          c.beginPath(); c.moveTo(16, 20); c.quadraticCurveTo(27, 8, 44, 16);
          c.lineTo(41, 21); c.quadraticCurveTo(27, 15, 17, 27); c.closePath(); fill(p.hairLight, 0);
          line(20, 31, 24, 34, p.hairLight); line(35, 34, 40, 31, p.hairLight);
        } else {
          // A narrow fringe sits below a rear-facing hat, above the exposed nape.
          c.beginPath(); c.moveTo(11, 31); c.lineTo(53, 31); c.lineTo(52, 41);
          c.lineTo(45, 39); c.lineTo(39, 42); c.lineTo(32, 40); c.lineTo(25, 42);
          c.lineTo(18, 39); c.lineTo(12, 41); c.closePath(); fill(p.hair, .4);
          line(20, 38, 25, 39, p.hairLight, .8); line(39, 39, 44, 38, p.hairLight, .8);
        }
      } else {
        if (newHair) drawCitizenHair(c, p, p.look, false, false, step, 'front');
        if ((p.style === 'long' || p.style === 'jacket') && !p.look) {
          c.beginPath(); c.moveTo(10, 29); c.quadraticCurveTo(3, 9, 22, 4);
          c.quadraticCurveTo(47, -1, 55, 18); c.lineTo(55, 29); c.lineTo(49, 21);
          c.lineTo(42, 15); c.lineTo(35, 21); c.lineTo(29, 14); c.lineTo(18, 20); c.closePath(); fill(p.hair);
          if (p.style === 'long') {
            oval(11, 36, 3.8, 16, p.hair); oval(53, 37, 3.8, 15, p.hair);
            line(10.5, 29, 10.5, 46, p.hairLight, .9); line(53.5, 30, 53.5, 47, p.hairLight, .9);
          }
          line(21, 12, 28, 9, p.hairLight, 1.2);
          line(39, 9, 47, 14, p.hairLight, 1);
        }
        if(p.look==='curls'){
          for(let n=0;n<7;n++)oval(12+n*6.4,15-Math.sin(n/6*Math.PI)*7,5,6,p.hair);
          for(const x of [16,28,40])line(x,10,x+2,12,p.hairLight,1.3);
        }
        if(p.look==='buns'){
          c.beginPath();c.moveTo(10,23);c.quadraticCurveTo(9,2,31,4);c.quadraticCurveTo(53,1,55,23);
          c.lineTo(46,18);c.lineTo(34,10);c.lineTo(24,19);c.closePath();fill(p.hair);
          line(34,8,43,13,p.hairLight,1.2);
        }
        if(p.look==='silver'){
          c.beginPath();c.moveTo(10,27);c.lineTo(10,16);c.quadraticCurveTo(12,1,32,5);
          c.quadraticCurveTo(51,1,55,18);c.lineTo(53,29);c.lineTo(47,19);c.lineTo(38,15);c.lineTo(23,16);c.closePath();fill(p.hair);
          line(18,13,32,9,p.hairLight,2);line(32,9,44,13,p.hairLight,2);
        }
        if(p.look==='punk'){
          oval(13,23,3.3,10,p.hairLight);oval(52,23,3.3,10,p.hairLight);
        }
        drawCitizenFace(c, p, person, false, frame, sip, game?.action);
        if (p.look === 'beanie') for (const x of [18, 22, 26, 38, 42, 46]) oval(x, x % 4 ? 40 : 39, .55, .5, p.shade, 0, 0);
        if (p.look === 'silver') {
          oval(28, 39, 4.5, 2.4, p.hair); oval(36, 39, 4.5, 2.4, p.hair);
        }
      }
      if(back&&p.look==='curls'){
        for(let n=0;n<7;n++)oval(13+n*6,37+(n%2)*2,4.5,4,p.hair);
        for(const [x,y] of [[19,16],[31,12],[43,19],[23,29],[38,31]]){
          c.beginPath();c.arc(x,y,3.5,.4,2.8);c.strokeStyle=p.hairLight;c.lineWidth=1.2;c.stroke();
        }
      }
      if(p.look==='punk'){
        if(back){oval(32,24,22,21,p.skin);for(const x of [17,46])line(x,22,x+1,33,p.shade,1);}
        c.beginPath();c.moveTo(25,back?41:16);c.lineTo(24,10);c.lineTo(28,2);c.lineTo(32,8);
        c.lineTo(37,1);c.lineTo(39,9);c.lineTo(44,5);c.lineTo(40,back?39:17);c.closePath();fill(p.hair);
        line(33,10,35,back?34:16,p.hairLight,2);
      }
      if (hasHat) {
        c.save();
        if (!back && p.look === 'beanie') c.translate(0, -4);
        if (back) {
          // The hat wraps around the skull; its rear brim sits lower than the front.
          c.beginPath(); c.moveTo(8, 34); c.bezierCurveTo(3, -5, 60, -5, 56, 34);
          c.quadraticCurveTo(33, 41, 8, 34); c.closePath(); fill(p.dark);
          c.beginPath(); c.moveTo(8, 31); c.quadraticCurveTo(32, 38, 56, 31);
          c.lineTo(56, 37); c.quadraticCurveTo(32, 44, 8, 37); c.closePath(); fill(p.light);
          c.beginPath(); c.moveTo(32, 7); c.quadraticCurveTo(28, 19, 32, 34);
          c.strokeStyle=p.light; c.globalAlpha=.35; c.lineWidth=.9; c.stroke(); c.globalAlpha=1;
        } else {
          c.beginPath(); c.moveTo(8, 21); c.bezierCurveTo(7, -2, 56, -2, 56, 21); c.closePath(); fill(p.dark);
          c.beginPath(); c.moveTo(8, 17); c.quadraticCurveTo(32, 14, 56, 17); c.lineTo(56, 22);
          c.quadraticCurveTo(31, 19, 8, 22); c.closePath(); fill(p.light);
        }
        if(p.look==='baseball'){
          if(!back){
            c.beginPath();c.moveTo(18,19);c.lineTo(51,20);c.lineTo(48,25);c.lineTo(18,23);c.closePath();fill(p.dark);
            box(26,9,10,6,p.light,1);
          }else{box(24,31,16,7,p.hair,2);line(25,36,39,36,p.light,2);}
        }else if(p.look==='beanie'){
          for(let x=13;x<55;x+=5)line(x,back?34:18,x,back?38:22,p.dark,.6);
          box(39,back?35:17,5,5,p.shirt,1);
        }else if (person === 5) {
          const flapY = back ? 32 : 19;
          box(7, flapY, 6, 12, p.dark, 2); box(52, flapY, 6, 12, p.dark, 2);
          line(10, flapY+3, 10, flapY+9, p.light, .7); line(55, flapY+3, 55, flapY+9, p.light, .7);
        } else {
          for (const [x,y] of [[29,4],[33,3],[36,4],[32,6]]) oval(x+step*.6,y,3,2.6,p.light,0,.3);
        }
        drawCitizenHatStitch(c, p, false, back, p.look);
        c.restore();
      }
      if (p.glasses) drawCitizenGlasses(c, p, false, back);
    });
    if (!back || game) drawNearArm();
  });
}
