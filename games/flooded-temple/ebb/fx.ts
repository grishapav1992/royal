/** Particles, rope, gates and treasure above the scene. Every piece has a lifetime and a shared ceiling. */
import {clamp,lerp,ease} from './clock';
type G=CanvasRenderingContext2D;
type P={k:string;x:number;y:number;vx:number;vy:number;g:number;t:number;d:number;s:number;c:string;r:number;vr:number;to?:{x:number;y:number};from?:{x:number;y:number};w?:number;floor?:number};
export class Fx{
  list:P[]=[];max=0;calm=1;
  add(p:Partial<P>&{k:string;x:number;y:number}){if(!this.calm||this.list.length>950)return;this.list.push({vx:0,vy:0,g:0,t:0,d:.6,s:4,c:'255,255,255',r:0,vr:0,...p});this.max=Math.max(this.max,this.list.length);}
  splash(x:number,y:number,n:number,power=1,c='190,240,245'){for(let i=0;i<n;i++){const a=-Math.PI/2+(Math.random()-.5)*2,v=(90+Math.random()*190)*power;this.add({k:'drop',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,g:760,d:.45+Math.random()*.3,s:1.2+Math.random()*2.4*power,c});}}
  bubbles(x:number,y:number,w:number,n:number){for(let i=0;i<n;i++)this.add({k:'bubble',x:x+(Math.random()-.5)*w,y:y-Math.random()*8,vx:(Math.random()-.5)*20,vy:-50-Math.random()*90,d:.5+Math.random()*.6,s:1.5+Math.random()*4});}
  sand(x:number,y:number,S:number,list:{x:number;y:number;c:string}[],to:{x:number;y:number},rate:number,share=1){
    for(const q of list){if(Math.random()>share)continue;const px=x+q.x*S,py=y+q.y*S;this.add({k:'sand',x:px,y:py,from:{x:px,y:py},to:{x:to.x+(Math.random()-.5)*36,y:to.y+(Math.random()-.5)*8},c:q.c,s:1.3+Math.random()*1.9,d:(.75+Math.random()*.45)/rate,t:-(q.y+.5)*.16/rate,vx:(q.x+(Math.random()-.5)*.3)*70,vy:30+Math.random()*50,w:(Math.random()-.5)*90});}
  }
  coins(x:number,y:number,n:number,power=1,spread=1){for(let i=0;i<n;i++){const a=-Math.PI/2+(Math.random()-.5)*1.5*spread,v=(260+Math.random()*420)*power;this.add({k:'coin',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,g:820,d:1.3+Math.random()*.9,s:6+Math.random()*7,r:Math.random()*6,vr:6+Math.random()*9,t:-Math.random()*.5});}}
  step(dt:number){for(let i=this.list.length-1;i>=0;i--){const p=this.list[i];p.t+=dt;if(p.t>=p.d){this.list.splice(i,1);continue;}if(p.t<0||p.k==='sand')continue;p.vy+=p.g*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.r+=p.vr*dt;}}
  /** Bats stay behind the heroine and the chamber. */
  draw(g:G,far=false){
    for(const p of this.list){if(p.t<0||(p.k==='bat')!==far)continue;const u=clamp(p.t/p.d);g.globalAlpha=1;
      if(p.k==='drop'){g.fillStyle=`rgba(${p.c},${.85*(1-u)})`;g.beginPath();g.ellipse(p.x,p.y,p.s,p.s*(1+Math.min(1.6,Math.abs(p.vy)/240)),Math.atan2(-p.vx,p.vy),0,7);g.fill();}
      else if(p.k==='bubble'){g.strokeStyle=`rgba(200,250,255,${.6*(1-u)})`;g.lineWidth=1;g.beginPath();g.arc(p.x+Math.sin(p.t*9+p.s)*2,p.y,p.s*(.6+u*.6),0,7);g.stroke();}
      else if(p.k==='sand'){const e=clamp((u-.12)/.88),k=e*e*(3-2*e),bx=p.from!.x+p.vx*u,by=p.from!.y+p.vy*Math.min(u,.5)*1.4;const x=lerp(bx,p.to!.x,k)+Math.sin(k*Math.PI)*p.w!,y=lerp(by,p.to!.y,k*k);g.fillStyle=p.c;g.globalAlpha=1-Math.max(0,u-.9)*10;const s=p.s*(1-.35*k);g.fillRect(x-s/2,y-s/2,s,s);if(p.s>2.6&&Math.sin(p.t*30+p.s*9)>.8){g.globalAlpha=.9;g.fillStyle='#fff3bf';g.fillRect(x-1,y-1,2,2);}}
      else if(p.k==='coin'){const c=Math.cos(p.r),w=Math.max(.16,Math.abs(c));g.globalAlpha=1-Math.max(0,u-.85)*6.6;g.save();g.translate(p.x,p.y);g.rotate(p.r*.15);g.scale(w,1);const gr=g.createLinearGradient(-p.s,-p.s,p.s,p.s);gr.addColorStop(0,'#fff2b0');gr.addColorStop(.45,c>0?'#f0bd45':'#d49a2c');gr.addColorStop(1,'#8a5413');g.fillStyle=gr;g.beginPath();g.arc(0,0,p.s,0,7);g.fill();g.strokeStyle='#7c4c12';g.lineWidth=p.s*.13;g.stroke();g.strokeStyle='rgba(255,236,160,.8)';g.lineWidth=p.s*.1;g.beginPath();g.arc(0,0,p.s*.62,0,7);g.stroke();g.restore();}
      else if(p.k==='spark'){const a=Math.sin(u*Math.PI);g.globalCompositeOperation='lighter';g.fillStyle=`rgba(${p.c},${a})`;star(g,p.x,p.y,p.s*(.5+a),p.r);g.globalCompositeOperation='source-over';}
      else if(p.k==='ring'){g.strokeStyle=`rgba(${p.c},${.75*(1-u)})`;g.lineWidth=2.6*(1-u)+.4;g.beginPath();g.arc(p.x,p.y,p.s*(.25+.75*ease.out(u)),0,7);g.stroke();}
      else if(p.k==='ray'){g.globalCompositeOperation='lighter';const a=Math.sin(u*Math.PI)*.5;for(let i=0;i<7;i++){const b=i/7*6.283+p.r+u*.5,l=p.s*(.7+.3*Math.sin(i*2.4));g.fillStyle=`rgba(${p.c},${a*.5})`;g.beginPath();g.moveTo(p.x,p.y);g.lineTo(p.x+Math.cos(b-.06)*l,p.y+Math.sin(b-.06)*l);g.lineTo(p.x+Math.cos(b+.06)*l,p.y+Math.sin(b+.06)*l);g.fill();}g.globalCompositeOperation='source-over';}
      else if(p.k==='dust'){g.fillStyle=`rgba(170,178,160,${.2*(1-u)})`;g.beginPath();g.arc(p.x,p.y,p.s*(.5+u),0,7);g.fill();}
      else if(p.k==='stone'){g.save();g.translate(p.x,p.y);g.rotate(p.r);g.globalAlpha=1-u*u;g.fillStyle=p.c;g.fillRect(-p.s/2,-p.s/2,p.s,p.s*.8);g.restore();}
      else if(p.k==='feather'){g.save();g.translate(p.x+Math.sin(p.t*4+p.s)*9,p.y);g.rotate(Math.sin(p.t*4+p.s)*.7);g.globalAlpha=1-u*u;g.fillStyle=`rgb(${p.c})`;g.beginPath();g.ellipse(0,0,p.s*.24,p.s,0,0,7);g.fill();g.strokeStyle='rgba(10,50,50,.6)';g.lineWidth=1;g.beginPath();g.moveTo(0,-p.s);g.lineTo(0,p.s);g.stroke();g.restore();}
      else if(p.k==='ember'){g.globalCompositeOperation='lighter';g.fillStyle=`rgba(255,${150+60*u|0},70,${Math.sin(u*Math.PI)*.8})`;g.beginPath();g.arc(p.x+Math.sin(p.t*2+p.s*5)*8,p.y,p.s,0,7);g.fill();g.globalCompositeOperation='source-over';}
      else if(p.k==='drip'){g.fillStyle='rgba(200,240,250,.7)';g.fillRect(p.x-.7,p.y,1.4,9);if(p.floor&&p.y>p.floor){p.t=p.d;this.add({k:'ripple',x:p.x,y:p.floor,d:1.3,s:26});}}
      else if(p.k==='ripple'){g.strokeStyle=`rgba(190,240,245,${.4*(1-u)})`;g.lineWidth=1.2;g.beginPath();g.ellipse(p.x,p.y,p.s*(.2+u),p.s*.26*(.2+u),0,0,7);g.stroke();}
      else if(p.k==='bat'){const f=Math.sin(p.t*17+p.s),s=p.s,y=p.y+Math.sin(p.t*2.3+p.s)*14;g.fillStyle='rgba(6,14,22,.8)';g.globalAlpha=Math.sin(u*Math.PI);g.beginPath();g.moveTo(p.x,y);g.quadraticCurveTo(p.x-s*.5,y-s*.5*f-s*.2,p.x-s,y-s*.55*f);g.quadraticCurveTo(p.x-s*.5,y+s*.12-s*.1*f,p.x,y+s*.22);g.quadraticCurveTo(p.x+s*.5,y+s*.12-s*.1*f,p.x+s,y-s*.55*f);g.quadraticCurveTo(p.x+s*.5,y-s*.5*f-s*.2,p.x,y);g.fill();}
    }
    g.globalAlpha=1;
  }
}
function star(g:G,x:number,y:number,s:number,r:number){g.save();g.translate(x,y);g.rotate(r);g.beginPath();for(let i=0;i<8;i++){const a=i/8*6.283,l=i%2?s*.22:s;g.lineTo(Math.cos(a)*l,Math.sin(a)*l);}g.closePath();g.fill();g.restore();}
