/** The sluice chamber: five columns of symbols with real water behind them. Its level is the confirmed multiplier. */
import {loadImage} from './gl';
import {Clock,clamp,ease,lerp} from './clock';
import {Fx} from './fx';
import * as sym from './symbols';
import type {CascadeMove} from '../../../../games/flooded-temple/cascadePresentation';
type G=CanvasRenderingContext2D;
type Cell={s:number;dy:number;dx:number;rot:number;sc:number;a:number;land:number;landP:number;win:number;winP:number;hot:number};
export type Box={x:number;y:number;w:number;h:number};
export type Area={x:number;y:number;c:number;f:number;gauge:'side'|'top';g:number};
const fresh=():Cell=>({s:0,dy:0,dx:0,rot:0,sc:1,a:1,land:-1,landP:0,win:-1,winP:0,hot:0});
export class Lock{
  cells:Cell[]=Array.from({length:15},fresh);area:Area={x:0,y:0,c:100,f:20,gauge:'side',g:60};
  level=1;holy=0;step=0;labels=[1,2,3,5];pour=0;stream=[0,0,0,0,0];grate=[0,0,0,0,0];dim=0;time=0;calm=1;sealPulse=0;shakeX=0;shakeY=0;fast=false;
  private lines:{pts:{x:number;y:number}[];k:number;a:number}[]=[];private frame?:HTMLImageElement;private wall?:HTMLCanvasElement;private glyph?:HTMLCanvasElement;private caus!:HTMLCanvasElement;private fall!:HTMLCanvasElement;private dpr=1;
  onLand:(column:number)=>void=()=>{};
  constructor(private clock:Clock,private fx:Fx){}
  async load(){this.frame=await loadImage('assets/frame.webp');await sym.loadSymbols();this.caus=caustics();this.fall=falling();}
  get w(){return this.area.c*5;}get h(){return this.area.c*3;}
  center(i:number){const a=this.area;return{x:a.x+(Math.floor(i/3)+.5)*a.c,y:a.y+(i%3+.5)*a.c};}
  get box():Box{const a=this.area;return{x:a.x,y:a.y,w:this.w,h:this.h};}
  resize(a:Area,dpr:number){
    this.area=a;this.dpr=dpr;sym.prepare(a.c*.9*dpr);
    const W=Math.ceil((this.w+a.f*2)*dpr),H=Math.ceil((this.h+a.f*2)*dpr);
    const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d')!;g.scale(dpr,dpr);g.translate(a.f,a.f);const w=this.w,h=this.h;
    const gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,'#1d3d40');gr.addColorStop(.5,'#17343a');gr.addColorStop(1,'#122a30');g.fillStyle=gr;g.fillRect(0,0,w,h);
    // stone courses
    let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
    for(let r=0;r<6;r++)for(let k=-1;k<6;k++){const bx=(k+(r%2)*.5)*a.c,by=r*a.c/2;g.fillStyle=`rgba(${rnd()>.5?'120,160,150':'0,12,16'},${.03+rnd()*.07})`;g.fillRect(bx+1,by+1,a.c-2,a.c/2-2);g.strokeStyle='rgba(3,14,18,.5)';g.lineWidth=1.2;g.strokeRect(bx,by,a.c,a.c/2);}
    for(let i=0;i<700;i++){g.fillStyle=`rgba(${rnd()>.5?'190,210,190':'0,8,10'},${rnd()*.09})`;g.fillRect(rnd()*w,rnd()*h,1+rnd()*2,1+rnd()*2);}
    // niches
    for(let i=0;i<15;i++){const x=Math.floor(i/3)*a.c,y=i%3*a.c,m=a.c*.045;g.fillStyle='rgba(2,14,18,.30)';round(g,x+m,y+m,a.c-2*m,a.c-2*m,a.c*.09);g.fill();g.strokeStyle='rgba(150,190,170,.14)';g.lineWidth=1;g.stroke();g.strokeStyle='rgba(0,8,10,.55)';round(g,x+m+1.5,y+m+1.5,a.c-2*m,a.c-2*m,a.c*.09);g.stroke();}
    this.wall=c;
    // carved keys that light up where the water has gone
    const k=document.createElement('canvas');k.width=Math.ceil(w*dpr);k.height=Math.ceil(h*dpr);const q=k.getContext('2d')!;q.scale(dpr,dpr);q.strokeStyle='#e9c476';q.lineWidth=Math.max(1,a.c*.013);
    for(let r=0;r<3;r++)for(let col=0;col<5;col++){const x=col*a.c,y=r*a.c,s=a.c*.1,m=a.c*.085;for(const[sx,sy,ox,oy]of[[1,1,x+m,y+m],[-1,1,x+a.c-m,y+m],[1,-1,x+m,y+a.c-m],[-1,-1,x+a.c-m,y+a.c-m]]){q.beginPath();q.moveTo(ox,oy+sy*s*1.8);q.lineTo(ox,oy);q.lineTo(ox+sx*s*1.8,oy);q.moveTo(ox+sx*s*.55,oy+sy*s*1.5);q.lineTo(ox+sx*s*.55,oy+sy*s*.55);q.lineTo(ox+sx*s*1.5,oy+sy*s*.55);q.stroke();}}
    this.glyph=k;
  }
  set(grid:readonly number[]){grid.forEach((s,i)=>Object.assign(this.cells[i],fresh(),{s}));this.lines=[];this.stream.fill(0);this.grate.fill(0);}
  private sparkle=(i:number):sym.Spawn=>(kind,x,y,size,color='255,220,140')=>{
    const p=this.center(i),S=this.area.c*.9,X=p.x+x*S,Y=p.y+y*S,r=Math.random;
    if(kind==='spark')this.fx.add({k:'spark',x:X,y:Y,vx:(r()-.5)*60,vy:(r()-.5)*60,d:.5,s:S*.06*size,c:color});
    else if(kind==='ring')this.fx.add({k:'ring',x:X,y:Y,d:.55,s:S*.55*size,c:color});
    else if(kind==='ray')this.fx.add({k:'ray',x:X,y:Y,d:.8,s:S*.85*size,c:color,r:r()*6});
    else if(kind==='feather')this.fx.add({k:'feather',x:X,y:Y,vx:(r()-.7)*70,vy:-20-r()*40,g:70,d:1.1,s:S*.09*size,c:color});
    else if(kind==='bubble')this.fx.bubbles(X,Y,S*.2,4);
    else if(kind==='drop')this.fx.splash(X,Y,5,.55);
    else for(let k=0;k<4;k++)this.fx.add({k:'dust',x:X+(r()-.5)*S*.2,y:Y,vx:(x<0?-1:1)*(10+r()*30),vy:-r()*16,d:.6,s:S*.12*size});
  };
  /** The floor opens and the old symbols are drawn down a whirlpool. */
  async sink(){
    const jobs:Promise<void>[]=[];
    for(let col=0;col<5;col++){jobs.push((async()=>{
      await this.clock.wait(col*.045);void this.clock.tween(.16,u=>{this.grate[col]=u;},ease.out);
      const a=this.area,x=a.x+(col+.5)*a.c,y=a.y+this.h;this.fx.bubbles(x,y-6,a.c*.7,12);
      await Promise.all([2,1,0].map((r,n)=>this.clock.wait(n*.04).then(()=>this.clock.tween(.32,u=>{const k=this.cells[col*3+r];k.dy=u*u*(3.35-r*.75);k.rot=u*u*(col%2?1:-1)*1.1;k.sc=1-.55*u*u;k.dx=Math.sin(u*7+r)*.08*u;k.a=u>.82?1-(u-.82)/.18:1;}))));
      void this.clock.tween(.2,u=>{this.stream[col]=u;},ease.out);this.fx.splash(x,y-8,6,.55);
    })());}
    await Promise.all(jobs);
  }
  /** The stream brings the confirmed symbols, column after column. */
  async arrive(grid:readonly number[]){
    const jobs:Promise<void>[]=[];
    for(let col=0;col<5;col++)jobs.push((async()=>{
      await this.clock.wait(col*.125);for(let r=0;r<3;r++)Object.assign(this.cells[col*3+r],fresh(),{s:grid[col*3+r],a:0,dy:-4});
      void this.clock.tween(.12,u=>{this.stream[col]=1+u*.6;});void this.clock.tween(.2,u=>{this.grate[col]=1-u;});
      await Promise.all([2,1,0].map((r,n)=>this.clock.wait(n*.055).then(()=>this.drop(col*3+r,3.6,.34,n===0))));
      this.onLand(col);const a=this.area,x=a.x+(col+.5)*a.c;this.fx.splash(x,a.y+this.h-4,9,.8);void this.clock.tween(.3,u=>{this.stream[col]=1.6*(1-u);},ease.out);
    })());
    await Promise.all(jobs);await this.clock.wait(.14);
  }
  private async drop(i:number,from:number,d:number,quiet=false){
    const k=this.cells[i];k.a=1;k.rot=0;k.sc=1;k.dx=0;
    await this.clock.tween(d,u=>{k.dy=-from*(1-u*u);k.dx=Math.sin(u*5+i)*.025*(1-u);});
    k.dy=0;k.dx=0;k.land=0;k.landP=0;void this.clock.tween(.55,u=>{k.land=u;}).then(()=>{k.land=-1;});
    if(!quiet){const p=this.center(i);this.fx.splash(p.x,p.y+this.area.c*.4,3,.5);}
  }
  async settle(moves:readonly CascadeMove[],grid:readonly number[]){
    const jobs:Promise<void>[]=[],old=this.cells.map(c=>c.s);void old;
    for(const m of moves)Object.assign(this.cells[m.cell],fresh(),{s:grid[m.cell],dy:m.rows?-m.rows:0});
    const cols=new Set(moves.filter(m=>m.from===null).map(m=>Math.floor(m.cell/3)));
    for(const c of cols)void this.clock.tween(.5,u=>{this.stream[c]=Math.sin(u*Math.PI)*.9;});
    for(const m of moves){if(!m.rows)continue;const col=Math.floor(m.cell/3),r=m.cell%3;this.cells[m.cell].a=m.from===null?0:1;
      jobs.push(this.clock.wait(col*.035+(2-r)*.05).then(()=>this.drop(m.cell,m.rows+(m.from===null?.4:0),.2+.06*m.rows)));}
    await Promise.all(jobs);await this.clock.wait(.1);
  }
  async celebrate(mask:number,wins:{cells:number[]}[],relics:number[],d:number){
    this.lines=wins.slice(0,4).map(w=>({pts:w.cells.map(i=>this.center(i)),k:0,a:1}));const L=this.lines;
    void this.clock.tween(.4,u=>{this.dim=u;},ease.out);
    for(let i=0;i<15;i++)if(mask&(1<<i)){const k=this.cells[i],col=Math.floor(i/3);void this.clock.wait(col*.06).then(()=>this.clock.tween(d-.1,u=>{k.win=u;k.hot=Math.sin(Math.min(1,u*1.6)*Math.PI*.5);}));}
    void relics;await this.clock.tween(d,u=>{for(const l of L){l.k=clamp(u*2.3);l.a=u>.8?1-(u-.8)/.2:1;}});this.lines=[];
  }
  async crumble(mask:number,to:{x:number;y:number},rate:number){
    for(let i=0;i<15;i++)if(mask&(1<<i)){const k=this.cells[i],p=this.center(i);const n=popcount(mask);this.fx.sand(p.x,p.y,this.area.c*.9,sym.grains[k.s],to,rate,n>6?.5:.8);
      for(let q=0;q<5;q++)this.fx.add({k:'stone',x:p.x+(Math.random()-.5)*40,y:p.y+(Math.random()-.5)*40,vx:(Math.random()-.5)*150,vy:-40-Math.random()*90,g:700,d:.6,s:4+Math.random()*6,c:'#3d5a56',vr:(Math.random()-.5)*14});
      void this.clock.tween(.3,u=>{k.a=1-u;k.sc=1-.12*u;});}
    await this.clock.tween(.3,u=>{this.dim=1-u;});for(const k of this.cells){k.win=-1;k.hot=0;}
  }
  undim(){this.dim=0;for(const k of this.cells){k.win=-1;k.hot=0;}}
  /** Water leaves the chamber down to the next confirmed mark. */
  async ebb(level:number,d=.6){const a=this.level;void this.clock.tween(d,u=>{this.pour=Math.sin(u*Math.PI);});await this.clock.tween(d,u=>{this.level=lerp(a,level,u);},ease.io);}
  draw(g:G){
    const a=this.area,w=this.w,h=this.h,t=this.time;if(!this.wall||!this.frame)return;
    g.save();g.translate(this.shakeX,this.shakeY);
    g.drawImage(this.wall,a.x-a.f,a.y-a.f,w+a.f*2,h+a.f*2);
    g.save();g.beginPath();g.rect(a.x,a.y,w,h);g.clip();
    const top=a.y+h*(1-this.level);
    // dry stone glows with carved keys above the waterline; in the sanctuary light rises instead
    const dryTop=this.holy>.5?top:a.y,dryH=this.holy>.5?a.y+h-top:top-a.y;
    if(dryH>1&&this.glyph){g.save();g.beginPath();g.rect(a.x,dryTop,w,dryH);g.clip();g.globalAlpha=.34+.1*Math.sin(t*1.8)*this.calm;g.globalCompositeOperation='lighter';g.drawImage(this.glyph,a.x,a.y,w,h);g.restore();}
    if(this.level>.004)this.water(g,top,false);
    if(this.dim>0){g.fillStyle=`rgba(2,12,18,${.5*this.dim})`;g.fillRect(a.x,a.y,w,h);}
    for(let c=0;c<5;c++)if(this.stream[c]>.01)this.drawStream(g,c,this.stream[c]);
    for(let i=0;i<15;i++){const k=this.cells[i];if(k.a<=.01||(this.dim>0&&k.hot>0))continue;this.drawCell(g,i,k);}
    for(let i=0;i<15;i++){const k=this.cells[i];if(k.a<=.01||!(this.dim>0&&k.hot>0))continue;this.drawCell(g,i,k);}
    if(this.level>.004)this.water(g,top,true);
    for(let c=0;c<5;c++)if(this.grate[c]>.01)this.drawGrate(g,c,this.grate[c]);
    for(const l of this.lines)this.drawLine(g,l);
    const sh=g.createLinearGradient(0,a.y,0,a.y+a.c*.22);sh.addColorStop(0,'rgba(0,6,10,.6)');sh.addColorStop(1,'rgba(0,6,10,0)');g.fillStyle=sh;g.fillRect(a.x,a.y,w,a.c*.22);
    g.restore();this.drawFrame(g);g.restore();
  }
  private water(g:G,top:number,front:boolean){
    const a=this.area,w=this.w,bottom=a.y+this.h,t=this.time,hol=this.holy;
    const surf=(x:number)=>top+(Math.sin(x*.026+t*2.1)*2.4+Math.sin(x*.061-t*1.4)*1.4+Math.sin(x*.11+t*3.3)*this.pour*3)*this.calm;
    g.save();g.beginPath();g.moveTo(a.x,bottom);for(let x=0;x<=w;x+=12)g.lineTo(a.x+x,this.level>.985?a.y-2:surf(x));g.lineTo(a.x+w,this.level>.985?a.y-2:surf(w));g.lineTo(a.x+w,bottom);g.closePath();
    if(!front){const gr=g.createLinearGradient(0,top,0,bottom);
      if(hol>.5){gr.addColorStop(0,'rgba(150,255,220,.30)');gr.addColorStop(1,'rgba(255,214,120,.34)');}
      else{gr.addColorStop(0,'rgba(24,126,142,.52)');gr.addColorStop(.35,'rgba(12,88,110,.62)');gr.addColorStop(1,'rgba(5,44,68,.80)');}
      g.fillStyle=gr;g.fill();g.clip();g.globalCompositeOperation='screen';g.globalAlpha=hol>.5?.06:.075;const s=a.c*1.35;
      for(let k=0;k<2;k++){const ox=((t*(k?9:-7))%s+s)%s,oy=((t*(k?5:4))%s+s)%s;for(let x=-s;x<w+s;x+=s)for(let y=-s;y<this.h+s;y+=s)g.drawImage(this.caus,a.x+x+ox,a.y+y+oy,s,s);}
    }else{g.save();g.clip();g.fillStyle=hol>.5?'rgba(255,230,150,.05)':'rgba(60,190,205,.07)';g.fillRect(a.x,top,w,this.h);g.restore();
      if(this.level<.985){g.strokeStyle=hol>.5?'rgba(255,244,190,.75)':'rgba(205,248,250,.7)';g.lineWidth=2;g.beginPath();for(let x=0;x<=w;x+=12)x?g.lineTo(a.x+x,surf(x)):g.moveTo(a.x,surf(0));g.lineTo(a.x+w,surf(w));g.stroke();g.strokeStyle='rgba(160,240,240,.22)';g.lineWidth=6;g.stroke();}
    }
    g.restore();
  }
  private drawStream(g:G,c:number,k:number){
    const a=this.area,x=a.x+(c+.1)*a.c,w=a.c*.8,H=a.c*1.3,off=(this.time*a.c*11)%H;g.save();g.globalAlpha=clamp(k*.62);g.globalCompositeOperation='screen';
    for(let y=-H;y<this.h+H;y+=H)g.drawImage(this.fall,x,a.y+y+off,w,H);g.globalAlpha=clamp(k)*.5;g.save();g.translate(x+w/2,a.y+this.h);g.scale(1,.55);const fo=g.createRadialGradient(0,0,0,0,0,w*.62);fo.addColorStop(0,'rgba(225,252,255,.85)');fo.addColorStop(.5,'rgba(200,245,250,.35)');fo.addColorStop(1,'rgba(200,245,250,0)');g.fillStyle=fo;g.fillRect(-w,-w,w*2,w);g.restore();g.restore();
  }
  private drawGrate(g:G,c:number,k:number){
    const a=this.area,x=a.x+(c+.5)*a.c,y=a.y+this.h,r=a.c*.44*k;g.save();g.translate(x,y);g.scale(1,.34);const gr=g.createRadialGradient(0,0,0,0,0,r);gr.addColorStop(0,'rgba(0,6,12,.95)');gr.addColorStop(.6,'rgba(2,30,42,.75)');gr.addColorStop(1,'rgba(20,110,120,0)');g.fillStyle=gr;g.beginPath();g.arc(0,0,r,0,7);g.fill();
    g.strokeStyle='rgba(190,245,250,.5)';g.lineWidth=2;for(let i=0;i<3;i++){const b=this.time*9+i*2.1;g.beginPath();g.arc(0,0,r*(.45+.2*i),b,b+1.5);g.stroke();}g.restore();
  }
  private drawCell(g:G,i:number,k:Cell){
    const p=this.center(i),a=this.area,S=a.c*.9;g.save();g.translate(p.x+k.dx*a.c,p.y+k.dy*a.c);g.globalAlpha=k.a;g.rotate(k.rot);g.scale(k.sc,k.sc);
    if(Math.abs(k.dy)<.02&&k.rot===0){g.fillStyle='rgba(0,8,12,.34)';g.beginPath();g.ellipse(0,S*.43,S*.34,S*.06,0,0,7);g.fill();}
    if(k.hot>0){g.save();g.globalCompositeOperation='lighter';const gr=g.createRadialGradient(0,0,0,0,0,S*.66);gr.addColorStop(0,`rgba(${sym.GLOW[k.s]},${.34*k.hot})`);gr.addColorStop(1,`rgba(${sym.GLOW[k.s]},0)`);g.fillStyle=gr;g.fillRect(-S*.66,-S*.66,S*1.32,S*1.32);g.restore();}
    if(k.win>=0){sym.winning(g,k.s,S,k.win,k.winP,this.sparkle(i));k.winP=k.win;}
    else if(k.land>=0){sym.landing(g,k.s,S,k.land,k.landP,this.sparkle(i));k.landP=k.land;}
    else if(k.dy!==0){const st=clamp(Math.abs(k.dy)*.05,0,.1);g.scale(1-st,1+st);g.drawImage(sym.sprite(k.s),-S/2,-S/2,S,S);}
    else sym.plain(g,k.s,S,this.time,i,this.calm);
    g.restore();
    if(k.s>=7&&k.a>.6&&Math.abs(k.dy)<.05&&k.sc>.9){const text=k.s===7?'WILD':'BONUS',y=p.y+a.c*.405,fs=Math.max(9,a.c*.115);g.save();g.globalAlpha=k.a;g.font=`700 ${fs}px Georgia,serif`;g.textAlign='center';g.textBaseline='middle';const tw=g.measureText(text).width+fs*1.1;g.fillStyle='rgba(6,22,26,.82)';round(g,p.x-tw/2,y-fs*.72,tw,fs*1.42,fs*.4);g.fill();g.strokeStyle=k.s===7?'rgba(240,196,110,.8)':'rgba(110,255,226,.7)';g.lineWidth=1;g.stroke();g.fillStyle=k.s===7?'#ffe2a0':'#baffee';g.fillText(text,p.x,y+.5);g.restore();}
  }
  private drawLine(g:G,l:{pts:{x:number;y:number}[];k:number;a:number}){
    const pts=l.pts,n=pts.length-1,e=l.k*n;g.save();g.globalAlpha=l.a;g.lineCap='round';g.lineJoin='round';
    const path=()=>{g.beginPath();g.moveTo(pts[0].x,pts[0].y);for(let i=1;i<=n;i++){const q=clamp(e-(i-1));if(q<=0)break;g.lineTo(lerp(pts[i-1].x,pts[i].x,q),lerp(pts[i-1].y,pts[i].y,q));}};
    g.globalCompositeOperation='lighter';path();g.strokeStyle='rgba(255,190,80,.22)';g.lineWidth=this.area.c*.11;g.stroke();path();g.strokeStyle='rgba(255,226,150,.85)';g.lineWidth=this.area.c*.025;g.stroke();
    const i=Math.min(n-1,Math.floor(e)),q=clamp(e-i),hx=lerp(pts[i].x,pts[i+1].x,q),hy=lerp(pts[i].y,pts[i+1].y,q),r=this.area.c*.16;const gr=g.createRadialGradient(hx,hy,0,hx,hy,r);gr.addColorStop(0,'rgba(255,255,230,.95)');gr.addColorStop(1,'rgba(255,200,90,0)');g.fillStyle=gr;g.fillRect(hx-r,hy-r,r*2,r*2);g.restore();
  }
  private drawFrame(g:G){
    const a=this.area,F=this.frame!,f=a.f,x=a.x-f,y=a.y-f,w=this.w+2*f,h=this.h+2*f,s=46,e=320;
    // edges repeat the carved stone instead of stretching it
    const n=Math.max(2,Math.round(h/(f*4.6))),m=Math.max(3,Math.round(w/(f*4.6)));
    for(let i=0;i<n;i++){const hh=(h-2*f)/n,yy=y+f+i*hh;g.drawImage(F,0,s,s,e-2*s,x,yy,f,hh+.5);g.drawImage(F,e-s,s,s,e-2*s,x+w-f,yy,f,hh+.5);}
    for(let i=0;i<m;i++){const ww=(w-2*f)/m,xx=x+f+i*ww;g.drawImage(F,s+4,2,e-2*s-8,34,xx,y,ww+.5,f);g.drawImage(F,s+4,e-36,e-2*s-8,34,xx,y+h-f,ww+.5,f);}
    for(const[cx,cy,sx,sy]of[[x,y,0,0],[x+w-f,y,e-s,0],[x,y+h-f,0,e-s],[x+w-f,y+h-f,e-s,e-s]]){const k=f*.16;g.drawImage(F,sx,sy,s,s,cx-k,cy-k,f+2*k,f+2*k);}
    g.strokeStyle='rgba(224,178,96,.75)';g.lineWidth=2;g.strokeRect(a.x-1,a.y-1,this.w+2,this.h+2);g.strokeStyle='rgba(0,8,10,.6)';g.strokeRect(x-.5,y-.5,w+1,h+1);
    // spouts
    if(this.pour>.02){g.save();g.globalCompositeOperation='screen';for(const q of[.14,.5,.86]){const sx=a.x+this.w*q,yy=y+h-3,H=f*3.2,off=(this.time*500)%(f*2);g.globalAlpha=this.pour*.8;g.drawImage(this.fall,0,off,64,120,sx-f*.5,yy,f,H);}g.restore();}
    this.drawGauge(g);
  }
  /** Four seals at the four confirmed levels, and a float that rides the water. */
  private drawGauge(g:G){
    const a=this.area,t=this.time,N=this.labels.length;
    const seal=(x:number,y:number,r:number,i:number)=>{const on=i===this.step,past=i<this.step,pu=on?1+.12*this.sealPulse:1;g.save();g.translate(x,y);g.scale(pu,pu);
      if(on){g.globalCompositeOperation='lighter';const gr=g.createRadialGradient(0,0,0,0,0,r*1.9);gr.addColorStop(0,`rgba(255,196,90,${.5+.1*Math.sin(t*3)*this.calm+.4*this.sealPulse})`);gr.addColorStop(1,'rgba(255,180,70,0)');g.fillStyle=gr;g.fillRect(-r*2,-r*2,r*4,r*4);g.globalCompositeOperation='source-over';}
      const gr=g.createRadialGradient(-r*.3,-r*.4,r*.1,0,0,r);if(on){gr.addColorStop(0,'#ffe9ab');gr.addColorStop(.6,'#d99f3e');gr.addColorStop(1,'#7d5119');}else if(past){gr.addColorStop(0,'#a98a4e');gr.addColorStop(1,'#4a3a1d');}else{gr.addColorStop(0,'#2d4b4c');gr.addColorStop(1,'#12282c');}
      g.fillStyle=gr;g.beginPath();g.arc(0,0,r,0,7);g.fill();g.lineWidth=Math.max(1.5,r*.1);g.strokeStyle=on?'#fff1c4':past?'#86703f':'#557a74';g.stroke();g.lineWidth=1;g.strokeStyle='rgba(0,0,0,.35)';g.beginPath();g.arc(0,0,r*.8,0,7);g.stroke();
      g.font=`700 ${r*.82}px Georgia,serif`;g.textAlign='center';g.textBaseline='middle';g.fillStyle=on?'#3a2106':past?'#e8d3a0':'#a9c3ba';g.fillText('×'+this.labels[i],0,r*.05);g.restore();};
    if(a.gauge==='side'){
      const gx=a.x+this.w+a.f+a.g*.58,y0=a.y+this.h*.02,y1=a.y+this.h*.98,tw=a.g*.16,r=a.g*.36;
      g.fillStyle='rgba(6,20,24,.85)';round(g,gx-tw,y0-r*.6,tw*2,y1-y0+r*1.2,tw);g.fill();g.strokeStyle='#b98b45';g.lineWidth=2;g.stroke();
      const ly=lerp(y0,y1,1-this.level);g.save();round(g,gx-tw+3,y0-r*.6+3,tw*2-6,y1-y0+r*1.2-6,tw-2);g.clip();const gr=g.createLinearGradient(0,ly,0,y1);if(this.holy>.5){gr.addColorStop(0,'#fff0b8');gr.addColorStop(1,'#6fe0c0');}else{gr.addColorStop(0,'#8ff0f2');gr.addColorStop(1,'#1a6f8c');}g.fillStyle=gr;g.fillRect(gx-tw,ly,tw*2,y1-ly+r);g.restore();
      for(let i=0;i<N;i++){const k=this.holy>.5?1-i/(N-1):i/(N-1);seal(gx,lerp(y0+r*.5,y1-r*.5,k),r,i);}
    }else{
      const y=a.y-a.f-a.g*.5,r=a.g*.4,x0=a.x+this.w*.14,x1=a.x+this.w*.86;g.strokeStyle='#b98b45';g.lineWidth=r*.34;g.beginPath();g.moveTo(x0,y);g.lineTo(x1,y);g.stroke();g.strokeStyle='#0b2126';g.lineWidth=r*.22;g.stroke();
      g.strokeStyle=this.holy>.5?'#ffe39a':'#6fe0e6';g.lineWidth=r*.2;g.beginPath();g.moveTo(x0,y);g.lineTo(lerp(x0,x1,this.holy>.5?this.level:1-this.level),y);g.stroke();
      for(let i=0;i<N;i++)seal(lerp(x0,x1,i/(N-1)),y,r,i);
    }
  }
}
const popcount=(m:number)=>{let n=0;for(;m;m&=m-1)n++;return n;};
export function round(g:G,x:number,y:number,w:number,h:number,r:number){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
function caustics(){
  const n=192,c=document.createElement('canvas');c.width=c.height=n;const g=c.getContext('2d')!,d=g.createImageData(n,n),p:number[][]=[];let s=11;const r=()=>(s=(s*16807)%2147483647)/2147483647;for(let i=0;i<26;i++)p.push([r()*n,r()*n]);
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){let a=1e9,b=1e9;for(const q of p)for(const ox of[-n,0,n])for(const oy of[-n,0,n]){const e=(q[0]+ox-x)**2+(q[1]+oy-y)**2;if(e<a){b=a;a=e;}else if(e<b)b=e;}const v=Math.pow(clamp(1-(Math.sqrt(b)-Math.sqrt(a))/9),2.4),k=(y*n+x)*4;d.data[k]=170;d.data[k+1]=250;d.data[k+2]=255;d.data[k+3]=v*255;}
  g.putImageData(d,0,0);return c;
}
function falling(){
  const c=document.createElement('canvas');c.width=64;c.height=256;const g=c.getContext('2d')!;let s=5;const r=()=>(s=(s*16807)%2147483647)/2147483647;
  for(let i=0;i<150;i++){const x=r()*64,y=r()*256,h=40+r()*110,a=.05+r()*.2;for(const oy of[-256,0]){const gr=g.createLinearGradient(0,y+oy,0,y+oy+h);gr.addColorStop(0,'rgba(190,245,250,0)');gr.addColorStop(.5,`rgba(205,250,255,${a})`);gr.addColorStop(1,'rgba(190,245,250,0)');g.fillStyle=gr;g.fillRect(x,y+oy,1+r()*3,h);}}
  const m=g.createLinearGradient(0,0,64,0);m.addColorStop(0,'rgba(0,0,0,0)');m.addColorStop(.18,'#000');m.addColorStop(.82,'#000');m.addColorStop(1,'rgba(0,0,0,0)');g.globalCompositeOperation='destination-in';g.fillStyle=m;g.fillRect(0,0,64,256);return c;
}
