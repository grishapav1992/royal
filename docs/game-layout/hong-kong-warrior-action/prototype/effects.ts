/** Inked effects. Every particle is a function of its event and time. */
import type {Fx} from './fight';
import {clamp,smooth} from './track';
export type View={X:(x:number,z?:number)=>number;Y:(y:number,z?:number)=>number;H:number;w:number;h:number;ground:number};
const rand=(seed:number,i:number)=>{let t=(seed+i*0x9e3779b9)>>>0;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
const INK='#22150d',CREAM='#fff1cf',GOLD='#f0b04a',RED='#b23a2b';
export const LIFE:Record<Fx['kind'],number>={hit:.3,block:.2,dust:.6,sweat:.55,wood:1.05,china:1,fruit:1.4,arc:.2,kanji:.95,lines:.42,land:.5};
function star(c:CanvasRenderingContext2D,x:number,y:number,r:number,n:number,seed:number,turn:number){
  c.beginPath();
  for(let i=0;i<n*2;i++){const a=turn+i*Math.PI/n,k=(i%2?.42:.82+rand(seed,i)*.38)*r;c.lineTo(x+Math.cos(a)*k,y+Math.sin(a)*k);}
  c.closePath();
}
export function drawFx(c:CanvasRenderingContext2D,f:Fx,time:number,v:View,layer:'back'|'front'){
  const life=LIFE[f.kind],e=time-f.t;if(e<0||e>life)return;
  const u=e/life,x=v.X(f.x,f.z),y=v.Y(f.y,f.z),H=v.H;
  const back=f.kind==='arc'||f.kind==='lines';if(back!==(layer==='back'))return;
  c.save();
  if(f.kind==='hit'||f.kind==='block'){
    const block=f.kind==='block',r=H*(block?.085:.095+.04*f.power)*(.55+.6*smooth(e/.07)),fade=1-smooth((u-.45)/.55);
    c.globalAlpha=fade;c.lineJoin='round';
    if(!block){star(c,x,y,r*1.28,9,f.seed,f.seed%7);c.fillStyle=f.power>1.4?RED:'#c8632f';c.fill();c.lineWidth=Math.max(1.2,H*.009);c.strokeStyle=INK;c.stroke();}
    star(c,x,y,r*(block?.8:.95),block?6:8,f.seed+3,f.seed%5+.3);c.fillStyle=block?'#d9d2c0':GOLD;c.fill();if(block){c.lineWidth=1.4;c.strokeStyle=INK;c.stroke();}
    star(c,x,y,r*.56,7,f.seed+9,f.seed%3);c.fillStyle=CREAM;c.fill();
    c.strokeStyle=block?'#cfc6b0':CREAM;c.lineCap='round';
    const n=block?4:7;for(let i=0;i<n;i++){const a=rand(f.seed,40+i)*Math.PI*2,s=r*(1.15+u*1.1),l=r*(.28+.4*rand(f.seed,60+i))*(1-u);c.lineWidth=Math.max(1,H*.007);c.beginPath();c.moveTo(x+Math.cos(a)*s,y+Math.sin(a)*s);c.lineTo(x+Math.cos(a)*(s+l),y+Math.sin(a)*(s+l));c.stroke();}
  }else if(f.kind==='arc'){
    c.globalAlpha=Math.sin(Math.min(1,u*1.15)*Math.PI)*.75;
    const tip=f.x2??f.x,tx=v.X(tip,f.z),s=f.dir,R=Math.abs(tx-x)||H*.5;
    const head=smooth(e/.1),tail=smooth((e-.05)/.14);
    const pt=(t:number):[number,number]=>{
      if(f.shape==='up'){const a=1.25-t*1.25;return [x+s*R*(.15+Math.cos(a)*.85),y+Math.sin(a)*H*.55];}
      if(f.shape==='spin'){const a=2.7-t*2.7;return [x+s*R*Math.cos(a),y-Math.sin(a)*H*.17];}
      if(f.shape==='low'){const a=1.7-t*1.7;return [x+s*R*(Math.cos(a)),y+H*.02-Math.sin(a)*H*.12];}
      return [x+s*R*(-.1+t*1.08),y-Math.sin(t*Math.PI)*H*.05];
    };
    const N=14,up:[number,number][]=[],lo:[number,number][]=[];
    for(let i=0;i<=N;i++){const t=tail+(head-tail)*i/N,[px,py]=pt(t),[qx,qy]=pt(Math.min(1,t+.02)),a=Math.atan2(qy-py,qx-px)+Math.PI/2,w=H*(f.shape==='line'?.028:.05)*(i/N)*(.6+.3*f.power);up.push([px+Math.cos(a)*w,py+Math.sin(a)*w]);lo.push([px-Math.cos(a)*w*.4,py-Math.sin(a)*w*.4]);}
    c.beginPath();up.forEach(p=>c.lineTo(...p));lo.reverse().forEach(p=>c.lineTo(...p));c.closePath();c.fillStyle=CREAM;c.fill();c.lineWidth=1;c.strokeStyle='#7a4a26';c.globalAlpha*=.6;c.stroke();
  }else if(f.kind==='dust'||f.kind==='land'){
    const n=f.kind==='land'?9:5;c.fillStyle='#d8b98c';
    for(let i=0;i<n;i++){const a=rand(f.seed,i),side=f.kind==='land'?(i%2?1:-1):-f.dir,r=H*(.025+.05*a)*f.power*(.5+smooth(u)*.9);c.globalAlpha=(1-u)*.42;
      c.beginPath();c.ellipse(x+side*H*(.05+.34*rand(f.seed,i+20))*f.power*smooth(u*1.3),y-H*.02-H*.11*rand(f.seed,i+30)*u,r,r*.62,0,0,7);c.fill();}
  }else if(f.kind==='sweat'){
    const n=Math.round(3+2*f.power);
    for(let i=0;i<n;i++){const vx=f.dir*(.3+rand(f.seed,i)*1)*H,vy=(.35+rand(f.seed,i+9)*.8)*H,px=x+vx*e,py=y-vy*e+1.9*H*e*e,r=H*(.006+.008*rand(f.seed,i+5));
      c.globalAlpha=(1-u)*.85;c.fillStyle='#e8f3f4';c.strokeStyle='#4a5a60';c.lineWidth=.7;c.beginPath();c.ellipse(px,py,r*1.5,r,Math.atan2(-vy+3.8*H*e,vx),0,7);c.fill();c.stroke();}
  }else if(f.kind==='wood'||f.kind==='china'||f.kind==='fruit'){
    const n=Math.round((f.kind==='wood'?16:f.kind==='china'?14:12)*f.power);
    for(let i=0;i<n;i++){
      const a=rand(f.seed,i),b=rand(f.seed,i+50),vx=(f.dir*.35+(a-.5)*1.7)*H*(f.kind==='fruit'?.85:1),vy=(.5+b*1.15)*H*(f.kind==='fruit'?.8:1),g=2.6*H;
      const floor=v.Y(0,f.z)-(rand(f.seed,i+90)-.3)*H*.07;let px=x+vx*e,py=y-vy*e+g*e*e/2,spin=e*(a-.5)*22;
      // One damped bounce, then the piece lies on the floor.
      const t0=(vy+Math.sqrt(vy*vy+2*g*Math.max(0,floor-y)))/g;
      if(e>t0){const q=e-t0,vb=vy*.32,t1=2*vb/g;px=x+vx*t0+vx*.4*Math.min(q,t1);py=floor-Math.max(0,vb*q-g*q*q/2);spin=t0*(a-.5)*22;}
      c.save();c.globalAlpha=1-smooth((u-.72)/.28);c.translate(px,py);c.rotate(spin);c.lineWidth=Math.max(.8,H*.005);c.strokeStyle=INK;
      const s=H*(.018+.035*rand(f.seed,i+70));
      if(f.kind==='wood'){c.fillStyle=['#8a4f22','#a9672f','#6d3b18','#c08445'][i%4];c.beginPath();c.moveTo(-s*1.7,-s*.3);c.lineTo(s*1.5,-s*.45);c.lineTo(s*1.9,s*.05);c.lineTo(-s*1.4,s*.4);c.closePath();}
      else if(f.kind==='china'){c.fillStyle=i%3?'#eef0ea':'#5f86a8';c.beginPath();c.moveTo(-s,-s*.5);c.lineTo(s*.7,-s*.7);c.lineTo(s,s*.4);c.lineTo(-s*.3,s*.6);c.closePath();}
      else{c.fillStyle=['#e08a2a','#d3652a','#c9402d','#e8a83a'][i%4];c.beginPath();c.arc(0,0,s*.95,0,7);}
      c.fill();c.stroke();
      if(f.kind==='fruit'){c.fillStyle='#ffe2a055';c.beginPath();c.arc(-s*.3,-s*.3,s*.3,0,7);c.fill();}
      c.restore();
    }
  }else if(f.kind==='lines'){
    c.globalAlpha=Math.sin(u*Math.PI)*.4;c.strokeStyle='#2a190e';const cx=x,cy=y;
    for(let i=0;i<34;i++){const a=i/34*Math.PI*2+rand(f.seed,i)*.14,r0=Math.hypot(v.w,v.h)*(.33+.1*rand(f.seed,i+40)),r1=Math.hypot(v.w,v.h)*.75;c.lineWidth=1+3*rand(f.seed,i+80);c.beginPath();c.moveTo(cx+Math.cos(a)*r0,cy+Math.sin(a)*r0);c.lineTo(cx+Math.cos(a)*r1,cy+Math.sin(a)*r1);c.stroke();}
  }else if(f.kind==='kanji'){
    const size=Math.min(H*.42,v.h*.24)*(1+.5*(1-smooth(e/.1))),px=clamp(v.w/2,size,v.w-size),py=Math.max(size*.56,v.ground-H*1.08-size*.62);
    c.globalAlpha=smooth(e/.06)*(1-smooth((u-.7)/.3));c.translate(px,py);c.rotate(-.06);
    c.font=`900 ${size}px "Kaiti SC","STKaiti","KaiTi","Songti SC","Noto Serif CJK SC","SimSun",serif`;c.textAlign='center';c.textBaseline='middle';c.lineJoin='round';
    c.lineWidth=size*.09;c.strokeStyle='#fbe7bf';c.strokeText(f.text??'拳',0,0);c.fillStyle='#9c2f24';c.fillText(f.text??'拳',0,0);
  }
  c.restore();
}
