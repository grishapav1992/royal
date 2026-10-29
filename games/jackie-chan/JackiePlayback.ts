export type FightSpeed=1|2;
/** The logical timeline stays continuous when playback speed changes. */
export class JackiePlayback {
  private anchor=-Infinity;
  private offset=0;
  speed:FightSpeed=1;
  elapsed(now:number){return this.offset+Math.max(0,now-this.anchor)*this.speed/1000;}
  start(now:number,offset=0){this.anchor=now;this.offset=offset;}
  setSpeed(speed:FightSpeed,now:number){const elapsed=this.elapsed(now);this.speed=speed;if(Number.isFinite(elapsed))this.start(now,elapsed);}
  settle(){this.anchor=-Infinity;this.offset=0;}
}
