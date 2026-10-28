import type {RacePhase} from './lastExitModel';
import {RouteTransition,routeProfiles} from './lastExitRoute';
import {LastExitAssets,type LastExitAssetState} from './LastExitAssets';
import {clamp,ease,mix,stuntFrame,nextStunt,crashMotion,ramGeometry,helicopterMotion,cargoMotion,cargoTiming} from './lastExitStunts';

/** All scenery and stunts are composed from photographic sprites on a 2D canvas. */
export class LastExitScene {
 private ctx:CanvasRenderingContext2D;
 private assets=new LastExitAssets();
 private observer:ResizeObserver;
 private asphalt=document.createElement('canvas');
 private route=new RouteTransition();
 private w=1000;private h=560;private clock=0;private last=0;private age=0;private crashClock=0;private roadClock=0;private roadVelocity=0;
 private phase:RacePhase='idle';private run='';private alive=true;private frames=0;
 private extraction?:ReturnType<typeof helicopterMotion>;
 private ram?:ReturnType<typeof ramGeometry>;
 private cargo?:ReturnType<typeof cargoMotion>;
 private shot={carX:0,carY:0,carWidth:0,helicopterY:0,cables:0,lift:0,label:'idle',variant:'drive'};
 constructor(private canvas:HTMLCanvasElement,private chooseStunt=nextStunt){
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas 2D unavailable');this.ctx=ctx;
  this.asphalt.width=512;this.asphalt.height=512;const tex=this.asphalt.getContext('2d')!,pixels=tex.createImageData(512,512);let seed=173;for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=((seed>>>24)-128)*.12;pixels.data[i]=139+n;pixels.data[i+1]=135+n;pixels.data[i+2]=124+n;pixels.data[i+3]=255;}tex.putImageData(pixels,0,0);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);this.resize();
 }
 get ready(){return this.assets.ready;}
 load(changed:(state:LastExitAssetState)=>void){return this.assets.load(state=>{this.canvas.dataset.assets=String(state.loaded);changed(state);});}
 private resize(){const r=this.canvas.getBoundingClientRect();this.w=Math.max(1,r.width);this.h=Math.max(1,r.height);const dpr=Math.min(1.5,devicePixelRatio||1);this.canvas.width=Math.round(this.w*dpr);this.canvas.height=Math.round(this.h*dpr);this.ctx.setTransform(dpr,0,0,dpr,0,0);}
 private loaded(name:string){return this.assets.get(name);}
 private sprite(name:string,x:number,y:number,w:number,angle=0,alpha=1){const i=this.loaded(name);if(!i)return;const h=w*i.naturalHeight/i.naturalWidth,c=this.ctx;c.save();c.translate(x,y);c.rotate(angle);c.globalAlpha=alpha;c.drawImage(i,-w/2,-h/2,w,h);c.restore();}
 private shadow(x:number,y:number,w:number,alpha=.35){const c=this.ctx;c.save();c.globalAlpha=alpha;const g=c.createRadialGradient(x,y,0,x,y,w*.55);g.addColorStop(0,'#17180f');g.addColorStop(1,'#17180f00');c.fillStyle=g;c.translate(x,y);c.scale(1,.22);c.fillRect(-w*.6,-w*.6,w*1.2,w*1.2);c.restore();}
 private road(horizon:number,drift:number,weights:number[]){
  const c=this.ctx,w=this.w,h=this.h,cx=w*.5+drift,t=this.roadClock,motion=clamp(this.roadVelocity/3.15);
  c.save();c.beginPath();c.moveTo(cx-w*.025,horizon);c.lineTo(cx+w*.025,horizon);c.lineTo(cx+w*.865,h);c.lineTo(cx-w*.865,h);c.closePath();c.clip();
  for(let y=Math.floor(horizon);y<h;y+=2){const p=(y-horizon)/(h-horizon),sy=((Math.sqrt(p)*340+t*230)%510);c.drawImage(this.asphalt,0,sy,512,2,0,y,w,2.5);}
  const rgb=[0,1,2].map(channel=>Math.round(routeProfiles.reduce((sum,p,i)=>sum+p.asphalt[channel]*weights[i],0)));c.fillStyle='rgb('+rgb.join(',')+')';c.globalAlpha=.22;c.fillRect(0,horizon,w,h-horizon);c.globalAlpha=1;
  c.restore();
  const haze=c.createLinearGradient(0,horizon,0,h);haze.addColorStop(0,'#d9c6a96b');haze.addColorStop(.2,'#c5bba31a');haze.addColorStop(1,'#655e4c1a');c.fillStyle=haze;c.fillRect(0,horizon,w,h-horizon);
  const project=(z:number,lane:number)=>({x:cx+lane*w*.79*z,y:horizon+(h-horizon)*z});
  for(const lane of [-1,-.33,.33,1])for(let j=0;j<8;j++){
   const q=(j/8+t*.30)%1,z=q*q,z2=Math.min(1,(q+.040)**2),a=project(z,lane),b=project(z2,lane);
   c.strokeStyle=Math.abs(lane)===1?'#e5d1a8':'#eee9d6';c.globalAlpha=.74;c.lineWidth=Math.max(.55,z*w*.004);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
  }c.globalAlpha=1;
  // The same road projection carries concrete urban walls and desert guardrails.
  const steel=routeProfiles.reduce((sum,p,i)=>sum+(p.steel?weights[i]:0),0);
  for(const side of [-1,1])for(let j=0;j<14;j++){
   const q=(j/14+t*.10)%1,z=q*q,z2=Math.min(1,(q+.066)**2);if(z<.008)continue;
   const a=project(z,side*1.12),b=project(z2,side*1.12),ah=h*.105*z,bh=h*.105*z2,aw=w*.065*z,bw=w*.065*z2;
   c.save();c.globalAlpha=1-steel;
   c.fillStyle=j%2?'#bab5a7':'#c8c1af';c.beginPath();c.moveTo(a.x,a.y-ah);c.lineTo(b.x,b.y-bh);c.lineTo(b.x,b.y);c.lineTo(a.x,a.y);c.closePath();c.fill();
   c.fillStyle='#ded5bf';c.beginPath();c.moveTo(a.x,a.y-ah);c.lineTo(b.x,b.y-bh);c.lineTo(b.x+side*bw,b.y-bh*.95);c.lineTo(a.x+side*aw,a.y-ah*.95);c.closePath();c.fill();
   c.strokeStyle='#77796d77';c.lineWidth=Math.max(.6,z*2);c.beginPath();c.moveTo(a.x,a.y-ah);c.lineTo(a.x,a.y);c.stroke();c.restore();
   if(steel>0){c.save();c.globalAlpha=steel;c.strokeStyle='#666c63';c.lineWidth=Math.max(.7,z*w*.003);c.beginPath();c.moveTo(a.x,a.y-ah*.83);c.lineTo(a.x,a.y);c.stroke();
    for(const level of [.45,.82]){c.strokeStyle=level>.5?'#d7d8ca':'#9fa79c';c.lineWidth=Math.max(1,z*w*.005);c.beginPath();c.moveTo(a.x,a.y-ah*level);c.lineTo(b.x,b.y-bh*level);c.stroke();}c.restore();}
   c.fillStyle=j%3?'#eee0ae':'#d4a45a';c.fillRect(a.x-side*z*w*.009,a.y-ah*.75,Math.max(1,z*w*.006),Math.max(1,ah*.14));
  }
  if(motion>.03)for(let j=0;j<18;j++){
   const q=(j/18+t*.19)%1,z=q*q,side=j%2?1:-1,lane=side*(.78+(j%5)*.17),a=project(z,lane),b=project(Math.max(0,z-.025-z*.055),lane);
   c.strokeStyle='rgba(226,217,194,'+(motion*z*.14)+')';c.lineWidth=Math.max(.6,z*w*.0015);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();
  }
  const props=this.loaded('routeProps');if(!props)return;
  const crops=[[16,90,410,348],[540,0,260,441],[926,0,363,441],[1337,256,428,168],[0,599,441,286],[445,564,444,317],[896,445,512,430],[1455,431,215,456]],heights=[.36,.93,.87,.18,.22,.17,.78,.97];
  for(let zone=0;zone<4;zone++){if(weights[zone]<.001)continue;
   for(let j=0;j<12;j++){const z=((j/12+t*.12)%1)**2;if(z<.025)continue;
    const side=j%2?1:-1,index=routeProfiles[zone].props[Math.floor(j/2)%2],[sx,sy,sw,sh]=crops[index];
    const foot=horizon+(h-horizon)*z,ph=h*heights[index]*z,pw=ph*sw/sh,x=cx+side*w*(.07+z*.88),opacity=Math.min(1,z*7)*weights[zone];
    if(z>.4&&motion>.1){c.globalAlpha=opacity*.14*motion;c.drawImage(props,sx,sy,sw,sh,x-pw/2-side*pw*.07,foot-ph-ph*.035,pw,ph);}
    c.globalAlpha=opacity;c.drawImage(props,sx,sy,sw,sh,x-pw/2,foot-ph,pw,ph);
   }
  }c.globalAlpha=1;
 }
 private backdrop(horizon:number,drift:number,weights:number[]){
  const c=this.ctx,w=this.w,h=this.h;let accumulated=0;
  for(let i=0;i<4;i++){
   const photo=this.loaded('route-'+routeProfiles[i].key),weight=weights[i];if(!photo||weight<=.00001)continue;
   const hp=routeProfiles[i].horizon,scale=Math.max(w/photo.naturalWidth,horizon/(photo.naturalHeight*hp),(h-horizon)/(photo.naturalHeight*(1-hp)))*1.025,bw=photo.naturalWidth*scale,bh=photo.naturalHeight*scale;
   c.save();c.globalAlpha=weight/(accumulated+weight);c.drawImage(photo,(w-bw)/2+drift*.3,horizon-bh*hp,bw,bh);c.restore();accumulated+=weight;
  }
  if(!accumulated){const photo=this.loaded('highway');if(photo){const scale=Math.max(w/photo.naturalWidth,h*.68/photo.naturalHeight),bw=photo.naturalWidth*scale,bh=photo.naturalHeight*scale;c.drawImage(photo,(w-bw)/2,horizon-bh*.638,bw,bh);}else{c.fillStyle='#bcb9a7';c.fillRect(0,0,w,h);}}
 }

 private police(x:number,y:number,width:number,angle:number,quiet:boolean,now:number){this.shadow(x,y+width*.27,width);this.sprite('patrol',x,y,width,angle);if(quiet)return;const c=this.ctx,red=Math.sin(now*.016)>0;c.save();c.globalCompositeOperation='screen';for(const side of [-1,1]){const px=x+side*width*.16,py=y-width*.20;const g=c.createRadialGradient(px,py,0,px,py,width*.12);g.addColorStop(0,side===(red?-1:1)?'#ff6a45bb':'#6cbaff88');g.addColorStop(1,'#ffffff00');c.fillStyle=g;c.fillRect(px-width*.12,py-width*.12,width*.24,width*.24);}c.restore();}
 private roadRamp(m:ReturnType<typeof cargoMotion>){
  const {x,z,nearY,lipY,nearHalf,farHalf}=m.ramp,c=this.ctx,h=this.h;if(lipY>h*1.07)return;
  const thick=Math.max(.6,h*.014*z);c.save();
  this.shadow(x,nearY,nearHalf*2,.36);
  c.fillStyle='#363a35';c.beginPath();c.moveTo(x-farHalf,lipY);c.lineTo(x-farHalf,lipY+thick*2);c.lineTo(x-nearHalf,nearY+thick);c.lineTo(x-nearHalf,nearY);c.closePath();c.fill();
  const g=c.createLinearGradient(0,lipY,0,nearY);g.addColorStop(0,'#878b7f');g.addColorStop(1,'#454e47');c.fillStyle=g;
  c.beginPath();c.moveTo(x-nearHalf,nearY);c.lineTo(x+nearHalf,nearY);c.lineTo(x+farHalf,lipY);c.lineTo(x-farHalf,lipY);c.closePath();c.fill();
  c.save();c.clip();for(let i=0;i<13;i++){const p=i/12,y=mix(lipY,nearY,p),half=mix(farHalf,nearHalf,p);c.strokeStyle=i%2?'#272f2b':'#a1a28e';c.lineWidth=Math.max(.5,z*1.5);c.beginPath();c.moveTo(x-half,y);c.lineTo(x+half,y);c.stroke();}c.restore();
  c.strokeStyle='#d6b46c';c.lineWidth=Math.max(1,z*3);for(const side of [-1,1]){c.beginPath();c.moveTo(x+side*nearHalf,nearY);c.lineTo(x+side*farHalf,lipY);c.stroke();}
  c.strokeStyle='#e1d6ad';c.lineWidth=Math.max(.7,z*2);c.beginPath();c.moveTo(x-farHalf,lipY);c.lineTo(x+farHalf,lipY);c.stroke();c.restore();
 }
 private rammingPolice(m:ReturnType<typeof ramGeometry>,quiet:boolean,now:number){
  const img=this.loaded('ram');if(!img)return;
  const rects=[[18,208,423,338],[448,209,465,335],[915,235,546,310]], [sx,sy,sw,sh]=rects[m.pose],c=this.ctx;
  this.shadow(m.x,m.foot,m.width,.4);
  // Upright yaw poses turn the nose inward while all four wheels remain on the road.
  c.save();c.translate(m.x,m.foot);c.scale(-m.side,1);c.drawImage(img,sx,sy,sw,sh,-m.width/2,-m.height,m.width,m.height);c.restore();
  if(!quiet&&m.contact>.15&&m.retreat<.9){c.save();c.globalAlpha=.22; c.fillStyle=Math.sin(now*.016)>0?'#fb6554':'#69b8ff';c.beginPath();c.ellipse(m.x,m.foot-m.height*.86,m.width*.09,m.height*.035,0,0,Math.PI*2);c.fill();c.restore();}
 }
 private contactSparks(m:ReturnType<typeof ramGeometry>,age:number){
  const t=age-.4;if(t<0||t>.34)return;const c=this.ctx,p=t/.34;
  c.save();c.globalAlpha=1-p;c.lineCap='round';
  for(let i=0;i<16;i++){const a=i*2.399,reach=m.width*(.025+p*(.13+(i%4)*.025)),x=m.panel+Math.cos(a)*reach,y=m.contactY+Math.sin(a)*reach*.55;c.strokeStyle=i%3?'#ffe5a2':'#ffffff';c.lineWidth=Math.max(1,m.width*.008*(1-p));c.beginPath();c.moveTo(m.panel,m.contactY);c.lineTo(x,y);c.stroke();}
  c.restore();
 }
 private yawCar(x:number,foot:number,width:number,progress:number){
  const img=this.loaded('yaw');if(!img){this.sprite('side',x,foot-width*.15,width);return;}
  const rects=[[27,234,429,285],[483,236,533,285],[1027,248,529,266],[1570,280,585,197]],index=Math.min(3,Math.round(progress*3)),[sx,sy,sw,sh]=rects[index],cw=width*mix(.84,1,progress),height=cw*sh/sw;
  this.ctx.drawImage(img,sx,sy,sw,sh,x-cw/2,foot-height,cw,height);
 }
 private depthCar(x:number,foot:number,width:number,frame:number,alpha=1){
  const img=this.loaded('depthRoll');if(!img){this.sprite('side',x,foot-width*.15,width,0,alpha);return;}
  const rects=[[18,270,426,129],[444,250,440,171],[904,248,426,181],[1330,254,427,172],[16,581,428,140],[444,567,437,170],[904,563,426,178],[1330,571,427,173]];
  const index=Math.round(frame)%8,c=this.ctx;
  const draw=(n:number,opacity:number)=>{if(opacity<=0)return;const [sx,sy,sw,sh]=rects[n],height=width*sh/sw;c.save();c.globalAlpha=opacity*alpha;c.drawImage(img,sx,sy,sw,sh,x-width/2,foot-height,width,height);c.restore();};
  draw(index,1);
 }
 private debris(x:number,y:number,width:number,age:number){const c=this.ctx,t=Math.max(0,age-.72);for(let i=0;i<21;i++){const dir=i%2?1:-1,s=(i*73%17)/17,life=Math.min(t,1.8),px=x+dir*width*(.12+life*(.25+s*.6)),py=y+width*.22-life*width*(.5+s*.7)+life*life*width*.55;c.save();c.translate(px,py);c.rotate(life*(i%3+2)*dir);c.globalAlpha=Math.max(.22,1-t*.12);if(i<4){const r=width*.044;c.fillStyle='#1c1d1c';c.beginPath();c.ellipse(0,0,r,r*.75,0,0,Math.PI*2);c.fill();c.strokeStyle='#8c8b7f';c.lineWidth=r*.25;c.stroke();}else if(i<8){const img=this.loaded('coupe');if(img)c.drawImage(img,img.naturalWidth*.25,img.naturalHeight*.5,img.naturalWidth*.16,img.naturalHeight*.11,-width*.07,-width*.04,width*.14,width*.08);}else{c.fillStyle=i%3?'#adb7b099':'#f4c77f';c.fillRect(0,0,width*.015,width*.007);}c.restore();}}
 paint(now:number,phase:RacePhase,value:number,quiet:boolean,runId='',restored=false){
  if(!this.alive||!this.assets.ready)return;
  const dt=this.last?Math.max(0,Math.min(.05,(now-this.last)/1000)):0;this.last=now;
  if(phase!==this.phase||runId!==this.run){this.phase=phase;this.run=runId;this.age=0;if(phase==='crashed')this.crashClock=this.clock;}else this.age+=dt;
  // The longest ending is complete at cargoTiming.exit. Restored results keep its final pose.
  if(restored&&(phase==='crashed'||phase==='escaped'))this.age=Math.max(this.age,cargoTiming.exit);
  const f=stuntFrame(phase,this.age,quiet,this.chooseStunt(runId,phase,value)),motion=crashMotion(this.age,quiet),c=this.ctx,w=this.w,h=this.h;
  if(!quiet)this.clock+=dt*f.travel*(.85+Math.min(.4,Math.log(Math.max(1,value))*.08));
  const target=quiet?0:f.travel*(phase==='racing'?2.65+.5*ease(this.age/4):2.85);
  this.roadVelocity=quiet?0:mix(this.roadVelocity,target,1-Math.exp(-dt*5));if(!quiet)this.roadClock+=dt*this.roadVelocity;
  const route=this.route.update(runId,phase,value,dt,quiet);
  const t=this.clock,active=phase==='racing',drift=quiet?0:Math.sin(t*.85)*w*.014,hy=h*.56;
  c.clearRect(0,0,w,h);c.save();const shake=!quiet&&phase==='crashed'?Math.sin(f.age*57)*(Math.max(0,1-Math.abs(f.age-3.48)/.3)*h*.012+Math.max(0,1-Math.abs(f.age-.46)/.18)*w*.013):0;const flow=quiet?0:clamp(this.roadVelocity/3.15),rush=active?flow:0,rumble=Math.sin(now*.105)*h*.0011*rush;
  c.translate(shake,shake*.4+rumble);const lens=1.025-flow*.025;c.translate(w*.5,hy);c.scale(lens,lens);c.translate(-w*.5,-hy);
  this.backdrop(hy,drift,route.weights);
  this.road(hy,drift,route.weights);
  let carW=Math.min(w*.32,342),carX=w*.5+(quiet?0:Math.sin(t*2)*w*.028),ground=h*.96,carY=ground-carW*.29+(active&&!quiet?Math.sin(now*.08)*carW*.002*clamp(this.roadVelocity/3.15):0);
  const crash=phase==='crashed',escape=phase==='escaped';
  let crashGround=ground;
  if(crash){carX=mix(w*.5+(quiet?0:Math.sin(this.crashClock*2)*w*.028)+f.direction*w*.12*f.hit,w*(.5+f.direction*.16),motion.depth);carW*=mix(1,1.25,motion.sideways)*motion.scale;crashGround=h*motion.ground;carY=crashGround-h*motion.hop-carW*.16;}
  const extraction=helicopterMotion(this.age,w,h,quiet,carX);
  if(f.helicopter){carX=extraction.carX;carY=extraction.carY;carW=extraction.carW;}
  this.extraction=f.helicopter?extraction:undefined;
  const {heliW,heliX,heliY}=extraction;
  this.cargo=f.plane?cargoMotion(this.age,w,h,quiet,carX):undefined;
  if(this.cargo){const m=this.cargo;carX=m.carX;carY=m.carY;carW=m.carW;
   if(m.planeVisible){this.shadow(m.planeX,h*.82,m.planeW,.16*(1-m.depart));this.sprite('plane',m.planeX,m.planeY,m.planeW);}
   this.roadRamp(m);
  }
  this.ram=undefined;
  const cops:Array<{x:number;y:number;width:number;angle:number;ram?:ReturnType<typeof ramGeometry>}>=[];
  if(phase==='racing'||phase==='waiting'||crash||escape){for(const side of [-1,1]){
   const ct=crash?this.crashClock:t,pw=Math.min(w*.23,262);
   const initialX=w*(.5+side*.30)+(quiet?0:Math.sin(ct*1.8+side)*w*.036),initialFoot=h*.90+(quiet?0:Math.sin(ct*1.3+side)*h*.045);
   let x=initialX,foot=initialFoot,width=pw,angle=quiet?0:Math.sin(ct*1.8+side)*.025,ram:ReturnType<typeof ramGeometry>|undefined;
   if(crash){if(side===-f.direction){
     ram=ramGeometry(f.age,w,h,side,carX,carW,initialX,initialFoot);this.ram=ram;
     x=ram.x;foot=ram.foot;width=ram.width;angle=0;
    }else{x+=side*w*.18*ease((f.age-.24)/.4);foot+=h*.12*ease((f.age-.5)/1.2);angle=0;}
   }
   if(escape){foot+=h*.20*f.lift;width*=1-f.lift*.12;}
   cops.push({x,y:foot-width*.28,width,angle,ram});
  }}
  for(const cop of cops.filter(p=>p.ram||p.y<carY)){if(cop.ram)this.rammingPolice(cop.ram,quiet,now);else this.police(cop.x,cop.y,cop.width,cop.angle,quiet,now);}
  this.shadow(carX,f.helicopter?extraction.groundY:crash?crashGround:ground,carW*(escape?1-f.lift*.35:1),crash?.4*(1-motion.hop*3):f.plane?.35*(1-f.jump):escape?.35*(1-f.lift*.9):.4);
  if(active&&!quiet){for(const side of [-1,1]){c.strokeStyle='#ded4bd26';c.lineWidth=carW*.025;c.beginPath();c.moveTo(carX+side*carW*.36,ground);c.lineTo(carX+side*carW*.5,ground+h*.12);c.stroke();}}
  if(crash){if(f.age<.74)this.yawCar(carX,crashGround,carW,motion.sideways);else this.depthCar(carX,crashGround-h*motion.hop,carW,motion.frame);}else if(this.cargo){
   const m=this.cargo;c.save();
   // The doorway occludes the bodywork while the opaque car drives into the hold.
   if(m.age>=cargoTiming.takeoff){c.beginPath();c.rect(0,m.portalTop,w,h*2);c.clip();}
   c.filter='brightness('+(1-m.entry*.70)+')';this.sprite('coupe',carX,carY,carW);c.restore();
  }else this.sprite('coupe',carX,carY,carW,active&&!quiet?Math.sin(t*2)*.025:escape&&!quiet?Math.sin(f.age*2.3)*.035*f.lift:0);
  if(crash&&this.ram&&!quiet)this.contactSparks(this.ram,f.age);
  if(crash&&f.debris)this.debris(w*(.5+f.direction*.06),h*.87,Math.min(w*.32,342),f.age);
  for(const cop of cops.filter(p=>!p.ram&&p.y>=carY))this.police(cop.x,cop.y,cop.width,cop.angle,quiet,now);
  if(f.helicopter){
   for(const {ax,ay,bx,by}of extraction.ropes){const ex=mix(ax,bx,f.cables),ey=mix(ay,by,f.cables);c.strokeStyle='#e5ddcc';c.lineWidth=Math.max(.6,heliW*.003);c.shadowColor='#101813';c.shadowBlur=2;c.beginPath();c.moveTo(ax,ay);c.lineTo(ex,ey);c.stroke();c.shadowBlur=0;}
   this.sprite('helicopter',heliX,heliY,heliW);
   if(!quiet){const rx=heliX,ry=heliY-heliW*.267;c.save();c.translate(rx,ry);c.scale(1,.13);c.rotate(now*.035);c.fillStyle='#343c3c55';c.beginPath();c.ellipse(0,0,heliW*.63,heliW*.63,0,0,Math.PI*2);c.fill();c.fillStyle='#222b2b80';for(let i=0;i<4;i++){c.rotate(Math.PI/2);c.beginPath();c.moveTo(0,0);c.lineTo(heliW*.61,-heliW*.018);c.lineTo(heliW*.61,heliW*.018);c.fill();}c.restore();
    for(let i=0;i<5;i++){const p=(f.age*.9+i/5)%1;c.strokeStyle=`rgba(225,217,193,${(1-p)*.15*(1-f.lift)})`;c.lineWidth=2;c.beginPath();c.ellipse(carX,extraction.groundY,carW*(.4+p*.9),carW*(.08+p*.18),0,0,Math.PI*2);c.stroke();}}
  }
  if(crash&&f.explosion){const p=ease((f.age-3.48)/.3),size=Math.min(carW*2.2,430)*( .45+p*.55);this.sprite('explosion',carX,crashGround-size*.28,size,0,Math.max(.52,1-(f.age-3.8)*.1));if(!quiet&&f.age<3.69){c.fillStyle=`rgba(255,221,160,${(1-(f.age-3.48)/.21)*.28})`;c.fillRect(0,0,w,h);}}
  const vignette=c.createRadialGradient(w*.5,h*.55,w*.18,w*.5,h*.55,w*.75);vignette.addColorStop(0,'#19201900');vignette.addColorStop(1,'#19201966');c.fillStyle=vignette;c.fillRect(0,0,w,h);c.restore();
  this.frames++;this.shot={carX,carY,carWidth:carW,helicopterY:heliY,cables:f.cables,lift:f.lift,label:f.label,variant:f.variant};Object.assign(this.canvas.dataset,{renderer:'canvas2d',phase,variant:f.variant,cinematic:f.label,restored:String(restored),frames:String(this.frames),location:route.key,locationIndex:String(route.index),locationBlend:route.progress.toFixed(3)});
 }
 locationIndex(){return this.route.inspect().index;}
 presentationSeconds(){return this.age;}
 inspect(){return {route:this.route.inspect(),cargo:this.cargo??null,ram:this.ram??null,extraction:this.extraction??null,roadVelocity:this.roadVelocity,roadClock:this.roadClock,renderer:'canvas2d',phase:this.phase,age:this.age,frames:this.frames,...this.shot};}
 destroy(){this.alive=false;this.observer.disconnect();this.assets.destroy();}
}
