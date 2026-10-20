import type {RacePhase} from './lastExitModel';

const base='/assets/last-exit/v1/';
export class LastExitScene {
 private ctx:CanvasRenderingContext2D;
 private images=new Map<string,HTMLImageElement>();
 private observer:ResizeObserver;
 private w=1000;private h=560;private clock=0;private last=0;private phase:RacePhase='idle';private changed=0;
 private alive=true;
 constructor(private canvas:HTMLCanvasElement){
  this.ctx=canvas.getContext('2d')!;
  for(const name of ['highway','coupe','patrol','explosion']){const img=new Image();img.onload=()=>{if(this.alive)this.canvas.dataset.assets=String([...this.images.values()].filter(i=>i.complete&&i.naturalWidth).length);};img.src=base+name+'.webp';this.images.set(name,img);}
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);this.resize();
 }
 private resize(){const r=this.canvas.getBoundingClientRect();this.w=Math.max(1,r.width);this.h=Math.max(1,r.height);const dpr=Math.min(2,devicePixelRatio||1);this.canvas.width=Math.round(this.w*dpr);this.canvas.height=Math.round(this.h*dpr);this.ctx.setTransform(dpr,0,0,dpr,0,0);}
 private image(name:string,x:number,y:number,w:number,alpha=1,angle=0){const i=this.images.get(name);if(!i?.complete||!i.naturalWidth)return;const h=w*i.naturalHeight/i.naturalWidth,c=this.ctx;c.save();c.globalAlpha=alpha;c.translate(x,y);c.rotate(angle);c.drawImage(i,-w/2,-h,w,h);c.restore();}
 paint(now:number,phase:RacePhase,value:number,quiet:boolean){
  const c=this.ctx,w=this.w,h=this.h;
  if(phase!==this.phase){this.phase=phase;this.changed=now;}
  const dt=this.last?Math.min(.05,(now-this.last)/1000):0;this.last=now;
  const moving=phase==='racing'&&!quiet;
  if(moving)this.clock+=dt*(.28+Math.log(Math.max(value,1))*.17);
  const t=this.clock,age=(now-this.changed)/1000,shake=phase==='crashed'&&!quiet&&age<.6?(1-age/.6)*7:0;
  c.clearRect(0,0,w,h);c.save();c.translate(Math.sin(now*.06)*shake,Math.cos(now*.07)*shake);
  const road=this.images.get('highway');
  if(road?.complete&&road.naturalWidth){const scale=Math.max(w/road.naturalWidth,h/road.naturalHeight)*1.025;const bw=road.naturalWidth*scale,bh=road.naturalHeight*scale;c.drawImage(road,(w-bw)/2+(moving?Math.sin(t*2)*2:0),(h-bh)/2,bw,bh);}else{c.fillStyle='#b5aea0';c.fillRect(0,0,w,h);}
  const shade=c.createLinearGradient(0,0,0,h);shade.addColorStop(0,'#11161055');shade.addColorStop(.4,'#12171400');shade.addColorStop(1,'#17181488');c.fillStyle=shade;c.fillRect(0,0,w,h);
  // Decorative road motion depends on elapsed presentation time, never hidden outcomes.
  if(moving){
   const horizon=h*.61;
   for(let lane=-1;lane<=1;lane+=2){for(let i=0;i<12;i++){const z=((i/12+t*.42)%1),z2=Math.min(1,z+.034);const x=w*.5+lane*w*.36*z*z,y=horizon+(h-horizon)*z*z;const x2=w*.5+lane*w*.36*z2*z2,y2=horizon+(h-horizon)*z2*z2;c.strokeStyle='#e1d2b766';c.lineWidth=Math.max(.5,z*5);c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.stroke();}}
   for(let i=0;i<25;i++){const z=(i*.173+t*.64)%1,x=((i*153.17)%w),y=h*.55+h*.45*z;c.strokeStyle='#f1e0bd22';c.lineWidth=1;c.beginPath();c.moveTo(x,y);c.lineTo(x+(x-w/2)*z*.05,y+z*18);c.stroke();}
  }
  // Patrols remain behind the lead car; their lights are decorative.
  const pursuit=phase==='racing'||phase==='waiting'||phase==='crashed';
  if(pursuit){
   for(const side of [-1,1]){const x=w*(.5+side*.33)+(moving?Math.sin(t*2+side)*w*.025:0),y=h*.99;this.image('patrol',x,y,Math.min(w*.22,260),.92);
    if(moving&&!quiet){const bright=(Math.sin(now*.008+side)>0);c.fillStyle=bright?'#b83f3540':'#41678130';c.beginPath();c.ellipse(x,y-h*.05,w*.13,h*.08,0,0,Math.PI*2);c.fill();}
   }
  }
  let carX=w*.5,carY=h*.98,carW=Math.min(w*.32,320),alpha=1;
  if(moving){carX+=Math.sin(t*2.1)*w*.034;carY+=Math.sin(now*.045)*.8;}
  if(phase==='escaped'){const p=quiet?1:Math.min(1,age/1.7);carW*=1-p*.67;carY-=p*h*.21;carX+=p*w*.10;alpha=1-p*.1;}
  if(phase==='crashed'){carX+=w*.04;alpha=.7;}
  c.fillStyle='#0005';c.beginPath();c.ellipse(carX,carY-2,carW*.47,carW*.09,0,0,Math.PI*2);c.fill();
  this.image('coupe',carX,carY,carW,alpha,phase==='crashed'?.12:moving?Math.sin(t*2.1)*.016:0);
  if(phase==='crashed'){
   const p=quiet?1:Math.min(1,age*2);this.image('explosion',carX,h*.98,Math.min(w*.66,740)*(.65+p*.35),quiet?.78:Math.max(.55,1-age*.08));
   if(!quiet&&age<.4){c.fillStyle=`rgba(255,218,157,${(1-age/.4)*.24})`;c.fillRect(0,0,w,h);}
  }
  if(moving&&!quiet&&t>2){const beat=Math.floor(t/4);const pulse=(t%4)/4;if(beat%3===1&&pulse<.22)this.image('explosion',w*.88,h*.65,Math.min(220,w*.21),Math.sin(pulse/.22*Math.PI)*.7);}
  const edge=c.createRadialGradient(w/2,h*.5,w*.14,w/2,h*.5,w*.7);edge.addColorStop(0,'#0000');edge.addColorStop(1,'#15150f88');c.fillStyle=edge;c.fillRect(0,0,w,h);
  c.restore();this.canvas.dataset.phase=phase;
 }
 destroy(){this.alive=false;this.observer.disconnect();for(const img of this.images.values())img.onload=null;this.images.clear();}
}
