import {Pursuit,rollPath,LEN,WALL,type Car,type Hero,type Prop} from './pursuit';
import {clamp,ease,mix,outCubic,rng,asphaltTile,gravelTile,puffs,glow,Bits,type Bit,type Phase,type Variant} from './kit';

export const zones=[
 {key:'industrial',min:1,horizon:.505,tint:[132,128,119],ground:[158,141,112],side:[.92,.92],props:[0,1],steel:0,sun:null},
 {key:'interchange',min:2,horizon:.515,tint:[128,128,123],ground:[150,143,127],side:[.9,.9],props:[2,3],steel:0,sun:[.03,.02]},
 {key:'highway',min:4,horizon:.505,tint:[144,133,112],ground:[186,158,112],side:[.94,.94],props:[4,5],steel:1,sun:null},
 {key:'last-exit',min:8,horizon:.478,tint:[140,138,125],ground:[146,132,92],side:[0,.92],props:[6,7],steel:0,sun:[.03,.04]},
] as const;
export const zoneOf=(v:number)=>v>=8?3:v>=4?2:v>=2?1:0;
export const impactAt=.4,rollAt=.72,explosionAt=3.48;
export const heli={cables:.8,lift:2.25,depart:4.1,end:7.6};
export const cargo={planeAt:1.15,planeReady:2.9,rampNear:3.05,takeoff:3.5,landing:4.55,inside:5.05,departure:5.25,exit:9};
export const coast={brake:.5,turn:1.15,left:2.6,stop:2.3,slide:3.75,end:8};
/** Distance from the gore to the tunnel mouth. */
const MOUTH=2.6;
export const pickVariant=(phase:Phase,value:number,id:number):Variant=>phase==='crashed'?(id%2?'pit-left':'pit-right'):phase!=='escaped'?'drive':value>=8?'coast':value>2?'cargo-plane':'helicopter';

const PROPS=[[16,90,410,348],[540,0,260,441],[926,0,363,441],[1337,256,428,168],[0,599,441,286],[445,564,444,317],[896,445,512,430],[1455,431,215,456]];
const PROP_H=[.66,1.6,1.3,.26,.34,.28,1.3,1.75];
const YAW=[[27,234,429,285],[483,236,533,285],[1027,248,529,266],[1570,280,585,197]];
const RAM=[[18,208,423,338],[448,209,465,335],[915,235,546,310],[1476,273,675,250]];
const ROLL=[[18,270,426,129],[444,250,440,171],[904,248,426,181],[1330,254,427,172],[16,581,428,140],[444,567,437,170],[904,563,426,178],[1330,571,427,173]];
const BOX:Record<string,number[]>={coupe:[147,119,1244,811],patrol:[152,64,1193,923],helicopter:[206,61,1129,911],'cargo-plane':[18,62,1500,817]};
type P={x:number;y:number;s:number};

export class Scene {
 private c:CanvasRenderingContext2D;
 private road=asphaltTile();private gravel=gravelTile();
 private smoke=puffs('#d9d2c4');private dust=puffs('#cdb48a');private black=puffs('#2c2722');private hot=puffs('#ffc24a');private ember=puffs('#f06a1a');
 private red=glow('#ff4a2e');private blue=glow('#4f9bff');private flame=glow('#ffa640');private white=glow('#fff1cf');
 private bits=new Bits();
 private w=1;private h=1;private hy=1;private G=1;private R=1;private U=1;private portrait=false;
 private dist=0;private vel=0;private camX=0;private vpx=0;private carX=0;private carVX=0;private roll=0;private pitch=0;private kick=0;private shake=0;
 private weights=[1,0,0,0];private zone=0;private bridge=-99;private bridgeTo=0;
 private phase:Phase='idle';private run='';private age=0;private clock=0;private last=0;private since=0;private gear=-1;private flash=0;
 private sim=new Pursuit({
  hit:(x,y,z,p,side)=>{this.sparks(x,y,z,Math.round(10+16*p),.6+p*.5);this.glass(x,y+.05,z,Math.round(2+6*p));if(p>.7)this.panels(x,y,z,Math.round(p*2));this.shake=Math.max(this.shake,clamp(.18+p*.28,0,.75)/Math.max(1,z*.7));this.stop=Math.max(this.stop,p>1?.05:0);},
  scrape:(x,z,side,p)=>{if(this.bits.rand()<.75*p){this.sparks(x-side*.02,.08,z,2,.7);}},
  contact:(c,p)=>{this.dustRing(c.x,c.z,8,.55+p*.4,1,c.v);this.sparks(c.x,.05,c.z,9,.8,c.v);this.panels(c.x,.1,c.z,2,c.v);this.glass(c.x,.15,c.z,4,c.v);this.shake=Math.max(this.shake,.35/Math.max(1,c.z*.6));this.mark(c.x,c.z,.16);},
  wreck:c=>{if(c.kind==='cop')this.beacon(c);if(this.bits.rand()<.45)c.burn=1;},
  boom:(x,z,size,v)=>this.blast(x,z,size,v),
  smash:(p,v)=>this.smash(p,v),
  hero:p=>{this.shake=Math.max(this.shake,clamp(.25+p*.25,0,.8));this.kick=Math.max(this.kick,.4);this.scuff=Math.min(6,this.scuff+p*.35);},
 });
 private hero:Hero={x:0,vx:0,hw:.17,z:1.055,bias:0};private booms:{x:number;z:number;age:number;size:number;v:number}[]=[];private stop=0;private scuff=0;private drift=0;private pose=0;private path?:ReturnType<typeof rollPath>;private tints:Record<string,HTMLCanvasElement>[]=[];private under?:HTMLCanvasElement;
 private fired=new Set<string>();private skid:{x:number;z:number;w:number;l:number}[]=[];private wreck={x:0,z:3};
 private seedRun=1;variant:Variant='drive';top=0;shot='idle';zoneIndex=0;speed=0;rpm=0;
 constructor(private canvas:HTMLCanvasElement,private img:Record<string,HTMLImageElement>){
  this.c=canvas.getContext('2d',{alpha:false})!;this.paintTraffic();this.buildCliff();this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(canvas);this.resize();
 }
 private resize(){const w=this.canvas.clientWidth||1,h=this.canvas.clientHeight||1,d=Math.min([1.5,1.1,.8][this.quality]??1.5,devicePixelRatio||1);this.w=w;this.h=h;this.canvas.width=Math.round(w*d);this.canvas.height=Math.round(h*d);this.c.setTransform(d,0,0,d,0,0);
  this.portrait=h>w*1.05;this.hy=h*(this.portrait?.49:.5);this.G=h-this.hy;this.R=this.portrait?w*1.02:Math.min(w*.79,h*1.5);this.U=this.portrait?w*.62:Math.min(this.R*.5,h*.8);}
 private get carW(){return this.portrait?this.w*.46:Math.min(this.w*.238,this.h*.46);}
 private at(X:number,z:number,Y=0):P{const s=1/z;return {x:this.vpx+(X-this.camX)*this.R*s,y:this.hy+this.G*s-Y*this.U*s,s};}
 private get carZ(){return 1.055;}
 private get copW(){return this.portrait?this.w*.31:Math.min(this.w*.188,this.h*.37);}
 /** Traffic reuses the coupe with repainted bodywork. Glass, rubber, lamps and chrome keep their own colour. */
 private paintTraffic(){
  const colors=[[0,0,0],[150,38,32],[44,84,132],[158,152,138]];
  this.tints=colors.map((rgb,k)=>{const out:Record<string,HTMLCanvasElement>={};if(!k)return out;for(const name of ['coupe','coupe-depth-roll','coupe-yaw']){const im=this.img[name];if(!im)continue;const cv=document.createElement('canvas');cv.width=im.naturalWidth>>1;cv.height=im.naturalHeight>>1;const g=cv.getContext('2d')!;g.drawImage(im,0,0,cv.width,cv.height);const d=g.getImageData(0,0,cv.width,cv.height),a=d.data;
   for(let i=0;i<a.length;i+=4){if(a[i+3]<8)continue;const r=a[i],gg=a[i+1],b=a[i+2],lum=.3*r+.6*gg+.1*b,sat=Math.max(r,gg,b)-Math.min(r,gg,b),m=clamp((lum-30)/26)*clamp((150-lum)/40)*clamp((46-sat)/18);if(m<=0)continue;const q=Math.pow(lum/74,.85);a[i]=mix(r,rgb[0]*q,m);a[i+1]=mix(gg,rgb[1]*q,m);a[i+2]=mix(b,rgb[2]*q,m);}g.putImageData(d,0,0);out[name]=cv;}return out;});
 }

 // ---------------------------------------------------------------- scenery
 private backdrop(){
  const {c,w,h,hy}=this;let acc=0;
  for(let i=0;i<4;i++){const k=this.weights[i],p=this.img['route-'+zones[i].key];if(k<.001||!p)continue;
   const hp=zones[i].horizon,sc=Math.max(w*1.06/p.naturalWidth,hy*1.02/(p.naturalHeight*hp),(h-hy)*.9/(p.naturalHeight*(1-hp))),bw=p.naturalWidth*sc,bh=p.naturalHeight*sc;
   c.globalAlpha=k/(acc+k);c.drawImage(p,this.vpx-bw/2-this.camX*w*.01,hy-bh*hp,bw,bh);acc+=k;}
  c.globalAlpha=1;
 }
 private ground(flow:number){
  const {c,w,h,hy,G,R}=this;const W=this.weights;
  const sum=(f:(z:typeof zones[number])=>number)=>zones.reduce((a,z,i)=>a+f(z)*W[i],0);
  const col=[0,1,2].map(k=>Math.round(sum(z=>z.ground[k]))).join(',');
  for(const side of [0,1]){const a=sum(z=>z.side[side]);if(a<.02)continue;
   c.save();c.beginPath();const far=this.at(side?1.2:-1.2,60),near=this.at(side?1.2:-1.2,.97);c.moveTo(far.x,far.y);c.lineTo(near.x,near.y);c.lineTo(side?w+400:-400,near.y);c.lineTo(side?w+400:-400,far.y);c.closePath();c.clip();
   const g=c.createLinearGradient(0,hy,0,h);g.addColorStop(0,`rgba(${col},0)`);g.addColorStop(.1,`rgba(${col},${.25*a})`);g.addColorStop(.38,`rgba(${col},${a})`);g.addColorStop(1,`rgba(${col},${a})`);c.fillStyle=g;c.fillRect(-20,hy,w+40,G+2);
   for(let y=Math.floor(hy+G*.06);y<h&&this.quality<1;y+=2){const s=(y+1-hy)/G,z=1/s,foot=z*z/G*64+flow*.18,m=clamp(Math.round(Math.log2(Math.max(1,foot))),0,6),t=this.gravel[m],u=((this.dist+z)*64%512+512)%512/512*t.height;c.globalAlpha=a*.5*clamp((s-.06)*4);const span=R*s*2.6,x0=this.vpx-this.camX*R*s;for(let x=x0-Math.ceil((x0+10)/span)*span;x<w+10;x+=span)c.drawImage(t,0,Math.min(t.height-1,Math.floor(u)),512,1,x,y,span+1,2.3);}
   c.restore();}
  // Asphalt rows use true inverse depth and a speed-dependent mip.
  for(let y=Math.floor(hy)+1;y<h+2;){const s=Math.max(.004,(y+.5-hy)/G),z=1/s,step=s<.12?1+(this.quality>1?1:0):2+this.quality,foot=z*z/G*128*step+flow*128*.02;
   const m=clamp(Math.floor(Math.log2(Math.max(1,foot))),0,this.road.length-1),t=this.road[m],u=((this.dist+z)*128%1024+1024)%1024/1024*t.height;
   c.globalAlpha=clamp((s-.01)*22);const hw=R*s*1.25,x=this.vpx-this.camX*R*s;c.drawImage(t,0,Math.min(t.height-1,Math.floor(u)),1024,1,x-hw,y,hw*2,step+.4);y+=step;}
  c.globalAlpha=1;
  const tint=[0,1,2].map(k=>Math.round(sum(z=>z.tint[k]))).join(',');c.save();this.roadPath();c.clip();c.globalCompositeOperation='soft-light';c.fillStyle=`rgba(${tint},.5)`;c.fillRect(0,hy,w,G);c.restore();
  const haze=c.createLinearGradient(0,hy-G*.05,0,hy+G*.3);haze.addColorStop(0,'#d9c6a900');haze.addColorStop(.17,'#d9c9ac80');haze.addColorStop(1,'#d9c6a900');c.fillStyle=haze;c.fillRect(0,hy-G*.05,w,G*.35);
 }
 private roadPath(){const c=this.c,a=this.at(-1.25,200),b=this.at(1.25,200),d=this.at(1.25,.95),e=this.at(-1.25,.95);c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.lineTo(d.x,d.y);c.lineTo(e.x,e.y);c.closePath();}
 /** Barrier joints travel with the road; a gap opens on the left for the coast exit. */
 private barrier(gap?:{from:number;to:number}){
  const c=this.c,steel=this.weights[2],step=2.5,off=this.dist%step;
  for(const side of [-1,1])for(let j=16;j>=0;j--){
   let z1=j*step-off+.55,z2=z1+step;if(z2<.72)continue;z1=Math.max(z1,.6);
   if(gap&&side>0){if(z1>gap.from&&z2<gap.to)continue;if(z1<gap.from&&z2>gap.from)z2=gap.from;else if(z1<gap.to&&z2>gap.to)z1=gap.to;}
   const X=side*1.17,a=this.at(X,z1),b=this.at(X,z2),H=.17,at=this.at(X,z1,H),bt=this.at(X,z2,H),ao=this.at(X+side*.075,z1,H),bo=this.at(X+side*.075,z2,H);
   const fade=clamp((34-z1)/10);
   if(steel<.99){c.globalAlpha=(1-steel)*fade;const g=c.createLinearGradient(0,at.y,0,a.y);g.addColorStop(0,'#cfc6b3');g.addColorStop(.5,'#b1a896');g.addColorStop(1,'#857d6d');c.fillStyle=g;quad(c,at,bt,b,a);
    c.fillStyle='#e6dcc6';quad(c,at,bt,bo,ao);
    const calm=clamp((this.vel-8)/10);c.strokeStyle='#5f594c';c.globalAlpha=(1-steel)*fade*mix(.53,.18,calm);c.lineWidth=Math.max(.5,a.s*2.4);line(c,at,a);c.globalAlpha=(1-steel)*fade*mix(1,.45,calm);
    c.fillStyle=(j+Math.floor(this.dist/step))%2?'#f0d890':'#d98b4a';const rw=Math.max(1,a.s*this.R*.012),rh=Math.max(1,a.s*this.U*.03);c.fillRect(a.x-side*rw*1.4,at.y+(a.y-at.y)*.25,rw,rh);
    c.globalAlpha=(1-steel)*fade;c.strokeStyle='#40392c55';c.lineWidth=Math.max(.5,a.s*3);const q=.62;line(c,{x:mix(at.x,a.x,q),y:mix(at.y,a.y,q)},{x:mix(bt.x,b.x,q),y:mix(bt.y,b.y,q)});}
   if(steel>.01){c.globalAlpha=steel*fade;c.strokeStyle='#59605b';c.lineWidth=Math.max(.8,a.s*this.R*.012);line(c,a,at);
    for(const [k,col,lw] of [[.95,'#e3e4d8',.03],[.82,'#8f978f',.022],[.68,'#c9ccbf',.03]] as const){c.strokeStyle=col;c.lineWidth=Math.max(1,a.s*this.U*lw);line(c,{x:mix(a.x,at.x,k),y:mix(a.y,at.y,k)},{x:mix(b.x,bt.x,k),y:mix(b.y,bt.y,k)});}}
  }c.globalAlpha=1;
 }
 private scenery(flow:number,gap?:{from:number;to:number}){
  const sheet=this.img['route-props'];if(!sheet)return;const c=this.c,gapZ=3.4,n=12;
  const items:{z:number;k:number;i:number}[]=[];const base=Math.floor(this.dist/gapZ);
  for(let j=n;j>=0;j--){const i=base+j,z=i*gapZ-this.dist+gapZ*.35;if(z<.68)continue;items.push({z,k:i,i:j});}
  for(const it of items)for(let zn=0;zn<4;zn++){const wt=this.weights[zn];if(wt<.01)continue;
   for(const side of [-1,1]){if(zn===3&&side<0)continue;const r=rng(it.k*131+(side>0?7:3)+zn*17)();const pk=zones[zn].props[(it.k+(side>0?1:0))%2===0?0:1],[sx,sy,sw,sh]=PROPS[pk];
    if(side>0&&gap&&it.z>gap.from-.9&&it.z<gap.from+9)continue;
    const z=it.z+(side>0?gapZ*.45:0)+r*.8;if(z<.68)continue;const H=PROP_H[pk]*(.9+r*.25),wx=H*this.U*sw/sh/this.R,X=side*(1.36+wx/2+r*.35),p=this.at(X,z),ph=H*this.U*p.s,pw=ph*sw/sh;
    if(p.x+pw<-40||p.x-pw>this.w+40)continue;
    const a=wt*clamp((38-z)/12)*clamp((z-.66)*8);if(a<.01)continue;c.globalAlpha=a*.35;c.fillStyle='#2a251a';c.beginPath();c.ellipse(p.x+pw*.1,p.y,pw*.55,Math.max(1,pw*.06),0,0,7);c.fill();
    if(flow>8&&z<2.2){c.globalAlpha=a*.16;c.drawImage(sheet,sx,sy,sw,sh,p.x-pw/2-side*pw*.1,p.y-ph*1.03,pw*1.05,ph*1.03);}
    c.globalAlpha=a;c.drawImage(sheet,sx,sy,sw,sh,p.x-pw/2,p.y-ph,pw,ph);}}
  c.globalAlpha=1;
 }
 /** An overpass hides each change of location behind its own underside. */
 private overpass(back:boolean){
  if(this.bridge<-12)return;const c=this.c,z1=this.bridge,depth=9,z2=z1+depth,H=1.42,T=.34,w=this.w;
  if(z2<.75)return;const sheet=this.img['route-props'];
  const pillar=(z:number)=>{if(z<.62||!sheet)return;for(const side of [-1,1]){const p=this.at(side*1.62,z),ph=H*this.U*p.s,pw=ph*.34;c.drawImage(sheet,1058,110,100,320,p.x-pw/2,p.y-ph,pw,ph);const g=c.createLinearGradient(p.x-pw/2,0,p.x+pw/2,0);g.addColorStop(0,side<0?'#0000':'#1a1712aa');g.addColorStop(1,side<0?'#1a1712aa':'#0000');c.fillStyle=g;c.fillRect(p.x-pw/2,p.y-ph,pw,ph);}};
  if(back){// deck shadow on the road
   const n1=Math.max(.7,z1-1),n2=z2-1.4;if(n2>.75){const a=this.at(0,n2),b=this.at(0,n1);const g=c.createLinearGradient(0,a.y,0,b.y);g.addColorStop(0,'#1512104d');g.addColorStop(.15,'#15121099');g.addColorStop(.9,'#15121099');g.addColorStop(1,'#15121000');c.fillStyle=g;c.fillRect(0,a.y,w,Math.max(0,b.y-a.y));}
   return;}
  for(const z of [z2-.6,z1+depth*.5,z1+.5])pillar(z);
  const bb=this.at(0,z2,H).y,f1=z1>.7?this.at(0,z1,H).y:-this.h;
  if(bb>-10){// underside
   const g=c.createLinearGradient(0,Math.min(f1,bb-1),0,bb);g.addColorStop(0,'#17140f');g.addColorStop(1,'#4b463b');c.fillStyle=g;c.fillRect(0,Math.min(f1,bb),w,Math.abs(bb-f1));
   c.strokeStyle='#0c0a0799';for(let k=0;k<9;k++){const z=z1+k*depth/9;if(z<.7)continue;const y=this.at(0,z,H).y;if(y<-4)continue;c.lineWidth=Math.max(1,this.U*.07/z);line(c,{x:0,y},{x:w,y});}
   for(const X of [-.8,0,.8]){const a=this.at(X,Math.max(.7,z1),H),b=this.at(X,z2,H);c.strokeStyle='#0c0a0766';c.lineWidth=3;line(c,a,b);}
   c.fillStyle='#fff2cf33';c.fillRect(0,bb-1,w,2);}
  if(z1>.66){const top=this.at(0,z1,H+T).y,bot=f1;if(bot>-5){const g=c.createLinearGradient(0,top,0,bot);g.addColorStop(0,'#d8cfba');g.addColorStop(.12,'#b9b09c');g.addColorStop(.8,'#8c8472');g.addColorStop(1,'#5e574a');c.fillStyle=g;c.fillRect(0,top,w,bot-top);
   c.strokeStyle='#5e574a88';c.lineWidth=Math.max(1,2/z1);const st=this.R*.5/z1;for(let x=this.vpx-Math.ceil(this.vpx/st)*st;x<w;x+=st)line(c,{x,y:top},{x,y:bot});
   const rail=this.at(0,z1,H+T+.16).y;c.fillStyle='#8f887a';c.fillRect(0,rail,w,Math.max(1,3/z1));for(let x=this.vpx-Math.ceil(this.vpx/st)*st;x<w;x+=st/3)c.fillRect(x,rail,Math.max(1,2/z1),top-rail);}}
 }
 private lensFlare(){
  const c=this.c;let a=0,sx=0,sy=0;zones.forEach((z,i)=>{if(z.sun&&this.weights[i]>.05){a=this.weights[i];sx=z.sun[0]*this.w;sy=z.sun[1]*this.h;}});
  if(a<.05)return;if(this.bridge>-11&&this.bridge<2)a=0;if(a<.05)return;const x=sx+(this.vpx-this.w/2)*.5,y=sy,cx=this.w/2,cy=this.h*.55;c.save();c.globalCompositeOperation='screen';
  c.globalAlpha=.5*a;const S=this.h*1.1;c.drawImage(this.white,x-S/2,y-S/2,S,S);
  for(const [t,r,k] of [[.45,.05,.16],[.72,.1,.1],[1.15,.035,.2],[1.45,.16,.08]] as const){const px=mix(x,cx,t),py=mix(y,cy,t),s=this.h*r;c.globalAlpha=k*a;const gr=c.createRadialGradient(px,py,s*.3,px,py,s);gr.addColorStop(0,t>1?'#ffd9a022':'#cfe3ff22');gr.addColorStop(.85,t>1?'#ffd9a0':'#cfe3ff');gr.addColorStop(1,'#ffffff00');c.fillStyle=gr;c.fillRect(px-s,py-s,s*2,s*2);}
  c.restore();
 }
 private haze(oy:number){if(this.shake>.2||this.quality>0)return;const c=this.c,d=this.canvas.width/this.w,y0=this.hy+oy-this.h*.012,n=12,sh=this.h*.004;c.save();c.setTransform(d,0,0,d,0,0);for(let i=0;i<n;i++){const y=y0+i*sh,dx=Math.sin(this.clock*5+i*.9)*1.1*(1-i/n);c.drawImage(this.canvas,0,y*d,this.canvas.width,Math.ceil(sh*d),dx,y,this.w,sh+.4);}c.restore();}

 // ---------------------------------------------------------------- actors
 private shadow(x:number,y:number,w:number,a:number){if(a<=0)return;const c=this.c,g=c.createRadialGradient(0,0,0,0,0,w*.56);c.save();c.translate(x,y);c.scale(1,.16);g.addColorStop(0,`rgba(16,14,10,${a})`);g.addColorStop(.6,`rgba(16,14,10,${a*.7})`);g.addColorStop(1,'rgba(16,14,10,0)');c.fillStyle=g;c.fillRect(-w*.6,-w*.6,w*1.2,w*1.2);c.restore();}
 private body(name:string,x:number,foot:number,w:number,angle=0,bright=1){const i=this.img[name];if(!i)return;const [sx,sy,sw,sh]=BOX[name],h=w*sh/sw,c=this.c;c.save();c.translate(x,foot);c.rotate(angle);c.drawImage(i,sx,sy,sw,sh,-w/2,-h,w,h);if(bright<1){c.globalAlpha=clamp((1-bright)*1.2);c.drawImage(this.shadeOf(name),sx/2,sy/2,sw/2,sh/2,-w/2,-h,w,h);}c.restore();}
 private add(g:HTMLCanvasElement,x:number,y:number,r:number,a:number){if(a<=.01)return;const c=this.c;c.save();c.globalCompositeOperation='screen';c.globalAlpha=Math.min(1,a);c.drawImage(g,x-r,y-r,r*2,r*2);c.restore();}
 private police(x:number,foot:number,w:number,angle:number,brake:number,quiet:boolean,lights=1){
  this.shadow(x,foot-w*.02,w*1.05,.5);this.body('patrol',x,foot,w,angle);
  if(!lights)return;const h=w*.774,t=quiet?0:this.clock,p=Math.sin(t*9);const flashR=quiet?.5:clamp(p*3),flashB=quiet?.5:clamp(-p*3);
  this.add(this.red,x-w*.17,foot-h*.965,w*.2,.35+.55*flashR);this.add(this.blue,x+w*.17,foot-h*.965,w*.2,.35+.55*flashB);
  // light spills on the asphalt
  const c=this.c;c.save();c.globalCompositeOperation='screen';c.globalAlpha=.16;c.translate(x,foot);c.scale(1,.22);c.drawImage(p>0?this.red:this.blue,-w*.9,-w*.9,w*1.8,w*1.8);c.restore();
  if(brake>.02)for(const s of [-1,1])this.add(this.red,x+s*w*.34,foot-h*.5,w*.2,brake);
 }
 private drawProp(p:Prop){const c=this.c,q=this.at(p.x,p.z),a=clamp((34-p.z)/8);if(a<=0)return;c.globalAlpha=a;if(p.kind==='board'){const sheet=this.img['route-props'];if(sheet){const [sx,sy,sw,sh]=PROPS[3],pw=p.w*this.R*q.s,ph=pw*sh/sw;this.shadow(q.x,q.y,pw,.4);c.globalAlpha=a;c.drawImage(sheet,sx,sy,sw,sh,q.x-pw/2,q.y-ph,pw,ph);}}else{const s=.045*this.R*q.s;c.fillStyle='#e8692c';c.beginPath();c.moveTo(q.x,q.y-s*1.9);c.lineTo(q.x+s*.55,q.y);c.lineTo(q.x-s*.55,q.y);c.fill();c.fillStyle='#f4efe2';c.fillRect(q.x-s*.3,q.y-s*1.05,s*.6,s*.36);c.fillStyle='#b64a1a';c.fillRect(q.x-s*.75,q.y-s*.14,s*1.5,s*.16);}c.globalAlpha=1;}
 /** Pose comes from the body state: rear, two quarter views, side, or a roll about the long axis. */
 private drawCar(k:Car,quiet:boolean){
  const c=this.c,p=this.at(k.x,k.z),cop=k.kind==='cop',base=(cop?this.copW:this.carW*.9)*this.carZ*p.s,fade=clamp((46-k.z)/10);if(fade<=0||p.x<-base*2||p.x>this.w+base*2)return;
  const lift=k.y*this.U*p.s,foot=p.y-lift,ay=Math.abs(k.yaw),dir=Math.sign(k.yaw)||1,tumbling=k.state==='air'&&k.hop||k.state==='slide'&&Math.abs(k.roll)>.2;
  this.shadow(p.x,p.y,base*(1+.5*Math.sin(Math.min(1.5,ay)))*(1-clamp(k.y)*.4),.5*(1-clamp(k.y*.9)));c.save();c.globalAlpha=fade;
  if(tumbling){
   const draw=(roll:number,alpha:number)=>{const turn=((roll/(Math.PI*2))%1+1)%1,sideW=base*1.6;c.save();c.globalAlpha=fade*alpha;c.translate(p.x,foot);c.scale(cop?dir:-dir,1);
    if(cop){const co=Math.cos(roll),[sx,sy,sw,sh]=RAM[3],bh=sideW*sh/sw;
     if(co<-.0&&Math.abs(co)<.55||co>=0&&co<.3&&Math.sin(roll)>0){const [a,b,d,e]=ROLL[6],uw=sideW*.98,uh=uw*e/d*.86;c.drawImage(this.img['coupe-depth-roll'],a,b,d,e,-uw/2,-uh,uw,uh);}
     else{const hh=bh*mix(.66,1,Math.abs(co));if(co<0){c.translate(0,-hh);c.scale(1,-1);c.drawImage(this.img['patrol-ram'],sx,sy,sw,sh,-sideW/2,-hh,sideW,hh);}else c.drawImage(this.img['patrol-ram'],sx,sy,sw,sh,-sideW/2,-hh,sideW,hh);}
    }else{const [a,b,d,e]=ROLL[Math.round(turn*8)%8],cv=this.tints[k.tint]?.['coupe-depth-roll'];const dh=sideW*e/d;if(cv)c.drawImage(cv,a/2,b/2,d/2,e/2,-sideW/2,-dh,sideW,dh);}
    c.restore();};
   if(k.state==='air'&&!quiet)draw(k.roll-k.wr*.028,.35);draw(k.roll,1);
  }else if(cop&&ay<.2){c.restore();this.police(p.x,foot,base,clamp(-k.vx*.05,-.045,.045)+(k.state==='air'?clamp(-k.vy*.05,-.06,.06):0),k.brake,quiet||k.lights===0&&true,k.lights);return;}
  else if(cop){const i=ay<.5?1:ay<1.15?2:3,[sx,sy,sw,sh]=RAM[i],hh=base*.799*(sh/338),ww=hh*sw/sh;c.translate(p.x,foot);c.scale(dir,1);c.drawImage(this.img['patrol-ram'],sx,sy,sw,sh,-ww/2,-hh,ww,hh);c.restore();if(k.lights){const q=Math.sin((quiet?0:this.clock)*9);this.add(q>0?this.red:this.blue,p.x-dir*ww*(i===1?.14:.1),foot-hh*.95,base*.2,.7);}return;}
  else{const cv=this.tints[k.tint];if(ay<.2){const i=cv?.coupe;if(i){const [sx,sy,sw,sh]=BOX.coupe,hh=base*sh/sw;c.drawImage(i,sx/2,sy/2,sw/2,sh/2,p.x-base/2,foot-hh,base,hh);}}else{const n=ay<.5?1:ay<1.15?2:3,[sx,sy,sw,sh]=YAW[n],i=cv?.['coupe-yaw'],ww=base*1.25,hh=ww*sh/sw;if(i){c.translate(p.x,foot);c.scale(-dir,1);c.drawImage(i,sx/2,sy/2,sw/2,sh/2,-ww/2,-hh,ww,hh);}}}
  c.restore();
 }
 /** Bodywork scuffs accumulate with contacts and clear on a new run. */
 private scratches(x:number,foot:number,w:number){const n=Math.floor(this.scuff*2.2);if(n<1)return;const c=this.c,r=rng(55);c.save();c.lineCap='round';for(let i=0;i<n;i++){const s=r()<.5?-1:1,px=x+s*w*(.36+r()*.1),py=foot-w*(.13+r()*.2),l=w*(.02+r()*.05);c.strokeStyle=r()<.5?'#d9d4c899':'#0a0a0a99';c.lineWidth=Math.max(.7,w*.004);c.beginPath();c.moveTo(px,py);c.lineTo(px-s*l,py+(r()-.5)*l*.6);c.stroke();}c.restore();}
 private drawBooms(){for(const b of this.booms){const p=this.at(b.x,b.z),q=b.age,size=b.size*this.R*.62*p.s*(.4+.6*outCubic(q/.28))*(1+q*.12),al=q<.35?1:clamp(1-(q-.35)/.9);if(al<=0)continue;const c=this.c;c.save();c.globalAlpha=al;c.drawImage(this.img.explosion,43,37,1459,928,p.x-size/2,p.y+size*.04-size*.636,size,size*.636);c.restore();this.add(this.flame,p.x,p.y-size*.2,size*.7,al*.4);}}
 private exhaust(x:number,foot:number,w:number,power:number){if(power<=.02)return;for(const s of [-1,1]){const px=x+s*w*.223,py=foot-w*.045;this.add(this.flame,px,py,w*(.06+.1*power),power);this.add(this.white,px,py,w*.05,power*.9);}}

 /** Final pose without motion: two parked patrols. */
 private parked(park:number,off=0){if(this.sim.cars.length===2&&this.sim.cars.every(c=>c.state==='drive'))return;this.sim.cars=[];for(const side of [-1,1])this.sim.make('cop',{side,x:off+side*park,z:1.08,tx:off+side*park,yaw:side*-.35,hw:this.copW/this.R/2});}
 private stillFire(x:number,y:number,w:number){const c=this.c,r=rng(91);for(let i=0;i<7;i++){const s=w*(.1+r()*.07);c.globalAlpha=.8;c.drawImage((i%2?this.hot:this.ember)[i%4],x+(r()-.5)*w*.6-s,y-w*.2-s*1.3*r()-s,s*2,s*3);}for(let i=0;i<9;i++){const q=i/9,s=w*(.14+.3*q);c.globalAlpha=.5*(1-q*.7);c.drawImage(this.black[i%4],x+w*.35*q+(r()-.5)*w*.1-s,y-w*(.35+1.1*q)-s,s*2,s*2);}c.globalAlpha=1;this.add(this.flame,x,y-w*.15,w*.7,.3);}
 private tail(x:number,foot:number,w:number,a:number){for(const s of [-1,1])this.add(this.red,x+s*w*.285,foot-w*.265,w*.17,a);}
 private drawBits(front:boolean){
  const c=this.c;for(const b of this.bits.list){if(b.front!==front)continue;const p=this.at(b.x,b.z,b.y),t=b.age/b.life,s=b.size*this.R*p.s,a=b.alpha*clamp(t<.12?t/.12:1-(t-.12)/.88)*clamp((b.z-.42)*5);if(a<.01)continue;
   if(b.kind==='puff'){const set=[this.smoke,this.dust,this.black][b.tint];c.globalAlpha=a;c.save();c.translate(p.x,p.y);c.rotate(b.rot);c.drawImage(set[b.k],-s,-s,s*2,s*2);c.restore();}
   else if(b.kind==='fire'){const set=t<.45?this.hot:this.ember,k=1-t*.45;c.globalAlpha=a;c.save();c.translate(p.x,p.y);c.rotate(Math.sin(b.rot+t*4)*.35);c.drawImage(set[b.k],-s*k,-s*1.5*k,s*2*k,s*3*k);c.globalCompositeOperation='screen';c.globalAlpha=a*.5*(1-t);c.drawImage(this.flame,-s*1.2,-s*1.4,s*2.4,s*2.8);c.restore();}
   else if(b.kind==='spark'){const q=this.at(b.x-b.vx*.03,b.z,b.y-b.vy*.03);c.globalAlpha=a;c.strokeStyle=t<.4?'#fff3c9':'#ffb04a';c.lineWidth=Math.max(1,s);c.beginPath();c.moveTo(p.x,p.y);c.lineTo(q.x,q.y);c.stroke();}
   else{c.globalAlpha=a;c.save();c.translate(p.x,p.y);c.rotate(b.rot);c.scale(1,Math.max(.25,Math.abs(Math.cos(b.rot*1.7))));if(b.kind==='cone'){c.fillStyle='#e8692c';c.beginPath();c.moveTo(0,-s);c.lineTo(s*.5,s*.8);c.lineTo(-s*.5,s*.8);c.fill();c.fillStyle='#f4efe2';c.fillRect(-s*.3,-s*.05,s*.6,s*.3);c.fillStyle='#b64a1a';c.fillRect(-s*.7,s*.75,s*1.4,s*.2);}
    else if(b.kind==='chip'){const sheet=this.img['route-props'];if(sheet&&b.tint!==1){const [sx,sy,sw,sh]=PROPS[3];c.drawImage(sheet,sx+sw*(.1+b.k*.2),sy+sh*.1,sw*.18,sh*.6,-s,-s*.8,s*2,s*1.6);}else{c.fillStyle=b.k%2?'#cfc6b3':'#a39a88';c.beginPath();c.moveTo(-s,-s*.5);c.lineTo(s*.6,-s*.8);c.lineTo(s,s*.4);c.lineTo(-s*.5,s*.7);c.fill();}}
    else if(b.kind==='shard'){c.fillStyle=b.tint===1?'#ff5a44':b.tint===2?'#58a2ff':b.k%2?'#d7e6ea':'#9fb4ba';c.beginPath();c.moveTo(-s,-s*.5);c.lineTo(s,-s*.2);c.lineTo(s*.1,s);c.fill();}
    else{const g=c.createLinearGradient(-s,-s,s,s);g.addColorStop(0,b.tint===1?'#f2efe6':'#5d5c5a');g.addColorStop(.45,b.tint===1?'#cfcabd':'#23242a');g.addColorStop(1,b.tint===1?'#8f8a7e':'#101114');c.fillStyle=g;c.beginPath();c.moveTo(-s,-s*.35);c.lineTo(s*.8,-s*.5);c.lineTo(s,s*.2);c.lineTo(-s*.6,s*.45);c.closePath();c.fill();c.strokeStyle='#8d8678';c.lineWidth=1;c.stroke();}c.restore();}}
  c.globalAlpha=1;
 }
 private tireSmoke(x:number,n:number,power=1,tint=0,z=this.carZ,v=-1){for(let i=0;i<n;i++)this.bits.add({kind:'puff',x:x+this.bits.rand(-.03,.03),y:.03,z:z-.02,vx:this.bits.rand(-.3,.3)+Math.sign(x-this.carX)*.18,vy:this.bits.rand(.03,.14),vz:this.bits.rand(-.2,.02)+(v<0?0:v*.95),life:this.bits.rand(.5,1.1),size:.045*power,grow:.13*power,spin:this.bits.rand(-1,1),alpha:.24*Math.min(1.2,power),tint,front:this.bits.rand()<.3,pin:v<0});}
 private sparks(x:number,y:number,z:number,n:number,power=1,v=-1){const fwd=v<0?this.vel*.86:v;for(let i=0;i<n;i++)this.bits.add({kind:'spark',x,y,z,vx:this.bits.rand(-1.4,1.4)*power,vy:this.bits.rand(.2,1.5)*power,vz:fwd+this.bits.rand(-1.6,.6),life:this.bits.rand(.25,.7),size:.0035,gravity:3.4,bounce:.4,pin:false});}
 private dustRing(x:number,z:number,n:number,power=1,tint=1,v=-1){for(let i=0;i<n;i++){const a=i/n*6.28+this.bits.rand(0,.4);this.bits.add({kind:'puff',x:x+Math.cos(a)*.1,y:.02,z:z+Math.sin(a)*.08,vx:Math.cos(a)*.9*power,vy:this.bits.rand(.02,.15),vz:Math.sin(a)*.5*power+(v<0?0:v*.93),life:this.bits.rand(.7,1.4),size:.06*power,grow:.2*power,alpha:.34,tint,front:Math.sin(a)<0,pin:v<0});}}
 private once(k:string,f:()=>void){if(this.fired.has(k))return;this.fired.add(k);f();}

 // ---------------------------------------------------------------- frame
 /** Review stand only: patrols in place and one chosen stunt. */
 prime(force=''){const hw=this.copW/this.R/2;this.vel=23;this.sim.cars=[];for(const side of [-1,1])this.sim.make('cop',{side,x:side*this.sim.laneX,z:1.06,v:23,tx:side*this.sim.laneX,hw});this.sim.force=force;}
 get jolt(){return this.shake;}
 reset(){this.fired.clear();this.skid=[];this.bits.clear();}
 jumpZone(value:number){this.zone=zoneOf(value);this.weights=[0,1,2,3].map(i=>i===this.zone?1:0);this.bridge=-99;this.bridgeTo=this.zone;}
 /** Presentation time of the ending: it waits for a location change that is still passing overhead. */
 get endingAge(){return this.age;}
 private holding=false;private acc=0;private slowFrames=0;private frameAvg=16;private warm=0;quality=0;private observer?:ResizeObserver;private alive=true;
 destroy(){this.alive=false;this.observer?.disconnect();this.bits.clear();this.sim.cars=[];this.tints=[];this.cliff=undefined;}
 /** A weak device loses decoration before it loses frames. The level never rises again in one mount. */
 private govern(raw:number){if(this.warm++<40||raw<=0||raw>.5)return;this.frameAvg=mix(this.frameAvg,raw*1000,.04);const limit=this.quality===0?23:32;if(this.frameAvg>limit&&this.quality<2){if(++this.slowFrames>30){this.quality++;this.slowFrames=0;this.warm=0;this.frameAvg=16;this.bits.limit=this.quality===1?260:140;this.resize();}}else this.slowFrames=Math.max(0,this.slowFrames-1);}
 paint(now:number,phase:Phase,value:number,quiet:boolean,run:string,id=1,restored=false){
  if(!this.alive)return;const raw=this.last?(now-this.last)/1000:0,dt=clamp(raw,0,.1);this.last=now;if(!quiet)this.govern(raw);
  // A reopened result shows its final pose and replays nothing.
  const still=quiet||restored&&(phase==='crashed'||phase==='escaped');this.clock+=dt;
  if(phase!==this.phase||run!==this.run){
   if(phase==='waiting'||phase==='idle'){this.reset();this.hero.x=0;this.hero.vx=0;this.scuff=0;this.sim.reset(id);this.booms=[];this.gear=-1;this.holding=false;if(zoneOf(1)!==this.zone||this.bridge>=-12)this.jumpZone(1);}
   this.phase=phase;this.run=run;this.age=0;this.since=0;this.seedRun=id;this.variant=pickVariant(phase,value,id);
   if(phase==='crashed'||phase==='escaped'){this.prepareEnding(phase);if(still){this.sim.cars=[];this.booms=[];this.bits.clear();this.skid=[];this.hero.x=0;this.camX=0;this.holding=false;this.rocks=[];this.fired.clear();this.jumpZone(value);}
    else if(phase==='escaped'&&(this.zone!==zoneOf(value)||this.bridge>-5&&this.bridge<26)){this.holding=true;this.bridgeTo=zoneOf(value);if(this.bridge<-12&&this.zone!==this.bridgeTo)this.bridge=15;}}}
  this.since+=dt;
  if(this.holding&&this.zone===this.bridgeTo&&this.bridge<-5)this.holding=false;
  const crash=phase==='crashed',esc=phase==='escaped',race=phase==='racing'||this.holding,v=this.variant;
  // Slow motion covers the contact only. The confirmed result is already on the sign.
  const slow=crash&&this.age>.32&&this.age<.66?.36:crash&&this.path&&this.path.wall&&this.age>this.path.wall-.05&&this.age<this.path.wall+.16?.45:1;if(!this.holding)this.age+=dt*slow;
  this.sim.slow=Math.max(0,this.sim.slow-dt);this.drift=mix(this.drift,this.sim.slow>.1?1:0,1-Math.exp(-dt*8));this.stop=Math.max(0,this.stop-dt);const ts=still?1:(phase==='racing'?(this.stop>0?.12:this.sim.slow>.12?.38:this.sim.slow>0?.7:1):slow),sdt=dt*ts;
  const t=still?crash?9:esc?99:0:this.age;
  // ---- speed
  let target=0;if(race)target=19+8*ease((esc?4:this.since)/4)+Math.min(5,Math.log(Math.max(1,value))*2);
  if(phase==='waiting')target=0;
  if(crash)target=24*Math.max(0,1-t/3.4);
  if(esc&&!this.holding)target=v==='helicopter'?24*(1-ease((t-.4)/2.2)):v==='cargo-plane'?25*(1-ease((t-cargo.landing)/2.6)):24*(1-ease((t-coast.brake)/(coast.stop-coast.brake)));
  // ---- steering and bodies advance on one fixed step, whatever the display rate
  const k=this.clock,H=this.hero;H.hw=this.carW/this.R/2;this.sim.laneX=this.portrait?.4:.565;const chw=this.copW/this.R/2;for(const c of this.sim.cars)if(c.kind==='cop')c.hw=chw;
  const want=phase==='idle'||phase==='waiting'?0:esc?zoneOf(value):Math.max(this.zone,zoneOf(value));
  if(still){this.vel=0;this.acc=0;if(want!==this.zone)this.jumpZone(value);
   if((race||phase==='waiting')&&this.sim.cars.length!==2){this.sim.cars=[];for(const side of [-1,1])this.sim.make('cop',{side,x:side*this.sim.laneX,z:1.06,tx:side*this.sim.laneX,hw:chw});}
   H.x=0;H.vx=0;this.roll=0;
  }else{
   if(want!==this.zone&&this.bridge<-12){this.bridge=26;this.bridgeTo=want;}
   const steer=phase==='racing'||esc&&(v!=='coast'||t<.3),base=phase==='racing'?Math.sin(k*.9)*(this.portrait?.05:.15):0,h=1/120;let ax=0;
   this.acc=Math.min(.14,this.acc+sdt);
   while(this.acc>=h){this.acc-=h;
    this.vel=esc&&!this.holding&&v==='coast'?target:mix(this.vel,target,1-Math.exp(-h*(race?1.9:4)/Math.max(.2,ts)));const f=this.vel;this.dist+=f*h;
    if(this.bridge>=-12){this.bridge-=Math.max(f,9)*h*(this.holding?1.9:1);if(this.bridge<-2.5&&this.zone!==this.bridgeTo)this.zone=this.bridgeTo;}
    if(steer){const wantX=phase==='racing'?this.sim.wish(H,base):0;ax=(wantX-H.x)*22-H.vx*6;H.vx+=ax*h;H.x+=H.vx*h;}
    if(phase==='racing'){this.sim.ensure(f,chw,h);this.sim.step(h,f,H,value,'race');}
    else if(crash||esc){this.endingCars(h,t,f,chw);this.sim.step(h,f,H,value,'scene');}
    else if(phase==='waiting'){for(const side of [-1,1]){if(this.since>.7&&!this.sim.cop(side))this.sim.make('cop',{side,x:side*this.sim.laneX,z:.56,v:1.1,tx:side*this.sim.laneX,hw:chw});}this.sim.step(h,0,H,1,'off');}
   }
   this.roll=mix(this.roll,clamp(-ax*.011,-.065,.065),1-Math.exp(-dt*10));
  }
  const flow=this.vel;this.speed=Math.max(0,flow*8.6);
  const sp=1-Math.exp(-dt*9);this.weights=this.weights.map((a,i)=>mix(a,i===this.zone?1:0,still?1:sp));this.zoneIndex=this.zone;
  this.carX=H.x;this.carVX=H.vx;
  this.camX=still?(esc&&v==='coast'?this.portrait?.8:.6:0):mix(this.camX,crash?this.carX*.5:esc&&v==='coast'?Math.max(this.holding?this.camX:0,(this.portrait?.8:.6)*ease((t-.6)/2.2)):this.carX*.62,1-Math.exp(-dt*(esc?3:6)));
  this.vpx=this.w*.5+(still?0:(Math.sin(k*.5)*.012-this.camX*.05)*this.w);
  // ---- gears
  this.rpm=phase==='waiting'?.3+.5*Math.abs(Math.sin(this.since*4))*ease(this.since/.6):0;
  if(race){const gt=this.since<6.6?this.since/1.65:4+(this.since-6.6)/3.2,g=Math.floor(gt);this.rpm=.42+.5*(gt-g);if(g>this.gear){if(this.gear>=0||this.since<.3)this.kick=1;this.gear=g;}}
  this.kick=Math.max(0,this.kick-dt*2.6);this.pitch=mix(this.pitch,race?this.kick:0,1-Math.exp(-dt*12));
  if(!still)this.events(sdt,t,value);
  this.bits.step(sdt,flow);for(const b of this.booms){b.age+=sdt;b.z+=(b.v-flow)*sdt;b.v=Math.max(0,b.v-9*sdt);}this.booms=this.booms.filter(b=>b.age<1.7&&b.z>.5);this.shake=Math.max(0,this.shake-dt*2.2);this.flash=Math.max(0,this.flash-dt*3.4);
  for(const s of this.skid)s.z-=flow*sdt;this.skid=this.skid.filter(s=>s.z>.9);
  this.render(t,value,flow,still,slow);
 }
 private events(dt:number,t:number,value:number){
  const ph=this.phase,v=this.variant,R=(a=0,b=1)=>this.bits.rand(a,b),W=this.carW/this.R;
  if(ph==='idle'&&R()<dt*5)for(const s of [-1,1])this.bits.add({kind:'puff',x:this.carX+s*W*.22,y:.04,z:this.carZ-.03,vx:R(-.02,.02),vy:R(.02,.06),vz:-.06,life:1.2,size:.012,grow:.05,alpha:.16,tint:0,pin:true});
  if(ph==='waiting'){
   if(this.since>.35&&this.since<1.95){const p=ease((this.since-.35)/.7);for(const s of [-1,1])if(R()<dt*46)this.tireSmoke(this.carX+s*W*.42,1,.6+p*.9);if(R()<dt*6)this.kick=Math.max(this.kick,.5);}
   for(const c of this.sim.cars)if(this.since<1.9&&R()<dt*16)this.tireSmoke(c.x+R(-.1,.1),1,.5,0,c.z);}
  if(ph==='racing'){
   this.once('launch',()=>{this.kick=1;this.shake=.35;for(const s of [-1,1])this.tireSmoke(this.carX+s*W*.42,9,1.6);});
   if(this.since<1.1)for(const s of [-1,1])if(R()<dt*40){this.tireSmoke(this.carX+s*W*.42,1,1.2*(1.1-this.since));}
   if(R()<dt*14)this.bits.add({kind:'puff',x:R(-1.1,1.1)>0?R(1.02,1.2):R(-1.2,-1.02),y:.02,z:R(1.5,4),vy:.12,life:.8,size:.04,grow:.16,alpha:.2,tint:1,front:false});
   for(const c of this.sim.cars){const hot=c.state==='spin'||Math.abs(c.vx)>.7;if(hot&&R()<dt*42){this.tireSmoke(c.x+R(-c.hw,c.hw),1,.8,0,c.z,c.v);}if(c.state==='spin')for(const q of [-.55,.55])this.mark(c.x+q*c.hw*1.4,c.z,.028);this.trail(c,dt);}
   if(this.pose&&R()<dt*60){this.tireSmoke(this.carX+R(-.15,.15),1,.9);for(const q of [-.11,.11])this.mark(this.carX+q,1.06,.03);}
   if(this.scuff>2&&R()<dt*(this.scuff-1)*2.4)this.sparks(this.carX+R(-.1,.1),.02,this.carZ-.03,2,.5);
  }else if(ph!=='waiting')for(const c of this.sim.cars){const hot=c.state==='spin'||c.state==='drive'&&c.brake>.5&&this.vel>2||c.state==='slide'&&c.v>2;if(hot&&R()<dt*34){this.tireSmoke(c.x+R(-c.hw,c.hw),1,.8,0,c.z,c.v);}if(hot&&c.y<.02)for(const q of [-.55,.55])this.mark(c.x+q*c.hw*1.4,c.z,.028);this.trail(c,dt);}
  if(ph==='crashed')this.crashEvents(dt,t);
  if(ph==='escaped'&&!this.holding){
   if(v==='helicopter'){
    if(t>.5&&t<heli.depart+.7&&R()<dt*52){const a=R(0,6.28);this.bits.add({kind:'puff',x:Math.cos(a)*.22,y:.02,z:this.carZ+.1+Math.sin(a)*.12,vx:Math.cos(a)*1.5,vy:R(.02,.18),vz:Math.sin(a)*.6,life:R(.6,1.2),size:.06,grow:.26,alpha:.3,tint:1,front:Math.sin(a)<0,pin:true});}
    this.once('taut',()=>{});if(t>heli.lift&&!this.fired.has('lift'))this.once('lift',()=>{this.shake=.3;this.dustRing(0,this.carZ,20,1.1);});
   }else if(v==='cargo-plane'){
    if(t>cargo.rampNear&&t<cargo.takeoff)for(const s of [-1,1])if(R()<dt*70)this.sparks(this.carX+s*W*.4,.06,1.0,2,.8);
    if(t>cargo.takeoff)this.once('jump',()=>{this.shake=.5;this.kick=1;this.sparks(0,.1,1,30,1.2);this.dustRing(0,1,14,.9);});
    if(t>cargo.landing)this.once('land',()=>{this.shake=.35;});
   }else{
    if(t>coast.turn&&t<coast.left&&R()<dt*50)this.tireSmoke(this.carX+R(-.15,.15),1,.9,1,1.08);
    if(t>coast.turn)this.once('turn',()=>{this.kick=1;this.shake=.22;});
   }
  }
 }
 private trail(c:Car,dt:number){const R=(a=0,b=1)=>this.bits.rand(a,b);if(c.burn>0){if(R()<dt*30)this.bits.add({kind:'fire',x:c.x+R(-.08,.08),y:c.y+R(.08,.2),z:c.z,vy:R(.2,.4),vz:c.v,life:R(.25,.6),size:R(.035,.07),alpha:1,front:R()<.4,vx:R(-.05,.05)});if(R()<dt*16)this.bits.add({kind:'puff',x:c.x,y:c.y+.2,z:c.z,vx:R(-.05,.12),vy:R(.25,.45),vz:c.v*.9,life:R(1,2),size:.06,grow:.14,alpha:.7,tint:2,front:false});}
  else if(c.damage>1.2&&R()<dt*9)this.bits.add({kind:'puff',x:c.x,y:c.y+.22,z:c.z,vy:R(.15,.3),vz:c.v,life:R(.5,1),size:.035,grow:.1,alpha:.34,tint:0,front:false});}
 private mark(x:number,z:number,w:number){if(z>.9&&z<9){if(this.skid.length>360)this.skid.shift();this.skid.push({x,z,w,l:clamp(this.vel/60*1.7,.035,.8)});}}
 private glass(x:number,y:number,z:number,n:number,v=this.vel*.9){for(let i=0;i<n;i++)this.bits.add({kind:'shard',x,y,z,vx:this.bits.rand(-.9,.9),vy:this.bits.rand(.3,1.2),vz:v+this.bits.rand(-2,1.5),life:this.bits.rand(.5,1.1),size:this.bits.rand(.003,.007),spin:this.bits.rand(-12,12),gravity:3,bounce:.3});}
 private panels(x:number,y:number,z:number,n:number,v=this.vel*.85){for(let i=0;i<n;i++)this.bits.add({kind:'panel',x,y,z,vx:this.bits.rand(-.9,.9),vy:this.bits.rand(.6,1.6),vz:v+this.bits.rand(-2,2),life:this.bits.rand(.9,1.8),size:this.bits.rand(.01,.026),spin:this.bits.rand(-10,10),gravity:2.9,bounce:.36,tint:this.bits.rand()<.4?1:0});}
 /** The broken light bar scatters in its own colours. */
 private beacon(c:Car){for(let i=0;i<10;i++)this.bits.add({kind:'shard',x:c.x+this.bits.rand(-.06,.06),y:c.y+.36,z:c.z,vx:this.bits.rand(-.8,.8),vy:this.bits.rand(.5,1.3),vz:c.v+this.bits.rand(-2,2),life:this.bits.rand(.7,1.4),size:this.bits.rand(.005,.011),spin:this.bits.rand(-12,12),gravity:3,bounce:.35,tint:i%2?1:2});}
 private smash(p:Prop,v:number){const n=p.kind==='board'?14:1;this.shake=Math.max(this.shake,p.kind==='board'?.6:.12);if(p.kind==='cone'){this.bits.add({kind:'cone',x:p.x,y:.05,z:p.z,vx:(p.x-this.carX)*4+this.bits.rand(-.6,.6),vy:this.bits.rand(.8,1.5),vz:v*1.12,life:1.6,size:.045,spin:this.bits.rand(-14,14),gravity:2.8,bounce:.45});return;}
  for(let i=0;i<n;i++)this.bits.add({kind:'chip',x:p.x+this.bits.rand(-.24,.24),y:this.bits.rand(.04,.2),z:p.z,vx:this.bits.rand(-1.3,1.3),vy:this.bits.rand(.5,1.7),vz:v*this.bits.rand(.85,1.25),life:this.bits.rand(1,1.8),size:this.bits.rand(.018,.05),spin:this.bits.rand(-9,9),gravity:2.9,bounce:.35});
  this.dustRing(p.x,p.z,16,1,1,v*.9);this.sparks(p.x,.12,p.z,20,1);}
 private blast(x:number,z:number,size:number,v:number){this.booms.push({x,z,age:0,size,v});this.shake=Math.max(this.shake,.8/Math.max(1,z*.5));const R=(a:number,b:number)=>this.bits.rand(a,b);for(let i=0;i<12;i++)this.bits.add({kind:'puff',x:x+R(-.1,.1),y:R(.1,.3),z,vx:R(-.5,.5),vy:R(.25,.8),vz:v*.8,life:R(.9,1.8),size:R(.06,.12),grow:R(.15,.25),alpha:.75,tint:2,front:false});this.sparks(x,.15,z,26,1.5,v);this.panels(x,.2,z,6,v);}
 /** Endings may begin in the middle of any stunt: free bodies keep moving and the two patrols are restored. */
 private prepareEnding(phase:Phase){const H=this.hero,chw=this.copW/this.R/2;this.sim.slow=0;this.sim.props=[];this.sim.calm=true;for(const c of this.sim.cars)if(c.kind==='civ'&&c.state==='drive')c.tx=(Math.sign(c.x)||1)*.86;
  for(const side of [-1,1]){let c=this.sim.cop(side);if(!c)c=this.sim.make('cop',{side,x:side*this.sim.laneX,z:.8,v:this.vel+3,hw:chw});c.tx=side*this.sim.laneX;c.tz=1.06;c.hold=0;c.nose=0;c.brake=0;c.damage=Math.min(c.damage,.4);}
  const dir=this.seedRun%2?1:-1;void dir;if(phase==='crashed')H.vx=0;this.path=undefined;}
 private endingCars(dt:number,t:number,flow:number,chw:number){
  if(t<1.5&&this.phase==='escaped')for(const side of [-1,1])if(!this.sim.cop(side)&&!this.fired.has('lost'+side))this.sim.make('cop',{side,x:side*this.sim.laneX,z:.7,v:flow+6,tx:side*this.sim.laneX,hw:chw});
  if(this.holding)return;const A=this.sim.cop(-1),B=this.sim.cop(1),v=this.variant,H=this.hero,R=(a=0,b=1)=>this.bits.rand(a,b);const park=this.portrait?.36:.52;
  for(const c of this.sim.cars)if(c.kind==='civ'&&c.state==='drive')c.v=mix(c.v,flow+11,Math.min(1,dt*4));else if(c.kind==='civ'&&t>2)c.v=Math.max(c.v,flow);
  if(this.phase==='crashed'){
   const dir=v==='pit-right'?-1:1,att=dir>0?A:B,oth=dir>0?B:A;
   if(att&&t>rollAt)this.once('fishtail',()=>{att.x=this.attX;att.z=1.07;att.state='spin';att.yaw=dir*.5;att.w=-dir*1.5;att.vx=-dir*.35;att.v=flow+1;att.brake=1;});
   for(const c of this.sim.cars)if(c.kind==='cop'&&c.state!=='air'){const s=Math.sign(c.x)||c.side;if(c.state==='spin'){if(Math.abs(c.yaw)>1.0){c.yaw=Math.sign(c.yaw)*1.0;c.w*=-.35;}c.v=mix(c.v,flow+(1.15-c.z)*4,Math.min(1,dt*7));if(t>3.6){c.vx*=.9;c.w*=.9;}c.vx+=(s*park-c.x)*dt*1.2;}}
   if(oth){oth.tx=dir*park;oth.tz=t<2?1.06:1.1;oth.brake=1;if(t>1.5)this.once('slew',()=>{oth.state='spin';oth.w=dir*-1.7;oth.vx=dir*.2;oth.v=flow+1.5;});}
   return;}
  if(v==='helicopter'){
   // The two patrols meet under the rising coupe.
   if(t<1.9){for(const c of [A,B])if(c){c.tx=c.side*this.sim.laneX;c.tz=1.06;}}
   else if(A&&B&&!this.fired.has('meet')){for(const c of [A,B]){c.hold=1;c.brake=t>2.35?1:0;c.tz=c.side<0?1.12:1.2;c.tx=t<2.35?c.side*(park+.04):-c.side*.1;c.nose=t>2.2?-c.side*.75:0;}
    if(Math.abs(A.x-B.x)<chw*(2+1.8*Math.sin(.75))+.05&&t>2.35)this.once('meet',()=>{this.sparks(0,.14,1.14,60,1.3,0);this.glass(0,.2,1.14,26,0);this.panels(0,.2,1.14,9,0);this.beacon(A);this.beacon(B);this.shake=.85;this.stop=.05;B.state='spin';B.damage=2;B.vx=R(.4,.6);B.w=-1.6;B.v=flow;B.brake=1;this.sim.trip(A,-1,.8);A.vx=-.5;A.vy=.62;A.v=flow;A.burn=1;this.blast(-.12,1.2,.55,0);});}
   const K=this.sim.cars.find(c=>c.kind==='cop'&&c.side===-1&&c.hop);if(K&&this.fired.has('meet')){K.v=mix(K.v,flow+(1.45-K.z)*3,Math.min(1,dt*6));K.vx*=Math.exp(-dt*.9);}
   this.settle(dt,park);
  }else if(v==='cargo-plane'){
   // One patrol follows up the ramp and falls short.
   if(!A&&!this.fired.has('follow')&&t>1&&t<cargo.takeoff)this.sim.make('cop',{side:-1,x:-this.sim.laneX,z:.75,v:flow+6,tx:-this.sim.laneX,tz:1.02,hw:chw});
   if(B){B.tx=park;B.tz=1.06;B.brake=t>cargo.takeoff?1:0;if(t>cargo.takeoff+.5)this.once('slewB',()=>{B.state='spin';B.w=-1.5;B.vx=.1;B.v=flow;});}
   if(A&&A.state==='drive'){if(t>cargo.takeoff-.55){A.hold=1;A.tx=-.2;A.tz=1.02;}if(t>cargo.takeoff+.42)this.once('follow',()=>{A.state='air';A.vy=.92;A.y=.16;A.v=flow+1.25;A.vx=-.06;A.wr=0;A.yaw=0;A.roll=0;A.hop=false;this.shake=.4;this.sparks(A.x,.1,1,26,1);});}
   const J=this.sim.cars.find(c=>c.kind==='cop'&&c.side===-1&&c.state==='air'&&!c.hop&&this.fired.has('follow'));if(J){J.yaw=0;if(J.vy<-.15&&!this.fired.has('flip')){this.once('flip',()=>{J.state='drive';this.sim.trip(J,1,.9);J.vy=-.4;J.burn=1;J.v=flow+2;J.vx=-.12;this.fired.add('flipped');});}}
   const K=this.sim.cars.find(c=>c.kind==='cop'&&c.side===-1&&c.hop);if(K&&this.fired.has('flip')){if(K.z>2.1)K.v=Math.min(K.v,flow+Math.max(0,2.5-K.z));if(K.y<=.01&&this.fired.has('flip'))this.once('fallboom',()=>this.blast(K.x,K.z,1,K.v));if(K.state==='slide'&&K.z<1.9)K.v=Math.max(K.v,flow);K.z=Math.max(K.z,1.5);}
   this.settle(dt,park);
  }else{
   // The right patrol follows the ramp and meets the rockfall, the left one overshoots the exit.
   const z0=this.exitAt-this.dist,zp=z0+MOUTH;this.landslide(dt,t);
   if(!B&&!this.fired.has('clip')&&t<coast.slide+.2&&t>1)this.sim.make('cop',{side:1,x:.95,z:Math.max(.7,this.coastZ-1),v:flow+7,tx:.95,hw:chw,free:true});
   if(B){B.free=true;if(t<coast.slide)B.w=0;}
   if(B&&B.state==='drive'){if(t<coast.turn+.55){B.tx=this.sim.laneX;B.tz=1.02;}else{B.free=true;B.hold=1;const on=B.z-z0;B.tz=Math.min(zp+.2,1.1+(t-coast.turn-.55)*1.35);B.tx=on>0?Math.max(.9,this.rampX(on)):mix(this.sim.laneX,.96,ease((t-coast.turn-.4)/.8));B.nose=on>0&&B.z<zp-.7?.3:.1;}if(t<3.4){const lim=Math.max(.98,this.coastZ-.5);if(B.z>lim){B.v=Math.min(B.v,flow-(B.z-lim)*9);}}
    if(t>coast.slide+.35&&B.z>zp-.62)this.once('clip',()=>{this.sim.trip(B,-1,.85);B.vx=-.42;B.vy=.75;B.v=flow;B.burn=1;this.blast(B.x,zp-.5,.9,0);this.panels(B.x,.15,zp-.5,8,0);this.shake=.8;});}
   const K=this.sim.cars.find(c=>c.kind==='cop'&&c.side===1&&c.hop);if(K&&this.fired.has('clip')){K.free=true;K.v=flow+clamp((zp-.95-K.z)*3,-1.2,1.2);K.vx*=Math.exp(-dt*.7);}
   if(A){A.tx=this.camX-park;A.tz=1.08;A.free=true;if(A.z>1.3)A.v=Math.min(A.v,flow-(A.z-1.3)*6);A.brake=t>coast.turn+.3?1:0;if(t>coast.turn+.7)this.once('slewB',()=>{A.state='spin';A.w=1.5;A.vx=-.05;A.v=flow;});}
   this.settle(dt,park);
  }
 }
 /** Patrols that kept their wheels slide to a believable stop inside the frame. */
 private settle(dt:number,park:number){if(this.age>3.4&&!this.sim.cars.some(c=>c.kind==='cop'&&c.z>.75&&c.z<3.6&&Math.abs(c.x)<.8))this.once('late',()=>{this.sim.make('cop',{side:1,x:park,z:.6,v:this.vel+3,tx:park,tz:1.13,hw:this.copW/this.R/2,brake:1});});for(const c of this.sim.cars)if(c.kind==='cop'&&c.state==='spin'){if(Math.abs(c.yaw)>1.05){c.yaw=Math.sign(c.yaw)*1.05;c.w*=-.3;}c.v=mix(c.v,this.vel+(1.13-c.z)*4,Math.min(1,dt*7));c.vx+=(this.camX*(this.variant==='coast'?1:0)+(this.variant==='coast'?c.side:Math.sign(c.x)||c.side)*park-c.x)*dt*1.4;c.vx*=Math.exp(-dt*1.2);if(this.vel<2)c.w*=Math.exp(-dt*3);}}
 private attX=0;
 private crashEvents(dt:number,t:number){
  const R=(a=0,b=1)=>this.bits.rand(a,b),W=this.carW/this.R,dir=this.variant==='pit-right'?-1:1;
  if(t>=impactAt)this.once('hit',()=>{this.shake=.8;this.sparks(this.carX-dir*W*.45,.16,this.carZ-.02,46,1.2);for(let i=0;i<14;i++)this.bits.add({kind:'shard',x:this.carX-dir*W*.4,y:.2,z:this.carZ,vx:R(-1.1,1.1),vy:R(.3,1.4),vz:R(-.6,.2),life:R(.6,1.3),size:R(.003,.007),spin:R(-12,12),gravity:3,bounce:.3,pin:true});});
  if(t>.4&&t<.95){for(let i=0;i<2;i++)if(R()<dt*50)this.tireSmoke(this.carX+R(-.2,.2),1,1.2);for(const q of [-.12,.12])this.mark(this.carX+dir*.16*ease((t-impactAt)/.28)+q,1.07,.034);}
  if(t>=rollAt&&!this.path)this.path=rollPath(dir,this.carX+dir*.16,rollAt,explosionAt,this.portrait?.8:WALL-.2);
  this.path?.contacts.forEach((at,i)=>{if(t>=at)this.once('c'+i,()=>{const m=this.tumble(at);this.shake=Math.max(this.shake,.6-i*.05);this.dustRing(m.x,m.z,10,.8);this.sparks(m.x,.05,m.z,14,.9,0);this.mark(m.x,m.z,.2);this.panels(m.x,.12,m.z,3,0);this.glass(m.x,.12,m.z,4,0);});});
  if(this.path?.wall&&t>=this.path.wall)this.once('wallhit',()=>{const m=this.tumble(this.path!.wall);this.shake=.95;this.sparks(dir*WALL,.16,m.z,44,1.3,0);for(let i=0;i<16;i++)this.bits.add({kind:'chip',x:dir*(WALL-.04),y:R(.04,.18),z:m.z+R(-.3,.3),vx:-dir*R(.1,1.2),vy:R(.4,1.5),vz:R(-.8,.5),life:R(1.2,2.2),size:R(.012,.034),spin:R(-8,8),gravity:2.9,bounce:.35,tint:1,pin:true});this.dustRing(dir*WALL,m.z,14,1);});
  if(t>=explosionAt){this.once('boom',()=>{this.flash=1;this.shake=1.2;const {x,z}=this.wreck;this.sparks(x,.1,z,60,1.9);this.dustRing(x,z,26,1.7);
    for(let i=0;i<26;i++)this.bits.add({kind:'puff',x:x+R(-.15,.15),y:R(.05,.3),z,vx:R(-.7,.7),vy:R(.15,.6),life:R(1.2,2.8),size:R(.07,.15),grow:R(.1,.2),spin:R(-1,1),alpha:.8,tint:2,front:false,pin:true});
    for(let i=0;i<22;i++)this.bits.add({kind:'fire',x:x+R(-.15,.15),y:R(.02,.25),z,vx:R(-.8,.8),vy:R(.2,1.2),life:R(.4,1),size:R(.08,.18),grow:.1,alpha:.8,pin:true});
    for(let i=0;i<10;i++)this.bits.add({kind:'panel',x,y:.2,z,vx:R(-1.8,1.8),vy:R(1,2.4),vz:R(-.9,.3),life:R(1.6,2.8),size:R(.01,.028),spin:R(-10,10),gravity:2.6,bounce:.3,pin:true});});
   const calm=clamp(1.2-(t-explosionAt)*.06,.55,1);
   if(R()<dt*34*calm)this.bits.add({kind:'fire',x:this.wreck.x+R(-.15,.15),y:R(.03,.1),z:this.wreck.z-.02,vx:R(-.04,.04),vy:R(.18,.45),life:R(.4,.9),size:R(.045,.09),alpha:1,pin:true});
   if(R()<dt*15*calm)this.bits.add({kind:'puff',x:this.wreck.x+R(-.1,.1),y:.18,z:this.wreck.z+.02,vx:R(.04,.2),vy:R(.28,.5),life:R(2.2,3.6),size:.08,grow:.14,spin:R(-.4,.4),alpha:.8,tint:2,front:false,pin:true});
   if(R()<dt*5)this.bits.add({kind:'spark',x:this.wreck.x+R(-.1,.1),y:.15,z:this.wreck.z,vx:R(-.15,.15),vy:R(.4,.9),life:1.2,size:.002,gravity:-.1,pin:true});
  }
 }
 private tumble(t:number){const f=this.path?.frames,dir=this.variant==='pit-right'?-1:1,p=clamp((t-rollAt)/(explosionAt-rollAt)),e=ease(p);if(!f)return {x:this.carX+dir*.16,z:1.08,hop:0,frame:0,turns:0,p};const i=Math.min(f.length-1,Math.max(0,Math.round((t-rollAt)*120))),q=f[i],turns=q.roll/(Math.PI*2);this.wreck={x:f[f.length-1].x,z:3};return {x:q.x,z:mix(1.08,this.wreck.z,e),hop:q.y,frame:Math.round((turns%1)*8)%8,turns,p};}

 private render(t:number,value:number,flow:number,quiet:boolean,slow:number){
  const {c,w,h}=this,ph=this.phase,v=this.variant,crash=ph==='crashed',esc=ph==='escaped'&&!this.holding,race=ph==='racing'||this.holding,W=this.carW;
  c.save();c.fillStyle='#8fa4b0';c.fillRect(0,0,w,h);
  const sh=quiet?0:this.shake*this.shake,rush=clamp(flow/27);
  const ox=Math.sin(this.clock*61)*sh*h*.022+Math.sin(this.clock*37)*rush*.5,oy=Math.cos(this.clock*53)*sh*h*.016+(quiet?0:Math.sin(this.clock*47)*h*.0012*rush);
  const push=crash&&slow<1?.035:0,zoom=1.015+rush*.018+(quiet?0:this.kick*.012)+push+(quiet?0:this.drift*.03);
  c.translate(ox,oy);c.translate(w/2,this.hy);c.scale(zoom,zoom);c.translate(-w/2,-this.hy);
  this.backdrop();this.ground(flow);
  const gap=esc&&v==='coast'?this.exitGap(t):undefined;if(gap)this.exitRamp(gap,t);
  this.overpass(true);this.barrier(gap);this.scenery(flow,gap);
  if(this.skid.length){c.fillStyle='#1715127a';for(const s of this.skid){const a=this.at(s.x-s.w/2,s.z),b=this.at(s.x+s.w/2,s.z),d=this.at(s.x+s.w/2,s.z+s.l),e=this.at(s.x-s.w/2,s.z+s.l);quad(c,a,b,d,e);}}
  this.overpass(false);
  if(!quiet&&!crash)this.haze(oy);
  // ---- speed streaks over the asphalt
  if(rush>.25&&!quiet&&this.quality<2){c.strokeStyle='#f6ecd6';for(let i=0;i<16;i++){const z=((i*1.7-this.dist*.9)%9+9)%9+.7,X=(i%2?1:-1)*(.55+(i%5)*.22),a=this.at(X,z),b=this.at(X,z+.5+rush);c.globalAlpha=.10*rush*clamp(2/z);c.lineWidth=Math.max(.6,a.s*2.4);line(c,a,b);}c.globalAlpha=1;}
  if(race&&value>=8&&!quiet){const x=this.vpx+Math.sin(this.clock*.8)*w*.3,y=this.hy+this.G*(.45+.12*Math.sin(this.clock*.5));c.save();c.globalAlpha=.22;c.fillStyle='#14120e';c.translate(x,y);c.scale(1,.28);c.rotate(this.clock*9);for(let i=0;i<2;i++){c.rotate(Math.PI/2);c.fillRect(-w*.13,-w*.006,w*.26,w*.012);}c.beginPath();c.arc(0,0,w*.03,0,7);c.fill();c.restore();}
  const foot=this.at(0,this.carZ).y,cx=this.at(this.carX,this.carZ).x;
  const copW=this.copW;const all=[...this.sim.cars].sort((a,b)=>b.z-a.z);
  for(const p of [...this.sim.props].sort((a,b)=>b.z-a.z))this.drawProp(p);
  const far=(z=this.carZ)=>{for(const k of all)if(k.z>z)this.drawCar(k,quiet);},near=(z=this.carZ)=>{for(const k of all)if(k.z<=z)this.drawCar(k,quiet);};
  this.drawBits(false);
  if(crash)this.crashScene(t,quiet,far,near,copW);
  else if(esc&&v==='helicopter')this.heliScene(t,quiet,far,near);
  else if(esc&&v==='cargo-plane')this.planeScene(t,quiet,far,near);
  else if(esc&&v==='coast')this.coastScene(t,quiet,far,near);
  else{
   far();
   const squat=quiet?0:this.pitch*W*.012,bob=quiet?0:Math.sin(this.clock*31)*W*.0022*rush;
   this.shadow(cx,foot-W*.01,W*1.02,.62);const slide=race&&!quiet?this.hero.vx:0;if(Math.abs(slide)>1.25)this.pose=Math.sign(slide);else if(Math.abs(slide)<.8)this.pose=0;
   if(this.pose){const [a,b,d,e]=YAW[1],yw=W*1.17,yh=yw*e/d;c.save();c.translate(cx,foot+squat+bob);c.scale(this.pose>0?-1:1,1);c.rotate(-.02);c.drawImage(this.img['coupe-yaw'],a,b,d,e,-yw/2,-yh,yw,yh);c.restore();}else this.body('coupe',cx,foot+squat+bob,W,quiet?0:this.roll);this.scratches(cx,foot+squat+bob,W);
   this.tail(cx,foot,W,ph==='idle'?.25:race?.2:.6);
   this.exhaust(cx,foot+squat,W,quiet?0:race||ph==='waiting'?Math.pow(this.kick,1.3):0);
   near();
  }
  this.drawBooms();this.drawBits(true);
  this.lensFlare();
  if(this.bridge>=-9&&this.bridge<1.2){const k=clamp((1.2-this.bridge)/1.5)*clamp((this.bridge+9)/2.2);c.fillStyle=`rgba(14,12,9,${.42*k})`;c.fillRect(-20,-20,w+40,h+40);}
  const vg=c.createRadialGradient(w*.5,h*.58,Math.min(w,h)*.3,w*.5,h*.58,Math.max(w,h)*.72);vg.addColorStop(0,'#14170f00');vg.addColorStop(1,'#14170f70');c.fillStyle=vg;c.fillRect(-20,-20,w+40,h+40);
  if(this.flash>0&&!quiet){c.fillStyle=`rgba(255,224,170,${this.flash*.34})`;c.fillRect(-20,-20,w+40,h+40);}
  c.restore();this.shot=crash?(t<rollAt?'intercept':t<explosionAt?'rollover':'wreck'):esc?v:ph;
 }
 // ---------------------------------------------------------------- loss
 private crashScene(t:number,quiet:boolean,far:(z?:number)=>void,near:(z?:number)=>void,copW:number){
  const c=this.c,W=this.carW,dir=this.variant==='pit-right'?-1:1,A=this.sim.cop(-dir),foot=this.at(0,this.carZ).y;
  const hit=ease((t-impactAt)/.28),side=ease((t-impactAt)/.34);
  const heroX=this.carX+dir*.16*hit;
  // attacking patrol
  const arrive=ease(t/impactAt),push=hit,ret=ease((t-.76)/.95),pose=Math.min(2,Math.round(ease(t/.32)*(1-ret*.7)*2)),[sx,sy,sw,sh]=RAM[pose];
  const rh=copW*.79,rw=rh*sw/sh;const panel=this.at(heroX,this.carZ).x-dir*W*.42;
  const from=this.at(A?A.x:-dir*.5,this.carZ).x;const nose=mix(from+dir*rw*.5,panel+dir*W*.06*push,arrive);
  const rx=nose-dir*rw*.5;this.attX=this.camX+(rx-this.vpx)*this.carZ/this.R;
  const copA=()=>{this.shadow(rx,foot-4,rw,.5);c.save();c.translate(rx,foot);c.scale(dir,1);c.drawImage(this.img['patrol-ram'],sx,sy,sw,sh,-rw/2,-rh,rw,rh);c.restore();const p=Math.sin(this.clock*9);this.add(p>0?this.red:this.blue,rx-dir*rw*.12,foot-rh*.93,copW*.2,.7);};
  if(quiet){if(!this.path)this.path=rollPath(dir,.16*dir,rollAt,explosionAt,this.portrait?.8:WALL-.2);this.parked(this.portrait?.36:.52);}
  if(t<rollAt){far();copA();for(const k of this.sim.cars)if(k!==A&&k.z<=this.carZ)this.drawCar(k,quiet);const [a,b,d,e]=YAW[Math.min(3,Math.round(side*3))],cw=W*mix(1,1.28,side),ch=cw*e/d,p=this.at(heroX,this.carZ);this.shadow(p.x,foot,cw,.55);c.save();c.translate(p.x,foot);if(dir<0)c.scale(-1,1);if(side<.17)this.body('coupe',0,0,W,0);else c.drawImage(this.img['coupe-yaw'],a,b,d,e,-cw/2,-ch,cw,ch);c.restore();return;}
  const m=this.tumble(Math.min(t,explosionAt));far(m.z);const p=this.at(m.x,m.z),cw=W*1.28*p.s*this.carZ;
  this.shadow(p.x,p.y,cw*(1-m.hop*.4),.5*(1-m.hop));
  const fr=t>=explosionAt?4:m.frame,[a,b,d,e]=ROLL[fr],ch=cw*e/d;
  c.save();c.translate(p.x,p.y-m.hop*this.U*p.s);if(dir<0)c.scale(-1,1);c.drawImage(this.img['coupe-depth-roll'],a,b,d,e,-cw/2,-ch,cw,ch);if(t>=explosionAt){c.globalAlpha=ease((t-explosionAt)/.4);c.drawImage(this.shadeOf('coupe-depth-roll'),a/2,b/2,d/2,e/2,-cw/2,-ch,cw,ch);}c.restore();
  if(t>=explosionAt){const q=t-explosionAt,size=Math.min(W*2.3,this.h*.62)*(.35+.65*outCubic(q/.32))*(1+q*.05),al=q<.5?1:clamp(1-(q-.5)/1.3);
   if(q<.9&&!quiet){const r=outCubic(q/.8);c.save();c.globalAlpha=(1-r)*.6;c.strokeStyle='#ffe7bd';c.lineWidth=2+10*(1-r);c.beginPath();c.ellipse(p.x,p.y,this.R*.75*r,this.R*.13*r,0,0,7);c.stroke();c.restore();}
   if(al>.01&&!quiet){c.save();c.globalAlpha=al;c.drawImage(this.img.explosion,43,37,1459,928,p.x-size/2,p.y+size*.04-size*.636,size,size*.636);c.restore();this.add(this.flame,p.x,p.y-size*.2,size*.75,al*.5);}
   else{this.add(this.flame,p.x,p.y-ch*.2,cw*.95,.16+.05*Math.sin(this.clock*11));}
   if(quiet)this.stillFire(p.x,p.y,cw);}
  near(m.z);
 }
 // ---------------------------------------------------------------- helicopter
 private heliScene(t:number,quiet:boolean,far:(z?:number)=>void,near:(z?:number)=>void){
  if(quiet)this.parked(this.portrait?.36:.52);
  const c=this.c,{w,h}=this,W=this.carW,foot=this.at(0,this.carZ).y,arr=outCubic(t/1.6),lift=ease((t-heli.lift)/1.85),cab=ease((t-heli.cables)/1.35),dep=ease((t-heli.depart)/(heli.end-heli.depart));
  const pw=Math.min(W,h*.37),cw=mix(W,pw,arr),unit=mix(1,.15,Math.pow(dep,.72)),heliBase=Math.min(w*(this.portrait?.56:.34),400,Math.max(h*.3,(h*.94-h*.05-pw*.652-h*.04-this.top-h*.02)/.80));
  const rx=mix(this.at(this.carX,this.carZ).x,this.vpx,arr)+w*(this.portrait?.2:.24)*dep;
  const air=h*.05*lift,carH=cw*.652*unit;const groundFoot=mix(foot,Math.min(foot,h*.95),arr);
  const footY=mix(groundFoot-air,this.top+(this.hy-this.top)*.82,Math.pow(dep,.85)),sway=quiet?0:Math.sin(t*2.3)*cw*.03*lift*(1-dep),cx=rx+sway*unit;
  const gap=Math.max(h*.04,cw*.1)*unit,hh=heliBase*.807*unit,hw=heliBase*unit;
  const hy=footY-carH-gap-h*.62*(1-arr)-(quiet?0:Math.sin(t*3.1)*h*.006*(1-dep)),hx=rx-(dep>0?w*.01*dep:0),tilt=quiet?0:Math.sin(Math.min(1,dep*2.4)*Math.PI)*.10;
  far(0);
  this.shadow(rx,groundFoot,cw*(1-lift*.25),.6*(1-lift*.6)*(1-dep));
  if(lift<.4)this.tail(cx,footY,cw,.8*(1-lift));
  this.body('coupe',cx,footY,cw*unit,sway*.0006+tilt*.4);
  // slack cables become taut before the lift
  const slack=(1-ease((t-1.9)/.4))*.5;c.lineWidth=Math.max(.8,hw*.007);c.strokeStyle='#1d211f';for(const [sx,px] of [[-.17,-.36],[-.1,-.2],[.1,.2],[.17,.36]] as const){const ax=hx+sx*hw,ay=hy-hh*.02,bx=cx+px*cw*unit,by=footY-carH*(Math.abs(px)>.3?.6:.96),ex=mix(ax,bx,cab),ey=mix(ay,by,cab);if(cab<=0)continue;c.beginPath();c.moveTo(ax,ay);c.quadraticCurveTo(mix(ax,ex,.5)+sx*hw*slack*1.6,mix(ay,ey,.6)+hw*.05*slack,ex,ey);c.stroke();if(cab>.98){c.fillStyle='#d6b46c';c.beginPath();c.arc(ex,ey,Math.max(1,hw*.009),0,7);c.fill();}}
  c.save();c.translate(hx,hy);c.rotate(tilt);c.translate(-hx,-hy);this.body('helicopter',hx,hy,hw);
  // rotor: blurred disc, blades and a bright rim sweep
  const ry=hy-hh*.945,rr=hw*.78;c.save();c.translate(hx,ry);c.scale(1,.12);c.globalAlpha=.34;c.fillStyle='#22272a';c.beginPath();c.arc(0,0,rr,0,7);c.fill();c.globalAlpha=.5;c.lineWidth=rr*.02;c.strokeStyle='#e9e2cf';c.beginPath();c.arc(0,0,rr,0,7);c.stroke();if(!quiet){c.rotate(this.clock*17);c.globalAlpha=.62;c.fillStyle='#15191b';for(let i=0;i<4;i++){c.rotate(Math.PI/2);c.beginPath();c.moveTo(0,-rr*.02);c.lineTo(rr,-rr*.045);c.lineTo(rr,rr*.045);c.lineTo(0,rr*.02);c.fill();}}c.restore();c.restore();
 }
 // ---------------------------------------------------------------- cargo aircraft
 private planeScene(t:number,quiet:boolean,far:(z?:number)=>void,near:(z?:number)=>void){
  if(quiet)this.parked(this.portrait?.36:.52);
  const c=this.c,{w,h}=this,k=cargo,W=this.carW,foot=this.at(0,this.carZ).y,arr=ease((t-k.planeAt)/(k.planeReady-k.planeAt)),climb=ease((t-k.rampNear)/(k.takeoff-k.rampNear)),jump=ease((t-k.takeoff)/(k.landing-k.takeoff)),entry=ease((t-k.landing)/(k.inside-k.landing)),dep=ease((t-k.departure)/(k.exit-k.departure));
  const base=Math.min(w*(this.portrait?1.5:.8),(h-this.top)*1.2,960),sc=mix(1,.12,Math.pow(dep,.6)),pw=base*mix(.2,1,arr)*sc,bob=quiet?0:Math.sin(t*2)*h*.006*(1-dep);
  const px=mix(w*.84,this.vpx,arr)+w*(this.portrait?.16:.22)*dep,py=mix(-h*.3,this.hy*.9,arr)-(this.hy*.9-this.top-(this.hy-this.top)*.36)*dep+bob;// centre
  const ph=pw*.545;
  const z=mix(9,.86,Math.pow(clamp(t/k.rampNear),.8))-Math.max(0,t-k.takeoff)*.9;
  if(t<k.takeoff)far();
  if(t>=k.planeAt){if(!quiet)for(const s of [-.355,-.2,.2,.355])this.add(this.flame,px+s*pw,py+ph*.2,pw*.035,.35+.2*Math.sin(this.clock*40+s*9));this.shadow(px,h*.84,pw*.7,.22*(1-dep));const [sx,sy,sw,sh]=BOX['cargo-plane'];c.drawImage(this.img['cargo-plane'],sx,sy,sw,sh,px-pw/2,py-ph/2,pw,ph);}
  // road ramp
  const R=(zz:number,X:number,Y:number)=>this.at(X,zz,Y);if(z>.62&&t<k.takeoff+.5){const n=Math.max(.64,z),f=z+.75,A=R(n,-.34,0),B=R(n,.34,0),C=R(f,.34,.3),D=R(f,-.34,.3);c.fillStyle='#2c312c';quad(c,A,B,{x:B.x,y:B.y+4},{x:A.x,y:A.y+4});const g=c.createLinearGradient(0,D.y,0,A.y);g.addColorStop(0,'#a3a594');g.addColorStop(1,'#4a5049');c.fillStyle=g;quad(c,A,B,C,D);c.strokeStyle='#2a302b';for(let i=1;i<9;i++){const q=i/9;c.lineWidth=Math.max(.6,2.4/mix(n,f,q));line(c,{x:mix(A.x,D.x,q),y:mix(A.y,D.y,q)},{x:mix(B.x,C.x,q),y:mix(B.y,C.y,q)});}c.strokeStyle='#e0b45f';c.lineWidth=Math.max(1,4/n);line(c,A,D);line(c,B,C);c.strokeStyle='#f0e2b4';c.lineWidth=Math.max(1,3/f);line(c,D,C);const post=R(f,-.34,0),post2=R(f,.34,0);c.strokeStyle='#33372f';c.lineWidth=Math.max(1,4/f);line(c,D,post);line(c,C,post2);}
  // car
  let cw=mix(W,W*.8,climb),x=this.at(this.carX,this.carZ).x,y=foot-climb*h*.13;const holdW=pw*.105,holdY=py+ph*.5;
  if(t>=k.takeoff){x=mix(this.vpx,px,jump);cw=mix(W*.8,holdW,outCubic(jump));y=mix(foot-h*.13,holdY,jump)-Math.sin(jump*Math.PI)*h*.14;}
  if(t>=k.landing){const squash=Math.sin(clamp((t-k.landing)/.3)*Math.PI)*ph*.012;x=px;cw=pw*mix(.105,.05,entry);y=py+ph*mix(.5,.36,entry)+squash;}
  if(t<k.takeoff)this.shadow(x,foot,cw*1.02,.6*(1-climb*.4));else if(jump<1)this.shadow(x,h*.9,cw*.8,.35*(1-jump));
  c.save();if(entry>0){c.beginPath();c.rect(px-pw*.066,py+ph*.1,pw*.132,ph);c.clip();}
  if(!(entry>=1&&dep>.2))this.body('coupe',x,y,cw,t>=k.takeoff&&t<k.landing?Math.sin(jump*Math.PI*2)*.04:0,1-entry*.62);c.restore();
  if(t<k.takeoff+.3)this.exhaust(x,y,cw,quiet?0:Math.max(this.kick,climb*.9));if(jump>0&&jump<1)this.tail(x,y,cw,.7);
  if(t<k.takeoff)near();else far(0);
 }
 // ---------------------------------------------------------------- coast exit
 private dark:Record<string,HTMLCanvasElement>={};
 private shadeOf(name:string){if(this.dark[name])return this.dark[name];const im=this.img[name],cv=document.createElement('canvas');cv.width=im.naturalWidth>>1;cv.height=im.naturalHeight>>1;const g=cv.getContext('2d')!;g.drawImage(im,0,0,cv.width,cv.height);g.globalCompositeOperation='source-atop';g.fillStyle='rgba(14,11,8,.8)';g.fillRect(0,0,cv.width,cv.height);return this.dark[name]=cv;}
 private cliff?:HTMLCanvasElement;private rocks:{x:number;y:number;vy:number;rest:number;size:number;rot:number;flip:number;hit:boolean;wait:number}[]=[];
 /** Rock face cut from the highway plate: the sky is keyed out and the road-side edge is broken up. */
 private buildCliff(){
  const im=this.img['route-highway'];if(!im)return;const cv=document.createElement('canvas');cv.width=520;cv.height=280;const g=cv.getContext('2d')!;g.drawImage(im,1254,200,520,280,0,0,520,280);const d=g.getImageData(0,0,520,280),a=d.data,r=rng(409);const edge=Array.from({length:281},()=>r());
  for(let y=0;y<280;y++)for(let x=0;x<520;x++){const i=(y*520+x)*4,key=clamp((a[i]-a[i+2]+6)/12),wall=66+(258-y)*.36+Math.sin(y*.21)*5+edge[y>>2]*9-4;a[i+3]=255*key*clamp((x-wall)/5)*clamp((274-y)/22);}
  g.putImageData(d,0,0);this.cliff=cv;
 }
 private exitAt=0;private coastZ=1.055;
 private exitGap(t:number){this.once('gap',()=>{this.exitAt=this.dist+(t>50?1.2:34.8);this.rocks=[];});const from=this.exitAt-this.dist;return {from:Math.max(.7,from),to:from+2.3};}
 private rampX(d:number){return 1+.2*d+.013*d*d;}
 private arch(x:number,y:number,w:number,h:number){const c=this.c;c.beginPath();c.moveTo(x-w/2,y);c.lineTo(x-w/2,y-h*.55);c.ellipse(x,y-h*.55,w/2,h*.45,0,Math.PI,0);c.lineTo(x+w/2,y);c.closePath();}
 private exitRamp(gap:{from:number;to:number},t:number){
  const c=this.c,z0=this.exitAt-this.dist,seg=26;const L:P[]=[],Q:P[]=[];
  const zp=z0+MOUTH;if(zp<.7)return;const pm=this.at(this.rampX(MOUTH),zp),su=this.U*pm.s,pw=.6*this.R*pm.s,ph=1.02*su,fade=clamp((40-zp)/10);
  // rock face behind the portal
  if(this.cliff&&fade>0){const k=ph/84;c.globalAlpha=fade;c.drawImage(this.cliff,pm.x-150*k,pm.y-258*k,520*k*1.12,280*k);const g=c.createLinearGradient(0,pm.y-150*k,0,pm.y);g.addColorStop(0,'#0000');g.addColorStop(1,'#2a1f1233');c.globalAlpha=1;}
  for(let i=0;i<=seg;i++){const d=MOUTH*Math.pow(i/seg,1.1),z=z0+d;if(z<.7)continue;const X=this.rampX(d),hw=mix(.3,.36,clamp(d/2));L.push(this.at(Math.max(.99,X-hw),z));Q.push(this.at(X+hw,z));}
  if(L.length>=2){
   const path=()=>{c.beginPath();L.forEach((p,i)=>{i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y);});for(let i=Q.length-1;i>=0;i--)c.lineTo(Q[i].x,Q[i].y);c.closePath();};
   const stroke=(pts:P[],dy:number,col:string,k:number)=>{c.strokeStyle=col;for(let i=1;i<pts.length;i++){c.lineWidth=Math.max(.6,k*pts[i].s);c.beginPath();c.moveTo(pts[i-1].x,pts[i-1].y-dy*this.U*pts[i-1].s);c.lineTo(pts[i].x,pts[i].y-dy*this.U*pts[i].s);c.stroke();}};
   c.fillStyle='#837c6f';path();c.fill();const g=c.createLinearGradient(0,this.hy,0,this.hy+this.G*.7);g.addColorStop(0,'#d9c9ac44');g.addColorStop(1,'#3f3b3466');c.fillStyle=g;c.fill();
   stroke(L,.01,'#eee7d6',7);stroke(Q,.01,'#d9ac52',7);stroke(Q,.06,'#a69d8a',15);stroke(Q,.11,'#dcd3be',5);
  }
  // portal: concrete collar, lit interior, lane leading in
  c.globalAlpha=fade;this.arch(pm.x,pm.y,pw*1.2,ph*1.13);const face=c.createLinearGradient(0,pm.y-ph*1.13,0,pm.y);face.addColorStop(0,'#d6cdb8');face.addColorStop(.5,'#aaa18d');face.addColorStop(1,'#7b7364');c.fillStyle=face;c.fill();c.strokeStyle='#5c5548';c.lineWidth=Math.max(.7,su*.012);c.stroke();
  for(let i=1;i<8;i++){const a=Math.PI+i*Math.PI/8,cx=Math.cos(a),sy=Math.sin(a);line(c,{x:pm.x+cx*pw*.5,y:pm.y-ph*.55+sy*ph*.45},{x:pm.x+cx*pw*.6,y:pm.y-ph*.62+sy*ph*.51});}
  c.save();this.arch(pm.x,pm.y,pw,ph);c.clip();const inn=c.createRadialGradient(pm.x,pm.y-ph*.42,0,pm.x,pm.y-ph*.42,pw*.75);inn.addColorStop(0,'#0c0a07');inn.addColorStop(.5,'#1a150e');inn.addColorStop(1,'#3a3022');c.fillStyle=inn;c.fillRect(pm.x-pw,pm.y-ph*1.2,pw*2,ph*1.3);
  c.fillStyle='#3b362c';quad(c,{x:pm.x-pw*.5,y:pm.y},{x:pm.x+pw*.5,y:pm.y},{x:pm.x+pw*.07,y:pm.y-ph*.36},{x:pm.x-pw*.07,y:pm.y-ph*.36});
  for(let i=0;i<6;i++){const q=((i+((this.clock*.0)%1))/6),k=mix(1,.12,Math.pow(q,.6));for(const sd of [-1,1])this.add(this.white,pm.x+sd*pw*.36*k,pm.y-ph*(.4+.4*k),Math.max(1.2,su*.06*k),.75*k+.15);}
  c.restore();c.globalAlpha=1;
  // gore sign
  const gz=z0+1.1;if(gz>.8&&gz<40){const p=this.at(this.rampX(1.1)+.5,gz),q=this.U*p.s,bw=q*.5,bh=q*.27,by=p.y-q*.62;c.fillStyle='#59605b';c.fillRect(p.x-bw*.28,by,Math.max(1,q*.025),p.y-by);c.fillRect(p.x+bw*.25,by,Math.max(1,q*.025),p.y-by);c.fillStyle='#26331f';round(c,p.x-bw/2,by,bw,bh,q*.03);c.fill();c.strokeStyle='#eee8da';c.lineWidth=Math.max(1,q*.012);c.stroke();c.fillStyle='#f3ead6';c.textAlign='center';c.textBaseline='middle';c.font=`italic 900 ${bh*.52}px Impact,'Arial Narrow',sans-serif`;c.fillText('EXIT ↗',p.x,by+bh*.54);}
 }
 /** The slide closes the mouth behind the coupe. */
 private landslide(dt:number,t:number){
  if(t<coast.slide)return;this.once('slide',()=>{this.shake=.75;for(let i=0;i<20;i++){const x=(this.bits.rand()-.5)*.62,h=Math.max(0,.62-Math.abs(x)*1.35)*this.bits.rand(.25,1);this.rocks.push({x,y:1.12+this.bits.rand(-.06,.1),vy:this.bits.rand(0,.35),wait:i*.042+this.bits.rand(0,.1),rest:h,size:this.bits.rand(.17,.34),rot:this.bits.rand(-.5,.5),flip:this.bits.rand()<.5?-1:1,hit:false});}this.rocks.sort((a,b)=>b.rest-a.rest);const zq=this.exitAt-this.dist+MOUTH,Xq=this.rampX(MOUTH);for(let i=0;i<14;i++)this.bits.add({kind:'puff',x:Xq+this.bits.rand(-.35,.35),y:this.bits.rand(1,1.25),z:zq,vx:this.bits.rand(-.2,.2),vy:this.bits.rand(0,.3),life:this.bits.rand(.8,1.6),size:.1,grow:.2,alpha:.6,tint:1,front:true,pin:true});});
  const zp=this.exitAt-this.dist+MOUTH,X=this.rampX(MOUTH);
  for(const r of this.rocks){if((r.wait-=dt)>0||r.y<=r.rest&&r.hit)continue;r.vy-=3.4*dt;r.y+=r.vy*dt;r.rot+=dt*2.2*r.flip;if(r.y<r.rest){r.y=r.rest;if(!r.hit){r.hit=true;this.shake=Math.max(this.shake,.34);this.dustRing(X+r.x,zp-.25,5,.55);}r.vy=0;}}
  if(t<coast.slide+1.6&&this.bits.rand()<dt*36)this.bits.add({kind:'puff',x:X+this.bits.rand(-.35,.35),y:this.bits.rand(0,.5),z:zp-.2,vx:this.bits.rand(-.2,.2),vy:this.bits.rand(.05,.3),life:this.bits.rand(1,2),size:.09,grow:.16,alpha:.5,tint:1,front:true,pin:true});
 }
 private drawRocks(){const sheet=this.img['route-props'];if(!sheet||!this.rocks.length)return;const c=this.c,zp=this.exitAt-this.dist+MOUTH-.15,X=this.rampX(MOUTH),[sx,sy,sw,sh]=PROPS[4];for(const r of this.rocks){if(r.wait>0)continue;const p=this.at(X+r.x,zp,r.y),w=r.size*this.R*p.s*1.15,h=w*sh/sw;c.save();c.translate(p.x,p.y);c.rotate(r.rot*.4);c.scale(r.flip,1);c.drawImage(sheet,sx,sy,sw,sh,-w/2,-h,w,h);c.restore();}}
 private coastScene(t:number,quiet:boolean,far:(z?:number)=>void,near:(z?:number)=>void){
  const c=this.c,k=coast,W=this.carW,go=ease((t-k.turn)/(k.left-k.turn)),z0=this.exitAt-this.dist,zp=z0+MOUTH,pre=ease(t/k.turn);
  let X=mix(this.carX,.5,pre),z=this.carZ;
  if(t>=k.turn){z=mix(this.carZ,3.3,go)+Math.max(0,t-k.left)*2.4;const on=z-z0;X=on>0?Math.max(this.rampX(on),.9):mix(.5,.96,ease((t-k.turn)/.9));}
  if(quiet)this.parked(this.portrait?.36:.52,this.camX);
  if(quiet&&!this.rocks.length)for(let i=0;i<20;i++){const r=rng(i*77+5),x=(r()-.5)*.62;this.rocks.push({x,y:Math.max(0,.62-Math.abs(x)*1.35)*r(),vy:0,rest:0,size:.17+r()*.17,rot:0,flip:r()<.5?-1:1,hit:true,wait:0});}
  this.coastZ=z;const p=this.at(X,z),cw=W*p.s*this.carZ,pose=go<.12?0:go<.5?1:z<zp-.9?2:1,foot=p.y,inside=z-zp;
  const car=()=>{if(inside>1.7)return;const pm=this.at(this.rampX(MOUTH),zp);c.save();if(inside>0){this.arch(pm.x,pm.y,.6*this.R*pm.s,1.02*this.U*pm.s);c.clip();}
   if(inside<=0)this.shadow(p.x,foot,cw*1.1,.55);
   if(pose===0)this.body('coupe',p.x,foot,cw,.02*pre);else{const [a,b,d,e]=YAW[pose],yw=cw*(pose===2?1.22:1.16),yh=yw*e/d;c.save();c.translate(inside>0?mix(p.x,pm.x,clamp(inside*1.5)):p.x,foot);c.scale(-1,1);c.drawImage(this.img['coupe-yaw'],a,b,d,e,-yw/2,-yh,yw,yh);if(inside>0){c.globalAlpha=mix(.35,1,clamp(inside/1.2));c.drawImage(this.shadeOf('coupe-yaw'),a/2,b/2,d/2,e/2,-yw/2,-yh,yw,yh);}c.restore();}
   if(inside<1.4)for(const s of [-.2,.25])this.add(this.red,(inside>0?pm.x:p.x)+s*cw,foot-cw*.27,cw*.2,inside>0?.8:.35);
   if(!quiet&&t<k.turn+.8)this.exhaust(p.x,foot,cw,this.kick*(pose?0:1));c.restore();};
  if(inside>-.2){car();this.drawRocks();far(0);}else{far(z);car();near(z);}
 }
}
function quad(c:CanvasRenderingContext2D,a:{x:number;y:number},b:{x:number;y:number},d:{x:number;y:number},e:{x:number;y:number}){c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.lineTo(d.x,d.y);c.lineTo(e.x,e.y);c.closePath();c.fill();}
function line(c:CanvasRenderingContext2D,a:{x:number;y:number},b:{x:number;y:number}){c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.stroke();}
function round(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){c.beginPath();c.roundRect(x,y,w,h,r);}
