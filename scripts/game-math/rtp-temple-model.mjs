// Independent exhaustive model. Imports parameter records, never the production scorer.
import data from '../../src/shared/floodedTempleData.json' with {type:'json'};
import assert from 'node:assert/strict';
export const TEMPLE_METHOD='exhaustive-temple-decisions';
const requiredSources=['src/shared/floodedTempleData.json','src/shared/floodedTempleMath.ts','src/shared/floodedTemple.ts','server/games/floodedTemple.ts','scripts/game-math/rtp-temple-model.mjs','src/shared/casinoExpansion.ts','server/demoExpansion.ts','server/demoWalletRoutes.ts','server/gameWalletRoutes.ts','server/finance/nile-game-runtime.ts'];
const gcd=(a,b)=>{a=a<0n?-a:a;while(b){[a,b]=[b,a%b];}return a;};
export function ratio(n,d=1n){n=BigInt(n);d=BigInt(d);assert(d>0n);const g=gcd(n,d);return {n:n/g,d:d/g};}
export const plus=(a,b)=>ratio(a.n*b.d+b.n*a.d,a.d*b.d);
export const times=(a,b)=>ratio(a.n*b.n,a.d*b.d);
export const fraction=a=>({numerator:String(a.n),denominator:String(a.d)});
const number=a=>Number(a.n)/Number(a.d);
const edgeId=(a,b)=>[a,b].sort((x,y)=>x-y).join(':');
const allRooms=Array.from({length:20},(_,i)=>i);
export const baseSelections=()=>data.baseLayouts.flatMap((_,layout)=>data.basePattern.flatMap((_,pattern)=>data.baseTiers.flatMap((_,tier)=>[false,true].map(relic=>({layout,pattern,tier,relic})))));
export const bonusSelections=()=>data.bonusLayouts.flatMap((_,layout)=>data.bonusTiers.map((_,tier)=>({layout,tier})));
export function modelBase(c){
  const t=data.baseLayouts[c.layout],gate=edgeId(...t.gate),pairs=t.path.slice(1).map((b,i)=>[t.path[i],b]).concat(t.extra);
  const relic=c.relic?t.relic:4,rewards={};let offset=0;
  for(const id of allRooms)if(![5,t.lever,relic].includes(id))rewards[id]=data.basePattern[(offset+++c.pattern)%4]*data.baseTiers[c.tier].scale;
  const reached=new Set([5]);let opened=false;
  for(let changed=true;changed;){changed=false;
    if(reached.has(t.lever)&&!opened){opened=true;changed=true;}
    for(const [a,b]of pairs)if(edgeId(a,b)!==gate||opened){if(reached.has(a)&&!reached.has(b)){reached.add(b);changed=true;}if(reached.has(b)&&!reached.has(a)){reached.add(a);changed=true;}}
  }
  return {visited:[...reached].sort((a,b)=>a-b),cents:[...reached].reduce((sum,id)=>sum+(rewards[id]??0),0),bonus:reached.has(relic),opened};
}
export function modelBoard(c){
  const t=data.bonusLayouts[c.layout],tier=data.bonusTiers[c.tier];
  return {open:[...t.open,...(t.extraOpen??[])],gate:t.gate,gap:t.gap,lever:t.lever,rewards:Object.fromEntries(Object.entries(t.treasures).map(([id,n])=>[id,n*tier.numerator/tier.denominator]))};
}
export const initialModelState=()=>({at:5,left:6,mask:1<<5,bridge:false,done:false});
export const modelScore=(b,s)=>Object.entries(b.rewards).reduce((sum,[id,n])=>sum+((s.mask&(1<<Number(id)))?n:0),0);
export function modelActions(b,s){
  if(s.done||!s.left)return [];
  const open=b.open.concat((s.mask&(1<<b.lever))?[b.gate]:[]),result=[];
  for(const [a,z]of open){if(a===s.at)result.push({kind:'step',to:z});if(z===s.at)result.push({kind:'step',to:a});}
  const [a,z]=b.gap,to=a===s.at?z:z===s.at?a:null;
  if(to!==null)result.push({kind:s.bridge?'step':'rope',to});
  return result.sort((a,b)=>a.to-b.to);
}
export function modelMove(b,s,a){
  assert(!s.done);
  if(a.kind==='finish')return {...s,done:true};
  assert(modelActions(b,s).some(x=>x.kind===a.kind&&x.to===a.to));
  const result={at:a.to,left:s.left-1,mask:s.mask|(1<<a.to),bridge:s.bridge||a.kind==='rope',done:false};
  result.done=!result.left||!modelActions(b,result).length;return result;
}
const stateKey=s=>[s.at,s.left,s.mask,Number(s.bridge),Number(s.done)].join(':');
const boards=new Map();
export function modelSolver(c){
  const id=c.layout+':'+c.tier;if(boards.has(id))return boards.get(id);
  const board=modelBoard(c),states=new Map(),paths=new Map(),opt=new Map(),random=new Map();
  function enumerate(s,path){const key=stateKey(s);if(states.has(key))return;states.set(key,s);paths.set(key,path);for(const a of modelActions(board,s))enumerate(modelMove(board,s,a),[...path,a]);}
  enumerate(initialModelState(),[]);
  function best(s){const key=stateKey(s);if(opt.has(key))return opt.get(key);let value=modelScore(board,s),action={kind:'finish'};
    for(const a of modelActions(board,s)){const candidate=best(modelMove(board,s,a)).value;if(candidate>value){value=candidate;action=a;}}
    const result={value,action};opt.set(key,result);return result;
  }
  function randomValue(s){const key=stateKey(s);if(random.has(key))return random.get(key);const actions=modelActions(board,s);
    const value=actions.length?times(actions.map(a=>randomValue(modelMove(board,s,a))).reduce(plus,ratio(0)),ratio(1,actions.length)):ratio(modelScore(board,s));
    random.set(key,value);return value;
  }
  function goal(s,highest){
    const queue=[{s,first:null,distance:0}],seen=new Set([stateKey(s)]);let chosen=null;
    for(let cursor=0;cursor<queue.length;cursor++){
      const node=queue[cursor];
      for(const action of modelActions(board,node.s)){
        const next=modelMove(board,node.s,action),first=node.first??action,distance=node.distance+1;
        const value=(node.s.mask&(1<<action.to))?0:board.rewards[action.to]??0;
        if(value){const candidate={value,distance,first};if(!chosen||(highest?value>chosen.value||value===chosen.value&&distance<chosen.distance:distance<chosen.distance||distance===chosen.distance&&value>chosen.value))chosen=candidate;}
        const key=stateKey(next);if(!seen.has(key)){seen.add(key);queue.push({s:next,first,distance});}
      }
    }
    return chosen?.first??{kind:'finish'};
  }
  function choose(s,strategy){return strategy==='stop'?{kind:'finish'}:strategy==='optimal'?best(s).action:goal(s,strategy==='highest-first');}
  function evaluate(strategy){if(strategy==='random-walk')return randomValue(initialModelState());let s=initialModelState();while(!s.done)s=modelMove(board,s,choose(s,strategy));return ratio(modelScore(board,s));}
  const solver={board,states,paths,best,choose,evaluate};boards.set(id,solver);return solver;
}
function integerWeights(probabilities){const denominator=probabilities.reduce((a,b)=>a/gcd(a,b.d)*b.d,1n);const weights=probabilities.map(p=>p.n*(denominator/p.d));const common=weights.reduce(gcd);return weights.map(n=>{const value=Number(n/common);assert(Number.isSafeInteger(value)&&value>0);return value;});}
export function calibrationWeights(){
  let raw=ratio(0);
  for(let layout=0;layout<8;layout++)for(let pattern=0;pattern<4;pattern++)for(const relic of [false,true])raw=plus(raw,times(ratio(modelBase({layout,pattern,tier:1,relic}).cents),ratio(data.relicWeights[Number(relic)],8*4*100)));
  const high=times(plus(times(ratio(90),ratio(raw.d,raw.n)),ratio(-499,1000)),ratio(1,4));
  const base=integerWeights([ratio(3,5),plus(ratio(399,1000),times(high,ratio(-1))),high,ratio(1,1000)]);
  // All bonus tiers use an exact half or three-halves of the same integer prizes.
  let baseBonus=ratio(0);for(let layout=0;layout<8;layout++)baseBonus=plus(baseBonus,times(modelSolver({layout,tier:0}).evaluate('optimal'),ratio(2,8)));
  const bonusHigh=plus(times(ratio(300),ratio(baseBonus.d,baseBonus.n)),ratio(-1,2));
  return {base,bonus:integerWeights([plus(ratio(1),times(bonusHigh,ratio(-1))),bonusHigh]),rawBaseCents:fraction(raw),unscaledBonusCents:fraction(baseBonus)};
}
export function templeEvidence(policy){
  assert.deepEqual([...policy.sources].sort(),[...requiredSources].sort(),'Every Temple mathematical and settlement source must be fingerprinted');
  assert.equal(policy.qualificationSource,'scripts/game-math/rtp-temple.mjs');
  assert(Array.isArray(policy.seeds)&&policy.seeds.length>=2&&new Set(policy.seeds).size===policy.seeds.length&&policy.seeds.every(s=>Number.isInteger(s)&&s>=0&&s<=4294967295),'Temple requires distinct independent replay seeds');
  assert(Number.isInteger(policy.serverReplayRoundsPerSeed)&&policy.serverReplayRoundsPerSeed>=64&&policy.serverReplayRoundsPerSeed<=10000,'Temple replay coverage cannot be reduced');
  assert.deepEqual(policy.stakes,data.stakes);assert.deepEqual(policy.choices,['optimal','nearest-chest','highest-first','random-walk','stop']);
  assert.equal(policy.target,.96);assert.equal(policy.minimumReturn,.90);assert.equal(policy.rulesVersion,1);assert.equal(policy.progressVersion,1);
  const weights=calibrationWeights();assert.deepEqual(data.baseTiers.map(t=>t.weight),weights.base);assert.deepEqual(data.bonusTiers.map(t=>t.weight),weights.bonus);
  const baseWeight=data.baseTiers.reduce((s,t)=>s+t.weight,0),bonusWeight=data.bonusTiers.reduce((s,t)=>s+t.weight,0);
  let baseMean=ratio(0),bonusProbability=ratio(0),maxBase=0;
  for(const selection of baseSelections()){
    const result=modelBase(selection),probability=ratio(BigInt(data.baseTiers[selection.tier].weight)*BigInt(data.relicWeights[Number(selection.relic)]),BigInt(baseWeight)*3200n);
    baseMean=plus(baseMean,times(probability,ratio(result.cents,100)));if(result.bonus)bonusProbability=plus(bonusProbability,probability);maxBase=Math.max(maxBase,result.cents);
  }
  assert.deepEqual(baseMean,ratio(9,10));assert.deepEqual(bonusProbability,ratio(1,50));
  const bonusMeans=Object.fromEntries(policy.choices.map(choice=>[choice,ratio(0)]));let maxBonus=0,decisionStates=0,decisionTransitions=0;
  for(const selection of bonusSelections()){
    const solver=modelSolver(selection),probability=ratio(data.bonusTiers[selection.tier].weight,8*bonusWeight);
    maxBonus=Math.max(maxBonus,solver.best(initialModelState()).value);decisionStates+=solver.states.size;
    for(const s of solver.states.values())decisionTransitions+=modelActions(solver.board,s).length+Number(!s.done);
    for(const choice of policy.choices)bonusMeans[choice]=plus(bonusMeans[choice],times(probability,times(solver.evaluate(choice),ratio(1,100))));
  }
  assert.deepEqual(bonusMeans.optimal,ratio(3));assert(maxBase+maxBonus<data.maxWin*100,'The nonbinding cap proof must be reconsidered');
  const results=policy.choices.flatMap(choice=>policy.stakes.map(stakeUnits=>{
    assert(stakeUnits%100===0,'Reconsider per-chest rounding at this stake');
    const exact=plus(baseMean,times(bonusProbability,bonusMeans[choice]));assert(exact.n*100n>=90n*exact.d&&exact.n*100n<=96n*exact.d);
    return {choice,stakeUnits,rtpFraction:fraction(exact),rtp:number(exact),rtpBounds:[number(exact),number(exact)],conditionalBonusFraction:fraction(bonusMeans[choice])};
  }));
  const actualMaximumHundredths=Math.max(...baseSelections().map(c=>{const b=modelBase(c);return b.cents+(b.bonus?maxBonus:0);}));
  const histogram=new Map();let fullRoundCases=0;
  const add=(cents,probability)=>{histogram.set(cents,plus(histogram.get(cents)??ratio(0),probability));fullRoundCases++;};
  for(const c of baseSelections()){
    const b=modelBase(c),baseProbability=ratio(BigInt(data.baseTiers[c.tier].weight)*BigInt(data.relicWeights[Number(c.relic)]),BigInt(baseWeight)*3200n);
    if(!b.bonus)add(b.cents,baseProbability);
    else for(const bonus of bonusSelections())add(b.cents+modelSolver(bonus).best(initialModelState()).value,times(baseProbability,ratio(data.bonusTiers[bonus.tier].weight,8*bonusWeight)));
  }
  let mass=ratio(0),mean=ratio(0),second=ratio(0),positive=ratio(0),profit=ratio(0),partial=ratio(0),even=ratio(0);
  for(const [cents,p]of histogram){mass=plus(mass,p);mean=plus(mean,times(p,ratio(cents,100)));second=plus(second,times(p,ratio(cents*cents,10000)));if(cents>0)positive=plus(positive,p);if(cents>100)profit=plus(profit,p);if(cents>0&&cents<100)partial=plus(partial,p);if(cents===100)even=plus(even,p);}
  assert.deepEqual(mass,ratio(1));assert.deepEqual(mean,ratio(24,25));
  const variance=plus(second,times(times(mean,mean),ratio(-1)));
  const optimalDistribution={fullRoundCases,positiveReturn:fraction(positive),netProfit:fraction(profit),partialReturn:fraction(partial),breakEven:fraction(even),secondMoment:fraction(second),variance:fraction(variance),standardDeviation:Number(Math.sqrt(number(variance)).toFixed(10)),maximumProbability:fraction(histogram.get(actualMaximumHundredths))};
  return {method:TEMPLE_METHOD,analysis:{baseCases:baseSelections().length,bonusCases:bonusSelections().length,decisionStates,decisionTransitions,baseRtp:fraction(baseMean),bonusProbability:fraction(bonusProbability),optimalBonusMean:fraction(bonusMeans.optimal),upperBoundForEveryStrategy:'24/25',lowerBoundForEveryStrategy:'9/10',actualMaximumHundredths,conservativeMaxRoundHundredths:maxBase+maxBonus,capHundredths:data.maxWin*100,rounding:'per-chest floor; every allowed stake divisible by 100',optimalDistribution},results};
}
