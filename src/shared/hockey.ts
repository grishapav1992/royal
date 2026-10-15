export const HOCKEY_PADDLE_RADIUS=32;
export const HOCKEY_PUCK_RADIUS=12;
export const HOCKEY_PADDLE_SPEED=1200;
export const HOCKEY_KEYBOARD_SPEED=650;
export type HockeyPoint={x:number;y:number};
export type HockeyPuck=HockeyPoint&{vx:number;vy:number};
export function clampPaddle(p:HockeyPoint,side:number):HockeyPoint {
  const edge=22+HOCKEY_PADDLE_RADIUS;
  return {x:Math.max(side?360+HOCKEY_PADDLE_RADIUS:edge,Math.min(side?720-edge:360-HOCKEY_PADDLE_RADIUS,p.x)),y:Math.max(edge,Math.min(400-edge,p.y))};
}
export function stepPaddle(p:HockeyPoint,target:HockeyPoint,dt:number){
  const dx=target.x-p.x,dy=target.y-p.y,d=Math.hypot(dx,dy);
  const ratio=d?Math.min(1,HOCKEY_PADDLE_SPEED*Math.max(0,dt)/d):0;
  p.x+=dx*ratio;p.y+=dy*ratio;
  return {vx:dt>0?dx*ratio/dt:0,vy:dt>0?dy*ratio/dt:0};
}
export function keepPaddleClearOfServe(p:HockeyPoint,side:number){
  const contact=HOCKEY_PADDLE_RADIUS+HOCKEY_PUCK_RADIUS,dy=p.y-200;
  if(Math.hypot(p.x-360,dy)<contact)p.x=360+(side?1:-1)*Math.sqrt(contact*contact-dy*dy);
}
export function collidePaddle(b:HockeyPuck,p:HockeyPoint,velocity:{vx:number;vy:number},side:number){
  const dx=b.x-p.x,dy=b.y-p.y,d=Math.hypot(dx,dy),contact=HOCKEY_PADDLE_RADIUS+HOCKEY_PUCK_RADIUS;
  if(d>=contact)return false;
  const nx=d?dx/d:(side?-1:1),ny=d?dy/d:0;
  b.x=p.x+nx*contact;b.y=p.y+ny*contact;
  const relative=(b.vx-velocity.vx)*nx+(b.vy-velocity.vy)*ny;
  if(relative<0){b.vx-=2*relative*nx;b.vy-=2*relative*ny;}
  const speed=Math.hypot(b.vx,b.vy);if(speed>1000){b.vx*=1000/speed;b.vy*=1000/speed;}
  return relative<0;
}
export function stepHockeyPuck(b:HockeyPuck,paddles:HockeyPoint[],velocities:{vx:number;vy:number}[],dt:number){
  let rail=false,hit=false;
  b.x+=b.vx*dt;b.y+=b.vy*dt;
  if(b.y<30){b.y=30;b.vy=Math.abs(b.vy);rail=true;}
  if(b.y>370){b.y=370;b.vy=-Math.abs(b.vy);rail=true;}
  paddles.forEach((p,i)=>{if(collidePaddle(b,p,velocities[i],i))hit=true;});
  // A puck pinched between both paddles escapes at their circle intersection.
  const contact=HOCKEY_PADDLE_RADIUS+HOCKEY_PUCK_RADIUS;
  if(paddles.length===2&&paddles.some(p=>Math.hypot(b.x-p.x,b.y-p.y)<contact-.000001)){
    const [a,c]=paddles,dx=c.x-a.x,dy=c.y-a.y,d=Math.hypot(dx,dy);
    if(d>0&&d<2*contact){
      const h=Math.sqrt(contact*contact-d*d/4),mx=(a.x+c.x)/2,my=(a.y+c.y)/2,px=-dy/d,py=dx/d;
      const dot=(b.x-mx)*px+(b.y-my)*py,sign=(dot||b.vx*px+b.vy*py)>=0?1:-1;
      b.x=mx+px*h*sign;b.y=my+py*h*sign;
      const speed=Math.max(180,Math.hypot(b.vx,b.vy));b.vx=px*sign*speed;b.vy=py*sign*speed;hit=true;
    }
  }
  let scorer=-1;
  if(b.x<25||b.x>695){
    if(b.y>135&&b.y<265)scorer=b.x<25?1:0;
    else{b.x=Math.max(25,Math.min(695,b.x));b.vx=b.x===25?Math.abs(b.vx):-Math.abs(b.vx);rail=true;}
  }
  return {rail,hit,scorer};
}
