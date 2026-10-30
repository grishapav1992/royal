import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {q,add,mul,div,sub,cmp,sum,choose,view,equal} from './rational.mjs';
import {referenceNudgeReel,referenceNudgeLine,referenceNudgeSpin,referenceMarginals,referenceLinePointNumerator} from './wild-nudge-reference.mjs';
import {WILD_NUDGE_DATA as R,WILD_NUDGE_STAKES,wildNudgeReel,scoreWildNudgeLine,wildNudgeSpin,wildNudgeRound,settleWildNudgePoints,wildNudgePointBound} from '../../src/shared/wildNudgeMath.ts';

export const WILD_NUDGE_SOURCES=['src/shared/wildNudgeData.json','src/shared/wildNudgeMath.ts','scripts/game-math/wild-nudge-reference.mjs','scripts/game-math/wild-nudge-model.mjs','scripts/game-math/rational.mjs'];
export function analyzeWildNudge(){
  assert.equal(R.columns,5);assert.equal(R.rows,3);assert.equal(R.bonusSpins,8);assert.equal(R.scatterTrigger,3);
  assert.equal(R.baseIncrement,1);assert.equal(R.bonusIncrement,2);assert.equal(R.payDenominator,5);
  assert.equal(R.lines.length,20);assert.equal(new Set(R.lines.map(line=>line.join(','))).size,20);
  for(const line of R.lines)assert(line.length===5&&line.every(row=>Number.isInteger(row)&&row>=0&&row<3));
  for(const pays of R.paytable)assert(pays.length===3&&pays.every((n,i)=>Number.isInteger(n)&&n>0&&(i===0||n>=pays[i-1])));
  const denominator=R.reels.reduce((n,strip)=>n*BigInt(strip.length),1n),census=[];
  for(let column=0;column<5;column++){
    const strip=R.reels[column];assert.equal(strip.length,64);assert(strip.every(n=>Number.isInteger(n)&&n>=0&&n<=7));
    let scatters=0,partial=0,full=0;
    for(let stop=0;stop<strip.length;stop++){
      const frame=wildNudgeReel(column,stop,'base');
      for(const mode of ['base','bonus'])assert.deepEqual(wildNudgeReel(column,stop,mode),referenceNudgeReel(strip,stop,mode,R));
      assert(frame.after.filter(n=>n===7).length<=1);assert.equal(frame.before.includes(7),frame.after.includes(7),'Dovetail must not create or erase SCATTER on these strips');
      scatters+=Number(frame.after.includes(7));partial+=Number(frame.steps>0);full+=Number(frame.after.every(n=>n===6));
    }
    census.push({column,stops:strip.length,scatterStops:scatters,partialWildStops:partial,fullWildStops:full});
  }
  const modes={},lineChecks=[];let leaves=0;
  for(const mode of ['base','bonus']){
    const marginals=referenceMarginals(R,mode);let points=0n;
    for(const [i,line]of R.lines.entries()){
      const expected=referenceLinePointNumerator(marginals,line,R),symbols=Array(5),multipliers=Array(5);let actual=0;
      const walk=(column,weight)=>{
        if(column===5){const win=scoreWildNudgeLine(symbols,multipliers);if(win)actual+=win.points*weight;return;}
        for(const state of marginals[column][line[column]]){symbols[column]=state.symbol;multipliers[column]=state.multiplier;walk(column+1,weight*state.weight);}
      };
      walk(0,1);assert(Number.isSafeInteger(actual));assert.equal(BigInt(actual),expected.numerator,'Independent line expectation');
      points+=expected.numerator;leaves+=expected.leaves;lineChecks.push({mode,line:i,weightedPointSum:String(expected.numerator),combinations:expected.leaves});
    }
    modes[mode]=q(points,denominator*BigInt(R.lines.length*R.payDenominator));
  }
  // Complete column-state census gives a Poisson-binomial law, preserving within-column correlation.
  let distribution=[1n];
  for(const column of census){const next=Array(distribution.length+1).fill(0n);for(const [k,mass]of distribution.entries()){next[k]+=mass*BigInt(column.stops-column.scatterStops);next[k+1]+=mass*BigInt(column.scatterStops);}distribution=next;}
  assert.equal(distribution.reduce((a,b)=>a+b,0n),denominator);
  const bonusProbability=q(distribution.slice(R.scatterTrigger).reduce((a,b)=>a+b,0n),denominator);
  const p=q(census[0].scatterStops,64);assert(census.every(row=>row.scatterStops===census[0].scatterStops));
  equal(bonusProbability,sum([3,4,5].map(k=>mul(q(choose(5,k)),mul(q(p.n**BigInt(k),p.d**BigInt(k)),q((p.d-p.n)**BigInt(5-k),p.d**BigInt(5-k)))))),'Closed-form trigger check');
  const bonusContribution=mul(bonusProbability,mul(q(R.bonusSpins),modes.bonus));
  const rtp=add(modes.base,bonusContribution);
  const noNudge=census.reduce((f,row)=>mul(f,q(row.stops-row.partialWildStops,row.stops)),q(1));
  // Replacement by a fully dovetailed x3 WILD weakly increases every line. Thus the
  // largest triggering base field has exactly three SCATTER columns and x3 on the other two.
  const bestStop=R.reels.map((strip,column)=>{let best=0;for(let stop=0;stop<strip.length;stop++)if(wildNudgeReel(column,stop,'base').multiplier>wildNudgeReel(column,best,'base').multiplier)best=stop;return best;});
  const scatterStops=R.reels.map((strip,column)=>Array.from({length:strip.length},(_,i)=>i).filter(stop=>wildNudgeReel(column,stop,'base').after.includes(7)));
  let triggerMaximum=-1,witness=null,maximumChecks=0;
  for(let a=0;a<3;a++)for(let b=a+1;b<4;b++)for(let c=b+1;c<5;c++)for(const x of scatterStops[a])for(const y of scatterStops[b])for(const z of scatterStops[c]){
    const stops=bestStop.slice();stops[a]=x;stops[b]=y;stops[c]=z;
    const expected=referenceNudgeSpin(stops,'base',R),actual=wildNudgeSpin(stops,'base');assert.deepEqual(actual,expected);assert.equal(actual.awardedSpins,8);
    maximumChecks++;if(actual.points>triggerMaximum){triggerMaximum=actual.points;witness=stops;}
  }
  const maxBase=wildNudgeSpin(bestStop,'base'),maxBonus=wildNudgeSpin(bestStop,'bonus');
  assert.equal(maxBase.points,wildNudgePointBound('base'));assert.equal(maxBonus.points,wildNudgePointBound('bonus'));
  const maxRoundPoints=Math.max(maxBase.points,triggerMaximum+R.bonusSpins*maxBonus.points),stakeChecks=[];
  for(const stakeUnits of WILD_NUDGE_STAKES){
    assert.equal(BigInt(stakeUnits)%BigInt(R.lines.length*R.payDenominator),0n);
    const full=wildNudgeRound({stakeUnits,baseStops:witness,bonusStops:Array.from({length:8},()=>bestStop.slice())});
    assert.equal(full.payoutUnits,String(BigInt(stakeUnits)*BigInt(maxRoundPoints)/100n));
    assert.equal(settleWildNudgePoints(maxBase.points,stakeUnits),String(BigInt(stakeUnits)*BigInt(maxBase.points)/100n));
    stakeChecks.push({stakeUnits,costUnits:full.costUnits,maximumPayoutUnits:full.payoutUnits,rtp:view(rtp),settlement:'exact integer; every spin is an integral multiple of stake/100'});
  }
  return {schemaVersion:1,gameId:'studio-wild-nudge',scope:'mathematical-model-only',releaseQualified:false,
    method:'exact-independent-reel-marginals-and-finite-bonus-expectation',
    enumeration:{jointStopSpace:String(denominator),reelCensusChecks:census.reduce((n,row)=>n+row.stops,0)*2,lineStateComparisons:leaves,lines:lineChecks,maximumTriggerFields:maximumChecks},
    census,components:{baseRtp:view(modes.base),bonusSpinMean:view(modes.bonus),bonusRtp:view(bonusContribution)},
    exactRtp:view(rtp),bonusProbability:view(bonusProbability),meanRoundsBetweenBonuses:view(div(q(1),bonusProbability)),
    probabilityOfAnyNudge:view(sub(q(1),noNudge)),scatterCountDistribution:distribution.map((n,k)=>({columns:k,probability:view(q(n,denominator))})),
    bonusStages:Array.from({length:R.bonusSpins},(_,i)=>({spin:i+1,conditionalMean:view(modes.bonus),unconditionalContribution:view(mul(bonusProbability,modes.bonus))})),
    exactMaximum:{basePoints:maxBase.points,bonusSpinPoints:maxBonus.points,triggeringBasePoints:triggerMaximum,paidRoundPoints:maxRoundPoints,returnMultiple:view(q(maxRoundPoints,100)),baseStops:witness,bonusStops:bestStop,dominance:'Nondecreasing paytables and additive nonnegative WILD increments permit replacing non-SCATTER columns by full x3 WILD. Any field with four/five SCATTER reels is dominated by a three-SCATTER field. All 2160 remaining fields are enumerated; all eight bonus maxima can occur independently.'},
    stakeChecks,interpretation:'Exact rational expectation of the finite candidate, including all eight free continuations and every allowed stake. No sampled confidence interval is attached to exact RTP. This is not qualification of a server RNG, saved sessions, common-wallet settlement, host compatibility or a production module.'};
}
export function nudgeRtpError(report,policy){
  const [n,d]=report.exactRtp.fraction.split('/').map(BigInt),difference=sub(q(n,d),q(Math.round(policy.target*1000),1000));
  return cmp(q(difference.n<0n?-difference.n:difference.n,difference.d),q(Math.round(policy.tolerance*1000),1000))>0?'Candidate RTP outside registered target/tolerance':null;
}
const root=new URL('../../',import.meta.url);
export async function wildNudgeModelReport(){
  const registry=JSON.parse(await readFile(new URL('scripts/game-math/rtp-policy.json',root),'utf8')),policy=registry.profiles['studio-wild-nudge'];
  assert(['model-only','qualified'].includes(policy.releaseStatus));assert.equal(policy.rulesVersion,1);assert.equal(policy.progressVersion,1);
  assert.deepEqual(policy.stakes,WILD_NUDGE_STAKES.map(Number));assert.deepEqual(policy.choices,['normal']);
  assert.equal(policy.target,.96);assert.equal(policy.tolerance,.002);
  const report=analyzeWildNudge();assert.equal(nudgeRtpError(report,policy),null);
  report.policySha256=createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  report.sourceHashes={};for(const source of WILD_NUDGE_SOURCES)report.sourceHashes[source]=createHash('sha256').update((await readFile(new URL(source,root),'utf8')).replace(/\r\n/g,'\n')).digest('hex');
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const report=await wildNudgeModelReport(),destination=new URL('docs/concepts/wild-nudge/math-model.json',root);
  if(process.argv.includes('--write'))await writeFile(destination,JSON.stringify(report,null,2)+'\n');
  if(process.argv.includes('--verify'))assert.deepEqual(JSON.parse(await readFile(destination,'utf8')),report,'Candidate evidence is stale or altered');
  console.log(JSON.stringify({scope:report.scope,releaseQualified:report.releaseQualified,exactRtp:report.exactRtp,components:report.components,bonusProbability:report.bonusProbability,probabilityOfAnyNudge:report.probabilityOfAnyNudge,exactMaximum:report.exactMaximum,stakeCount:report.stakeChecks.length},null,2));
}
