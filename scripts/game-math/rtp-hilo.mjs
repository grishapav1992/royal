import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const HILO_METHOD = 'exact-two-guess-hilo-v1';
export const HILO_STAKES = [1000,5000,10000,50000,1000000,2000000,5000000,10000000];
const directions = ['higher','lower'];
const count = (rank,direction) => direction === 'higher' ? 13-rank : rank-1;
const won = (rank,next,direction) => direction === 'higher' ? next>rank : next<rank;
export const hiloChoices = Array.from({length:13},(_,i)=>i+1).flatMap(rank=>directions.filter(direction=>count(rank,direction)>0).map(direction=>rank+':'+direction));
const digest = value => createHash('sha256').update(value).digest('hex');
const jsonHash = rows => digest(rows.map(row=>JSON.stringify(row)+'\n').join(''));
const paid = (stake,n1,n2) => BigInt(stake)*99n*(n2===undefined?13n:169n)/(100n*BigInt(n1)*BigInt(n2??1));
const outcomeTable = (stake,rank,direction) => {
  const rows=[],n1=count(rank,direction);
  for(let next=1;next<=13;next++) {
    if(!won(rank,next,direction)){rows.push([next,'lost','0']);continue;}
    rows.push([next,'cashout',String(paid(stake,n1))]);
    for(const second of directions.filter(value=>count(next,value)>0))for(let last=1;last<=13;last++)
      rows.push([next,second,last,String(won(next,last,second)?paid(stake,n1,count(next,second)):0n)]);
  }
  return rows;
};
function policyRow(stakeUnits,choice) {
  const [text,direction]=choice.split(':'),rank=Number(text),n1=count(rank,direction),stake=BigInt(stakeUnits);
  let minimum=0n,maximum=0n;const states=[];
  for(let next=1;next<=13;next++) {
    if(!won(rank,next,direction))continue;
    const options=[{action:'cashout',expectedNumerator:String(13n*paid(stake,n1))},
      ...directions.filter(value=>count(next,value)>0).map(second=>({action:second,expectedNumerator:String(BigInt(count(next,second))*paid(stake,n1,count(next,second)))}))];
    const values=options.map(option=>BigInt(option.expectedNumerator)),low=values.reduce((a,b)=>a<b?a:b),high=values.reduce((a,b)=>a>b?a:b);
    minimum+=low;maximum+=high;states.push({rank:next,conditionalDenominator:13,options});
  }
  const denominator=169n*stake;
  // Every terminal floor loses less than one integer unit, whatever stopping policy is used.
  assert(maximum*100n<=denominator*99n);
  assert(minimum*100n>denominator*99n-16900n);
  const rows=outcomeTable(stake,rank,direction),rtpBounds=[Number(minimum)/Number(denominator),Number(maximum)/Number(denominator)];
  return {choice,stakeUnits,states,returnDenominator:String(denominator),minimumReturnNumerator:String(minimum),maximumReturnNumerator:String(maximum),
    rtp:rtpBounds[1],rtpBounds,outcomes:rows.length,sha256:jsonHash(rows)};
}
function validatePolicy(policy) {
  assert.equal(policy.method,HILO_METHOD);assert.equal(policy.rulesVersion,1);assert.equal(policy.progressVersion,1);
  assert.equal(policy.target,.99);assert.equal(policy.tolerance,.001);assert.deepEqual(policy.stakes,HILO_STAKES);assert.deepEqual(policy.choices,hiloChoices);
  assert.equal(policy.serverReplayRoundsPerSeed,64);assert.equal(new Set(policy.seeds).size,2);assert(policy.seeds.every(Number.isSafeInteger));
}
export function hiloQualificationEvidence(policy) {
  validatePolicy(policy);
  return {method:HILO_METHOD,analysis:{ranks:13,maxGuesses:2,rankProbability:'1/13',suits:'Four cosmetic suits; settlement depends only on ranks.',
    targetBeforeIntegerFloor:'99/100',settlement:'floor(stake * 99 * 13^guesses / (100 * product(winning rank counts)))',
    completeRound:'One paid start, at least one guess, optional cashout after the first success, automatic settlement after the second guess. No additional paid continuations.',
    adaptivePolicies:'Backward induction compares cashout and every legal higher/lower choice at every reachable first-success rank. Summing conditional minima and maxima covers every history-dependent stopping policy.',
    integerBounds:'For every positive integer stake s and every legal complete-round strategy: 0.99 - 1/s < RTP <= 0.99. Listed bounds are exact integer-settlement extrema, not sampling estimates.',
    denominator:169,initialChoices:24},results:policy.choices.flatMap(choice=>policy.stakes.map(stake=>policyRow(stake,choice)))};
}
const uuid = n => '10000000-0000-4000-8000-'+String(n).padStart(12,'0');
function streamRecords(stake,choice,seed,rounds) {
  const [text,first]=choice.split(':'),rank=Number(text),rows=[];let state=seed>>>0;
  const random=max=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)%max;};
  for(let i=0;i<rounds;i++){
    const next=random(13)+1,last=random(13)+1,stop=random(2)===0,allowed=directions.filter(direction=>count(next,direction)>0),second=allowed[random(allowed.length)];
    const payout=!won(rank,next,first)?0n:stop?paid(stake,count(rank,first)):won(next,last,second)?paid(stake,count(rank,first),count(next,second)):0n;
    rows.push([next,last,stop,second,String(payout)]);
  }
  return rows;
}
export async function qualifyHilo(policy) {
  const evidence=hiloQualificationEvidence(policy);
  const api=await import('../../server/games/casinoSessions.ts'),shared=await import('../../src/shared/casinoSessions.ts');
  const {DEMO_BETS}=await import('../../src/shared/demoWallet.ts'),{USDT_BETS}=await import('../../src/shared/usdtWallet.ts');
  assert.deepEqual([...new Set([...DEMO_BETS.map(value=>value*100),...USDT_BETS.map(Number)])].sort((a,b)=>a-b),policy.stakes);
  assert.equal(shared.HILO_MAX_GUESSES,2);
  let serial=0,serverReplayChecks=0;const serverReplay=[];
  function start(stake,ranks,suits=[0,0,0]){
    const action={id:uuid(++serial),gameId:'github-hilo',action:'start',stakeUnits:String(stake),settings:{}};
    const draws=ranks.flatMap((rank,index)=>[rank-1,suits[index]]);let index=0;
    const session=api.startSession(action,max=>{const value=draws[index++];assert(value>=0&&value<max);return value;});
    assert.equal(index,6);assert(api.verifySessionTransition(undefined,action,session));assert(shared.validCasinoSession(api.publicSession(session)));
    assert.equal(api.sessionReservation(session),BigInt(stake)*168n);return session;
  }
  function move(session,action){
    const op={id:uuid(++serial),gameId:'github-hilo',sessionId:session.id,...action},next=api.advanceSession(session,op);
    assert(api.verifySessionTransition(session,op,next));assert(shared.validCasinoSession(api.publicSession(next)));return next;
  }
  function payout(session,expected){assert.equal(api.sessionPayout(session),expected);assert.equal(api.publicSession(session).payoutUnits,String(expected));return String(expected);}
  for(const row of evidence.results){
    const [text,direction]=row.choice.split(':'),rank=Number(text),n1=count(rank,direction),rows=[];
    for(let next=1;next<=13;next++){
      const first=move(start(row.stakeUnits,[rank,next,1]),{action:'pick',choice:direction});
      if(!won(rank,next,direction)){assert.equal(first.state,'lost');rows.push([next,'lost',payout(first,0n)]);continue;}
      const cashout=move(first,{action:'cashout'});rows.push([next,'cashout',payout(cashout,paid(row.stakeUnits,n1))]);
      for(const second of directions.filter(value=>count(next,value)>0))for(let last=1;last<=13;last++){
        const middle=move(start(row.stakeUnits,[rank,next,last]),{action:'pick',choice:direction}),settled=move(middle,{action:'pick',choice:second});
        assert.equal(settled.state,won(next,last,second)?'cashed_out':'lost');assert.equal(api.sessionReservation(settled),0n);
        rows.push([next,second,last,payout(settled,won(next,last,second)?paid(row.stakeUnits,n1,count(next,second)):0n)]);
      }
    }
    assert.equal(jsonHash(rows),row.sha256);serverReplayChecks+=rows.length;
    // All 64 suit triples are checked independently of the rank enumeration.
    for(let a=0;a<4;a++)for(let b=0;b<4;b++)for(let c=0;c<4;c++){
      const next=direction==='higher'?rank+1:rank-1,second=next<13?'higher':'lower',last=second==='higher'?next+1:next-1;
      const first=move(start(row.stakeUnits,[rank,next,last],[a,b,c]),{action:'pick',choice:direction});
      payout(move(first,{action:'pick',choice:second}),paid(row.stakeUnits,n1,count(next,second)));serverReplayChecks++;
    }
    const streams=[];
    for(const seed of policy.seeds){
      const records=streamRecords(row.stakeUnits,row.choice,seed,policy.serverReplayRoundsPerSeed);
      for(const [next,last,stop,second,expected] of records){
        let current=move(start(row.stakeUnits,[rank,next,last]),{action:'pick',choice:direction});
        if(current.state==='active')current=move(current,stop?{action:'cashout'}:{action:'pick',choice:second});
        payout(current,BigInt(expected));serverReplayChecks++;
      }
      streams.push({seed,rounds:records.length,sha256:jsonHash(records)});
    }
    serverReplay.push({choice:row.choice,stakeUnits:row.stakeUnits,outcomes:rows.length,sha256:jsonHash(rows),suitChecks:64,streams});
  }
  return {...evidence,serverReplayChecks,serverReplay};
}
export function validateHiloProof(policy,proof) {
  const expected=hiloQualificationEvidence(policy);assert.equal(proof.method,expected.method);assert.deepEqual(proof.analysis,expected.analysis);assert.deepEqual(proof.results,expected.results);
  assert.equal(proof.serverReplay.length,expected.results.length);let checks=0;
  for(let i=0;i<expected.results.length;i++){
    const result=expected.results[i],row=proof.serverReplay[i];assert.equal(row.choice,result.choice);assert.equal(row.stakeUnits,result.stakeUnits);
    assert.equal(row.outcomes,result.outcomes);assert.equal(row.sha256,result.sha256);assert.equal(row.suitChecks,64);
    assert.deepEqual(row.streams,policy.seeds.map(seed=>({seed,rounds:policy.serverReplayRoundsPerSeed,sha256:jsonHash(streamRecords(result.stakeUnits,result.choice,seed,policy.serverReplayRoundsPerSeed))})));
    checks+=row.outcomes+64+policy.seeds.length*policy.serverReplayRoundsPerSeed;
  }
  assert.equal(proof.serverReplayChecks,checks);return true;
}
