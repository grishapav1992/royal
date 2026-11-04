import { MiraRoutine, type MiraAttention } from '../src/shared/miraRoutine';
import { atBar } from '../src/shared/world';
import { type LobbyState } from './state';

export class Bartender {
  private routine = new MiraRoutine();
  private attention = new Map<string,{phase:MiraAttention;expires:number}>();
  constructor(private state: LobbyState) { Object.assign(state.mira, this.routine.state); }
  attend(id:string,value:unknown,now=Date.now()) {
    const phase=(value as {phase?:unknown}|null)?.phase;
    if (phase==='closed') {this.attention.delete(id);return;}
    if (phase!=='greet'&&phase!=='listen'&&phase!=='speak') return;
    const p=this.state.players.get(id);
    if(!p?.connected||p.hall!=='arcade'||p.security||p.playing||!atBar(p)) {this.attention.delete(id);return;}
    this.attention.set(id,{phase,expires:now+5000});
  }
  forget(id:string) {this.attention.delete(id);}
  tick(dt: number) {
    const serving = [...this.state.players.values()].some(p => p.connected && p.hall === 'arcade' && p.action === 'drink');
    const chatting = [...this.state.guards.values()].some(guard => guard.hall === 'arcade' && guard.phase === 'chat');
    for(const [id,entry] of this.attention) {
      const p=this.state.players.get(id);
      if(entry.expires<Date.now()||!p?.connected||p.hall!=='arcade'||p.security||p.playing||!atBar(p))this.attention.delete(id);
    }
    const phases=[...this.attention.values()].map(entry=>entry.phase);
    const attention:MiraAttention=phases.includes('speak')?'speak':phases.includes('greet')?'greet':phases.includes('listen')?'listen':'closed';
    this.routine.tick(dt, serving, chatting,attention);
    Object.assign(this.state.mira, this.routine.state);
  }
}
