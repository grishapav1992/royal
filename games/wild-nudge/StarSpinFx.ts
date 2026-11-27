/**
 * Decorative canvas layers for Star Spin. They only illustrate events that the accepted server
 * round already contains: nothing here reads entropy, stakes or settlement amounts.
 * Coordinates are CSS pixels relative to the game root.
 */
type Rgb=string;
type Particle=
 |{k:'dot';x:number;y:number;vx:number;vy:number;g:number;life:number;decay:number;size:number;color:Rgb}
 |{k:'star';x:number;y:number;vx:number;vy:number;g:number;life:number;decay:number;size:number;rot:number;vr:number;color:Rgb}
 |{k:'ring';x:number;y:number;r:number;vr:number;life:number;decay:number;color:Rgb;lw:number}
 |{k:'bolt';x0:number;y0:number;x1:number;y1:number;life:number;decay:number;color:Rgb}
 |{k:'streak';a:number;r:number;v:number;life:number;decay:number;color:Rgb}
 |{k:'spiral';cx:number;cy:number;a:number;r:number;shrink:number;va:number;size:number;life:number;decay:number;color:Rgb}
 |{k:'travel';x0:number;y0:number;x1:number;y1:number;t:number;speed:number;lift:number;trail:[number,number][];life:number;decay:number;color:Rgb};
export const GOLD='255,214,140';
const MAX_PARTICLES=900;
export class StarSpinFx{
 private top:HTMLCanvasElement;private back:HTMLCanvasElement;private fx:CanvasRenderingContext2D;private amb:CanvasRenderingContext2D;
 private parts:Particle[]=[];private frame=0;private ambientFrame=0;private dead=false;private width=1;private height=1;private ratio=1;
 private warpUntil=0;private warpX=0;private warpY=0;private warpDense=7;private resize:ResizeObserver;
 private stars:{x:number;y:number;z:number;p:number}[]=[];private dust:{x:number;y:number;vx:number;vy:number;s:number}[]=[];
 private embers:{x:number;y:number;vx:number;vy:number;s:number;p:number}[]=[];
 private ship?:{x:number;y:number;v:number};private nextShip=performance.now()+3000;private meteor?:{x:number;y:number;vx:number;vy:number;l:number};private nextMeteor=performance.now()+5000;private lastAmbient=0;
 /** Read on every frame so the root decides whether motion is allowed. */
 constructor(private root:HTMLElement,private allowed:()=>boolean,private color:()=>Rgb,private bonus:()=>boolean,private spinning:()=>boolean){
  this.back=document.createElement('canvas');this.back.className='gn-ambient';this.top=document.createElement('canvas');this.top.className='gn-fx';
  for(const c of [this.back,this.top])c.setAttribute('aria-hidden','true');
  root.prepend(this.back);root.append(this.top);
  this.fx=this.top.getContext('2d')!;this.amb=this.back.getContext('2d')!;
  this.resize=new ResizeObserver(()=>this.fit());this.resize.observe(root);this.fit();
  this.ambientFrame=requestAnimationFrame(this.ambient);
 }
 private fit(){
  const w=Math.max(1,this.root.clientWidth),h=Math.max(1,this.root.clientHeight),r=Math.min(1.5,window.devicePixelRatio||1);
  if(w===this.width&&h===this.height&&r===this.ratio)return;this.width=w;this.height=h;this.ratio=r;
  for(const c of [this.top,this.back]){c.width=Math.round(w*r);c.height=Math.round(h*r);}
  this.fx.setTransform(r,0,0,r,0,0);this.amb.setTransform(r,0,0,r,0,0);
  const area=w*h;this.stars=Array.from({length:Math.min(220,Math.round(area/5200))},()=>({x:Math.random()*w,y:Math.random()*h*.6,z:Math.random()<.3?2:1,p:Math.random()*6}));
  this.dust=Array.from({length:Math.min(40,Math.round(area/28000))},()=>({x:Math.random()*w,y:Math.random()*h,vx:.03+Math.random()*.05,vy:-.02-Math.random()*.03,s:.6+Math.random()*1.5}));
 }
 /** A point relative to the root, from any element's rectangle. */
 at(el:Element,fx=.5,fy=.5){const r=el.getBoundingClientRect(),o=this.root.getBoundingClientRect();return{x:r.left-o.left+r.width*fx,y:r.top-o.top+r.height*fy};}
 private emit(p:Particle){if(!this.allowed()||this.dead)return;if(this.parts.length>=MAX_PARTICLES)this.parts.shift();this.parts.push(p);this.run();}
 private run(){if(!this.frame&&!this.dead)this.frame=requestAnimationFrame(this.tick);}
 sparks(x:number,y:number,n:number,color:Rgb,spread=1,up=0,g=.03){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,v=(.5+Math.random()*2.2)*spread;this.emit({k:'dot',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-up,g,life:1,decay:.01+Math.random()*.02,size:1+Math.random()*2.4,color});}}
 fountain(x:number,y:number,n:number){for(let i=0;i<n;i++)this.emit({k:'star',x,y,vx:(Math.random()-.5)*7,vy:-4-Math.random()*7,g:.16,life:1,decay:.008+Math.random()*.008,size:3+Math.random()*4,rot:Math.random()*6,vr:(Math.random()-.5)*.3,color:Math.random()<.5?GOLD:'255,246,220'});}
 ring(x:number,y:number,color:Rgb,max=120,lw=3){this.emit({k:'ring',x,y,r:6,vr:max/22,life:1,decay:.045,color,lw});}
 bolt(x0:number,y0:number,x1:number,y1:number,color:Rgb,life=.9){this.emit({k:'bolt',x0,y0,x1,y1,life,decay:.06,color});}
 travel(x0:number,y0:number,x1:number,y1:number,color:Rgb,speed=.03,lift=90){this.emit({k:'travel',x0,y0,x1,y1,t:0,speed,lift,trail:[],life:1,decay:0,color});}
 vortex(cx:number,cy:number,radius:number,n=90){for(let i=0;i<n;i++)this.emit({k:'spiral',cx,cy,a:Math.random()*7,r:radius*(.4+Math.random()*.9),shrink:.965+Math.random()*.015,va:.09+Math.random()*.05,size:1+Math.random()*2.5,life:1,decay:.006,color:Math.random()<.5?GOLD:'255,246,220'});}
 warp(x:number,y:number,ms:number,dense=7){if(!this.allowed())return;this.warpX=x;this.warpY=y;this.warpDense=dense;this.warpUntil=performance.now()+ms;this.run();}
 /** Removes every decorative particle at once: skip, pause, hide and close. */
 clear(){this.parts.length=0;this.warpUntil=0;if(this.frame)cancelAnimationFrame(this.frame);this.frame=0;this.fx.clearRect(0,0,this.width,this.height);}
 get active(){return this.parts.length+(this.warpUntil>performance.now()?1:0);}
 private jag(x0:number,y0:number,x1:number,y1:number,n=12,amp=16){const pts:[number,number][]=[[x0,y0]],dx=x1-x0,dy=y1-y0,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;for(let i=1;i<n;i++){const t=i/n,o=(Math.random()-.5)*amp*2*Math.sin(Math.PI*t);pts.push([x0+dx*t+nx*o,y0+dy*t+ny*o]);}pts.push([x1,y1]);return pts;}
 private stroke(pts:[number,number][],style:string,lw:number){const c=this.fx;c.strokeStyle=style;c.lineWidth=lw;c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.stroke();}
 private tick=()=>{
  this.frame=0;const c=this.fx,now=performance.now();c.clearRect(0,0,this.width,this.height);
  if(!this.allowed()){this.parts.length=0;this.warpUntil=0;return;}
  c.globalCompositeOperation='lighter';c.lineCap='round';c.lineJoin='round';
  if(this.warpUntil>now)for(let i=0;i<this.warpDense;i++)this.parts.push({k:'streak',a:Math.random()*Math.PI*2,r:10+Math.random()*40,v:2+Math.random()*3,life:1,decay:.01,color:Math.random()<.35?GOLD:'230,245,255'});
  const reach=Math.hypot(this.width,this.height);
  this.parts=this.parts.filter(p=>p.life>0);
  for(const p of this.parts){
   p.life-=p.decay;const al=Math.max(0,p.life);
   if(p.k==='dot'){p.x+=p.vx;p.y+=p.vy;p.vy+=p.g;p.vx*=.985;c.fillStyle=`rgba(${p.color},${al*.22})`;c.beginPath();c.arc(p.x,p.y,p.size*3.2,0,7);c.fill();c.fillStyle=`rgba(${p.color},${al})`;c.beginPath();c.arc(p.x,p.y,p.size,0,7);c.fill();}
   else if(p.k==='star'){p.x+=p.vx;p.y+=p.vy;p.vy+=p.g;p.rot+=p.vr;const s=p.size;c.save();c.translate(p.x,p.y);c.rotate(p.rot);c.fillStyle=`rgba(${p.color},${al})`;c.beginPath();for(let i=0;i<8;i++){const r=i%2?s*.38:s;c.lineTo(Math.cos(i*Math.PI/4)*r,Math.sin(i*Math.PI/4)*r);}c.fill();c.restore();if(p.y>this.height+20)p.life=0;}
   else if(p.k==='ring'){p.r+=p.vr;p.vr*=.96;c.strokeStyle=`rgba(${p.color},${al*.9})`;c.lineWidth=p.lw*al+.5;c.beginPath();c.arc(p.x,p.y,p.r,0,7);c.stroke();c.strokeStyle=`rgba(255,255,255,${al*.5})`;c.lineWidth=1;c.beginPath();c.arc(p.x,p.y,p.r*.92,0,7);c.stroke();}
   else if(p.k==='bolt'){const pts=this.jag(p.x0,p.y0,p.x1,p.y1,14,18);this.stroke(pts,`rgba(${p.color},${al*.25})`,10);this.stroke(pts,`rgba(${p.color},${al*.9})`,3.5);this.stroke(pts,`rgba(255,255,255,${al})`,1.4);if(Math.random()<.5){const k=4+Math.floor(Math.random()*6),[bx,by]=pts[k];this.stroke(this.jag(bx,by,bx+(Math.random()-.5)*80,by+Math.random()*50,5,8),`rgba(${p.color},${al*.6})`,1.5);}}
   else if(p.k==='streak'){p.v*=1.075;p.r+=p.v;const len=Math.min(220,p.v*7),x1=this.warpX+Math.cos(p.a)*p.r,y1=this.warpY+Math.sin(p.a)*p.r;c.strokeStyle=`rgba(${p.color},${al*.85})`;c.lineWidth=1.2+Math.min(2.5,p.v*.08);c.beginPath();c.moveTo(x1,y1);c.lineTo(x1+Math.cos(p.a)*len,y1+Math.sin(p.a)*len);c.stroke();if(p.r>reach)p.life=0;}
   else if(p.k==='spiral'){p.a+=p.va;p.r*=p.shrink;const x=p.cx+Math.cos(p.a)*p.r,y=p.cy+Math.sin(p.a)*p.r*.62;c.fillStyle=`rgba(${p.color},${al*.3})`;c.beginPath();c.arc(x,y,p.size*3,0,7);c.fill();c.fillStyle=`rgba(${p.color},${al})`;c.beginPath();c.arc(x,y,p.size,0,7);c.fill();if(p.r<4)p.life=0;}
   else{p.t=Math.min(1,p.t+p.speed);const t=p.t,mx=(p.x0+p.x1)/2,my=Math.min(p.y0,p.y1)-p.lift,x=(1-t)*(1-t)*p.x0+2*(1-t)*t*mx+t*t*p.x1,y=(1-t)*(1-t)*p.y0+2*(1-t)*t*my+t*t*p.y1;p.trail.push([x,y]);if(p.trail.length>18)p.trail.shift();p.trail.forEach(([tx,ty],i)=>{const q=i/p.trail.length;c.fillStyle=`rgba(${p.color},${q*.55})`;c.beginPath();c.arc(tx,ty,1+q*6,0,7);c.fill();});c.fillStyle='rgba(255,255,255,.95)';c.beginPath();c.arc(x,y,3.5,0,7);c.fill();if(t>=1){p.life=0;this.sparks(x,y,12,p.color,1.4);this.ring(x,y,p.color,60,2);}}
  }
  c.globalCompositeOperation='source-over';
  if(this.parts.length||this.warpUntil>now)this.run();else c.clearRect(0,0,this.width,this.height);
 };
 private ambient=(now:number)=>{
  if(this.dead)return;this.ambientFrame=requestAnimationFrame(this.ambient);
  const a=this.amb,w=this.width,h=this.height;
  if(!this.allowed()||document.hidden){if(this.lastAmbient){a.clearRect(0,0,w,h);this.lastAmbient=0;}return;}
  if(now-this.lastAmbient<33)return;const dt=this.lastAmbient?Math.min(80,now-this.lastAmbient):33;this.lastAmbient=now;
  a.clearRect(0,0,w,h);a.globalCompositeOperation='lighter';const fast=this.spinning()?4:1,rgb=this.color();
  for(const s of this.stars){s.x-=dt*(s.z===2?.008:.003)*fast;if(s.x<0)s.x+=w;const tw=.5+.5*Math.sin(now/800+s.p),fade=1-s.y/(h*.6);a.fillStyle=`rgba(210,240,255,${(.25+.55*tw)*fade*(s.z===2?1:.6)})`;a.fillRect(s.x,s.y,s.z,s.z);}
  for(const d of this.dust){d.x+=d.vx*dt*.06;d.y+=d.vy*dt*.06;if(d.y<0){d.y=h;d.x=Math.random()*w;}if(d.x>w)d.x=0;a.fillStyle=`rgba(${rgb},.2)`;a.beginPath();a.arc(d.x,d.y,d.s,0,7);a.fill();}
  if(this.bonus()&&this.embers.length<Math.min(70,w/16)&&Math.random()<.6)this.embers.push({x:Math.random()*w,y:-10,vy:.04+Math.random()*.06,vx:(Math.random()-.5)*.03,s:1+Math.random()*2.2,p:Math.random()*6});
  this.embers=this.embers.filter(e=>e.y<h+10&&(this.bonus()||Math.random()>.02));
  for(const e of this.embers){e.y+=e.vy*dt;e.x+=e.vx*dt+Math.sin(now/600+e.p)*.3;a.fillStyle='rgba(255,196,96,.25)';a.beginPath();a.arc(e.x,e.y,e.s*3,0,7);a.fill();a.fillStyle='rgba(255,232,170,.9)';a.beginPath();a.arc(e.x,e.y,e.s,0,7);a.fill();}
  if(!this.meteor&&now>this.nextMeteor)this.meteor={x:w*(.15+Math.random()*.6),y:-10,vx:.45,vy:.22,l:1};
  const m=this.meteor;if(m){m.x+=m.vx*dt;m.y+=m.vy*dt;m.l-=dt/1400;const g=a.createLinearGradient(m.x-110,m.y-54,m.x,m.y);g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(1,`rgba(255,255,255,${Math.max(0,m.l)})`);a.strokeStyle=g;a.lineWidth=2;a.beginPath();a.moveTo(m.x-110,m.y-54);a.lineTo(m.x,m.y);a.stroke();if(m.l<=0){this.meteor=undefined;this.nextMeteor=now+6000+Math.random()*7000;}}
  if(!this.ship&&now>this.nextShip)this.ship={x:-30,y:h*(.08+Math.random()*.18),v:.13+Math.random()*.06};
  const s=this.ship;if(s){s.x+=s.v*dt;const g=a.createLinearGradient(s.x-120,0,s.x,0);g.addColorStop(0,'rgba(160,220,255,0)');g.addColorStop(1,'rgba(160,220,255,.5)');a.strokeStyle=g;a.lineWidth=1.5;a.beginPath();a.moveTo(s.x-120,s.y);a.lineTo(s.x,s.y);a.stroke();a.fillStyle='rgba(235,248,255,1)';a.fillRect(s.x,s.y-1,3,2);if(Math.sin(now/160)>0){a.fillStyle='rgba(255,110,110,.9)';a.fillRect(s.x-8,s.y+2,2,2);}if(s.x>w+40){this.ship=undefined;this.nextShip=now+11000+Math.random()*7000;}}
  a.globalCompositeOperation='source-over';
 };
 destroy(){this.dead=true;this.clear();cancelAnimationFrame(this.ambientFrame);this.resize.disconnect();this.top.remove();this.back.remove();}
}
