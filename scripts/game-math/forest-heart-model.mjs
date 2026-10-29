import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {
  FOREST_HEART_RULES as R,FOREST_HEART_STAKES,FOREST_HEART_ROTORS,
  forestHeartBoard,forestHeartFlow,forestHeartBestRotation,forestHeartHeld,
  forestHeartBonus,forestHeartFlowerPayout,
} from '../../src/shared/forestHeartMath.ts';
import {referenceBoard,referenceFlow,referenceHeld,referenceNextState,countFlowers} from './forest-heart-reference.mjs';

const gcd=(a,b)=>{while(b){const next=a%b;a=b;b=next;}return a;};
const fraction=(n,d=1n)=>{assert(d>0n);const g=gcd(n<0n?-n:n,d);return {n:n/g,d:d/g};};
const plus=(a,b)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d);
const times=(a,b)=>fraction(a.n*b.n,a.d*b.d);
const jsonFraction=f=>({numerator:String(f.n),denominator:String(f.d),decimal:Number(f.n)/Number(f.d)});
const canonicalHash=bytes=>createHash('sha256').update(bytes.toString('utf8').replace(/\r\n/g,'\n')).digest('hex');

/** Exhaustive finite model, not a runtime/wallet qualification. No statistical CI. */
export function analyzeForestHeart(){
  assert.equal(R.size,5);assert.equal(R.source,10);assert.deepEqual(R.receivers,[4,14,24]);
  assert.equal(R.rulesVersion,1);assert.equal(R.progressVersion,1);assert.equal(R.payoutDenominator,1000);
  assert.deepEqual(FOREST_HEART_ROTORS,[1,3,5,7,9,11,13,15,17,19,21,23]);
  assert.equal(R.abilityDenominator,32);assert.equal(R.bonusDenominator,64);assert.equal(R.bonusSpins,4);
  assert.equal(R.energy.reduce((sum,row)=>sum+row.weight,0),R.energyDenominator);
  const flows=[];let baseSum=0,optimalSum=0,improvedBoards=0;
  const forcedSums=Array(12).fill(0),baseHistogram=[0,0,0,0],optimalHistogram=[0,0,0,0];
  for(let bits=0;bits<4096;bits++){
    const board=forestHeartBoard(bits),refBoard=referenceBoard(bits);
    assert.deepEqual(board,refBoard,'Independent board construction');
    const actual=forestHeartFlow(board),reference=referenceFlow(refBoard);
    assert.equal(actual.receiverMask,reference.receiverMask);
    assert.equal(actual.terminalRootMask,reference.terminalRootMask);
    assert.deepEqual([...actual.reachedCells].sort((a,b)=>a-b),reference.reachedCells);
    flows.push(reference);
  }
  for(let bits=0;bits<4096;bits++){
    const normal=countFlowers(flows[bits].receiverMask);let optimum=normal;
    for(let turn=0;turn<12;turn++){
      const reward=countFlowers(flows[bits].receiverMask|flows[bits^(1<<turn)].receiverMask);
      forcedSums[turn]+=reward;optimum=Math.max(optimum,reward);
    }
    const selected=forestHeartBestRotation(bits);
    assert.equal(selected.flowers,optimum,'Optimal action must cover all twelve rotations and pass');
    if(selected.rotation===null)assert.equal(optimum,normal);
    baseSum+=normal;optimalSum+=optimum;improvedBoards+=Number(optimum>normal);
    baseHistogram[normal]++;optimalHistogram[optimum]++;
  }
  // A held raw bit is still drawn, then ignored. Every kernel therefore has denominator 4096.
  const kernels=[];let bonusComparisons=0;
  for(let state=0;state<243;state++){
    const held=referenceHeld(state);assert.deepEqual(forestHeartHeld(state),held);
    const heldCount=FOREST_HEART_ROTORS.reduce((sum,_,i)=>sum+Number(Boolean(held.mask&(1<<i))),0);
    const weight=2**heldCount,transitions=new Map();let flowerSum=0;
    for(let bits=0;bits<4096;bits++){
      if((bits&held.mask)!==held.values)continue;
      const flow=flows[bits],next=referenceNextState(state,bits,flow.terminalRootMask);
      const actual=forestHeartBonus(state,bits);
      assert.equal(actual.bits,bits);assert.equal(actual.receiverMask,flow.receiverMask);assert.equal(actual.nextState,next);
      assert.equal(actual.flowers,countFlowers(flow.receiverMask));
      transitions.set(next,(transitions.get(next)??0)+weight);
      flowerSum+=countFlowers(flow.receiverMask)*weight;bonusComparisons++;
    }
    assert.equal([...transitions.values()].reduce((a,b)=>a+b,0),4096);
    kernels.push({flowerSum,transitions});
  }
  let distribution=new Map([[0,1n]]),denominator=1n,bonusCount=fraction(0n),bonusStages=[];
  for(let step=0;step<R.bonusSpins;step++){
    const next=new Map();let reward=0n;
    for(const [state,mass]of distribution){
      reward+=mass*BigInt(kernels[state].flowerSum);
      for(const [target,weight]of kernels[state].transitions)
        next.set(target,(next.get(target)??0n)+mass*BigInt(weight));
    }
    denominator*=4096n;
    assert.equal([...next.values()].reduce((a,b)=>a+b,0n),denominator);
    const stage=fraction(reward,denominator);bonusCount=plus(bonusCount,stage);
    bonusStages.push({spin:step+1,reachableStates:next.size,expectedFlowers:jsonFraction(stage)});
    distribution=next;
  }
  // Independent direction of the expectation recurrence: every starting state backwards.
  let backward=Array(243).fill(0n),backwardDenominator=1n;
  for(let remaining=1;remaining<=R.bonusSpins;remaining++){
    backward=kernels.map(kernel=>BigInt(kernel.flowerSum)*backwardDenominator+
      [...kernel.transitions].reduce((sum,[next,weight])=>sum+BigInt(weight)*backward[next],0n));
    backwardDenominator*=4096n;
  }
  assert.deepEqual(fraction(backward[0],backwardDenominator),bonusCount,'Forward probability propagation and backward expectation disagree');
  const energy=fraction(BigInt(R.energy.reduce((sum,row)=>sum+row.value*row.weight,0)),BigInt(R.energyDenominator));
  const bonusContribution=times(bonusCount,fraction(1n,BigInt(R.bonusDenominator)));
  const baseCount=fraction(BigInt((R.abilityDenominator-1)*baseSum+optimalSum),BigInt(R.abilityDenominator)*4096n);
  const coefficient=times(plus(baseCount,bonusContribution),energy);
  const rate=fraction(BigInt(R.payoutNumerator),BigInt(R.payoutDenominator));
  const rtp=times(coefficient,rate);
  const recommendedNumerator=(24n*coefficient.d*1000n+(25n*coefficient.n)/2n)/(25n*coefficient.n);
  const strategies=[['optimal',optimalSum],['pass',baseSum],...forcedSums.map((sum,i)=>['rotate-'+i,sum])].map(([choice,sum])=>{
    const count=fraction(BigInt((R.abilityDenominator-1)*baseSum+sum),BigInt(R.abilityDenominator)*4096n);
    return {choice,rtp:jsonFraction(times(times(plus(count,bonusContribution),energy),rate))};
  });
  const stakeChecks=FOREST_HEART_STAKES.flatMap(stake=>R.energy.map(({value})=>{
    const payout=forestHeartFlowerPayout(stake,value);
    assert.equal(payout*BigInt(R.payoutDenominator),BigInt(stake)*BigInt(R.payoutNumerator)*BigInt(value));
    return {stakeUnits:stake,energy:value,payoutPerFlowerUnits:String(payout)};
  }));
  return {
    schemaVersion:1,gameId:'studio-forest-heart',scope:'mathematical-model-only',releaseQualified:false,
    method:'exact-finite-board-enumeration-and-bonus-state-propagation',
    policy:{target:.96,tolerance:.002,calibrationNumerator:Number(recommendedNumerator),rules:R,stakes:[...FOREST_HEART_STAKES]},
    enumeration:{boards:4096,actionsPerAbility:13,rotationComparisons:4096*12,heldStates:243,bonusComparisons,baseHistogram,optimalHistogram,improvedBoards,
      bonusKernelSha256:createHash('sha256').update(JSON.stringify(kernels.map(kernel=>({flowerSum:kernel.flowerSum,transitions:[...kernel.transitions].sort((a,b)=>a[0]-b[0])})))).digest('hex'),
      forwardBackwardAgreement:true},
    expectedEnergy:jsonFraction(energy),baseExpectedFlowers:jsonFraction(fraction(BigInt(baseSum),4096n)),
    optimalAbilityExpectedFlowers:jsonFraction(fraction(BigInt(optimalSum),4096n)),
    paidBaseExpectedFlowers:jsonFraction(baseCount),bonusExpectedFlowers:jsonFraction(bonusCount),bonusStages,
    components:{baseRtp:jsonFraction(times(times(baseCount,energy),rate)),bonusRtp:jsonFraction(times(times(bonusContribution,energy),rate))},
    optimalRtp:jsonFraction(rtp),strategies,stakeChecks,
    maxReturn:jsonFraction(times(fraction(15n*100n),rate)),
    interpretation:'Exact expectation of the specified finite candidate model, including the optimal visible action and all four sticky bonus spins. No sampled estimate or confidence interval. Not evidence of server RNG, transport, wallet settlement or runtime compatibility.',
  };
}

// Resolve paths from the repository rather than the caller's working directory.
const root=new URL('../../',import.meta.url);
export async function forestHeartModelReport(){
  const result=analyzeForestHeart();
  const policy=JSON.parse(await readFile(new URL('scripts/game-math/rtp-policy.json',root),'utf8')).profiles['studio-forest-heart'];
  assert(['model-only','server-qualified-client-pending','qualified'].includes(policy.releaseStatus));assert.equal(policy.target,.96);assert.equal(policy.tolerance,.002);
  assert.deepEqual(policy.stakes,[...FOREST_HEART_STAKES]);
  assert.deepEqual(policy.choices,['optimal','pass',...Array.from({length:12},(_,i)=>'rotate-'+i)]);
  assert.equal(policy.rulesVersion,R.rulesVersion);assert.equal(policy.progressVersion,R.progressVersion);
  result.registeredPolicySha256=createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  result.sourceHashes={};
  for(const source of ['src/shared/forestHeartMath.ts','scripts/game-math/forest-heart-reference.mjs','scripts/game-math/forest-heart-model.mjs'])
    result.sourceHashes[source]=canonicalHash(await readFile(new URL(source,root)));
  return result;
}
export async function writeForestHeartModelReport(){
  const result=await forestHeartModelReport(),error=rtpError(result);
  if(process.argv.includes('--write')){
    assert(!error,error);
    await writeFile(new URL('docs/concepts/forest-heart/math-model.json',root),JSON.stringify(result,null,2)+'\n');
  }
  if(process.argv.includes('--verify')){
    assert(!error,error);
    assert.deepEqual(JSON.parse(await readFile(new URL('docs/concepts/forest-heart/math-model.json',root),'utf8')),result,'Forest Heart model evidence is stale or altered');
  }
  return result;
}
export function rtpError(report){
  const {numerator,denominator}=report.optimalRtp,n=BigInt(numerator),d=BigInt(denominator);
  return n*1000n<958n*d||n*1000n>962n*d?'Candidate RTP is outside 96% +/- 0.2 percentage points':null;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const report=await writeForestHeartModelReport();
  console.log(JSON.stringify({scope:report.scope,optimalRtp:report.optimalRtp,components:report.components,
    calibrationNumerator:report.policy.calibrationNumerator,bonusStages:report.bonusStages,maxReturn:report.maxReturn,error:rtpError(report)},null,2));
}
