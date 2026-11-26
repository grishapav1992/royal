/** Scene composition: painting, ledges, lever, heroine, chamber, treasure and gates. */
import {loadImage} from './gl';
import {Clock,clamp,ease,lerp} from './clock';
import {Fx} from './fx';
import {Hero} from './hero';
import {Lock,round} from './lock';
import {Temple} from './temple';
import {sprite} from './symbols';
const PROPS:Record<string,string>={chest:'/assets/flooded-temple/props/chest.webp','chest-open':'/assets/flooded-temple/props/chest-open.webp',lever:'/assets/flooded-temple/props/lever.webp'};
type G=CanvasRenderingContext2D;
export type Mode='wide'|'portrait'|'short';
const layer=(root:HTMLElement,name:string)=>{const c=root.ownerDocument.createElement('canvas');c.className='ebb-'+name;c.setAttribute('aria-hidden','true');return c;};
export class Stage{
  clock=new Clock();fx=new Fx();temple:Temple;hero:Hero;lock=new Lock(this.clock,this.fx);private canvas:Record<string,HTMLCanvasElement>={};
  constructor(private root:HTMLElement){for(const k of['bg','back','hero','board','fx'])this.canvas[k]=layer(root,k);root.prepend(...Object.values(this.canvas));this.temple=new Temple(this.canvas.bg);this.hero=new Hero(this.canvas.hero);}
  private $(k:string){return this.canvas[k];}
  W=0;H=0;mode:Mode='wide';y0=0;y1=0;hz=0;heroH=0;steps:{x:number;y:number;k:number}[]=[];spot=0;calm=1;jade=0;
  private sheet=document.createElement('canvas');private img:Record<string,HTMLImageElement>={};private g:Record<string,G>={};private dpr=1;private soft=1;private ledge?:HTMLCanvasElement;private boardBox={x:0,y:0,w:0,h:0};private amb=0;private batAt=3;
  lever=0;rope={k:0,x:0,y:0,gold:0,on:false};gate=0;gateText=['',''];popup={t:9,x:0,y:0,text:'',small:''};prize={a:0,open:0,text:'',label:'',y:0};showHero=true;
  destroy(){this.clock.drop();this.fx.list=[];this.temple.destroy();this.hero.destroy();for(const c of Object.values(this.canvas))c.remove();}
  async load(){const n=['chest','chest-open','lever'];const l=await Promise.all([...n.map(x=>loadImage(PROPS[x])),loadImage('/assets/flooded-temple/frame.webp'),this.temple.load(),this.hero.load(),this.lock.load()]);n.forEach((x,i)=>this.img[x]=l[i] as HTMLImageElement);this.img.frame=l[3] as HTMLImageElement;for(const k of['back','board','fx'])this.g[k]=this.$(k).getContext('2d')!;}
  layout(W:number,H:number){
    this.W=W;this.H=H;this.dpr=Math.min(2,devicePixelRatio||1);const game=this.root;
    this.mode=H<500&&W>H?'short':W<640||H>W*1.05?'portrait':'wide';game.classList.toggle('portrait',this.mode==='portrait');game.classList.toggle('short',this.mode==='short');
    const top=this.mode==='short'?44:this.mode==='portrait'?50:54,con=this.mode==='short'?62:this.mode==='portrait'?188:98;game.style.setProperty('--top',top+'px');game.style.setProperty('--con',con+'px');
    this.y0=top;this.y1=H-con;const ah=this.y1-top;let c:number,f:number,bx:number,by:number,g:number;
    if(this.mode==='portrait'){
      c=Math.min((W-14)/5.26,ah*.58/3.26);f=c*.13;g=Math.max(52,c*.6);bx=(W-5*c)/2;by=this.y1-30-f-3*c;
      const band=by-f-g*.4-top;this.showHero=band>84;this.hz=W;this.heroH=Math.min(band*1.72,W*1.3);const foot=by-f+this.heroH*.40;this.steps=[0,1,2].map(i=>({x:W*(.36+.06*i),y:foot,k:1+.03*i}));
    }else{
      const base=this.mode==='short'?W*.17:clamp(W*.235,170,380);c=Math.min((W-base-26)/5.98,(ah-(this.mode==='short'?26:40))/3.3);f=c*.14;g=c*.66;const total=5*c+2*f+g,left=W-total-22;
      this.hz=Math.min(Math.max(base,left*.82),520);this.showHero=true;bx=this.hz+(W-this.hz-total)/2+f;by=top+(ah-(3*c+2*f)-(this.mode==='short'?20:30))/2+f;
      this.heroH=Math.min(ah/1.2,this.hz*1.5);const h=this.heroH;this.steps=[{x:this.hz*.43,y:this.y1-h*.235,k:1},{x:this.hz*.53,y:this.y1-h*.14,k:1.03},{x:this.hz*.64,y:this.y1-h*.05,k:1.06}];
    }
    this.lock.resize({x:bx,y:by,c,f,gauge:this.mode==='portrait'?'top':'side',g},this.dpr);
    const s=game.style;s.setProperty('--sx',bx+'px');s.setProperty('--sw',5*c+'px');s.setProperty('--sy',by+3*c+f+(this.mode==='short'?1:6)+'px');
    const z=Math.max(W/1536,(this.y1+30)/1024)*1.03;this.temple.place={x:(W-1536*z)*.5,y:(this.y1+30-1024*z)*.6,z};this.temple.resize(W,H);
    this.soft=Math.min(this.dpr,1.5);for(const k of['back','fx','hero']){const el=this.$(k),d=k==='hero'?Math.min(this.dpr,1.75):this.soft;el.width=Math.round(W*d);el.height=Math.round(H*d);}this.ledge=undefined;
    const a=this.lock.area,m=c*.5;this.boardBox={x:bx-f-m,y:by-f-(a.gauge==='top'?g*1.2:0)-m*.6,w:5*c+2*f+2*m+(a.gauge==='side'?g:0),h:3*c+2*f+(a.gauge==='top'?g*1.2:0)+m*1.6};{const B=this.boardBox,x0=Math.max(0,B.x),x1=Math.min(W,B.x+B.w),y0=Math.max(0,B.y),y1=Math.min(H,B.y+B.h);this.boardBox={x:x0,y:y0,w:x1-x0,h:y1-y0};}
    const b=this.$('board');b.width=Math.round(this.boardBox.w*this.dpr);b.height=Math.round(this.boardBox.h*this.dpr);b.style.cssText=`left:${this.boardBox.x}px;top:${this.boardBox.y}px;width:${this.boardBox.w}px;height:${this.boardBox.h}px`;
    this.place();
  }
  /** Rare scenes are drawn once before the first frame, so the first chest never stalls the show. */
  warm(){const P=this.prize;Object.assign(P,{a:1,open:1,text:'1234567890,+×',label:'Сокровищница открыта'});this.gate=.96;this.gateText=['Святилище реликвий','10 бесплатных вращений'];Object.assign(this.popup,{t:.3,text:'+1234567890,',small:'×1235'});this.fx.coins(50,50,3);this.rope.on=true;this.rope.k=.5;this.draw();const g=this.g.fx;g.getImageData(0,0,1,1);Object.assign(P,{a:0,open:0});this.gate=0;this.popup.t=9;this.rope.on=false;this.fx.list=[];}
  place(){const p=this.steps[this.spot];this.hero.x=p.x;this.hero.y=p.y;this.hero.scale=this.heroH/1050*p.k;this.hero.squash=1;}
  /** A jump with anticipation, flight and a soft landing. */
  async hop(to:number,d=.46){
    if(to===this.spot)return;const a=this.steps[this.spot],b=this.steps[to];this.spot=to;if(!this.calm){this.place();return;}
    await this.clock.tween(d*.28,u=>{this.hero.squash=1-.07*u;},ease.out);const before=this.hero.clip;if(before!=='throw')this.hero.play('jump');const up=this.heroH*.07+Math.abs(b.y-a.y)*.3;
    await this.clock.tween(d*.55,u=>{const e=ease.io(u);this.hero.x=lerp(a.x,b.x,e);this.hero.y=lerp(a.y,b.y,u*u*.5+u*.5)-Math.sin(u*Math.PI)*up;this.hero.scale=this.heroH/1050*lerp(a.k,b.k,e);this.hero.squash=1+.04*Math.sin(u*Math.PI);});
    const w=this.waterY();this.fx.splash(b.x,Math.min(b.y,w+2),b.y>w-8?12:4,.6);this.place();if(this.hero.clip==='jump')this.hero.play(to>0&&this.mode!=='portrait'?'land':'idle');await this.clock.tween(d*.35,u=>{this.hero.squash=1-.04*Math.sin(u*Math.PI);});this.hero.squash=1;
  }
  pull(){if(!this.calm)return;const c=this.clock;c.after(.1,()=>this.hero.play('lever'));c.after(.3,()=>void c.tween(.16,u=>{this.lever=u;},ease.out).then(()=>c.wait(.35)).then(()=>c.tween(.5,u=>{this.lever=1-u;},ease.io)));}
  async hook(target:{x:number;y:number},gold:(p:{x:number;y:number})=>void){
    if(!this.calm||!this.showHero)return;const c=this.clock;this.hero.play('throw');await c.wait(.3);const R=this.rope;R.on=true;R.gold=0;R.x=target.x;R.y=target.y;
    await c.tween(.26,u=>{R.k=u;},ease.out);this.fx.add({k:'ring',x:target.x,y:target.y,d:.4,s:this.lock.area.c*.5,c:'255,220,140'});R.gold=1;await c.wait(.16);await c.tween(.34,u=>{R.k=1-u;},ease.in);const h=this.hero.hand();R.on=false;gold(h);
  }
  waterY(){const h=this.heroH;return this.y1-h*lerp(-.03,.19,this.lock.holy>.5?0:this.lock.level)*(1-this.temple.dry)+this.temple.dry*20;}
  quake(){if(!this.calm)return;const g=this.root;g.classList.remove('shake');void g.offsetWidth;g.classList.add('shake');}
  tick(dt:number){
    this.clock.step(dt);if(this.calm){this.temple.time+=dt;this.lock.time+=dt;}this.hero.step(dt);this.fx.step(dt);this.ambient(dt);
    const L=this.lock,o=this.temple.holy;this.hero.tint=[lerp(1,1.08,o),lerp(1,1,o),lerp(1,.9,o)];this.hero.relic=this.jade;
    this.temple.ebb=L.pour;this.popup.t+=dt*this.clock.rate;this.draw();
  }
  private ambient(dt:number){
    if(!this.calm)return;this.amb-=dt;this.batAt-=dt;const r=Math.random;
    if(this.amb<0){this.amb=.28;const t=this.temple.place,px=(x:number)=>t.x+x*1536*t.z,py=(y:number)=>t.y+y*1024*t.z;
      for(const[x,y]of[[.791,.70],[.044,.69],[.258,.33],[.682,.415]])if(r()<.4)this.fx.add({k:'ember',x:px(x)+(r()-.5)*10,y:py(y),vy:-18-r()*26,vx:(r()-.5)*8,d:1.6+r(),s:.8+r()*1.2});
      if(r()<.22&&this.temple.dry<.5){const x=r()*this.W,fl=this.y1-r()*this.H*.14;this.fx.add({k:'drip',x,y:this.y0+r()*60,vy:40,g:900,d:2.4,floor:fl});}
      if(this.temple.holy>.5&&r()<.8)this.fx.add({k:'ember',x:r()*this.W,y:this.y1-r()*this.H*.4,vy:-12-r()*20,d:2.6,s:1+r()*1.4});}
    if(this.batAt<0){this.batAt=9+r()*9;const d=r()<.5?1:-1,y=this.y0+20+r()*this.H*.12;for(let i=0;i<3+r()*3;i++)this.fx.add({k:'bat',x:d>0?-30-i*34:this.W+30+i*34,y:y+(r()-.5)*40,vx:d*(150+r()*70),d:(this.W+200)/180,s:8+r()*7});}
  }
  private draw(){
    const{W,H,dpr}=this;this.temple.draw(W,H);const b=this.g.back;b.setTransform(this.soft,0,0,this.soft,0,0);b.clearRect(0,0,W,H);this.drawBack(b);
    if(this.showHero)this.hero.draw(W,H,dpr);this.hero.canvas.style.visibility=this.showHero?'':'hidden';
    const g=this.g.board;g.setTransform(dpr,0,0,dpr,-this.boardBox.x*dpr,-this.boardBox.y*dpr);g.clearRect(this.boardBox.x,this.boardBox.y,this.boardBox.w,this.boardBox.h);this.lock.draw(g);
    const x=this.g.fx;x.setTransform(this.soft,0,0,this.soft,0,0);x.clearRect(0,0,W,H);this.drawFront(x);
  }
  private stone(g:G,x:number,y:number,w:number,h:number,cap:number,shade=0){
    const F=this.img.frame,tile=w*.5,th=tile*224/46;g.save();g.beginPath();g.rect(x,y,w,h);g.clip();g.fillStyle='#1c3236';g.fillRect(x,y,w,h);
    for(let k=0;k<Math.ceil(w/tile);k++)for(let yy=y-(k%2)*th*.4;yy<y+h;yy+=th)g.drawImage(F,0,48,46,224,x+k*tile,yy,tile+.5,th+.5);
    const gr=g.createLinearGradient(x,0,x+w,0);gr.addColorStop(0,'rgba(255,170,80,.16)');gr.addColorStop(.35,'rgba(0,0,0,0)');gr.addColorStop(1,'rgba(0,10,16,.62)');g.fillStyle=gr;g.fillRect(x,y,w,h);
    const gd=g.createLinearGradient(0,y,0,y+h);gd.addColorStop(0,'rgba(0,0,0,0)');gd.addColorStop(1,`rgba(0,8,14,${.55+shade})`);g.fillStyle=gd;g.fillRect(x,y,w,h);g.restore();
    const n=Math.max(2,Math.round(w/(cap*4)));for(let i=0;i<n;i++)g.drawImage(F,52,284,216,34,x-cap*.2+i*(w+cap*.4)/n,y-cap*.5,(w+cap*.4)/n+.5,cap);
    g.fillStyle='rgba(255,214,150,.22)';g.fillRect(x-cap*.2,y-cap*.5,w+cap*.4,1.6);
  }
  private drawBack(g:G){
    this.fx.draw(g,true);
    if(!this.showHero)return;const h=this.heroH,lv=this.img.lever,Ls=h*.26;
    const lamp=this.hero.lamp(),r=h*.62,col=this.jade>.5?'90,255,215':'255,178,84',fl=1+.06*Math.sin(this.temple.time*9)*this.calm;
    g.globalCompositeOperation='lighter';const gr=g.createRadialGradient(lamp.x,lamp.y,0,lamp.x,lamp.y,r*fl);gr.addColorStop(0,`rgba(${col},${.30+.22*this.jade})`);gr.addColorStop(.35,`rgba(${col},.10)`);gr.addColorStop(1,`rgba(${col},0)`);g.fillStyle=gr;g.fillRect(lamp.x-r*1.1,lamp.y-r*1.1,r*2.2,r*2.2);g.globalCompositeOperation='source-over';
    if(this.mode==='portrait'){const x=Math.min(this.W-62,this.steps[0].x+this.heroH*.36),y=this.lock.area.y-this.lock.area.f,S=Math.min(this.heroH*.28,120);this.drawLever(g,lv,x,y-this.lock.area.g*.14,S);return;}
    const s=this.steps,w=this.hz*.4,cap=h*.035;
    const lx=s[0].x+h*.37,ly=s[0].y-h*.47;
    if(!this.ledge){const c=document.createElement('canvas');c.width=Math.ceil(this.hz*1.15*this.soft);c.height=Math.ceil(this.H*this.soft);const q=c.getContext('2d')!;q.scale(this.soft,this.soft);this.stone(q,lx-Ls*.34,ly+Ls*.5,Ls*.68,this.y1-ly,cap,.1);s.forEach((p,i)=>this.stone(q,p.x-w*(.62-.06*i),p.y,w*1.14,this.y1-p.y+6,cap,.12*i));this.ledge=c;}
    g.drawImage(this.ledge,0,0,this.ledge.width/this.soft,this.ledge.height/this.soft);this.drawLever(g,lv,lx,ly+Ls*.53,Ls);
    s.forEach((p,i)=>{g.fillStyle='rgba(0,8,12,.35)';g.beginPath();if(i===this.spot){g.ellipse(this.hero.x,p.y+2,h*.13,h*.014,0,0,7);g.fill();}});
  }
  private drawLever(g:G,i:HTMLImageElement,x:number,bottom:number,S:number){
    const px=x,py=bottom-S*.53;g.save();g.translate(px,py);g.rotate(-this.lever*1.9);g.drawImage(i,128,0,64,140,-S*.1,-S*.47,S*.2,S*.4375);g.restore();
    g.save();g.beginPath();g.rect(px-S*.5,bottom-S*.58,S,S*.6);g.clip();g.drawImage(i,px-S*.5,bottom-S,S,S);g.restore();
    const k=this.lever;if(k>.05){g.globalCompositeOperation='lighter';const gr=g.createRadialGradient(px,bottom-S*.2,0,px,bottom-S*.2,S*.3);gr.addColorStop(0,`rgba(90,255,220,${.6*k})`);gr.addColorStop(1,'rgba(90,255,220,0)');g.fillStyle=gr;g.fillRect(px-S*.3,bottom-S*.5,S*.6,S*.6);g.globalCompositeOperation='source-over';}
  }
  private drawFront(g:G){
    if(this.mode!=='portrait'&&this.temple.dry<.98)this.frontWater(g);
    if(this.rope.on)this.drawRope(g);
    this.fx.draw(g);
    if(this.popup.t>0&&this.popup.t<1.25)this.drawPopup(g);
    if(this.prize.a>.005)this.drawPrize(g);
    if(this.gate>.002)this.drawGate(g);
  }
  private frontWater(g:G){
    const y=this.waterY(),x1=this.hz+this.lock.area.f,t=this.temple.time;if(y>this.y1+2)return;
    const s=(x:number)=>y+(Math.sin(x*.03+t*1.7)*2+Math.sin(x*.07-t*1.2)*1.3)*this.calm;
    const q=this.sheet;q.width=Math.ceil(x1);q.height=Math.max(2,Math.ceil(this.y1-y+14));const o=q.getContext('2d')!,oy=y-12;o.translate(0,-oy);o.beginPath();o.moveTo(0,this.y1+2);for(let x=0;x<=x1+14;x+=14)o.lineTo(x,s(x));o.lineTo(x1+14,this.y1+2);o.closePath();const gr=o.createLinearGradient(0,y,0,this.y1);gr.addColorStop(0,'rgba(22,112,130,.50)');gr.addColorStop(.4,'rgba(10,74,98,.74)');gr.addColorStop(1,'rgba(4,34,52,.92)');o.fillStyle=gr;o.fill();o.globalCompositeOperation='destination-in';const hm=o.createLinearGradient(0,0,x1,0);hm.addColorStop(.62,'#000');hm.addColorStop(1,'rgba(0,0,0,0)');o.fillStyle=hm;o.fillRect(0,oy,x1,q.height+2);g.drawImage(q,0,oy);
    const fade=g.createLinearGradient(0,0,x1,0);fade.addColorStop(0,'rgba(210,250,250,.75)');fade.addColorStop(.85,'rgba(210,250,250,.55)');fade.addColorStop(1,'rgba(210,250,250,0)');g.strokeStyle=fade;g.lineWidth=1.8;g.beginPath();for(let x=0;x<=x1;x+=14)x?g.lineTo(x,s(x)):g.moveTo(0,s(0));g.stroke();
    // a wake around whatever stands in the water
    const p=this.hero;if(p.y>y-2){g.strokeStyle='rgba(220,255,255,.5)';g.lineWidth=1.4;for(let k=0;k<2;k++){const u=(t*.5+k*.5)%1;g.globalAlpha=(1-u)*this.calm;g.beginPath();g.ellipse(p.x,y+2,this.heroH*(.1+.07*u),this.heroH*(.012+.01*u),0,0,7);g.stroke();}g.globalAlpha=1;}
  }
  private drawRope(g:G){
    const h=this.hero.hand(),R=this.rope,x=lerp(h.x,R.x,R.k),y=lerp(h.y,R.y,R.k)-Math.sin(R.k*Math.PI)*this.heroH*.12*(1-R.gold),sag=(1-R.k)*30+14;
    const mid={x:(h.x+x)/2,y:(h.y+y)/2+sag};g.lineCap='round';for(const[c,w]of[['#2a1a0c',5],['#c49a5a',3],['rgba(255,236,190,.6)',1]]as const){g.strokeStyle=c;g.lineWidth=w;g.beginPath();g.moveTo(h.x,h.y);g.quadraticCurveTo(mid.x,mid.y,x,y);g.stroke();}
    const a=Math.atan2(y-mid.y,x-mid.x),s=this.lock.area.c*.11;g.save();g.translate(x,y);g.rotate(a);g.strokeStyle='#ffdf96';g.lineWidth=s*.24;g.beginPath();g.moveTo(-s,0);g.lineTo(s*.4,0);g.moveTo(s*.4,0);g.arc(0,-s*.0,s*.9,0,-1.5,true);g.moveTo(s*.4,0);g.arc(0,0,s*.9,0,1.5);g.stroke();g.restore();
    if(R.gold){g.globalCompositeOperation='lighter';const r=s*2.2,gr=g.createRadialGradient(x,y,0,x,y,r);gr.addColorStop(0,'rgba(255,220,120,.9)');gr.addColorStop(1,'rgba(255,190,70,0)');g.fillStyle=gr;g.fillRect(x-r,y-r,r*2,r*2);g.globalCompositeOperation='source-over';if(Math.random()<.5)this.fx.add({k:'spark',x:x+(Math.random()-.5)*16,y:y+(Math.random()-.5)*16,d:.5,s:6,c:'255,220,130'});}
  }
  private drawPopup(g:G){
    const p=this.popup,t=p.t/1.25,fs=this.lock.area.c*.34,a=t<.12?t/.12:t>.72?1-(t-.72)/.28:1,k=t<.16?.7+.3*ease.back(t/.16):1;g.save();g.globalAlpha=a;g.translate(p.x,p.y-fs*.9*ease.out(t));g.scale(k,k);g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';g.font='700 '+fs+'px Georgia,serif';g.lineWidth=fs*.2;g.strokeStyle='rgba(16,7,0,.9)';g.strokeText(p.text,0,0);const gr=g.createLinearGradient(0,-fs/2,0,fs/2);gr.addColorStop(0,'#fffbe0');gr.addColorStop(.55,'#ffcf62');gr.addColorStop(1,'#d08a2e');g.fillStyle=gr;g.fillText(p.text,0,0);
    if(p.small){g.font='700 '+fs*.5+'px Georgia,serif';g.lineWidth=fs*.14;g.strokeText(p.small,0,-fs*.8);g.fillStyle='#bff7ee';g.fillText(p.small,0,-fs*.8);}g.restore();
  }
  chestAt(){const b=this.lock.box,S=Math.min(b.h*.52,b.w*.34);return{x:b.x+b.w/2,y:b.y+b.h*.66,S};}
  private drawPrize(g:G){
    const p=this.prize,b=this.lock.box,a=p.a,{x,y,S}=this.chestAt(),t=this.temple.time;g.save();g.globalAlpha=a;
    const f=this.lock.area.f,dk=g.createRadialGradient(x,y-S*.2,S*.3,x,y-S*.2,b.w*.62);dk.addColorStop(0,'rgba(4,14,18,.72)');dk.addColorStop(1,'rgba(4,14,18,.88)');g.fillStyle=dk;g.fillRect(b.x-f*.2,b.y-f*.2,b.w+f*.4,b.h+f*.4);
    g.save();g.beginPath();g.rect(b.x,b.y,b.w,b.h);g.clip();g.globalCompositeOperation='lighter';for(let i=0;i<14;i++){const q=i/14*6.283+t*.16,l=b.w*.6*p.open;g.fillStyle=`rgba(255,204,110,${.10*a*p.open})`;g.beginPath();g.moveTo(x,y-S*.2);g.lineTo(x+Math.cos(q-.07)*l,y-S*.2+Math.sin(q-.07)*l);g.lineTo(x+Math.cos(q+.07)*l,y-S*.2+Math.sin(q+.07)*l);g.fill();}
    const gl=g.createRadialGradient(x,y-S*.15,0,x,y-S*.15,S*.9);gl.addColorStop(0,`rgba(255,220,130,${.75*p.open})`);gl.addColorStop(1,'rgba(255,200,90,0)');g.fillStyle=gl;g.fillRect(x-S,y-S*1.2,S*2,S*2);g.restore();
    const o=p.open>.5,sq=o?1+.05*Math.sin(clamp((p.open-.5)*2)*Math.PI):1-.03*Math.sin(p.open*2*Math.PI*3);g.save();g.translate(x,y+S*.42);g.scale(1/sq,sq);g.drawImage(this.img[o?'chest-open':'chest'],-S/2,-S*.9,S,S);g.restore();
    const fs=Math.min(b.w*.1,b.h*.17);g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';
    g.font=`700 ${fs*.42}px Georgia,serif`;g.lineWidth=fs*.1;g.strokeStyle='rgba(20,8,0,.9)';g.strokeText(p.label,x,b.y+b.h*.10);g.fillStyle='#ffe9b4';g.fillText(p.label,x,b.y+b.h*.10);
    g.font=`700 ${fs}px Georgia,serif`;g.lineWidth=fs*.14;g.strokeText(p.text,x,b.y+b.h*.25);const tg=g.createLinearGradient(0,b.y+b.h*.16,0,b.y+b.h*.34);tg.addColorStop(0,'#fff8d8');tg.addColorStop(.5,'#ffcf62');tg.addColorStop(1,'#c9822a');g.fillStyle=tg;g.fillText(p.text,x,b.y+b.h*.25);
    g.restore();
  }
  /** Two carved leaves with the sun split between them. */
  private drawGate(g:G){
    const k=this.gate,W=this.W,y0=0,h=this.y1,w=W/2+1,F=this.img.frame,f=Math.max(26,Math.min(W,h)*.06);
    for(const d of[-1,1]){g.save();const x0=d<0?-w*(1-k):W-w*k;g.translate(x0,0);g.beginPath();g.rect(0,y0,w,h);g.clip();
      const gr=g.createLinearGradient(0,y0,0,h);gr.addColorStop(0,'#2a4a4a');gr.addColorStop(1,'#0f2328');g.fillStyle=gr;g.fillRect(0,y0,w,h);
      const q=f*2.2;const tw=q*1.05,th=tw*224/46;for(let x=f,c=0;x<w;x+=tw,c++)for(let y=-(c%3)*th*.3;y<h;y+=th)g.drawImage(F,0,48,46,224,x,y,tw+.6,th+.6);g.fillStyle='rgba(8,30,34,.42)';g.fillRect(0,0,w,h);const lg=g.createRadialGradient(d<0?w:0,h*.45,0,d<0?w:0,h*.45,Math.max(w,h)*.95);lg.addColorStop(0,'rgba(255,196,110,.26)');lg.addColorStop(.45,'rgba(0,0,0,0)');lg.addColorStop(1,'rgba(0,6,10,.72)');g.fillStyle=lg;g.fillRect(0,0,w,h);
      const n=Math.ceil(h/(f*4.6)),m=Math.ceil(w/(f*4.6));for(let i=0;i<n;i++){g.drawImage(F,0,46,46,228,0,i*h/n,f,h/n+1);g.drawImage(F,274,46,46,228,w-f,i*h/n,f,h/n+1);}for(let i=0;i<m;i++){g.drawImage(F,50,2,220,34,i*w/m,0,w/m+1,f);g.drawImage(F,50,284,220,34,i*w/m,h-f,w/m+1,f);}
      const S=Math.min(W*.42,h*.5),im=sprite(1),cx=d<0?w:0;g.globalAlpha=.95;g.drawImage(im,cx-S/2,h*.42-S/2,S,S);g.globalAlpha=1;
      const sh=g.createLinearGradient(d<0?w:0,0,d<0?w*.6:w*.4,0);sh.addColorStop(0,'rgba(0,0,0,.5)');sh.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=sh;g.fillRect(0,0,w,h);g.restore();}
    if(k>.9){const a=(k-.9)*10,fs=Math.min(W*.06,h*.085);g.save();g.globalAlpha=a;g.textAlign='center';g.textBaseline='middle';g.fillStyle='rgba(6,20,24,.9)';const pw=Math.min(W*.92,fs*15),ph=fs*3.1,py=h*.72;round(g,W/2-pw/2,py-ph/2,pw,ph,fs*.3);g.fill();g.strokeStyle='#d9a955';g.lineWidth=2.5;g.stroke();
      g.font=`700 ${fs}px Georgia,serif`;g.fillStyle='#ffe3a2';g.fillText(this.gateText[0],W/2,py-fs*.52,pw*.94);g.font=`700 ${fs*.62}px Georgia,serif`;g.fillStyle='#bdf5e6';g.fillText(this.gateText[1],W/2,py+fs*.72,pw*.94);g.restore();}
  }
}
