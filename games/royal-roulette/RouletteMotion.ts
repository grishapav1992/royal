import type {RouletteSound} from './RouletteSound';
import {landingPlan,landingPose,launchPose,normalizeAngle,SPIN_TIMING,type LandingPlan,type SpinPose} from './SpinTimeline';

const resting=():SpinPose=>({wheel:0,wheelVelocity:0,ball:0,ballVelocity:0,radius:148,hop:0,phase:'idle'});
/** Owns every roulette frame and transient effect, including cancelled promises. */
export class RouletteMotion {
  private lifetime=new AbortController();
  private reduced=matchMedia('(prefers-reduced-motion: reduce)');
  private rotor:SVGElement;
  private spindle:SVGElement;
  private orbit:SVGElement;
  private carrier:SVGElement;
  private ball:SVGElement;
  private shadow:SVGElement;
  private trails:SVGCircleElement[];
  private pose=resting();
  private base=resting();
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
  constructor(private root:HTMLElement,private sound?:RouletteSound) {
    const el=<T extends SVGElement>(q:string)=>root.querySelector<T>(q)!;
    this.rotor=el('.rr-rotor');this.spindle=el('.rr-spindle');this.orbit=el('.rr-ball-orbit');this.carrier=el('.rr-ball-carrier');
    this.ball=el('.rr-ball');this.shadow=el('.rr-ball-shadow');this.trails=Array.from(root.querySelectorAll<SVGCircleElement>('.rr-ball-trails circle'));
    document.addEventListener('visibilitychange',()=>{if(document.hidden)this.cancel();},{signal:this.lifetime.signal});
    this.reduced.addEventListener('change',()=>{if(this.reduced.matches)this.cancel();},{signal:this.lifetime.signal});
    this.paint();
  }
  private allowed() {return !this.disposed&&!this.paused&&!document.hidden;}
  private moving() {return this.allowed()&&!this.reduced.matches;}
  begin() {
    this.cancel();this.interrupted=!this.allowed();this.frames=0;this.pocket=undefined;
    const start=this.allowed()?(this.sound?.begin(this.moving())??performance.now()):performance.now();
    if(!this.moving())return;
    this.active=true;this.began=start;this.base={...this.pose};this.plan=undefined;
    this.pose.phase='launch';this.paint();this.frame=requestAnimationFrame(this.tick);
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
      if(now>=at){this.landingAt=at;this.plan=landingPlan(launchPose(this.base,at-this.began),this.request.pocket);this.sound?.plan(this.plan,at);}
    }
    this.pose=this.plan?landingPose(this.plan,now-this.landingAt):launchPose(this.base,now-this.began);
    this.sound?.frame(this.pose);this.frames++;this.paint();
    if(this.plan&&now-this.landingAt>=SPIN_TIMING.landing){
      const request=this.request;this.active=false;this.request=undefined;this.plan=undefined;
      this.pocket=request?.pocket;this.sound?.finish();this.normalize();request?.resolve(true);return;
    }
    this.frame=requestAnimationFrame(this.tick);
  };
  private normalize(){this.pose.wheel=normalizeAngle(this.pose.wheel);this.pose.ball=normalizeAngle(this.pose.ball);this.paint();}
  private paint() {
    const p=this.pose;
    this.root.dataset.motionPhase=p.phase;
    this.rotor.style.transform=`rotate(${p.wheel}deg)`;
    this.spindle.style.transform=`rotate(${p.wheel}deg)`;
    this.orbit.style.transform=`rotate(${p.ball}deg)`;
    this.carrier.style.transform=`translateY(${148-p.radius}px)`;
    this.ball.style.transform=`translateY(${-3.2*p.hop}px) scale(${1+.06*p.hop})`;
    this.shadow.style.opacity=String(.46-.23*p.hop);
    this.shadow.style.transform=`translateY(${1.8*p.hop}px) scale(${1+.28*p.hop})`;
    const strength=this.active&&p.phase!=='pocket'?Math.min(1,Math.abs(p.ballVelocity)/1000):0;
    this.trails.forEach((circle,i)=>{
      const angle=(p.ball+(p.ballVelocity<0?1:-1)*(5+i*6)*strength)*Math.PI/180;
      circle.setAttribute('cx',String(200+Math.sin(angle)*p.radius));circle.setAttribute('cy',String(200-Math.cos(angle)*p.radius));
      circle.style.opacity=String(strength*.24/(i+1));
    });
  }
  snap(pocket:number) {
    this.stopFrame();this.sound?.finish();this.pocket=pocket;
    this.pose={...resting(),wheel:normalizeAngle(-pocket*360/37)};this.paint();
  }
  private stopFrame() {
    cancelAnimationFrame(this.frame);this.frame=0;this.active=false;this.plan=undefined;
    const request=this.request;this.request=undefined;request?.resolve(false);
  }
  cancel() {
    this.interrupted=true;this.stopFrame();this.sound?.cancel();
    for(const effect of this.effects)effect.cancel();this.effects.clear();this.byElement.clear();
    this.pose={...this.pose,wheelVelocity:0,ballVelocity:0,hop:0,phase:'quiet'};this.paint();
  }
  reset(){this.cancel();this.pose=resting();this.pocket=undefined;this.frames=0;this.paint();}
  pause(){this.paused=true;this.cancel();}
  resume(){this.paused=false;}
  private effect(el:Element|null,frames:Keyframe[],duration:number,delay=0,clock=performance.now()) {
    if(!el||!this.moving())return;
    this.byElement.get(el)?.cancel();
    // Segment easing preserves the explicit accent offsets on the shared clock.
    const a=el.animate(frames.map(frame=>({...frame,easing:'cubic-bezier(.2,.75,.25,1)'})),{duration,delay,easing:'linear'});a.startTime=clock;this.effects.add(a);this.byElement.set(el,a);
    void a.finished.catch(()=>{}).finally(()=>{this.effects.delete(a);if(this.byElement.get(el)===a)this.byElement.delete(el);});
  }
  select(button:HTMLElement) {
    const now=performance.now(),peak=this.sound?.select(button.hasAttribute('data-rr-amount')?'chip':'bet',now+137.5)??now+137.5,delay=Math.max(0,peak-now-137.5);
    this.effect(button,[{scale:'.92'},{scale:'1.065',offset:.55},{scale:'1'}],250,delay,now);
    this.effect(this.root.querySelector('.rr-selection'),[{opacity:.55,translate:'0 3px'},{opacity:1,translate:'0 0'}],220,delay,now);
  }
  reveal(multiplier=0) {
    const now=performance.now(),target=now+(this.moving()?252:30),peak=this.sound?.result(multiplier,target)??target,delay=Math.max(0,peak-now-252);
    this.effect(this.root.querySelector('.rr-result-orb'),[{opacity:0,scale:'.7',rotate:'-12deg'},{opacity:1,scale:'1.08',rotate:'2deg',offset:.7},{opacity:1,scale:'1',rotate:'0deg'}],360,delay,now);
    this.effect(this.root.querySelector('.rr-center'),[{boxShadow:'0 0 0 0 #e5c88955'},{boxShadow:'0 0 0 7px #e5c88900'}],460,delay,now);
    this.effect(this.root.querySelector('.rr-landed>span'),[{scale:'.85'},{scale:'1.13',offset:.55},{scale:'1'}],330,delay,now);
    this.effect(this.root.querySelector('.rr-return'),[{opacity:.35,translate:'0 4px'},{opacity:1,translate:'0 0'}],300,delay,now);
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
    this.effect(chip,[{opacity:0,scale:'.5',translate:'0 -7px'},{opacity:1,scale:'1',translate:'0 0'}],300);
  }
  state(){return {phase:this.pose.phase,pose:{...this.pose},active:this.active,scheduledFrames:this.frame?1:0,frames:this.frames,effects:this.effects.size,pocket:this.pocket??null,interrupted:this.interrupted};}
  destroy(){if(this.disposed)return;this.cancel();this.disposed=true;this.lifetime.abort();}
}
