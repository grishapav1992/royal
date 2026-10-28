import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
const source=resolve('games/caribbean-treasures/assets/audio-source'),out=resolve('public/assets/caribbean-treasures/audio');
await mkdir(out,{recursive:true});
function run(args){const r=spawnSync(ffmpeg,['-hide_banner','-nostdin',...args],{maxBuffer:128*1024*1024});if(r.error||r.status!==0)throw r.error||Error(r.stderr.toString());return r;}
function pcm(input,filter='anull'){const raw=run(['-loglevel','error','-i',input,'-af',filter,'-ac','1','-ar','44100','-f','f32le','pipe:1']).stdout;return new Float32Array(raw.buffer,raw.byteOffset,raw.length/4);}
function metrics(samples){let peak=0,sum=0,edge=0,accent=0;for(let i=0;i<samples.length;i++){const v=Math.abs(samples[i]);peak=Math.max(peak,v);sum+=v*v;if(i<32||i>=samples.length-32)edge=Math.max(edge,v);}for(let i=0;i<samples.length;i++)if(Math.abs(samples[i])>=peak*.25){accent=i/44100;break;}return{durationSeconds:samples.length/44100,peak,rms:Math.sqrt(sum/samples.length),edgePeak:edge,boundaryPeak:Math.max(Math.abs(samples[0]),Math.abs(samples.at(-1))),accentOffsetSeconds:accent};}
const clips={music:{ext:'flac'},'stop-a':{max:.27},'stop-b':{max:.27},'stop-c':{max:.27},click:{max:.23},latch:{max:.75},creak:{max:1.35},coins:{max:1.8},'coins-small':{max:1.1},cannon:{max:2.4},thud:{max:.5},metal:{max:.75}};
const manifest={format:1,sampleRate:44100,files:{}};
for(const [id,options] of Object.entries(clips)){
 const input=resolve(source,id+'.'+(options.ext||'ogg')),file=id+'.m4a',output=resolve(out,file);
 let filter;
 if(id==='music'){
  const first=run(['-i',input,'-af','loudnorm=I=-18:TP=-2:LRA=11:print_format=json','-f','null','-']).stderr.toString();
  const stats=JSON.parse(first.slice(first.lastIndexOf('{'),first.lastIndexOf('}')+1));
  filter=`loudnorm=I=-18:TP=-2:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`;
 }else filter=`silenceremove=start_periods=1:start_duration=0.001:start_threshold=-50dB,atrim=duration=${options.max}`;
 const before=metrics(pcm(input,filter)),duration=before.durationSeconds;
 if(id!=='music')filter+=`,volume=${.72/Math.max(.0001,before.peak)}`;
 filter+=`,afade=t=in:st=0:d=${id==='music'?.03:.004},afade=t=out:st=${Math.max(.004,duration-(id==='music'?.03:.035))}:d=${id==='music'?.03:.035}`;
 if(id!=='music')filter+=',adelay=30:all=1,apad=pad_dur=0.03';
 run(['-loglevel','error','-y','-i',input,'-af',filter,'-ar','44100','-ac','2','-c:a','aac','-b:a',id==='music'?'160k':'128k','-movflags','+faststart',output]);
 const bytes=await readFile(output);manifest.files[id]={file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...metrics(pcm(output))};
}
await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({clips:Object.keys(manifest.files).length,bytes:Object.values(manifest.files).reduce((n,v)=>n+v.bytes,0),music:manifest.files.music}));
