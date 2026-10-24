// Independent v3 campaign audit. No production writes or qualification-proof changes.
import assert from 'node:assert/strict';
import {createHash,createCipheriv} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {BOSSES,HEROES,MAX_ROUND_SPINS,NEOPOLIS_MATH,initialTeam,playNeopolisSpin} from '../../src/shared/neopolisMath.ts';
import {seededRandom} from '../../src/shared/draconaMath.ts';
import {preflight,summary} from './rtp-simulation.mjs';
import {rtpInputs,sourceDigest} from './rtp-gate.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
const cyclesPerSeed=Number(option('cycles-per-seed','10000'));
const seeds=option('seeds','2026102401,2026102419').split(',').map(Number);
const rng=option('rng','mulberry32');
assert(['mulberry32','aes-ctr'].includes(rng));
assert(Number.isSafeInteger(cyclesPerSeed)&&cyclesPerSeed>1);
assert(seeds.length>=2&&new Set(seeds).size===seeds.length&&seeds.every(n=>Number.isSafeInteger(n)&&n>0&&n<2**32-2*1000003));
const output=resolve(option('output','artifacts/work/neopolis-boss-audit/math.json'));
// Separate AES keys avoid overlapping phase-shifted streams of a 32-bit generator.
function aesRandom(seed){
  const key=createHash('sha256').update('royal-neopolis-audit-v1:'+seed).digest();
  const cipher=createCipheriv('aes-256-ctr',key,Buffer.alloc(16)),zeros=Buffer.alloc(65536);
  let bytes=Buffer.alloc(0),cursor=0;
  return ()=>{
    if(cursor===bytes.length){bytes=cipher.update(zeros);cursor=0;}
    const value=bytes.readUInt32LE(cursor);cursor+=4;return value/4294967296;
  };
}
if(rng==='aes-ctr'){
  const a=aesRandom(seeds[0]),b=aesRandom(seeds[0]),c=aesRandom(seeds[1]);let differs=false;
  for(let i=0;i<17000;i++){const x=a(),y=b(),z=c();assert(x>=0&&x<1);assert.equal(x,y);differs ||= x!==z;}
  assert(differs,'Distinct keys must produce distinct streams');
}
const inputs=await rtpInputs(root,'studio-neopolis'),policy=inputs.policy;
assert(seeds.every(seed=>!policy.seeds.includes(seed)),'Use independent audit seeds');
const scriptPath=fileURLToPath(import.meta.url),scriptHash=sourceDigest(await readFile(scriptPath));
const moment=()=>({samples:0,paidRounds:0,reward:0,cost:0,rewardSquared:0,rewardCost:0,costSquared:0});
const add=(m,reward,cost)=>{m.samples++;m.paidRounds+=cost;m.reward+=reward;m.cost+=cost;m.rewardSquared+=reward*reward;m.rewardCost+=reward*cost;m.costSquared+=cost*cost;};
const distribution=values=>{
  values.sort((a,b)=>a-b);
  const q=p=>values[Math.floor((values.length-1)*p)];
  return {count:values.length,min:values[0]??null,median:q(.5)??null,p95:q(.95)??null,p99:q(.99)??null,max:values.at(-1)??null,mean:values.length?values.reduce((n,v)=>n+v,0)/values.length:null};
};
const serverReplayChecks=preflight('studio-neopolis',policy);
console.log(JSON.stringify({phase:'server-preflight',serverReplayChecks}));
const report={schemaVersion:1,gameId:'studio-neopolis',rulesVersion:3,startedAt:new Date().toISOString(),
 sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceHashes:inputs.sourceHashes,
 policySha256:inputs.policySha256,auditSourceSha256:scriptHash,rngSourceSha256:sourceDigest(await readFile(resolve(root,'src/shared/draconaMath.ts'))),configuration:{cyclesPerSeed,seeds,rng,stakes:policy.stakes,heroes:HEROES},
 method:'Independent regenerative team cycles. All collection costs and complete bonuses are included. Six stakes share entropy but settle separately in integer cents. Confidence intervals use independent cycle reward/cost residuals. Conditional campaign payouts are not RTP.',
 serverReplayChecks,maximumFreeSpins:MAX_ROUND_SPINS-1,heroes:[],
 invariants:{integerSettlement:true,oneDamagePerSpin:true,oneAwardPerDefeatedBoss:true,remainingBudget:true,finiteCampaign:true,uniquePowersPerSpin:true,noScatterRetriggersInFreeSpins:true},
 acceptance:{rtpWithinRegisteredBudget:true},productionWrites:false,qualificationProofModified:false};
const denominator=40n*BigInt(NEOPOLIS_MATH.payDenominator),sampleStakeIndex=policy.stakes.indexOf(10000);
assert(sampleStakeIndex>=0);
for(const [heroIndex,hero] of HEROES.entries()){
  const moments=policy.stakes.map(moment),paidUnits=policy.stakes.map(()=>0),freeUnits=policy.stakes.map(()=>0);
  const stages=BOSSES.map(b=>({boss:b.id,entered:0,defeated:0,combatSpins:0,damagingSpins:0,payoutInStakes:0,remainingAfterDefeat:[]}));
  const campaignPayout=[],campaignFreePayout=[],campaignSpins=[],tailPayout=[];
  const outcomes=[0,0,0,0],streams=[];
  let paidRounds=0,freeSpins=0,caps=0,tailSpins=0,winningFreeSpins=0,cycles=0;
  for(const seed of seeds){
    const actualSeed=seed+heroIndex*1000003,random=(rng==='aes-ctr'?aesRandom:seededRandom)(actualSeed);let streamPaid=0;
    for(let cycle=0;cycle<cyclesPerSeed;cycle++){
      let team=initialTeam(hero),cost=0;const rewards=policy.stakes.map(()=>0);
      do{
        let battle=null,spins=0,free=0,triggered=false,tail=0;
        const units=policy.stakes.map(()=>0),bonusUnits=policy.stakes.map(()=>0),defeated=new Set();
        do{
          const before=battle,result=playNeopolisSpin(team,battle,random);
          team=result.team;battle=result.battle;spins++;
          assert(spins<=MAX_ROUND_SPINS&&Number.isSafeInteger(result.points));
          assert.equal(new Set(result.activated).size,result.activated.length);
          assert.equal(result.free,!!before);
          const kills=result.frames.filter(frame=>frame.kind==='boss-defeated');
          const hits=result.frames.filter(frame=>frame.kind==='boss-hit');
          assert.equal(hits.length,before&&result.activated.length&&!before.won?1:0);
          assert(kills.length<=1);
          if(before){
            assert(!result.triggered,'A free spin must not open a fresh campaign');
            assert(before.remaining>0);free++;freeSpins++;
            const boss=before.boss??0;
            if(before.won){tailSpins++;assert.equal(kills.length,0);}
            else stages[boss].combatSpins++;
            if(hits.length)stages[boss].damagingSpins++;
            let earned=0;
            if(kills.length){
              assert(!defeated.has(boss),'Boss reward repeated');defeated.add(boss);
              stages[boss].defeated++;earned=3+(boss<2?BOSSES[boss+1].spins:0);
              assert.equal(kills[0].battle.defeated,boss+1);
              if(boss<2){assert.equal(battle.boss,boss+1);stages[boss+1].entered++;}
              else assert.equal(battle.won,true);
              stages[boss].remainingAfterDefeat.push(battle.remaining);
            }
            assert.equal(battle.remaining,before.remaining-1+earned,'Free spin budget differs');
            assert.equal(battle.played,before.played+1);
          }else{
            paidRounds++;streamPaid++;cost++;
            if(result.triggered){assert(!triggered);triggered=true;stages[0].entered++;assert.equal(battle.remaining,10);}
            else assert.equal(battle,null);
          }
          for(let i=0;i<policy.stakes.length;i++){
            const stake=policy.stakes[i],raw=Number(BigInt(stake)*BigInt(result.points)/denominator);
            const amount=Math.min(raw,stake*3000-units[i]);assert(Number.isSafeInteger(amount)&&amount>=0);
            units[i]+=amount;assert(units[i]<=stake*3000);
            if(before){bonusUnits[i]+=amount;freeUnits[i]+=amount;}else paidUnits[i]+=amount;
            if(i===sampleStakeIndex&&before){
              if(amount>0)winningFreeSpins++;
              if(before.won)tail+=amount/stake;else stages[before.boss??0].payoutInStakes+=amount/stake;
            }
          }
          const capped=units.map((n,i)=>n===policy.stakes[i]*3000);
          if(capped.some(Boolean)){
            assert(capped.every(Boolean),'Cross-stake cap diverged: qualify each stake independently');
            caps++;team={...team,complete:true};break;
          }
        }while(battle&&battle.remaining);
        for(let i=0;i<rewards.length;i++)rewards[i]+=units[i]/policy.stakes[i];
        if(triggered){
          assert(free<=45);assert.equal(defeated.size,battle.defeated);
          outcomes[defeated.size]++;campaignPayout.push(units[sampleStakeIndex]/10000);
          campaignFreePayout.push(bonusUnits[sampleStakeIndex]/10000);campaignSpins.push(free);tailPayout.push(tail);
        }
        assert(cost<100000,'Team cycle did not finish');
      }while(!team.complete);
      for(let i=0;i<moments.length;i++)add(moments[i],rewards[i],cost);
      cycles++;
      if((cycle+1)%500===0)console.log(JSON.stringify({phase:'simulation',hero,seed:actualSeed,cycles,paidRounds,freeSpins,rtp:summary(moments[sampleStakeIndex]).rtp}));
    }
    streams.push({seed:actualSeed,cycles:cyclesPerSeed,paidRounds:streamPaid});
  }
  const results=moments.map((m,i)=>{
    const row={stakeUnits:policy.stakes[i],...summary(m),paidContribution:paidUnits[i]/(paidRounds*policy.stakes[i]),bonusContribution:freeUnits[i]/(paidRounds*policy.stakes[i])};
    row.withinRegisteredBudget=Math.abs(row.rtp-policy.target)<=policy.tolerance&&row.interval95[1]<=policy.maxUpper95&&(row.interval95[1]-row.interval95[0])/2<=policy.maxHalfWidth95;
    if(!row.withinRegisteredBudget)report.acceptance.rtpWithinRegisteredBudget=false;
    return row;
  });
  report.heroes.push({hero,cycles,paidRounds,freeSpins,streams,results,bonus:{triggers:campaignPayout.length,triggerRate:campaignPayout.length/paidRounds,
    clearedBossCounts:outcomes,threeBossClearRate:outcomes[3]/campaignPayout.length,spins:distribution(campaignSpins),
    positiveFreeSpinRate:winningFreeSpins/freeSpins,payoutInStakes:distribution(campaignPayout),freePayoutInStakes:distribution(campaignFreePayout),caps,
    victoryTailSpins:tailSpins,victoryTailPayoutInStakes:distribution(tailPayout),stages:stages.map(stage=>({...stage,remainingAfterDefeat:distribution(stage.remainingAfterDefeat)}))}});
}
assert.deepEqual(await rtpInputs(root,'studio-neopolis'),inputs,'Qualified sources changed during audit');
assert.equal(sourceDigest(await readFile(scriptPath)),scriptHash,'Audit script changed during run');
report.completedAt=new Date().toISOString();await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,acceptance:report.acceptance,results:report.heroes.map(h=>({hero:h.hero,paidRounds:h.paidRounds,rtp:h.results[sampleStakeIndex].rtp,interval95:h.results[sampleStakeIndex].interval95,bonus:h.bonus}))}));
if(!report.acceptance.rtpWithinRegisteredBudget)process.exitCode=2;
