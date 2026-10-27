import type {CaribbeanView} from '../../src/shared/caribbeanTreasures';
export type CaribbeanOutcome='loss'|'partial'|'return'|'win'|'bigwin';
export function caribbeanOutcome(view:Pick<CaribbeanView,'costUnits'|'totalPayoutUnits'>):CaribbeanOutcome{
 const cost=BigInt(view.costUnits),paid=BigInt(view.totalPayoutUnits);
 return paid===0n?'loss':paid<cost?'partial':paid===cost?'return':paid>=cost*20n?'bigwin':'win';
}
/** A staging snapshot only. The authoritative view is never mutated. */
export function caribbeanBeforeReveal(view:CaribbeanView,previous?:CaribbeanView):CaribbeanView{
 const copy=structuredClone(view),spin=copy.spins.at(-1);
 if(spin){spin.frame.grid=[...spin.frame.gridBefore];spin.frame.block=spin.frame.blockBefore?{...spin.frame.blockBefore}:null;spin.frame.wins=[];spin.frame.cannon=false;spin.payoutUnits='0';}
 copy.totalPayoutUnits=previous?.totalPayoutUnits??'0';return copy;
}
