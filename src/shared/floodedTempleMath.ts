import table from './floodedTempleData.json';

function freeze<T>(value:T):T { if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value; }
export const TEMPLE_DATA=freeze(table);
export const TEMPLE_GAME='studio-flooded-temple' as const;
export const TEMPLE_MAX_WIN=table.maxWin;
export type TempleEdge={a:number;b:number;kind:'open'|'gate'|'gap'};
export type TempleMap={id:string;cols:5;rows:4;entry:5;edges:TempleEdge[];treasures:Record<string,number>;levers:Record<string,string>;relics:number[]};
export type TempleBaseCase={layout:number;pattern:number;tier:number;relic:boolean};
export type TempleBonusCase={layout:number;tier:number};
export type TempleAction={kind:'step'|'rope';to:number}|{kind:'finish'};
export type TempleVisit={room:number;path:number[];awardUnits:string;openedGate:string|null;relic:boolean};
export type TempleBaseResult={visited:number[];opened:string[];events:TempleVisit[];payoutUnits:string;bonus:boolean;capped:boolean};
export type TempleBonusState={at:number;left:number;ropeAvailable:boolean;bridge:string|null;visited:number[];opened:string[];payoutUnits:string;done:boolean;capped:boolean};
export const templeEdgeKey=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
export const templeAdjacent=(a:number,b:number)=>Number.isInteger(a)&&Number.isInteger(b)&&a>=0&&b>=0&&a<20&&b<20&&Math.abs(a%5-b%5)+Math.abs(Math.floor(a/5)-Math.floor(b/5))===1;
const index=(n:number,length:number)=>Number.isSafeInteger(n)&&n>=0&&n<length;
export function validTempleBaseCase(value:unknown):value is TempleBaseCase {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as TempleBaseCase;
  return Object.keys(v).sort().join(',')==='layout,pattern,relic,tier'&&index(v.layout,table.baseLayouts.length)&&index(v.pattern,table.basePattern.length)&&index(v.tier,table.baseTiers.length)&&typeof v.relic==='boolean';
}
export function validTempleBonusCase(value:unknown):value is TempleBonusCase {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as TempleBonusCase;
  return Object.keys(v).sort().join(',')==='layout,tier'&&index(v.layout,table.bonusLayouts.length)&&index(v.tier,table.bonusTiers.length);
}
export function validTempleMathAction(value:unknown):value is TempleAction {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const v=value as TempleAction;
  return v.kind==='finish'?Object.keys(v).join(',')==='kind':(v.kind==='step'||v.kind==='rope')&&Object.keys(v).sort().join(',')==='kind,to'&&index(v.to,20);
}
export function validateTempleMap(map:TempleMap):void {
  if(map.cols!==5||map.rows!==4||map.entry!==5||map.edges.length>31)throw Error('Invalid temple geometry');
  const edges=new Set<string>(),occupied=new Set<number>([5]);
  for(const e of map.edges){const key=templeEdgeKey(e.a,e.b);if(!templeAdjacent(e.a,e.b)||!['open','gate','gap'].includes(e.kind)||edges.has(key))throw Error('Invalid temple edge');edges.add(key);}
  const occupy=(room:number)=>{if(!index(room,20)||occupied.has(room))throw Error('Invalid temple room content');occupied.add(room);};
  for(const [id,cents]of Object.entries(map.treasures)){occupy(Number(id));if(!Number.isSafeInteger(cents)||cents<=0||cents>50000)throw Error('Invalid temple treasure');}
  for(const [id,key]of Object.entries(map.levers)){occupy(Number(id));if(!map.edges.some(e=>e.kind==='gate'&&templeEdgeKey(e.a,e.b)===key))throw Error('Invalid temple lever');}
  for(const id of map.relics)occupy(id);
}
const shell=(id:string):TempleMap=>({id,cols:5,rows:4,entry:5,edges:[],treasures:{},levers:{},relics:[]});
export function templeBaseMap(selection:TempleBaseCase):TempleMap {
  if(!validTempleBaseCase(selection))throw Error('Invalid temple base case');
  const source=table.baseLayouts[selection.layout],map=shell(`base-${source.id}-${selection.pattern}-${selection.tier}-${Number(selection.relic)}`);
  const gate=templeEdgeKey(...source.gate as [number,number]);
  const pairs=[...source.path.slice(1).map((to,i)=>[source.path[i],to]),...source.extra];
  map.edges=pairs.map(([a,b])=>({a,b,kind:templeEdgeKey(a,b)===gate?'gate':'open'}));
  map.edges.push({a:source.gap[0],b:source.gap[1],kind:'gap'});
  map.levers[source.lever]=gate;map.relics=[selection.relic?source.relic:4];
  let cursor=0;
  for(let room=0;room<20;room++){
    if(room===5||room===source.lever||map.relics.includes(room))continue;
    const cents=table.basePattern[(cursor+++selection.pattern)%table.basePattern.length]*table.baseTiers[selection.tier].scale;
    if(cents)map.treasures[room]=cents;
  }
  validateTempleMap(map);return map;
}
export function templeBonusMap(selection:TempleBonusCase):TempleMap {
  if(!validTempleBonusCase(selection))throw Error('Invalid temple bonus case');
  const source=table.bonusLayouts[selection.layout],tier=table.bonusTiers[selection.tier],map=shell(`bonus-${source.id}-${selection.tier}`);
  map.edges=[...source.open,...('extraOpen'in source?source.extraOpen??[]:[])].map(([a,b])=>({a,b,kind:'open'}));
  map.edges.push({a:source.gate[0],b:source.gate[1],kind:'gate'},{a:source.gap[0],b:source.gap[1],kind:'gap'});
  map.levers[source.lever]=templeEdgeKey(source.gate[0],source.gate[1]);
  for(const [room,cents]of Object.entries(source.treasures)){if(cents!==undefined)map.treasures[room]=cents*tier.numerator/tier.denominator;}
  validateTempleMap(map);return map;
}
const award=(stake:string,cents:number)=>BigInt(stake)*BigInt(cents)/100n;
function neighbours(map:TempleMap,from:number,opened:ReadonlySet<string>):number[] {
  return map.edges.flatMap(e=>e.kind==='open'||opened.has(templeEdgeKey(e.a,e.b))?e.a===from?[e.b]:e.b===from?[e.a]:[]:[]).sort((a,b)=>a-b);
}
function routes(map:TempleMap,from:number,opened:ReadonlySet<string>):Map<number,number[]> {
  const paths=new Map<number,number[]>([[from,[from]]]),queue=[from];
  for(const room of queue)for(const to of neighbours(map,room,opened))if(!paths.has(to)){paths.set(to,[...paths.get(room)!,to]);queue.push(to);}
  return paths;
}
export function exploreTempleBase(map:TempleMap,stake:string):TempleBaseResult {
  validateTempleMap(map);
  const visited=new Set<number>(),opened=new Set<string>(),events:TempleVisit[]=[];
  const cap=BigInt(stake)*BigInt(TEMPLE_MAX_WIN);let total=0n,at=map.entry as number,bonus=false;
  while(total<cap){
    const reachable=routes(map,map.entry,opened);
    const next=[...reachable.keys()].filter(id=>!visited.has(id)).sort((a,b)=>reachable.get(a)!.length-reachable.get(b)!.length||a-b)[0];
    if(next===undefined)break;
    const path=routes(map,at,opened).get(next)!;
    visited.add(next);at=next;
    const value=award(stake,map.treasures[next]??0),paid=value>cap-total?cap-total:value;
    total+=paid;
    const gate=map.levers[next],openedGate=gate&&!opened.has(gate)?gate:null;
    if(openedGate)opened.add(openedGate);
    const relic=map.relics.includes(next);bonus=bonus||relic;
    events.push({room:next,path,awardUnits:String(paid),openedGate,relic});
  }
  return {visited:[...visited],opened:[...opened],events,payoutUnits:String(total),bonus:bonus&&total<cap,capped:total===cap};
}
export function templeLegalActions(map:TempleMap,state:TempleBonusState):TempleAction[] {
  if(state.done||state.left===0)return [];
  const actions:TempleAction[]=[];
  for(const e of map.edges){
    const to=e.a===state.at?e.b:e.b===state.at?e.a:null;if(to===null)continue;
    const key=templeEdgeKey(e.a,e.b);
    if(e.kind==='open'||state.opened.includes(key)||state.bridge===key)actions.push({kind:'step',to});
    else if(e.kind==='gap'&&state.ropeAvailable)actions.push({kind:'rope',to});
  }
  return actions.sort((a,b)=>('to'in a?a.to:0)-('to'in b?b.to:0));
}
export function startTempleBonus(map:TempleMap):TempleBonusState {
  validateTempleMap(map);if(map.relics.length)throw Error('Temple bonus cannot retrigger');
  const state:TempleBonusState={at:5,left:6,ropeAvailable:true,bridge:null,visited:[5],opened:[],payoutUnits:'0',done:false,capped:false};
  state.done=!templeLegalActions(map,state).length;return state;
}
export function applyTempleAction(map:TempleMap,state:TempleBonusState,action:TempleAction,stake:string,baseUnits:string):TempleBonusState {
  if(!validTempleMathAction(action)||state.done)throw Error('Illegal temple action');
  const next=structuredClone(state);
  if(action.kind==='finish'){next.done=true;return next;}
  if(!templeLegalActions(map,state).some(a=>a.kind===action.kind&&'to'in a&&a.to===action.to))throw Error('Illegal temple action');
  next.at=action.to;next.left--;
  if(action.kind==='rope'){next.ropeAvailable=false;next.bridge=templeEdgeKey(state.at,action.to);}
  if(!next.visited.includes(action.to)){
    next.visited.push(action.to);
    const remaining=BigInt(stake)*BigInt(TEMPLE_MAX_WIN)-BigInt(baseUnits)-BigInt(next.payoutUnits);
    const value=award(stake,map.treasures[action.to]??0);
    const paid=value>remaining?remaining:value;
    if(paid<0n)throw Error('Invalid temple reserve');
    next.payoutUnits=String(BigInt(next.payoutUnits)+paid);
    const gate=map.levers[action.to];if(gate&&!next.opened.includes(gate))next.opened.push(gate);
  }
  next.capped=BigInt(baseUnits)+BigInt(next.payoutUnits)===BigInt(stake)*BigInt(TEMPLE_MAX_WIN);
  next.done=next.capped||next.left===0||templeLegalActions(map,next).length===0;
  return next;
}
export function templeWeightedIndex(weights:readonly number[],draw:(max:number)=>number):number {
  const total=weights.reduce((sum,n)=>{if(!Number.isSafeInteger(n)||n<=0)throw Error('Invalid temple weight');return sum+n;},0);
  if(!Number.isSafeInteger(total)||total>=281474976710656)throw Error('Invalid temple entropy bound');
  let ticket=draw(total);if(!Number.isSafeInteger(ticket)||ticket<0||ticket>=total)throw Error('Invalid temple entropy');
  for(let i=0;i<weights.length;i++){if(ticket<weights[i])return i;ticket-=weights[i];}
  throw Error('Invalid temple selection');
}
export const templeAllBaseCases=():TempleBaseCase[]=>table.baseLayouts.flatMap((_,layout)=>table.basePattern.flatMap((_,pattern)=>table.baseTiers.flatMap((_,tier)=>[false,true].map(relic=>({layout,pattern,tier,relic})))));
export const templeAllBonusCases=():TempleBonusCase[]=>table.bonusLayouts.flatMap((_,layout)=>table.bonusTiers.map((_,tier)=>({layout,tier})));
