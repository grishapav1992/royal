export const REAR_WINDOW = { width:196,height:206,glass:{x:20,y:18,w:156,h:164},rowPitch:240 } as const;
export type RearWindow = {id:string;x:number;y:number;row:number;column:number;kind:number};

/** Decorative bays follow the available wall height, independently of playable floors. */
export function rearWindowLayout(wall:{left:number;right:number;base:number},roofEdge:number):RearWindow[]{
  const count=Math.max(1,Math.floor((wall.right-wall.left-80)/(REAR_WINDOW.width+80))),windows:RearWindow[]=[];
  const pitch=count>1?(wall.right-wall.left-160-REAR_WINDOW.width)/(count-1):0;
  for(let row=0,y=roofEdge+58;y+REAR_WINDOW.height<=wall.base-350;y+=REAR_WINDOW.rowPitch,row++){
    for(let column=0;column<count;column++)windows.push({id:`rear-window-${row}-${column}`,x:wall.left+80+column*pitch,y,row,column,kind:(row+column)%3});
  }
  return windows;
}

/** Local window scenes pause when hidden and never catch up after a background gap. */
export class RearWindowLife {
  time=0;
  motion=false;
  advance(delta:number,visible:boolean,reducedMotion:boolean,hidden=false){
    this.motion=visible&&!reducedMotion&&!hidden;
    if(this.motion&&Number.isFinite(delta))this.time+=Math.max(0,Math.min(50,delta));
  }
  person(window:RearWindow,index:number){
    const seed=window.row*17+window.column*7+index*11,speed=28+seed%5*4;
    const half=(REAR_WINDOW.glass.w/2+30)/speed*1000,rest=1100+seed%4*380;
    const durations=[half,rest,half,700,half,rest*.8,half,900],cycle=durations.reduce((a,b)=>a+b,0);
    let phase=(this.time+seed*953+index*cycle*.47)%cycle;
    const stops=[-30,REAR_WINDOW.glass.w/2,REAR_WINDOW.glass.w+30,REAR_WINDOW.glass.w/2,-30];
    let segment=0;
    for(let part=0;part<durations.length;part++){
      const duration=durations[part],walking=part%2===0;
      if(phase<duration||part===durations.length-1){
        const from=stops[segment],to=stops[segment+1],x=walking?from+(to-from)*phase/duration:to;
        const facing=walking?(to>from?'right':'left'):'down';
        return {id:window.id+'-guest-'+index,windowId:window.id,x:window.x+REAR_WINDOW.glass.x+x,y:window.y+REAR_WINDOW.glass.y+REAR_WINDOW.glass.h-9-index*12,skin:7+seed%6,scale:index?.46:.54,facing,moving:this.motion&&walking,speed} as const;
      }
      phase-=duration;if(!walking)segment++;
    }
    throw Error('Window visitor has no route segment');
  }
}
