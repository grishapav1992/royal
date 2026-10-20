import { Guard, type LobbyState, type Player as PlayerBody } from './state';
import { findPath, walkable, type Point } from '../src/game/navigation';
import { hallObstacles, HALL_DOORS, hallLinks, otherHall, type ConnectedHallDoor, type HallId } from '../src/shared/world';
import { GUARD_EXIT, GUARD_HOME, type SecurityDecision } from '../src/shared/security';
import { movementFacing, type Facing } from '../src/shared/movement';
import { guardPath } from './guardNavigation';
import { GUARD_STOPS, GUARD_BAR_TALKS, type GuardStop } from './guardRoutine';
import { GUARD_CONTACT_RADIUS } from '../src/shared/guardCollision';

type Job = { id: string; decision: SecurityDecision };
type Resume = {elapsed:number;phase:string;progress:number;facing:string;target:string;speech:string;reply:string;routine:string};
type Duty = { guard: Guard; queue: Job[]; job?: Job; resume?:Resume; path: Point[]; elapsed: number; stops: Record<HallId, GuardStop[]>; remaining: number; transfer?: HallId; transferArrival?: ConnectedHallDoor; transferFrom?: HallId; visit?: GuardStop; duration: number; conversation: number; lastConversation: number };
export class Guards {
  private duties: Duty[] = [];
  private touching=new Set<string>();
  constructor(private state: LobbyState, private finish: (id: string, decision: SecurityDecision) => void, private random = Math.random, private onBump:(id:string)=>number=()=>1) {
    const guard = new Guard();
    // The map key identifies the person, while hall changes only at a doorway.
    state.guards.set('security', guard);
    this.duties.push({ guard, queue: [], path: [], elapsed: 0,
      stops:{arcade:[...GUARD_STOPS.arcade],tables:[...GUARD_STOPS.tables],github:[...GUARD_STOPS.github]}, remaining:3,
      duration:0, conversation:0, lastConversation:-1 });
  }

  contact(id:string) {
    const p=this.state.players.get(id),d=this.duties[0],g=d.guard;
    if(!p?.connected||p.security||p.hall!==g.hall||g.phase==='door'||this.touching.has(id)||Math.hypot(p.x-g.x,p.y-g.y)>GUARD_CONTACT_RADIUS+12)return;
    this.touching.add(id);
    const count=this.onBump(id);
    if(count>=10||d.job)return;
    if(!d.resume)d.resume={elapsed:d.elapsed,phase:g.phase,progress:g.progress,facing:g.facing,target:g.target,speech:g.speech,reply:g.reply,routine:g.routine};
    this.phase(d,'bump');g.target=id;g.routine='';g.facing=movementFacing(p.x-g.x,p.y-g.y,g.facing as Facing);
    g.speech=count===9?'Ещё один толчок, и на выход. 9/10.':`Не толкайся. ${count}/10.`;
  }

  // A heavy guard displaces a standing guest, but never pushes anyone into furniture.
  // Only player input calls contact(), so these passive contacts cannot earn a strike.
  private moveGuard(d:Duty,x:number,y:number) {
    const pushes:{p:PlayerBody;x:number;y:number}[]=[];
    for(const [id,p] of this.state.players){
      if(!p.connected||p.hall!==d.guard.hall||id===d.job?.id)continue;
      const dx=p.x-x,dy=p.y-y,length=Math.hypot(dx,dy);
      if(length>=GUARD_CONTACT_RADIUS)continue;
      if(p.seat||p.playing||p.activity)return false;
      const nx=length>.001?dx/length:1,ny=length>.001?dy/length:0;
      let px=x+nx*(GUARD_CONTACT_RADIUS+.1),py=y+ny*(GUARD_CONTACT_RADIUS+.1);
      const obstacles=hallObstacles(p.hall);
      if(!walkable(px,py,obstacles)){
        const mx=x-d.guard.x,my=y-d.guard.y,step=Math.hypot(mx,my);
        if(step<.001)return false;
        const radius=GUARD_CONTACT_RADIUS+.1;
        const sides=[{x:x-my/step*radius,y:y+mx/step*radius},{x:x+my/step*radius,y:y-mx/step*radius}];
        const safe=sides.sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y)).find(point=>{
          const steps=Math.ceil(Math.hypot(point.x-p.x,point.y-p.y)/3);
          for(let i=0;i<=steps;i++)if(!walkable(p.x+(point.x-p.x)*i/steps,p.y+(point.y-p.y)*i/steps,obstacles))return false;
          return true;
        });
        if(!safe)return false;
        px=safe.x;py=safe.y;
      }
      pushes.push({p,x:px,y:py});
    }
    for(const push of pushes){push.p.x=push.x;push.p.y=push.y;}
    d.guard.x=x;d.guard.y=y;return true;
  }

  enqueue(id: string, decision: SecurityDecision) {
    const p = this.state.players.get(id);
    if (!p) return;
    if (p.security) {
      const duty = this.duties[0];
      const job = duty.job?.id === id ? duty.job : duty.queue.find(j => j.id === id);
      if (job && decision.kind === 'ejecting') {
        job.decision = decision; p.security = decision.kind;
        if (duty.job === job && duty.guard.phase === 'warn') this.phase(duty, 'grab');
      }
      return;
    }
    p.security = decision.kind; p.moving = false;
    this.duties[0].queue.push({ id, decision });
  }
  private phase(d: Duty, phase: string) { d.guard.phase = phase; d.guard.progress = 0; d.guard.reply = ''; d.elapsed = 0; }
  private route(d: Duty, goal: Point) {
    d.path = guardPath(d.guard, goal, hallObstacles(d.guard.hall));
  }
  private nextVisit(d: Duty) {
    if (!d.remaining) { this.transfer(d,d.guard.hall==='tables'&&d.transferFrom==='arcade'?'github':otherHall(d.guard.hall)); return; }
    const hall=d.guard.hall as HallId;
    if (!d.stops[hall].length) {
      const deck=[...GUARD_STOPS[hall]];
      for(let i=deck.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[deck[i],deck[j]]=[deck[j],deck[i]];}
      if(deck[0].id===d.visit?.id)deck.push(deck.shift()!);
      d.stops[hall]=deck;
    }
    d.remaining--;
    d.visit=d.stops[hall].shift()!;
    d.guard.routine=d.visit.id;d.guard.speech='';d.guard.target='';
    this.route(d,d.visit);this.phase(d,'patrol');
  }
  private settle(d: Duty) {
    const visit=d.visit!;
    this.phase(d,visit.activity);d.guard.facing=visit.facing;
    d.duration=visit.activity==='chat'?12.8:6+this.random()*7;
    if(visit.activity==='chat'){
      const choices=GUARD_BAR_TALKS.map((_,i)=>i).filter(i=>i!==d.lastConversation);
      d.conversation=choices[Math.floor(this.random()*choices.length)];d.lastConversation=d.conversation;
    }
  }
  private leisure(d: Duty) {
    const g=d.guard,visit=d.visit!;
    g.progress=Math.min(1,d.elapsed/d.duration);
    if(g.phase==='chat'){
      const turn=Math.min(3,Math.floor(d.elapsed/3.2)),text=GUARD_BAR_TALKS[d.conversation][turn];
      g.speech=turn%2===0?text:'';g.reply=turn%2===1?text:'';
    } else if(g.phase==='watch'){
      const nearby=[...this.state.players.values()].filter(p=>p.connected&&p.hall===g.hall&&Math.hypot(p.x-g.x,p.y-g.y)<220)
        .sort((a,b)=>Math.hypot(a.x-g.x,a.y-g.y)-Math.hypot(b.x-g.x,b.y-g.y))[0];
      const scan=Math.floor(d.elapsed/3)%3;
      g.facing=scan===1&&nearby?movementFacing(nearby.x-g.x,nearby.y-g.y,visit.facing):scan===2?(visit.facing==='left'?'right':'left'):visit.facing;
    } else if(g.phase==='window')g.facing=d.elapsed>d.duration-2?'down':visit.facing;
    if(d.elapsed>=d.duration)this.nextVisit(d);
  }
  private transfer(d: Duty, hall: HallId) {
    const links=hallLinks(d.guard.hall as HallId);const link=links.find(link=>link.target===hall)??links.find(link=>link.target==='tables')!;
    d.transferFrom=d.guard.hall as HallId;d.transfer=link.target;d.transferArrival=link.arrival;d.guard.routine='door';d.guard.speech='';
    this.route(d,link.door.entry);this.phase(d,'transit');
  }
  private approach(d: Duty) {
    const g=d.guard,p=this.state.players.get(d.job!.id)!;
    const obstacles = hallObstacles(g.hall);
    const candidates = [32,48,64,96].flatMap(radius => Array.from({length:16},(_,i)=>({x:p.x+Math.cos(i*Math.PI/8)*radius,y:p.y+Math.sin(i*Math.PI/8)*radius})));
    // A clear point can still snap into furniture on the navigation grid. Try every side.
    d.path = [];
    for (const point of candidates) {
      if (!walkable(point.x, point.y, obstacles)) continue;
      const dx=p.x-point.x,dy=p.y-point.y,length=Math.hypot(dx,dy);
      const steps=Math.ceil(length/3);
      if (Array.from({length:steps+1},(_,i)=>i/steps).some(t=>!walkable(point.x+dx*t,point.y+dy*t,obstacles))) continue;
      const path = findPath(g, point, obstacles);
      if (path.length) {
        path.push({x:p.x-dx/length*24,y:p.y-dy/length*24});
        d.path = path; break;
      }
    }
    if (!d.path.length) {
      d.path = guardPath(g, p, obstacles);
      if (d.path.length) {
        const end=d.path[d.path.length-1],before=d.path.length>1?d.path[d.path.length-2]:g;
        const length=Math.hypot(end.x-before.x,end.y-before.y),stop=Math.min(24,length);
        if(length>0)d.path[d.path.length-1]={x:end.x+(before.x-end.x)/length*stop,y:end.y+(before.y-end.y)/length*stop};
      }
    }
    this.phase(d, 'approach');
    g.speech = d.job!.decision.kind === 'warning' ? (d.job!.decision.reason === 'spam' ? 'Не засоряй чат. Хватит спамить.' : 'Не оскорбляй других гостей.') : d.job!.decision.reason==='collision'?'Десятый толчок. На выход.':'Правила были озвучены. На выход.';
  }
  tick(dt: number) {
    for(const id of this.touching){const p=this.state.players.get(id),g=this.duties[0].guard;if(!p||p.hall!==g.hall||Math.hypot(p.x-g.x,p.y-g.y)>GUARD_CONTACT_RADIUS+10)this.touching.delete(id);}
    for (const d of this.duties) {
      const g = d.guard;
      if (!d.job && d.queue.length) {
        d.job = d.queue.shift()!;
        const p = this.state.players.get(d.job.id);
        if (!p) { d.job = undefined; continue; }
        g.target = d.job.id;
        g.routine = ''; g.reply = '';
        d.resume=undefined;
        d.transfer=undefined;
        if(p.hall!==g.hall)this.transfer(d,p.hall as HallId);
        else this.approach(d);

      }
      if (d.job && !this.state.players.has(d.job.id)) {
        d.job = undefined; d.transfer=undefined; g.target = ''; g.speech = ''; this.route(d, GUARD_HOME); this.phase(d, 'return');
      }
      d.elapsed += dt;
      if (['approach', 'carry', 'return', 'patrol', 'transit', 'enter'].includes(g.phase)) {
        let distance = dt * (g.phase === 'carry' ? 150 : g.phase==='patrol'||g.phase==='return'||(['transit','enter'].includes(g.phase)&&!d.job)?85:220);
        while (distance > 0 && d.path.length) {
          const point = d.path[0], dx = point.x - g.x, dy = point.y - g.y, length = Math.hypot(dx, dy);
          if (length < .01) { d.path.shift(); continue; }
          const step = Math.min(distance, length);
          if(!this.moveGuard(d,g.x+dx/length*step,g.y+dy/length*step))break;
          g.facing = movementFacing(dx, dy, g.facing as Facing); distance -= step;
          if (step === length) d.path.shift();
        }
        if(g.phase==='enter')g.progress=Math.min(1,d.elapsed/.25);
        if (g.phase === 'carry' && d.job) {
          const p = this.state.players.get(d.job.id)!;
          p.x = g.x; p.y = g.y; p.facing = g.facing;
        }
        if (!d.path.length) {
          if(g.phase==='transit') {
            const door=hallLinks(g.hall as HallId).find(link=>link.target===d.transfer)!.door;
            g.facing=door.facing==='up'?'down':'up';this.phase(d,'door');
          } else if(g.phase==='enter') {
            d.transfer=undefined;d.remaining=3;
            if(d.job){const player=this.state.players.get(d.job.id);if(player&&player.hall!==g.hall)this.transfer(d,player.hall as HallId);else this.approach(d);}else this.nextVisit(d);
          } else if (g.phase === 'approach') {
            g.facing = 'down'; this.phase(d, d.job!.decision.kind === 'warning' ? 'warn' : 'grab');
            g.speech = d.job!.decision.kind === 'warning' ? 'Первое предупреждение!\nЕщё раз в течение суток: выход на 10 минут.' : 'Пора проветриться.';
          } else if (g.phase === 'patrol') { this.settle(d); }
          else if (g.phase === 'carry') { this.phase(d, 'throw'); g.facing = 'down'; g.speech = d.job?.decision.reason==='collision'?'Возвращайся через 10 минут.\nИ больше не толкайся.':'Возвращайся через 10 минут.\nБез оскорблений и спама.'; }
          else { this.phase(d, 'idle'); g.facing = 'down'; }
        }
      } else if(g.phase==='bump') {
        g.progress=Math.min(1,d.elapsed/1.2);
        if(d.elapsed>=1.2&&d.resume){const {elapsed,...view}=d.resume;Object.assign(g,view);d.elapsed=elapsed;d.resume=undefined;}
      } else if(g.phase==='door') {
        g.progress=Math.min(1,d.elapsed/.45);
        if(d.elapsed>=.45) {
          g.hall=d.transfer!;const door=d.transferArrival??HALL_DOORS[d.transfer!];
          g.x=door.entry.x;g.y=door.entry.y;g.facing=door.facing;
          this.route(d,door.arrival);this.phase(d,'enter');
        }
      } else if (g.phase === 'warn' || g.phase === 'grab' || g.phase === 'throw') {
        const duration = g.phase === 'warn' ? 3.5 : g.phase === 'grab' ? .7 : 1.2;
        g.progress = Math.min(1, d.elapsed / duration);
        if (d.elapsed >= duration) {
          if (g.phase === 'grab') { this.route(d, GUARD_EXIT); this.phase(d, 'carry'); g.speech = ''; }
          else {
            const job = d.job!;
            const p = this.state.players.get(job.id);
            if (p && job.decision.kind === 'warning') p.security = '';
            this.finish(job.id, job.decision);
            d.job = undefined; g.target = ''; g.speech = ''; this.route(d, GUARD_HOME); this.phase(d, 'return');
          }
        }
      } else if(g.phase==='idle'&&d.elapsed>=1.2)this.nextVisit(d);
      else if(['chat','window','inspect','watch'].includes(g.phase))this.leisure(d);
    }
  }
}
