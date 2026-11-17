import {readFile, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {resolve, relative} from 'node:path';
import sharp from 'sharp';

const project = import.meta.dirname;
const root = resolve(project, '../../../..');
const spec = JSON.parse(await readFile(resolve(project, 'skeleton.json'), 'utf8'));
const skin = JSON.parse(await readFile(resolve(project, 'skins/vespera.json'), 'utf8'));
const cli = process.env.ROYAL_RIVE_CLI || resolve(homedir(), `.rive/versions/${spec.cliVersion}/rive${process.platform === 'win32' ? '.exe' : ''}`);
const sha = value => createHash('sha256').update(value).digest('hex');
const n = value => Number(value.toFixed(8));
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const id = value => `0:${value}`;
const run = args => new Promise((accept, reject) => {
  const child = spawn(cli, args, {cwd: root, stdio: ['ignore', 'pipe', 'pipe']});
  let out = '', err = '';
  child.stdout.on('data', value => out += value);
  child.stderr.on('data', value => err += value);
  child.on('error', reject);
  child.on('exit', code => code === 0 ? accept(out) : reject(Error(`Rive failed (${code}): ${args.join(' ')}\n${err}${out}`)));
});
if ((await run(['--version'])).trim() !== `rive ${spec.cliVersion}`) throw Error(`Use Rive CLI ${spec.cliVersion}`);

const bones = spec.bones.map(([name, parent], i) => {
  const [from, to] = skin.pose[name] || [];
  if (!from || !to) throw Error(`Missing bind pose: ${name}`);
  return {name, parent, from, to, id: id(100 + i), angle: Math.atan2(to[1] - from[1], to[0] - from[0]), length: Math.hypot(to[0] - from[0], to[1] - from[1])};
});
const byName = new Map(bones.map(bone => [bone.name, bone]));
for (const bone of bones) {
  const parent = byName.get(bone.parent);
  const [x, y] = bone.from;
  bone.localAngle = bone.angle - (parent?.angle || 0);
  const dx = x - (parent?.from[0] || 0), dy = y - (parent?.from[1] || 0), a = parent?.angle || 0;
  bone.localX = Math.cos(a) * dx + Math.sin(a) * dy;
  bone.localY = -Math.sin(a) * dx + Math.cos(a) * dy;
  bone.kind = parent && Math.hypot(x - parent.to[0], y - parent.to[1]) < 0.0001 ? 'Bone' : 'RootBone';
}
const properties = [['mode', 0], ['rigOpacity', 0], ['skinOpacity', 1], ['ikFeet', 0], ['ikHands', 0]];
const goals = [
  ['hand_r', 'forearm_r', 'ikHands', true], ['hand_l', 'forearm_l', 'ikHands', true],
  ['foot_r', 'shin_r', 'ikFeet', true], ['foot_l', 'shin_l', 'ikFeet', true]
].map(([name, constrained, strength, invert], i) => {
  const position = byName.get(constrained).to;
  properties.push([`${name}_x`, position[0]], [`${name}_y`, position[1]]);
  return {name, constrained, strength, invert, position, id: id(300 + i)};
});
const propertyId = name => id(701 + properties.findIndex(([key]) => key === name));
const bind = (name, key) => `<DataBindContext sourcePathIds="0:700-${propertyId(name)}" propertyKey="${key}"/>`;
for (const goal of goals) properties.push([`${goal.name}_tip_x`, 0], [`${goal.name}_tip_y`, 0]);
const color = name => name.includes('_r') ? 'FF55CFE4' : name.includes('_l') ? 'FFFFC76B' : name.startsWith('cape') || name.startsWith('cloth') || name.startsWith('hair') ? 'FFD697F5' : 'FF9BE5BC';
function drawBone(bone) {
  const guide = `<Node name="guide_${bone.name}">${bind('rigOpacity', 18)}<Shape name="joint_${bone.name}"><Ellipse width="7" height="7"/><Fill><SolidColor colorValue="${color(bone.name)}"/></Fill></Shape><Shape x="${n(bone.length / 2)}" name="axis_${bone.name}"><Rectangle width="${n(bone.length)}" height="2.5"/><Fill><SolidColor colorValue="${color(bone.name)}"/></Fill></Shape></Node>`;
  const goal = goals.find(value => value.constrained === bone.name);
  const constraint = goal ? `<IKConstraint targetId="${goal.id}" parentBoneCount="1" invertDirection="${goal.invert}" strength="0" name="ik_${goal.name}">${bind(goal.strength, 172)}</IKConstraint><Node x="${n(bone.length)}" name="probe_${goal.name}"><DataBindContext sourcePathIds="0:700-${propertyId(`${goal.name}_tip_x`)}" propertyKey="808" direction="true"/><DataBindContext sourcePathIds="0:700-${propertyId(`${goal.name}_tip_y`)}" propertyKey="809" direction="true"/></Node>` : '';
  const position = bone.kind === 'RootBone' ? ` x="${n(bone.localX)}" y="${n(bone.localY)}"` : '';
  return `<${bone.kind} id="${bone.id}" name="${bone.name}"${position} length="${n(bone.length)}" rotation="${n(bone.localAngle)}">${guide}${constraint}${bones.filter(child => child.parent === bone.name).map(drawBone).join('')}</${bone.kind}>`;
}
function varints(values) {
  const bytes = [];
  for (let value of values) {
    while (value >= 128) { bytes.push((value & 127) | 128); value >>>= 7; }
    bytes.push(value);
  }
  return Buffer.from(bytes).toString('base64');
}
function packedWeights(v, count) {
  const position = Math.max(0, Math.min(count - 1, v * (count - 1)));
  const lower = Math.floor(position), upper = Math.min(count - 1, lower + 1);
  if (lower === upper) return {indices: lower + 1, values: 255};
  const hi = Math.round((position - lower) * 255), lo = 255 - hi;
  return {indices: (lower + 1) + ((upper + 1) << 8), values: lo + (hi << 8)};
}
const assetNodes = [], meshes = [], inputHashes = {};
for (const [index, slot] of spec.slotsFrontToBack.entries()) {
  const part = skin.parts[slot];
  if (!part || !part.bones.length || part.bones.some(name => !byName.has(name))) throw Error(`Invalid slot ${slot}`);
  const file = resolve(root, skin.sourceDirectory, skin.textureDirectory, `${slot}.png`);
  const bytes = await readFile(file), metadata = await sharp(bytes).metadata();
  if (!metadata.hasAlpha) throw Error(`Texture has no alpha: ${slot}`);
  inputHashes[relative(root, file)] = sha(bytes);
  const [x, y, width, height] = part.rect, [nx, ny] = part.mesh || [1, 1];
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw Error(`Invalid fitting ${slot}`);
  const points = [], lookup = new Map();
  const point = (column, row) => {
    const key = `${column},${row}`;
    if (!lookup.has(key)) { lookup.set(key, points.length); points.push({column, row}); }
    return lookup.get(key);
  };
  // The editor requires a leading contour run, followed by the interior.
  for (let column = 0; column <= nx; column++) point(column, 0);
  for (let row = 1; row <= ny; row++) point(nx, row);
  for (let column = nx - 1; column >= 0; column--) point(column, ny);
  for (let row = ny - 1; row > 0; row--) point(0, row);
  const contourCount = points.length;
  for (let row = 1; row < ny; row++) for (let column = 1; column < nx; column++) point(column, row);
  const triangles = [];
  for (let row = 0; row < ny; row++) for (let column = 0; column < nx; column++) {
    triangles.push(point(column, row), point(column + 1, row), point(column + 1, row + 1), point(column, row), point(column + 1, row + 1), point(column, row + 1));
  }
  const assetId = id(500 + index);
  assetNodes.push(`<ImageAsset id="${assetId}" file="${xml(relative(project, file).replaceAll('\\', '/'))}" name="vespera_${slot}"/>`);
  const vertices = points.map(({column, row}, i) => {
    const u = column / nx, v = row / ny, weights = packedWeights(v, part.bones.length), type = i < contourCount ? 'ContourMeshVertex' : 'MeshVertex';
    return `<${type} x="${n(x + u * width + v * (part.shearX || 0))}" y="${n(y + v * height)}" u="${u}" v="${v}"><Weight indices="${weights.indices}" values="${weights.values}"/></${type}>`;
  }).join('');
  const tendons = part.bones.map(name => {
    const bone = byName.get(name), c = n(Math.cos(bone.angle)), s = n(Math.sin(bone.angle));
    return `<Tendon boneId="${bone.id}" xx="${c}" xy="${s}" yx="${-s}" yy="${c}" tx="${bone.from[0]}" ty="${bone.from[1]}" name="bind_${name}"/>`;
  }).join('');
  meshes.push({slot, vertices: points.length, triangles: triangles.length / 3, tendons: part.bones, rect: part.rect});
  part.rml = `<Image assetId="${assetId}" originX="0" originY="0" name="slot_${slot}"><Mesh triangleIndexBytes="${varints(triangles)}" name="mesh_${slot}">${vertices}<Skin name="skin_${slot}">${tendons}</Skin></Mesh></Image>`;
}
const condition = mode => `<TransitionViewModelCondition opValue="equal"><TransitionPropertyViewModelComparator><BindablePropertyNumber>${bind('mode', 636)}</BindablePropertyNumber></TransitionPropertyViewModelComparator><TransitionValueNumberComparator value="${mode}"/></TransitionViewModelCondition>`;
const machine = `<StateMachine name="Character" id="0:800"><StateMachineLayer name="Reactions"><AnyState x="-200" y="-200"/><ExitState x="1000" y="-200"/><EntryState x="-200" y="0"><StateTransition stateToId="0:810"/></EntryState>${spec.modes.map((name, i) => `<AnimationState id="${id(810 + i)}" animationId="${id(850 + i)}" reset="true" x="${i % 4 * 240}" y="${Math.floor(i / 4) * 220}">${spec.modes.map((other, j) => i === j ? '' : `<StateTransition stateToId="${id(810 + j)}" duration="160">${condition(j)}</StateTransition>`).join('')}</AnimationState>`).join('')}</StateMachineLayer></StateMachine>`;
const key = (frame, value) => `<KeyFrameDouble frame="${frame}" value="${n(value)}" interpolationType="cubic"><CubicEaseInterpolator x1="0.42" y1="0" x2="0.58" y2="1"/></KeyFrameDouble>`;
const keyed = (objectId, property, values) => `<KeyedObject objectId="${objectId}"><KeyedProperty property="${property}">${values.map(([frame, value]) => key(frame, value)).join('')}</KeyedProperty></KeyedObject>`;
const radians = degrees => degrees * Math.PI / 180;
const motion = skin.motion;
const animations = spec.modes.map((name, mode) => {
  const loop = [0, 1, 4].includes(mode), duration = loop ? motion.idleFrames : 90;
  const samples = loop ? [[0, 0], [.25, 1], [.5, 0], [.75, -1], [1, 0]] : [[0, 0], [.2, -.15], [.4, 1], [.65, .35], [1, 0]];
  const intensity = [1, .55, .8, 1.2, 1.15, 1, .7][mode];
  const tracks = bones.map(bone => {
    let amplitude = 0;
    if (bone.name === 'spine') amplitude = motion.bodyDegrees;
    if (bone.name === 'chest') amplitude = -motion.bodyDegrees * .5;
    if (bone.name === 'head') amplitude = motion.headDegrees * (loop ? 1 : 3);
    if (bone.name.startsWith('hair_')) amplitude = motion.hairDegrees * Number(bone.name.slice(-1)) * .45;
    if (bone.name.startsWith('cape_')) amplitude = motion.capeDegrees * Number(bone.name.slice(-1));
    if (bone.name.startsWith('cloth_')) amplitude = motion.clothDegrees * Number(bone.name.slice(-1)) * .5;
    if (!loop && bone.name === 'upper_arm_r') amplitude = -motion.gestureDegrees * ([2, 3, 5].includes(mode) ? 1 : .4);
    if (!loop && bone.name === 'forearm_r') amplitude = -motion.gestureDegrees * .45;
    if (!loop && bone.name === 'hand_r') amplitude = motion.gestureDegrees * .2;
    return keyed(bone.id, 'rotation', samples.map(([t, value]) => [Math.round(t * duration), bone.localAngle + radians(amplitude * value * intensity)]));
  }).join('');
  return `<LinearAnimation name="${name}" id="${id(850 + mode)}" fps="60" duration="${duration}" loopValue="${loop ? 'loop' : 'oneShot'}">${tracks}</LinearAnimation>`;
}).join('\n');
const goalNodes = goals.map(goal => `<Node id="${goal.id}" x="${goal.position[0]}" y="${goal.position[1]}" name="target_${goal.name}">${bind(`${goal.name}_x`, 13)}${bind(`${goal.name}_y`, 14)}<Shape name="handle_${goal.name}" opacity="0">${bind('rigOpacity', 18)}<Ellipse width="16" height="16"/><Stroke thickness="2"><SolidColor colorValue="${color(goal.name)}"/></Stroke></Shape></Node>`).join('');
const viewModel = `<ViewModel name="Character" id="0:700" defaultInstanceId="0:740">${properties.map(([name]) => `<ViewModelPropertyNumber name="${name}" id="${propertyId(name)}"/>`).join('')}<ViewModelInstance name="Default" id="0:740" exports="true">${properties.map(([name, value]) => `<ViewModelInstanceNumber viewModelPropertyId="${propertyId(name)}" propertyValue="${value}"/>`).join('')}</ViewModelInstance></ViewModel>`;
const scene = `<Rive version="1" kind="fragment"><Artboard name="${skin.artboard}" id="0:2" width="640" height="960" styleId="0:3" defaultStateMachineId="0:800" viewModelId="0:700" viewModelInstanceId="0:740"><LayoutComponentStyle id="0:3" name="Character canvas"/>${bones.filter(bone => !bone.parent).map(drawBone).join('')}${goalNodes}<Node name="Texture slots">${bind('skinOpacity', 18)}${spec.slotsFrontToBack.map(slot => skin.parts[slot].rml).join('\n')}</Node>${machine}${animations}</Artboard>${viewModel}${assetNodes.join('\n')}</Rive>\n`;
await writeFile(resolve(project, 'scene.rml'), scene);
const verify = JSON.parse(await run([project, '--verify', '--format=json']));
const inspection = JSON.parse(await run(['inspect', project, '--summary']));
if (inspection.problems?.length) throw Error(JSON.stringify(inspection.problems));
await run([project, '--screenshot', '--advance=1']);
for (const file of ['build.mjs', 'verify.mjs', 'skeleton.json', 'skins/vespera.json', 'scene.rml', 'rive.yaml']) inputHashes[relative(root, resolve(project, file))] = sha(await readFile(resolve(project, file)));
await writeFile(resolve(project, 'verification.json'), JSON.stringify({format: spec.format, cliVersion: spec.cliVersion, artboard: skin.artboard, stateMachine: spec.stateMachine, viewModel: spec.viewModel, modes: spec.modes, bones: bones.length, slots: meshes, inputHashes, verify, inspection, runtimeExport: 'not exported: CLI 1.9.2 requires a Rive login for local publishing', status: 'local authoring prototype, not connected to game runtime'}, null, 2) + '\n');
console.log(JSON.stringify({cliVersion: spec.cliVersion, bones: bones.length, textures: meshes.length, animations: spec.modes, verify, inspection}, null, 2));
