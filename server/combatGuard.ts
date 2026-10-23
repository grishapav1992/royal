import { neutralCombatInput, type CombatInput } from '../src/shared/combat';

export const COMBAT_INPUT_LIMIT = { rate:40, burst:20, maxSequence:1_000_000 } as const;
export type CombatCommand =
 | {type:'combat-input';match:string;seq:number;input:CombatInput}
 | {type:'combat-ready'|'combat-stake';match:string;stake:number}
 | {type:'combat-rematch';match:string};
export type CombatRejection = 'schema'|'rate'|'identity'|'match'|'sequence'|'phase';

/** This guard lives only on the server. Client flags, timestamps and result claims are never trusted. */
export class CombatGuard {
 private limits=new Map<string,{tokens:number;at:number}>();
 private sequences=new Map<string,number>();
 private rejected:Partial<Record<CombatRejection,number>>={};
 reset(){this.limits.clear();this.sequences.clear();}
 forget(id:string){this.limits.delete(id);this.sequences.delete(id);}
 reject(reason:CombatRejection){this.rejected[reason]=(this.rejected[reason]??0)+1;return false;}
 diagnostics(){return {...this.rejected};}
 sequence(id:string){return this.sequences.get(id)??0;}
 inspect(id:string,value:unknown,now:number):CombatCommand|undefined{
  const bucket=this.limits.get(id)??{tokens:COMBAT_INPUT_LIMIT.burst,at:now};
  bucket.tokens=Math.min(COMBAT_INPUT_LIMIT.burst,bucket.tokens+Math.max(0,now-bucket.at)*COMBAT_INPUT_LIMIT.rate/1000);
  bucket.at=now;this.limits.set(id,bucket);
  if(bucket.tokens<1){this.reject('rate');return;}
  bucket.tokens--;
  if(!value||typeof value!=='object'||Array.isArray(value)){this.reject('schema');return;}
  const v=value as Record<string,unknown>;
  const expected=v.type==='combat-input'?'input,match,seq,type':v.type==='combat-ready'||v.type==='combat-stake'?'match,stake,type':v.type==='combat-rematch'?'match,type':'';
  if(!expected||Object.keys(v).sort().join(',')!==expected||typeof v.match!=='string'||v.match.length>64){this.reject('schema');return;}
  if(v.type==='combat-input'){
   const input=v.input;
   if(!Number.isSafeInteger(v.seq)||(v.seq as number)<1||(v.seq as number)>COMBAT_INPUT_LIMIT.maxSequence
    ||!input||typeof input!=='object'||Array.isArray(input)
    ||Object.keys(input).sort().join(',')!==Object.keys(neutralCombatInput()).sort().join(',')
    ||!Object.values(input).every(button=>typeof button==='boolean')){this.reject('schema');return;}
  }else if(v.type!=='combat-rematch'&&(!Number.isSafeInteger(v.stake)||(v.stake as number)<=0)){this.reject('schema');return;}
  return v as CombatCommand;
 }
 acceptSequence(id:string,seq:number){
  if(seq<=this.sequence(id))return this.reject('sequence');
  this.sequences.set(id,seq);return true;
 }
}
