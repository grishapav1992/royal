import type {FightPlan} from './JackieFightPlans';

const ACTIONS={
  guard:{phase:'forearm-block',atlas:'combat',pose:6,kind:'block',actor:'foe'},
  slip:{phase:'slip-counter',atlas:'combat',pose:7,kind:'whoosh',actor:'foe'},
  duck:{phase:'low-evade',atlas:'base',pose:1,kind:'whoosh',actor:'foe'},
  jab:{phase:'opening-punch',atlas:'base',pose:3,kind:'punch',actor:'hero'},
  palm:{phase:'opening-palm',atlas:'combat',pose:1,kind:'punch',actor:'hero'},
  elbow:{phase:'opening-elbow',atlas:'combat',pose:4,kind:'punch',actor:'hero'},
  backfist:{phase:'opening-backfist',atlas:'combat',pose:0,kind:'punch',actor:'hero'},
}as const;
type Action=keyof typeof ACTIONS;
const OPENINGS:Record<Exclude<FightPlan['id'],'furniture'|'chair-counter'>,readonly [Action,Action,Action]>={
  boxing:['jab','guard','backfist'],counter:['slip','palm','guard'],'high-kick':['duck','jab','guard'],
  straight:['guard','jab','slip'],'table-run':['guard','elbow','duck'],'stool-step':['jab','slip','palm'],
  'backfist-chain':['backfist','guard','palm'],'palm-counter':['guard','palm','slip'],
  'low-sweep':['slip','elbow','guard'],'flying-knee':['duck','palm','slip'],
  'elbow-lock':['guard','elbow','backfist'],'turning-heel':['slip','backfist','palm'],
};
export function openingActions(plan:FightPlan,fighter:number){
  if(plan.moves[fighter]==='chair')return [ACTIONS.guard,ACTIONS.guard,ACTIONS.guard]as const;
  const actions=plan.id==='furniture'||plan.id==='chair-counter'?OPENINGS.straight:OPENINGS[plan.id];
  return actions.map((_,index)=>ACTIONS[actions[(index+fighter)%3]]);
}
