import assert from 'node:assert/strict';
export const toteReferenceCountries = 'RU BR US JP FR DE GB AR CN IN TR CA ES IT PT NL BE CH SE NO DK FI PL UA AT IE GR CZ RO HU MX CL CO PE UY AU NZ KR ID TH VN SA AE ZA EG MA NG KE'.split(' ');
export const toteReferenceStakes = [100,200,500,1000,2000,5000];
// Independent rational allocation: scan the exact fractional claims for each remaining cent.
function divide(total, weights) {
  const denominator = weights.reduce((a,b)=>a+b,0n);
  const q=weights.map(w=>total*w/denominator), remainder=weights.map(w=>total*w%denominator);
  let missing=total-q.reduce((a,b)=>a+b,0n);
  while(missing>0n){let best=0;for(let i=1;i<remainder.length;i++)if(remainder[i]>remainder[best])best=i;q[best]++;remainder[best]=-1n;missing--;}
  return q;
}
export function toteReference(tickets,order){
  const pot=tickets.reduce((n,t)=>n+BigInt(t.stakeUnits),0n),backed=new Set(tickets.map(t=>t.country));
  const reason=backed.size<3?'countries':new Set(tickets.map(t=>t.accountId)).size<2?'accounts':null;
  if(reason)return {state:'refunded',reason,potUnits:String(pot),feeUnits:'0',awards:[],payouts:tickets.map(t=>({id:t.id,units:t.stakeUnits}))};
  const fee=pot*5n/100n,ranked=order.map((country,i)=>({country,place:48-i})).sort((a,b)=>a.place-b.place);
  const first=ranked[0].country,recipients=backed.has(first)?ranked.slice(0,1):ranked.filter(r=>backed.has(r.country)).slice(0,3);
  const budgets=divide(pot-fee,recipients.length===1?[100n]:[6n,3n,1n]),awards=[],payouts=tickets.map(t=>({id:t.id,units:'0'}));
  recipients.forEach((r,i)=>{awards.push({...r,units:String(budgets[i])});const indices=tickets.map((t,n)=>t.country===r.country?n:-1).filter(n=>n>=0);const credits=divide(budgets[i],indices.map(n=>BigInt(tickets[n].stakeUnits)));indices.forEach((n,j)=>payouts[n].units=String(credits[j]));});
  assert.equal(payouts.reduce((n,p)=>n+BigInt(p.units),0n)+fee,pot);
  return {state:'settled',reason:null,potUnits:String(pot),feeUnits:String(fee),awards,payouts};
}
export function* toteCases(){
  const all=toteReferenceCountries;
  for(const [i,country]of all.entries())for(const [s,stake]of toteReferenceStakes.entries()){
    const others=[all[(i+1)%48],all[(i+2)%48],all[(i+3)%48]];
    const tickets=[{id:'a',accountId:'a',country,stakeUnits:String(stake)},{id:'b',accountId:'b',country,stakeUnits:String(toteReferenceStakes[(s+1)%6])},...others.map((c,j)=>({id:'c'+j,accountId:'c'+j,country:c,stakeUnits:String(toteReferenceStakes[j])}))];
    yield {choice:'winner-backed',stakeUnits:stake,tickets,order:[...all.filter(c=>c!==country),country]};
    const winner=all.find(c=>c!==country&&!others.includes(c));
    for(let place=2;place<=48;place++){
      const order=all.filter(c=>c!==country&&c!==winner);order.splice(48-place,0,country);order.push(winner);
      yield {choice:'winner-unbacked',stakeUnits:stake,tickets,order};
    }
    yield {choice:'insufficient-countries',stakeUnits:stake,tickets:tickets.slice(0,2),order:all};
    yield {choice:'insufficient-accounts',stakeUnits:stake,tickets:tickets.map(t=>({...t,accountId:'a'})),order:all};
  }
}
export function toteStream(seed,rounds){
  let state=seed>>>0;const next=max=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%max;};
  const results=[];
  for(let n=0;n<rounds;n++){
    const order=[...toteReferenceCountries];for(let i=47;i>0;i--){const j=next(i+1);[order[i],order[j]]=[order[j],order[i]];}
    const count=3+next(64),tickets=[];
    for(let i=0;i<count;i++)tickets.push({id:String(i),accountId:String(i),country:toteReferenceCountries[next(48)],stakeUnits:String(toteReferenceStakes[next(6)])});
    results.push({tickets,order});
  }
  return results;
}
