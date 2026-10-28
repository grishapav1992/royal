// Independent row-major complete-round model. No production scorer, gravity or state machine imports.
import data from '../../src/shared/floodedTempleCascadeData.json' with {type:'json'};
export const CASCADE_METHOD='temple-cascade-independent-monte-carlo-v2';
const paths=data.paylines.map(rows=>rows.map((r,c)=>r*5+c));
const bags=[data.baseReels,data.freeReels].map(reels=>reels.map(counts=>{
  const result=[];for(let s=0;s<counts.length;s++)for(let i=0;i<counts[s];i++)result.push(s);return result;
}));
/** xoshiro128**; rejection sampling avoids the bias of unsigned % maximum. */
export function cascadeRandom(seed){
  let split=seed>>>0;const word=()=>{split=(split+0x9e3779b9)>>>0;let x=split;x=Math.imul(x^(x>>>16),0x21f0aaad);x=Math.imul(x^(x>>>15),0x735a2d97);return (x^(x>>>15))>>>0;};
  let a=word(),b=word(),c=word(),d=word();
  const next=()=>{const z=Math.imul(b,5),rot=(z<<7)|(z>>>25),out=Math.imul(rot,9)>>>0,t=b<<9;c^=a;d^=b;b^=c;a^=d;c^=t;d=(d<<11)|(d>>>21);return out;};
  const limits=new Map();
  return maximum=>{let limit=limits.get(maximum);if(limit===undefined){limit=4294967296-4294967296%maximum;limits.set(maximum,limit);}let x;do{x=next();}while(x>=limit);return x%maximum;};
}
export function independentCascadeRound(draw,trace){
  let board=Array(15).fill(0),holes=32767,mode=0,level=0,remaining=0,played=0,total=0,falls=0,bonuses=0,awarded=0;
  let parent=null,operation=0;
  // operation: 0 refill, 1 new free spin, 2 resume base, 3 complete.
  while(operation!==3){
    if(operation===1){mode=1;level=0;remaining--;played++;holes=32767;}
    if(operation===2){[board,holes,level]=parent;parent=null;mode=0;}
    for(let column=0;column<5;column++){
      const survivors=[];
      for(let row=2;row>=0;row--){const index=row*5+column;if(!(holes&(1<<index)))survivors.push(board[index]);}
      for(let row=2;row>=0;row--){const count=2-row;if(count<survivors.length)board[row*5+column]=survivors[count];else{const stop=draw(bags[mode][column].length);if(!Number.isInteger(stop)||stop<0||stop>=bags[mode][column].length)throw Error('Invalid independent stop');board[row*5+column]=bags[mode][column][stop];}}
    }
    let linePoints=0,triggerCount=0;holes=0;
    for(let p=0;p<paths.length;p++){
      const line=paths[p],first=board[line[0]];
      if(first===8){
        if((board[line[1]]===8||board[line[1]]===7)&&(board[line[2]]===8||board[line[2]]===7)){
          triggerCount++;holes|=(1<<line[0])|(1<<line[1])|(1<<line[2]);
        }
      }else if(first<7){
        let matched=0;for(const cell of line){if(board[cell]!==first&&board[cell]!==7)break;matched++;}
        if(matched>=3){linePoints+=data.paytable[first][matched-3];for(let i=0;i<matched;i++)holes|=1<<line[i];}
      }
    }
    const multiplier=(mode?data.freeMultipliers:data.baseMultipliers)[Math.min(level,3)];
    const raw=linePoints*multiplier,payout=Math.min(raw,10000-total);total+=payout;falls++;
    const added=triggerCount*10;remaining+=added;bonuses+=triggerCount;awarded+=added;
    if(total===10000){remaining=0;parent=null;operation=3;}
    else if(!mode&&added){parent=[board.slice(),holes,level+1];operation=1;}
    else if(holes){level++;operation=0;}
    else if(!mode)operation=3;
    else operation=remaining?1:2;
    if(trace){
      const grid=[],maskBits=[];for(let col=0;col<5;col++)for(let row=0;row<3;row++){grid.push(board[row*5+col]);maskBits.push(holes&(1<<(row*5+col))?1:0);}
      trace.push({fall:falls,mode:mode?'free':'base',grid,multiplier,addedFreeSpins:added,remainingFreeSpins:remaining,playedFreeSpins:played,removeMask:maskBits.reduce((m,v,i)=>m|(v<<i),0),rawPoints:raw,awardedPoints:payout,totalPoints:total,capped:total===10000});
    }
  }
  return {points:total,falls,played,bonuses,awarded};
}
export function independentCascadeSample(seed,rounds,onProgress){
  const random=cascadeRandom(seed);let reward=0,rewardSquared=0,falls=0,freeSpins=0,bonusRounds=0,capped=0,positive=0,aboveStake=0,maxFalls=0;
  for(let i=0;i<rounds;i++){
    const r=independentCascadeRound(random),value=r.points/20;reward+=value;rewardSquared+=value*value;falls+=r.falls;freeSpins+=r.played;bonusRounds+=r.bonuses>0?1:0;capped+=r.points===10000?1:0;positive+=r.points>0?1:0;aboveStake+=r.points>20?1:0;maxFalls=Math.max(maxFalls,r.falls);
    if(onProgress&&(i+1)%5000000===0)onProgress({seed,paidRounds:i+1,rtp:reward/(i+1)});
  }
  const mean=reward/rounds,variance=(rewardSquared-reward*reward/rounds)/(rounds-1),half=1.96*Math.sqrt(variance/rounds);
  return {seed,paidRounds:rounds,reward,rewardSquared,rtp:mean,interval95:[mean-half,mean+half],falls,freeSpins,bonusRounds,capped,positive,aboveStake,maxFalls};
}
