/** Original deterministic PCM authoring, not a game outcome generator. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const rate=24000;
const specs={scrape:[.48,.025],stone:[.48,.018],step:[.34,.012],chest:[.82,.025],lever:[.92,.018],rope:[.88,.27],relic:[1.95,.03],neutral:[.38,.018],return:[.68,.018],win:[1.5,.025],big:[2.65,.03],ambience:[8,0]};
export function synthesize(name){
  const [duration,accent]=specs[name],size=Math.ceil(duration*rate),channels=[new Float32Array(size),new Float32Array(size)];
  let seed=0x7f4a7c15+Object.keys(specs).indexOf(name)*613;
  const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/2147483648-1;};
  const add=(sample,at,pan=0)=>{if(at<0||at>=size)return;channels[0][at]+=sample*Math.sqrt((1-pan)/2);channels[1][at]+=sample*Math.sqrt((1+pan)/2);};
  const tone=(hz,start,length,level,decay=.12,pan=0,endHz=hz)=>{
    let phase=0;for(let i=0;i<length*rate;i++){const t=i/rate,f=hz+(endHz-hz)*Math.min(1,t/length);phase+=2*Math.PI*f/rate;
      const envelope=Math.min(1,t/.007)*Math.exp(-t/decay)*Math.min(1,(length-t)/.028);
      add((Math.sin(phase)+.12*Math.sin(phase*2.003))*level*envelope,Math.floor(start*rate)+i,pan);}
  };
  const noise=(start,length,level,cutoff,decay,pan=0,attack=.005)=>{
    let low=0;const alpha=1-Math.exp(-2*Math.PI*cutoff/rate);
    for(let i=0;i<length*rate;i++){const t=i/rate;low+=alpha*(random()-low);const envelope=Math.min(1,t/attack)*Math.exp(-t/decay)*Math.min(1,(length-t)/.025);add(low*level*envelope,Math.floor(start*rate)+i,pan);}
  };
  const pluck=(hz,start,length,level,pan=0)=>{
    for(const [ratio,gain,tail]of[[1,1,.32],[2.01,.32,.19],[3.98,.11,.11],[7.1,.035,.06]])tone(hz*ratio,start,length,level*gain,tail,pan);
    noise(start,.045,level*.25,2100,.012,pan);
  };
  const metal=(hz,start,length,level,pan=0)=>{for(const [ratio,gain]of[[1,1],[2.76,.32],[5.4,.13],[8.93,.04]])tone(hz*ratio,start,length,level*gain,.11/Math.sqrt(ratio),pan);};
  const air=(hz,start,length,level,pan=0)=>{
    let phase=0;for(let i=0;i<length*rate;i++){const t=i/rate;phase+=2*Math.PI*hz/rate*(1+.002*Math.sin(t*32));const envelope=Math.min(1,t/.075,(length-t)/.25)*Math.exp(-t/.6);add((Math.sin(phase)+.17*Math.sin(phase*2)+random()*.09)*level*envelope,Math.floor(start*rate)+i,pan);}
  };
  if(name==='scrape'){noise(0,.45,.29,440,.27,0,.025);for(let i=0;i<7;i++)noise(.025+i*.039,.085,.045,1400-i*85,.025,i%2?.16:-.16);tone(61,.02,.4,.055,.15,0,43);}
  if(name==='stone'){noise(0,.44,.35,320,.14);tone(76,0,.43,.17,.12,0,40);tone(143,.008,.3,.045,.07);for(const start of[.018,.062,.121])noise(start,.14,.055,1900,.025);}
  if(name==='step'){noise(0,.22,.19,1200,.055,-.12);tone(102,0,.22,.075,.05,0,65);noise(.022,.13,.052,3900,.035,.2);for(const [start,hz,pan]of[[.042,810,.25],[.074,1130,-.15],[.099,620,.1]])tone(hz,start,.19,.013,.035,pan,hz*.55);}
  if(name==='chest'){
    noise(0,.09,.11,2200,.025);metal(520,.008,.48,.036,-.1);
    for(let i=0;i<9;i++){const at=.065+i*.021;tone(175+i*19,at,.16,.015,.035,Math.sin(i)*.18,130+i*13);noise(at,.055,.025,750,.02);}
    for(const [start,hz,pan]of[[.13,1420,-.25],[.19,1860,.2],[.25,1190,-.1]])metal(hz,start,.42,.011,pan);
  }
  if(name==='lever'){for(let i=0;i<8;i++){const at=i*.061;noise(at,.14,.13-i*.01,980,.025,i%2?.2:-.2);metal(320+(i%3)*81,at,.19,.028,i%2?-.2:.2);}tone(79,.018,.75,.063,.24,0,47);noise(.02,.71,.055,240,.3,0,.018);}
  if(name==='rope'){noise(0,.29,.13,2200,.35,-.28,.08);for(let i=0;i<5;i++)noise(.035+i*.037,.07,.028,3100,.022);tone(220,.258,.57,.10,.14,.15,91);noise(.27,.17,.16,760,.045,.15);noise(.36,.24,.025,1450,.08,-.1);}
  if(name==='relic'){metal(440,.008,.7,.026);for(const [i,hz]of[146.83,220,293.66,329.63,440].entries()){pluck(hz,.03+i*.19,1.12,.048,(i-2)*.16);air(hz*2,.1+i*.19,1.05,.012,(2-i)*.1);}tone(73.415,.03,1.65,.023,.55);}
  if(name==='neutral'){tone(77,0,.33,.052,.085,0,60);noise(0,.19,.035,430,.06);}
  if(name==='return'){pluck(196,.008,.62,.052);tone(98,.008,.58,.018,.2);}
  if(name==='win'){for(const [i,hz]of[196,261.63,329.63,392].entries()){pluck(hz,.012+i*.13,1.05,.058,(i-1.5)*.14);air(hz,.06+i*.13,.95,.011);}metal(784,.39,.7,.012,.2);tone(98,.01,1.18,.026,.35);}
  if(name==='big'){for(const [i,hz]of[130.81,196,261.63,329.63,392,523.25].entries()){pluck(hz,.015+i*.16,1.55,.052,(i-2.5)*.13);air(hz,.08+i*.16,1.5,.013,(2.5-i)*.09);}for(const hz of[65.405,130.81,196])tone(hz,.03,2.35,.026,.65);noise(.015,.42,.055,300,.13);metal(1046.5,.81,1.15,.014,.25);}
  if(name==='ambience'){
    let low=0,slow=0;for(let i=0;i<size;i++){const value=random();low+=.07*(value-low);slow+=.004*(value-slow);const t=i/rate,envelope=Math.min(1,t/.12,(duration-t)/.12);add((low*.11+slow*.19)*envelope*(.72+.13*Math.sin(2*Math.PI*t/8)+.12*Math.sin(t*2.7)),i,Math.sin(t*.7)*.3);}
    for(const [i,start]of[.34,1.19,1.52,2.78,3.96,4.23,5.75,6.61,7.1].entries()){const hz=590+(i*157)%590,pan=Math.sin(i*1.7)*.75;tone(hz,start,.39,.008,.065,pan,hz*.58);tone(hz*.51,start+.082,.45,.003,.1,-pan);}
  }
  // Short stereo reflections, bounded and owned by the file rather than a global reverb tail.
  if(name!=='ambience'){const dry=channels.map(c=>c.slice());for(let c=0;c<2;c++)for(const [delay,level]of[[.061,.13],[.113,.075],[.181,.038]])for(let i=Math.floor(rate*delay);i<size;i++)channels[c][i]+=dry[1-c][i-Math.floor(rate*delay)]*level;}
  for(const channel of channels)for(let i=0;i<size;i++)channel[i]*=Math.min(1,i/(rate*.002),(size-1-i)/(rate*.035));
  const target={scrape:.14,stone:.3,step:.14,chest:.24,lever:.22,rope:.2,relic:.26,neutral:.07,return:.14,win:.27,big:.3,ambience:.04}[name];
  const peak=metrics(channels).peak;for(const data of channels)for(let i=0;i<data.length;i++)data[i]*=target/peak;
  return {name,duration,accent,channels};
}
export function wav(channels){
  const samples=channels[0].length,buffer=Buffer.alloc(44+samples*4);buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(2,22);buffer.writeUInt32LE(rate,24);buffer.writeUInt32LE(rate*4,28);buffer.writeUInt16LE(4,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(samples*4,40);
  for(let i=0;i<samples;i++)for(let c=0;c<2;c++)buffer.writeInt16LE(Math.round(Math.max(-1,Math.min(1,channels[c][i]))*32767),44+(i*2+c)*2);return buffer;
}
export function metrics(channels){let peak=0,sum=0;for(const data of channels)for(const value of data){peak=Math.max(peak,Math.abs(value));sum+=value*value;}return {peak,rms:Math.sqrt(sum/(channels[0].length*2))};}
export async function writePack(root=process.cwd()){
  const folder=resolve(root,'public/assets/flooded-temple/audio');await mkdir(folder,{recursive:true});const manifest={sampleRate:rate,format:'stereo PCM16',cues:{}};
  for(const name of Object.keys(specs)){const audio=synthesize(name);await writeFile(resolve(folder,name+'.wav'),wav(audio.channels));manifest.cues[name]={file:name+'.wav',duration:audio.duration,accent:audio.accent,...metrics(audio.channels)};}
  await writeFile(resolve(root,'games/flooded-temple/sounds.json'),JSON.stringify(manifest,null,2)+'\n');
  const demo=[new Float32Array(rate*16),new Float32Array(rate*16)];
  for(const [name,start,level]of[['ambience',0,.8],['stone',.4,.8],['step',1.2,1],['chest',1.9,1],['lever',3,1],['rope',4.2,1],['relic',5.5,1],['neutral',8,1],['return',8.8,1],['win',9.9,1],['big',12,1]]){
    const audio=synthesize(name);for(let c=0;c<2;c++)for(let i=0;i<audio.channels[c].length;i++){const at=Math.floor(start*rate)+i;if(at<demo[c].length)demo[c][at]+=audio.channels[c][i]*level;}
  }
  await writeFile(resolve(root,'docs/assets/flooded-temple/reference-sound-preview.wav'),wav(demo));
  return manifest;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const result=await writePack();console.log(JSON.stringify(result));}
