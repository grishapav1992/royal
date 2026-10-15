import type { Ball, TableState } from '../shared/activities';
import { HOCKEY_PADDLE_RADIUS, HOCKEY_PUCK_RADIUS, type HockeyPoint } from '../shared/hockey';
import { POOL_POCKETS } from '../shared/pool';

type ViewOptions={side:number;angle:number;charge:number;calledPocket:number;reducedMotion:boolean};
const tau=Math.PI*2;
const ballColors=['#fff8e5','#e5af19','#2459a6','#b52a37','#623c8f','#d65b20','#23775f','#812638','#101a25'];
function disc(c:CanvasRenderingContext2D,x:number,y:number,r:number){c.beginPath();c.arc(x,y,r,0,tau);}
function rounded(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,r:number){c.beginPath();c.roundRect(x,y,w,h,r);}

/** Decorative drawing uses the same logical coordinates and radii as game physics. */
export class TableRenderer {
  private backgrounds=new Map<string,HTMLCanvasElement>();
  constructor(private canvas:HTMLCanvasElement){}
  render(table:TableState,balls:Ball[],paddles:HockeyPoint[],options:ViewOptions){
    const scale=Math.min(2,Math.max(1,window.devicePixelRatio||1));
    if(this.canvas.width!==Math.round(720*scale)||this.canvas.height!==Math.round(400*scale)){
      this.canvas.width=Math.round(720*scale);this.canvas.height=Math.round(400*scale);
    }
    const c=this.canvas.getContext('2d')!;c.setTransform(this.canvas.width/720,0,0,this.canvas.height/400,0,0);
    c.clearRect(0,0,720,400);c.drawImage(this.background(table.id,scale),0,0,720,400);
    if(table.id==='pool'){
      if(table.ballInHand==='kitchen'){
        c.save();c.strokeStyle='#f0e6ce88';c.lineWidth=1;c.setLineDash([4,5]);c.beginPath();c.moveTo(180,32);c.lineTo(180,368);c.stroke();c.restore();
      }
      if(options.calledPocket>=0){const p=POOL_POCKETS[options.calledPocket];if(p){c.strokeStyle='#ebca83';c.lineWidth=2;disc(c,p[0],p[1],21);c.stroke();}}
      for(const b of balls)if(b.active)this.poolBall(c,b);
      if(table.phase==='playing'&&!table.moving&&table.turn===options.side&&table.ballInHand==='none')this.cue(c,balls[0],options);
    }else{
      const puck=balls[0];
      if(puck?.active&&!options.reducedMotion&&Math.hypot(puck.vx,puck.vy)>180){
        const speed=Math.hypot(puck.vx,puck.vy),length=Math.min(26,speed*.025),x=puck.x-puck.vx/speed*length,y=puck.y-puck.vy/speed*length;
        const trail=c.createLinearGradient(x,y,puck.x,puck.y);trail.addColorStop(0,'#1d546400');trail.addColorStop(1,'#1d546425');
        c.strokeStyle=trail;c.lineWidth=HOCKEY_PUCK_RADIUS*1.2;c.lineCap='round';c.beginPath();c.moveTo(x,y);c.lineTo(puck.x,puck.y);c.stroke();c.lineCap='butt';
      }
      paddles.forEach((p,i)=>this.paddle(c,p,i,options.side===i));
      if(puck?.active)this.puck(c,puck);
    }
  }
  private background(id:'hockey'|'pool',scale:number){
    const key=id+':'+scale,cached=this.backgrounds.get(key);if(cached)return cached;
    const canvas=document.createElement('canvas');canvas.width=Math.round(720*scale);canvas.height=Math.round(400*scale);
    const c=canvas.getContext('2d')!;c.scale(canvas.width/720,canvas.height/400);
    if(id==='pool')this.poolTable(c);else this.hockeyTable(c);
    this.backgrounds.clear();this.backgrounds.set(key,canvas);return canvas;
  }
  private poolTable(c:CanvasRenderingContext2D){
    const wood=c.createLinearGradient(0,0,720,400);wood.addColorStop(0,'#765139');wood.addColorStop(.2,'#b28250');wood.addColorStop(.48,'#533527');wood.addColorStop(.8,'#92673e');wood.addColorStop(1,'#3b2922');
    c.fillStyle=wood;rounded(c,0,0,720,400,22);c.fill();
    c.save();rounded(c,2,2,716,396,20);c.clip();
    for(let i=0;i<150;i++){c.strokeStyle=i%3?'#24140d18':'#f4cb8a20';c.lineWidth=.5;c.beginPath();c.moveTo(0,i*3);c.bezierCurveTo(180,i*3+6,450,i*3-8,720,i*3+4);c.stroke();}
    c.restore();c.strokeStyle='#dfbd7b';c.lineWidth=1;rounded(c,4,4,712,392,19);c.stroke();c.strokeStyle='#1d1716';rounded(c,9,9,702,382,16);c.stroke();
    const cushion=c.createLinearGradient(0,17,0,383);cushion.addColorStop(0,'#396e59');cushion.addColorStop(.2,'#154d3e');cushion.addColorStop(.9,'#123b30');cushion.addColorStop(1,'#4f8060');
    c.fillStyle=cushion;rounded(c,17,17,686,366,12);c.fill();
    const felt=c.createRadialGradient(310,120,30,360,200,410);felt.addColorStop(0,'#237761');felt.addColorStop(.6,'#1c6552');felt.addColorStop(1,'#124234');
    c.fillStyle=felt;rounded(c,25,25,670,350,7);c.fill();
    c.save();rounded(c,25,25,670,350,7);c.clip();
    for(let y=26;y<375;y+=3){c.strokeStyle=y%2?'#d4f0c804':'#041f1408';c.lineWidth=.5;c.beginPath();c.moveTo(25,y);c.lineTo(695,y);c.stroke();}
    for(let x=27;x<695;x+=4){c.strokeStyle='#b6d6ae04';c.lineWidth=.5;c.beginPath();c.moveTo(x,25);c.lineTo(x,375);c.stroke();}
    const shade=c.createLinearGradient(0,25,0,50);shade.addColorStop(0,'#031c2580');shade.addColorStop(1,'#031c2500');c.fillStyle=shade;c.fillRect(25,25,670,25);
    c.fillStyle='#efefda35';disc(c,180,200,2);c.fill();disc(c,470,200,2);c.fill();
    c.font='600 15px Georgia,serif';c.textAlign='center';c.fillStyle='#c5e3cb12';c.fillText('R O Y A L',360,222);c.restore();
    c.strokeStyle='#578a68';c.lineWidth=.8;rounded(c,25,25,670,350,7);c.stroke();
    for(const [x,y] of POOL_POCKETS){
      const rim=c.createLinearGradient(x-19,y-19,x+19,y+19);rim.addColorStop(0,'#d5ac69');rim.addColorStop(.45,'#8e7048');rim.addColorStop(1,'#2d2722');c.fillStyle=rim;disc(c,x,y,21);c.fill();
      const hole=c.createRadialGradient(x-4,y-5,1,x,y,18);hole.addColorStop(0,'#1b2828');hole.addColorStop(.6,'#081519');hole.addColorStop(1,'#02090e');c.fillStyle=hole;disc(c,x,y,18);c.fill();
      c.strokeStyle='#ecc78b44';c.lineWidth=.8;c.beginPath();c.arc(x,y,19,Math.PI,Math.PI*1.8);c.stroke();
    }
    for(const x of [115,200,280,440,520,605])for(const y of [11,389])this.diamond(c,x,y);
    for(const x of [11,709])for(const y of [112,200,288])this.diamond(c,x,y);
  }
  private diamond(c:CanvasRenderingContext2D,x:number,y:number){c.fillStyle='#ebd9b0';c.beginPath();c.moveTo(x,y-2.5);c.lineTo(x+2,y);c.lineTo(x,y+2.5);c.lineTo(x-2,y);c.closePath();c.fill();}
  private hockeyTable(c:CanvasRenderingContext2D){
    const metal=c.createLinearGradient(0,0,0,400);metal.addColorStop(0,'#a8bdc6');metal.addColorStop(.12,'#536975');metal.addColorStop(.85,'#354d5c');metal.addColorStop(1,'#92a5ae');
    c.fillStyle=metal;rounded(c,0,0,720,400,22);c.fill();c.strokeStyle='#dce6e3';c.lineWidth=1;rounded(c,3,3,714,394,20);c.stroke();
    c.fillStyle='#153747';rounded(c,16,16,688,368,13);c.fill();
    const ice=c.createLinearGradient(0,22,0,378);ice.addColorStop(0,'#ecf4ed');ice.addColorStop(.5,'#fcfaf0');ice.addColorStop(1,'#d4e4e2');c.fillStyle=ice;rounded(c,22,22,676,356,10);c.fill();
    c.save();rounded(c,22,22,676,356,10);c.clip();
    c.fillStyle='#5277801a';for(let y=29;y<378;y+=9)for(let x=29;x<698;x+=9){disc(c,x,y,.55);c.fill();}
    c.strokeStyle='#579ba866';c.lineWidth=1.7;c.beginPath();c.moveTo(360,25);c.lineTo(360,375);c.stroke();disc(c,360,200,65);c.stroke();
    c.strokeStyle='#a9cad144';disc(c,360,200,72);c.stroke();c.fillStyle='#579ba8';disc(c,360,200,3);c.fill();
    for(const x of [75,645]){c.strokeStyle=x<360?'#4296ae55':'#c9767855';c.beginPath();c.arc(x,200,66,x<360?-Math.PI/2:Math.PI/2,x<360?Math.PI/2:Math.PI*1.5);c.stroke();}
    const shade=c.createLinearGradient(0,22,0,42);shade.addColorStop(0,'#263f5540');shade.addColorStop(1,'#263f5500');c.fillStyle=shade;c.fillRect(22,22,676,20);
    c.font='600 12px Georgia,serif';c.textAlign='center';c.fillStyle='#3d627422';c.fillText('R O Y A L',360,305);c.restore();
    for(const [x,color] of [[7,'#55bfd2'],[697,'#dd8885']] as const){
      c.fillStyle='#0d2837';rounded(c,x,134,16,132,4);c.fill();c.fillStyle=color;rounded(c,x+4,141,8,118,3);c.fill();
      c.fillStyle='#ffffff66';c.fillRect(x+5,147,2,104);
    }
    for(const x of [12,708])for(const y of [12,388]){c.fillStyle='#364752';disc(c,x,y,3);c.fill();c.strokeStyle='#bccace';c.lineWidth=.7;c.beginPath();c.moveTo(x-1.5,y);c.lineTo(x+1.5,y);c.stroke();}
  }
  private shadow(c:CanvasRenderingContext2D,x:number,y:number,r:number){
    const shadow=c.createRadialGradient(x+2,y+4,r*.25,x+2,y+4,r*1.25);shadow.addColorStop(0,'#051c2e66');shadow.addColorStop(1,'#051c2e00');c.fillStyle=shadow;c.beginPath();c.ellipse(x+2,y+4,r*1.3,r*.98,0,0,tau);c.fill();
  }
  private poolBall(c:CanvasRenderingContext2D,b:Ball){
    const r=11,color=ballColors[b.id>8?b.id-8:b.id];this.shadow(c,b.x,b.y,r);c.save();c.translate(b.x,b.y);disc(c,0,0,r);c.clip();
    c.fillStyle=b.id>8?'#eee8d6':color;c.fill();
    if(b.id>8){c.save();c.rotate((b.x+b.y)*.006);c.fillStyle=color;c.fillRect(-r,-r*.5,2*r,r);c.restore();}
    const shade=c.createRadialGradient(-4,-4,0,2,3,15);shade.addColorStop(0,'#ffffff55');shade.addColorStop(.4,'#ffffff05');shade.addColorStop(.73,'#07152815');shade.addColorStop(1,'#031323b0');c.fillStyle=shade;c.fillRect(-r,-r,r*2,r*2);
    if(b.id){c.fillStyle='#fff5de';disc(c,0,0,5.7);c.fill();c.fillStyle='#142329';c.font='700 8px Arial,sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(String(b.id),0,.5);}
    const shine=c.createRadialGradient(-4,-5,0,-4,-5,4);shine.addColorStop(0,'#ffffffc0');shine.addColorStop(1,'#ffffff00');c.fillStyle=shine;disc(c,-4,-5,4);c.fill();c.restore();
    c.strokeStyle='#071f2938';c.lineWidth=.65;disc(c,b.x,b.y,r);c.stroke();
  }
  private paddle(c:CanvasRenderingContext2D,p:HockeyPoint,side:number,own:boolean){
    const r=HOCKEY_PADDLE_RADIUS;this.shadow(c,p.x,p.y,r);c.save();c.translate(p.x,p.y);
    const body=c.createRadialGradient(-10,-14,2,4,7,r*1.15);body.addColorStop(0,side?'#f7c4b0':'#bdedec');body.addColorStop(.35,side?'#db8175':'#4bafc2');body.addColorStop(.75,side?'#a63f48':'#1c697f');body.addColorStop(1,side?'#692433':'#153b53');c.fillStyle=body;disc(c,0,0,r);c.fill();
    c.strokeStyle=side?'#6e2937':'#214654';c.lineWidth=1.2;c.stroke();c.strokeStyle='#ffffff65';c.lineWidth=1;disc(c,-.3,-.6,r-3);c.stroke();
    c.fillStyle=side?'#7b3540':'#195369';disc(c,1,3,20);c.fill();
    const handle=c.createLinearGradient(-10,-15,12,15);handle.addColorStop(0,side?'#f5b5a3':'#a1e7ea');handle.addColorStop(.5,side?'#bd615c':'#439dae');handle.addColorStop(1,side?'#86333f':'#20566e');c.fillStyle=handle;disc(c,0,-2,18);c.fill();
    c.strokeStyle='#ffffff50';c.lineWidth=1;c.beginPath();c.arc(-1,-3,15,Math.PI*1.05,Math.PI*1.75);c.stroke();
    c.fillStyle=own?'#fff7d5':'#ffffff40';disc(c,0,-3,3);c.fill();c.restore();
  }
  private puck(c:CanvasRenderingContext2D,p:Ball){
    const r=HOCKEY_PUCK_RADIUS;this.shadow(c,p.x,p.y,r);const face=c.createRadialGradient(p.x-4,p.y-4,1,p.x+3,p.y+4,r*1.2);face.addColorStop(0,'#84999e');face.addColorStop(.4,'#3e5966');face.addColorStop(1,'#101c2f');c.fillStyle=face;disc(c,p.x,p.y,r);c.fill();c.strokeStyle='#112a3b';c.lineWidth=1;c.stroke();c.strokeStyle='#afc6c477';c.lineWidth=.8;disc(c,p.x,p.y,r-2.5);c.stroke();
  }
  private cue(c:CanvasRenderingContext2D,ball:Ball,options:ViewOptions){
    if(!ball?.active)return;const a=options.angle;
    c.save();c.strokeStyle='#f5edce70';c.lineWidth=1;c.setLineDash([3,6]);c.beginPath();c.moveTo(ball.x+Math.cos(a)*14,ball.y+Math.sin(a)*14);c.lineTo(ball.x+Math.cos(a)*170,ball.y+Math.sin(a)*170);c.stroke();c.restore();
    c.save();c.translate(ball.x,ball.y);c.rotate(a);const pull=options.charge*16;
    c.translate(-pull,0);c.fillStyle='#061a2e35';rounded(c,-139,2,115,5,2);c.fill();
    const wood=c.createLinearGradient(0,-3,0,3);wood.addColorStop(0,'#efdeae');wood.addColorStop(.4,'#cdab6d');wood.addColorStop(1,'#6f482f');c.fillStyle=wood;c.beginPath();c.moveTo(-24,-1.5);c.lineTo(-137,-3);c.lineTo(-137,3);c.lineTo(-24,1.5);c.closePath();c.fill();
    c.fillStyle='#24464d';c.fillRect(-137,-3,28,6);for(let x=-136;x<-110;x+=3){c.strokeStyle='#beaa7a55';c.lineWidth=.5;c.beginPath();c.moveTo(x,-3);c.lineTo(x+1,3);c.stroke();}
    c.fillStyle='#f6f0dd';c.fillRect(-30,-1.6,6,3.2);c.fillStyle='#559ac0';c.fillRect(-24,-1.7,2,3.4);c.restore();
  }
}
