import { gameAudio } from './GameAudio';

let lastPurr = -Infinity;
let purrSource: AudioBufferSourceNode | undefined;
let purrGeneration = 0;
export function stopCatPurr() {
  purrGeneration++;
  try { purrSource?.stop(); } catch { /* A completed sound needs no further work. */ }
  purrSource=undefined;
}
/** A quiet synthesized purr until a recording of her own voice is available. */
export async function catPurr(duration = 2.4) {
  if (performance.now()-lastPurr < 3500 || document.hidden) return;
  const preferences = gameAudio.getPreferences();
  if (preferences.muted || !preferences.volume) return;
  lastPurr = performance.now();
  const generation=++purrGeneration;
  await gameAudio.unlock();
  const c = gameAudio.context, output = gameAudio.output;
  if (!c || !output || c.state !== 'running' || document.hidden || generation!==purrGeneration) return;
  const buffer = c.createBuffer(1,Math.floor(c.sampleRate*duration),c.sampleRate);
  const samples = buffer.getChannelData(0);
  let noise = 0;
  for (let i=0; i<samples.length; i++) {
    const t=i/c.sampleRate, envelope=Math.min(1,t/.15,(duration-t)/.3);
    noise=.97*noise+.03*(Math.random()*2-1);
    const pulse=.45+.55*Math.pow(Math.sin(Math.PI*26*t),2);
    const breath=.7+.3*Math.sin(Math.PI*2*1.1*t);
    samples[i]=envelope*breath*(Math.sin(Math.PI*2*52*t)*.018+noise*pulse*.16);
  }
  const source = c.createBufferSource(), filter=c.createBiquadFilter();
  source.buffer=buffer;filter.type='lowpass';filter.frequency.value=230;
  source.connect(filter);filter.connect(output);
  purrSource=source;
  source.onended=()=>{if(purrSource===source)purrSource=undefined;source.disconnect();filter.disconnect();};source.start();
}
