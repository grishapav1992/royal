// Independent numeric reference model. This file imports no game evaluator.
export const basePay = [[19,38,75],[23,45,94],[28,56,119],[35,69,150],[44,88,200],[56,113,263],[75,150,375]];
export function seeded(seed) { let x=seed>>>0; return max => { x^=x<<13; x^=x>>>17; x^=x<<5; return Math.floor((x>>>0)/4294967296*max); }; }
export function referenceRound(draw, table=basePay, profile={baseBeacon:15000,freeBeacon:6000,baseBarrier:12000,freeBarrier:25000}, record=false) {
 let total=0, awarded=0, played=0, remaining=0, pins=[], frames=0, maxPins=0, limited=0; const history=[];
 const one=(free)=>{
  let count=pins.length;
  const symbol=()=>{const r=draw(1000000),beacon=free?profile.freeBeacon:profile.baseBeacon,barrier=free?profile.freeBarrier:profile.baseBarrier; if(r<beacon)return 7;if(count<6&&r<beacon+barrier){count++;return 8;}return draw(7);};
  let board=Array.from({length:30},(_,i)=>pins.includes(i)?8:symbol()),paid=0,steps=0;
  for(let step=0;step<20;step++){
   pins=board.flatMap((v,i)=>v===8?[i]:[]);maxPins=Math.max(maxPins,pins.length);
   const counts=Array(7).fill(0);for(const v of board)if(v<7)counts[v]++;
   const winners=counts.map((n,i)=>n>=8?i:-1).filter(i=>i>=0);
   let raw=0;for(const i of winners)raw+=table[i][counts[i]>=12?2:counts[i]>=10?1:0]*(1+pins.length);
   const pay=Math.min(raw,500000-total-paid);paid+=pay;
   if(!winners.length||total+paid===500000)break;
   frames++;steps++;if(step===19){limited++;break;}
   const next=board.slice();
   for(let col=0;col<6;col++){
    const cells=Array.from({length:5},(_,row)=>row*6+col).filter(i=>board[i]!==8);
    const keep=cells.filter(i=>!winners.includes(board[i])).map(i=>board[i]);
    const blanks=cells.length-keep.length;
    cells.forEach((pos,i)=>{next[pos]=i<blanks?symbol():keep[i-blanks];});
   }
   board=next;
  }
  total+=paid;const beacons=board.filter(v=>v===7).length;let award=0;
  if(free){played++;remaining--;if(total<500000&&beacons>=3){award=Math.min(2,20-awarded);awarded+=award;remaining+=award;}}
  else if(total<500000&&beacons>=3){award=beacons>=5?15:beacons===4?12:10;awarded=remaining=award;pins=[];}
  if(total===500000)remaining=0;
  if(record)history.push({board,paid,pins:[...pins],beacons,award,steps});
 };
 one(false);while(remaining)one(true);return {total,awarded,played,frames,maxPins,limited,history};
}
export function simulation(n,seed,table=basePay,profile) {
 const draw=seeded(seed);let sum=0,sq=0,hits=0,bonuses=0,free=0,caps=0,cascades=0,limited=0;const histogram=[0,0,0,0,0,0];
 for(let i=0;i<n;i++){const r=referenceRound(draw,table,profile),x=r.total/100;sum+=x;sq+=x*x;hits+=x>0?1:0;bonuses+=r.awarded>0?1:0;free+=r.played;caps+=x===5000?1:0;cascades+=r.frames;limited+=r.limited;histogram[x===0?0:x<1?1:x<5?2:x<20?3:x<100?4:5]++;}
 const mean=sum/n,se=Math.sqrt((sq-sum*sum/n)/(n-1)/n);return {n,seed,sum,sq,rtp:100*mean,ci95:[100*(mean-1.96*se),100*(mean+1.96*se)],hitRate:hits/n,bonusRate:bonuses/n,meanFree:free/n,caps,cascades:cascades/n,limited,histogram};
}
if(process.argv[1]?.endsWith('convoy-reference.mjs'))console.log(JSON.stringify(simulation(Number(process.argv[2]||200000),Number(process.argv[3]||142857),basePay.map(row=>row.map(v=>Math.round(v*Number(process.argv[4]||1))))),null,2));
