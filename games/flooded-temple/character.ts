import type {TempleBeat} from './presentation';

export const templePoses=['idle','observe','brace','discover','celebrate','reflect'] as const;
export type TemplePose=typeof templePoses[number];
export type TempleReaction={clip:string;pose:TemplePose;energy:number;look:number};
/** Presentation only. A gesture never chooses a route or predicts a server result. */
export function templeReaction(beat:TempleBeat|undefined,waiting=false,rope=false,selected=false,idle=0):TempleReaction{
  const make=(clip:string,pose:TemplePose,energy=0,look=0):TempleReaction=>({clip,pose,energy,look});
  if(beat)switch(beat.kind){
    case 'card':case 'expedition':return make('survey','observe',.25,-1);
    case 'travel':case 'arrive':return make('follow','observe',.2,-1);
    case 'collect':return make('treasure','discover',.42,-.4);
    case 'lever':case 'gate':return make('gate','brace',.65,-1);
    case 'rope':return make('rope','brace',.9,-.8);
    case 'relic':return make('relic','discover',.85,-.25);
    case 'outcome':case 'summary':
      if(beat.outcome==='big')return make('triumph','celebrate',1);
      if(beat.outcome==='win')return make('success','celebrate',.55);
      if(beat.outcome==='loss'||beat.outcome==='partial')return make('reflect','reflect',.25);
      return make('settle','idle',.15);
  }
  if(waiting)return make('waiting','observe',.1,-.7);
  if(rope)return make('prepare-rope','brace',.25,-.8);
  if(selected)return make('inspect','observe',.15,-1);
  if(idle===1)return make('glance','observe',.12,-.7);
  return make(idle===2?'rest':'breathe','idle',idle===2?.18:0);
}
