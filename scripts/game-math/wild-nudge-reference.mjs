/** Independent candidate-model oracle. Imports parameters, never the production scorer. */
import assert from 'node:assert/strict';
export function referenceNudgeReel(strip,stop,mode,rules){
  const wrap=n=>(n%strip.length+strip.length)%strip.length;
  const window=offset=>[0,1,2].map(row=>strip[wrap(offset+row)]);
  const before=window(stop),anchor=strip.findIndex((symbol,i)=>symbol===6&&strip[wrap(i-1)]!==6);
  assert(anchor>=0);assert.deepEqual(window(anchor),[6,6,6]);
  assert.equal(strip.filter(n=>n===6).length,3);
  let displacement=0;
  if(before.includes(6)){
    displacement=wrap(anchor-stop);if(displacement>strip.length/2)displacement-=strip.length;
    assert(Math.abs(displacement)<=2);
  }
  const steps=Math.abs(displacement),direction=Math.sign(displacement),increment=mode==='base'?rules.baseIncrement:rules.bonusIncrement;
  return {stop,finalStop:wrap(stop+displacement),before,after:window(stop+displacement),direction,steps,multiplier:1+increment*steps,
    path:Array.from({length:steps+1},(_,i)=>({stop:wrap(stop+direction*i),cells:window(stop+direction*i),multiplier:1+increment*i}))};
}
export function referenceNudgeLine(symbols,multipliers,rules){
  const prefix=symbols.findIndex(symbol=>symbol!==6),leading=prefix<0?5:prefix;
  const candidates=[];
  const add=(symbol,count)=>{
    if(count<3)return;
    const multiplier=1+symbols.slice(0,count).reduce((n,s,i)=>n+(s===6?multipliers[i]-1:0),0);
    candidates.push({symbol,count,multiplier,points:rules.paytable[symbol][count-3]*multiplier});
  };
  if(leading>=3){
    const pays=rules.paytable.map(row=>row[leading-3]),best=Math.max(...pays);add(pays.indexOf(best),leading);
  }
  if(prefix>=0&&symbols[prefix]<6){
    const symbol=symbols[prefix];let end=prefix+1;
    while(end<5&&(symbols[end]===6||symbols[end]===symbol))end++;
    add(symbol,end);
  }
  candidates.sort((a,b)=>b.points-a.points||b.count-a.count||a.symbol-b.symbol);
  return candidates[0]??null;
}
export function referenceNudgeSpin(stops,mode,rules){
  const reels=stops.map((stop,column)=>referenceNudgeReel(rules.reels[column],stop,mode,rules));
  const before=Array.from({length:15},(_,i)=>reels[i%5].before[Math.floor(i/5)]),grid=Array.from({length:15},(_,i)=>reels[i%5].after[Math.floor(i/5)]);
  const wins=rules.lines.flatMap((line,index)=>{const candidate=referenceNudgeLine(line.map((row,c)=>reels[c].after[row]),reels.map(reel=>reel.multiplier),rules);return candidate?[{line:index,...candidate}]:[];});
  const scatterReels=reels.flatMap((reel,column)=>reel.after.includes(7)?[column]:[]);
  return {mode,reels,before,grid,wins,points:wins.reduce((n,w)=>n+w.points,0),scatterReels,awardedSpins:mode==='base'&&scatterReels.length>=rules.scatterTrigger?rules.bonusSpins:0};
}
export function referenceMarginals(rules,mode){
  return rules.reels.map(strip=>Array.from({length:3},(_,row)=>{
    const histogram=new Map();
    for(let stop=0;stop<strip.length;stop++){
      const reel=referenceNudgeReel(strip,stop,mode,rules),symbol=reel.after[row],multiplier=symbol===6?reel.multiplier:1,key=symbol+':'+multiplier;
      const found=histogram.get(key);if(found)found.weight++;else histogram.set(key,{symbol,multiplier,weight:1});
    }
    return [...histogram.values()].sort((a,b)=>a.symbol-b.symbol||a.multiplier-b.multiplier);
  }));
}
export function referenceLinePointNumerator(marginals,line,rules){
  const symbols=Array(5),multipliers=Array(5);let sum=0,leaves=0;
  const walk=(column,weight)=>{
    if(column===5){const win=referenceNudgeLine(symbols,multipliers,rules);if(win)sum+=win.points*weight;leaves++;return;}
    for(const state of marginals[column][line[column]]){symbols[column]=state.symbol;multipliers[column]=state.multiplier;walk(column+1,weight*state.weight);}
  };
  walk(0,1);assert(Number.isSafeInteger(sum));return {numerator:BigInt(sum),leaves};
}
