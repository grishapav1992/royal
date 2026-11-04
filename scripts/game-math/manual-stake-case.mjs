import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const MANUAL_STAKE_RANGE=Object.freeze({minimumCents:10,maximumCents:5000,stepCents:1});

// The original exhaustive loop, including every parser, runtime and settlement assertion.
export function manualStakeCase(runtime,game,policy,index){
  assert.deepEqual(policy.manualStakeRange,MANUAL_STAKE_RANGE);
  assert(Number.isInteger(index)&&index>=0&&index<policy.choices.length);
  const {runtimeRound,gameBetCents,parseGameStake,validGameStake}=runtime;
  const choice=policy.choices[index],seed=(policy.seeds[1]+index*7919)>>>0;
  const base=runtimeRound(game,choice,'100',seed),digest=createHash('sha256');
  const priced=choice.includes('-buy-')&&game==='studio-caribbean-treasures';
  const cost=priced?BigInt(base.view.costUnits):100n;
  for(let stake=10;stake<=5000;stake++){
    const units=String(stake),decimal=(stake/100).toFixed(2);
    assert(validGameStake(units));assert.equal(gameBetCents(stake/100),stake);assert.equal(parseGameStake(decimal),units);
    assert.equal(parseGameStake(decimal.replace('.',',')),units);
    const round=runtimeRound(game,choice,units,seed),normalizer=priced?BigInt(round.view.costUnits):BigInt(stake);
    assert.equal(round.exact.numerator*base.exact.denominator*cost,
      base.exact.numerator*round.exact.denominator*normalizer,'Complete-round normalized reward: '+game+'/'+choice+'/'+stake);
    const credited=BigInt(round.precision.creditedUnits),floor=round.exact.numerator/round.exact.denominator;
    assert(credited===floor||credited===floor+1n);assert(credited>=BigInt(round.base));
    digest.update(JSON.stringify([units,String(normalizer),round.precision,round.spins])+'\n');
  }
  return {choice,seed,denominations:4991,sha256:digest.digest('hex')};
}
