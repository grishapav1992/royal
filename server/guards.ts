import { Guard, type LobbyState, type Player as PlayerBody } from './state';
import { findPath, walkable, type Point } from '../src/game/navigation';
import { hallObstacles, HALL_DOORS, hallLinks, hallLinkToward, isCasinoFloor, otherHall, type ConnectedHallDoor, type HallId } from '../src/shared/world';
import { GUARD_EXIT, GUARD_HOME, type ClubPursuit, type SecurityDecision } from '../src/shared/security';
import { movementFacing, type Facing } from '../src/shared/movement';
import { guardLineClear, guardPath } from './guardNavigation';
import { GUARD_STOPS, GUARD_BAR_TALKS, type GuardStop } from './guardRoutine';
import { GUARD_CONTACT_RADIUS } from '../src/shared/guardCollision';
import { ROOF } from '../src/shared/rooftop';
import { TOILET } from '../src/shared/toilet';
import { STREET } from '../src/shared/street';

const SIGHT_RANGE = 260;
const LOST_AFTER_SECONDS = 2.5;
const SEARCH_AFTER_VIOLATION_SECONDS = 12;
const REPATH_SECONDS = .25;
const ESCORT_STALL_SECONDS = 2;
const VIEW_DIRECTION: Record<Facing, Point> = {
  down: { x: 0, y: 1 }, up: { x: 0, y: -1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
};
type Chase = {
  pursuit: ClubPursuit; hall: string; player: PlayerBody; lastKnown: Point;
  unseen: number; sighted: boolean; repath: number; pending: boolean; caught: boolean; escortStall: number;
};
type Job = { id: string; decision: SecurityDecision; chase?: Chase };
type Enforcement = {
  marked: (id: string) => ClubPursuit | undefined;
  capture: (id: string, pursuit: ClubPursuit) => Promise<SecurityDecision | null>;
};
type Resume = {elapsed:number;phase:string;progress:number;facing:string;target:string;speech:string;reply:string;routine:string};
type Duty = { guard: Guard; queue: Job[]; job?: Job; resume?:Resume; path: Point[]; elapsed: number; stops: Record<HallId, GuardStop[]>; remaining: number; transfer?: HallId; transferArrival?: ConnectedHallDoor; transferFrom?: HallId; visit?: GuardStop; duration: number; conversation: number; lastConversation: number };
export class Guards {
  private duties: Duty[] = [];
  private touching=new Set<string>();
  constructor(private state: LobbyState, private finish: (id: string, decision: SecurityDecision) => void,
    private random = Math.random, private onBump:(id:string)=>number=()=>1, private enforcement?: Enforcement) {
    const guard = new Guard();
    // The map key identifies the person, while hall changes only at a doorway.
    state.guards.set('security', guard);
    this.duties.push({ guard, queue: [], path: [], elapsed: 0,
      stops:{arcade:[...GUARD_STOPS.arcade],tables:[...GUARD_STOPS.tables],github:[...GUARD_STOPS.github],street:[...GUARD_STOPS.street],roof:[...GUARD_STOPS.roof],toilet:[...GUARD_STOPS.toilet]}, remaining:3,
      duration:0, conversation:0, lastConversation:-1 });
  }

  contact(id:string) {
    const p=this.state.players.get(id),d=this.duties[0],g=d.guard;
    if(!p?.connected||p.security||p.hall!==g.hall||g.phase==='door'||this.touching.has(id)||Math.hypot(p.x-g.x,p.y-g.y)>GUARD_CONTACT_RADIUS+12)return;
    if (d.job?.chase && d.job.id === id) return;
    if (!guardLineClear(g, p, hallObstacles(g.hall))) return;
    this.touching.add(id);
    const count=this.onBump(id);
    if(count>=10||d.job)return;
    if(!d.resume)d.resume={elapsed:d.elapsed,phase:g.phase,progress:g.progress,facing:g.facing,target:g.target,speech:g.speech,reply:g.reply,routine:g.routine};
    this.phase(d,'bump');g.target=id;g.routine='';g.facing=movementFacing(p.x-g.x,p.y-g.y,g.facing as Facing);
    g.speech=count===9?'Ещё один толчок, и на выход.':'Не толкайся.';
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
  pursue(id: string, pursuit: ClubPursuit): boolean {
    const p = this.state.players.get(id), d = this.duties[0];
    if (!this.enforcement || !p?.connected || p.security || !isCasinoFloor(p.hall) || pursuit.until <= Date.now()
      || d.job?.id === id || d.queue.some(job => job.id === id)) return false;
    d.queue.push({
      id, decision: { kind: 'ejecting', until: pursuit.until, reason: pursuit.reason },
      chase: { pursuit, hall: p.hall, player: p, lastKnown: { x: p.x, y: p.y }, unseen: 0,
        sighted: !pursuit.reason, repath: 0, pending: false, caught: false, escortStall: 0 },
    });
    return true;
  }
  cancelPursuit(id: string, sanctionId?: string) {
    const d = this.duties[0];
    const matches = (job: Job) => job.id === id && job.chase && (sanctionId === undefined || job.chase.pursuit.sanctionId === sanctionId);
    d.queue = d.queue.filter(job => !matches(job));
    if (d.job && matches(d.job) && d.job.chase && !d.job.chase.pending && !d.job.chase.caught) this.release(d);
  }
  private release(d: Duty, unlock = true) {
    const job = d.job;
    const player = job && this.state.players.get(job.id);
    if (unlock && player && job && (!job.chase || (job.chase.player === player && job.chase.pending))) player.security = '';
    d.job = undefined;
    d.transfer = undefined;
    d.resume = undefined;
    d.guard.target = '';
    d.guard.speech = '';
    this.route(d, GUARD_HOME);
    this.phase(d, 'return');
  }
  private sees(guard: Guard, player: PlayerBody, facing: boolean): boolean {
    const dx = player.x - guard.x, dy = player.y - guard.y, distance = Math.hypot(dx, dy);
    if (distance > SIGHT_RANGE) return false;
    const view = VIEW_DIRECTION[guard.facing as Facing];
    if (facing && view && dx * view.x + dy * view.y < distance * .5) return false;
    return guardLineClear(guard, player, hallObstacles(guard.hall));
  }
  private look(d: Duty) {
    const g = d.guard;
    if (!this.enforcement || !isCasinoFloor(g.hall) || ['bump', 'door', 'transit', 'enter'].includes(g.phase)) return;
    for (const [id, player] of this.state.players) {
      if (!player.connected || player.security || player.hall !== g.hall) continue;
      const pursuit = this.enforcement.marked(id);
      if (pursuit && this.sees(g, player, true) && this.pursue(id, pursuit)) return;
    }
  }
  private validChase(job: Job, chase: Chase): boolean {
    const player = chase.player;
    return this.state.players.get(job.id) === player && player.connected && player.hall === chase.hall
      && chase.pursuit.until > Date.now();
  }
  private contactReached(guard: Guard, player: PlayerBody): boolean {
    return player.hall === guard.hall && Math.hypot(player.x - guard.x, player.y - guard.y) <= GUARD_CONTACT_RADIUS
      && guardLineClear(guard, player, hallObstacles(guard.hall));
  }
  private tryCapture(d: Duty, job: Job, chase: Chase): boolean {
    if (!this.contactReached(d.guard, chase.player)) return false;
    chase.pending = true;
    chase.player.security = 'ejecting';
    chase.player.moving = false;
    d.path = [];
    void this.enforcement!.capture(job.id, chase.pursuit).then(decision => {
      if (d.job !== job) return;
      if (!decision || this.state.players.get(job.id) !== chase.player) { this.release(d); return; }
      chase.pending = false;
      chase.caught = true;
      job.decision = decision;
      d.guard.facing = movementFacing(chase.player.x - d.guard.x, chase.player.y - d.guard.y, d.guard.facing as Facing);
      this.phase(d, 'grab');
    }, () => { if (d.job === job) this.release(d); });
    return true;
  }
  private follow(d: Duty, job: Job, chase: Chase, dt: number): boolean {
    if (this.tryCapture(d, job, chase)) return false;
    if (this.sees(d.guard, chase.player, false)) {
      chase.lastKnown = { x: chase.player.x, y: chase.player.y };
      chase.unseen = 0;
      chase.sighted = true;
    } else {
      chase.unseen += dt;
      const searching = !chase.sighted && Math.hypot(d.guard.x - chase.lastKnown.x, d.guard.y - chase.lastKnown.y) > GUARD_CONTACT_RADIUS;
      const limit = searching ? SEARCH_AFTER_VIOLATION_SECONDS : LOST_AFTER_SECONDS;
      if (chase.unseen >= limit) { this.release(d); return false; }
    }
    chase.repath -= dt;
    if (chase.repath <= 0) {
      const obstacles = hallObstacles(d.guard.hall);
      const target = chase.lastKnown;
      d.path = walkable(target.x, target.y, obstacles) && guardLineClear(d.guard, target, obstacles, 12)
        ? [target] : guardPath(d.guard, target, obstacles);
      chase.repath = REPATH_SECONDS;
    }
    return true;
  }
  private phase(d: Duty, phase: string) { d.guard.phase = phase; d.guard.progress = 0; d.guard.reply = ''; d.elapsed = 0; }
  private route(d: Duty, goal: Point) {
    if(d.guard.hall==='street'&&(goal===GUARD_EXIT||goal===GUARD_HOME))goal=STREET.spawn;
    if(d.guard.hall==='roof'&&(goal===GUARD_EXIT||goal===GUARD_HOME))goal=ROOF.spawn;
    if(d.guard.hall==='toilet'&&(goal===GUARD_EXIT||goal===GUARD_HOME))goal=TOILET.spawn;
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
    const links=hallLinks(d.guard.hall as HallId);const link=hallLinkToward(d.guard.hall as HallId,hall)??links[0];
    d.transferFrom=d.guard.hall as HallId;d.transfer=link.target;d.transferArrival=link.arrival;d.guard.routine='door';d.guard.speech='';
    this.route(d,link.door.entry);this.phase(d,'transit');
  }
  private approach(d: Duty) {
    const g=d.guard,p=this.state.players.get(d.job!.id)!;
    const chase = d.job!.chase;
    if (chase) {
      this.phase(d, 'approach');
      chase.repath = 0;
      g.speech = '';
      return;
    }
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
    const { kind, reason } = d.job!.decision;
    if (kind === 'warning') {
      g.speech = 'Не засоряй чат. Хватит спамить.';
    } else {
      g.speech = reason === 'collision' ? 'Десятый толчок. На выход.'
        : reason === 'profanity' ? 'Слишком много грубых слов. На выход.'
        : 'Спам в чате. На выход.';
    }
  }
  tick(dt: number) {
    for(const id of this.touching){const p=this.state.players.get(id),g=this.duties[0].guard;if(!p||p.hall!==g.hall||Math.hypot(p.x-g.x,p.y-g.y)>GUARD_CONTACT_RADIUS+10)this.touching.delete(id);}
    for (const d of this.duties) {
      const g = d.guard;
      if (!d.job && !d.queue.length) this.look(d);
      if (!d.job && d.queue.length) {
        d.job = d.queue.shift()!;
        const p = this.state.players.get(d.job.id);
        if (!p || (d.job.chase && !this.validChase(d.job, d.job.chase))) { this.release(d); continue; }
        g.target = d.job.id;
        g.routine = ''; g.reply = '';
        d.resume=undefined;
        d.transfer=undefined;
        if(p.hall!==g.hall)this.transfer(d,p.hall as HallId);
        else this.approach(d);

      }
      if (d.job && !this.state.players.has(d.job.id)) {
        this.release(d);
      }
      const job = d.job, chase = job?.chase;
      if (job && chase && !chase.caught) {
        if (chase.pending) continue;
        if (!this.validChase(job, chase)) { this.release(d); continue; }
        if (g.phase === 'transit' && d.elapsed >= SEARCH_AFTER_VIOLATION_SECONDS) { this.release(d); continue; }
        if (g.phase === 'approach' && !this.follow(d, job, chase, dt)) continue;
      }
      d.elapsed += dt;
      if (['approach', 'carry', 'return', 'patrol', 'transit', 'enter'].includes(g.phase)) {
        const beforeX = g.x, beforeY = g.y;
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
          if (chase) {
            chase.escortStall = g.x === beforeX && g.y === beforeY ? chase.escortStall + dt : 0;
            if (chase.escortStall >= ESCORT_STALL_SECONDS) d.path = [];
          }
        }
        if (g.phase === 'approach' && job && chase) {
          this.tryCapture(d, job, chase);
          continue;
        }
        if (!d.path.length) {
          if(g.phase==='transit') {
            const door=hallLinks(g.hall as HallId).find(link=>link.target===d.transfer)!.door;
            g.facing=door.facing==='up'?'down':'up';this.phase(d,'door');
          } else if(g.phase==='enter') {
            d.transfer=undefined;d.remaining=3;
            if(d.job){const player=this.state.players.get(d.job.id);if(player&&player.hall!==g.hall)this.transfer(d,player.hall as HallId);else this.approach(d);}else this.nextVisit(d);
          } else if (g.phase === 'approach') {
            if (!this.contactReached(g, this.state.players.get(d.job!.id)!)) { this.release(d); continue; }
            g.facing = 'down'; this.phase(d, d.job!.decision.kind === 'warning' ? 'warn' : 'grab');
            g.speech = d.job!.decision.kind === 'warning' ? 'Первое предупреждение!\nЕщё раз в течение суток: выход на 10 минут.' : 'Пора проветриться.';
          } else if (g.phase === 'patrol') { this.settle(d); }
          else if (g.phase === 'carry') { this.phase(d, 'throw'); g.facing = 'down'; g.speech = d.job?.decision.reason==='collision'?'Больше не толкайся.':'Соблюдай правила чата.'; }
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
            this.release(d, false);
          }
        }
      } else if(g.phase==='idle'&&d.elapsed>=1.2)this.nextVisit(d);
      else if(['chat','window','inspect','watch'].includes(g.phase))this.leisure(d);
    }
  }
}
