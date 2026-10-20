import { CAT_HOME } from './catHome';
import { CAT_CARE } from './catCare';
import { hallLinks, hallObstacles, HALLS, type HallId } from './world';
import { findPath, walkable, type Point } from '../game/navigation';
import { movementFacing, type Facing } from './movement';
import { catSurface, canCatUseSurface, type CatSurface } from './catSurfaces';
import { CABINETS } from './cabinets';
import { cabinetSeat } from './cabinetSeating';

export const CAT_ACTIONS = ['pet', 'feed', 'call', 'hug', 'release'] as const;
export type CatAction = typeof CAT_ACTIONS[number];
export type CatMood = 'sleeping' | 'belly-up' | 'walking' | 'resting' | 'perched' | 'purring' | 'scratching' | 'stretching' | 'petting' | 'eating' | 'eating-bowl' | 'carried' | 'drinking' | 'jumping';
export type CatView = Point & { hall: HallId; facing: Facing; mood: CatMood; moving: boolean; onPillow: boolean; onBar: boolean; surfaceId:string; jumpingDown:boolean; carriedBy: string; targetId: string; progress: number; hugCooldown: number };
export type CatPerson = Point & { id: string; hall: HallId; connected?: boolean; playing?: boolean; cabinet?:string; security?: string; seat?: string; activity?: string; action?: string };
type Destination = Point & { hall: HallId; mood?: CatMood; home?: boolean; bar?: boolean; surface?:string; visitorId?:string };

export function catApproachPoint(cat: CatView): Point {
  return catSurface(cat.surfaceId)?.approach ?? (cat.onPillow ? CAT_HOME.approach : cat.onBar ? CAT_CARE.bar.approach : cat);
}

export const CAT_HEARING_DISTANCE = 200;
export function canHearCat(cat: Pick<CatView, 'hall' | 'x' | 'y'>, listener: Point & { hall: HallId }): boolean {
  return cat.hall === listener.hall && Math.hypot(cat.x - listener.x, cat.y - listener.y) <= CAT_HEARING_DISTANCE;
}

function surfaceDestination(id:string):Destination {
  const surface=catSurface(id)!;
  return {hall:surface.hall,...surface.approach,surface:id};
}

const TOUR: Destination[] = [
  { hall: CAT_CARE.hall, ...CAT_CARE.food.approach, mood: 'eating-bowl' },
  { hall: CAT_CARE.hall, ...CAT_CARE.scratcher.approach, mood: 'scratching' },
  surfaceDestination('cabinet:variant-target-plinko'),
  { hall: 'arcade', x: 2240, y: 700 },
  { hall: CAT_CARE.hall, ...CAT_CARE.bar.approach, bar: true },
  { hall: 'tables', x: 1480, y: 1140 },
  surfaceDestination('sofa:5'),
  surfaceDestination('reading-table'),
  { hall: 'tables', x: 1040, y: 700 },
  { hall: 'github', x: 710, y: 900 },
  surfaceDestination('sofa:6'),
  surfaceDestination('coffee-table:7'),
  { hall: 'github', x: 480, y: 520 },
  { hall: CAT_HOME.hall, ...CAT_HOME.approach, home: true },
];

/** One harmless cat, simulated by the server or by the offline room, never by both. */
export class CatRoutine {
  private view: CatView = { hall: CAT_HOME.hall, ...CAT_HOME.pillow, facing: 'down', mood: 'sleeping', moving: false, onPillow: true, onBar: false, surfaceId:'pillow', jumpingDown:false, carriedBy: '', targetId: '', progress: 0, hugCooldown: 0 };
  private path: Point[] = [];
  private destination?: Destination;
  private transition?: ReturnType<typeof hallLinks>[number];
  private jumpFrom?: Point;
  private jumpLanding?: Point;
  private pillowPhase = 0;
  private remaining = 18;
  private duration = 18;
  private tour = 0;
  private seed = 7193;
  private now = 0;
  private callsAt = -10;
  private hugAvailableAt = 0;
  private hugOrigin?: Point & { hall: HallId };
  private hugAnchor?: Point & { hall: HallId };
  private hugDestination?: Destination;
  private interactions = new Map<string, number>();
  private people:readonly CatPerson[]=[];
  private nextVisitAt=0;
  private visitsThisTour=0;
  private visitedPlayers=new Map<string,number>();
  snapshot(): CatView { return { ...this.view, hugCooldown: Math.ceil(Math.max(0,this.hugAvailableAt-this.now)) }; }
  private random() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 0x100000000; }
  private pause(mood: CatMood, seconds: number) {
    this.path = []; this.transition = undefined;
    this.view.mood = mood; this.view.moving = false; this.view.progress = 0;
    this.duration = seconds; this.remaining = seconds;
  }
  private floorPoint(person: Point & { hall: HallId }): Point {
    const obstacles = hallObstacles(person.hall);
    for (const radius of [28, 48, 80, 120]) for (let i = 0; i < 8; i++) {
      const p = { x: person.x + Math.cos(i * Math.PI / 4) * radius, y: person.y + Math.sin(i * Math.PI / 4) * radius };
      if (walkable(p.x, p.y, obstacles, 18)) return p;
    }
    return { ...HALLS[person.hall].spawn };
  }
  private jump(id:string) {
    const down=id==='floor',surface=catSurface(down?this.view.surfaceId:id);
    if(!surface)return false;
    if(!down&&!canCatUseSurface(surface,this.people))return false;
    this.jumpFrom = { x: this.view.x, y: this.view.y };
    this.jumpLanding = down ? surface.approach : surface.perch;
    this.view.surfaceId=surface.id;this.view.jumpingDown=down;
    this.view.onPillow = !down&&id==='pillow'; this.view.onBar = !down&&id==='bar';
    this.view.facing=movementFacing(this.jumpLanding.x-this.view.x,this.jumpLanding.y-this.view.y,this.view.facing);
    this.pause('jumping', id==='bar'?1.4:surface.kind==='pillow'?.9:1.1+surface.height/400);
    return true;
  }
  private route(destination: Destination): boolean {
    this.destination = destination;
    this.transition = undefined;
    let point: Point = destination;
    if (destination.hall !== this.view.hall) {
      const links = hallLinks(this.view.hall);
      this.transition = links.find(link => link.target === destination.hall) ?? links[0];
      point = this.transition.door.entry;
    }
    this.path = findPath(this.view, point, hallObstacles(this.view.hall));
    if (!this.path.length) { this.transition = undefined; this.pause('resting', 3); return false; }
    this.view.mood = 'walking'; this.view.moving = true; this.view.progress = 0;
    return true;
  }
  private visitorStillPlaying(destination:Destination) {
    return this.people.some(person=>person.id===destination.visitorId&&person.connected!==false&&!person.security&&person.playing&&person.hall===destination.hall&&'cabinet:'+person.cabinet===destination.surface);
  }
  private chooseVisit():Destination|undefined {
    if(this.now<this.nextVisitAt||this.visitsThisTour>=2||TOUR[this.tour%TOUR.length].home)return;
    const candidates=this.people.filter(person=>person.connected!==false&&!person.security&&person.playing&&person.cabinet)
      .map(person=>({person,surface:catSurface('cabinet:'+person.cabinet),cabinet:CABINETS.find(c=>c.id===person.cabinet)}))
      .filter((entry):entry is typeof entry&{surface:CatSurface;cabinet:typeof CABINETS[number]}=>Boolean(entry.surface&&entry.cabinet&&entry.surface.hall===entry.person.hall&&Math.hypot(entry.person.x-cabinetSeat(entry.cabinet).x,entry.person.y-cabinetSeat(entry.cabinet).y)<110&&canCatUseSurface(entry.surface,this.people)))
      .sort((a,b)=>(this.visitedPlayers.get(a.person.id)??-Infinity)-(this.visitedPlayers.get(b.person.id)??-Infinity)||Number(b.person.hall===this.view.hall)-Number(a.person.hall===this.view.hall)||Math.hypot(a.surface.approach.x-this.view.x,a.surface.approach.y-this.view.y)-Math.hypot(b.surface.approach.x-this.view.x,b.surface.approach.y-this.view.y)||a.person.id.localeCompare(b.person.id));
    const selected=candidates[0];if(!selected)return;
    this.nextVisitAt=this.now+70;this.visitsThisTour++;this.visitedPlayers.set(selected.person.id,this.now);
    return {...surfaceDestination(selected.surface.id),visitorId:selected.person.id};
  }
  private resume() {
    const visit=this.chooseVisit(),destination=visit??TOUR[this.tour++ % TOUR.length];
    this.view.targetId=visit?.visitorId??'';
    if (this.view.surfaceId) { this.destination = destination; this.jump('floor'); }
    else this.route(destination);
  }
  private release() {
    const anchor = this.hugOrigin ?? this.view;
    this.view.hall = anchor.hall;
    Object.assign(this.view, walkable(anchor.x,anchor.y,hallObstacles(anchor.hall),18) ? anchor : this.floorPoint(anchor));
    this.view.carriedBy = ''; this.view.targetId = ''; this.view.onPillow = false; this.view.onBar = false;this.view.surfaceId='';this.view.jumpingDown=false;
    this.hugAvailableAt = this.now + 20 + this.random()*10;
    this.view.facing = 'right';
    this.pause('stretching', 2);
  }
  interact(action: unknown, person: CatPerson): string {
    if (!CAT_ACTIONS.includes(action as CatAction)) return '';
    if (action === 'release') {
      if (this.view.carriedBy !== person.id) return 'Сейчас Кошка не у тебя на руках.';
      this.release(); return 'Звэрочка мягко спрыгнула рядом и потягивается.';
    }
    if (person.connected === false || person.playing || person.security || person.seat || person.activity || person.action==='drink') return '';
    if ((this.interactions.get(person.id) ?? -10) + 1 > this.now) return '';
    this.interactions.set(person.id, this.now);
    if (this.view.carriedBy) return this.view.carriedBy === person.id ? 'Звэрочка устроилась у тебя на руках.' : 'Кошка сейчас на руках у другого игрока.';
    if (this.view.hall !== person.hall) return 'Кошка сейчас в другом зале.';
    if (action === 'call') {
      if (this.callsAt + 5 > this.now) return 'Кошка тебя услышала. Дай ей немного времени.';
      this.callsAt = this.now;
      if (this.view.onPillow && this.random() < .8) return 'Звэрочка сонно шевельнула ушком и осталась на подушке.';
      if (['eating', 'eating-bowl', 'drinking', 'purring', 'scratching', 'petting', 'jumping', 'stretching'].includes(this.view.mood)) return 'Кошка сейчас занята, скоро освободится.';
      if (this.random() < (this.now < this.hugAvailableAt ? .75 : .2)) return 'Звэрочка услышала тебя, но пока решила заняться своими делами.';
      this.view.targetId = person.id;
      const destination = { hall: person.hall, ...this.floorPoint(person) };
      if (this.view.surfaceId) { this.destination = destination; this.jump('floor'); }
      else if (!this.route(destination)) return 'Кошка смотрит на тебя. Подойди чуть ближе.';
      return 'Кошка услышала зов и идёт к тебе.';
    }
    const anchor = catApproachPoint(this.view);
    if (Math.hypot(person.x - anchor.x, person.y - anchor.y) > 100) return 'Подойди к Кошке поближе.';
    if (this.view.surfaceId && action !== 'pet') return 'На своём месте Кошку можно только нежно погладить. Пусть отдыхает.';
    if (['eating', 'eating-bowl', 'drinking', 'scratching', 'petting', 'jumping', 'stretching'].includes(this.view.mood)) return 'Дай Звэрочке закончить, она рядом.';
    if (action === 'hug' && this.now < this.hugAvailableAt) return 'Звэрочка пока занимается своими делами. Обнять её можно чуть позже.';
    this.view.targetId = person.id;
    if (action === 'hug') {
      if (this.view.surfaceId || !['walking','resting'].includes(this.view.mood)) return 'Обнять Кошку можно, когда она гуляет или спокойно сидит на полу.';
      this.hugOrigin = {hall:this.view.hall,x:this.view.x,y:this.view.y};
      this.hugAnchor = {hall:person.hall,x:person.x,y:person.y};
      this.hugDestination = this.destination;
      this.view.carriedBy = person.id; this.view.onPillow = false; this.view.onBar = false;
      this.view.hall = person.hall; this.view.x = person.x; this.view.y = person.y;
      this.pause('carried', 5 + this.random() * 2);
      return 'Звэрочка прижалась к груди и урчит. Можно отпустить её кнопкой или Esc.';
    }
    this.pause(action === 'feed' ? 'eating' : 'petting', action === 'feed' ? 5 : 4);
    return action === 'feed' ? 'Кошка берёт угощение с твоей ладони.' : 'Мр-р-р... Звэрочка прижалась к твоей ладони.';
  }
  tick(delta: number, people: readonly CatPerson[] = []) {
    this.people=people;
    let left = Math.max(0, Math.min(delta, .25));
    while (left > .00001) { const dt = Math.min(left, .05); this.step(dt, people); left -= dt; }
  }
  private step(dt: number, people: readonly CatPerson[]) {
    this.now += dt;
    for (const [id, at] of this.interactions) if (this.now - at > 30) this.interactions.delete(id);
    for(const [id,at] of this.visitedPlayers)if(this.now-at>1800)this.visitedPlayers.delete(id);
    if (this.view.mood === 'carried') {
      const person = people.find(p => p.id === this.view.carriedBy);
      const anchor=this.hugAnchor!;
      if (!person || person.connected === false || person.playing || person.security || person.seat || person.activity || person.action==='drink' || person.hall!==anchor.hall || Math.hypot(person.x-anchor.x,person.y-anchor.y)>2) { this.release(); return; }
      this.remaining -= dt; this.view.progress = 1 - this.remaining / this.duration;
      if (this.remaining <= 0) this.release();
      return;
    }
    if (this.view.mood === 'jumping') {
      this.remaining = Math.max(0, this.remaining - dt);
      this.view.progress = 1 - this.remaining / this.duration;
      const to = this.jumpLanding!;
      const progress=this.view.progress,smooth=progress*progress*(3-2*progress);
      this.view.x = this.jumpFrom!.x + (to.x - this.jumpFrom!.x) * smooth;
      this.view.y = this.jumpFrom!.y + (to.y - this.jumpFrom!.y) * smooth;
      if (!this.remaining) {
        if(this.view.jumpingDown) {
          this.view.surfaceId='';this.view.jumpingDown=false;
          if(this.destination)this.route(this.destination);else this.pause('resting',3);
        }
        else if (this.view.onPillow) { this.pillowPhase=0;this.visitsThisTour=0;this.pause('sleeping', 18 + this.random() * 10); }
        else if (this.view.onBar) { this.view.facing='right';this.pause('drinking', 10); }
        else if(this.view.surfaceId) {
          this.view.facing=catSurface(this.view.surfaceId)!.facing;
          this.pause(this.destination?.visitorId?'purring':'perched',16+this.random()*8);
        }
        else if (this.destination) this.route(this.destination);
        else this.pause('resting', 3);
      }
      return;
    }
    if(this.destination?.visitorId&&!this.visitorStillPlaying(this.destination)&&this.view.mood!=='stretching') {this.resume();return;}
    if (this.path.length) {
      let distance = 78 * dt;
      while (distance > 0 && this.path.length) {
        const point = this.path[0], dx = point.x - this.view.x, dy = point.y - this.view.y, length = Math.hypot(dx, dy);
        if (length < .001) { this.path.shift(); continue; }
        const step = Math.min(distance, length);
        const x = this.view.x + dx / length * step, y = this.view.y + dy / length * step;
        if (!walkable(x, y, hallObstacles(this.view.hall))) { this.pause('resting', 2); return; }
        this.view.x = x; this.view.y = y; this.view.facing = movementFacing(dx, dy, this.view.facing);
        distance -= step;
        if (step === length) this.path.shift();
      }
      if (!this.path.length) {
        if (this.transition) {
          const link = this.transition; this.view.hall = link.target;
          Object.assign(this.view, link.arrival.arrival); this.view.facing = link.arrival.facing;
          this.route(this.destination!);
        } else if (this.destination?.home) this.jump('pillow');
        else if (this.destination?.bar) this.jump('bar');
        else if(this.destination?.surface) {
          if(!this.jump(this.destination.surface))this.pause('resting',3);
        }
        else {
          if (this.destination?.mood === 'eating-bowl'||this.destination?.mood === 'scratching') this.view.facing='right';
          this.pause(this.destination?.mood ?? 'resting', this.view.targetId ? 8 : this.destination?.mood === 'eating-bowl' ? 10 : this.destination?.mood === 'scratching' ? 8+this.random()*4 : 5 + this.random() * 5);
        }
      }
      return;
    }
    this.remaining -= dt; this.view.progress = Math.min(1, Math.max(0, 1 - this.remaining / this.duration));
    if (this.remaining > 0) return;
    if (this.view.mood === 'stretching') {
      const destination=this.hugDestination;this.hugDestination=undefined;this.hugOrigin=undefined;this.hugAnchor=undefined;
      if (destination) this.route(destination); else this.resume();
      return;
    }
    if (this.view.onPillow) {
      this.view.targetId = '';
      if (this.view.mood === 'sleeping' && this.pillowPhase === 0) { this.pillowPhase=1;this.pause('belly-up',20 + this.random()*8); }
      else if (this.view.mood === 'belly-up') { this.pillowPhase=2;this.pause('sleeping',14 + this.random()*8); }
      else if (this.view.mood !== 'sleeping') this.pause('sleeping',18);
      else this.resume();
    } else this.resume();
  }
}
