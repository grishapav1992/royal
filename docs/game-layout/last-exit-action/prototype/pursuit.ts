import {clamp,mix,rng} from './kit';
/** Cosmetic rigid bodies on the road plane. Nothing here reads a deadline, a seed or an outcome. */
export type State='drive'|'spin'|'air'|'slide';
export type Car={id:number;kind:'cop'|'civ';side:number;tint:number;x:number;z:number;y:number;vx:number;v:number;vy:number;yaw:number;w:number;roll:number;wr:number;state:State;tx:number;tz:number;hold:number;hw:number;brake:number;lights:number;burn:number;damage:number;cool:number;age:number;nose:number;hop:boolean;free:boolean};
export type Prop={kind:'board'|'cone';x:number;z:number;w:number;broken:boolean};
export type Hero={x:number;vx:number;hw:number;z:number;bias:number};
export type Fx={
 hit(x:number,y:number,z:number,power:number,side:number):void;
 scrape(x:number,z:number,side:number,power:number):void;
 contact(c:Car,power:number):void;
 wreck(c:Car):void;
 boom(x:number,z:number,size:number,v:number):void;
 smash(p:Prop,v:number):void;
 hero(power:number):void;
};
export const LEN=.44,WALL=1.13,GRAV=3.1;
type Ev={type:string;t:number;c?:Car;d?:Car;side:number;done:boolean};

export class Pursuit {
 cars:Car[]=[];props:Prop[]=[];laneX=.565;private next=1.4;private ev?:Ev;private id=0;private r=rng(1);private respawn=[0,0];private bag:string[]=[];slow=0;force='';/** Endings stage their own flips. */calm=false;private flow=0;private lastSlow=-9;private time=0;count=0;
 constructor(private fx:Fx){}
 reset(seed:number){this.cars=[];this.props=[];this.next=.5;this.ev=undefined;this.r=rng(seed*7919+13);this.respawn=[0,0];this.bag=[];this.slow=0;this.lastSlow=-9;this.time=0;this.count=0;this.calm=false;}
 rand(a=0,b=1){return a+this.r()*(b-a);}
 make(kind:'cop'|'civ',o:Partial<Car>):Car{const c:Car={id:++this.id,kind,side:0,tint:0,x:0,z:1,y:0,vx:0,v:0,vy:0,yaw:0,w:0,roll:0,wr:0,state:'drive',tx:0,tz:1.06,hold:0,hw:.13,brake:0,lights:1,burn:0,damage:0,cool:0,age:0,nose:0,hop:false,free:false,...o};this.cars.push(c);return c;}
 cop(side:number){return this.cars.find(c=>c.kind==='cop'&&c.side===side&&c.state==='drive');}
 /** Lost patrols are replaced from behind the camera. */
 ensure(flow:number,hw:number,dt:number,at=1.06){for(const i of [0,1]){const side=i?1:-1;if(this.cop(side)){this.respawn[i]=0;continue;}this.respawn[i]+=dt;if(this.respawn[i]>1.25)this.make('cop',{side,x:side*this.laneX,z:.58,v:flow+5,tx:side*this.laneX,tz:at,hw});}}
 private big(){if(this.time-this.lastSlow>6.5){this.lastSlow=this.time;this.slow=.6;}}
 trip(c:Car,dir:number,power=1){if(c.state==='air')return;c.state='air';c.vy=this.rand(.75,1.05)*power;c.wr=(dir||1)*this.rand(7,10)*power;c.lights=0;c.yaw=(Math.sign(c.yaw)||dir||1)*1.55;c.w=0;c.hop=true;c.v=Math.max(c.v,this.flow-2.4);this.count++;this.fx.wreck(c);}
 spin(c:Car,w:number){if(c.state!=='drive')return;c.state='spin';c.w=w;c.brake=1;}
 private damage(c:Car,s:number,dir:number){if(this.calm&&c.free)return;c.damage+=s;if(c.state==='drive'&&(s>.85||c.damage>2.4))this.spin(c,dir*this.rand(2.2,4)*Math.min(1.4,s+.3));}
 private collide(a:Car,b:Car){
  if(Math.abs(a.y-b.y)>.3||this.calm&&(a.kind==='civ'||b.kind==='civ'||a.free||b.free))return;const ha=a.hw*(1+.9*Math.abs(Math.sin(a.yaw))),hb=b.hw*(1+.9*Math.abs(Math.sin(b.yaw)));
  const dx=b.x-a.x,dz=b.z-a.z,W=ha+hb,L=LEN*(1-.25*Math.abs(Math.sin(a.yaw))),px=W-Math.abs(dx),pz=L-Math.abs(dz);if(px<=0||pz<=0)return;
  const sx=Math.sign(dx)||1,sz=Math.sign(dz)||1;
  if(px/W<pz/L){a.x-=sx*px/2;b.x+=sx*px/2;const vr=(a.vx-b.vx)*sx;if(vr<=0)return;const j=vr*.5*1.45;a.vx-=sx*j;b.vx+=sx*j;const s=vr/1.1;
   if(a.cool<=0||b.cool<=0){this.fx.hit((a.x+b.x)/2,.15,(a.z+b.z)/2,s,sx);a.cool=b.cool=.16;}
   a.w-=sx*sz*s*.9;b.w+=sx*sz*s*.9;this.damage(a,s,-sx);this.damage(b,s,sx);
  }else{a.z-=sz*pz/2;b.z+=sz*pz/2;const vr=(a.v-b.v)*sz;if(vr<=0)return;const j=vr*.5*1.3;a.v-=sz*j;b.v+=sz*j;const s=vr/6.5;
   if(a.cool<=0||b.cool<=0){this.fx.hit((a.x+b.x)/2,.17,(a.z+b.z)/2,s*1.2,sx);a.cool=b.cool=.16;}
   const off=dx/W;a.w-=off*s*4;b.w+=off*s*4+this.rand(-1,1)*s;a.vx-=off*s*.8+(a.kind==='cop'?this.rand(-.2,.2)*s:0);b.vx+=off*s*.8;
   this.damage(a,s,-sx);this.damage(b,s,sx);
   if(s>1.15&&!this.calm){for(const c of [a,b])if(c.state!=='air'&&this.rand()<.85)this.trip(c,c===a?-sx:sx,clamp(s,.8,1.35));if(s>1.4)this.fx.boom((a.x+b.x)/2,Math.max(a.z,b.z),.8,Math.max(a.v,b.v));this.big();}
  }
 }
 private heroCollide(h:Hero,c:Car,flow:number){
  if(c.y>.3)return;const hc=c.hw*(1+.9*Math.abs(Math.sin(c.yaw))),dx=c.x-h.x,dz=c.z-h.z,W=h.hw+hc,px=W-Math.abs(dx),pz=LEN-Math.abs(dz);if(px<=0||pz<=0)return;const sx=Math.sign(dx)||1;
  if(px/W<pz/LEN||dz<-.1){const vr=(h.vx-c.vx)*sx;c.x+=sx*px*.8;h.x-=sx*px*.2;if(vr<=0)return;const s=vr/1;c.vx+=sx*vr*1.15;h.vx-=sx*vr*.42;
   if(c.cool<=0){this.fx.hit(h.x+sx*h.hw,.14,h.z-.02,s,sx);this.fx.hero(s);c.cool=.14;}
   c.w+=sx*s*.4;c.damage+=s*.5;if(c.state==='drive'&&s>1.5)this.spin(c,sx*3);
  }else{// the coupe rams a patrol from behind
   c.z=h.z+LEN;const s=clamp((flow-c.v)/6+.7,.7,2);c.v=flow+2.3*s;c.vx+=(dx/W||.3)*1.0*s+sx*.42;this.fx.hit((h.x+c.x)/2,.18,h.z+.2,s*1.3,sx);this.fx.hero(s*1.4);
   c.w+=sx*(2.2+s);if(c.state==='drive')c.state='spin';c.brake=0;c.damage+=s;if(s>.85&&c.state!=='air'){this.trip(c,sx,.95);this.big();}c.cool=.4;}
 }
 private event(dt:number,h:Hero,flow:number,value:number){
  h.bias=0;if(!this.ev){this.next-=dt;if(this.next>0)return;
   const heat=value>=4?2:value>=2?1:0,menu=[['swipe','traffic','wall','board','block'],['wall','pincer','block','traffic','board','pileup'],['block','pincer','wall','traffic','board','pileup']][heat];
   if(!this.bag.length){this.bag=[...menu];for(let i=this.bag.length-1;i>0;i--){const j=Math.floor(this.r()*(i+1));[this.bag[i],this.bag[j]]=[this.bag[j],this.bag[i]];}}
   const L=this.cop(-1),R=this.cop(1);if(!L||!R){this.next=.3;return;}
   const side=this.r()<.5?-1:1;this.ev={type:this.force||this.bag.pop()!,t:0,c:side<0?L:R,d:side<0?R:L,side,done:false};this.start(this.ev,flow,h);}
  const e=this.ev;e.t+=dt;const c=e.c!,t=e.t,s=e.side,lane=this.laneX;
  const end=(gap=0)=>{this.ev=undefined;const heat=value>=4?2:value>=2?1:0;this.next=gap+[.75,.5,.28][heat]*this.rand(.7,1.5);for(const k of this.cars)if(k.kind==='cop'&&k.state==='drive'){k.tx=k.side*lane;k.tz=1.06;k.hold=0;k.nose=0;k.brake=0;}};
  if(c.state!=='drive'&&(e.type!=='traffic'&&e.type!=='pileup')){if(t>9||!this.cars.includes(c)||c.age>0&&(e as any).out>0.5){end();return;}(e as any).out=((e as any).out??0)+dt;}
  switch(e.type){
   case 'swipe':{const contact=h.x+s*(h.hw+c.hw-.03);c.hold=1;c.nose=t<1.5?-s*.3:0;c.tx=t<.35?lane*s*1.06:t<.75?contact-s*.12:t<1.0?lane*s:t<1.5?contact-s*.16:lane*s;if(t>.7&&t<.95||t>1.35&&t<1.7)h.bias=s*.16;if(t>2)end();break;}
   case 'wall':{const contact=h.x+s*(h.hw+c.hw-.03);c.hold=1;c.nose=t<.8?-s*.3:0;c.tx=t<.8?contact-s*.12:contact;if(t>.75&&t<2.1)h.bias=s*.95;
    if(t>.75&&Math.abs(c.x)>WALL-c.hw-.02&&c.state==='drive'){c.age+=0;if(!e.done){e.done=true;}c.damage+=dt*2.6;if(c.damage>1.6){c.yaw=-s*.5;c.w=-s*3;c.v=flow+3;c.vx=-s*.2;this.trip(c,-s,1.05);this.big();}}
    if(t>2.6)end();break;}
   case 'block':{if(t<1.15){c.tz=2.7;c.tx=t<.55?s*lane:h.x+s*.15;}else{c.tz=1.2;c.tx=h.x+s*.15;c.brake=1;h.bias=-s*.1;}c.hold=1;if(t>3.6)end();break;}
   case 'pincer':{const d=e.d!;h.bias=-s*.34;for(const k of [c,d]){k.tz=2.05;k.hold=1;k.tx=t<.85?k.side*.5:-k.side*.2+s*.16;k.nose=t>.7?-k.side*.5:0;}
    if(t>.85&&(c.state!=='drive'||d.state!=='drive')&&!e.done){e.done=true;for(const k of [c,d]){if(k.state==='drive')this.spin(k,k.side*-3);k.v=flow+2.2;}this.big();const k=this.r()<.5?c:d;this.trip(k,k.side,.95);}
    if(t>2.4)end();break;}
   case 'traffic':case 'pileup':{// a pursuing patrol overtakes into slower traffic
    if(t<1.1){c.tz=2.3;c.tx=s*lane*.92;c.hold=1;}if(t>3.4)end();break;}
   case 'board':{if(t>2.2)end();break;}
  }
 }
 private start(e:Ev,flow:number,h:Hero){
  const s=e.side,lane=this.laneX;
  if(e.type==='traffic'){this.make('civ',{x:s*lane*.92,z:26,v:flow*.52,tx:s*lane*.92,hw:h.hw*.86,tint:1+Math.floor(this.r()*3)});if(this.r()<.6)this.make('civ',{x:-s*.18,z:34,v:flow*.56,tx:-s*.18,hw:h.hw*.86,tint:1+Math.floor(this.r()*3)});}
  if(e.type==='pileup'){for(const [x,z] of [[s*lane*.92,24],[s*.1,31],[-s*lane*.9,38]])this.make('civ',{x,z,v:flow*.5,tx:x,hw:h.hw*.86,tint:1+Math.floor(this.r()*3)});}
  if(e.type==='board'){const x=h.x*.4;this.props.push({kind:'board',x,z:32,w:.5,broken:false});for(let i=0;i<6;i++)this.props.push({kind:'cone',x:x+(i-2.5)*.15,z:29+(i%2)*1.4,w:.05,broken:false});}
 }
 /** Lateral space the coupe would like. Obstacles repel it long before contact. */
 wish(h:Hero,base:number){let best=base,bc=9e9;for(let x=-.6;x<=.601;x+=.1){let cost=Math.abs(x-base)*.55+Math.abs(x-h.x)*.22;for(const c of this.cars){if(c.kind==='cop'&&c.state==='drive')continue;if(c.z<h.z+.1||c.z>13)continue;const o=h.hw+c.hw*1.3+.06-Math.abs(x-c.x-c.vx*.25);if(o>0)cost+=o*(14/Math.max(1.2,c.z-h.z));}if(cost<bc){bc=cost;best=x;}}return clamp(best+h.bias,-.8,.8);}
 step(dt:number,flow:number,h:Hero,value:number,mode:'race'|'scene'|'off'){
  this.time+=dt;this.flow=flow;if(mode==='race'){this.event(dt,h,flow,value);}else h.bias=0;
  for(const c of this.cars){c.age+=dt;c.cool-=dt;
   if(c.state==='drive'){
    if(c.kind==='cop'){const ax=(c.tx-c.x)*(c.hold?34:15)-c.vx*(c.hold?8:6.2);c.vx+=ax*dt;const tv=flow+clamp((c.tz-c.z)*3.4,-11,9);c.v+=(tv-c.v)*Math.min(1,dt*(this.calm?15:5));c.yaw=mix(c.yaw,clamp(c.vx*.16,-.22,.22)+c.nose,Math.min(1,dt*9));c.w=0;}
    else{const ax=(c.tx-c.x)*6-c.vx*4;c.vx+=ax*dt;c.yaw=0;}
   }else if(c.state==='spin'){c.yaw+=c.w*dt;c.w*=Math.exp(-dt*.9);c.vx*=Math.exp(-dt*1.2);c.v-=Math.sign(c.v)*(3.5+7*Math.abs(Math.sin(c.yaw)))*dt;c.v=Math.max(0,c.v);if(Math.abs(c.yaw)>1.5){c.yaw=Math.sign(c.yaw)*1.55;if(c.v>9&&!this.calm)this.trip(c,Math.sign(c.yaw)||1,.9);else{c.w=0;c.state='slide';c.roll=0;}}if(c.v<1&&Math.abs(c.w)<.3)c.w=0;}
   else if(c.state==='air'){c.vy-=GRAV*dt;c.y+=c.vy*dt;c.roll+=c.wr*dt;if(c.y<=0&&c.vy<0){const p=-c.vy;c.y=0;this.fx.contact(c,p);c.vy=p*.46;c.v=Math.max(0,c.v-.9-c.v*.035);c.vx*=.82;c.wr*=.86;if(c.vy<.2){c.state='slide';c.roll=Math.round(c.roll/Math.PI)*Math.PI;}}}
   else{c.y=0;c.v=Math.max(0,c.v-8*dt);c.vx*=Math.exp(-dt*3);}
   c.x+=c.vx*dt;c.z+=(c.v-flow)*dt;
   const lim=WALL-c.hw;if(!c.free&&Math.abs(c.x)>lim&&Math.abs(c.x)<WALL+.12&&c.y<.15){const sd=Math.sign(c.x),vi=c.vx*sd;c.x=sd*lim;if(vi>0){if(vi>.35){this.fx.hit(sd*WALL,.1,c.z,vi*1.1,sd);this.fx.scrape(sd*WALL,c.z,sd,1.5);c.damage+=vi;if(c.state==='spin'&&vi>.7&&!this.calm)this.trip(c,-sd,.8);}c.vx=-vi*sd*.4;}this.fx.scrape(sd*WALL,c.z,sd,.5);}
  }
  for(let i=0;i<this.cars.length;i++)for(let j=i+1;j<this.cars.length;j++)this.collide(this.cars[i],this.cars[j]);
  if(mode!=='off')for(const c of this.cars)if(mode==='race')this.heroCollide(h,c,flow);
  for(const p of this.props){p.z-=flow*dt;if(!p.broken&&p.z<h.z+.3&&p.z>.8&&mode==='race'&&Math.abs(p.x-h.x)<p.w/2+h.hw){p.broken=true;this.fx.smash(p,flow);if(p.kind==='board'){this.fx.hero(1.1);}}}
  this.props=this.props.filter(p=>p.z>.6&&!p.broken);
  this.cars=this.cars.filter(c=>c.z>.46&&c.z<60&&Math.abs(c.x)<4);
 }
}
/** The losing roll is integrated once: ballistic hops, a barrier strike, then a rest pose. */
export type Frame={t:number;x:number;y:number;roll:number};
export function rollPath(dir:number,x0:number,start:number,end:number,reach:number){
 const frames:Frame[]=[],contacts:number[]=[];let x=x0,vx=dir*.62,y=0,vy=1.32,roll=0,wr=10.5,wall=0;const T=end-start;let k=0;
 for(let t=0;t<=T+.02;t+=1/120){frames.push({t:start+t,x,y,roll});vy-=3.35*(1/120);y+=vy/120;x+=vx/120;roll+=wr/120;
  if(!wall&&dir*x>reach){wall=start+t;vx=-vx*.5;wr*=.9;vy=Math.max(vy,.5);}
  if(y<=0&&vy<0){y=0;k++;contacts.push(start+t);vy=Math.max(.12,-vy*.7);vx*=.8;wr*=.88;if(T-t<.22){vy=0;wr*=.4;}}}
 // rest exactly on the roof
 const total=frames[frames.length-1].roll,rest=Math.max(1,Math.round((total/Math.PI-1)/2)*2+1)*Math.PI;for(const f of frames)f.roll*=rest/total;
 return {frames,contacts:contacts.slice(0,8),wall,restX:x};
}
