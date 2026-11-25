/** The existing recorded effects and music. Off until the viewer asks for them. */
const FILES:{[cue:string]:[string,number,number?][]}={
  stop:[['stop-a',.55],['stop-b',.55],['stop-c',.55]],giant:[['creak',.7]],thud:[['thud',.8]],cannon:[['cannon',.9]],'cannon-far':[['cannon',.4,1.15]],blast:[['cannon',.8,.8],['thud',.8]],slash:[['metal',.45,1.3]],line:[['coins-small',.6]],win:[['coins-small',.8]],chest:[['creak',.8]],open:[['latch',.9]],bigwin:[['coins',1]],hook:[['metal',.6,.8]],roll:[['creak',.25,1.2]],thunder:[['cannon',.22,.4]],click:[['click',.5]],loss:[['thud',.3]],choose:[['latch',.8]],reveal:[['coins',.8]],
};
export class Sound{
  on=false;private music=false;private ctx?:AudioContext;private bufs=new Map<string,Promise<AudioBuffer>>();private gain?:GainNode;private src?:AudioBufferSourceNode;private n=0;
  private audio(){this.ctx??=new AudioContext();void this.ctx.resume();return this.ctx;}
  private buf(f:string){let p=this.bufs.get(f);if(!p){p=fetch('assets/audio/'+f+'.mp4').then(r=>r.arrayBuffer()).then(b=>this.audio().decodeAudioData(b));this.bufs.set(f,p);}return p;}
  toggle(){this.on=!this.on;if(this.on){this.audio();for(const l of Object.values(FILES))for(const [f] of l)void this.buf(f);}return this.on;}
  async toggleMusic(){this.music=!this.music;if(!this.music){this.src?.stop();this.src=undefined;return false;}
    const c=this.audio(),b=await this.buf('music');if(!this.music)return false;this.gain??=(()=>{const g=c.createGain();g.gain.value=.32;g.connect(c.destination);return g;})();this.src=c.createBufferSource();this.src.buffer=b;this.src.loop=true;this.src.connect(this.gain);this.src.start();return true;}
  play(cue:string){if(!this.on||!FILES[cue])return;const l=cue==='stop'?[FILES.stop[this.n++%3]]:FILES[cue];for(const [f,v,r] of l)void this.buf(f).then(b=>{const c=this.ctx!,s=c.createBufferSource(),g=c.createGain();s.buffer=b;s.playbackRate.value=r??1;g.gain.value=v;s.connect(g).connect(c.destination);s.start();}).catch(()=>{});}
}
