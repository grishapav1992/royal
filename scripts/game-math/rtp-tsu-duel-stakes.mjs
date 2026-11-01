import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('../../',import.meta.url));
const compiled=await build({stdin:{contents:"export * from './server/pvp/tsu-duel.ts'; export * from './src/shared/tsuDuel.ts'; export * from './server/finance/pvp-money.ts';",resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {createTsuDuel,lockTsuDuel,advanceTsuDuel,publicTsuDuel,tsuDuelPayout,TSU_DUEL_STAKES,applyPvpMoneyEvent}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].contents).toString('base64'));
export function tsuDuelCoverage(rulesVersion=4){
  const target=rulesVersion===3?3:2;
  const signs=['rock','scissors','paper'],winners=[[null,0,1],[1,null,0],[0,1,null]];let cases=0,privacyChecks=0;
  for(let x=0;x<target;x++)for(let y=0;y<target;y++)for(let a=0;a<3;a++)for(let b=0;b<3;b++)for(const first of [0,1]){
    let state=createTsuDuel(1000,rulesVersion);state.score=[x,y];const choices=[signs[a],signs[b]];
    for(const side of [first,1-first]){state=lockTsuDuel(state,side,{kind:'choose',round:1,choice:choices[side]},1001);const view=publicTsuDuel(state,1-side,false);assert(!('choices'in view));assert.equal(view.last,null);privacyChecks++;}
    assert.deepEqual(state.score,[x,y]);assert.equal(state.stage,'countdown');assert.equal(advanceTsuDuel(state,state.endsAt-1),state);
    const result=advanceTsuDuel(state,state.endsAt),winner=winners[a][b],score=[x,y];if(winner!==null)score[winner]++;
    assert.deepEqual(result.score,score);assert.deepEqual(result.last.choices,choices);assert.equal(result.last.winner,winner);assert.equal(result.phase,score.includes(target)?'finished':'playing');assert.equal(result.rulesVersion,rulesVersion);cases++;
  }
  return {targets:[target],scores:target*target,pairsPerScore:9,orders:2,cases,privacyChecks};
}
export function tsuDuelStakeResults(policy){
  const participants=[0,1].map(i=>({accountId:`${i+1}1111111-1111-4111-8111-111111111111`,userId:'player'+i}));const results=[];
  for(const choice of policy.choices)for(const stakeUnits of policy.stakes){
    const micro=String(stakeUnits*10000);assert(TSU_DUEL_STAKES.includes(micro));const decisive=choice.includes('win')||/^(disconnect|resign|timeout)-/.test(choice),winner=choice.endsWith('-right')||choice==='right-win'?1:0;
    const accounts=new Map(),balances=new Map(),base={version:1,matchId:'33333333-3333-4333-8333-333333333333',gameId:'tsu-e-fa',stakeUnits:micro,createdAt:1};
    const apply=event=>{for(const e of applyPvpMoneyEvent(event,accounts))balances.set(e.account,(balances.get(e.account)??0n)+BigInt(e.units));};
    for(const p of participants)apply({...base,action:'hold',participants:[p],winnerId:null,reason:'hold'});
    apply({...base,action:decisive?'settle':'refund',participants,winnerId:decisive?participants[winner].accountId:null,reason:choice.startsWith('disconnect')?'disconnect':choice.startsWith('resign')?'resign':choice.startsWith('timeout')?'timeout':decisive?'win':choice});
    const fee=decisive?stakeUnits/10:0,pot=stakeUnits*2,credits=[0,1].map(i=>Number((balances.get('player:player'+i)??0n)+BigInt(micro))/10000);
    assert.equal(Number(balances.get('house')??0n)/10000,fee);assert.equal(credits[0]+credits[1]+fee,pot);
    assert.deepEqual(tsuDuelPayout(micro),{potUnits:String(pot*10000),feeUnits:String(stakeUnits*1000),payoutUnits:String(stakeUnits*19000)});
    for(const [account,n]of balances)if(account.startsWith('pvp:'))assert.equal(n,0n);
    results.push({choice,stakeUnits,kind:'exact-aggregate-pot-return',potCents:pot,feeCents:fee,creditsCents:credits,potReturn:decisive?.95:1});
  }
  return results;
}
export async function qualifyTsuDuelStakes(policy,precisionLaw){
  const root=fileURLToPath(new URL('../../',import.meta.url)),child=spawn(process.execPath,['--import','tsx','scripts/database-test.ts','--import','tsx','scripts/game-math/tsu-duel-wallet.ts','--rules',String(policy.rulesVersion)],{cwd:root,env:process.env,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='',error='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error+=b);
  const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject);});assert.equal(code,0,error+output);
  const line=output.split('\n').find(l=>l.startsWith('TSU_WALLET_JSON '));assert(line,'Missing wallet evidence');
  const walletEvidence=JSON.parse(line.slice(16)),results=tsuDuelStakeResults(policy);
  return {method:policy.method,precisionLaw,rulesCoverage:tsuDuelCoverage(policy.rulesVersion),results,walletEvidence,serverReplayChecks:walletEvidence.cases,
    replay:{coverage:results.map(r=>({choice:r.choice,stakeUnits:r.stakeUnits,sha256:createHash('sha256').update(JSON.stringify(r)).digest('hex')}))},
    interpretation:'Exact aggregate pot return: 95% on a decisive match, 100% on refund. Individual return depends on both players. No probability or statistical RTP estimate is claimed.'};
}
export function validateTsuDuelStakes(inputs,proof,law){
  const p=inputs.policy;assert.equal(proof.gameId,'tsu-e-fa');assert([3,4].includes(p.rulesVersion));assert.equal(proof.rulesVersion,p.rulesVersion);assert.equal(proof.progressVersion,1);assert.equal(proof.schemaVersion,1);assert.equal(p.stakePolicyVersion,1);
  assert.equal(p.method,proof.method);assert.equal(p.target,.95);assert.equal(p.refundReturn,1);assert.equal(p.commissionBasisPoints,500);
  assert.deepEqual(p.stakes,[10,20,50,100,200,500,1000,2000,5000]);assert.deepEqual(p.choices,['left-win','right-win','draw','cancel','disconnect-left','disconnect-right','expired','server','resign-left','resign-right','timeout-left','timeout-right']);
  assert.equal(proof.policySha256,inputs.policySha256);assert.deepEqual(proof.sourceHashes,inputs.sourceHashes);assert.deepEqual(proof.precisionLaw,law);assert.deepEqual(proof.rulesCoverage,tsuDuelCoverage(p.rulesVersion));
  assert.equal(proof.walletEvidence.rulesVersion,p.rulesVersion);
  const results=tsuDuelStakeResults(p);assert.deepEqual(proof.results,results);assert.deepEqual(proof.replay.coverage,results.map(r=>({choice:r.choice,stakeUnits:r.stakeUnits,sha256:createHash('sha256').update(JSON.stringify(r)).digest('hex')})));
  assert.equal(proof.walletEvidence.passed,true);assert.equal(proof.walletEvidence.clientVerified,true);assert.equal(proof.walletEvidence.replayAndRestartCases,108);assert.equal(proof.walletEvidence.cases,108);assert.equal(proof.walletEvidence.oneDebitAndCredit,true);assert.equal(proof.serverReplayChecks,108);assert.match(proof.walletEvidence.sha256,/^[a-f0-9]{64}$/);return true;
}
