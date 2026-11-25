/** Owned particles. All of them are decoration and may be dropped at any moment. */
type Kind='spark'|'chip'|'smoke'|'ring'|'flash'|'drop'|'coin'|'feather'|'ember'|'glint'|'splash'|'dust';
type P={k:Kind;x:number;y:number;vx:number;vy:number;g:number;t:number;d:number;s:number;r:number;vr:number;c:string;a:number;drag:number;floor?:number;to?:{x:number;y:number};sx?:number;sy?:number;bend?:number};
const R=Math.random,TAU=Math.PI*2;
function puff(rgb:string){const c=document.createElement('canvas');c.width=c.height=96;const g=c.getContext('2d')!;
  for(let i=0;i<14;i++){const a=R()*TAU,r=R()*20,x=48+Math.cos(a)*r,y=48+Math.sin(a)*r,q=14+R()*14,gr=g.createRadialGradient(x,y,0,x,y,q);gr.addColorStop(0,`rgba(${rgb},.22)`);gr.addColorStop(1,`rgba(${rgb},0)`);g.fillStyle=gr;g.fillRect(0,0,96,96);}return c;}
export class Effects{
  list:P[]=[];private white=puff('238,226,205');private dark=puff('92,80,70');rain=0;private drops=Array.from({length:150},()=>({x:R(),y:R(),z:.5+R()*.5}));
  reduced=false;
  add(p:Partial<P>&{k:Kind;x:number;y:number}){if(this.reduced)return;if(this.list.length>620)this.list.shift();this.list.push({vx:0,vy:0,g:0,t:0,d:1,s:4,r:R()*TAU,vr:0,c:'#ffd37a',a:1,drag:0,...p});}
  splinters(x:number,y:number,w:number,power=1){for(let i=0;i<7*power;i++)this.add({k:'chip',x:x+(R()-.5)*w,y,vx:(R()-.5)*190*power,vy:-60-R()*170*power,g:720,d:.55+R()*.35,s:3+R()*5*power,vr:(R()-.5)*22,c:['#7a4a28','#a8683a','#5a331c','#c98f55'][i%4]});
    for(let i=0;i<4;i++)this.add({k:'dust',x:x+(R()-.5)*w,y,vx:(R()-.5)*70,vy:-12-R()*26,d:.5+R()*.3,s:w*.2+R()*8,a:.5,drag:2});}
  smoke(x:number,y:number,n:number,size:number,vx=0,vy=-18,dark=false){for(let i=0;i<n;i++)this.add({k:'smoke',x:x+(R()-.5)*size*.4,y:y+(R()-.5)*size*.4,vx:vx*(.5+R()*.7)+(R()-.5)*size*.5,vy:vy*(.5+R())+(R()-.5)*size*.35,d:.9+R()*1.1,s:size*(.55+R()*.55),vr:(R()-.5)*.8,a:.85,drag:1.6,c:dark?'d':'w'});}
  blast(x:number,y:number,size:number){
    this.add({k:'flash',x,y,d:.2,s:size*1.25,c:'255,226,160'});this.add({k:'ring',x,y,d:.5,s:size*1.25,c:'255,214,140'});
    for(let i=0;i<34;i++){const a=R()*TAU,v=size*(1.2+R()*3.4);this.add({k:'spark',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-size*.4,g:size*2.6,d:.35+R()*.5,s:1.5+R()*2,c:i%3?'#ffc766':'#fff1c4',drag:1.5});}
    for(let i=0;i<22;i++){const a=R()*TAU,v=size*(.8+R()*2.4);this.add({k:'chip',x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-size*.8,g:size*4,d:.6+R()*.6,s:4+R()*8,vr:(R()-.5)*26,c:['#6d4022','#9c5f33','#4b2a16','#d19a58'][i%4]});}
    this.smoke(x,y,11,size*.95,0,-size*.25);this.smoke(x,y,6,size*.8,0,-size*.15,true);
    for(let i=0;i<14;i++){const a=R()*TAU;const ev=size*(.2+R()*1.1);this.add({k:'ember',x,y,vx:Math.cos(a)*ev,vy:Math.sin(a)*ev-size*.3,g:-20,d:.9+R()*.9,s:1.4+R()*1.8,drag:1.2});}
  }
  splash(x:number,y:number,w:number,power:number){
    for(let i=0;i<26*power;i++){const a=-Math.PI/2+(R()-.5)*1.5,v=110+R()*300*power;this.add({k:'drop',x:x+(R()-.5)*w,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,g:900,d:.5+R()*.45,s:1+R()*2.1,c:i%3?'#8fe6ea':'#e9fdff',a:.85});}
    for(let i=0;i<5;i++)this.add({k:'dust',x:x+(R()-.5)*w,y,vx:(R()-.5)*60,vy:-30-R()*50,d:.6,s:w*.25,a:.4,c:'190,240,245',drag:2});
  }
  glint(x:number,y:number,s:number){this.add({k:'glint',x,y,d:.5,s,r:0,vr:1.2});}
  coin(x:number,y:number,vx:number,vy:number,s:number,floor?:number){this.add({k:'coin',x,y,vx,vy,g:980,d:2.1+R()*.8,s,vr:7+R()*9,floor,drag:.1});}
  loot(from:{x:number;y:number},to:{x:number;y:number},s:number,delay=0){this.add({k:'coin',x:from.x,y:from.y,sx:from.x,sy:from.y,to,t:-delay,d:.62+R()*.18,s,vr:9+R()*6,bend:(R()-.5)*120-60});}
  clear(){this.list=[];}
  step(dt:number){
    for(const p of this.list){p.t+=dt;if(p.t<0)continue;
      if(p.to){const u=Math.min(1,p.t/p.d),e=u*u*(3-2*u);p.x=p.sx!+(p.to.x-p.sx!)*e;p.y=p.sy!+(p.to.y-p.sy!)*e+p.bend!*4*u*(1-u);p.r+=p.vr*dt;continue;}
      if(p.drag){const f=Math.exp(-p.drag*dt);p.vx*=f;p.vy*=f;}
      p.vy+=p.g*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.r+=p.vr*dt;
      if(p.k==='feather'){p.x+=Math.sin(p.t*5+p.r)*18*dt;}
      if(p.floor!==undefined&&p.y>p.floor&&p.vy>0){p.y=p.floor;p.vy*=-.42;p.vx*=.6;p.vr*=.6;if(Math.abs(p.vy)<40)p.vy=0;}
    }
    this.list=this.list.filter(p=>p.t<p.d);
  }
  draw(g:CanvasRenderingContext2D,w:number,h:number,now:number){
    for(const p of this.list){if(p.t<0)continue;const u=p.t/p.d,a=p.a;g.save();
      switch(p.k){
        case'spark':g.globalCompositeOperation='lighter';g.globalAlpha=a*(1-u);g.strokeStyle=p.c;g.lineWidth=p.s*(1-u*.6);g.lineCap='round';g.beginPath();g.moveTo(p.x,p.y);g.lineTo(p.x-p.vx*.035,p.y-p.vy*.035);g.stroke();break;
        case'chip':g.globalAlpha=a*Math.min(1,(1-u)*3);g.translate(p.x,p.y);g.rotate(p.r);g.fillStyle=p.c;g.fillRect(-p.s/2,-p.s*.16,p.s,p.s*.32);g.fillStyle='rgba(255,225,170,.28)';g.fillRect(-p.s/2,-p.s*.16,p.s,p.s*.1);break;
        case'smoke':{const s=p.s*(.55+u*1.1);g.globalAlpha=a*(u<.12?u/.12:1-(u-.12)/.88);g.translate(p.x,p.y);g.rotate(p.r);g.drawImage(p.c==='d'?this.dark:this.white,-s,-s,s*2,s*2);break;}
        case'dust':{const s=p.s*(.5+u);g.globalAlpha=a*(1-u)*.6;const rgb=p.c.includes(',')?p.c:'226,198,150';const gr=g.createRadialGradient(p.x,p.y,0,p.x,p.y,s);gr.addColorStop(0,`rgba(${rgb},.5)`);gr.addColorStop(1,`rgba(${rgb},0)`);g.fillStyle=gr;g.fillRect(p.x-s,p.y-s,s*2,s*2);break;}
        case'ring':{const s=p.s*(.2+.8*(1-(1-u)**3));g.globalCompositeOperation='lighter';g.globalAlpha=a*(1-u)*.42;g.strokeStyle=`rgb(${p.c})`;g.lineWidth=p.s*.045*(1-u);g.beginPath();g.arc(p.x,p.y,s,0,TAU);g.stroke();break;}
        case'flash':{g.globalCompositeOperation='lighter';const s=p.s*(.7+u*.5),gr=g.createRadialGradient(p.x,p.y,0,p.x,p.y,s);gr.addColorStop(0,`rgba(${p.c.includes(',')?p.c:'255,220,150'},${.85*(1-u)})`);gr.addColorStop(.35,`rgba(255,160,70,${.45*(1-u)})`);gr.addColorStop(1,'rgba(255,130,40,0)');g.fillStyle=gr;g.fillRect(p.x-s,p.y-s,s*2,s*2);break;}
        case'drop':g.globalAlpha=a*(1-u*u);g.fillStyle=p.c;g.translate(p.x,p.y);g.rotate(Math.atan2(p.vy,p.vx));g.beginPath();g.ellipse(0,0,p.s*1.7,p.s*.7,0,0,TAU);g.fill();break;
        case'ember':g.globalCompositeOperation='lighter';g.globalAlpha=a*(1-u);g.fillStyle=u<.5?'#ffd27a':'#ff8a3c';g.beginPath();g.arc(p.x,p.y,p.s,0,TAU);g.fill();break;
        case'glint':{g.globalCompositeOperation='lighter';const s=p.s*Math.sin(u*Math.PI);g.translate(p.x,p.y);g.rotate(p.r*.2);g.fillStyle='rgba(255,247,220,.95)';for(let k=0;k<2;k++){g.beginPath();g.moveTo(0,-s);g.quadraticCurveTo(s*.06,0,0,s);g.quadraticCurveTo(-s*.06,0,0,-s);g.fill();g.rotate(Math.PI/2);}break;}
        case'feather':{g.globalAlpha=a*(1-u);g.translate(p.x,p.y);g.rotate(p.r);const s=p.s;g.fillStyle=p.c;g.beginPath();g.moveTo(-s,0);g.quadraticCurveTo(0,-s*.42,s,0);g.quadraticCurveTo(0,s*.3,-s,0);g.fill();g.strokeStyle='rgba(255,255,255,.45)';g.lineWidth=1;g.beginPath();g.moveTo(-s,0);g.lineTo(s,0);g.stroke();break;}
        case'coin':coin(g,p.x,p.y,p.s,p.r,p.to?Math.min(1,(1-u)*5):Math.min(1,(1-u)*4));break;
      }
      g.restore();
    }
  }
  drawRain(g:CanvasRenderingContext2D,w:number,h:number,now:number){
    if(this.rain>0&&!this.reduced){g.save();g.globalAlpha=this.rain*.5;g.strokeStyle='#cfe4f2';g.lineWidth=1.1;g.beginPath();
      for(const d of this.drops){const y=((d.y+now*(1.25+d.z*.6))%1.1-.05)*h,x=((d.x-now*.22*d.z-y/h*.18)%1+1)%1*w,l=h*.035*d.z;g.moveTo(x,y);g.lineTo(x-l*.3,y+l);}g.stroke();g.restore();}
  }
}
export function coin(g:CanvasRenderingContext2D,x:number,y:number,s:number,r:number,a=1){
  const c=Math.cos(r),w=Math.max(.14,Math.abs(c))*s;g.save();g.globalAlpha=a;g.translate(x,y);g.rotate(Math.sin(r*.37)*.5);
  g.fillStyle='#8a5312';g.beginPath();g.ellipse(Math.sign(c)*s*.1,0,w,s,0,0,TAU);g.fill();
  const gr=g.createLinearGradient(-w,-s,w,s);gr.addColorStop(0,'#fff0b2');gr.addColorStop(.45,'#f0b843');gr.addColorStop(1,'#a8660f');g.fillStyle=gr;g.beginPath();g.ellipse(0,0,w,s,0,0,TAU);g.fill();
  g.strokeStyle='rgba(120,66,10,.75)';g.lineWidth=Math.max(.7,s*.09);g.beginPath();g.ellipse(0,0,w*.74,s*.74,0,0,TAU);g.stroke();
  if(w>s*.45){g.fillStyle='rgba(120,66,10,.8)';g.beginPath();g.ellipse(0,-s*.1,w*.3,s*.28,0,0,TAU);g.fill();g.fillRect(-w*.16,s*.1,w*.32,s*.2);g.fillStyle='#e9b24a';for(const k of [-1,1]){g.beginPath();g.ellipse(k*w*.12,-s*.1,w*.08,s*.08,0,0,TAU);g.fill();}}
  g.restore();
}
