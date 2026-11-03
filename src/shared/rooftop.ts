import type { Obstacle, Point } from '../game/navigation';
import { WORLD } from './clubGeometry';

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
export const ROOF_STAIR_DRAW = { ladderRise:160, flightRise:144, widthScale:1.65 } as const;
const roofEntry=ROOF_STAIR_ROUTE[ROOF_STAIR_ROUTE.length-1];
export const STREET_ROOF_STAIRS = {
  foot: ROOF_STAIR_ROUTE[0],
  entry: roofEntry, arrival: { x: 1660, y: 462 }, facing: 'down', click: { x: 1660, y: 477 },
  left: roofEntry.x-15, right: roofEntry.x+15, top: roofEntry.y-11, bottom: roofEntry.y+11,
} as const;

/** Ordered, continuous progress, shared by authoritative movement and prediction. */
export function advanceRoofStairStep(step: number, point: Point): number {
  if (!Number.isInteger(step) || step < 0 || step > ROOF_STAIR_ROUTE.length) return 0;
  if (!step) return Math.hypot(point.x - STREET_ROOF_STAIRS.foot.x, point.y - STREET_ROOF_STAIRS.foot.y) <= 7 ? 1 : 0;
  if (step === ROOF_STAIR_ROUTE.length) return Math.hypot(point.x - STREET_ROOF_STAIRS.entry.x, point.y - STREET_ROOF_STAIRS.entry.y) <= 16 ? step : 0;
  const from = ROOF_STAIR_ROUTE[step - 1], to = ROOF_STAIR_ROUTE[step];
  const dx = to.x - from.x, dy = to.y - from.y;
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / (dx * dx + dy * dy)));
  if (Math.hypot(point.x - from.x - dx * t, point.y - from.y - dy * t) > 20) return 0;
  return Math.hypot(point.x - to.x, point.y - to.y) <= .1 ? step + 1 : step;
}

/** A direction advances one flight only. Other input leaves the person on its steps. */
export function moveRoofStairs(body:Point&{stairStep?:number;moving:boolean},input:{x:number;y:number;route?:boolean},distance:number):boolean {
  const step=body.stairStep??0;
  if(step<=0||step>ROOF_STAIR_ROUTE.length)return false;
  body.moving=false;
  if(step===ROOF_STAIR_ROUTE.length||distance<=0)return true;
  const from=ROOF_STAIR_ROUTE[step-1],to=ROOF_STAIR_ROUTE[step],dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);
  const along=Math.max(0,Math.min(length,((body.x-from.x)*dx+(body.y-from.y)*dy)/length));
  const backingDown=step===1&&!input.route&&input.x===0&&input.y>0;
  const forward=input.route
    ? (input.x*dx+input.y*dy)/Math.hypot(input.x,input.y)/length>.99
    : dx===0?input.x===0&&input.y<0:input.y===0&&Math.sign(input.x)===Math.sign(dx);
  if(!forward&&!backingDown)return true;
  const next=backingDown?Math.max(0,along-distance):Math.min(length,along+distance);
  const before={x:body.x,y:body.y};body.x=from.x+dx*next/length;body.y=from.y+dy*next/length;
  if(backingDown&&next===0){body.stairStep=0;body.y=from.y-12;}
  else if(next===length)body.stairStep=step+1;
  body.moving=Math.hypot(body.x-before.x,body.y-before.y)>.001;
  return true;
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
  ROOF.hatch, ...ROOF.vents, ...ROOF.benches, ROOF.antenna,
];
