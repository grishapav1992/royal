import { MiraRoutine } from '../src/shared/miraRoutine';
import { type LobbyState } from './state';

export class Bartender {
  private routine = new MiraRoutine();
  constructor(private state: LobbyState) { Object.assign(state.mira, this.routine.state); }
  tick(dt: number) {
    const serving = [...this.state.players.values()].some(p => p.connected && p.hall === 'arcade' && p.action === 'drink');
    const chatting = [...this.state.guards.values()].some(guard => guard.hall === 'arcade' && guard.phase === 'chat');
    this.routine.tick(dt, serving, chatting);
    Object.assign(this.state.mira, this.routine.state);
  }
}
