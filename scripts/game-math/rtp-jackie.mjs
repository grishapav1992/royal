import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const RISKS = ['safe','sharp','extreme'], CHANCES = [75,60,45];
export const JACKIE_METHOD = 'exact-jackie-series-v1';
const quote = (stake,path) => BigInt(stake)*99n*100n**BigInt(path.length)/(100n*path.reduce((p,r)=>p*BigInt(CHANCES[RISKS.indexOf(r)]),1n));
export function jackieEvidence(policy) {
  assert.equal(policy.method,JACKIE_METHOD); assert.equal(policy.target,.99); assert.equal(policy.tolerance,.0003);
  assert.deepEqual(policy.stakes,[1000,5000,10000,50000]); assert.deepEqual(policy.choices,RISKS);
  const results=[];
  for(const stake of policy.stakes){
    let min=1,max=0,paths=0;const hash=createHash('sha256');
    function visit(path,probability){
      if(path.length){const returned=quote(stake,path),numerator=returned*path.reduce((p,r)=>p*BigInt(CHANCES[RISKS.indexOf(r)]),1n),denominator=BigInt(stake)*100n**BigInt(path.length);assert(numerator*100n<=denominator*99n);assert(numerator*10000n>=denominator*9897n);const rtp=Number(numerator)/Number(denominator);min=Math.min(min,rtp);max=Math.max(max,rtp);paths++;hash.update(JSON.stringify([path,String(returned)])+'\n');}
      if(path.length<5)for(let i=0;i<3;i++)visit([...path,RISKS[i]],probability*CHANCES[i]/100);
    }
    visit([],1);assert.equal(paths,363);assert(min>=policy.target-policy.tolerance&&max<=policy.target+1e-12);
    // Every public successful path permits stopping or a new choice. Backward induction
    // covers every adaptive stopping/switching strategy, not just constant-risk paths.
    const optimal=(path)=>{
      const stop=path.length?[quote(stake,path),BigInt(stake)]:[0n,1n];
      if(path.length===5)return stop;
      return RISKS.map((r,i)=>{const [n,d]=optimal([...path,r]);return[n*BigInt(CHANCES[i]),d*100n];}).reduce((best,row)=>row[0]*best[1]>best[0]*row[1]?row:best,stop);
    };
    const [optimalNumerator,optimalDenominator]=optimal([]);assert(optimalNumerator*100n<=optimalDenominator*99n);const optimalRtp=Number(optimalNumerator)/Number(optimalDenominator);
    results.push({stakeUnits:stake,paths,minRtp:min,maxRtp:max,optimalRtp,sha256:hash.digest('hex')});
  }
  return {method:JACKIE_METHOD,analysis:{method:'Finite enumeration and backward induction; one house edge, integer final settlement, all 363 risk paths and all stopping points.',cosmeticChoices:12,maximumSteps:5,maximumAdditionalCost:0},results};
}
export async function qualifyJackie(policy){
  const [{startJackie,moveJackie},{JACKIE_COSTUMES,JACKIE_LOCATIONS,validJackieView}]=await Promise.all([import('../../server/games/jackieChan.ts'),import('../../src/shared/jackieChan.ts')]);
  const exact=jackieEvidence(policy);let checks=0;const replay=createHash('sha256');
  for(const stake of policy.stakes){
    function visit(path){
      if(path.length){
        let v=startJackie({jackie:{risk:path[0],costume:'master',location:'restaurant'}},String(stake),0,()=>0);
        for(const risk of path.slice(1))v=moveJackie(v,String(stake),'jackie-fight',v.combat.revision,()=>0,risk);
        if(path.length<5)v=moveJackie(v,String(stake),'cashout',v.combat.revision,()=>{throw Error('Cashout cannot draw');});
        assert.equal(v.combat.availableUnits,String(quote(stake,path)));assert(validJackieView(v,String(stake)));checks++;replay.update(JSON.stringify(v)+'\n');
      }
      if(path.length<5)for(const risk of RISKS)visit([...path,risk]);
    }
    visit([]);
  }
  for(const stake of policy.stakes)for(const costume of JACKIE_COSTUMES)for(const location of JACKIE_LOCATIONS)for(let i=0;i<3;i++)for(let roll=0;roll<100;roll++){
    let n=0;const draw=max=>{const v=n++===0?roll:0;assert(v<max);return v;};
    const v=startJackie({jackie:{risk:RISKS[i],costume:costume.id,location:location.id}},String(stake),90000,draw);
    assert.equal(v.combat.shots[0].goal,roll<CHANCES[i]);assert(validJackieView(v,String(stake)));checks++;
    replay.update(JSON.stringify([stake,costume.id,location.id,roll,v])+'\n');
  }
  for(const seed of policy.seeds){
    let state=seed>>>0;const draw=max=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return Math.floor(state/4294967296*max);};
    for(const stake of policy.stakes)for(const risk of RISKS)for(let round=0;round<64;round++){
      let v=startJackie({jackie:{risk,costume:'master',location:'restaurant'}},String(stake),0,draw);
      while(v.combat.status==='playing')v=moveJackie(v,String(stake),draw(3)===0?'cashout':'jackie-fight',v.combat.revision,draw,RISKS[draw(3)]);
      const path=v.combat.shots.filter(s=>s.goal).map(s=>s.risk);
      assert.equal(v.combat.availableUnits,v.combat.status==='lost'?'0':String(quote(stake,path)));
      assert(validJackieView(v,String(stake)));checks++;replay.update(JSON.stringify(v)+'\n');
    }
  }
  return {...exact,serverReplayChecks:checks,serverReplay:{seeds:policy.seeds,sha256:replay.digest('hex')}};
}
