import {BALL_RADIUS,STEP,WHEEL} from './BallPhysics';

/** One frame of the wheel. Angles in degrees, ball coordinates in wheel pixels. */
export type WheelFrame = {
  rotor:number; ball:{x:number;y:number;z:number;ux:number;uy:number;airborne:boolean;visible:boolean};
  highlight:number|null; glow:number; time:number;
};
type Palette = {plate:string;plateDeep:string;pocket:string;pocketDeep:string};
const PALETTE:Record<string,Palette> = {
  red:{plate:'#b3303b',plateDeep:'#6e1820',pocket:'#7d1d26',pocketDeep:'#3a0b10'},
  black:{plate:'#1d2622',plateDeep:'#070b09',pocket:'#141b18',pocketDeep:'#030504'},
  green:{plate:'#2f8a55',plateDeep:'#0f4227',pocket:'#1f6a3f',pocketDeep:'#08281a'},
};
const RIM_LIFT = 9, SKIRT = 26, LAMP = {x:-.42,y:-.62};
const TAU = Math.PI*2;

/** Draws the wheel into a canvas. Textures are rebuilt only when the size changes. */
export class WheelRenderer {
  private ctx:CanvasRenderingContext2D;
  private width=0; private height=0; private dpr=1; private scale=1; private cx=0; private cy=0;
  /** Camera tilt: the bowl is seen from above and in front, like a seat at the table. Taller boxes look from higher up. */
  private tilt={cos:.6,sin:.8};
  private base?:HTMLCanvasElement; private rotor?:HTMLCanvasElement; private light?:HTMLCanvasElement; private rim?:HTMLCanvasElement;
  private spin:[number,number,number,number]=[1,0,0,0];
  private omega:[number,number,number]=[0,0,0];
  private last=0;
  private trail:{x:number;y:number}[]=[];
  constructor(private canvas:HTMLCanvasElement,private numbers:readonly number[],private color:(n:number)=>string) {
    this.ctx=canvas.getContext('2d',{alpha:true})!;
  }
  /** Projected wheel ellipse in CSS pixels, for overlays placed around the wheel. */
  bounds() { return {cx:this.cx,cy:this.cy,rx:200*this.scale,ry:200*this.scale*this.tilt.cos}; }
  resize() {
    const box=this.canvas.getBoundingClientRect(),dpr=Math.min(2,Math.max(1,devicePixelRatio||1));
    const width=Math.round(box.width),height=Math.round(box.height);
    if(width<10||height<10)return false;
    if(width===this.width&&height===this.height&&dpr===this.dpr&&this.base)return false;
    this.width=width;this.height=height;this.dpr=dpr;
    const cos=Math.max(.6,Math.min(.74,.6+(height/width-.75)*.25));this.tilt={cos,sin:Math.sqrt(1-cos*cos)};
    this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);
    const total=(400*this.tilt.cos+(RIM_LIFT+SKIRT)*this.tilt.sin+18);
    this.scale=Math.min(width*.985/400,height/total);
    this.cx=width/2;this.cy=(height-(total-18)*this.scale)/2+(200*this.tilt.cos+RIM_LIFT*this.tilt.sin)*this.scale;
    const size=Math.min(2048,Math.ceil(400*this.scale*dpr));
    this.rotor=this.rotorTexture(size);this.light=this.lightTexture(size);this.rim=this.rimTexture(size);
    this.base=this.baseLayer(size);
    this.trail=[];
    return true;
  }
  private texture(size:number) {
    const c=document.createElement('canvas');c.width=c.height=size;
    const g=c.getContext('2d')!;g.translate(size/2,size/2);g.scale(size/400,size/400);return {c,g};
  }
  private ring(g:CanvasRenderingContext2D,outer:number,inner:number,fill:string|CanvasGradient) {
    g.beginPath();g.arc(0,0,outer,0,TAU);g.arc(0,0,inner,0,TAU,true);g.fillStyle=fill;g.fill('evenodd');
  }
  private radial(g:CanvasRenderingContext2D,stops:[number,string][],r0=0,r1=200) {
    const gradient=g.createRadialGradient(0,0,r0,0,0,r1);
    for(const [at,color] of stops)gradient.addColorStop(Math.max(0,Math.min(1,(at-r0)/(r1-r0))),color);
    return gradient;
  }
  private brass(g:CanvasRenderingContext2D,from:number,to:number) {
    const gradient=g.createLinearGradient(from,from,to,to);
    gradient.addColorStop(0,'#5b3c18');gradient.addColorStop(.22,'#f8e3a2');gradient.addColorStop(.45,'#b18440');
    gradient.addColorStop(.62,'#fff1c4');gradient.addColorStop(.82,'#8a612b');gradient.addColorStop(1,'#e2c07a');
    return gradient;
  }
  /** Static stator: ball track, deflector cone and diamonds. Drawn flat, then tilted. */
  private statorTexture(size:number) {
    const {c,g}=this.texture(size);
    this.ring(g,WHEEL.wall,172,this.radial(g,[[172,'#2a1710'],[178,'#4a2a19'],[185,'#5d3520'],[191,'#24130c']],172,191));
    // Lacquered wood grain on the track.
    g.save();g.globalAlpha=.16;g.strokeStyle='#e0b27c';g.lineWidth=.35;
    for(let r=173.5;r<190.5;r+=1.6){g.beginPath();g.arc(0,0,r,0,TAU);g.stroke();}
    g.restore();
    this.ring(g,172.6,171,'#c99a55');
    this.ring(g,171,WHEEL.rotor,this.radial(g,[[150,'#140d09'],[154,'#2a1a11'],[163,'#3c2618'],[171,'#22140d']],150,171));
    // Sunburst inlay on the deflector cone.
    g.save();g.globalAlpha=.22;
    for(let i=0;i<64;i++){const a=i/64*TAU;g.strokeStyle=i%2?'#7a5232':'#0c0705';g.lineWidth=1.4;g.beginPath();
      g.moveTo(Math.sin(a)*152,-Math.cos(a)*152);g.lineTo(Math.sin(a)*170,-Math.cos(a)*170);g.stroke();}
    g.restore();
    for(let i=0;i<8;i++){
      const a=(i+.5)*TAU/8,upright=i%2===0;
      g.save();g.rotate(a);g.translate(0,-WHEEL.diamond);
      const w=upright?3.6:6.2,h=upright?6.6:3.4;
      g.beginPath();g.moveTo(0,-h);g.lineTo(w,0);g.lineTo(0,h);g.lineTo(-w,0);g.closePath();
      g.fillStyle=this.brass(g,-w,w);g.fill();g.strokeStyle='#3b2610';g.lineWidth=.5;g.stroke();
      g.beginPath();g.moveTo(0,-h);g.lineTo(w*.35,-h*.1);g.lineTo(0,h*.2);g.closePath();g.fillStyle='#fff6d0aa';g.fill();
      g.restore();
    }
    return c;
  }
  /** Rotating part: number plates, pockets, frets, cone and turret base. No directional light is baked in. */
  private rotorTexture(size:number) {
    const {c,g}=this.texture(size);
    const sector=(outer:number,inner:number,i:number)=>{
      const a=i*STEP-STEP/2-Math.PI/2,b=a+STEP;
      g.beginPath();g.arc(0,0,outer,a,b);g.arc(0,0,inner,b,a,true);g.closePath();
    };
    this.numbers.forEach((n,i)=>{
      const p=PALETTE[this.color(n)];
      sector(WHEEL.rotor,WHEEL.pocketOuter,i);
      g.fillStyle=this.radial(g,[[128,p.plateDeep],[134,p.plate],[146,p.plate],[150,p.plateDeep]],128,150);g.fill();
      sector(WHEEL.pocketOuter,WHEEL.pocketInner,i);
      g.fillStyle=this.radial(g,[[107,p.pocketDeep],[113,p.pocket],[124,p.pocket],[128,p.pocketDeep]],107,128);g.fill();
    });
    // Numbers read outwards, as on a casino wheel.
    g.textAlign='center';g.textBaseline='middle';g.font='700 12.5px Georgia, "Times New Roman", serif';
    this.numbers.forEach((n,i)=>{
      g.save();g.rotate(i*STEP);g.translate(0,-139.2);
      g.fillStyle='#00000066';g.fillText(String(n),.4,.6);g.fillStyle='#fff4dc';g.fillText(String(n),0,0);g.restore();
    });
    // Frets and plate dividers.
    for(let i=0;i<this.numbers.length;i++){
      const a=(i+.5)*STEP,sx=Math.sin(a),sy=-Math.cos(a);
      g.strokeStyle='#e9c983';g.lineWidth=.7;g.globalAlpha=.85;g.beginPath();g.moveTo(sx*WHEEL.pocketOuter,sy*WHEEL.pocketOuter);g.lineTo(sx*WHEEL.rotor,sy*WHEEL.rotor);g.stroke();
      g.globalAlpha=1;g.lineCap='round';
      g.strokeStyle='#4a3214';g.lineWidth=WHEEL.fretHalf*2+.9;g.beginPath();g.moveTo(sx*(WHEEL.pocketInner+.5),sy*(WHEEL.pocketInner+.5));g.lineTo(sx*WHEEL.pocketOuter,sy*WHEEL.pocketOuter);g.stroke();
      g.strokeStyle='#f2d897';g.lineWidth=WHEEL.fretHalf*1.3;g.beginPath();g.moveTo(sx*(WHEEL.pocketInner+.5),sy*(WHEEL.pocketInner+.5));g.lineTo(sx*WHEEL.pocketOuter,sy*WHEEL.pocketOuter);g.stroke();
    }
    this.ring(g,WHEEL.rotor+1.4,WHEEL.rotor-.6,this.brass(g,-150,150));
    this.ring(g,WHEEL.pocketOuter+.7,WHEEL.pocketOuter-.7,'#d9b676');
    this.ring(g,WHEEL.pocketInner+.6,WHEEL.pocketInner-2.4,this.brass(g,-110,110));
    // Polished centre cone with marquetry so its rotation stays readable.
    this.ring(g,WHEEL.pocketInner-2.4,32,this.radial(g,[[32,'#2c160d'],[52,'#6a3a20'],[78,'#8d522c'],[96,'#5a3019'],[105,'#2a150c']],32,105));
    g.save();
    for(let i=0;i<8;i++){
      g.rotate(TAU/8);
      g.beginPath();g.moveTo(0,-36);g.quadraticCurveTo(7,-66,0,-98);g.quadraticCurveTo(-7,-66,0,-36);
      g.fillStyle=i%2?'#c9a05e55':'#1a0d0766';g.fill();
    }
    g.restore();
    this.ring(g,98,96.6,'#d4ae6c99');this.ring(g,40,36,this.brass(g,-40,40));
    this.ring(g,36,0,this.radial(g,[[0,'#f6dfa0'],[18,'#9c7337'],[30,'#4c3415'],[36,'#cfa964']],0,36));
    return c;
  }
  /** Lamp above the table: a fixed glare and falloff that the rotor turns underneath. */
  private lightTexture(size:number) {
    const {c,g}=this.texture(size);
    const lamp=g.createRadialGradient(LAMP.x*200,LAMP.y*200,4,LAMP.x*120,LAMP.y*120,250);
    lamp.addColorStop(0,'#fff6dd66');lamp.addColorStop(.35,'#ffe6b022');lamp.addColorStop(1,'#00000000');
    g.beginPath();g.arc(0,0,WHEEL.wall,0,TAU);g.fillStyle=lamp;g.fill();
    const shade=g.createLinearGradient(-150,-150,170,170);shade.addColorStop(0,'#00000000');shade.addColorStop(.55,'#00000000');shade.addColorStop(1,'#00000070');
    g.fillStyle=shade;g.fill();
    // Specular reflections of the lamp on the lacquered track and the brass ring.
    g.lineCap='round';
    for(const [r,width,alpha,from,to] of [[181,7,.2,-1.05,-.35],[150.4,1.6,.55,-1.0,-.45],[107,1.8,.5,-1.15,-.6],[96,4,.12,-1.1,-.5]] as const){
      const gradient=g.createLinearGradient(Math.sin(from)*r,-Math.cos(from)*r,Math.sin(to)*r,-Math.cos(to)*r);
      gradient.addColorStop(0,'#fff8e000');gradient.addColorStop(.5,`rgba(255,248,224,${alpha})`);gradient.addColorStop(1,'#fff8e000');
      g.strokeStyle=gradient;g.lineWidth=width;g.beginPath();g.arc(0,0,r,from-Math.PI/2,to-Math.PI/2);g.stroke();
    }
    return c;
  }
  private rimTexture(size:number) {
    const {c,g}=this.texture(size);
    this.ring(g,WHEEL.rim,WHEEL.wall,this.radial(g,[[191,'#3a1f12'],[194,'#7a4527'],[197.5,'#a7663a'],[200,'#3c2113']],191,200));
    this.ring(g,WHEEL.wall+1.3,WHEEL.wall,this.brass(g,-191,191));
    this.ring(g,WHEEL.rim,WHEEL.rim-1,'#e6c27c');
    const glare=g.createLinearGradient(-200,-200,60,60);glare.addColorStop(0,'#fff1d055');glare.addColorStop(.5,'#fff1d000');
    this.ring(g,WHEEL.rim,WHEEL.wall,glare);
    return c;
  }
  /** Shadow, cabinet side, inner wall and stator, pre-composited at screen resolution. */
  private baseLayer(size:number) {
    const c=document.createElement('canvas');c.width=this.canvas.width;c.height=this.canvas.height;
    const g=c.getContext('2d')!,s=this.scale,k=this.tilt.cos;
    g.scale(this.dpr,this.dpr);g.translate(this.cx,this.cy);
    const lift=-RIM_LIFT*this.tilt.sin*s,skirt=SKIRT*this.tilt.sin*s;
    g.save();g.translate(0,skirt+8*s);g.scale(1,k);g.filter=`blur(${Math.max(4,14*s)}px)`;
    g.beginPath();g.arc(0,0,204*s,0,TAU);g.fillStyle='#000000a0';g.fill();g.restore();
    // Cabinet side, visible below the near half of the rim.
    g.save();
    const side=g.createLinearGradient(-200*s,0,200*s,0);
    side.addColorStop(0,'#1e0f08');side.addColorStop(.3,'#5a3018');side.addColorStop(.48,'#8a5530');side.addColorStop(.7,'#4a2614');side.addColorStop(1,'#160b06');
    g.beginPath();g.ellipse(0,lift,200*s,200*s*k,0,0,Math.PI);g.lineTo(-200*s,skirt);g.ellipse(0,skirt,200*s,200*s*k,0,Math.PI,0,true);g.closePath();
    g.fillStyle=side;g.fill();
    g.beginPath();g.ellipse(0,skirt,200*s,200*s*k,0,0,Math.PI);g.strokeStyle='#d9b06a55';g.lineWidth=1.2;g.stroke();
    g.restore();
    // Inner wall of the bowl: shows on the far side between the raised rim and the track.
    g.beginPath();g.ellipse(0,lift,WHEEL.wall*s,WHEEL.wall*s*k,0,0,TAU);
    const wall=g.createLinearGradient(0,lift-WHEEL.wall*s*k,0,WHEEL.wall*s*k);wall.addColorStop(0,'#5e341d');wall.addColorStop(.25,'#2c170d');wall.addColorStop(1,'#120905');
    g.fillStyle=wall;g.fill();
    g.save();g.scale(s,s*k);const stator=this.statorTexture(size);g.drawImage(stator,-200,-200,400,400);g.restore();
    return c;
  }
  private project(x:number,y:number,z:number) {
    return {x:this.cx+x*this.scale,y:this.cy+(y*this.tilt.cos-z*this.tilt.sin)*this.scale};
  }
  render(frame:WheelFrame) {
    if(!this.base&&!this.resize())return;
    const g=this.ctx,s=this.scale,k=this.tilt.cos,theta=frame.rotor*Math.PI/180;
    g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,this.canvas.width,this.canvas.height);
    g.drawImage(this.base!,0,0);
    g.setTransform(this.dpr,0,0,this.dpr,0,0);
    g.save();g.translate(this.cx,this.cy);g.scale(s,s*k);
    // Soft contact shadow of the rotor rim on the stator.
    g.beginPath();g.arc(0,0,WHEEL.rotor+3,0,TAU);g.fillStyle='#00000055';g.fill();
    g.save();g.rotate(theta);g.drawImage(this.rotor!,-200,-200,400,400);
    if(frame.highlight!==null&&frame.glow>0){
      const a=frame.highlight*STEP-STEP/2-Math.PI/2,b=a+STEP,pulse=.55+.45*Math.sin(frame.time/170);
      g.beginPath();g.arc(0,0,WHEEL.rotor,a,b);g.arc(0,0,WHEEL.pocketInner,b,a,true);g.closePath();
      g.fillStyle=`rgba(255,228,150,${.2*frame.glow*pulse})`;g.fill();
      g.strokeStyle=`rgba(255,236,176,${.9*frame.glow})`;g.lineWidth=1.6;g.shadowColor='#ffd98a';g.shadowBlur=12*frame.glow;g.stroke();
      g.shadowBlur=0;
    }
    g.restore();
    g.globalCompositeOperation='soft-light';g.drawImage(this.light!,-200,-200,400,400);
    g.globalCompositeOperation='screen';g.globalAlpha=.55;g.drawImage(this.light!,-200,-200,400,400);
    g.globalCompositeOperation='source-over';g.globalAlpha=1;
    g.restore();
    this.turret(theta);
    this.drawBall(frame);
    g.save();g.translate(this.cx,this.cy-RIM_LIFT*this.tilt.sin*s);g.scale(s,s*k);g.drawImage(this.rim!,-200,-200,400,400);g.restore();
  }
  /** Centre turret: four chrome arms and a knob, standing above the cone. */
  private turret(theta:number) {
    const g=this.ctx,s=this.scale;
    const arms=[0,1,2,3].map(i=>{const a=theta+Math.PI/4+i*Math.PI/2;return {a,depth:-Math.cos(a)};}).sort((p,q)=>p.depth-q.depth);
    const stem=this.project(0,0,0),top=this.project(0,0,24);
    g.save();
    g.beginPath();g.ellipse(stem.x,stem.y,15*s,15*s*this.tilt.cos,0,0,TAU);g.fillStyle='#00000055';g.fill();
    const body=g.createLinearGradient(stem.x-8*s,0,stem.x+8*s,0);body.addColorStop(0,'#5a4020');body.addColorStop(.35,'#fff0c0');body.addColorStop(.7,'#a87b3c');body.addColorStop(1,'#3e2a12');
    g.fillStyle=body;g.beginPath();g.moveTo(stem.x-7*s,stem.y);g.lineTo(top.x-4*s,top.y);g.lineTo(top.x+4*s,top.y);g.lineTo(stem.x+7*s,stem.y);g.closePath();g.fill();
    for(const arm of arms){
      const ex=Math.sin(arm.a),ey=-Math.cos(arm.a);
      const root=this.project(ex*5,ey*5,18),tip=this.project(ex*44,ey*44,12),knob=this.project(ex*47,ey*47,13);
      const light=.5+.5*(ex*-LAMP.x+ey*-LAMP.y)*-1;
      const nx=-(tip.y-root.y),ny=tip.x-root.x,len=Math.hypot(nx,ny)||1,wr=3.6*s/len,wt=1.6*s/len;
      const shade=g.createLinearGradient(root.x+nx*wr,root.y+ny*wr,root.x-nx*wr,root.y-ny*wr);
      shade.addColorStop(0,'#4a3517');shade.addColorStop(.45,`rgba(255,${226+Math.round(20*light)},${170+Math.round(50*light)},1)`);shade.addColorStop(1,'#6b4c22');
      g.beginPath();g.moveTo(root.x+nx*wr,root.y+ny*wr);g.lineTo(tip.x+nx*wt,tip.y+ny*wt);g.lineTo(tip.x-nx*wt,tip.y-ny*wt);g.lineTo(root.x-nx*wr,root.y-ny*wr);g.closePath();
      g.fillStyle=shade;g.fill();
      const ball=g.createRadialGradient(knob.x-1.2*s,knob.y-1.4*s,.3*s,knob.x,knob.y,3.6*s);ball.addColorStop(0,'#fffbe6');ball.addColorStop(.5,'#d3aa60');ball.addColorStop(1,'#5a3e18');
      g.beginPath();g.arc(knob.x,knob.y,3.4*s,0,TAU);g.fillStyle=ball;g.fill();
    }
    const cap=g.createRadialGradient(top.x-3*s,top.y-3.5*s,.5*s,top.x,top.y,9*s);cap.addColorStop(0,'#fffdf2');cap.addColorStop(.35,'#f1d48e');cap.addColorStop(.75,'#9a6f32');cap.addColorStop(1,'#4a3214');
    g.beginPath();g.ellipse(top.x,top.y,8.5*s,8.5*s*.86,0,0,TAU);g.fillStyle=cap;g.fill();
    g.restore();
  }
  private drawBall(frame:WheelFrame) {
    const g=this.ctx,b=frame.ball,s=this.scale;
    const dt=this.last?Math.min(.05,Math.max(0,(frame.time-this.last)/1000)):0;this.last=frame.time;
    if(!b.visible){this.trail=[];return;}
    this.integrateSpin(b,dt);
    const p=this.project(b.x,b.y,b.z),floor=this.project(b.x,b.y,0),radius=(BALL_RADIUS+.5)*s;
    // Shadow under the ball, wider and fainter as it hops.
    g.save();
    g.beginPath();g.ellipse(floor.x+(1.2+b.z*.35)*s,floor.y+(1+b.z*.2)*s,radius*(1.05+b.z*.05),radius*this.tilt.cos*(1.05+b.z*.05),0,0,TAU);
    g.fillStyle=`rgba(0,0,0,${Math.max(.12,.5-b.z*.045)})`;g.filter=`blur(${Math.max(.6,(1+b.z*.25)*s)}px)`;g.fill();
    g.restore();
    // Motion blur along the screen-space path.
    this.trail.unshift({x:p.x,y:p.y});this.trail.length=Math.min(this.trail.length,5);
    const speed=Math.hypot(b.ux,b.uy);
    if(speed>500&&this.trail.length>1){
      for(let i=this.trail.length-1;i>0;i--){
        const q=this.trail[i],fade=(1-i/this.trail.length)*Math.min(.45,(speed-500)/2400);
        g.beginPath();g.arc(q.x,q.y,radius*(1-i*.07),0,TAU);g.fillStyle=`rgba(255,250,236,${fade})`;g.fill();
      }
    } else if(speed<=500)this.trail.length=1;
    const body=g.createRadialGradient(p.x-radius*.38,p.y-radius*.42,radius*.08,p.x,p.y,radius*1.05);
    body.addColorStop(0,'#ffffff');body.addColorStop(.32,'#f7f3ea');body.addColorStop(.72,'#cfc8b8');body.addColorStop(1,'#77705f');
    g.beginPath();g.arc(p.x,p.y,radius,0,TAU);g.fillStyle=body;g.fill();
    this.seam(p.x,p.y,radius,dt);
    g.beginPath();g.arc(p.x-radius*.36,p.y-radius*.4,radius*.26,0,TAU);g.fillStyle='rgba(255,255,255,.95)';g.fill();
  }
  /** Rolling without slipping: the top of the ball moves along its velocity relative to the surface. */
  private integrateSpin(b:WheelFrame['ball'],dt:number) {
    if(!b.airborne){const r=BALL_RADIUS;this.omega=[-b.uy/r,b.ux/r,0];}
    const [wx,wy,wz]=this.omega,rate=Math.hypot(wx,wy,wz),angle=rate*dt;
    if(angle<1e-9)return;
    const h=angle/2,sn=Math.sin(h)/rate,dq:[number,number,number,number]=[Math.cos(h),wx*sn,wy*sn,wz*sn],q=this.spin;
    const next:[number,number,number,number]=[
      dq[0]*q[0]-dq[1]*q[1]-dq[2]*q[2]-dq[3]*q[3],
      dq[0]*q[1]+dq[1]*q[0]+dq[2]*q[3]-dq[3]*q[2],
      dq[0]*q[2]-dq[1]*q[3]+dq[2]*q[0]+dq[3]*q[1],
      dq[0]*q[3]+dq[1]*q[2]-dq[2]*q[1]+dq[3]*q[0]];
    const n=Math.hypot(...next);this.spin=next.map(v=>v/n) as [number,number,number,number];
  }
  /** A faint seam on the ball. It fades out when the spin is too fast for the eye to follow. */
  private seam(cx:number,cy:number,radius:number,dt:number) {
    const rate=Math.hypot(...this.omega)*Math.max(dt,1/60),alpha=Math.max(0,Math.min(1,1.5-rate))*.55;
    if(alpha<.02)return;
    const g=this.ctx,[w,x,y,z]=this.spin;
    const rotate=(vx:number,vy:number,vz:number)=>{
      const tx=2*(y*vz-z*vy),ty=2*(z*vx-x*vz),tz=2*(x*vy-y*vx);
      return [vx+w*tx+(y*tz-z*ty),vy+w*ty+(z*tx-x*tz),vz+w*tz+(x*ty-y*tx)];
    };
    g.save();g.beginPath();g.arc(cx,cy,radius*.96,0,TAU);g.clip();g.lineWidth=Math.max(.6,radius*.16);g.lineCap='round';
    for(const ring of [0,1]){
      let prev:{x:number;y:number;front:boolean}|null=null;
      for(let i=0;i<=28;i++){
        const a=i/28*TAU,c=Math.cos(a),sn=Math.sin(a);
        const [dx,dy,dz]=ring?rotate(c*.82,sn*.82,.57):rotate(0,c,sn);
        const depth=dy*this.tilt.sin+dz*this.tilt.cos,point={x:cx+dx*radius,y:cy+(dy*this.tilt.cos-dz*this.tilt.sin)*radius,front:depth>0};
        if(prev&&prev.front&&point.front){g.strokeStyle=`rgba(120,108,88,${alpha*Math.min(1,depth*2)})`;g.beginPath();g.moveTo(prev.x,prev.y);g.lineTo(point.x,point.y);g.stroke();}
        prev=point;
      }
    }
    g.restore();
  }
  destroy(){this.base=this.rotor=this.light=this.rim=undefined;}
}
