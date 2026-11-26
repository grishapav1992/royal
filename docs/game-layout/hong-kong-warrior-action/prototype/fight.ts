/** Builds one deterministic fight. Presentation only: the server outcome is an input. */
import {Track,rng,clamp,lerp,smooth,type To} from './track';
import {FOES,type FoeId,type Location,type Sheet} from './art';
export type Fx={t:number;kind:'hit'|'block'|'dust'|'sweat'|'wood'|'china'|'fruit'|'arc'|'kanji'|'lines'|'land';x:number;y:number;z:number;dir:number;power:number;seed:number;text?:string;shape?:'line'|'up'|'spin'|'low'};
export type Cue={t:number;kind:'punch'|'kick'|'chair'|'block'|'whoosh'|'wood'|'landing'|'crash'|'china';level:number};
export type Status='playing'|'complete'|'lost';
/** Script seconds run faster than display seconds: 4.2, 6.7 and 9.2 on screen. */
export const RATE=1.18;
export const contactAt=(i:number)=>3.2+i*2.9;
export const revealAt=(count:number)=>contactAt(count-1)+1.12;
export const REACTION=.72,VICTORY=3.1;
type Dir=1|-1;
export class Actor{
  down=false;
  constructor(public track:Track,public sheet:Sheet,public hero:boolean,public kind:FoeId|'hero',public weight=1){}
  at(t:number){return this.track.at(t);}
  x(t:number){return this.track.at(t).x;}
  to(t:number,d:number,o:To){this.track.to(t,d,o);return this;}
  get block(){return this.hero?'c6':'b7';}
  get hurt(){return this.hero?'b6':'b2';}
}
export type Prop={track:Track;sprite:string;kind:'chair'|'stool'|'table'|'crate'|'barrel'|'cart'|'basket';x:number;broken:boolean};
type Phrase={id:string;ru:string;d:number;duo?:boolean;only?:FoeId;place?:Location;run:(t:number,a:Actor,b?:Actor)=>void};
type Finisher={id:string;ru:string;text:string;place?:Location;prop?:Prop['kind'];lead:number;run:(t:number,a:Actor,won:boolean)=>void};
export type Options={seed:string;location:Location;lineup:FoeId[];fightIndex:number;status:Status;hero:Sheet;foes:Record<string,Sheet>;W:number;only?:string};
export class Fight{
  hero:Actor;foes:Actor[]=[];props:Prop[]=[];fx:Fx[]=[];cues:Cue[]=[];
  cams:{t:number;d:number;x:number;zoom:number}[]=[];
  beats:{t:number;label:string}[]=[];
  hits=0;evades=0;L:number;reveal:number;end:number;
  private r:()=>number;
  constructor(public o:Options){
    this.r=rng(o.seed+':'+o.fightIndex+':'+o.location);
    this.L=clamp(o.W+.06,1.3,2);
    const n=o.lineup.length;
    this.hero=new Actor(new Track('hero',n===1?-.5:0,1),o.hero,true,'hero');
    const slots=n===1?[.5]:n===2?[.88,-.88]:[.86,-.9,Math.min(this.L-.12,1.36)];
    o.lineup.forEach((id,i)=>{
      const x=slots[i],z=i===2?.75:n===1?.05:.28;
      const a=new Actor(new Track('foe'+i,x,x>0?-1:1,z),o.foes[id],false,id,FOES[id].weight);
      if(o.fightIndex>0){const side=x>0?1:-1;a.track.clips[0].x0=a.track.clips[0].x1=side*(this.L+1.2);a.to(0,.34+i*.05,{x,face:(-side)as Dir,pose:'b0',bend:.16,ghost:true,ease:'out',z}).to(.34+i*.05,.12,{pose:'b0',idle:true});this.fxAt('dust',.3+i*.05,x,0,z,1);}
      this.foes.push(a);
    });
    this.setProps();
    this.reveal=revealAt(n);
    this.compose();
    this.end=this.reveal+(o.status==='complete'?VICTORY:o.status==='lost'?.55:REACTION);
    this.fx.sort((a,b)=>a.t-b.t);this.cams.sort((a,b)=>a.t-b.t);
  }
  // ---- helpers
  private cue(t:number,kind:Cue['kind'],level=1){this.cues.push({t,kind,level});}
  private fxAt(kind:Fx['kind'],t:number,x:number,y:number,z:number,power:number,dir=1,extra:Partial<Fx>={}){this.fx.push({t,kind,x,y,z,dir,power,seed:Math.floor(this.r()*1e6),...extra});}
  private cam(t:number,d:number,x:number,zoom:number){this.cams.push({t,d,x,zoom});}
  private in(x:number,m=.12){return clamp(x,-this.L+m,this.L-m);}
  private dir(a:Actor,b:Actor,t:number):Dir{return b.x(t)>=a.x(t)?1:-1;}
  gap(a:Actor,pose:string,v:Actor,vpose:string,lift=0){const tip=a.sheet[pose].tip;return Math.max(.3,tip.dx+v.sheet[vpose].front(Math.max(.05,tip.dy+lift))*.72);}
  private say(t:number,label:string){this.beats.push({t,label});}
  /** A long way to the target takes a visible dash instead of a jump cut. */
  private run(t:number,a:Actor,v:Actor,lead:number){return Math.max(lead,.07+Math.max(0,Math.abs(a.x(t-lead)-v.x(t))-.6)*.34);}
  /** A clean hit with anticipation, contact, hit-stop and recoil. */
  private hit(t:number,a:Actor,v:Actor,pose:string,o:{wind?:string;lead?:number;hold?:number;kb?:number;power?:number;snd?:Cue['kind'];shape?:Fx['shape'];hurt?:string;recover?:boolean;lift?:number;quiet?:boolean}={}){
    const lead=this.run(t,a,v,o.lead??.18),hold=o.hold??.1,power=o.power??1,dir=this.dir(a,v,t-lead),hurt=o.hurt??v.hurt;
    const vx=v.x(t),x=this.in(vx-dir*this.gap(a,pose,v,v.hurt),.02),tip=a.sheet[pose].tip;
    a.to(t-lead,Math.max(.04,lead-.07),{pose:o.wind??(a.hero?'b2':'b0'),face:dir,x:x-dir*.09,bend:-.09,z:.04,ease:Math.abs(a.x(t-lead)-x)>.35?'io':'out',ghost:Math.abs(a.x(t-lead)-x)>.35});
    a.to(t-.07,.07,{pose,face:dir,x,bend:.07,ease:'in',ghost:true,z:.04});
    a.to(t,hold,{pose,face:dir,x,bend:.03,pop:.02});
    if(o.recover!==false)a.to(t+hold,.16,{pose:'b0',face:dir,idle:true});
    const kb=(o.kb??.1)/v.weight;
    v.to(t,.055,{pose:hurt,face:(-dir)as Dir,jit:.012*power,z:.05});
    v.to(t+.055,.2,{pose:hurt,face:(-dir)as Dir,x:this.in(vx+dir*kb),rot:-.07*power,bend:-.06*power,ease:'out'});
    v.to(t+.3,.16,{pose:'b0',face:(-dir)as Dir,idle:true});
    const cx=x+dir*tip.dx*.97,kick=pose==='b4'||pose==='b5'||pose==='c2'||pose==='c5'||pose==='c3';
    this.fxAt('arc',t-.07,x,tip.dy,.04,power,dir,{shape:o.shape??(pose==='c2'?'low':pose==='c5'?'spin':kick?'up':'line')});
    if(!o.quiet)this.fxAt('hit',t,cx,tip.dy,0,power,dir);
    if(power>1||this.r()<.4)this.fxAt('sweat',t,cx,Math.max(.6,tip.dy),0,power,dir);
    this.cue(t-.14,'whoosh',.5);this.cue(t,o.snd??(kick?'kick':'punch'),.4+.2*power);this.hits++;
    return {x,dir,cx,cy:tip.dy};
  }
  private blocked(t:number,a:Actor,v:Actor,pose:string,o:{lead?:number;slide?:number;recover?:boolean}={}){
    const lead=this.run(t,a,v,o.lead??.17),dir=this.dir(a,v,t-lead),vx=v.x(t),tip=a.sheet[pose].tip;
    const x=this.in(vx-dir*this.gap(a,pose,v,v.block),.02);
    a.to(t-lead,Math.max(.04,lead-.07),{pose:a.hero?'b2':'b0',face:dir,x:x-dir*.08,bend:-.09,z:.04,ease:Math.abs(a.x(t-lead)-x)>.35?'io':'out',ghost:Math.abs(a.x(t-lead)-x)>.35});
    a.to(t-.07,.07,{pose,face:dir,x,bend:.06,ease:'in',ghost:true});
    a.to(t,.09,{pose,face:dir,x});
    if(o.recover!==false)a.to(t+.09,.14,{pose:'b0',face:dir,idle:true});
    v.to(t-.08,.07,{pose:v.block,face:(-dir)as Dir,z:.04});
    v.to(t,.14,{pose:v.block,face:(-dir)as Dir,x:this.in(vx+dir*(o.slide??.05)),bend:-.05,ease:'out',jit:.005});
    v.to(t+.16,.12,{pose:'b0',face:(-dir)as Dir,idle:true});
    this.fxAt('arc',t-.07,x,tip.dy,.04,.7,dir,{shape:pose==='b5'||pose==='b4'?'up':'line'});
    this.fxAt('block',t,x+dir*tip.dx*.95,tip.dy,0,1,dir);this.cue(t-.13,'whoosh',.4);this.cue(t,'block',.55);this.hits++;
  }
  private dodged(t:number,a:Actor,v:Actor,pose:string,how:'b1'|'c7'|'b4',o:{lead?:number;back?:number}={}){
    const lead=this.run(t,a,v,o.lead??.17),dir=this.dir(a,v,t-lead),vx=v.x(t),tip=a.sheet[pose].tip,x=this.in(vx-dir*Math.max(.4,tip.dx+.04),.02);
    a.to(t-lead,Math.max(.04,lead-.07),{pose:a.hero?'b2':'b0',face:dir,x:x-dir*.08,bend:-.1,z:.04,ease:'out'});
    a.to(t-.07,.07,{pose,face:dir,x,bend:.08,ease:'in',ghost:true});
    a.to(t,.12,{pose,face:dir,x:x+dir*.03});
    a.to(t+.12,.14,{pose:'b0',face:dir,idle:true});
    v.to(t-.13,.1,{pose:how,face:(-dir)as Dir,x:this.in(vx+dir*(o.back??(how==='c7'?.1:.02))),z:.02,ease:'out'});
    v.to(t+.1,.12,{pose:v.hero?'b2':'b0',face:(-dir)as Dir});
    this.fxAt('arc',t-.07,x,tip.dy,.04,.6,dir,{shape:pose==='b5'?'up':'line'});this.cue(t-.1,'whoosh',.8);this.evades++;
  }
  /** Airborne fall with a bounce, a slide and a seat on the floor. */
  private launch(t:number,v:Actor,dir:Dir,dist:number,height:number,slow=1,o:{spin?:number;rest?:string;stop?:number}={}){
    const stop=o.stop??.08,s=v.at(t),x1=this.in(s.x+dir*dist/Math.sqrt(v.weight),.18),fly=(.34+height*.5)*slow;
    v.to(t,stop,{pose:v.hurt,face:(-dir)as Dir,jit:.016});
    v.to(t+stop,fly,{pose:'b3',face:(-dir)as Dir,x:lerp(s.x,x1,.8),arc:height,rot:-(o.spin??.5),pv:.35,ease:'lin',ghost:true,z:Math.max(.1,s.z)});
    const land=t+stop+fly;
    v.to(land,.16,{pose:'b3',face:(-dir)as Dir,x:lerp(s.x,x1,.95),arc:.07,rot:0,pv:0,ease:'out',pop:.12});
    v.to(land+.16,.22,{pose:'b3',face:(-dir)as Dir,x:x1,ease:'out'});
    v.to(land+.42,.2,{pose:o.rest??'b6',face:(-dir)as Dir,idle:true,z:.7+.35*this.r(),x:this.in(x1+dir*.12,.2)});
    this.fxAt('land',land,lerp(s.x,x1,.8),0,.1,1.4,dir);this.fxAt('dust',land+.16,x1,0,.1,.8,dir);
    this.cue(land,'landing',1);return land;
  }
  private rise(t:number,v:Actor,face:Dir){v.to(t,.22,{pose:'b4',face,z:.2}).to(t+.22,.2,{pose:'b0',face,idle:true});}
  private face(t:number,a:Actor,b:Actor){a.to(t,.1,{pose:'b0',face:this.dir(a,b,t),idle:true});}
  private nearProp(kind:Prop['kind']){return this.props.find(p=>p.kind===kind&&!p.broken);}
  private smash(t:number,p:Prop,dir:number,power=1){
    p.broken=true;const s=p.track.at(t);
    if(p.kind==='basket')p.track.to(t,.3,{pose:'p7',rot:1.8,pv:.15,x:s.x,y:0,ease:'out'});
    else{p.track.to(t,.05,{pose:'p3',rot:0,x:s.x,y:0,pop:.18});this.fxAt('wood',t,s.x,.2,s.z,power,dir);}
    this.fxAt('dust',t,s.x,0,s.z,1.2,dir);this.cue(t,'crash',1);
    if(p.kind==='table')this.fxAt('china',t,s.x,.38,s.z,1,dir);
    if(p.kind==='basket')this.fxAt('fruit',t,s.x,.25,s.z,1,dir);
  }
  private setProps(){
    const {location,fightIndex,seed}=this.o,L=this.L,flip=rng(seed+'props')()<.5?1:-1;
    const add=(kind:Prop['kind'],x:number,z:number,broken=false)=>{
      const sprite={chair:'p0',stool:'p1',table:'p2',crate:'p4',barrel:'p5',cart:'p6',basket:'p7'}[kind];
      this.props.push({kind,sprite,x,broken,track:new Track(kind+x,x,x>0?-1:1,z,broken&&kind!=='basket'?'p3':sprite)});
      if(broken&&kind==='basket'){const k=this.props.at(-1)!.track.clips[0];k.r0=k.r1=1.8;k.pv=.15;}
    };
    const far=L-.34;
    // Earlier fights of the same series leave their wreckage on the set.
    if(location==='restaurant'){add('table',-flip*far,.72,fightIndex>1);add('stool',-flip*(far-.42),.95);add('chair',flip*far,.6,fightIndex>2);if(fightIndex>0)add('stool',flip*(far-.5),1,true);}
    else if(location==='harbor'){add('crate',flip*far,.7,fightIndex>1);add('barrel',-flip*(far-.1),.6);add('crate',-flip*(far+.14),1,fightIndex>2);if(fightIndex>0)add('barrel',flip*(far-.5),.95,true);}
    else{add('cart',-flip*(far-.05),.85);add('basket',flip*(far-.05),.55);add('crate',flip*(far+.06),1,fightIndex>1);if(fightIndex>0)add('basket',flip*(far-.5),.9,true);}
  }
  // ---- exchanges
  phrases():Phrase[]{
    const h=this.hero;
    return [
      {id:'trade',ru:'Обмен: блок, ладонь, нырок, прямой',d:.98,run:(t,a)=>{this.blocked(t+.22,a,h,'b1');this.hit(t+.45,h,a,'c1',{lead:.15});this.dodged(t+.72,a,h,'b5','b1');this.hit(t+.93,h,a,'b3',{lead:.15,kb:.16});}},
      {id:'slip',ru:'Уклон, локоть, кулак наотмашь',d:.86,run:(t,a)=>{this.dodged(t+.2,a,h,'b1','c7');this.hit(t+.42,h,a,'c4',{lead:.14});this.hit(t+.64,h,a,'c0',{lead:.15,kb:.22,power:1.3});}},
      {id:'flurry',ru:'Серия быстрых ударов',d:.95,run:(t,a)=>{
        ['c1','b3','c0','c1','b3'].forEach((p,i)=>this.hit(t+.22+i*.105,h,a,p,{lead:i?.08:.18,hold:.03,kb:.035,recover:false,wind:i%2?'b2':'c4'}));
        this.hit(t+.84,h,a,'c5',{lead:.17,kb:.34,power:1.5});}},
      {id:'roll',ru:'Перекат за спину и удар',d:.98,run:(t,a)=>{
        const dir=this.dir(h,a,t);this.dodged(t+.26,a,h,'b5','b1');const x=this.in(a.x(t+.3)+dir*.62);
        h.to(t+.2,.36,{pose:'b5',face:dir,x,rot:Math.PI*2,pv:.3,arc:.12,ease:'io',ghost:true});
        this.fxAt('dust',t+.3,lerp(h.x(t),x,.5),0,0,.8,dir);a.to(t+.6,.1,{pose:'b0',face:dir});
        this.hit(t+.82,h,a,'c0',{lead:.2,kb:.26,power:1.3});}},
      {id:'flip',ru:'Сальто через соперника',d:1.08,run:(t,a)=>{
        const dir=this.dir(h,a,t),ax=a.x(t),x=this.in(ax+dir*.66);
        h.to(t,.12,{pose:'b1',face:dir,bend:-.06});h.to(t+.12,.5,{pose:'b5',face:dir,x,arc:.72,rot:Math.PI*2,pv:.3,ease:'lin',ghost:true});
        a.to(t+.14,.12,{pose:'b0',face:(-dir)as Dir,bend:-.1});a.to(t+.27,.08,{pose:'b1',face:(-dir)as Dir,x:ax-dir*.2,bend:.08,ghost:true,ease:'in'});a.to(t+.5,.14,{pose:'b0',face:(-dir)as Dir});
        this.cue(t+.14,'whoosh',.9);this.fxAt('land',t+.62,x,0,0,.8,dir);h.to(t+.62,.1,{pose:'b1',face:(-dir)as Dir,pop:.12});a.to(t+.68,.1,{pose:'b0',face:dir});
        this.hit(t+.9,h,a,'b4',{lead:.18,kb:.34,power:1.5});}},
      {id:'wall',ru:'Отскок от стены и удар в полёте',d:1.18,run:(t,a)=>{
        const dir=this.dir(h,a,t),wall=-dir*(this.L-.06);
        h.to(t,.3,{pose:'c3',face:(-dir)as Dir,x:wall,arc:.06,ghost:true,bend:.1,ease:'in'});
        a.to(t+.06,.36,{pose:'b1',face:(-dir)as Dir,x:this.in(wall+dir*1.06),bend:.1,ghost:true});
        h.to(t+.3,.14,{pose:'b1',face:dir,x:wall,y:.42,rot:.5,pv:.2,ease:'out'});this.fxAt('dust',t+.32,wall,.35,.2,1,dir);this.cue(t+.32,'wood',1);
        this.flyHit(t+.78,h,a,'b4',{from:.34,kb:.5,power:1.8,arc:.18});}},
      {id:'throw',ru:'Бросок через себя',d:1.22,run:(t,a)=>{
        const dir=this.dir(h,a,t);this.blocked(t+.24,a,h,'b5',{slide:.02});const hx=h.x(t+.3);
        h.to(t+.3,.14,{pose:'b2',face:dir,bend:-.08});h.to(t+.44,.18,{pose:'c7',face:(-dir)as Dir});h.to(t+.7,.2,{pose:'b0',face:(-dir)as Dir,idle:true});
        const x=this.in(hx-dir*.86);a.to(t+.34,.5,{pose:'b3',face:(-dir)as Dir,x,arc:.58,rot:Math.PI*2*.94,pv:.36,ease:'lin',ghost:true});
        a.to(t+.84,.14,{pose:'b3',face:dir,arc:.05,pop:.14,pv:0});this.fxAt('land',t+.84,x,0,.1,1.4,dir);this.cue(t+.84,'landing',1);this.cue(t+.38,'whoosh',1);this.hits++;
        this.rise(t+1,a,dir);}},
      {id:'slide',ru:'Скольжение под соперником',d:1.02,run:(t,a)=>{
        const dir=this.dir(h,a,t),ax=a.x(t),x=this.in(ax+dir*.64);
        h.to(t+.02,.1,{pose:'b1',face:dir});h.to(t+.12,.4,{pose:'c2',face:dir,x,ghost:true,ease:'out'});
        a.to(t+.1,.42,{pose:'b4',face:(-dir)as Dir,arc:.5,ease:'lin'});this.fxAt('dust',t+.2,ax,0,0,1,dir);this.fxAt('dust',t+.34,x,0,0,1,dir);this.cue(t+.12,'whoosh',.9);
        h.to(t+.54,.1,{pose:'b2',face:(-dir)as Dir});a.to(t+.54,.14,{pose:'b0',face:dir});this.hit(t+.84,h,a,'b3',{lead:.18,kb:.26,power:1.3});}},
      {id:'sweepKick',ru:'Подсечка с добиванием',d:.95,run:(t,a)=>{
        this.dodged(t+.2,a,h,'b1','b1');const r=this.hit(t+.46,h,a,'c2',{lead:.14,kb:0,hurt:'b2'});
        a.to(t+.5,.34,{pose:'b3',face:(-r.dir)as Dir,arc:.34,rot:-.5,pv:.3,ease:'lin',x:a.x(t+.46)});
        this.hit(t+.74,h,a,'b4',{lead:.16,kb:.36,power:1.4,hurt:'b3'});a.to(t+1.04,.2,{pose:'b4',idle:true});}},
      {id:'agile',only:'agile',ru:'Ловкий: кувырок и удар с ходу',d:1.02,run:(t,a)=>{
        const dir=this.dir(a,h,t),hx=h.x(t);a.to(t,.34,{pose:'b4',face:dir,rot:Math.PI*2,pv:.3,arc:.36,x:this.in(hx-dir*.95),ghost:true,ease:'lin'});this.cue(t+.05,'whoosh',.8);
        this.blocked(t+.48,a,h,'b5',{lead:.13,slide:.16});this.dodged(t+.68,h,a,'c4','b4',{lead:.13});this.hit(t+.9,h,a,'c2',{lead:.15,kb:.12,power:1.2});}},
      {id:'bruiser',only:'bruiser',ru:'Громила: таран мимо героя',d:1.12,run:(t,a)=>{
        const dir=this.dir(a,h,t),hx=h.x(t),end=this.in(hx+dir*.85);
        a.to(t,.16,{pose:'b7',face:dir,bend:-.12,x:a.x(t)-dir*.08});a.to(t+.16,.4,{pose:'b1',face:dir,x:end,bend:.16,ghost:true,ease:'in'});
        h.to(t+.16,.5,{pose:'b5',face:(-dir)as Dir,x:this.in(hx-dir*.18),arc:.78,rot:Math.PI*2,pv:.3,ease:'lin',ghost:true});
        for(const k of [.24,.36,.48])this.fxAt('dust',t+k,lerp(a.x(t),end,k*1.6),0,.1,1,dir);this.cue(t+.18,'whoosh',1);this.cue(t+.56,'landing',.6);
        h.to(t+.66,.1,{pose:'b1',face:dir,pop:.12});a.to(t+.6,.16,{pose:'b2',face:(-dir)as Dir});this.hit(t+.92,h,a,'c5',{lead:.18,kb:.3,power:1.5});}},
      {id:'enforcer',only:'enforcer',ru:'Телохранитель: тройная серия',d:1.02,run:(t,a)=>{this.blocked(t+.2,a,h,'b1',{lead:.15});this.dodged(t+.42,a,h,'b5','b1',{lead:.14});this.dodged(t+.64,a,h,'b1','c7',{lead:.14});this.hit(t+.88,h,a,'c4',{lead:.15,kb:.22,power:1.3});}},
      {id:'master',only:'master',ru:'Мастер: дуэль ладоней',d:1.08,run:(t,a)=>{this.blocked(t+.2,h,a,'b3',{lead:.15});this.blocked(t+.38,h,a,'c1',{lead:.13});this.blocked(t+.62,a,h,'b5',{lead:.16,slide:.24});this.hit(t+.94,h,a,'c3',{lead:.24,kb:.26,power:1.4,wind:'b1'});}},
      {id:'street',only:'street',ru:'Уличный: размах и встречная пара',d:.9,run:(t,a)=>{this.dodged(t+.22,a,h,'b1','b1',{lead:.2});this.hit(t+.44,h,a,'c0',{lead:.14});this.hit(t+.66,h,a,'b4',{lead:.16,kb:.34,power:1.4});}},
      // ---- two at once
      {id:'duck',ru:'Нырок: соперники бьют друг друга',duo:true,d:.98,run:(t,a,b)=>{
        const s=this.dir(h,a,t),hx=clamp(h.x(t),-this.L+.6,this.L-.6),reach=(a.sheet.b1.tip.dx+b!.sheet.b2.front(.7)*.6)/2;
        h.to(t,.16,{pose:'b0',face:s,x:hx});h.to(t+.2,.1,{pose:'b1',face:s,x:hx,pop:.1});
        a.to(t+.04,.22,{pose:'b0',face:(-s)as Dir,x:hx+s*(reach+.08),bend:-.12,z:.1});b!.to(t+.04,.22,{pose:'b0',face:s,x:hx-s*(reach+.08),bend:-.12,z:.06});
        a.to(t+.27,.07,{pose:'b1',face:(-s)as Dir,x:hx+s*reach,bend:.08,ghost:true,ease:'in'});b!.to(t+.27,.07,{pose:'b1',face:s,x:hx-s*reach,bend:.08,ghost:true,ease:'in'});
        for(const [v,d]of [[a,s],[b!,-s]] as const){v.to(t+.34,.07,{pose:'b2',jit:.014,face:(-d)as Dir});v.to(t+.41,.22,{pose:'b2',x:this.in(hx+d*(reach+.22)),rot:-.14,ease:'out',face:(-d)as Dir});v.to(t+.7,.16,{pose:'b0',face:(-d)as Dir,idle:true});}
        this.fxAt('hit',t+.34,hx+s*.12,.78,0,1.5,s);this.fxAt('hit',t+.36,hx-s*.14,.8,0,1.2,-s);this.cue(t+.34,'punch',1);this.cue(t+.37,'punch',.8);this.hits+=2;
        this.hit(t+.78,h,a,'c2',{lead:.18,kb:.14,power:1.2});}},
      {id:'split',ru:'Разворот: удар в обе стороны',duo:true,d:.92,run:(t,a,b)=>{
        const s=this.dir(h,a,t);a.to(t-.06,.28,{pose:'b1',face:(-s)as Dir,x:this.in(h.x(t)+s*.95),z:.1,bend:.06,ghost:true});b!.to(t-.06,.28,{pose:'b1',face:s,x:this.in(h.x(t)-s*.95),z:.1,bend:.06,ghost:true});
        this.hit(t+.34,h,a,'c5',{lead:.2,kb:.3,power:1.4,recover:false});this.hit(t+.6,h,b!,'c5',{lead:.18,kb:.3,power:1.4,wind:'c0'});}},
      {id:'over',ru:'Прыжок: удар в спину достаётся другому',duo:true,d:1.12,run:(t,a,b)=>{
        const s=this.dir(h,a,t),ax=clamp(a.x(t),-this.L+.5,this.L-.5),g=this.gap(b!,'b5',a,'b2');
        a.to(t,.24,{pose:'b1',face:(-s)as Dir,x:ax,z:.1});b!.to(t+.04,.28,{pose:'b0',face:s,x:ax-s*(g+.1),bend:-.1,z:.06});
        h.to(t,.18,{pose:'b1',face:s});h.to(t+.2,.5,{pose:'b5',face:s,x:this.in(ax-s*(g+.55)),arc:.76,rot:-Math.PI*2,pv:.3,ease:'lin',ghost:true});
        this.hit(t+.46,b!,a,'b5',{lead:.14,kb:.2,power:1.5});this.fxAt('land',t+.7,h.x(t+.72),0,0,.8,s);
        h.to(t+.7,.1,{pose:'b1',face:s,pop:.1});b!.to(t+.62,.2,{pose:'b0',face:s});this.hit(t+.96,h,b!,'c1',{lead:.16,kb:.32,power:1.4});}},
      {id:'four',ru:'Блоки на две стороны, локоть и кулак',duo:true,d:1.12,run:(t,a,b)=>{
        this.blocked(t+.2,a,h,'b1',{lead:.18,slide:0});this.blocked(t+.36,b!,h,'b1',{lead:.15,slide:0});this.blocked(t+.52,a,h,'b1',{lead:.13,slide:0});this.dodged(t+.7,b!,h,'b5','b1',{lead:.15});
        this.hit(t+.88,h,a,'c4',{lead:.13,kb:.2,recover:false});this.hit(t+1.04,h,b!,'c0',{lead:.13,kb:.24,power:1.2});}},
      {id:'into',ru:'Бросить одного в другого',duo:true,d:1.28,run:(t,a,b)=>{
        const s=this.dir(h,a,t);this.blocked(t+.24,a,h,'b1',{slide:0});const hx=h.x(t+.3),bx=this.in(hx-s*.95,.4);
        b!.to(t+.1,.3,{pose:'b0',face:s,x:bx,z:.12});h.to(t+.3,.14,{pose:'b2',face:s,bend:-.1});h.to(t+.44,.2,{pose:'c1',face:(-s)as Dir});h.to(t+.8,.2,{pose:'b0',face:(-s)as Dir,idle:true});
        a.to(t+.34,.42,{pose:'b3',face:(-s)as Dir,x:bx+s*.2,arc:.58,rot:Math.PI*2*.94,pv:.36,ease:'lin',ghost:true});this.cue(t+.38,'whoosh',1);
        b!.to(t+.74,.06,{pose:'b2',jit:.016});b!.to(t+.8,.26,{pose:'b3',face:s,x:this.in(bx-s*.3),arc:.14,ease:'out'});a.to(t+.76,.2,{pose:'b3',face:s,x:bx+s*.12,arc:.06,pv:0,pop:.1,ease:'out'});
        this.fxAt('hit',t+.75,bx+s*.1,.55,0,1.6,-s);this.fxAt('land',t+.95,bx-s*.1,0,.1,1.4,-s);this.cue(t+.75,'kick',1);this.cue(t+.95,'landing',.9);this.hits+=2;
        this.rise(t+1.06,a,s);this.rise(t+1.12,b!,s);}},
      // ---- short links that keep the rhythm between the larger exchanges
      {id:'m1',ru:'Быстрая двойка',d:.44,run:(t,a)=>{this.hit(t+.2,h,a,'b3',{lead:.17,hold:.04,recover:false});this.hit(t+.34,h,a,'c1',{lead:.1,wind:'b2',kb:.14});}},
      {id:'m2',ru:'Блок и ответ',d:.46,run:(t,a)=>{this.blocked(t+.18,a,h,'b1',{lead:.15});this.hit(t+.37,h,a,'c4',{lead:.12,kb:.14});}},
      {id:'m3',ru:'Нырок и ответ',d:.5,run:(t,a)=>{this.dodged(t+.2,a,h,'b5','b1',{lead:.16});this.hit(t+.41,h,a,'c0',{lead:.13,kb:.16});}},
      {id:'m4',ru:'Удар в блок, удар под блок',d:.48,run:(t,a)=>{this.blocked(t+.18,h,a,'b3',{lead:.15});this.hit(t+.38,h,a,'c2',{lead:.13,kb:.06});}},
      {id:'m5',ru:'Низкий удар',d:.36,run:(t,a)=>{this.hit(t+.24,h,a,'c2',{lead:.2,kb:.08});}},
      {id:'m6',ru:'Блок',d:.3,run:(t,a)=>{this.blocked(t+.19,a,h,'b1',{lead:.16});}},
      // ---- the set takes part
      {id:'stoolThrow',ru:'Чайный дом: бросок табуретом',place:'restaurant',d:1.05,run:(t,a)=>this.thrown(t,a,'stool')},
      {id:'crateThrow',ru:'Порт: бочка катится в соперника',place:'harbor',d:1.1,run:(t,a)=>this.thrown(t,a,'barrel')},
      {id:'fruitThrow',ru:'Рынок: корзина с фруктами',place:'market',d:1.05,run:(t,a)=>this.thrown(t,a,'basket')},
    ];
  }
  private flyHit(t:number,a:Actor,v:Actor,pose:string,o:{from:number;kb:number;power:number;arc:number}){
    const dir=this.dir(a,v,t-o.from),vx=v.x(t),tip=a.sheet[pose].tip,lift=.22,x=this.in(vx-dir*this.gap(a,pose,v,v.hurt,lift),0);
    a.to(t-o.from,o.from,{pose,face:dir,x,y:lift,arc:o.arc,rot:-.16,pv:.4,ease:'lin',ghost:true});
    a.to(t,.07,{pose,face:dir,x,y:lift,rot:-.16});a.to(t+.07,.2,{pose:'b1',face:dir,x,y:0,ease:'in'});a.to(t+.3,.16,{pose:'b0',face:dir,idle:true});
    v.to(t,.07,{pose:v.hurt,face:(-dir)as Dir,jit:.016});v.to(t+.07,.26,{pose:v.hurt,face:(-dir)as Dir,x:this.in(vx+dir*o.kb/v.weight),rot:-.16,ease:'out'});v.to(t+.36,.16,{pose:'b0',face:(-dir)as Dir,idle:true});
    this.fxAt('arc',t-.1,x,tip.dy+lift,.04,o.power,dir,{shape:'line'});this.fxAt('hit',t,x+dir*tip.dx*.97,tip.dy+lift,0,o.power,dir);this.fxAt('sweat',t,x+dir*tip.dx,.85,0,2,dir);this.fxAt('land',t+.27,x,0,0,.7,dir);
    this.cue(t-.24,'whoosh',1);this.cue(t,'kick',1);this.hits++;return {x,dir};
  }
  /** The hero kicks a piece of the set into an opponent. The piece stays where it fell. */
  private thrown(t:number,a:Actor,kind:'stool'|'barrel'|'basket'){
    const h=this.hero,p=this.nearProp(kind);
    if(!p){this.phrases().find(x=>x.id==='slip')!.run(t,a);return;}
    const px=p.track.at(t).x,side:Dir=px>=0?1:-1,dir:Dir=(-side)as Dir,kx=this.in(px-dir*.5,0),low=kind==='barrel';
    // Hero runs around the piece and stands behind it.
    h.to(t,.3,{pose:'c3',face:side,x:kx,arc:.16,ghost:true,ease:'io'});
    a.to(t+.02,.34,{pose:'b0',face:(-dir)as Dir,x:this.in(px+dir*1.02,.3),z:.1,bend:.05});
    const k=t+.52;h.to(t+.34,.12,{pose:low?'b1':'b2',face:dir,bend:-.1});h.to(k-.07,.07,{pose:low?'c2':'b4',face:dir,x:kx+dir*.04,ghost:true,ease:'in'});h.to(k+.14,.16,{pose:'b0',face:dir,idle:true});
    this.fxAt('hit',k,px-dir*.1,low?.2:.35,0,1,dir);this.cue(k,'wood',1);this.cue(k,'kick',.8);
    const hitT=k+(low?.34:.26),ax=a.x(hitT);
    p.track.to(t+.3,.2,{z:.06});
    p.track.to(k,hitT-k,{x:ax-dir*.2,y:low?0:.5,arc:low?.02:.2,rot:(low?9:5)*dir*p.track.at(0).face,pv:low?.23:.15,ease:'lin',ghost:true});
    a.to(hitT,.06,{pose:'b2',face:(-dir)as Dir,jit:.015});a.to(hitT+.06,.24,{pose:'b2',face:(-dir)as Dir,x:this.in(ax+dir*.24),rot:-.18,ease:'out'});a.to(hitT+.34,.16,{pose:'b0',face:(-dir)as Dir,idle:true});
    this.fxAt('hit',hitT,ax-dir*.12,low?.3:.6,0,1.5,dir);this.hits++;this.cue(hitT,'chair',.9);this.smash(hitT,p,dir,low?1.2:.8);
  }
  finishers():Finisher[]{
    const h=this.hero;
    /** Knockout, or the turn of the fight when the server outcome is a loss. */
    const close=(t:number,a:Actor,dir:Dir,won:boolean,o:{dist?:number;height?:number;spin?:number;power?:number;text?:string}={})=>{
      if(!won){this.lose(t,a,dir);return;}
      a.down=true;const last=this.foes.every(f=>f.down),slow=last?(this.o.status==='complete'?1.8:1.4):1.08;
      const land=this.launch(t,a,dir,(o.dist??.75)*.92,(o.height??.34)*.8,slow,{spin:o.spin,stop:last?.13:.08});
      if(last){this.fxAt('kanji',t+.03,h.x(t),1.2,0,1,dir,{text:o.text??'拳'});this.fxAt('lines',t,a.x(t),.6,0,1,dir);this.cam(t-.02,.16,(h.x(t)+a.x(t))/2,1.2);this.cam(t+.5,.5,0,1);}
      const p=this.props.filter(q=>!q.broken&&q.kind!=='cart'&&Math.abs(q.track.at(land).x-a.x(land))<.34)[0];
      if(p&&dir*p.track.at(land).x>0)this.smash(land-.02,p,dir,1.3);
    };
    const strike=(id:string,ru:string,text:string,pose:string,o:{wind?:string;lead?:number;power?:number;dist?:number;height?:number;spin?:number;shape?:Fx['shape'];pre?:(t:number,a:Actor)=>void}):Finisher=>({id,ru,text,lead:.45,run:(t,a,won)=>{
      o.pre?.(t,a);const v=a.at(t),r=this.hit(t,h,a,pose,{wind:o.wind,lead:o.lead??.24,power:o.power??2,hold:.4,kb:.1,shape:o.shape,quiet:!won,...(won?{}:{hurt:'b7'})});void v;
      close(t,a,r.dir,won,{...o,text});}});
    return [
      {id:'flying',ru:'Удар ногой в прыжке',text:'脚',lead:.6,run:(t,a,won)=>{
        const dir=this.dir(h,a,t-.55);h.to(t-.56,.2,{pose:'b5',face:(-dir)as Dir,x:this.in(h.x(t-.56)-dir*.3),ghost:true});h.to(t-.36,.08,{pose:'b1',face:dir,pop:.1});
        const r=this.flyHit(t,h,a,won?'b4':'b4',{from:.28,kb:.1,power:2.2,arc:.3});close(t,a,r.dir,won,{dist:1,height:.42,text:'脚'});}},
      strike('spin','Пятка с разворота','脚','c5',{wind:'c0',lead:.3,dist:.95,height:.36,spin:.9,pre:(t,a)=>{const d=this.dir(h,a,t-.5);h.to(t-.48,.16,{pose:'b2',face:d});h.to(t-.34,.06,{pose:'c0',face:(-d)as Dir});}}),
      strike('knee','Колено в прыжке','脚','c3',{wind:'b1',lead:.3,dist:.6,height:.5,spin:1.1}),
      strike('upper','Локоть снизу вверх','拳','c4',{wind:'b1',lead:.26,dist:.4,height:.72,spin:1.6,shape:'up'}),
      strike('palm','Удар ладонью','掌','c1',{wind:'b2',lead:.3,dist:1.15,height:.18,spin:.2}),
      strike('backfist','Кулак наотмашь','拳','c0',{wind:'b2',lead:.26,dist:.6,height:.32,spin:3.4}),
      strike('side','Высокий удар ногой','脚','b4',{wind:'b1',lead:.28,dist:.9,height:.34}),
      strike('flurryEnd','Серия и прямой','拳','b3',{wind:'b2',lead:.12,dist:.9,height:.26,pre:(t,a)=>{['c1','c0','c1'].forEach((p,i)=>this.hit(t-.42+i*.11,h,a,p,{lead:i?.08:.14,hold:.03,kb:.03,recover:false,wind:'c4'}));}}),
      strike('sweepUp','Подсечка и удар в воздухе','脚','b4',{wind:'b1',lead:.15,dist:.85,height:.3,pre:(t,a)=>{const r=this.hit(t-.34,h,a,'c2',{lead:.16,kb:0});a.to(t-.28,.4,{pose:'b3',face:(-r.dir)as Dir,arc:.3,rot:-.6,pv:.3,ease:'lin'});}}),
      {id:'throwEnd',ru:'Бросок в завершение',text:'投',lead:.55,run:(t,a,won)=>{
        const dir=this.dir(h,a,t-.5);this.blocked(t-.28,a,h,'b1',{lead:.18,slide:0});h.to(t-.16,.12,{pose:'b2',face:dir,bend:-.1});
        if(won){h.to(t,.2,{pose:'c1',face:(-dir)as Dir});h.to(t+.4,.2,{pose:'b0',face:(-dir)as Dir,idle:true});this.fxAt('hit',t,h.x(t)+dir*.3,.6,0,1.4,dir);this.cue(t,'kick',.9);this.hits++;close(t,a,(-dir)as Dir,true,{dist:1.25,height:.55,spin:5.6,text:'投'});}
        else close(t,a,dir,false);}},
      {id:'chair',ru:'Чайный дом: удар стулом',text:'破',place:'restaurant',prop:'chair',lead:.8,run:(t,a,won)=>{
        const p=this.nearProp('chair')!,px=p.track.at(0).x,dir:Dir=px>0?-1:1,x=this.in(px,.3);
        h.to(t-.8,.28,{pose:'b5',face:px>h.x(t-.8)?1:-1,x,ghost:true,ease:'io'});h.to(t-.5,.18,{pose:'f0',face:dir,x});h.to(t-.3,.12,{pose:'f1',face:dir,x:x-dir*.04,bend:-.06});
        p.track.to(t-.52,.02,{alpha:0});
        const g=this.gap(h,'f3',a,'b2');a.to(t-.62,.4,{pose:'b0',face:(-dir)as Dir,x:this.in(x+dir*(g+.05)),z:.06,bend:.06});a.to(t-.2,.12,{pose:'b0',face:(-dir)as Dir});
        h.to(t-.08,.08,{pose:'f3',face:dir,x:this.in(a.x(t)-dir*g,0),ghost:true,ease:'in'});h.to(t+.05,.2,{pose:'b3',face:dir});h.to(t+.3,.16,{pose:'b0',face:dir,idle:true});
        const cx=a.x(t)-dir*.2;p.track.to(t,.02,{x:cx-dir*.05,z:.3,alpha:1,pose:'p3',y:0});p.broken=true;this.fxAt('wood',t,cx,.62,0,1.5,dir);this.fxAt('hit',t,cx,.62,0,2,dir);this.cue(t,'chair',1);this.cue(t,'crash',1);this.hits++;
        a.to(t-.001,.02,{pose:won?'b2':'b7',face:(-dir)as Dir});close(t,a,dir,won,{dist:.7,height:.3,text:'破'});}},
      {id:'table',ru:'Чайный дом: прыжок через стол',text:'脚',place:'restaurant',prop:'table',lead:.8,run:(t,a,won)=>this.vault(t,a,won,'table','f4',close)},
      {id:'stool',ru:'Чайный дом: удар с табурета',text:'脚',place:'restaurant',prop:'stool',lead:.8,run:(t,a,won)=>this.vault(t,a,won,'stool','f5',close)},
      {id:'barrel',ru:'Порт: бочка сбивает с ног',text:'破',place:'harbor',prop:'barrel',lead:.95,run:(t,a,won)=>this.roller(t,a,won,'barrel',close)},
      {id:'cart',ru:'Рынок: тележка на полном ходу',text:'破',place:'market',prop:'cart',lead:.95,run:(t,a,won)=>this.roller(t,a,won,'cart',close)},
      {id:'basket',ru:'Рынок: фрукты в лицо',text:'破',place:'market',prop:'basket',lead:.95,run:(t,a,won)=>this.roller(t,a,won,'basket',close)},
    ];
  }
  private vault(t:number,a:Actor,won:boolean,kind:'table'|'stool',pose:string,close:(t:number,a:Actor,dir:Dir,won:boolean,o?:any)=>void){
    const h=this.hero,p=this.nearProp(kind)!,px=p.track.at(0).x,dir:Dir=px>0?-1:1,x=this.in(px,.36),g=this.gap(h,pose,a,'b2');
    a.to(t-.8,.5,{pose:'b0',face:(-dir)as Dir,x:this.in(x+dir*g),z:.06,bend:.05});a.to(t-.28,.1,{pose:'b0',face:(-dir)as Dir});
    h.to(t-.8,.4,{pose:'b5',face:px>h.x(t-.8)?1:-1,x:this.in(x-dir*.3,0),ghost:true});h.to(t-.38,.14,{pose:'b1',face:dir,bend:-.06});
    h.to(t-.22,.2,{pose,face:dir,x,ghost:true,ease:'out'});p.track.to(t-.22,.02,{alpha:0});h.to(t+.22,.2,{pose:'b1',face:dir,x:x+dir*.12});h.to(t+.44,.2,{pose:'b0',face:dir,idle:true});p.track.to(t+.22,.02,{x,z:.4,alpha:1});
    const tip=h.sheet[pose].tip;this.fxAt('arc',t-.1,x,tip.dy,0,2,dir,{shape:'up'});if(won)this.fxAt('hit',t,x+dir*tip.dx,tip.dy,0,2,dir);this.cue(t-.22,'wood',1);this.cue(t-.14,'whoosh',.8);this.cue(t,'kick',1);this.hits++;
    close(t,a,dir,won,{dist:.7,height:.36,text:'脚'});
  }
  private roller(t:number,a:Actor,won:boolean,kind:'barrel'|'cart'|'basket',close:(t:number,a:Actor,dir:Dir,won:boolean,o?:any)=>void){
    const h=this.hero,p=this.nearProp(kind)!,px=p.track.at(0).x,dir:Dir=px>0?-1:1,kx=this.in(px-dir*.42,-.1),k=t-.36,low=kind!=='basket',face:Dir=p.track.at(0).face;
    a.to(t-.95,.5,{pose:'b0',face:(-dir)as Dir,x:this.in(px+dir*1.06,.3),z:.08});
    h.to(t-.95,.36,{pose:'c3',face:px>h.x(t-.95)?1:-1,x:kx,arc:.22,ghost:true});h.to(k-.2,.12,{pose:'b2',face:dir,bend:-.1});
    h.to(k-.07,.07,{pose:kind==='cart'?'c1':kind==='barrel'?'b4':'b4',face:dir,x:kx+dir*.08,ghost:true,ease:'in'});h.to(k+.14,.14,{pose:'b0',face:dir});h.to(k+.28,.3,{pose:'b0',face:dir,idle:true,x:this.in(kx+dir*.5),bend:.04});
    this.fxAt('hit',k,px-dir*.14,.35,0,1.2,dir);this.cue(k,'kick',.9);this.cue(k+.02,'wood',1);this.hits++;
    const ax=a.x(t),pw=kind==='cart'?.4:.18;
    p.track.to(k-.3,.25,{z:.06});
    p.track.to(k,t-k,{x:ax-dir*pw,y:kind==='basket'?.62:0,arc:kind==='basket'?.16:.02,rot:kind==='cart'?0:(kind==='barrel'?8:4)*dir*face,pv:kind==='cart'?0:.23,ease:'lin',ghost:true});
    this.fxAt('dust',k+.12,lerp(px,ax,.4),0,0,1,dir);this.fxAt('hit',t,ax-dir*.1,kind==='basket'?.7:.35,0,2,dir);this.cue(t,'chair',1);this.hits++;
    a.to(t-.06,.05,{pose:won?'b2':'b7',face:(-dir)as Dir});
    if(kind==='cart'){if(won)p.track.to(t,.7,{x:this.in(ax+dir*.5,.3),ease:'out'});else p.track.to(t,.2,{x:ax-dir*(pw+.15),ease:'out'});}
    else this.smash(t,p,dir,1.4);
    close(t,a,dir,won,{dist:.7,height:kind==='cart'?.5:.36,text:'破'});
  }
  /** The last contact is stopped, the answer sends the hero across the set. */
  private lose(t:number,a:Actor,dir:Dir){
    const h=this.hero,s=h.at(t),back:Dir=(-dir)as Dir,ax=a.x(t);
    a.to(t-.07,.06,{pose:'b7',face:back,x:ax});a.to(t,.12,{pose:'b7',face:back,x:ax+dir*.05,bend:-.06});
    this.fxAt('block',t,ax-dir*.15,.7,0,1.6,dir);this.cue(t,'block',1);
    h.to(t+.05,.14,{pose:'b6',face:dir,x:this.in(s.x),y:0,ease:'out'});
    const p=a.kind==='agile'||a.kind==='master'?'b5':'b1',c=t+.32,g=this.gap(a,p,h,'b6');
    a.to(t+.12,.13,{pose:'b0',face:back,bend:-.14,x:this.in(h.x(c)+dir*(g+.08),-.2)});a.to(c-.07,.07,{pose:p,face:back,x:this.in(h.x(c)+dir*g,-.2),bend:.1,ghost:true,ease:'in'});a.to(c,.3,{pose:p,face:back});a.to(c+.3,.3,{pose:'b0',face:back,idle:true});
    const tip=a.sheet[p].tip;this.fxAt('arc',c-.07,a.x(c),tip.dy,0,2,back,{shape:p==='b5'?'up':'line'});this.fxAt('hit',c,a.x(c)-dir*tip.dx,tip.dy,0,2.2,back);this.fxAt('sweat',c,h.x(c),.85,0,2,back);this.cue(c-.14,'whoosh',1);this.cue(c,'punch',1);
    const x0=h.x(c),x1=clamp(x0+back*.95,-this.L+.45,this.L-.45),land=c+.1+.42;
    h.to(c,.1,{pose:'b6',face:dir,jit:.018});
    h.to(c+.1,.42,{pose:'c7',face:dir,x:lerp(x0,x1,.85),arc:.3,rot:-1.3,pv:.3,ease:'lin',ghost:true,z:.02});
    h.to(land,.14,{pose:'c7',face:dir,x:x1,arc:.06,rot:-1.4,pv:.3,ease:'out',z:.02});
    const q=this.props.filter(p=>!p.broken&&p.kind!=='cart').sort((m,n)=>Math.abs(m.track.at(land).x-x1)-Math.abs(n.track.at(land).x-x1))[0];
    if(q&&Math.abs(q.track.at(land).x-x1)<.7)this.smash(land-.03,q,back,1.3);
    this.fxAt('land',land,x1,0,.2,1.8,back);this.cue(land,'landing',1);this.cam(c-.1,.25,(x0+x1)/2,1.14);this.cam(land+.3,.5,0,1);
    // The winner backs off, so both faces stay readable, and nobody rests outside the frame.
    const edge=Math.max(.5,Math.min(this.L,this.o.W)),side:Dir=x1>0?-1:1,ax1=clamp(x1+side*1.05,-edge+.35,edge-.35);
    a.to(land+.3,.45,{pose:'b0',face:(-side)as Dir,x:ax1,z:.12}).to(land+.76,.2,{pose:'b0',face:(-side)as Dir,x:ax1,idle:true});
    h.to(land+.34,.24,{pose:'b1',face:(side)as Dir,x:x1,rot:0,pv:.2});h.to(land+.72,.2,{pose:'b6',face:(side)as Dir,x:x1});h.to(land+1.2,.2,{pose:'b7',face:(side)as Dir,x:x1,idle:true});
    this.foes.forEach((f,i)=>{const fx=f.x(land+.3),room=Math.max(.35,edge-.4);if(f.down&&Math.abs(fx)>room)f.to(land+.3,.3,{pose:'b6',x:Math.sign(fx)*(room-.04*i),idle:true,z:f.at(land).z});if(!f.down&&f!==a){f.to(land,.3,{pose:'b0',idle:true,x:this.in(f.x(land)+(i%2?.06:-.06))});}});
  }
  // ---- composition
  private compose(){
    const {o}=this,n=o.lineup.length,won=o.status!=='lost',h=this.hero;
    const usedP=new Set<string>(),fin=this.finishers(),all=this.phrases();
    if(o.only){const f=fin.find(x=>x.id===o.only),p=all.find(x=>x.id===o.only);
      if(p){this.say(.5,p.ru);p.run(.5,this.foes[0],this.foes[1]);this.say(.5,p.ru);}
      if(f){this.say(contactAt(0)-f.lead,f.ru);f.run(contactAt(0),this.foes[0],won);this.foes.slice(1).forEach(x=>x.down=true);}
      this.reveal=f?contactAt(0)+1.12:.5+p!.d+.5;return;}
    const pickFrom=<T,>(list:T[])=>list[Math.floor(this.r()*list.length)];
    this.cam(-1,.1,0,1);
    for(let i=0;i<n;i++){
      const a=this.foes[i],c=contactAt(i),start=i?contactAt(i-1)+.34:(o.fightIndex?.46:.22);
      const allowed=fin.filter(f=>(!f.place||f.place===o.location)&&(!f.prop||this.nearProp(f.prop)));
      // Every third finishing move uses the set when the set has something left.
      const set=allowed.filter(f=>f.prop),body=allowed.filter(f=>!f.prop);
      let pool=(set.length&&this.r()<(n===1?.28:.42))?set:body;
      if(!pool.filter(f=>!usedP.has(f.id)).length)pool=body;
      const f=pickFrom(pool.filter(f=>!usedP.has(f.id)));usedP.add(f.id);
      const until=c-f.lead-.04,phr:Phrase[]=[];let left=until-start;
      for(let guard=0;guard<30;guard++){
        const mate=this.foes.find((m,j)=>j>i&&!m.down);
        const links=all.filter(p=>/^m\d$/.test(p.id)),linkNow=phr.length%2===1;
        let options=all.filter(p=>(linkNow?/^m\d$/.test(p.id):!/^m\d$/.test(p.id))&&!usedP.has(p.id)&&p.d<=left&&(!p.duo||mate)&&(!p.only||p.only===a.kind)&&(!p.place||p.place===o.location));
        // A piece promised to the finishing move stays whole until then.
        options=options.filter(p=>!(f.prop&&{stoolThrow:'stool',crateThrow:'barrel',fruitThrow:'basket'}[p.id]===f.prop));
        if(!options.length)options=links.filter(p=>p.d<=left&&phr.at(-1)?.id!==p.id);
        if(!options.length)break;
        const duo=options.filter(p=>p.duo),own=options.filter(p=>p.only);
        const p=duo.length&&!phr.some(x=>x.duo)&&this.r()<.8?pickFrom(duo):own.length&&!phr.some(x=>x.only)&&this.r()<.5?pickFrom(own):pickFrom(options);
        phr.push(p);usedP.add(p.id);left-=p.d;
      }
      let t=start;const pause=Math.max(0,left)/(phr.length+1);
      for(const p of phr){
        t+=pause;const mate=this.foes.find((m,j)=>j>i&&!m.down);
        // The partner closes in or circles so that the group never queues.
        this.cam(t,.4,clamp((h.x(t)+a.x(t))/2,-.35,.35),n===1?1.12:1.06);
        this.say(t,p.ru);p.run(t,a,mate);
        if(!p.duo)for(const m of this.foes)if(m!==a&&!m.down)this.circle(t,p.d,m);
        t+=p.d;
      }
      t+=pause;this.say(c-f.lead,f.ru);this.cam(c-f.lead,.4,clamp((h.x(c-f.lead)+a.x(c-f.lead))/2,-.4,.4),1.08);
      const last=i===n-1;
      f.run(c,a,won||!last);
      for(const m of this.foes)if(m!==a&&!m.down&&!last)this.circle(c-f.lead,f.lead+.3,m);
    }
    if(won)this.finale();
  }
  /** Waiting opponents feint, shift and stay on the hero's other side. */
  private circle(t:number,d:number,m:Actor){
    const h=this.hero,hx=h.x(t),mx=m.x(t);let side:Dir=mx>=hx?1:-1;
    // Never queue: cross behind the hero when one side is empty.
    const others=this.foes.filter(f=>f!==m&&!f.down),free=!others.some(f=>(f.x(t)>=hx?1:-1)!==side);
    if(others.length&&free){side=(-side)as Dir;m.to(t+.02,.3,{pose:'b0',face:side,x:hx,z:.9,bend:.1});}
    const want=this.in(hx+side*(1.02+.2*this.r()),.1);
    m.to(t+(others.length&&free?.32:.05),.3,{pose:'b0',face:(-side)as Dir,x:want,z:.5,bend:.04});
    m.to(t+.63,.14,{pose:this.r()<.5?'b7':'b1',face:(-side)as Dir,x:want-side*.06});
    m.to(t+.8,Math.max(.1,d-.8),{pose:'b0',face:(-side)as Dir,x:want,idle:true});
  }
  private finale(){
    const h=this.hero,t=this.reveal,edge=Math.max(.5,Math.min(this.L,this.o.W)),x=clamp(h.x(t-.1),-edge+.5,edge-.5);
    // Everyone stays inside the frame while the player decides.
    if(this.o.status!=='complete'){const room=Math.max(.35,edge-.4);this.foes.forEach((f,i)=>{const fx=f.x(t+.3);if(Math.abs(fx)>room)f.to(t+.3,.3,{pose:'b6',x:Math.sign(fx)*(room-.04*i),idle:true,z:f.at(t).z});});}
    if(this.o.status==='complete'){
      h.to(t-.1,.4,{pose:'b7',x:0,face:1,z:0});h.to(t+.32,.9,{pose:'f6',x:0,face:1,arc:.06});h.to(t+1.2,.8,{pose:'f7',x:0,face:1,bend:.04});h.to(t+2.05,.3,{pose:'f6',x:0,face:1,idle:true});
      this.cam(t,.6,0,1.12);this.foes.forEach((f,i)=>{const side=i%2?-1:1;const fx=side*Math.max(.45,Math.min(.66+(i>1?.42:0),edge-.36));f.to(t+.1,.5,{pose:'b4',x:fx,face:(-side)as Dir,z:i>1?.95:.5}).to(t+.62,.2,{pose:'b6',x:fx,idle:true});});
      return;
    }
    const pose=['f6','f7','b7'][Math.floor(this.r()*3)];
    h.to(t-.12,.16,{pose,x,face:1,z:0});h.to(t+.62,.2,{pose:'b0',x,face:1,idle:true});
  }
}
export {smooth};
