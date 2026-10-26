import { AmbientGuests as Routine } from '../src/shared/ambientGuests';
import { Guest, type LobbyState } from './state';

export class AmbientGuests {
  private routine=new Routine();
  private elapsed=0;
  constructor(private state:LobbyState){this.publish();}
  private publish(){
    for(const view of this.routine.snapshot()) {
      let guest=this.state.guests.get(view.id);
      if(!guest){guest=new Guest();this.state.guests.set(view.id,guest);}
      Object.assign(guest,view);
    }
  }
  tick(delta:number){this.routine.tick(delta);this.elapsed+=delta;if(this.elapsed>=.1){this.elapsed%=.1;this.publish();}}
}
