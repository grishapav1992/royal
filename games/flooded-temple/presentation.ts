import type {TempleView} from '../../src/shared/floodedTemple';
import type {TempleCue} from './TempleAudio';
export type TempleOutcome='loss'|'partial'|'return'|'win'|'big';
export type TempleVisual={mode:'base'|'bonus';at:number;visited:number[];opened:string[];bridge:string|null;route:number[];left:number|null;ropeAvailable:boolean;totalUnits:string;revealed:number};
export type TempleBeat={id:number;at:number;duration:number;kind:'card'|'travel'|'arrive'|'collect'|'lever'|'gate'|'rope'|'relic'|'expedition'|'outcome'|'summary';frame:TempleVisual;cue?:TempleCue;cueAtMs?:number;room?:number;edge?:string;from?:number;counterFrom?:string;awardUnits?:string;outcome?:TempleOutcome};
export type TemplePlan={key:string;beats:TempleBeat[];duration:number;final:TempleVisual;reduced:boolean};
export const templeOutcome=(stake:string,payout:string):TempleOutcome=>BigInt(payout)===0n?'loss':BigInt(payout)<BigInt(stake)?'partial':BigInt(payout)===BigInt(stake)?'return':BigInt(payout)>=BigInt(stake)*5n?'big':'win';
const outcomeCue=(kind:TempleOutcome):TempleCue=>kind==='loss'||kind==='partial'?'neutral':kind;
export function confirmedTempleFrame(view:TempleView):TempleVisual{
  const s=view.bonusState;
  return s?{mode:'bonus',at:s.at,visited:[...s.visited],opened:[...s.opened],bridge:s.bridge,route:[5,...view.history.flatMap(a=>'to'in a?[a.to]:[])],left:s.left,ropeAvailable:s.ropeAvailable,totalUnits:view.totalPayoutUnits,revealed:4}:{mode:'base',at:view.baseResult.events.at(-1)?.room??5,visited:[...view.baseResult.visited],opened:[...view.baseResult.opened],bridge:null,route:view.baseResult.events.flatMap(e=>e.path),left:null,ropeAvailable:false,totalUnits:view.totalPayoutUnits,revealed:4};
}
export function templePlan(key:string,view:TempleView,previous:TempleView|undefined,reduced=false):TemplePlan{
  const final=confirmedTempleFrame(view),beats:TempleBeat[]=[];let time=0;
  let frame:TempleVisual=previous?confirmedTempleFrame(previous):{mode:'base',at:5,visited:[],opened:[],bridge:null,route:[5],left:null,ropeAvailable:false,totalUnits:'0',revealed:0};
  const add=(kind:TempleBeat['kind'],duration:number,extra:Partial<Omit<TempleBeat,'kind'|'duration'|'id'|'at'|'frame'>>={})=>{beats.push({id:beats.length,at:time,duration,kind,frame:structuredClone(frame),...extra});time+=duration;};
  const outcome=templeOutcome(view.stakeUnits,view.totalPayoutUnits);
  if(reduced){frame=final;const last=view.history.at(-1);add('summary',180,{outcome:view.phase==='complete'?outcome:undefined,cue:view.phase==='complete'?outcomeCue(outcome):previous?(last?.kind==='rope'?'rope':BigInt(view.totalPayoutUnits)>BigInt(previous.totalPayoutUnits)?'chest':'step'):'relic'});return {key,beats,duration:time,final,reduced};}
  const travel=(to:number)=>{const from=frame.at;add('travel',200,{from,room:to});frame.at=to;frame.route.push(to);add('arrive',90,{room:to,cue:'step',cueAtMs:22});};
  const collect=(room:number,award:string)=>{const from=frame.totalUnits;frame.totalUnits=String(BigInt(from)+BigInt(award));add('collect',560,{room,cue:'chest',cueAtMs:120,counterFrom:from,awardUnits:award});};
  const gate=(room:number,edge:string)=>{add('lever',180,{room,edge});frame.opened.push(edge);add('gate',560,{room,edge,cue:'lever',cueAtMs:75});};
  if(!previous){
    for(let row=0;row<4;row++){frame.revealed=row+1;add('card',100,{room:row,cue:'stone',cueAtMs:72});}
    for(const event of view.baseResult.events){
      for(const to of event.path.slice(1))travel(to);
      if(!frame.visited.includes(event.room))frame.visited.push(event.room);
      if(BigInt(event.awardUnits)>0n)collect(event.room,event.awardUnits);
      if(event.openedGate)gate(event.room,event.openedGate);
      if(event.relic)add('relic',1200,{room:event.room,cue:'relic',cueAtMs:160});
    }
    if(view.bonusMap){frame=structuredClone(final);add('expedition',520);}
  }else{
    const action=view.history[previous.history.length];
    if(action&&'to'in action){
      if(action.kind==='rope'){frame.bridge=view.bonusState!.bridge;frame.ropeAvailable=false;add('rope',700,{room:action.to,edge:frame.bridge!,cue:'rope',cueAtMs:420});}
      travel(action.to);frame.left=view.bonusState!.left;frame.visited=[...view.bonusState!.visited];
      const award=String(BigInt(view.totalPayoutUnits)-BigInt(previous.totalPayoutUnits));
      if(BigInt(award)>0n)collect(action.to,award);
      const opened=view.bonusState!.opened.filter(e=>!previous.bonusState!.opened.includes(e));for(const edge of opened)gate(action.to,edge);
    }
  }
  frame=structuredClone(final);
  if(view.phase==='complete')add('outcome',{loss:600,partial:650,return:700,win:1500,big:2400}[outcome],{cue:outcomeCue(outcome),outcome});
  if(!beats.length)add('summary',100);
  return {key,beats,duration:time,final,reduced};
}
