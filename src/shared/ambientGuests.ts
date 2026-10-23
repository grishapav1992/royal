import { t as translateText } from '../i18n/index';
import { CABINETS, cabinetsInHall } from './cabinets';
import { hallObstacles, SEATS, type HallId } from './world';
import { LOUNGES } from './clubLayout';
import { findPath, walkable, type Point } from '../game/navigation';
import { movementFacing, type Facing } from './movement';

export type GuestMood = 'walking' | 'playing' | 'drinking' | 'resting';
export type AmbientGuestView = { id: string; name: string; hall: HallId; skin: number; x: number; y: number; facing: Facing; moving: boolean; mood: GuestMood; drink: string; seat: string; destination: string };
type Stop = Point & { id: string; mood: Exclude<GuestMood,'walking'>; facing: Facing; seat?: string };
export function guestStops(hall: HallId): Stop[] {
  const games=cabinetsInHall(hall).map(c=>({id:c.id,x:c.x+25,y:c.y+65,mood:'playing' as const,facing:'up' as const}));
  return [
    ...games.slice(0,7),
    ...(hall==='arcade'?SEATS.filter(seat=>seat.kind==='bar').map((seat,i)=>({id:'bar-guest-'+i,x:seat.x,y:seat.y,mood:'drinking' as const,facing:'up' as const})):[]),
    ...games.slice(7),
    ...LOUNGES.filter(l=>l.hall===hall).map((l,i)=>({id:'lounge-guest-'+i,x:l.x+48,y:l.y+4,mood:'resting' as const,facing:'down' as const,seat:'ambient-'+hall+'-'+i})),
    ...(hall==='tables'?[{id:'pool-watch',x:685,y:520,mood:'playing' as const,facing:'left' as const},{id:'hockey-watch',x:1290,y:500,mood:'playing' as const,facing:'left' as const},{id:'library',x:1550,y:950,mood:'resting' as const,facing:'up' as const},{id:'library-reading',x:1710,y:1140,mood:'resting' as const,facing:'left' as const}]:[]),
    ...(hall==='github'?[{id:'salon-reading',x:430,y:450,mood:'resting' as const,facing:'up' as const},{id:'salon-welcome',x:730,y:530,mood:'resting' as const,facing:'left' as const}]:[]),
  ];
}
const names=[translateText('Лена'),translateText('Марк'),translateText('Ника'),translateText('Саша'),translateText('Лев'),translateText('Даша'),translateText('Макс'),translateText('Оля'),translateText('Илья'),translateText('Вера')];
const cabinetIds = new Set(CABINETS.map(cabinet => cabinet.id));
type Routine = { view: AmbientGuestView; stops: Stop[]; path: Point[]; elapsed: number; duration: number; index: number; seed: number };
// The same routine runs on the server and in offline practice. Guests never own
// accounts, wallets or real game seats, and do not count toward room capacity.
export class AmbientGuests {
  private routines: Routine[] = [];
  private occupiedCabinets = new Set<string>();
  constructor() {
    for (const hall of ['arcade','tables','github'] as const) {
      const stops=guestStops(hall);
      for(let i=0;i<(hall==='arcade'?10:8);i++) {
        const index=i%stops.length,stop=stops[index];
        const view:AmbientGuestView={id:'guest-'+hall+'-'+i,name:names[i],hall,skin:i%6,x:stop.x,y:stop.y,facing:stop.facing,moving:false,mood:stop.mood,drink:stop.mood==='drinking'?'lemonade':'',seat:stop.seat??'',destination:stop.id};
        this.routines.push({view,stops,path:[],elapsed:0,duration:12+i*2,index,seed:53+i*971+hall.length*271});
      }
    }
  }
  snapshot(): AmbientGuestView[] { return this.routines.map(r=>({...r.view})); }
  setOccupiedCabinets(ids: Iterable<string>) {
    this.occupiedCabinets.clear();
    for (const id of ids) if (cabinetIds.has(id)) this.occupiedCabinets.add(id);
  }
  private nextStop(routine: Routine) {
    routine.seed=(routine.seed*1664525+1013904223)>>>0;
    const offset=1+routine.seed%(routine.stops.length-1);
    for(let attempt=0;attempt<routine.stops.length;attempt++) {
      const next=(routine.index+offset+attempt)%routine.stops.length,stop=routine.stops[next];
      if(next===routine.index||this.occupiedCabinets.has(stop.id))continue;
      const path=findPath(routine.view,stop,hallObstacles(routine.view.hall));
      if(!path.length)continue;
      routine.index=next;routine.path=path;routine.duration=14+routine.seed%22;
      routine.view.mood='walking';routine.view.drink='';routine.view.seat='';routine.view.destination=stop.id;
      return true;
    }
    return false;
  }
  tick(delta: number) {
    const dt=Math.max(0,Math.min(delta,.1));
    for(const routine of this.routines) {
      const view=routine.view;
      if(this.occupiedCabinets.has(view.destination)) {
        routine.path=[];view.moving=false;view.mood='walking';view.drink='';view.seat='';
        // A real player's claim also redirects guests already walking toward the cabinet.
        if(!this.nextStop(routine))continue;
      }
      if(routine.path.length) {
        let distance=65*dt;view.moving=false;
        while(distance>0&&routine.path.length) {
          const point=routine.path[0],dx=point.x-view.x,dy=point.y-view.y,length=Math.hypot(dx,dy);
          if(length<.01){routine.path.shift();continue;}
          const step=Math.min(distance,length),x=view.x+dx/length*step,y=view.y+dy/length*step;
          if(!walkable(x,y,hallObstacles(view.hall))){routine.path=[];routine.elapsed=routine.duration;break;}
          view.x=x;view.y=y;view.facing=movementFacing(dx,dy,view.facing);view.moving=true;distance-=step;
          if(step===length)routine.path.shift();
        }
        if(!routine.path.length) {
          const stop=routine.stops[routine.index];view.moving=false;view.mood=stop.mood;view.facing=stop.facing;view.seat=stop.seat??'';view.drink=stop.mood==='drinking'?'lemonade':'';routine.elapsed=0;
        }
      }else{
        routine.elapsed+=dt;
        if(routine.elapsed<routine.duration)continue;
        if(!this.nextStop(routine))routine.elapsed=0;
      }
    }
  }
}
