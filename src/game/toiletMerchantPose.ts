export type MerchantAction='idle'|'look'|'beckon'|'trade';
type Segment=readonly [frame:number,ms:number];
const clips:Record<MerchantAction,readonly Segment[]>={
  idle:[[0,2400],[1,200],[0,1500],[2,100],[3,200],[0,1600]],
  look:[[0,500],[4,1100],[5,400],[6,1100],[7,500]],
  beckon:[[8,300],[9,300],[10,300],[11,300],[0,400]],
  trade:[[12,300],[13,200],[14,200],[15,3600],[14,200],[13,200],[12,300],[0,300]],
};
export function merchantDuration(action:MerchantAction){return clips[action].reduce((sum,s)=>sum+s[1],0);}
export function merchantFrame(action:MerchantAction,elapsed:number,reducedMotion=false){
  if(reducedMotion)return action==='trade'?15:0;
  let at=Math.max(0,elapsed)%merchantDuration(action);
  for(const [frame,ms] of clips[action]){if(at<ms)return frame;at-=ms;}
  return 0;
}

/** Decorative local behavior never submits a purchase or changes account state. */
export class ToiletMerchantRoutine{
  action:MerchantAction='idle';
  elapsed=0;
  private clock=0;
  private nextLook=9000;
  private nextBeckon=0;
  private nextTrade=0;
  private line=0;
  private speechUntil=0;
  speech:'beckon'|'trade'|''='';
  speechVariant=0;
  private start(action:MerchantAction){this.action=action;this.elapsed=0;}
  show(distance:number){
    if(distance>95||this.action==='trade')return false;
    this.start('trade');this.nextTrade=this.clock+20000;this.nextBeckon=this.clock+20000;
    this.speech='trade';this.speechVariant=this.line++%3;this.speechUntil=this.clock+4700;
    return true;
  }
  update(delta:number,distance:number,settled:boolean,reducedMotion:boolean){
    const dt=Math.min(100,Math.max(0,delta));this.clock+=dt;
    if(!reducedMotion||this.action==='trade')this.elapsed+=dt;
    if(this.clock>=this.speechUntil)this.speech='';
    if(this.action!=='idle'&&this.elapsed>=merchantDuration(this.action)){
      this.start('idle');this.nextLook=this.clock+9000;
    }
    if(distance<86&&settled&&this.clock>=this.nextTrade&&this.action!=='trade')this.show(distance);
    else if(!reducedMotion&&distance<155&&distance>=86&&this.clock>=this.nextBeckon&&(this.action==='idle'||this.action==='look')){
      this.start('beckon');this.nextBeckon=this.clock+18000;
      this.speech='beckon';this.speechUntil=this.clock+2600;
    }
    else if(!reducedMotion&&this.action==='idle'&&this.clock>=this.nextLook){this.start('look');this.nextLook=this.clock+14000;}
    return merchantFrame(this.action,this.elapsed,reducedMotion);
  }
}
