import { MiraRoutine } from '../src/shared/miraRoutine';
import { type LobbyState } from './state';

export class Bartender {
  private routine = new MiraRoutine();
  constructor(private state: LobbyState) { Object.assign(state.mira, this.routine.state); }
  tick(dt: number) {
    let serving = false, chatting = false;
    for (const player of this.state.players.values()) {
      if (player.connected && player.hall === 'arcade' && player.action === 'drink') { serving = true; break; }
    }
    for (const guard of this.state.guards.values()) {
      if (guard.hall === 'arcade' && guard.phase === 'chat') { chatting = true; break; }
    }
    this.routine.tick(dt, serving, chatting);
    const view = this.routine.state, mira = this.state.mira;
    if (mira.x !== view.x) mira.x = view.x;
    if (mira.y !== view.y) mira.y = view.y;
    if (mira.facing !== view.facing) mira.facing = view.facing;
    if (mira.action !== view.action) mira.action = view.action;
    if (mira.progress !== view.progress) mira.progress = view.progress;
  }
}
