import { AmbientGuests as Routine } from '../src/shared/ambientGuests';
import { Guest, type LobbyState } from './state';

export class AmbientGuests {
  private routine=new Routine();
  private elapsed=0;
  constructor(private state:LobbyState){this.publish();}
  private publish(){
    for(const view of this.routine.snapshot()) {
      let guest=this.state.guests.get(view.id);
      if(!guest){guest=new Guest();this.state.guests.set(view.id,guest);Object.assign(guest,view);continue;}
      // Fixed fields avoid enumerating and assigning every schema property at each publication.
      if(guest.id!==view.id)guest.id=view.id;
      if(guest.name!==view.name)guest.name=view.name;
      if(guest.hall!==view.hall)guest.hall=view.hall;
      if(guest.x!==view.x)guest.x=view.x;
      if(guest.y!==view.y)guest.y=view.y;
      if(guest.skin!==view.skin)guest.skin=view.skin;
      if(guest.facing!==view.facing)guest.facing=view.facing;
      if(guest.moving!==view.moving)guest.moving=view.moving;
      if(guest.mood!==view.mood)guest.mood=view.mood;
      if(guest.drink!==view.drink)guest.drink=view.drink;
      if(guest.seat!==view.seat)guest.seat=view.seat;
      if(guest.destination!==view.destination)guest.destination=view.destination;
    }
  }
  tick(delta:number){
    this.routine.setOccupiedCabinets([...this.state.players.values()].map(player=>player.cabinet));
    this.routine.tick(delta);this.elapsed+=delta;if(this.elapsed>=.1){this.elapsed%=.1;this.publish();}
  }
}
