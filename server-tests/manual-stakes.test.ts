import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {gameBetCents,parseGameStake,validGameStake,validGameBet} from '../src/shared/gameStakes';
import {DemoWalletStore,WalletError} from '../server/demoWallet';
import {PostgresDatabase} from '../server/database';
import {startStarSpin,moveStarSpin} from '../src/shared/wildNudgeStakes';
import {expansionExactAward,makeRoundPrecision} from '../src/shared/roundPrecision';
import {startCaribbean} from '../server/games/caribbeanTreasures';

test('all 4991 cent amounts round trip through player and transport money',()=>{
  for(let cents=10;cents<=5000;cents++){
    const decimal=(cents/100).toFixed(2);
    assert.equal(parseGameStake(decimal),String(cents));assert.equal(parseGameStake(decimal.replace('.',',')),String(cents));
    assert.equal(gameBetCents(cents/100),cents);assert(validGameBet(cents/100));assert(validGameStake(String(cents)));
  }
  for(const input of ['','0.09','50.01','-1','1e1','NaN','1.001','1,2.3'])assert.equal(parseGameStake(input),undefined,input);
  for(const input of [0.1+0.2,0.09,50.01,NaN,Infinity,'0.15'])assert(!validGameBet(input));
  for(const input of ['015','15.0','15e0','9','5001'])assert(!validGameStake(input));
});

test('non-preset Star Spin bonus keeps every fraction through all eight free spins',()=>{
  for(const stake of ['11','15','29','235','4999']){
    const tape=[2,45,2,16,14,...Array(40).fill(2)];let result=startStarSpin({wildNudge:{mode:'normal'}},stake,()=>tape.shift()!);
    assert.equal(result.view.remaining,8);
    while(!result.ended){assert.equal(result.creditUnits,'0');result=moveStarSpin(result.view,stake,result.view.revision,'wild-nudge-spin',()=>tape.shift()!);}
    const exact=expansionExactAward({gameId:'studio-wild-nudge',stakeUnits:stake,returnedUnits:result.creditUnits,view:{wildNudge:result.view}});
    assert.equal(exact.numerator*100n,BigInt(stake)*860790n*exact.denominator);
    let sum=0n;for(let ticket=0n;ticket<exact.denominator;ticket++)sum+=BigInt(makeRoundPrecision(exact,result.creditUnits,()=>Number(ticket)).creditedUnits);
    assert.equal(sum,exact.numerator);
  }
});

test('odd-cent Caribbean stakes restore fractions split between all selected lines',()=>{
  for(const lines of [1,5,10,20] as const){
    const result=startCaribbean({lines,mode:'normal',stakeBasis:'total'},'15',maximum=>Math.min(maximum-1,3));
    const exact=expansionExactAward({gameId:'studio-caribbean-treasures',stakeUnits:'15',returnedUnits:result.creditUnits,view:{caribbean:result.view}});
    const points=result.view.spins.reduce((n,s)=>n+BigInt(s.frame.factorSum),0n);
    assert.equal(exact.numerator*BigInt(lines),15n*points*exact.denominator);
  }
});

test('awkward binary fractions debit exact cents and replay once after wallet restart',async()=>{
  const db=new PostgresDatabase(':memory:');let draws=0;
  try{
    await db.exec("CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY); INSERT INTO accounts VALUES('manual-stake') ON CONFLICT DO NOTHING");
    let wallet=new DemoWalletStore(db,()=>{draws++;return 7;});
    await wallet.operate('manual-stake',{id:randomUUID(),kind:'deposit',amount:1000});
    for(const amount of [.11,.15,.29,.57,2.35,49.99]){
      const request={id:randomUUID(),kind:'play' as const,gameId:'royal-roulette',rulesVersion:1,stakePolicyVersion:1 as const,amount,input:{bet:'number',number:7}};
      const before=(await wallet.snapshot('manual-stake')).balance,first=await wallet.operate('manual-stake',request),cents=gameBetCents(amount)!;
      assert.equal(first.gameRound!.stakeUnits,String(cents));assert.equal(Math.round(first.wallet.balance*100),Math.round(before*100)-cents+cents*36);
      const count=draws;wallet=new DemoWalletStore(db,()=>{throw Error('Replay cannot draw');});
      const replay=await wallet.operate('manual-stake',request);assert.deepEqual(replay.gameRound,first.gameRound);assert.equal(draws,count);
      await assert.rejects(wallet.operate('manual-stake',{...request,amount:amount+.01}),e=>e instanceof WalletError);
      wallet=new DemoWalletStore(db,()=>{draws++;return 7;});
    }
  }finally{await db.close();}
});
