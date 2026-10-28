import {CASCADE_DATA,CASCADE_CAP_POINTS,initialCascadeState,advanceCascade,type CascadeState,type CascadeFrame,type CascadeDraw} from './floodedTempleCascadeMath';

export const TEMPLE_CASCADE_VERSION=2;
export type TempleCascadeSettings={temple:{mode:'cascades'}};
export type TempleCascadeView={kind:'flooded-temple-cascades';version:2;stakeUnits:string;revision:number;phase:'base'|'free'|'complete';state:CascadeState;operations:number[][][];frames:CascadeFrame[];totalPayoutUnits:string};
export type TempleCascadeResult={view:TempleCascadeView;ended:boolean;credit:number;message:string;actions:{move:string;label:string;cost:number}[]};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const validCascadeStake=(s:unknown):s is string=>typeof s==='string'&&CASCADE_DATA.stakes.some(n=>String(n)===s);
export function validCascadeSettings(v:unknown):v is TempleCascadeSettings{return record(v)&&Object.keys(v).join(',')==='temple'&&record(v.temple)&&Object.keys(v.temple).join(',')==='mode'&&v.temple.mode==='cascades';}
export const cascadeUnits=(points:number,stake:string)=>String(points*(Number(stake)/20));
export const cascadeCanonical=(v:unknown):string=>JSON.stringify(v,(_k,item)=>record(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
export function replayCascadeOperations(stake:string,operations:number[][][]):TempleCascadeView{
  if(!validCascadeStake(stake)||!Array.isArray(operations)||!operations.length)throw Error('Invalid cascade round');
  const state=initialCascadeState();let frames:CascadeFrame[]=[];
  for(const operation of operations){
    if(!Array.isArray(operation)||!operation.length||operation.length>CASCADE_DATA.batchFalls||state.next==='done')throw Error('Invalid cascade operation');
    frames=[];
    for(const tape of operation){
      if(!Array.isArray(tape)||tape.length>15||!tape.length||!tape.every(Number.isSafeInteger))throw Error('Invalid cascade tape');
      let index=0;const frame=advanceCascade(state,max=>{const value=tape[index++];if(!Number.isSafeInteger(value)||value<0||value>=max)throw Error('Invalid cascade stop');return value;})!;
      if(index!==tape.length)throw Error('Unused cascade stops');frames.push(frame);
    }
    if(operation.length!==CASCADE_DATA.batchFalls&&(state.next as string)!=='done')throw Error('Incomplete cascade operation');
  }
  return {kind:'flooded-temple-cascades',version:2,stakeUnits:stake,revision:operations.length,phase:state.next==='done'?'complete':state.mode,state,operations:structuredClone(operations),frames,totalPayoutUnits:cascadeUnits(state.totalPoints,stake)};
}
export function validCascadeView(stake:unknown,v:unknown):v is TempleCascadeView{
  if(!validCascadeStake(stake)||!record(v)||v.kind!=='flooded-temple-cascades'||v.version!==2||!Array.isArray(v.operations))return false;
  try{return cascadeCanonical(v)===cascadeCanonical(replayCascadeOperations(stake,v.operations as number[][][]));}catch{return false;}
}
export function cascadeResult(view:TempleCascadeView):TempleCascadeResult{
  const ended=view.phase==='complete';return {view,ended,credit:ended?Number(view.totalPayoutUnits):0,message:ended?'Каскадный раунд завершён. Выплата начислена в общий кошелёк.':'Каскады сохранены. Продолжение без новой ставки.',actions:ended?[]:[{move:'temple-cascade',label:'Продолжить каскады',cost:0}]};
}
export function validCascadeSettlement(state:unknown,stake:unknown,spent:unknown,returned:unknown,v:unknown):v is TempleCascadeView{
  return validCascadeView(stake,v)&&spent===stake&&Number(v.totalPayoutUnits)<=Number(stake)*CASCADE_DATA.maxWin&&(state==='active'?v.phase!=='complete'&&returned==='0':state==='settled'&&v.phase==='complete'&&returned===v.totalPayoutUnits);
}
export function validCascadeSession(v:unknown):boolean{
  return record(v)&&v.gameId==='studio-flooded-temple'&&v.rulesVersion===2&&record(v.view)&&validCascadeSettlement(v.state,v.stakeUnits,v.spentUnits,v.returnedUnits,v.view.templeCascade);
}
/** One bounded transport operation may contain several falls; it never truncates the round. */
export function generateCascadeOperation(state:CascadeState,draw:CascadeDraw){
  const operation:number[][]=[];
  for(let i=0;i<CASCADE_DATA.batchFalls&&state.next!=='done';i++){
    const tape:number[]=[];advanceCascade(state,max=>{const value=draw(max);tape.push(value);return value;},false);operation.push(tape);
  }
  if(state.totalPoints>CASCADE_CAP_POINTS)throw Error('Cascade cap violated');return operation;
}
