import { characterGamePose, drawAvatar, drawSeatedGameArm } from './avatarArt';
import { appearanceKey, parseAppearance, SKIN_COLORS, CLOTHING_COLORS } from '../shared/appearance';
import Phaser from 'phaser';
import { parseGeneratedAppearance } from '../shared/skinStudio';
import { drawGeneratedSkin, hasSkinSheet, loadSkinSheet } from './generatedSkinArt';
import { drawMira } from './miraArt';
import { CHARACTER_WALK_FRAMES, CHARACTER_WALK_FRAME_RATE } from './characterAnimation';
import { drawProfileLimb, profileArmPose, profileBodyPoint, profileBodyPose, profileLegPose } from './profileWalk';
import { drawFrontalArmSkin, frontalArmPose, frontalBodyPose, frontalLegPose, traceFrontalTop } from './frontalWalk';
import { drawPresetClothing, drawPresetProfileSleeve, drawPresetShoe } from './presetSkinArt';

import type { Facing } from '../shared/movement';
export type { Facing } from '../shared/movement';
export const DIRECTIONS: Facing[] = ['down', 'left', 'right', 'up'];
export const CHARACTER_RESOLUTION = 3;
export const CHARACTER_SCALE = 1.8 / CHARACTER_RESOLUTION;
const W = 32, H = 48, TOP_PADDING = 8, ATLAS_COLUMNS = 23;

type Palette = { skin: string; shade: string; hair: string; hairLight: string; shirt: string; light: string; dark: string; pants: string; shoes: string; style: 'hoodie' | 'long' | 'cap' | 'jacket'; bartender?: boolean; look?: 'curls' | 'beanie' | 'punk' | 'buns' | 'baseball' | 'silver'; width?: number; glasses?: boolean };
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
];

/** Paper cutout frames keep the same ground anchor in every pose. */
export function createCharacters(scene: Phaser.Scene) {
  palettes.forEach((palette, person) => createCharacterTexture(scene, `citizen-${person}`, (ctx, direction, frame, seated, sip) => drawFrame(ctx, palette, direction, frame, seated, sip, person), person));
}

export function characterTexture(scene: Phaser.Scene, skin: number, serialized = ''): string {
  const generated = parseGeneratedAppearance(serialized);
  if (generated) {
    const key = `avatar-generated-${generated.skinId}`;
    if (!scene.textures.exists(key)) {
      const draw = (ctx: CanvasRenderingContext2D, direction: Facing, frame: number, seated: boolean, sip: number) => {
        if (!drawGeneratedSkin(ctx, generated.skinId, direction, frame, seated, sip)) {
          const person = Number.isInteger(skin) && skin >= 0 && skin < palettes.length ? skin : 0;
          drawFrame(ctx, palettes[person], direction, frame, seated, sip, person);
        }
      };
      createCharacterTexture(scene, key, draw, 0);
      if (!hasSkinSheet(generated.skinId)) {
        const load = (attempt: number) => { void loadSkinSheet(generated.skinId).then(() => {
          if (scene.textures.exists(key)) createCharacterTexture(scene, key, draw, 0);
        }).catch(() => {
          if (attempt < 3 && scene.textures.exists(key)) setTimeout(() => load(attempt + 1), (attempt + 1) * 3000);
        }); };
        load(0);
      }
    }
    return key;
  }
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

/** Render dialogue portraits from the drawing paths instead of enlarging a room atlas cell. */
export function createCharacterPortrait(skin: number, serialized: string, frame: number, stage = 0): HTMLCanvasElement {
  const resolution = 16;
  const canvas = document.createElement('canvas');
  canvas.width = W * resolution; canvas.height = H * resolution;
  const context = canvas.getContext('2d')!;
  const appearance = parseAppearance(serialized);
  const generated = parseGeneratedAppearance(serialized);
  const sipping = frame >= 11 && frame <= 16;
  context.save();
  context.scale(resolution, resolution); context.translate(0, TOP_PADDING);
  if (generated && drawGeneratedSkin(context, generated.skinId, 'down', sipping ? 6 : frame, false, sipping ? frame - 11 : -1)) { /* Generated portrait. */ }
  else if (appearance) drawAvatar(context, appearance, 'down', sipping ? 6 : frame, false, sipping ? frame - 11 : -1);
  else {
    const person = Number.isInteger(skin) && skin >= 0 && skin < palettes.length ? skin : 0;
    drawFrame(context, palettes[person], 'down', sipping ? 6 : frame, false, sipping ? frame - 11 : -1, person);
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
    if ((!key.startsWith('avatar-v1-') && !key.startsWith('avatar-generated-')) || active.has(key)) continue;
    for (const direction of DIRECTIONS) for (const action of ['walk', 'idle', 'sit', 'drink', 'sitdrink', 'game', 'win', 'lose']) scene.anims.remove(`${key}-${action}-${direction}`);
    scene.textures.remove(key);
  }
}

function createCharacterTexture(scene: Phaser.Scene, key: string, draw: (ctx: CanvasRenderingContext2D, direction: Facing, frame: number, seated: boolean, sip: number) => void, person: number) {
  // Two rows per direction keep every atlas below common mobile texture limits.
  const texture = scene.textures.exists(key) ? scene.textures.get(key) as Phaser.Textures.CanvasTexture
    : scene.textures.createCanvas(key, W * ATLAS_COLUMNS * CHARACTER_RESOLUTION, H * 8 * CHARACTER_RESOLUTION)!;
  const ctx = texture.context;
  ctx.resetTransform(); ctx.clearRect(0, 0, texture.width, texture.height);
  ctx.scale(CHARACTER_RESOLUTION, CHARACTER_RESOLUTION);
  const animate = (config: Phaser.Types.Animations.Animation) => { if (config.key && !scene.anims.exists(config.key)) scene.anims.create(config); };
  DIRECTIONS.forEach((direction, row) => {
    const addFrame = (index: number, pose = index, seated = false, sip = -1) => {
      const x = index % ATLAS_COLUMNS * W, y = (row * 2 + Math.floor(index / ATLAS_COLUMNS)) * H;
      ctx.save(); ctx.translate(x, y + TOP_PADDING);
      draw(ctx, direction, pose, seated, sip); ctx.restore();
      if (!texture.has(`${direction}-${index}`)) texture.add(`${direction}-${index}`, 0, x * CHARACTER_RESOLUTION, y * CHARACTER_RESOLUTION, W * CHARACTER_RESOLUTION, H * CHARACTER_RESOLUTION);
    };
    const animationFrames = (start: number, count: number) => Array.from({ length: count }, (_, i) => ({ key, frame: `${direction}-${start + i}` }));
    for (let frame = 0; frame < 10; frame++) addFrame(frame);
    for (let special = 0; special < 13; special++) {
      addFrame(10 + special, 6, special === 0 || special >= 7, special === 0 ? -1 : (special - 1) % 6);
    }
    for (const [action, start] of [['drink', 11], ['sitdrink', 17]] as const) {
      animate({ key: `${key}-${action}-${direction}`, frames: animationFrames(start, 6), frameRate: 6, repeat: -1 });
    }
    animate({ key: `${key}-walk-${direction}`, frames: animationFrames(0, CHARACTER_WALK_FRAMES), frameRate: CHARACTER_WALK_FRAME_RATE, repeat: -1 });
    for (const extra of [23, 24, 25, 26, 27]) addFrame(extra, extra >= 25 ? [8, 7, 9][extra - 25] : extra, extra >= 25);
    const idle = (index: number, duration: number) => ({ key, frame: `${direction}-${index}`, duration });
    animate({ key: `${key}-sit-${direction}`, frames: [
      idle(10, 1800 + person * 163), idle(25, 83), idle(10, 1400), idle(26, 700), idle(27, 500),
    ], frameRate: 12, repeat: -1 });
    animate({ key: `${key}-idle-${direction}`, frames: [
      idle(6, 1400 + person * 137), idle(7, 650), idle(24, 83), idle(8, 83),
      idle(6, 1700 + person * 193), idle(9, 800), idle(23, 350), idle(6, 500), idle(24, 83), idle(6, 750),
    ], frameRate: 12, repeat: -1 });
    for (const [action, start] of [['game', 28], ['win', 34], ['lose', 40]] as const) {
      for (let phase = 0; phase < 6; phase++) addFrame(start + phase, start + phase, true);
      animate({ key: `${key}-${action}-${direction}`, frames: animationFrames(start, 6), frameRate: action === 'game' ? 7 : 6, repeat: -1 });
    }
  });
  texture.refresh();
}

function drawFrame(c: CanvasRenderingContext2D, p: Palette, facing: Facing, frame: number, seated = false, sip = -1, person = 0) {
  if (p.bartender) { drawMira(c, facing, frame, sip); return; }
  const game = characterGamePose(frame);
  seated ||= !!game;
  const side = facing === 'left' || facing === 'right', back = facing === 'up';
  const profile = side && !seated && sip < 0;
  const profileBody = profile ? profileBodyPose(frame) : null;
  const frontal = !side && !seated && sip < 0;
  const frontalBody = frontal ? frontalBodyPose(frame) : null;
  const walking = frame < 6;
  const step = walking ? [0, 1, .55, 0, -1, -.55][frame] : 0;
  const bounce = profileBody?.y ?? frontalBody?.y ?? (walking ? [0, -1.4, -.6, 0, -1.4, -.6][frame] : 0);
  const lean = profileBody?.angle ?? frontalBody?.angle ?? (walking ? [-1.8, 1.8, 2.8, 1.8, -1.8, -2.8][frame] : 0);
  const blink = frame === 8;
  const glance = frame === 7 ? -1.7 : frame === 9 ? 1.7 : 0;
  const width = p.width ?? [3, -1, 1, 0, -2, 2, -1][person] ?? 0;
  const headRadius = 22.4 + width * .22;
  const ink = '#39332c';
  // Draw at twice the logical size, and clip each atlas cell before rotating pieces.
  c.beginPath(); c.rect(0, -TOP_PADDING, W, H); c.clip(); c.scale(.5, .5);
  if (facing === 'left') { c.translate(W * 2, 0); c.scale(-1, 1); }
  c.lineJoin = 'round'; c.lineCap = 'round';
  const fill = (color: string | CanvasGradient, edge = .6) => {
    c.fillStyle = color; c.fill();
    if (edge) { c.strokeStyle = ink; c.lineWidth = edge; c.stroke(); }
  };
  const oval = (x: number, y: number, rx: number, ry: number, color: string | CanvasGradient, angle = 0, edge = .6) => {
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
  const shoe = (x: number, y: number, rx: number, ry: number, angle = 0) => {
    drawPresetShoe(c, x, y, rx, ry, angle, p.shoes, ink, side, back, p.look === 'silver' || p.look === 'punk');
  };
  // The planted shoe stays on the ground; the other changes pose in discrete steps.
  for (const leg of [-1, 1]) {
    if (profileBody) {
      const far = leg === -1;
      const pose = profileLegPose(frame, far, profileBodyPoint({ x: far ? 34 : 30.5, y: 61 }, 66, profileBody));
      drawProfileLimb(c, pose.hip, pose.knee, pose.ankle, 10, 8, p.pants, ink);
      shoe(pose.foot.x + 2, pose.foot.y, 9 + width * .2, 2.7, pose.angle);
      continue;
    }
    if (frontalBody) {
      const sign = leg as -1 | 1;
      const pose = frontalLegPose(frame, sign, profileBodyPoint({ x: 32 + sign * 8.5, y: 61 }, 66, frontalBody), 10, back);
      drawProfileLimb(c, pose.hip, pose.knee, pose.ankle, 14, 11.5 * pose.scale, p.pants, ink);
      shoe(pose.foot.x, pose.foot.y, (10 + width * .2) * pose.scale, 2.7 * pose.scale);
      continue;
    }
    const swing = step * leg;
    const x = 32 + leg * (side ? 3 : 10) + (side ? swing * 5.5 : swing * 1.3) + (seated ? (side ? 7 : leg * 2) : 0);
    const y = 76 - Math.max(0, swing) * 2.5;
    const legWidth = side ? 10 : 14;
    box(x - legWidth / 2, seated ? 64 : 63 + bounce, legWidth, y - (seated ? 64 : 63 + bounce), p.pants, 1);
    if (game) line(32 + leg * (side ? 3 : 8), 58, x, 65, p.pants, legWidth);
    shoe(x + (side ? 2 : 0), y, (side ? 9 : 10) + width * .2, 2.7, swing * (side ? -6 : 3));
  }
  const bodyY = game ? -8 + (game.action === 'win' ? -game.pulse : game.action === 'lose' ? 3 + game.pulse * .5 : game.pulse * .3) : (seated ? 3 : 0) + bounce;
  piece(32, 66 + bodyY, game ? game.sway * (game.action === 'lose' ? 3.5 : 1.6) : lean, () => {
    c.translate(-32, -66);
    const left = side ? 19 - width * .3 : 11 - width;
    const right = side ? 45 + width * .3 : 53 + width;
    const frontalArms = frontal ? ([-1, 1] as const).map(sign => frontalArmPose(frame, sign, 44.5, 32 - left, 21, back)) : null;
    const arm = (far: boolean) => {
      if (frontalArms) {
        drawFrontalArmSkin(c, frontalArms[far ? 0 : 1], p.skin, ink);
        return;
      }
      if (profile) {
        const pose = profileArmPose(frame, far, { x: far ? 35.5 : 29, y: 48 }, 21);
        drawPresetProfileSleeve(c, pose, p, ink, far);
        return;
      }
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
        c.beginPath(); c.moveTo(-2.3, 15.2); c.lineTo(2.8, 15.2);
        c.quadraticCurveTo(4.7, 17, 4.3, 20.1); c.quadraticCurveTo(3.8, 23, .7, 22.9);
        c.quadraticCurveTo(-2, 22.7, -2.3, 20.5); c.quadraticCurveTo(-4, 19.4, -3.4, 17.8);
        c.quadraticCurveTo(-3, 17, -2, 17.4); c.closePath(); fill(p.skin);
        c.beginPath(); c.moveTo(-2, 17.5); c.quadraticCurveTo(-1.3, 18.5, -1.6, 19.5);
        c.strokeStyle = p.shade; c.lineWidth = .55; c.stroke();
      });
    };
    // The hands sit below one continuous shirt-and-sleeve contour.
    if (frontal) { arm(true); arm(false); }
    if (side) arm(true);
    if (p.style === 'long') oval(side ? 23 : 31, 36, side ? 12 : 24, 25, p.hair);
    if (frontalArms) traceFrontalTop(c, frontalArms[0], frontalArms[1], 32 - left, 20, 43, 42, 66);
    else {
      c.beginPath(); c.moveTo(side ? 28 : 20, 42);
      c.quadraticCurveTo(side ? 20 : 10, 43, left, 57);
      c.lineTo(left - 1, 66); c.quadraticCurveTo(side ? 34 : 31, 72, right + 1, 66);
      c.lineTo(right, 55); c.quadraticCurveTo(side ? 44 : 51, 43, side ? 39 : 43, 42);
      c.closePath();
    }
    fill(p.shirt);
    drawPresetClothing(c, person, p, side, back, back ? frontalArms ?? undefined : undefined);
    if (!side && !frontal) arm(true);
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
    if (back && !game && !frontal) drawNearArm();
    // In profile the head covers the sleeve root, as it covers the torso neckline.
    if (profile) drawNearArm();
    // The head is a rigid paper disc. Eyes and mouth switch independently of the torso.
    piece(32, 30, game ? game.sway * (game.action === 'lose' ? 5 : 1.5) : walking ? -lean * .32 : frame === 9 ? 1.2 : 0, () => {
      c.translate(-32, -30);
      const face = c.createLinearGradient(20, 10, 47, 53);
      face.addColorStop(0, p.skin);
      face.addColorStop(.51, p.skin);
      face.addColorStop(1, p.shade);
      const hair = c.createLinearGradient(22, 2, 42, 42);
      hair.addColorStop(0, p.hairLight);
      hair.addColorStop(.55, p.hair);
      hair.addColorStop(1, p.hair);
      const eye = c.createLinearGradient(0, 18, 0, 37);
      eye.addColorStop(0, '#fffdf5');
      eye.addColorStop(.62, '#fffdf5');
      eye.addColorStop(1, '#dfcbc6');
      const pupil = (x: number, y = 28) => {
        oval(x, y, 1.35, 1.65, '#252724', 0, 0);
        oval(x - .36, y - .54, .44, .5, '#fff8e8', 0, 0);
      };
      const curve = (x: number, y: number, cx: number, cy: number, endX: number, endY: number, color: string, weight: number) => {
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(cx, cy, endX, endY);
        c.strokeStyle = color; c.lineWidth = weight; c.stroke();
      };
      const hatCrown = () => {
        fill(p.dark);
        c.save(); c.clip();
        const light = c.createLinearGradient(15, 0, 44, 27);
        light.addColorStop(0, 'rgba(255, 240, 202, .40)');
        light.addColorStop(.68, 'rgba(255, 240, 202, 0)');
        light.addColorStop(1, 'rgba(35, 26, 52, .20)');
        c.fillStyle = light; c.fillRect(4, -5, 56, 46);
        c.beginPath(); c.moveTo(side ? 35 : 32, 4);
        c.quadraticCurveTo(side ? 40 : 27, 12, side ? 39 : 31, back ? 33 : 18);
        c.globalAlpha = .55; c.strokeStyle = p.light; c.lineWidth = .85; c.stroke();
        c.restore();
      };
      if (side) {
        // A single eye, an exposed ear and the nose outline define a true profile.
        c.beginPath(); c.moveTo(20, 14); c.quadraticCurveTo(32, 2, 44, 10);
        c.quadraticCurveTo(52.5, 15, 52, 27.5);
        c.quadraticCurveTo(51.7, 30.5, 56.3, 33);
        c.quadraticCurveTo(58.8, 35.2, 53.1, 36.2);
        c.quadraticCurveTo(52, 37.9, 53, 40);
        c.quadraticCurveTo(50.8, 48.7, 38, 50);
        c.quadraticCurveTo(25, 51, 18, 41); c.quadraticCurveTo(10, 23, 20, 14);
        c.closePath(); fill(face);
        const hat = p.style === 'hoodie' || p.style === 'cap';
        if (p.style === 'long') {
          c.beginPath(); c.moveTo(14, 26); c.quadraticCurveTo(9, 7, 28, 4);
          c.quadraticCurveTo(48, 1, 52, 18); c.lineTo(46, 20); c.lineTo(39, 13);
          c.lineTo(30, 20); c.quadraticCurveTo(27, 37, 27 + step, 57);
          c.lineTo(20 + step, 61); c.lineTo(13 + step, 57);
          c.quadraticCurveTo(9, 42, 14, 26); c.closePath(); fill(hair);
          curve(22, 12, 13, 33, 17 + step, 55, p.hairLight, 1.45);
          curve(27, 16, 19, 35, 23 + step, 56, p.hairLight, .85);
        } else if (!hat && p.look !== 'punk') {
          c.beginPath(); c.moveTo(14, 32); c.quadraticCurveTo(7, 17, 19, 7);
          c.quadraticCurveTo(34, -2, 46, 8); c.quadraticCurveTo(53, 13, 53, 23);
          c.lineTo(47, 19); c.lineTo(39, 13); c.lineTo(27, 20);
          c.lineTo(25, 36); c.lineTo(18, 41); c.closePath(); fill(hair);
          if (p.look === 'silver') {
            curve(18, 17, 27, 5, 44, 13, p.hairLight, 2);
            curve(16, 23, 23, 15, 35, 13, p.hairLight, 1.1);
          } else if (!p.look) {
            curve(17, 21, 24, 10, 38, 10, p.hairLight, 1.3);
          }
        } else {
          c.beginPath(); c.moveTo(13, 20); c.lineTo(27, 20); c.lineTo(25, 38);
          c.lineTo(19, 41); c.lineTo(14, 34); c.closePath(); fill(p.hair, .4);
        }
        if (p.look === 'curls') {
          for (const [x, y] of [[14, 22], [15, 14], [22, 8], [31, 6], [40, 9], [47, 14]]) {
            oval(x, y, 5.4, 5.8, hair);
          }
          for (const [x, y] of [[15, 18], [23, 10], [32, 8], [41, 12]]) {
            curve(x - 2.1, y + .6, x, y - 2.7, x + 2.1, y + .7, p.hairLight, 1);
          }
        }
        if (p.look === 'buns') {
          oval(12, 16, 8, 9, hair);
          curve(7, 14, 12, 8, 16.5, 15, p.hairLight, 1.35);
          curve(10, 19, 16, 19, 17.2, 14, p.hairLight, .9);
          curve(9, 22, 13, 25.2, 18, 22, p.light, 2);
        }
        if (p.look === 'punk') {
          c.beginPath(); c.moveTo(16, 24); c.quadraticCurveTo(20, 14, 28, 18);
          c.quadraticCurveTo(24, 29, 24, 35); c.quadraticCurveTo(18, 33, 16, 24);
          c.closePath(); fill('rgba(70, 43, 57, .33)', 0);
          curve(17.5, 23, 22, 18, 26, 18.5, p.hairLight, 1);
          c.beginPath(); c.moveTo(24, 18); c.lineTo(23, 10); c.lineTo(28, 2);
          c.lineTo(32, 8); c.lineTo(37, 1); c.lineTo(39, 9); c.lineTo(44, 5);
          c.lineTo(47, 18); c.lineTo(39, 16); c.closePath(); fill(p.hair);
          line(33, 10, 36, 16, p.hairLight, 2);
        }
        if (hat) {
          c.beginPath(); c.moveTo(12, 21); c.bezierCurveTo(11, -1, 54, -1, 54, 21);
          c.closePath(); hatCrown();
          c.beginPath(); c.moveTo(12, 17); c.quadraticCurveTo(33, 14, 54, 17);
          c.lineTo(54, 22); c.quadraticCurveTo(33, 20, 12, 23); c.closePath(); fill(p.light);
          if (p.look === 'baseball') {
            c.beginPath(); c.moveTo(38, 19); c.lineTo(62, 20); c.lineTo(61, 25);
            c.lineTo(38, 23); c.closePath(); fill(p.dark); box(37, 9, 10, 6, p.light, 1);
            curve(42, 20.2, 52, 20.3, 60, 21.3, p.light, .9);
          } else if (p.look === 'beanie') {
            for (let x = 16; x < 54; x += 4) line(x, 18, x - .65, 21.8, p.dark, .72);
            curve(21, 15, 26, 7, 33, 6, p.light, .65);
            box(43, 17, 5, 5, p.shirt, 1);
          } else if (person === 5) {
            box(17, 19, 9, 13, p.dark, 2.5);
            curve(19.5, 21.5, 18.5, 28, 22.8, 30, p.light, 1.35);
          } else {
            for (const [x, y] of [[27, 4], [31, 3], [34, 4], [30, 6]]) oval(x + step * .6, y, 3, 2.6, p.light, 0, .3);
            curve(16, 18.3, 32, 15.7, 50, 17.6, '#fff2c1', .75);
          }
        }
        oval(26, 34, 3.2, 4.4, face);
        curve(24.8, 32.4, 28.9, 31.2, 26.8, 36.1, p.shade, 1.1);
        const eyeX = 45, eyeY = 28.6, eyeWidth = 6.2, eyeHeight = 7.8;
        if (game?.action === 'win') {
          curve(eyeX - eyeWidth, eyeY, eyeX, 22.4, eyeX + eyeWidth, eyeY, ink, 1);
        } else if (blink) line(eyeX - eyeWidth, eyeY, eyeX + eyeWidth, eyeY + .4, ink, .95);
        else {
          oval(eyeX, eyeY, eyeWidth, eyeHeight, eye, -.08, .32);
          pupil(eyeX + 2 + glance * .35, eyeY + .1);
          if (frame === 24) {
            c.save(); c.beginPath(); c.ellipse(eyeX, eyeY, eyeWidth, eyeHeight, -.08, 0, Math.PI * 2); c.clip();
            c.fillStyle = p.skin; c.fillRect(eyeX - 8, 18, 16, eyeY - 18);
            line(eyeX - 8, eyeY, eyeX + 8, eyeY, ink, .65); c.restore();
          }
        }
        if (p.glasses) {
          line(eyeX - 6.4, 27.3, 27, 32.1, p.dark, 1.5);
          c.beginPath(); c.ellipse(eyeX, eyeY, 6.8, 8.6, 0, 0, Math.PI * 2);
          c.strokeStyle = p.dark; c.lineWidth = 1.5; c.stroke();
          line(eyeX + 6.6, 28, 53.7, 29.1, p.dark, 1.1);
          curve(40.2, 24.2, 42.3, 20.9, 46.2, 22.1, '#e8ccac', .68);
        }
        curve(42.5, 37.4, 46.1, 39.2, 48.4, 37.8, p.shade, .82);
        if (p.look === 'silver') {
          oval(49.6, 39.2, 4.65, 2.25, p.hair);
          curve(46.2, 39.5, 49.8, 37.7, 52.4, 38.6, p.hairLight, .75);
        }
        const mouthX = 49;
        if (game?.action === 'win') {
          c.beginPath(); c.moveTo(mouthX - 3, 40.5); c.quadraticCurveTo(mouthX, 48, mouthX + 3, 40.5); c.closePath(); fill('#51372e'); line(mouthX - 2, 41.5, mouthX + 2, 41.5, '#fff8df', 1.3);
        } else if (game?.action === 'lose') {
          c.beginPath(); c.moveTo(mouthX - 3, 44); c.quadraticCurveTo(mouthX, 39, mouthX + 3, 44); c.strokeStyle = ink; c.lineWidth = 1.2; c.stroke();
        } else if (sip === 2 || sip === 3) oval(mouthX, 43, 2.2, 2, '#633e31');
        else if (frame === 23) {
          c.beginPath(); c.moveTo(mouthX - 3, 41); c.quadraticCurveTo(mouthX, 48, mouthX + 3, 41);
          c.closePath(); fill('#51372e'); line(mouthX - 2, 42, mouthX + 2, 42, '#fff8df', 1.3);
        } else if (frame === 9) {
          c.beginPath(); c.moveTo(mouthX - 3, 42); c.quadraticCurveTo(mouthX, 45, mouthX + 3, 42);
          c.strokeStyle = ink; c.lineWidth = .85; c.stroke();
        } else line(mouthX - 2, 43, mouthX + 3, 43.2, ink, .9);
        return;
      }
      // Skin, ears, hair and hats remain separate pieces in every direction.
      if (back) {
        for (const earX of [10, 54]) {
          const inward = earX < 32 ? 1 : -1;
          oval(earX, 34, 3.7, 5.1, face);
          curve(earX - inward, 31.6, earX - inward * 1.7, 34.6, earX + inward, 36.2, p.shade, .85);
        }
      }
      if(p.look==='curls'){
        oval(32,21,26,19,p.hair);
        for(let n=0;n<9;n++)oval(10+n*5.5,15-Math.sin(n/8*Math.PI)*9,5.5,6,p.hair);
      }
      if(p.look==='buns')for(const x of [10,54]){
        oval(x,13,8,9,p.hair);line(x-3,10,x+2,16,p.hairLight,1.4);box(x-5,20,10,3,p.light,1);
      }
      oval(32, 27, headRadius, 23.1, face);
      if (back) {
        if (p.style === 'long') {
          const sway = walking ? step * 1.3 : 0;
          const hem = person === 4 ? 57 : 61;
          c.beginPath(); c.moveTo(10, 24); c.bezierCurveTo(8, -3, 55, -3, 55, 24);
          c.bezierCurveTo(53, 38, 59 + sway, 48, 51 + sway, hem - 2);
          c.quadraticCurveTo(46 + sway, hem, 41 + sway, hem - 3);
          c.quadraticCurveTo(35 + sway, hem + 1, 29 + sway, hem - 2);
          c.quadraticCurveTo(23 + sway, hem + .5, 17 + sway, hem - 2);
          c.quadraticCurveTo(7 + sway, hem - 3, 9, 39); c.closePath(); fill(hair);
          c.save(); c.clip();
          c.beginPath(); c.moveTo(17, 17); c.quadraticCurveTo(24, 8, 32, 9);
          c.bezierCurveTo(21, 22, 19 + sway, 42, 24 + sway, hem - 3);
          c.quadraticCurveTo(19 + sway, hem - 2, 15 + sway, hem - 5);
          c.quadraticCurveTo(12, 35, 17, 17); c.closePath();
          c.globalAlpha = .58; fill(p.hairLight, 0);
          curve(34, 10, 25, 33, 31 + sway, hem - 4, p.hairLight, 1.35);
          curve(41, 14, 36, 37, 40 + sway, hem - 5, p.hairLight, 1.5);
          curve(49, 21, 45, 38, 48 + sway, hem - 5, p.hairLight, 1.05);
          c.restore();
        } else if (p.look === 'curls') {
          oval(32, 24, 24, 17, hair);
          for (const [x, y] of [[13, 27], [20, 33], [29, 35], [38, 35], [47, 32], [52, 25]]) {
            oval(x, y, 5.4, 6.15, hair);
          }
          for (const [x, y] of [[15, 23], [23, 14], [34, 11], [44, 16], [22, 30], [33, 28], [44, 28]]) {
            curve(x - 2.5, y + .8, x - .5, y - 4, x + 2.8, y - .2, p.hairLight, 1.12);
          }
        } else if (p.look === 'buns') {
          c.beginPath(); c.moveTo(10, 26); c.bezierCurveTo(7, 3, 27, 1, 32, 7);
          c.bezierCurveTo(43, 0, 56, 8, 54, 28);
          c.quadraticCurveTo(50, 38, 40, 39); c.quadraticCurveTo(32, 46, 24, 39);
          c.quadraticCurveTo(12, 39, 10, 26); c.closePath(); fill(hair);
          curve(31.5, 9, 35.5, 23, 32, 38, p.hairLight, 1.35);
          curve(28, 12, 22, 9, 13, 16, p.hairLight, 1.4);
          curve(37, 13, 44, 9, 51, 17, p.hairLight, 1.25);
        } else if (p.look === 'silver') {
          c.beginPath(); c.moveTo(10, 26); c.bezierCurveTo(6, 2, 25, 1, 32, 5);
          c.bezierCurveTo(45, 1, 58, 7, 54, 28);
          c.quadraticCurveTo(49, 41, 32, 41);
          c.quadraticCurveTo(14, 41, 10, 26); c.closePath(); fill(hair);
          curve(16, 20, 25, 7, 43, 12, p.hairLight, 2.3);
          curve(14.5, 27, 28, 14, 48, 16, p.hairLight, 1.55);
          curve(18, 32, 31, 23, 48, 23, p.hairLight, 1.1);
          curve(23, 37, 33, 40, 44, 34, '#8b8c91', .85);
        } else if (p.look === 'punk') {
          c.beginPath(); c.ellipse(32, 24, 21.5, 20.4, 0, 0, Math.PI * 2);
          fill('rgba(67, 40, 59, .32)', 0);
          curve(15, 28, 17, 36, 23, 38, p.hairLight, 1.05);
          curve(49, 28, 47, 36, 41, 38, p.hairLight, 1.05);
          c.beginPath(); c.moveTo(25, 42); c.lineTo(24, 10); c.lineTo(28, 2); c.lineTo(32, 8);
          c.lineTo(37, 1); c.lineTo(39, 9); c.lineTo(44, 5); c.lineTo(40, 39);
          c.quadraticCurveTo(34, 44, 25, 42); c.closePath(); fill(hair);
          curve(32, 11, 35, 26, 33, 39, p.hairLight, 1.8);
          curve(38.5, 12, 39, 22, 37.4, 34, p.hairLight, .9);
        } else if (p.style === 'jacket') {
          c.beginPath(); c.moveTo(10, 29); c.bezierCurveTo(5, 1, 53, -6, 55, 22);
          c.quadraticCurveTo(56, 32, 49, 37);
          c.quadraticCurveTo(40, 42, 32, 41); c.quadraticCurveTo(23, 42, 17, 37);
          c.quadraticCurveTo(12, 35, 10, 29); c.closePath(); fill(hair);
          curve(15, 22, 23, 10, 40, 13, p.hairLight, 1.55);
          curve(18, 29, 31, 15, 47, 19, p.hairLight, 1.05);
          curve(22, 34, 34, 24, 48, 25, p.hairLight, .9);
        } else {
          // A narrow fringe sits below a rear-facing hat, above the exposed nape.
          c.beginPath(); c.moveTo(11, 31); c.lineTo(53, 31); c.lineTo(52, 41);
          c.lineTo(45, 39); c.lineTo(39, 42); c.lineTo(32, 40); c.lineTo(25, 42);
          c.lineTo(18, 39); c.lineTo(12, 41); c.closePath(); fill(p.hair, .4);
          line(20, 38, 25, 39, p.hairLight, .8); line(39, 39, 44, 38, p.hairLight, .8);
        }
      } else {
        if ((p.style === 'long' || p.style === 'jacket') && !p.look) {
          c.beginPath(); c.moveTo(10, 29); c.quadraticCurveTo(3, 9, 22, 4);
          c.quadraticCurveTo(47, -1, 55, 18); c.lineTo(55, 29); c.lineTo(49, 21);
          c.lineTo(42, 15); c.lineTo(35, 21); c.lineTo(29, 14); c.lineTo(18, 20); c.closePath(); fill(hair);
          if (p.style === 'long') {
            oval(11, 36, 3.8, 16, p.hair); oval(53, 37, 3.8, 15, p.hair);
            c.beginPath(); c.moveTo(10.8, 26); c.quadraticCurveTo(8.5, 36, 11, 48);
            c.moveTo(53.5, 28); c.quadraticCurveTo(55.1, 39, 52.7, 48);
            c.strokeStyle = p.hairLight; c.lineWidth = 1.15; c.stroke();
          }
        }
        if(p.look==='curls'){
          for(let n=0;n<7;n++)oval(12+n*6.4,15-Math.sin(n/6*Math.PI)*7,5,6,hair);
          for(const x of [16,28,40])line(x,10,x+2,12,p.hairLight,1.3);
        }
        if(p.look==='buns'){
          c.beginPath();c.moveTo(10,23);c.quadraticCurveTo(9,2,31,4);c.quadraticCurveTo(53,1,55,23);
          c.lineTo(46,18);c.lineTo(34,10);c.lineTo(24,19);c.closePath();fill(hair);
          line(34,8,43,13,p.hairLight,1.2);
        }
        if(p.look==='silver'){
          c.beginPath();c.moveTo(10,27);c.lineTo(10,16);c.quadraticCurveTo(12,1,32,5);
          c.quadraticCurveTo(51,1,55,18);c.lineTo(53,29);c.lineTo(47,19);c.lineTo(38,15);c.lineTo(23,16);c.closePath();fill(hair);
          line(18,13,32,9,p.hairLight,2);line(32,9,44,13,p.hairLight,2);
        }
        if(p.look==='punk'){
          oval(13,23,3.3,10,p.hairLight);oval(52,23,3.3,10,p.hairLight);
        }
        const eyes = [24, 40];
        eyes.forEach((x, i) => {
          const tilt = i === 0 ? .13 : -.13;
          if (game?.action === 'win') {
            c.beginPath(); c.moveTo(x - 6.6, 28); c.quadraticCurveTo(x, 21, x + 6.6, 28); c.strokeStyle = ink; c.lineWidth = 1; c.stroke();
          } else if (blink) line(x - 6.6, 28, x + 6.6, 28.4, ink, .95);
          else {
            oval(x, 27.3, 8.2, 9.4, eye, tilt, .32);
            // A shared gaze avoids the cross-eyed expression of the previous sprites.
            pupil(x + glance);
            if (frame === 24) {
              c.save(); c.beginPath(); c.ellipse(x, 27.3, 8.2, 9.4, tilt, 0, Math.PI * 2); c.clip();
              c.fillStyle=p.skin; c.fillRect(x-10,16,20,12); line(x-9,28,x+9,28,ink,.65); c.restore();
            }
          }
        });
        c.beginPath(); c.moveTo(32, 34);
        c.quadraticCurveTo(29.5, 37.4, 33.2, 37.2);
        c.strokeStyle = p.shade; c.lineWidth = .85; c.stroke();
        if(p.glasses){
          c.strokeStyle=p.dark;c.lineWidth=1.5;
          for(const x of eyes){c.beginPath();c.ellipse(x,28,8.7,9.6,0,0,Math.PI*2);c.stroke();}
          line(eyes[0]+7,27,eyes[1]-7,27,p.dark,1.5);line(eyes[0]-8,26,10,24,p.dark,1.5);
        }
        if(p.look==='silver'){
          oval(28,39,4.5,2.4,p.hair);oval(36,39,4.5,2.4,p.hair);
        }
        const mouthX = 32;
        if (game?.action === 'win') {
          c.beginPath(); c.moveTo(mouthX - 5, 40.5); c.quadraticCurveTo(mouthX, 49, mouthX + 5, 40.5); c.closePath(); fill('#51372e'); line(mouthX - 3, 41.5, mouthX + 3, 41.5, '#fff8df', 1.6);
        } else if (game?.action === 'lose') {
          c.beginPath(); c.moveTo(mouthX - 4, 44); c.quadraticCurveTo(mouthX, 38.5, mouthX + 4, 44); c.strokeStyle = ink; c.lineWidth = 1.2; c.stroke();
        } else if (sip === 2 || sip === 3) oval(mouthX, 43, 2.8, 2, '#633e31');
        else if (frame === 23) {
          c.beginPath(); c.moveTo(mouthX-5, 41); c.quadraticCurveTo(mouthX, 49, mouthX+5, 41); c.closePath(); fill('#51372e');
          line(mouthX-3, 42, mouthX+3, 42, '#fff8df', 1.6);
        } else if (frame === 9) {
          c.beginPath(); c.moveTo(mouthX-4, 42); c.quadraticCurveTo(mouthX, 46, mouthX+4, 42); c.strokeStyle=ink; c.lineWidth=.85; c.stroke();
        } else line(mouthX-3, 43, mouthX+3, 43.2, ink, .9);
      }
      if (!back && p.look === 'punk') {
        c.beginPath(); c.moveTo(25, 16); c.lineTo(24, 10); c.lineTo(28, 2); c.lineTo(32, 8);
        c.lineTo(37, 1); c.lineTo(39, 9); c.lineTo(44, 5); c.lineTo(40, 17); c.closePath(); fill(p.hair);
        line(33, 10, 35, 16, p.hairLight, 2);
      }
      if (p.style === 'hoodie' || p.style === 'cap') {
        if (back) {
          // The hat wraps around the skull; its rear brim sits lower than the front.
          c.beginPath(); c.moveTo(8, 34); c.bezierCurveTo(3, -5, 60, -5, 56, 34);
          c.quadraticCurveTo(33, 41, 8, 34); c.closePath(); hatCrown();
          c.beginPath(); c.moveTo(8, 31); c.quadraticCurveTo(32, 38, 56, 31);
          c.lineTo(56, 37); c.quadraticCurveTo(32, 44, 8, 37); c.closePath(); fill(p.light);
          c.save(); c.globalAlpha = .43;
          curve(14, 33.4, 32, 38.3, 50, 33.4, '#fff0c9', 1.1);
          c.restore();
        } else {
          c.beginPath(); c.moveTo(8, 21); c.bezierCurveTo(7, -2, 56, -2, 56, 21); c.closePath(); hatCrown();
          c.beginPath(); c.moveTo(8, 17); c.quadraticCurveTo(32, 14, 56, 17); c.lineTo(56, 22);
          c.quadraticCurveTo(31, 19, 8, 22); c.closePath(); fill(p.light);
        }
        if(p.look==='baseball'){
          if(!back){
            c.beginPath();c.moveTo(18,19);c.lineTo(51,20);c.lineTo(48,25);c.lineTo(18,23);c.closePath();fill(p.dark);
            box(26,9,10,6,p.light,1);
          } else {
            box(24, 31, 16, 7, p.hair, 2);
            curve(25, 35.2, 32, 37.4, 39, 35.2, p.light, 2.1);
            box(34.5, 34.6, 2.9, 2.8, '#b18a58', .5);
          }
        }else if(p.look==='beanie'){
          if (back) {
            for (let x = 13; x < 55; x += 4.5) {
              const ribY = 33 + Math.sin((x - 8) / 48 * Math.PI) * 3.2;
              line(x, ribY, x - .6, ribY + 3, p.dark, .66);
            }
          } else {
            for (let x = 13; x < 55; x += 5) line(x, 18, x, 22, p.dark, .6);
          }
          box(39,back?35:17,5,5,p.shirt,1);
        }else if (person === 5) {
          const flapY = back ? 32 : 19;
          box(7, flapY, 6, 12, p.dark, 2); box(52, flapY, 6, 12, p.dark, 2);
          if (back) {
            curve(10, 34, 8.5, 39, 10.5, 42, p.light, 1.25);
            curve(55, 34, 56.5, 39, 54.5, 42, p.light, 1.25);
          } else {
            line(10, flapY+3, 10, flapY+9, p.light, .7); line(55, flapY+3, 55, flapY+9, p.light, .7);
          }
        } else {
          for (const [x,y] of [[29,4],[33,3],[36,4],[32,6]]) oval(x+step*.6,y,3,2.6,p.light,0,.3);
        }
      }
    });
    if ((!back || game) && !profile && !frontal) drawNearArm();
  });
}
