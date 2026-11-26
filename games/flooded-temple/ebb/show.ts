/** Shows confirmed cascade frames on the Ebb stage. It never draws a result before the server confirmed it,
 *  never touches money and never asks for a continuation: the controller owns all of that. */
import {CASCADE_DATA,type CascadeFrame} from '../../../src/shared/floodedTempleCascadeMath';
import {cascadeUnits,type TempleCascadeView} from '../../../src/shared/floodedTempleCascade';
import {cascadeMoves,type CascadeSource} from '../cascadePresentation';
import {Stage} from './stage';
import {ease,lerp} from './clock';
export type Cue='lever'|'sink'|'land'|'splash'|'crack'|'ebb'|'hook'|'step'|'coin'|'win'|'big'|'chest'|'bonus'|'gate'|'neutral'|'relic';
type Parent=CascadeSource&{cascade?:number;multiplier?:number;mode?:string};
export type ShowHooks={cue:(c:Cue,gain?:number)=>void;t:(ru:string,en:string)=>string;money:(units:string)=>string;pay:(units:string)=>void;say:(text:string,kind?:''|'win'|'quiet')=>void;free:(left:number|null)=>void;payAt:()=>{x:number;y:number}};
const LEVEL=[.93,.62,.31,0],LIGHT=[.12,.40,.70,1];
const bits=(m:number)=>{let n=0;for(;m;m&=m-1)n++;return n;};
const never=()=>new Promise<never>(()=>{});
export class Show{
  run=0;calm=false;fast=false;private shown=0;private stake='10';private spins=0;private losses=0;
  constructor(public stage:Stage,private h:ShowHooks){}
  get hero(){return this.stage.hero;}get lock(){return this.stage.lock;}get clock(){return this.stage.clock;}
  /** A stale show stops at its next await; its tweens are dropped by cancel(). */
  private async live(t:number){if(t!==this.run)await never();}
  cancel(){this.run++;this.clock.drop();const s=this.stage;s.fx.list=[];s.rope.on=false;s.gate=0;s.prize.a=0;s.prize.open=0;s.popup.t=9;s.lever=0;this.lock.pour=0;this.lock.sealPulse=0;for(let c=0;c<5;c++){this.lock.stream[c]=0;this.lock.grate[c]=0;}this.lock.undim();}
  private mult(f:{mode:string;multiplier:number}){return (f.mode==='free'?CASCADE_DATA.freeMultipliers:CASCADE_DATA.baseMultipliers).indexOf(f.multiplier);}
  private level(step:number){return this.lock.holy>.5?LIGHT[step]:LEVEL[step];}
  private setPoints(points:number){this.shown=points;this.h.pay(cascadeUnits(points,this.stake));}
  private async countTo(points:number,d=.5){const a=this.shown;await this.clock.tween(d,u=>this.setPoints(Math.round(lerp(a,points,u))),ease.out);this.setPoints(points);}
  private seal(){void this.clock.tween(.5,u=>{this.lock.sealPulse=Math.sin(u*Math.PI);});}
  private spot(step:number){return step>=3?2:step===2?1:0;}
  private async toStep(step:number){
    const L=this.lock;if(L.step===step&&Math.abs(L.level-this.level(step))<.01)return;const up=step>L.step;L.step=step;
    if(this.calm){L.level=this.level(step);this.stage.spot=this.spot(step);this.stage.place();return;}
    let jump:Promise<void>|undefined;
    if(up){this.seal();this.h.cue('ebb');const spot=this.spot(step);if(spot!==this.stage.spot){if(this.hero.clip==='cheer'||this.hero.clip==='watch')this.hero.play('idle');jump=this.clock.wait(.1).then(()=>{this.h.cue('step');return this.stage.hop(spot);}).then(()=>this.clock.wait(.14));}}
    await Promise.all([L.ebb(this.level(step),up?.55:.4),jump]);
  }
  /** Neutral motion while a paid start is in flight: it shows no symbol of the coming result. */
  async request(){
    const t=++this.run;this.clock.rate=this.fast&&!this.calm?2:1;this.setPoints(0);this.h.say('');
    if(this.calm){this.lock.undim();return;}
    this.h.cue('lever');if(this.stage.spot!==0)void this.stage.hop(0,.34).then(()=>this.stage.pull());else this.stage.pull();
    this.clock.after(.2,()=>this.h.cue('sink'));void this.toStep(0);await this.clock.wait(.16);await this.live(t);await this.lock.sink();
  }
  private async spinOut(t:number){
    if(this.calm){this.stage.spot=0;this.stage.place();this.lock.step=0;this.lock.level=this.level(0);return;}
    this.h.cue('lever');if(this.stage.spot!==0)void this.stage.hop(0,.34).then(()=>this.stage.pull());else this.stage.pull();
    this.clock.after(.2,()=>this.h.cue('sink'));void this.toStep(0);await this.clock.wait(.16);await this.live(t);await this.lock.sink();await this.live(t);await this.clock.wait(.18);
  }
  private async spinIn(grid:readonly number[]){
    if(this.calm){this.lock.set(grid);await this.clock.wait(.25);return;}
    this.hero.play('watch');const wet=this.spins++%3===2;
    this.lock.onLand=c=>{this.h.cue('land');this.h.cue('splash',.6);if(c===4&&wet&&!this.fast){this.hero.play('shield');this.stage.fx.splash(this.hero.x+this.stage.heroH*.14,this.hero.y-this.stage.heroH*.7,14,.7);}};
    await this.lock.arrive(grid);if(this.hero.clip==='watch')this.hero.play('idle');
  }
  private base(step:number){const s=this.stage,L=this.lock;s.temple.holy=0;s.temple.dry=0;L.holy=0;L.labels=[...CASCADE_DATA.baseMultipliers];L.step=step;L.level=LEVEL[step];s.jade=0;this.hero.lit=0;s.spot=0;s.place();this.h.free(null);}
  private holy(step:number,left:number){const s=this.stage,L=this.lock;s.temple.holy=1;s.temple.dry=1;L.holy=1;L.labels=[...CASCADE_DATA.freeMultipliers];L.step=step;L.level=LIGHT[step];s.jade=1;this.hero.lit=1;s.spot=this.spot(step);s.place();this.h.free(left);}
  private async bonusIn(added:number,t:number){
    const s=this.stage,c=this.clock;this.h.say('');this.h.cue('bonus');this.hero.play('relic');this.hero.lit=1;void c.tween(.5,u=>{s.jade=u;});
    if(!this.calm){void c.tween(1.3,u=>{s.temple.dry=u;},ease.io);void this.lock.ebb(0,1.2);await c.wait(1.15);await this.live(t);this.h.cue('gate');}
    s.gateText=[this.h.t('Святилище реликвий','Relic Sanctuary'),this.h.t(added+' бесплатных вращений',added+' free spins')];
    await c.tween(this.calm?.05:.45,u=>{s.gate=u;},ease.in);if(!this.calm){s.quake();this.h.cue('land');}
    this.holy(0,added);this.lock.level=0;this.lock.undim();this.hero.play('idle');await c.wait(this.calm?1:1.3);await this.live(t);this.h.cue('gate');
    await c.tween(this.calm?.05:.75,u=>{s.gate=1-u;},ease.io);await this.live(t);await this.lock.ebb(LIGHT[0],.4);
  }
  private async bonusOut(points:number,grid:readonly number[],step:number,t:number){
    const s=this.stage,c=this.clock;s.gateText=[this.h.t('Святилище пройдено','Sanctuary complete'),this.h.t('Собрано ','Collected ')+this.h.money(cascadeUnits(points,this.stake))];this.h.cue('gate');
    await c.tween(this.calm?.05:.5,u=>{s.gate=u;},ease.in);if(!this.calm)s.quake();this.base(step);this.lock.set(grid);await c.wait(this.calm?1:1.5);await this.live(t);this.h.cue('gate');await c.tween(this.calm?.05:.7,u=>{s.gate=1-u;},ease.io);await this.live(t);
  }
  /** Presents one confirmed batch. `previous` is the earlier confirmed batch of the same paid round. */
  async play(view:TempleCascadeView,previous:TempleCascadeView|undefined,started?:Promise<void>){
    const t=previous?++this.run:this.run;this.stake=view.stakeUnits;this.clock.rate=this.fast&&!this.calm?2:1;
    if(started){await started;await this.live(t);}
    let prior:CascadeFrame|undefined=previous?.frames.at(-1),parent:Parent|undefined=previous?.state.parent??undefined;
    if(previous)this.shown=previous.state.totalPoints;
    for(const f of view.frames){
      let source:Parent|undefined=prior?.removeMask?prior:undefined;
      if(prior?.mode==='base'&&f.mode==='free'){parent=prior;await this.bonusIn(prior.addedFreeSpins,t);await this.spinOut(t);source=undefined;}
      else if(prior?.mode==='free'&&f.mode==='base'){source=parent;parent=undefined;const step=source?.multiplier!==undefined?this.mult(source as CascadeFrame):Math.min(3,Math.max(0,(source?.cascade??1)-1));await this.bonusOut(prior.totalPoints,source!.grid,step,t);}
      else if(prior&&!source){await this.spinOut(t);}
      if(f.mode==='free')this.h.free(f.remainingFreeSpins);
      const step=this.mult(f);
      if(source?.removeMask){
        this.h.cue('crack');if(!this.calm&&this.hero.clip!=='throw')this.hero.play(bits(source.removeMask)>=4?'shield':'watch');
        if(this.calm)this.lock.undim();else await this.lock.crumble(source.removeMask,this.h.payAt(),this.clock.rate);await this.live(t);
        const down=this.toStep(step);if(this.calm)this.lock.set(f.grid);else await this.lock.settle(cascadeMoves(source,f.grid),f.grid);await down;await this.live(t);
      }else{if(this.lock.step!==step)await this.toStep(step);await this.spinIn(f.grid);await this.live(t);}
      if(f.removeMask)await this.celebrate(f,prior?.totalPoints??0,t);
      prior=f;
    }
  }
  private async celebrate(f:CascadeFrame,before:number,t:number){
    const gain=cascadeUnits(f.totalPoints,this.stake),was=cascadeUnits(before,this.stake),add=String(BigInt(gain)-BigInt(was)),line=f.awardedPoints>=20;
    if(f.awardedPoints&&f.wins.length){const mid=this.lock.center(f.wins[0].cells[1]);Object.assign(this.stage.popup,{t:this.calm?.3:-.25,x:mid.x,y:mid.y-this.lock.area.c*.1,text:'+'+this.h.money(add),small:f.multiplier>1?'×'+f.multiplier:''});this.h.say((f.multiplier>1?'×'+f.multiplier+' · ':'')+'+'+this.h.money(add),line?'win':'quiet');}
    if(f.addedFreeSpins){this.h.cue('relic');this.h.say(this.h.t('Реликвии на линии: +','Relics on a payline: +')+f.addedFreeSpins+this.h.t(' бесплатных вращений',' free spins'),'win');if(f.mode==='free'){this.hero.play('relic');this.clock.after(1.1,()=>{if(this.hero.clip==='relic')this.hero.play('idle');});}}
    else if(line&&this.stage.spot===0&&this.stage.mode!=='portrait'&&!this.calm){const cell=f.wins[0].cells.at(-1)!;void this.stage.hook(this.lock.center(cell),p=>{if(t!==this.run)return;this.h.cue('coin');this.stage.fx.coins(p.x,p.y,8,.5);});this.h.cue('hook');}
    else if(line&&!this.calm)this.hero.play('cheer');
    this.h.cue('coin',.7);if(f.awardedPoints)void this.clock.wait(this.calm?0:.5).then(()=>t===this.run?this.countTo(f.totalPoints,this.calm?.05:.6):undefined);
    if(this.calm){for(let i=0;i<15;i++)this.lock.cells[i].hot=f.removeMask&(1<<i)?1:0;this.lock.dim=1;await this.clock.wait(.6);}
    else await this.lock.celebrate(f.removeMask,f.wins,f.bonusLines,f.addedFreeSpins?1.25:.85);
    await this.live(t);this.setPoints(Math.max(this.shown,f.totalPoints));
  }
  /** The confirmed end of a paid round: a chest for a payout of five stakes or more, quiet otherwise. */
  async finish(view:TempleCascadeView,payout:string){
    const t=this.run,stake=BigInt(view.stakeUnits),p=BigInt(payout),kind=p>=stake*25n?'huge':p>=stake*5n?'big':p>stake?'win':p>0n?'quiet':'loss';
    this.h.pay(payout);this.lock.undim();
    if(kind==='big'||kind==='huge'){
      const P=this.stage.prize,c=this.clock;P.label=kind==='huge'?this.h.t('Сокровищница открыта','The treasury opens'):this.h.t('Крупный выигрыш','Big win');P.text=this.h.money('0');this.hero.play('triumph');this.h.cue('chest');
      await c.tween(.25,u=>{P.a=u;});await this.live(t);await c.tween(this.calm?.05:.5,u=>{P.open=u;});this.h.cue('big');if(kind==='huge')this.stage.quake();
      if(!this.calm){const at=this.stage.chestAt(),n=kind==='huge'?70:34,fx=this.stage.fx;fx.coins(at.x,at.y-at.S*.2,n,Math.min(1.25,at.S/170),1);if(kind==='huge')for(let i=1;i<=2;i++)c.after(i*.75,()=>fx.coins(at.x,at.y-at.S*.2,46,Math.min(1.3,at.S/160),1.15));
        for(let i=0;i<(kind==='huge'?10:4);i++)c.after(.15+i*.22,()=>fx.add({k:'spark',x:at.x+(Math.random()-.5)*at.S*2,y:at.y-at.S*(.2+Math.random()*1.1),d:.8,s:16,c:'255,232,160'}));}
      await c.tween(this.calm?.05:kind==='huge'?2.2:1.2,u=>{P.text=this.h.money(String(p*BigInt(Math.round(ease.out(u)*1000))/1000n));});P.text=this.h.money(payout);await c.wait(kind==='huge'?1.5:1);await this.live(t);await c.tween(.3,u=>{P.a=1-u;});P.open=0;
      c.after(1.2,()=>{if(t===this.run&&this.hero.clip==='triumph')this.hero.play('idle');});
    }else if(kind==='loss'){this.hero.play(this.losses++%3===1&&!this.fast?'wring':'sigh');}
    else if(kind==='win'){this.hero.play('cheer');this.h.cue('win');}
    else this.h.cue('neutral');
  }
  /** The last confirmed state without any decoration: used for skip, reload and reduced motion. */
  settle(view:TempleCascadeView|undefined,payout?:string){
    this.cancel();const f=view?.frames.at(-1);if(!f){this.base(0);return;}this.stake=view!.stakeUnits;const step=this.mult(f);
    if(f.mode==='free'&&view!.phase!=='complete')this.holy(step,f.remainingFreeSpins);else{this.base(step);this.stage.spot=this.spot(step);this.stage.place();}
    this.lock.set(f.grid);this.hero.play('idle');this.shown=f.totalPoints;this.h.pay(payout??view!.totalPayoutUnits);
  }
}
