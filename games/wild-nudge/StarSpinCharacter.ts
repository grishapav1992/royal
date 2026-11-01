import {Rive,RuntimeLoader,Layout,Fit,Alignment} from '@rive-app/webgl2';
import {starCharacter} from '../../src/shared/starSpinCollection';
type Mode='idle'|'spin_wait'|'wild_align'|'bonus_enter'|'bonus_idle'|'round_win'|'select';
const modes:Mode[]=['idle','spin_wait','wild_align','bonus_enter','bonus_idle','round_win','select'];
let runtime:Promise<void>|undefined;
async function binary(url:string,format:string,signal?:AbortSignal){
 const timeout=new AbortController(),abort=()=>timeout.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,10000);
 try{const response=await fetch(url,{credentials:'omit',signal:timeout.signal});if(!response.ok)throw Error('Character asset unavailable');const data=await response.json();
 if(data.format!==format||typeof data.data!=='string'||data.data.length>8_000_000||!Number.isSafeInteger(data.bytes)||!/^[a-f0-9]{64}$/.test(data.sha256))throw Error('Invalid character asset');
 const buffer=Uint8Array.from(atob(data.data),c=>c.charCodeAt(0)).buffer;
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),b=>b.toString(16).padStart(2,'0')).join('');if(buffer.byteLength!==data.bytes||hash!==data.sha256)throw Error('Character checksum mismatch');return{buffer,data};
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
async function engine(){
 if(!runtime)runtime=(async()=>{const {buffer}=await binary('/assets/wild-nudge/characters/rive-runtime.json','royal-rive-wasm-v1');RuntimeLoader.setWasmFallbackUrl(null);RuntimeLoader.setWasmThreadsUrl(null);RuntimeLoader.setReplayWorker(false);RuntimeLoader.setWasmBinary(buffer);await RuntimeLoader.awaitInstance();})().catch(error=>{runtime=undefined;throw error;});return runtime;
}
export class StarSpinCharacter{
 private native?:Rive;private canvas?:HTMLCanvasElement;private target?:HTMLElement;private abort=new AbortController();private epoch=0;private owner='';private id='';private dead=false;private loading=false;private ready=false;private failed=false;private paused=true;private reduced=false;private visible=false;private base:Mode='idle';private mode:Mode='idle';private timer?:ReturnType<typeof setTimeout>;private counts:Partial<Record<Mode,number>>={};
 private resize:ResizeObserver;
 constructor(private root:HTMLElement){this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(root);}
 get state(){return{engine:'Rive',character:this.id,ready:this.ready,bound:!!this.native?.viewModelInstance?.number('mode'),loading:this.loading,fallback:this.failed||!this.ready||this.reduced,playing:this.ready&&!this.paused&&!this.reduced&&this.visible,mode:this.mode,reactions:{...this.counts}};}
 sync(owner:string,id:string,phase:string,bonus:boolean,paused:boolean,reduced:boolean){
  if(this.dead)return;
  if(owner!==this.owner||id!==this.id){this.release();this.owner=owner;this.id=id;this.failed=false;this.counts={};}
  this.paused=paused;this.reduced=reduced;this.base=phase==='request'||phase==='reveal'?'spin_wait':bonus?'bonus_idle':'idle';
  const dialog=this.root.querySelector<HTMLDialogElement>('.ss-dialog'),gallery=dialog?.querySelector<HTMLElement>(`[data-ss-card="${starCharacter(id)?id:'none'}"] .ss-art`),field=this.root.querySelector<HTMLElement>('.ss-companion');
  const next=(dialog?.open?gallery:field)??undefined;if(this.target!==next||this.canvas&&this.canvas.parentElement!==next){this.target?.classList.remove('ss-rive-ready');this.target=next;if(this.canvas){if(next)next.append(this.canvas);else this.canvas.remove();}this.fit();}
  this.visible=!!this.target&&this.target.getBoundingClientRect().width>0&&this.target.getBoundingClientRect().height>0;
  if(starCharacter(id)&&owner&&this.visible&&!reduced&&!this.loading&&!this.ready&&!this.failed)void this.load();
  if(paused||reduced||!this.visible){this.cancelReaction();this.native?.pause('Character');this.native?.stopRendering();this.display(false);}
  else if(this.ready){if(!this.timer)this.setMode(this.base);this.native?.play('Character');this.native?.startRendering();this.display(true);}
 }
 private display(value:boolean){if(this.canvas)this.canvas.hidden=!value;this.target?.classList.toggle('ss-rive-ready',value);if(value)this.fit();}
 private async load(){
  const epoch=this.epoch,id=this.id;this.loading=true;try{const [{buffer,data}]=await Promise.all([binary(`/assets/wild-nudge/characters/${id}-rive.json`,'royal-rive-v1',this.abort.signal),engine()]);if(this.dead||epoch!==this.epoch)return;if(data.character!==id||typeof data.artboard!=='string'||!modes.every((name,i)=>data.modes?.[i]===name))throw Error('Character contract mismatch');
   this.canvas=document.createElement('canvas');this.canvas.className='ss-rive-canvas';this.canvas.setAttribute('aria-hidden','true');this.canvas.hidden=true;this.target?.append(this.canvas);
   this.native=new Rive({buffer,canvas:this.canvas,artboard:data.artboard,stateMachines:'Character',autoBind:true,autoplay:true,shouldDisableRiveListeners:true,shouldDisableGamepad:true,automaticallyHandleEvents:false,layout:new Layout({fit:Fit.Contain,alignment:Alignment.Center}),onLoad:()=>{if(this.dead||epoch!==this.epoch)return;this.ready=true;this.loading=false;this.fit();this.setMode(this.base);if(!this.paused&&!this.reduced&&this.visible){this.native?.play('Character');this.native?.startRendering();this.display(true);}else{this.native?.pause('Character');this.native?.stopRendering();}},onLoadError:()=>{if(epoch===this.epoch)this.fail();}});
  }catch{if(!this.dead&&epoch===this.epoch)this.fail();}finally{if(epoch===this.epoch&&!this.native)this.loading=false;}
 }
 private fail(){this.failed=true;this.ready=false;this.loading=false;this.native?.cleanup();this.native=undefined;this.display(false);}
 private fit(){if(!this.native||!this.canvas||!this.target)return;const rect=this.target.getBoundingClientRect(),visible=rect.width>0&&rect.height>0;if(visible!==this.visible){this.visible=visible;const active=visible&&!this.paused&&!this.reduced&&this.ready;this.canvas.hidden=!active;this.target.classList.toggle('ss-rive-ready',active);if(active){this.native.play('Character');this.native.startRendering();}else{this.cancelReaction();this.native.pause('Character');this.native.stopRendering();}}if(visible&&!this.canvas.hidden)this.native.resizeDrawingSurfaceToCanvas(Math.min(window.devicePixelRatio||1,2));}
 private setMode(mode:Mode){this.mode=mode;const value=this.native?.viewModelInstance?.number('mode');if(value)value.value=modes.indexOf(mode);}
 react(mode:Mode){if(!this.ready||this.dead||this.paused||this.reduced||!this.visible)return;this.cancelReaction();this.counts[mode]=(this.counts[mode]??0)+1;this.setMode(mode);const epoch=this.epoch;this.timer=setTimeout(()=>{this.timer=undefined;if(!this.dead&&epoch===this.epoch)this.setMode(this.base);},1500);}
 cancelReaction(){if(this.timer)clearTimeout(this.timer);this.timer=undefined;this.setMode(this.base);}
 private release(){this.epoch++;this.abort.abort();this.abort=new AbortController();this.cancelReaction();this.native?.cleanup();this.native=undefined;this.canvas?.remove();this.canvas=undefined;this.target?.classList.remove('ss-rive-ready');this.target=undefined;this.loading=false;this.ready=false;this.mode='idle';}
 destroy(){if(this.dead)return;this.dead=true;this.release();this.resize.disconnect();}
}
