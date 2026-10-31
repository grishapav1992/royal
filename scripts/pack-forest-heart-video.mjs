import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const [kind, source] = process.argv.slice(2);
if (!['look', 'focus', 'magic'].includes(kind) || !source) throw Error('Usage: node scripts/pack-forest-heart-video.mjs look|focus|magic source.mp4');
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'public/assets/forest-heart/video-v3', kind + '.mp4');
const probe = spawnSync('ffprobe', ['-v','error','-show_entries','stream=width,height','-of','json',source], {encoding:'utf8'});
if (probe.status !== 0 || !JSON.parse(probe.stdout).streams.some(stream=>stream.width===720&&stream.height===1280)) throw Error('Expected the reviewed 720x1280 reference framing');
mkdirSync(resolve(output, '..'), {recursive:true});
const alphaPath = resolve(root, '../generation-v3/reference-alpha.png');
await sharp(resolve(root, 'public/assets/forest-heart/v3/elf-idle.webp')).resize(480,576).extractChannel('alpha').png().toFile(alphaPath);
const motion = '[0:v]trim=start=0:duration=5,setpts=(PTS-STARTPTS)*3/5,crop=640:768:40:256,scale=480:576';
// Keep enclosed dark costume shadows opaque while preserving the reference's real transparent gaps.
const matte = ",format=rgba,colorkey=0x000000:0.01:0.015,split[color][matte];[color]format=rgb24[rgb];[matte]alphaextract,split[rawalpha][holes];[holes]lut=c0='if(gte(val,128),255,0)',floodfill=x=0:y=0:s0=0:d0=128,floodfill=x=479:y=0:s0=0:d0=128,floodfill=x=0:y=575:s0=0:d0=128,floodfill=x=479:y=575:s0=0:d0=128,lut=c0='if(eq(val,0),255,0)'[holemask];[1:v]format=gray[reference];[holemask][reference]blend=all_mode=multiply[fill];[rawalpha][fill]blend=all_mode=lighten,format=rgb24[alpha];[rgb][alpha]hstack=inputs=2,format=yuv420p[out]";
const result = spawnSync('ffmpeg', ['-y','-hide_banner','-loglevel','error','-i',source,'-loop','1','-framerate','24','-i',alphaPath,'-filter_complex',motion+matte,'-map','[out]','-an','-r','24','-frames:v','72','-t','3','-c:v','libx264','-crf','19','-preset','medium','-movflags','+faststart',output], {stdio:'inherit'});
if (result.status !== 0) throw Error('Video packing failed');
console.log(output);
