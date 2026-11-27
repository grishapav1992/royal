import type {RouletteSound} from './RouletteSound';
import {landingPlan,landingPose,launchPose,normalizeAngle,restingPose,SPIN_TIMING,type LandingPlan,type SpinPose} from './SpinTimeline';
import {WheelRenderer} from './WheelRenderer';

const STEP=360/37;
/** Pocket under the ball in the rotor's own frame. */
export const pocketUnderBall=(pose:SpinPose)=>Math.round(normalizeAngle(pose.ball-pose.wheel)/STEP)%37;

/** Owns every roulette frame and transient effect, including cancelled promises. */
export class RouletteMotion {
  private lifetime=new AbortController();
  private reduced=matchMedia('(prefers-reduced-motion: reduce)');
  private renderer:WheelRenderer;
  private pose=restingPose();
  private base=restingPose();
  private frame=0;
  private frames=0;
  private began=0;
  private landingAt=0;
  private plan?:LandingPlan;
  private request?:{pocket:number;ready:number;resolve:(observed:boolean)=>void};
  private effects=new Set<Animation>();
  private byElement=new Map<Element,Animation>();
  private active=false;
  private paused=false;
  private disposed=false;
  private interrupted=false;
  private pocket?:number;
  private highlight:number|null=null;
  private failures=0;
  constructor(private root:HTMLElement,canvas:HTMLCanvasElement,numbers:readonly number[],color:(n:number)=>string,private sound?:RouletteSound) {
    this.renderer=new WheelRenderer(canvas,numbers,color);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancel();},{signal:this.lifetime.signal});
    this.reduced.addEventListener('change',()=>{if(this.reduced.matches)this.cancel();},{signal:this.lifetime.signal});
    const observer=new ResizeObserver(()=>{
      if(!this.renderer.resize())return;
      const b=this.renderer.bounds(),box=canvas.parentElement;
      box?.style.setProperty('--rr-hub-x',`${b.cx}px`);box?.style.setProperty('--rr-hub-y',`${b.cy}px`);box?.style.setProperty('--rr-hub-rx',`${b.rx}px`);
      if(!this.active)this.paint();
    });
    observer.observe(canvas);this.lifetime.signal.addEventListener('abort',()=>observer.disconnect());
    this.paint();
  }
  private allowed() {return !this.disposed&&!this.paused&&!document.hidden;}
  private moving() {return this.allowed()&&!this.reduced.matches;}
  begin() {
    this.cancel();this.interrupted=!this.allowed();this.frames=0;this.pocket=undefined;this.highlight=null;
    const start=this.allowed()?(this.sound?.begin(this.moving())??performance.now()):performance.now();
    if(!this.moving()){this.paint();return;}
    this.active=true;this.began=start;this.base={...this.pose};this.plan=undefined;
    this.pose=launchPose(this.base,0);this.paint();this.frame=requestAnimationFrame(this.tick);
  }
  land(pocket:number):Promise<boolean> {
    if(!this.active||!this.moving()){
      const observed=this.allowed()&&!this.interrupted;this.snap(pocket);return Promise.resolve(observed);
    }
    return new Promise(resolve=>{this.request={pocket,ready:performance.now(),resolve};});
  }
  private tick=(now:number)=>{
    this.frame=0;
    if(!this.active)return;
    if(!this.moving()){this.cancel();return;}
    if(this.request&&!this.plan){
      const at=Math.max(this.request.ready,this.began+SPIN_TIMING.launch);
      if(now>=at){
        try{
          this.landingAt=at;this.plan=landingPlan(launchPose(this.base,at-this.began),this.request.pocket,(Math.random()*2**32)>>>0);
          this.sound?.plan(this.plan,at);
        }catch{
          // A presentation failure must never block the confirmed receipt.
          this.failures++;const request=this.request;this.request=undefined;this.snap(request.pocket);request.resolve(true);return;
        }
      }
    }
    this.pose=this.plan?landingPose(this.plan,now-this.landingAt):launchPose(this.base,now-this.began);
    this.sound?.frame(this.pose);this.frames++;this.paint(now);
    if(this.plan&&now-this.landingAt>=this.plan.duration){
      const request=this.request;this.active=false;this.request=undefined;this.plan=undefined;
      this.pocket=request?.pocket;this.sound?.finish();this.normalize();request?.resolve(true);return;
    }
    this.frame=requestAnimationFrame(this.tick);
  };
  private normalize(){this.pose={...this.pose,wheel:normalizeAngle(this.pose.wheel),ball:normalizeAngle(this.pose.ball),wheelVelocity:0,ballVelocity:0,ux:0,uy:0,phase:'idle'};this.paint();}
  private paint(now=performance.now()) {
    const p=this.pose;
    this.root.dataset.motionPhase=p.phase;
    this.renderer.render({rotor:p.wheel,ball:{x:p.x,y:p.y,z:p.height,ux:p.ux,uy:p.uy,airborne:p.surface==='air',visible:p.visible},
      highlight:this.highlight,glow:this.highlight===null?0:1,time:now});
  }
  /** Shows a verified result. A ball already resting in that pocket stays where it physically stopped. */
  rest(pocket:number) {
    if(!this.active&&this.pose.visible&&this.pose.phase==='idle'&&pocketUnderBall(this.pose)===pocket){this.stopFrame();this.pocket=pocket;this.normalize();return;}
    this.snap(pocket);
  }
  snap(pocket:number) {
    this.stopFrame();this.sound?.finish();this.pocket=pocket;
    this.pose=restingPose(pocket);this.paint();
  }
  mark(pocket:number|null){this.highlight=pocket;this.paint();}
  private stopFrame() {
    cancelAnimationFrame(this.frame);this.frame=0;this.active=false;this.plan=undefined;
    const request=this.request;this.request=undefined;request?.resolve(false);
  }
  cancel() {
    this.interrupted=true;this.stopFrame();this.sound?.cancel();
    for(const effect of this.effects)effect.cancel();this.effects.clear();this.byElement.clear();
    this.pose={...this.pose,wheelVelocity:0,ballVelocity:0,ux:0,uy:0,hop:0,height:0,phase:'quiet'};this.paint();
  }
  reset(){this.cancel();this.pose=restingPose();this.pocket=undefined;this.highlight=null;this.frames=0;this.paint();}
  pause(){this.paused=true;this.cancel();}
  resume(){this.paused=false;}
  private effect(el:Element|null,frames:Keyframe[],duration:number,delay=0,clock=performance.now(),easing='cubic-bezier(.2,.75,.25,1)') {
    if(!el||!this.moving())return;
    this.byElement.get(el)?.cancel();
    // Segment easing preserves the explicit accent offsets on the shared clock.
    const a=el.animate(frames.map(frame=>({...frame,easing})),{duration,delay,easing:'linear',fill:'backwards'});a.startTime=clock;this.effects.add(a);this.byElement.set(el,a);
    void a.finished.catch(()=>{}).finally(()=>{this.effects.delete(a);if(this.byElement.get(el)===a)this.byElement.delete(el);});
  }
  select(button:HTMLElement) {
    const now=performance.now(),peak=this.sound?.select(button.hasAttribute('data-rr-amount')?'chip':'bet',now+137.5)??now+137.5,delay=Math.max(0,peak-now-137.5);
    this.effect(button,[{scale:'.94'},{scale:'1.065',offset:.55},{scale:'1'}],250,delay,now);
    this.effect(this.root.querySelector('.rr-selection'),[{opacity:.55,translate:'0 3px'},{opacity:1,translate:'0 0'}],220,delay,now);
  }
  /** A chip travels from the rack to the chosen field of the felt. */
  place(chip:HTMLElement|null,from:Element|null) {
    if(!chip||!from||!this.moving())return;
    const a=from.getBoundingClientRect(),b=chip.getBoundingClientRect();
    if(!a.width||!b.width)return;
    const dx=a.left+a.width/2-(b.left+b.width/2),dy=a.top+a.height/2-(b.top+b.height/2);
    this.effect(chip,[{translate:`${dx}px ${dy}px`,scale:'1.25',opacity:.4},{translate:`${dx*.35}px ${dy*.35-18}px`,scale:'1.18',opacity:1,offset:.55},{translate:'0 0',scale:'1',opacity:1}],380,0,performance.now(),'cubic-bezier(.3,.6,.35,1)');
  }
  reveal(multiplier=0) {
    const now=performance.now(),target=now+(this.moving()?252:30),peak=this.sound?.result(multiplier,target)??target,delay=Math.max(0,peak-now-252);
    this.effect(this.root.querySelector('.rr-result-orb'),[{opacity:0,scale:'.7',rotate:'-12deg'},{opacity:1,scale:'1.08',rotate:'2deg',offset:.7},{opacity:1,scale:'1',rotate:'0deg'}],360,delay,now);
    this.effect(this.root.querySelector('.rr-marquee'),[{opacity:0,scale:'.55'},{opacity:1,scale:'1.07',offset:.14},{opacity:1,scale:'1',offset:.22},{opacity:1,scale:'1',offset:.82},{opacity:0,scale:'.96'}],2300,delay,now);
    this.effect(this.root.querySelector('.rr-landed>span'),[{scale:'.85'},{scale:'1.13',offset:.55},{scale:'1'}],330,delay,now);
    this.effect(this.root.querySelector('.rr-return'),[{opacity:.35,translate:'0 4px'},{opacity:1,translate:'0 0'}],300,delay,now);
    const chip=this.root.querySelector('.rr-table-area .rr-bet-chip');
    if(multiplier>0)this.effect(chip,[{scale:'1',filter:'brightness(1)'},{scale:'1.32',filter:'brightness(1.6)',offset:.4},{scale:'1',filter:'brightness(1)'}],620,delay,now);
    else this.effect(chip,[{translate:'0 0',opacity:1},{translate:'0 -26px',opacity:0,scale:'.7',offset:.45},{translate:'0 0',opacity:0,scale:'.7',offset:.7},{translate:'0 0',opacity:1,scale:'1'}],900,delay+150,now);
  }
  history(value:number,color:string,animate:boolean) {
    const history=this.root.querySelector<HTMLElement>('.rr-history')!;
    const old=Array.from(history.children).map(node=>({node,box:node.getBoundingClientRect()}));
    const chip=document.createElement('span');chip.className=`rr-${color}`;chip.textContent=String(value);history.prepend(chip);
    while(history.children.length>10)history.lastElementChild!.remove();
    if(!animate)return;
    old.forEach(({node,box})=>{
      if(!node.isConnected)return;const next=node.getBoundingClientRect();
      this.effect(node,[{translate:`${box.x-next.x}px ${box.y-next.y}px`},{translate:'0 0'}],280);
    });
    this.effect(chip,[{opacity:0,scale:'.5'},{opacity:1,scale:'1'}],300);
  }
  state(){return {phase:this.pose.phase,pose:{...this.pose},active:this.active,scheduledFrames:this.frame?1:0,frames:this.frames,effects:this.effects.size,pocket:this.pocket??null,interrupted:this.interrupted,highlight:this.highlight,failures:this.failures};}
  destroy(){if(this.disposed)return;this.cancel();this.disposed=true;this.lifetime.abort();this.renderer.destroy();}
}
