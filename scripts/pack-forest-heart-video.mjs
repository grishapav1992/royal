import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const [kind, source] = process.argv.slice(2);
if (!['idle', 'channel'].includes(kind) || !source) throw Error('Usage: node scripts/pack-forest-heart-video.mjs idle|channel source.mp4');
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'public/assets/forest-heart/kling-v1', kind + '.mp4');
const probe = spawnSync('ffprobe', ['-v','error','-show_entries','stream=width,height','-of','json',source], {encoding:'utf8'});
if (probe.status !== 0 || !JSON.parse(probe.stdout).streams.some(stream=>stream.width===720&&stream.height===1280)) throw Error('Expected the reviewed 720x1280 reference framing');
mkdirSync(resolve(output, '..'), {recursive:true});
const motion = kind === 'idle' ?
  '[0:v]trim=duration=2.5,setpts=PTS-STARTPTS,crop=720:864:0:208,scale=480:576,split[f][r];[r]reverse,trim=start=0.041667,setpts=PTS-STARTPTS[back];[f][back]concat=n=2:v=1:a=0' :
  '[0:v]trim=duration=5,setpts=PTS-STARTPTS,crop=720:864:0:208,scale=480:576';
// Remove chroma and suppress reflected blue only near the alpha boundary, preserving the purple costume.
const matte = ',format=rgba,colorkey=0x0000ff:0.20:0.08,split=4[original][spill][mask][matte];[original]format=gbrp[originalrgb];[spill]despill=type=blue:mix=0.3:expand=0:green=0:blue=-1,format=gbrp[clean];[mask]alphaextract,erosion,erosion,erosion,negate,format=gbrp[edge];[originalrgb][clean][edge]maskedmerge,format=rgb24[rgb];[matte]alphaextract,format=rgb24[alpha];[rgb][alpha]hstack=inputs=2,format=yuv420p[out]';
const result = spawnSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-i',source,'-filter_complex',motion+matte,'-map','[out]','-an','-r','24','-c:v','libx264','-crf','19','-preset','medium','-movflags','+faststart',output], {stdio:'inherit'});
if (result.status !== 0) throw Error('Video packing failed');
console.log(output);
