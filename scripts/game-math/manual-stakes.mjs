import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const built=await build({stdin:{contents:"export {runtimeRound} from './scripts/game-math/stake-runtime.mjs'; export {gameBetCents,parseGameStake,validGameStake} from './src/shared/gameStakes.ts';",resolveDir:root},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent'});
const {runtimeRound,gameBetCents,parseGameStake,validGameStake}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64'));
const cache=new Map();

export const MANUAL_STAKE_RANGE=Object.freeze({minimumCents:10,maximumCents:5000,stepCents:1});
export const MANUAL_WALLET_STAKES=Object.freeze([11,15,29,57,99,101,235,4999]);
export const walletStakes=policy=>policy.manualStakeRange
  ? [...new Set([...policy.stakes,...MANUAL_WALLET_STAKES])].sort((a,b)=>a-b) : policy.stakes;

/** Every accepted cent is replayed, with the same independent path at each price. */
export function qualifyManualStakes(game,policy){
  assert.deepEqual(policy.manualStakeRange,MANUAL_STAKE_RANGE);
  const key=game+JSON.stringify(policy);
  if(cache.has(key))return structuredClone(cache.get(key));
  const cases=[];let checks=0;
  for(const [index,choice]of policy.choices.entries()){
    const seed=(policy.seeds[1]+index*7919)>>>0,base=runtimeRound(game,choice,'100',seed),digest=createHash('sha256');
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
      digest.update(JSON.stringify([units,String(normalizer),round.precision,round.spins])+'\n');checks++;
    }
    cases.push({choice,seed,denominations:4991,sha256:digest.digest('hex')});
  }
  const result={range:MANUAL_STAKE_RANGE,checks,cases,
    interpretation:'Exhaustive accepted-cent runtime replay per allowed mode or choice. The reviewed stake-independent latent full-round model and exact rational final-ticket identity apply to every accepted cent. Bought Caribbean rounds normalize to the actual charged integer price. These replays are compatibility and scaling checks, not a statistical RTP estimate.'};
  cache.set(key,structuredClone(result));return result;
}

export function validateManualStakes(game,policy,proof){
  assert.deepEqual(proof,qualifyManualStakes(game,policy));return true;
}
