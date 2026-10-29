import type {CaribbeanCue} from './CaribbeanAudio';
import {CAPTAIN_POSES,DEFAULT_CAPTAIN,crewMember,crewPortrait,type CaptainPose,type CrewId} from './CaribbeanCrew';
export {CAPTAIN_POSES,type CaptainPose} from './CaribbeanCrew';
type Beat={pose:CaptainPose;ms:number};
const phrases:Partial<Record<CaribbeanCue,[string,string]>>={giant:['Вот это размер!','That is a mighty symbol!'],cannon:['Залп!','Cannon fire!'],bonus:['Выбираем курс.','Choose our course.'],loss:['Раунд завершён.','Round complete.'],partial:['Вернулась часть ставки.','Part of the cost returned.'],return:['Стоимость вернулась.','The cost returned.'],win:['Раунд с плюсом!','A positive round!'],bigwin:['Крупная добыча!','A grand haul!']};
/** Owns character poses, one sequence timer and gesture animations for desktop and mobile. */
export class CaribbeanCaptain{
 private active=false;private reduced=false;private english=false;private dead=false;private busy=false;
 private timer?:ReturnType<typeof setTimeout>;private holding=false;private sequence:Beat[]=[];private idleStep=0;private variation=0;
 private pose:CaptainPose='idle';private reaction='idle';private slot=0;private animations=new Set<Animation>();
 private loaded=new Set<CaptainPose>();private preloads:HTMLImageElement[]=[];private seen=new Set<string>();
 private character:CrewId=DEFAULT_CAPTAIN;private selection=0;private loading=false;
 private history:{cue:string;pose:CaptainPose;variant:number;key:string;wallTimeMs:number}[]=[];
 private mounts:HTMLElement[];private caption:HTMLElement;
 constructor(private root:HTMLElement){
  this.mounts=Array.from(root.querySelectorAll<HTMLElement>('.ct-portrait-gesture'));this.caption=root.querySelector('.ct-captain-caption')!;
  void this.select(DEFAULT_CAPTAIN);
 }
 async select(id:string,confirm?:()=>Promise<boolean>):Promise<boolean>{
  if(this.dead||!crewMember(id))return false;
  const ticket=++this.selection;
  if(!confirm&&id===this.character&&this.loaded.size===8){this.loading=false;return true;}
  this.loading=true;
  const poses=Object.keys(CAPTAIN_POSES) as CaptainPose[];
  const images=poses.map(pose=>{const image=new Image();image.decoding='async';image.src=crewPortrait(id as CrewId,pose);return image;});
  try{await Promise.all(images.map(image=>image.decode()));}catch{if(ticket===this.selection)this.loading=false;return false;}
  if(this.dead||ticket!==this.selection)return false;
  if(confirm){
   try{if(!await confirm()){if(ticket===this.selection)this.loading=false;return false;}}
   catch(error){if(ticket===this.selection)this.loading=false;throw error;}
   if(this.dead||ticket!==this.selection)return false;
  }
  this.reset(true);this.character=id as CrewId;this.preloads=images;this.loaded=new Set(poses);this.loading=false;
  this.root.dataset.ctCaptain=this.character;
  for(const mount of this.mounts){
   mount.dataset.pose='';
   mount.querySelectorAll<HTMLImageElement>('.ct-portrait-layer').forEach(image=>{image.src=crewPortrait(this.character);});
  }
  this.show('idle');this.scheduleIdle();return true;
 }
 cancelSelection(){this.selection++;this.loading=false;}
 context(visible:boolean,reduced:boolean,english:boolean){
  if(this.dead)return;const changed=this.active!==visible||this.reduced!==reduced;this.english=english;this.active=visible;this.reduced=reduced;
  this.root.dataset.ctCaptainActive=String(visible&&!reduced);
  this.root.dataset.ctCaptainMotion=reduced?'reduced':'full';
  if(!visible){this.clearTimer();this.clearMotion();this.holding=false;this.sequence=[];this.busy=false;this.reaction='idle';this.show('idle');this.say('');return;}
  if(changed&&reduced){this.clearMotion();if(!this.holding)this.clearTimer();}
  if(this.reaction!=='idle'&&this.reaction!=='focus')this.say(this.reaction as CaribbeanCue);
  this.scheduleIdle();
 }
 private say(cue:CaribbeanCue|''){
  this.caption.textContent=cue&&phrases[cue]?phrases[cue]![this.english?1:0]:'';this.caption.hidden=!this.caption.textContent;
 }
 private show(pose:CaptainPose){
  const next=this.loaded.has(pose)?pose:'idle';if(next===this.pose&&this.mounts.every(m=>m.dataset.pose===next))return;
  const previous=this.pose;this.pose=next;this.slot=1-this.slot;
  for(const mount of this.mounts){
   const images=mount.querySelectorAll<HTMLImageElement>('.ct-portrait-layer');
   images[this.slot].src=crewPortrait(this.character,next);
   images.forEach((image,index)=>image.classList.toggle('ct-current',index===this.slot));
   mount.dataset.pose=next;mount.classList.toggle('ct-blinking',previous==='blink'||next==='blink');
  }
  this.root.dataset.ctCaptainPose=next;
 }
 private gesture(kind:string,variant:number){
  this.clearMotion();if(!this.active||this.reduced)return;
  const side=[-1,1,-.45][variant%3];
  const frames:Keyframe[]=kind==='cannon'?[{transform:'none'},{transform:'translate(5px, 2px) rotate(1deg)',offset:.2},{transform:'translate(-1px, 0) rotate(-.2deg)',offset:.65},{transform:'none'}]
   :kind==='bigwin'?[{transform:'none'},{transform:'translateY(-7px) rotate(-.7deg)',offset:.35},{transform:'translateY(-2px) rotate(.3deg)',offset:.7},{transform:'none'}]
   :kind==='win'||kind==='bonus'?[{transform:'none'},{transform:`translateY(-4px) rotate(${side*.55}deg)`,offset:.45},{transform:'none'}]
   :kind==='loss'||kind==='partial'?[{transform:'none'},{transform:'translateY(2px) rotate(-.4deg)',offset:.5},{transform:'none'}]
   :[{transform:'none'},{transform:`translateY(1.4px) rotate(${side*.25}deg)`,offset:.4},{transform:'none'}];
  for(const mount of this.mounts){const animation=mount.animate(frames,{duration:kind==='stop'?260:kind==='cannon'?520:900,easing:'cubic-bezier(.2,.7,.25,1)'});this.animations.add(animation);void animation.finished.catch(()=>{}).finally(()=>this.animations.delete(animation));}
 }
 begin(){
  if(this.dead)return;if(this.loading)this.cancelSelection();this.clearTimer();this.clearMotion();this.sequence=[];this.holding=false;this.busy=true;this.reaction='focus';this.show('focus');this.say('');
 }
 finish(){this.busy=false;if(!this.holding){this.reaction='idle';this.show('idle');this.say('');this.scheduleIdle();}}
 react(cue:CaribbeanCue,key:string,variant=0){
  if(!this.active||this.dead||this.seen.has(key))return;
  this.seen.add(key);if(this.seen.size>200)this.seen.delete(this.seen.values().next().value!);
  this.clearTimer();this.sequence=[];this.holding=false;this.reaction=cue;
  const take=cue==='stop'?variant:this.variation++%3;
  const pose:CaptainPose=cue==='cannon'?'surprise':cue==='bonus'?'bonus':cue==='loss'||cue==='partial'?'soft':cue==='win'?'win':cue==='bigwin'?'laugh':cue==='return'?'idle':'focus';
  this.show(pose);this.say(cue);this.gesture(cue,take);
  this.history.push({cue,pose:this.pose,variant:take,key,wallTimeMs:Date.now()});if(this.history.length>200)this.history.shift();
  if(['stop','giant','line','click'].includes(cue))return;
  this.holding=true;
  this.sequence=cue==='bigwin'&&!this.reduced?[{pose:'laugh',ms:1300},{pose:'win',ms:650}]:[{pose,ms:cue==='win'?1500:cue==='bonus'?1300:cue==='cannon'?800:1100}];
  this.nextBeat();
 }
 private nextBeat(){
  if(this.dead||!this.active)return;
  const beat=this.sequence.shift();
  if(!beat){this.holding=false;if(!this.busy)this.finish();return;}
  this.show(beat.pose);this.timer=setTimeout(()=>{this.timer=undefined;this.nextBeat();},beat.ms);
 }
 private scheduleIdle(){
  if(this.dead||!this.active||this.reduced||this.busy||this.holding||this.timer||this.loaded.size!==8)return;
  this.timer=setTimeout(()=>{
   this.timer=undefined;if(!this.active||this.reduced||this.dead)return;
   const glance=this.idleStep++%3===2;this.show(glance?'focus':'blink');this.reaction=glance?'glance':'blink';
   this.timer=setTimeout(()=>{this.timer=undefined;this.reaction='idle';this.show('idle');this.scheduleIdle();},glance?1400:125);
  },5200+(this.idleStep%3)*650);
 }
 private clearTimer(){clearTimeout(this.timer);this.timer=undefined;}
 private clearMotion(){for(const animation of this.animations)animation.cancel();this.animations.clear();}
 reset(clearHistory=false){this.clearTimer();this.clearMotion();this.holding=false;this.sequence=[];this.busy=false;this.reaction='idle';this.show('idle');this.say('');if(clearHistory){this.history=[];this.seen.clear();this.variation=0;this.idleStep=0;}}
 state(){return{character:this.character,loading:this.loading,pose:this.pose,reaction:this.reaction,ready:this.loaded.size===8,loadedPoses:this.loaded.size,active:this.active,timers:this.timer?1:0,animations:[...this.animations].filter(a=>a.playState==='running'||a.pending).length,busy:this.busy,history:[...this.history]};}
 destroy(){this.dead=true;this.selection++;this.loading=false;this.active=false;this.reset(true);this.root.dataset.ctCaptainActive='false';this.preloads=[];}
}
