/** The game's own recordings. Silent until the viewer asks for sound. */
const CUES:Record<string,[string,number,number?][]>={lever:[['lever',.6]],sink:[['splash',.5,.75]],land:[['land0',.6],['land1',.6],['land2',.6]],splash:[['splash',.35,1.25]],crack:[['break0',.6],['break1',.6]],ebb:[['scrape',.4,.8]],hook:[['rope',.5]],step:[['step',.6]],coin:[['win',.35,1.15]],win:[['win',.7]],big:[['big',.8]],chest:[['chest',.8]],bonus:[['bonus',.8]],gate:[['scrape',.7,.6]],neutral:[['neutral',.4]],relic:[['relic',.6]]};
export class Sound{
  on=false;private ctx?:AudioContext;private bufs=new Map<string,Promise<AudioBuffer>>();private n=0;private amb?:AudioBufferSourceNode;private out?:GainNode;
  private buf(f:string){let p=this.bufs.get(f);if(!p){p=fetch('assets/audio/'+f+'.mp4').then(r=>r.arrayBuffer()).then(b=>this.ctx!.decodeAudioData(b));this.bufs.set(f,p);}return p;}
  toggle(){
    this.on=!this.on;this.ctx??=new AudioContext();void this.ctx.resume();
    if(!this.out){this.out=this.ctx.createGain();this.out.connect(this.ctx.destination);}this.out.gain.value=this.on?1:0;
    if(this.on&&!this.amb){for(const l of Object.values(CUES))for(const [f] of l)void this.buf(f).catch(()=>{});void this.buf('ambience').then(b=>{const s=this.ctx!.createBufferSource(),g=this.ctx!.createGain();s.buffer=b;s.loop=true;g.gain.value=.22;s.connect(g).connect(this.out!);s.start();this.amb=s;}).catch(()=>{});}
    return this.on;
  }
  play(cue:string,gain=1){const l=CUES[cue];if(!this.on||!l)return;const [f,v,r]=l[this.n++%l.length];void this.buf(f).then(b=>{const s=this.ctx!.createBufferSource(),g=this.ctx!.createGain();s.buffer=b;s.playbackRate.value=r??1;g.gain.value=v*gain;s.connect(g).connect(this.out!);s.start();}).catch(()=>{});}
}
