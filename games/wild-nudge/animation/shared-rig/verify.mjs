import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {resolve} from 'node:path';
import sharp from 'sharp';

const project = import.meta.dirname, root = resolve(project, '../../../..');
const spec = JSON.parse(await readFile(resolve(project, 'skeleton.json'), 'utf8'));
const cli = process.env.ROYAL_RIVE_CLI || resolve(homedir(), `.rive/versions/${spec.cliVersion}/rive${process.platform === 'win32' ? '.exe' : ''}`);
const run = (command, args, input) => new Promise((accept, reject) => {
  const process = spawn(command, args, {cwd: project, stdio: ['pipe', 'pipe', 'pipe']});
  let out = '', err = '';
  process.stdout.on('data', value => out += value); process.stderr.on('data', value => err += value);
  process.on('error', reject);
  process.on('exit', code => code === 0 && !/^err /m.test(out) ? accept(out) : reject(Error(`${code}: ${err}\n${out}`)));
  process.stdin.end(input || '');
});
const proof = JSON.parse(await readFile(resolve(project, 'verification.json'), 'utf8'));
for (const [path, expected] of Object.entries(proof.inputHashes)) {
  assert.equal(createHash('sha256').update(await readFile(resolve(root, path))).digest('hex'), expected, `Rebuild after editing ${path}`);
}
const tree = JSON.parse(await run(cli, ['inspect', project, '--json']));
assert.deepEqual(tree.problems, []);
const nodes = [];
const visit = object => { if (object?.type) nodes.push(object); for (const child of object?.children || []) visit(child); };
tree.artboards.forEach(visit);
assert.equal(nodes.filter(object => ['Bone', 'RootBone'].includes(object.type)).length, 31);
assert.equal(nodes.filter(object => object.type === 'Image').length, 19);
assert.equal(nodes.filter(object => object.type === 'Mesh').length, 19);
assert.equal(nodes.filter(object => object.type === 'IKConstraint').length, 4);
assert.deepEqual(nodes.filter(object => object.type === 'LinearAnimation').map(object => object.name), spec.modes);
for (const weight of nodes.filter(object => object.type === 'Weight')) {
  const packed = weight.values >>> 0;
  assert.equal([0, 8, 16, 24].reduce((total, bit) => total + ((packed >>> bit) & 255), 0), 255);
}
const qa = resolve(project, 'build/qa');
await mkdir(qa, {recursive: true});
const file = name => resolve(qa, name);
const commands = ['advance 1', `screenshot ${file('rest.png')}`, `data-dump ${file('rest.json')}`, 'advance 360', `screenshot ${file('loop.png')}`];
for (let mode = 0; mode < 7; mode++) {
  commands.push('reload', `data mode=${mode}`, 'advance 36', `screenshot ${file(`mode-${mode}.png`)}`, `data-dump ${file(`mode-${mode}.json`)}`);
}
commands.push('reload', 'data rigOpacity=1', 'advance 1', `screenshot ${file('overlay.png')}`, 'data skinOpacity=0', 'advance 1', `screenshot ${file('skeleton.png')}`);
commands.push('reload', 'data ikFeet=1', 'data ikHands=1', 'advance 2', `data-dump ${file('ik-rest.json')}`, `screenshot ${file('ik-rest.png')}`);
const targets = {hand_r: [174, 454], hand_l: [351, 347], foot_r: [148, 830], foot_l: [416, 829]};
for (const [name, [x, y]] of Object.entries(targets)) commands.push(`data ${name}_x=${x}`, `data ${name}_y=${y}`);
commands.push('advance 2', `data-dump ${file('ik-moved.json')}`, 'data rigOpacity=1', 'advance 1', `screenshot ${file('ik-moved.png')}`);
commands.push('reload', 'data mode=5', 'advance 24', 'data mode=1', 'advance 20', 'data mode=6', 'advance 24', 'data mode=0', 'advance 380', `screenshot ${file('interrupt.png')}`, `data-dump ${file('interrupt.json')}`);
// All movie frames come from the native Rive renderer, in one process.
commands.push('reload', 'advance 1');
for (let frame = 0; frame < 90; frame++) {
  if (frame === 45) commands.push('data mode=3');
  if (frame === 68) commands.push('data mode=0');
  commands.push(`screenshot ${file(`frame-${String(frame).padStart(3, '0')}.png`)}`, 'advance 4');
}
commands.push('quit');
await run(cli, [project, '--commands'], commands.join('\n') + '\n');
const raw = path => sharp(path).removeAlpha().raw().toBuffer();
const difference = async (first, second) => {
  const [a, b] = await Promise.all([raw(first), raw(second)]);
  assert.equal(a.length, b.length);
  let sum = 0, pixels = 0;
  for (let i = 0; i < a.length; i += 3) {
    let changed = false;
    for (let channel = 0; channel < 3; channel++) { const d = Math.abs(a[i + channel] - b[i + channel]); sum += d; if (d > 3) changed = true; }
    if (changed) pixels++;
  }
  return {meanAbsoluteChannelDifference: sum / a.length, changedPixels: pixels};
};
const loop = await difference(file('rest.png'), file('loop.png'));
assert.ok(loop.meanAbsoluteChannelDifference < .2, `Idle loop does not return: ${JSON.stringify(loop)}`);
const modeDifferences = [];
for (let mode = 0; mode < 7; mode++) {
  const data = JSON.parse(await readFile(file(`mode-${mode}.json`), 'utf8'));
  assert.equal(data.viewModel.properties.find(property => property.path === 'mode').value, mode);
  const result = await difference(file('rest.png'), file(`mode-${mode}.png`));
  assert.ok(result.changedPixels > 100, `Mode ${mode} did not move the picture`);
  modeDifferences.push({mode: spec.modes[mode], ...result});
}
const ikErrors = {};
for (const capture of ['ik-rest', 'ik-moved']) {
  const data = JSON.parse(await readFile(file(`${capture}.json`), 'utf8'));
  const values = Object.fromEntries(data.viewModel.properties.map(property => [property.path, property.value]));
  ikErrors[capture] = Object.fromEntries(Object.keys(targets).map(name => {
    const error = Math.hypot(values[`${name}_tip_x`] - values[`${name}_x`], values[`${name}_tip_y`] - values[`${name}_y`]);
    assert.ok(error < .1, `${capture} ${name}: IK missed its target by ${error}`);
    return [name, error];
  }));
}
const interrupted = JSON.parse(await readFile(file('interrupt.json'), 'utf8'));
assert.equal(interrupted.viewModel.properties.find(property => property.path === 'mode').value, 0);
const overlay = await difference(file('rest.png'), file('overlay.png'));
assert.ok(overlay.changedPixels > 1000, 'Debug bones are not visible');
const ikRestPicture = await difference(file('rest.png'), file('ik-rest.png'));
assert.ok(ikRestPicture.meanAbsoluteChannelDifference < .5, 'IK flips the bind pose');
await sharp(file('rest.png')).png().toFile(resolve(project, 'preview.png'));
await sharp(file('overlay.png')).png().toFile(resolve(project, 'rig-overview.png'));
const tiles = [];
for (let mode = 0; mode < 7; mode++) {
  const label = Buffer.from(`<svg width="240" height="30"><text x="12" y="22" fill="#e9edf3" font-family="sans-serif" font-size="16">${mode}: ${spec.modes[mode]}</text></svg>`);
  tiles.push({input: await sharp(file(`mode-${mode}.png`)).resize(240, 360).extend({top: 30, bottom: 0, left: 0, right: 0, background: '#1d1d1d'}).composite([{input: label, left: 0, top: 0}]).png().toBuffer(), left: mode % 4 * 240, top: Math.floor(mode / 4) * 390});
}
tiles.push({input: await sharp(file('ik-moved.png')).resize(240, 360).extend({top: 30, bottom: 0, left: 0, right: 0, background: '#1d1d1d'}).png().toBuffer(), left: 720, top: 390});
await sharp({create: {width: 960, height: 780, channels: 3, background: '#1d1d1d'}}).composite(tiles).png().toFile(resolve(project, 'states-overview.png'));
await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '15', '-i', file('frame-%03d.png'), '-vf', 'scale=480:720', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', resolve(project, 'preview.mp4')]);
const result = {format: 'star-spin-rig-native-qa-v1', cliVersion: spec.cliVersion, verificationSha256: createHash('sha256').update(await readFile(resolve(project, 'verification.json'))).digest('hex'), loop, modeDifferences, ikErrors, ikRestPicture, interruptionReturnedToIdle: true, debugOverlayChanges: overlay.changedPixels, movie: 'preview.mp4', coverage: 'Native CLI at 640x960. Authoring controls and seven states only; no host, wallet, browser runtime or physical device check.'};
await writeFile(resolve(project, 'native-qa.json'), JSON.stringify(result, null, 2) + '\n');
await rm(qa, {recursive: true});
console.log(JSON.stringify(result, null, 2));
