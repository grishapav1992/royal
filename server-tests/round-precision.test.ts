import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exactAward,precisionCredit,makeRoundPrecision,validRoundPrecision,drawPrecisionTicket,expansionExactAward,precisionBaseSession} from '../src/shared/roundPrecision';
import {penaltyPathQuote} from '../src/shared/crLeo';
import {GAME_STAKE_CENTS} from '../src/shared/gameStakes';

test('final cent settlement has exactly the original expectation and never loses a prior floor award',()=>{
 for(let d=1;d<=100;d++)for(let n=0;n<=300;n+=7){
  const a=exactAward(BigInt(n),BigInt(d));let sum=0n;
  for(let ticket=0n;ticket<a.denominator;ticket++){const paid=precisionCredit(a,ticket);sum+=paid;assert(paid>=a.numerator/a.denominator);}
  assert.equal(sum,a.numerator);
 }
});
test('all 363 risk paths retain exact 99% RTP at every stake, including adaptive stopping points',()=>{
 const choices=['safe','sharp','extreme'] as const,chances=[75n,60n,45n];
 for(const stake of GAME_STAKE_CENTS){let paths=0;
  const walk=(path:typeof choices[number][],probability:bigint,denominator:bigint)=>{
   if(path.length){
    const a=expansionExactAward({gameId:'original-cr-vs-leo',stakeUnits:String(stake),returnedUnits:penaltyPathQuote(String(stake),path),view:{penalty:{status:path.length===5?'complete':'banked',risk:path.at(-1),shots:path.map(risk=>({risk,goal:true}))}}});
    assert.equal(a.numerator*probability*100n,a.denominator*denominator*BigInt(stake)*99n);paths++;
   }
   if(path.length<5)for(let i=0;i<3;i++)walk([...path,choices[i]],probability*chances[i],denominator*100n);
  };walk([],1n,1n);assert.equal(paths,363);
 }
});
test('precision receipts cannot change money, probabilities or transcript identity',()=>{
 const a=exactAward(88n,5n),p=makeRoundPrecision(a,'17',()=>0);assert.equal(p.creditedUnits,'18');assert(validRoundPrecision(p,a,'18'));
 for(const key of ['numerator','denominator','ticket','baseUnits','creditedUnits'])assert(!validRoundPrecision({...p,[key]:'999999'},a,'18'));
 assert(!validRoundPrecision({...p,extra:1},a,'18'));
 const session={gameId:'original-cr-vs-leo',state:'settled',stakeUnits:'10',returnedUnits:'18',precision:p,view:{penalty:{status:'banked',risk:'safe',shots:[{risk:'safe',goal:true},{risk:'safe',goal:true}]}}};
 assert.equal(precisionBaseSession(session)?.returnedUnits,'17');assert.equal(precisionBaseSession({...session,returnedUnits:'19'}),null);
});
test('large-denominator sampling rejects biased tails and stays in range',()=>{
 const denominator=1000000000000000001n;let x=1;
 const random=(max:number)=>{x=(Math.imul(x,1664525)+1013904223)>>>0;return x%max;};
 for(let i=0;i<1000;i++){const ticket=drawPrecisionTicket(denominator,random);assert(ticket>=0n&&ticket<denominator);}
 assert.throws(()=>drawPrecisionTicket(100n,()=>100));
});
