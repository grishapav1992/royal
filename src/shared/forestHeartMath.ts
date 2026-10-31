import {recoverableStakes} from './gameStakes.ts';
/** Candidate rules v1. Pure model only; no wallet, transport or active game route. */
export const FOREST_HEART_GAME = 'studio-forest-heart' as const;
export const FOREST_HEART_STAKES = recoverableStakes([1000, 2000, 5000, 10000, 20000, 50000].map(String)).map(Number);
export const FOREST_HEART_RULES = {
  rulesVersion: 1, progressVersion: 1, size: 5,
  source: 10, receivers: [4, 14, 24],
  abilityDenominator: 32, bonusDenominator: 64, bonusSpins: 4,
  payoutNumerator: 631, payoutDenominator: 1000,
  energy: [{value: 1, weight: 9000}, {value: 2, weight: 800}, {value: 5, weight: 180}, {value: 20, weight: 19}, {value: 100, weight: 1}],
  energyDenominator: 10000,
} as const;

// N=1, E=2, S=4, W=8. Odd checkerboard cells are the twelve rotatable roots.
export const FOREST_HEART_ROTORS = Array.from({length:25}, (_,pos)=>pos)
  .filter(pos=>(Math.floor(pos/5)+pos%5)%2===1);
export const FOREST_HEART_TERMINAL_ROTORS = [3, 9, 13, 19, 23] as const;
const rotorIndex = new Map(FOREST_HEART_ROTORS.map((pos,index)=>[pos,index]));
const directions = [[-1,0,1,4], [0,1,2,8], [1,0,4,1], [0,-1,8,2]] as const;
export const forestHeartPopcount = (mask:number):number => {
  let count=0;
  for(let remaining=mask;remaining;remaining&=remaining-1) count++;
  return count;
};
function assertBits(bits:number):void {
  if(!Number.isInteger(bits)||bits<0||bits>=4096) throw new Error('Invalid Forest Heart orientation bits');
}
export function forestHeartBoard(bits:number):number[] {
  assertBits(bits);
  return Array.from({length:25},(_,pos)=>{
    const variable=rotorIndex.get(pos);
    if(variable!==undefined) return bits&(1<<variable)?5:10;
    const row=Math.floor(pos/5),col=pos%5;
    let mask=0;
    for(const [dr,dc,out] of directions)
      if(row+dr>=0&&row+dr<5&&col+dc>=0&&col+dc<5) mask|=out;
    if(pos===10) mask|=8;
    if(pos===4||pos===14||pos===24) mask|=2;
    return mask;
  });
}
export type ForestHeartFlow = {receiverMask:number;terminalRootMask:number;reachedCells:number[]};
export function forestHeartFlow(board:readonly number[]):ForestHeartFlow {
  if(board.length!==25) throw new Error('Invalid Forest Heart board');
  for(let i=0;i<25;i++) if(!Number.isInteger(board[i])||board[i]<0||board[i]>15)
    throw new Error('Invalid Forest Heart board');
  const queue:number[]=[],seen=new Uint8Array(25);
  if(board[10]&8){queue.push(10);seen[10]=1;}
  for(let head=0;head<queue.length;head++) {
    const pos=queue[head],row=Math.floor(pos/5),col=pos%5;
    for(const [dr,dc,out,into] of directions) {
      const nr=row+dr,nc=col+dc;
      if(nr<0||nr>=5||nc<0||nc>=5||!(board[pos]&out)) continue;
      const next=nr*5+nc;
      if(!seen[next]&&(board[next]&into)){seen[next]=1;queue.push(next);}
    }
  }
  let receiverMask=0,terminalRootMask=0;
  FOREST_HEART_RULES.receivers.forEach((pos,receiver)=>{
    if(!seen[pos]||!(board[pos]&2)) return;
    receiverMask|=1<<receiver;
    const row=Math.floor(pos/5),col=pos%5;
    // First powered mutual neighbour in N,E,S,W order. One root per reached flower.
    for(const [dr,dc,out,into] of directions) {
      const nr=row+dr,nc=col+dc;
      if(nr<0||nr>=5||nc<0||nc>=5||!(board[pos]&out)) continue;
      const next=nr*5+nc,index=rotorIndex.get(next);
      if(index!==undefined&&seen[next]&&(board[next]&into)){terminalRootMask|=1<<index;break;}
    }
  });
  return {receiverMask,terminalRootMask,reachedCells:queue};
}
export function forestHeartBase(bits:number,ability:boolean,rotation:number|null) {
  assertBits(bits);
  if(typeof ability!=='boolean') throw new Error('Invalid Forest Heart ability flag');
  if(rotation!==null&&(!ability||!Number.isInteger(rotation)||rotation<0||rotation>=12))
    throw new Error('Invalid Forest Heart rotation');
  const first=forestHeartFlow(forestHeartBoard(bits));
  const finalBits=rotation===null?bits:bits^(1<<rotation);
  const second=rotation===null?first:forestHeartFlow(forestHeartBoard(finalBits));
  const newReceiverMask=second.receiverMask&~first.receiverMask;
  const paidReceiverMask=first.receiverMask|second.receiverMask;
  return {bits,finalBits,rotation,firstReceiverMask:first.receiverMask,newReceiverMask,
    paidReceiverMask,flowers:forestHeartPopcount(paidReceiverMask)};
}
export function forestHeartBestRotation(bits:number) {
  let best=forestHeartBase(bits,true,null);
  for(let rotation=0;rotation<12;rotation++) {
    const candidate=forestHeartBase(bits,true,rotation);
    if(candidate.flowers>best.flowers) best=candidate;
  }
  return best;
}
export type ForestHeartHeld = {mask:number;values:number};
export function forestHeartHeld(state:number):ForestHeartHeld {
  if(!Number.isInteger(state)||state<0||state>=243) throw new Error('Invalid Forest Heart held state');
  let mask=0,values=0,remaining=state;
  for(const cell of FOREST_HEART_TERMINAL_ROTORS) {
    const digit=remaining%3,index=rotorIndex.get(cell)!;
    remaining=Math.floor(remaining/3);
    if(digit){mask|=1<<index;if(digit===2)values|=1<<index;}
  }
  return {mask,values};
}
export function forestHeartHeldState(held:ForestHeartHeld):number {
  if(!Number.isInteger(held.mask)||!Number.isInteger(held.values)||held.mask<0||held.values<0||
    held.mask>=4096||held.values>=4096||(held.values&~held.mask)) throw new Error('Invalid Forest Heart held roots');
  let state=0,power=1,allowed=0;
  for(const cell of FOREST_HEART_TERMINAL_ROTORS) {
    const bit=1<<rotorIndex.get(cell)!;allowed|=bit;
    if(held.mask&bit) state+=power*(held.values&bit?2:1);
    power*=3;
  }
  if(held.mask&~allowed) throw new Error('Only terminal roots may be held');
  return state;
}
export function forestHeartBonus(state:number,bits:number) {
  assertBits(bits);
  const held=forestHeartHeld(state),effectiveBits=(bits&~held.mask)|held.values;
  const flow=forestHeartFlow(forestHeartBoard(effectiveBits));
  const mask=held.mask|flow.terminalRootMask,values=effectiveBits&mask;
  return {bits:effectiveBits,receiverMask:flow.receiverMask,flowers:forestHeartPopcount(flow.receiverMask),
    nextState:forestHeartHeldState({mask,values})};
}
export function forestHeartFlowerPayout(stakeUnits:number,energy:number):bigint {
  if(!(FOREST_HEART_STAKES as readonly number[]).includes(stakeUnits)) throw new Error('Invalid Forest Heart stake');
  if(!FOREST_HEART_RULES.energy.some(row=>row.value===energy)) throw new Error('Invalid Forest Heart energy');
  const numerator=BigInt(stakeUnits)*BigInt(FOREST_HEART_RULES.payoutNumerator)*BigInt(energy);
  const denominator=BigInt(FOREST_HEART_RULES.payoutDenominator);
  if(numerator%denominator) throw new Error('Forest Heart payout would require rounding');
  return numerator/denominator;
}
export type ForestHeartRoundInput = {
  stakeUnits:number;bits:number;energy:number;ability:boolean;rotation:number|null;bonusAwarded:boolean;
  bonus:{bits:number;energy:number}[];
};
export function forestHeartRound(input:ForestHeartRoundInput) {
  if(typeof input.bonusAwarded!=='boolean'||input.bonus.length!==(input.bonusAwarded?4:0))
    throw new Error('Invalid Forest Heart bonus continuation count');
  const base=forestHeartBase(input.bits,input.ability,input.rotation);
  const basePayout=forestHeartFlowerPayout(input.stakeUnits,input.energy)*BigInt(base.flowers);
  let held=0,total=basePayout;
  const bonus=input.bonus.map(draw=>{
    const spin=forestHeartBonus(held,draw.bits);
    const payout=forestHeartFlowerPayout(input.stakeUnits,draw.energy)*BigInt(spin.flowers);
    held=spin.nextState;total+=payout;
    return {...spin,energy:draw.energy,payoutUnits:String(payout)};
  });
  const maxPayout=forestHeartFlowerPayout(input.stakeUnits,100)*15n;
  if(total>maxPayout) throw new Error('Forest Heart mathematical maximum exceeded');
  return {base:{...base,energy:input.energy,payoutUnits:String(basePayout)},bonus,payoutUnits:String(total)};
}
