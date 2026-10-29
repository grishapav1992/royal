import type {JackieLocation} from '../../src/shared/jackieChan';
import tracks from './music-sources.json';

type Voice={audio:HTMLAudioElement;source:MediaElementAudioSourceNode;gain:GainNode;timer?:ReturnType<typeof setTimeout>};
const preference='royal-kungfu-music';

/** Full licensed recordings, streamed through the shared Royal audio output. */
export class JackieMusic {
  enabled=true;
  private location?:JackieLocation;
  private context?:AudioContext;
  private output?:AudioNode;
  private current?:Voice;
  private previous?:Voice;
  private unlocked=false;
  private pending=false;
  private epoch=0;
  private dead=false;
  private ducked=false;
  private error='';
  private visibility=()=>{if(this.doc.hidden)this.pause();else this.sync();};
  private contextState=()=>{if(this.context?.state==='running')this.sync();else this.pause();};
  constructor(private doc:Document,private allowed:()=>boolean){
    try{this.enabled=localStorage.getItem(preference)!=='0';}catch{}
    this.doc.addEventListener('visibilitychange',this.visibility);
  }
  attach(context:AudioContext,output:AudioNode){
    if(this.dead||this.context===context)return;
    this.detach();this.context=context;this.output=output;
    context.addEventListener('statechange',this.contextState);
  }
  select(location:JackieLocation){
    if(this.dead||this.location===location)return;
    this.location=location;this.epoch++;this.pending=false;this.error='';
    if(this.current){
      if(!this.current.audio.paused){this.dispose(this.previous);this.previous=this.current;}
      else this.dispose(this.current);
      this.current=undefined;
    }
    this.sync();
  }
  gesture(){
    if(this.dead)return;this.unlocked=true;
    if(this.current&&(this.current.audio.error||this.error)){this.pause();this.error='';this.current.audio.load();}
    this.sync();
  }
  private available(){return !this.dead&&this.enabled&&this.unlocked&&!!this.location&&this.allowed()&&!this.doc.hidden&&this.context?.state==='running';}
  private volume(voice:Voice,level:number){
    const now=this.context!.currentTime;voice.gain.gain.cancelScheduledValues(now);voice.gain.gain.setTargetAtTime(level,now,.12);
  }
  private create():Voice{
    const audio=this.doc.createElement('audio');audio.preload='none';audio.loop=true;
    audio.src='/assets/jackie-chan/audio/'+this.location+'.mp3';
    const source=this.context!.createMediaElementSource(audio),gain=this.context!.createGain();
    gain.gain.value=0;source.connect(gain);gain.connect(this.output!);
    return {audio,source,gain};
  }
  sync(){
    if(!this.available()){this.pause();return;}
    const voice=this.current??=this.create();
    if(!voice.audio.paused){this.volume(voice,this.ducked?.11:.26);return;}
    if(this.pending||this.error)return;
    const epoch=this.epoch;this.pending=true;
    void voice.audio.play().then(()=>{
      if(this.dead||this.current!==voice){this.dispose(voice);return;}
      if(!this.available()){voice.audio.pause();return;}
      if(epoch!==this.epoch)return;
      this.error='';this.volume(voice,this.ducked?.11:.26);
      const previous=this.previous;
      if(previous){
        this.volume(previous,0);
        previous.timer=setTimeout(()=>{this.dispose(previous);if(this.previous===previous)this.previous=undefined;},400);
      }
    }).catch(error=>{
      if(epoch!==this.epoch||this.current!==voice)return;
      this.error=error instanceof Error?error.name:'Playback unavailable';this.dispose(this.previous);this.previous=undefined;
    }).finally(()=>{if(epoch===this.epoch&&this.current===voice)this.pending=false;});
  }
  pause(){
    this.epoch++;this.pending=false;this.dispose(this.previous);this.previous=undefined;
    if(this.current){this.current.gain.gain.cancelScheduledValues(this.context!.currentTime);this.current.gain.gain.setValueAtTime(0,this.context!.currentTime);this.current.audio.pause();}
  }
  duck(active:boolean){if(active===this.ducked)return;this.ducked=active;this.sync();}
  toggle(){
    this.enabled=!this.enabled;try{localStorage.setItem(preference,this.enabled?'1':'0');}catch{}
    if(this.enabled)this.gesture();else this.pause();
  }
  reset(){this.pause();this.dispose(this.current);this.current=undefined;this.location=undefined;this.unlocked=false;this.error='';}
  private dispose(voice?:Voice){
    if(!voice)return;clearTimeout(voice.timer);voice.audio.pause();voice.source.disconnect();voice.gain.disconnect();voice.audio.removeAttribute('src');voice.audio.load();
  }
  private detach(){this.pause();this.dispose(this.current);this.current=undefined;this.context?.removeEventListener('statechange',this.contextState);this.context=undefined;this.output=undefined;}
  getState(){
    const audio=this.current?.audio,track=tracks.find(track=>track.location===this.location);
    return {enabled:this.enabled,location:this.location??null,title:track?.title??'',playing:!!audio&&!audio.paused&&!audio.ended&&!audio.error&&audio.readyState>=2,
      pending:this.pending,positionSeconds:audio?.currentTime??0,readyState:audio?.readyState??0,error:this.error,ducked:this.ducked,
      active:(this.current&&!this.current.audio.paused?1:0)+(this.previous&&!this.previous.audio.paused?1:0),disposed:this.dead};
  }
  destroy(){if(this.dead)return;this.dead=true;this.detach();this.doc.removeEventListener('visibilitychange',this.visibility);}
}
