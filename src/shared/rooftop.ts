import type { Obstacle, Point } from '../game/navigation';
import { WORLD } from './clubGeometry';
import { ROOF_TOILET } from './toilet';

// Roof access is a location, independent of the casino's numbered floors.
export const ROOF = {
  width: 2240, height: 1380,
  deck: { x: 140, y: 300, w: 1960, h: 900 },
  spawn: { x: 530, y: 700 },
  hatch: { x: 440, y: 410, w: 180, h: 170 },
  vents: [{ x: 1080, y: 475, w: 160, h: 110 }, { x: 1390, y: 475, w: 160, h: 110 }, { x: 1460, y: 900, w: 140, h: 90 }],
  benches: [{ x: 800, y: 930, w: 190, h: 52 }, { x: 1080, y: 930, w: 190, h: 52 }],
  antenna: { x: 1870, y: 410, w: 100, h: 85 },
  loop: [{ x: 320, y: 700 }, { x: 320, y: 1080 }, { x: 1920, y: 1080 }, { x: 1920, y: 700 }, { x: 1740, y: 360 }, { x: 750, y: 360 }],
} as const;

export const ROOF_STAIR_FLIGHTS = 10;
export const ROOF_STAIR_ROUTE:readonly Point[] = [
  { x: 1660, y: 480 }, { x: 1660, y: 430 },
  ...Array.from({length:ROOF_STAIR_FLIGHTS},(_,index)=>({x:index%2===0?1750:1580,y:408-index*20})),
];
export const ROOF_STAIR_SPEED_SCALE = .65;
export const ROOF_STAIR_EPSILON = 1e-6;
export const ROOF_STAIR_DRAW = { ladderRise:160, flightRise:144, widthScale:1.65 } as const;
const windowLandingIndex=Math.floor(ROOF_STAIR_ROUTE.length/2);
export const ROOF_WINDOW_PLATFORM={index:windowLandingIndex,junction:ROOF_STAIR_ROUTE[windowLandingIndex],length:92,windowOffset:68} as const;
export function roofWindowPlatformPoint(point:Point){
  const p=ROOF_WINDOW_PLATFORM;
  return Math.abs(point.y-p.junction.y)<=.2&&point.x>=p.junction.x-1e-6&&point.x<=p.junction.x+p.length+1e-6;
}
export function onRoofWindowPlatform(point:Point&{stairStep?:number}){
  return [windowLandingIndex,windowLandingIndex+1].includes(point.stairStep??0)&&roofWindowPlatformPoint(point);
}
const roofEntry=ROOF_STAIR_ROUTE[ROOF_STAIR_ROUTE.length-1];
const previousRoofLanding=ROOF_STAIR_ROUTE[ROOF_STAIR_ROUTE.length-2];
// Leave the roof on the landing below its last flight, outside the doorway's trigger.
export const ROOF_STAIR_RETURN = {
  x:previousRoofLanding.x,y:previousRoofLanding.y,
  stairStep:ROOF_STAIR_ROUTE.length-2,stairDirection:-1,
  facing:ROOF_STAIR_ROUTE[ROOF_STAIR_ROUTE.length-3].x<previousRoofLanding.x?'left':'right',
} as const;
export const STREET_ROOF_STAIRS = {
  foot: ROOF_STAIR_ROUTE[0],
  entry: roofEntry, arrival: { x: 1660, y: 462 }, facing: 'down', click: { x: 1660, y: 477 },
  left: roofEntry.x-15, right: roofEntry.x+15, top: roofEntry.y-11, bottom: roofEntry.y+11,
} as const;

/** Ordered, continuous progress, shared by authoritative movement and prediction. */
export function advanceRoofStairStep(step: number, point: Point&{stairDirection?:number}): number {
  if (!Number.isInteger(step) || step < 0 || step > ROOF_STAIR_ROUTE.length) return 0;
  if (!step) return Math.hypot(point.x - STREET_ROOF_STAIRS.foot.x, point.y - STREET_ROOF_STAIRS.foot.y) <= 7 ? 1 : 0;
  if(point.x>ROOF_WINDOW_PLATFORM.junction.x+ROOF_STAIR_EPSILON&&onRoofWindowPlatform({x:point.x,y:point.y,stairStep:step}))return step;
  if (step === ROOF_STAIR_ROUTE.length) return Math.hypot(point.x - STREET_ROOF_STAIRS.entry.x, point.y - STREET_ROOF_STAIRS.entry.y) <= 16 ? step : 0;
  const from = ROOF_STAIR_ROUTE[step - 1], to = ROOF_STAIR_ROUTE[step];
  const dx = to.x - from.x, dy = to.y - from.y;
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy)));
  if (Math.hypot(point.x - from.x - dx * t, point.y - from.y - dy * t) > 20) return 0;
  return point.stairDirection!==-1&&Math.hypot(point.x - to.x, point.y - to.y) <= ROOF_STAIR_EPSILON ? step + 1 : step;
}

type StairPosition=Point&{stairStep?:number;stairDirection?:number};
export type RoofStairOption={step:number;direction:1|-1;target:Point;from:Point;to:Point};

/** At a landing both connected flights stay available, including the way back. */
export function roofStairOptions(body:StairPosition):RoofStairOption[]{
  const step=body.stairStep??0,last=ROOF_STAIR_ROUTE.length-1;
  if(step<=0||step>last+1)return [];
  const segment=Math.min(step,last),from=ROOF_STAIR_ROUTE[segment-1],to=ROOF_STAIR_ROUTE[segment];
  const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
  const along=Math.max(0,Math.min(length,((body.x-from.x)*dx+(body.y-from.y)*dy)/length));
  const result:RoofStairOption[]=[];
  const add=(index:number,direction:1|-1)=>{
    if(index<1||index>last)return;
    const from=ROOF_STAIR_ROUTE[index-1],to=ROOF_STAIR_ROUTE[index];
    result.push({step:index,direction,target:direction===1?to:from,from,to});
  };
  if(along<length-ROOF_STAIR_EPSILON)add(segment,1);else add(segment+1,1);
  if(along>ROOF_STAIR_EPSILON)add(segment,-1);else add(Math.max(1,segment-1),-1);
  return result;
}

/** Input can reverse on the same rail; vertical input resolves a landing's two branches. */
export function moveRoofStairs(body:StairPosition&{moving:boolean},input:{x:number;y:number;route?:boolean},distance:number):boolean {
  if((body.stairStep??0)<=0||(body.stairStep??0)>ROOF_STAIR_ROUTE.length)return false;
  body.moving=false;if(distance<=0||!Math.hypot(input.x,input.y))return true;
  if(onRoofWindowPlatform(body)){
    const p=ROOF_WINDOW_PLATFORM;
    // Horizontal input stays on the platform. Only explicit up/down can select a flight.
    if(!input.y||body.x>p.junction.x+ROOF_STAIR_EPSILON){
      const before=body.x,dx=input.y?-1:Math.sign(input.x);
      body.x=Math.max(p.junction.x,Math.min(p.junction.x+p.length,body.x+dx*distance));
      body.y=p.junction.y;body.moving=Math.abs(body.x-before)>.001;
      return true;
    }
  }
  const options=roofStairOptions(body);
  const candidates=options.filter(option=>{
    const dx=(option.to.x-option.from.x)*option.direction,dy=(option.to.y-option.from.y)*option.direction;
    if(input.route)return (input.x*dx+input.y*dy)/Math.hypot(input.x,input.y)/Math.hypot(dx,dy)>.99;
    if(input.y)return option.direction===(input.y<0?1:-1);
    return dx!==0&&Math.sign(input.x)===Math.sign(dx);
  });
  const option=candidates.find(p=>p.direction===(body.stairDirection??1))??candidates[0];
  if(!option)return true;
  const {from,to,step,direction}=option,dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
  const along=Math.max(0,Math.min(length,((body.x-from.x)*dx+(body.y-from.y)*dy)/length));
  let next=Math.max(0,Math.min(length,along+distance*direction));
  if(next<=ROOF_STAIR_EPSILON)next=0;else if(length-next<=ROOF_STAIR_EPSILON)next=length;
  const before={x:body.x,y:body.y};
  body.x=from.x+dx*next/length;body.y=from.y+dy*next/length;
  body.stairStep=step;body.stairDirection=direction;
  if(direction===1&&next===length)body.stairStep=step+1;
  else if(direction===-1&&next===0){
    if(step===1){body.stairStep=0;body.stairDirection=1;body.y=from.y-16;}
    else body.stairStep=step-1;
  }
  body.moving=Math.hypot(body.x-before.x,body.y-before.y)>.001;
  return true;
}

/** Finish a released step despite the position rounding in network snapshots. */
export function settleRoofStairLanding(body:StairPosition&{moving:boolean}){
  if(onRoofWindowPlatform(body)&&body.x>ROOF_WINDOW_PLATFORM.junction.x+ROOF_STAIR_EPSILON){body.moving=false;return;}
  const step=body.stairStep??0;
  if(step<1||step>=ROOF_STAIR_ROUTE.length)return;
  const direction=body.stairDirection===-1?-1:1,target=ROOF_STAIR_ROUTE[direction===1?step:step-1];
  if(Math.hypot(body.x-target.x,body.y-target.y)>.2)return;
  body.x=target.x;body.y=target.y;body.moving=false;
  if(direction===1)body.stairStep=step+1;
  else if(step===1){body.stairStep=0;body.stairDirection=1;body.y=target.y-16;}
  else body.stairStep=step-1;
}

export function nearRoofStairBase(point:Point){
  const foot=STREET_ROOF_STAIRS.foot;
  return Math.abs(point.x-foot.x)<=64&&Math.abs(point.y-foot.y)<=36;
}

/** Guide an intentional side or front approach onto the bottom without a precision aim. */
export function roofStairApproach(point:Point,input:{x:number;y:number;route?:boolean},distance:number):Point|null {
  if(!nearRoofStairBase(point)||distance<=0)return null;
  const foot=STREET_ROOF_STAIRS.foot,dx=foot.x-point.x,dy=foot.y-point.y,length=Math.hypot(dx,dy);
  if(input.route&&length>.1&&(input.x*dx+input.y*dy)/Math.hypot(input.x,input.y)/length<.98)return null;
  if(!input.route&&input.y<0)return null;
  if(input.y<=0&&(input.x*dx+input.y*dy)<=0)return null;
  if(length<.1)return {...foot};
  const fraction=Math.min(1,distance/length);
  return {x:point.x+dx*fraction,y:point.y+dy*fraction};
}
export const ROOF_STAIRS = {
  entry: { x: 530, y: 620 }, arrival: ROOF.spawn, facing: 'down', click: { x: 530, y: 515 },
  left: 502, right: 558, top: 608, bottom: 632,
} as const;

export const ROOF_OBSTACLES: Obstacle[] = [
  { x: 0, y: 0, w: WORLD.width, h: 330 },
  { x: 0, y: 0, w: 170, h: ROOF.height },
  { x: 2070, y: 0, w: WORLD.width - 2070, h: ROOF.height },
  { x: 0, y: 1170, w: WORLD.width, h: ROOF.height - 1170 },
  ROOF.hatch, ...ROOF.vents, ...ROOF.benches, ROOF.antenna, ROOF_TOILET.body, ROOF_TOILET.step,
];
