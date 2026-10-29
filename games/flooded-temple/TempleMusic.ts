import {templeMusic} from './audioCredits';
/** Stream the composer's full master through Royal's existing audio output. */
export class TempleMusic{
  private audio?:HTMLAudioElement;
  private source?:MediaElementAudioSourceNode;
  private gain?:GainNode;
  private context?:AudioContext;
  private unlocked=false;
  private pending=false;
  private epoch=0;
  private dead=false;
  private ducked=false;
  private error='';
  constructor(private doc:Document,private enabled:()=>boolean){}
  attach(context:AudioContext,output:AudioNode){
    if(this.dead||this.context===context)return;this.detach();this.context=context;
    const audio=this.doc.createElement('audio');audio.preload='none';audio.loop=true;audio.src='/assets/flooded-temple/audio/'+templeMusic.file;
    this.audio=audio;this.source=context.createMediaElementSource(audio);this.gain=context.createGain();this.gain.gain.value=0;this.source.connect(this.gain);this.gain.connect(output);
  }
  gesture(){this.unlocked=true;if(this.audio&&(this.audio.error||this.error)){this.pause();this.error='';this.audio.load();}this.sync();}
  sync(){
    const audio=this.audio,context=this.context,gain=this.gain;if(!audio||!context||!gain||this.dead)return;
    if(!this.unlocked||!this.enabled()){this.pause();return;}
    gain.gain.setTargetAtTime(this.ducked?.065:.17,context.currentTime,.3);
    if(!audio.paused||this.pending)return;
    const epoch=++this.epoch;this.pending=true;
    void audio.play().then(()=>{if(this.dead||!this.enabled())audio.pause();else if(epoch===this.epoch)this.error='';}).catch(error=>{if(epoch===this.epoch)this.error=error instanceof Error?error.name:'Playback unavailable';}).finally(()=>{if(epoch===this.epoch)this.pending=false;});
  }
  pause(){this.epoch++;this.pending=false;if(this.context&&this.gain){this.gain.gain.cancelScheduledValues(this.context.currentTime);this.gain.gain.setValueAtTime(0,this.context.currentTime);}this.audio?.pause();}
  duck(active:boolean){this.ducked=active;this.sync();}
  private detach(){this.pause();this.source?.disconnect();this.gain?.disconnect();if(this.audio){this.audio.removeAttribute('src');this.audio.load();}this.audio=undefined;this.source=undefined;this.gain=undefined;this.context=undefined;}
  get playing(){return !!this.audio&&!this.audio.paused&&!this.audio.ended&&!this.audio.error&&this.audio.readyState>=2;}
  get reserved(){return !this.dead&&(this.pending||!!this.audio&&!this.audio.paused&&!this.audio.ended&&!this.audio.error);}
  getState(){return {title:templeMusic.title,playing:this.playing,pending:this.pending,positionSeconds:this.audio?.currentTime??0,readyState:this.audio?.readyState??0,error:this.error,disposed:this.dead};}
  destroy(){if(this.dead)return;this.dead=true;this.detach();}
}
