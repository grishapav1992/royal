/** Cut an actual native-host recording, without changing frames or injecting outcomes. */
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const folder='artifacts/work/caribbean-character-motion';
const report=JSON.parse(await readFile(folder+'/character-measurements.json','utf8'));
const cuts=report.cuts.map(c=>({...c}));
for(const name of ['positive','bonus']){
 const result=report.results.find(r=>r.name===(name==='bonus'?'natural-flagship':name));
 const target=cuts.find(c=>c.name===name),history=result?.captain;
 const stop=history?.find(e=>e.cue==='stop'),end=history?.find(e=>e.cue===(name==='bonus'?'bonus':'win'));
 if(stop&&end){target.start=Math.max(0,(stop.wallTimeMs-report.videoStartWall)/1000-.3);target.duration=(end.wallTimeMs-stop.wallTimeMs)/1000+1.4;}
}
const names=['positive','bonus','cannon','bigwin','partial','loss','return'];
const chosen=names.map(name=>cuts.find(c=>c.name===name));
if(chosen.some(c=>!c))throw Error('The complete real-host showcase test must pass first');
const split='[0:v]split='+chosen.length+chosen.map((_,i)=>`[s${i}]`).join('');
const trims=chosen.map((c,i)=>`[s${i}]trim=start=${c.start}:duration=${c.duration},setpts=PTS-STARTPTS,fps=25,setsar=1[v${i}]`);
const join=chosen.map((_,i)=>`[v${i}]`).join('')+`concat=n=${chosen.length}:v=1:a=0[out]`;
const destination='docs/concepts/caribbean-treasures/animation-preview.mp4';
const result=spawnSync(process.argv[2]||'ffmpeg',['-hide_banner','-loglevel','error','-y','-i',report.video,'-filter_complex',[split,...trims,join].join(';'),'-map','[out]','-an','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',destination],{stdio:'inherit',windowsHide:true});
if(result.error)throw result.error;if(result.status)process.exit(result.status);
console.log(JSON.stringify({destination,silent:true,clips:chosen.map(c=>({name:c.name,duration:c.duration})),durationSeconds:chosen.reduce((sum,c)=>sum+c.duration,0)}));
