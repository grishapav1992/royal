import { CatRoutine, type CatPerson } from '../src/shared/cat';
import type { HallId } from '../src/shared/world';
import type { LobbyState } from './state';

export class RoomCat {
  private routine = new CatRoutine();
  constructor(private state: LobbyState) { this.publish(); }
  private person(id: string): CatPerson | undefined {
    const p = this.state.players.get(id);
    return p ? { id, x: p.x, y: p.y, hall: p.hall as HallId, connected: p.connected, playing: p.playing, cabinet:p.cabinet, security: p.security, seat: p.seat, activity:p.activity, action:p.action } : undefined;
  }
  isHugging(id: string) { return this.state.cat.carriedBy === id; }
  private publish() { Object.assign(this.state.cat, this.routine.snapshot()); }
  handle(id: string, value: unknown) {
    const person = this.person(id);
    if (!person) return '';
    const message = this.routine.interact(value, person); this.publish(); return message;
  }
  tick(delta: number) {
    const people: CatPerson[] = [];
    for (const id of this.state.players.keys()) { const p = this.person(id); if (p) people.push(p); }
    this.routine.tick(delta, people); this.publish();
  }
}
