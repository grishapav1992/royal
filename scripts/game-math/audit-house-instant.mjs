import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {ARCADE_HOUSE_GAMES} from '../../src/shared/arcadeCatalog.ts';
import {DEMO_BETS} from '../../src/shared/demoWallet.ts';
import {getPlinkoMultipliers, exactPayoutUnits, PLINKO_RISKS} from '../../src/shared/originalGames.ts';
import {plinkoEngine} from '../../server/games/originals.ts';
import {PENALTY_BETS, PENALTY_RISKS, penaltyPathQuote} from '../../src/shared/crLeo.ts';
import {GROWTH_RATE, multiplierAtElapsed, secondsToReachMultiplier} from '../../server/games/rush/crash.ts';

// Audit evidence only. This script cannot change game rules or wallet balances.
assert.equal(ARCADE_HOUSE_GAMES.length, 12);
const output = process.argv[2] ?? 'docs/game-math/instant-wallet-audit-20261024.json';
const report = {date:'2026-10-24', scope:'Source mathematics of the three non-slot active house games; common wallet source review. Bonus wallet integration is verified separately by house-bonus-wallet-audit.test.ts.', activeHouseGames:[...ARCADE_HOUSE_GAMES], plinko:[], penalty:[], lastExit:{}, commonWallet:{}, limitations:[]};
let plinkoPaths = 0;
for (let rows=8; rows<=16; rows++) for (const risk of PLINKO_RISKS) {
  const prepared = plinkoEngine.prepare({rows,risk}), table = getPlinkoMultipliers(rows,risk);
  const counts = Array(rows+1).fill(0);
  for(let bits=0; bits<2**rows; bits++) {
    let index=0;
    const result=prepared.draw(max=>{assert.equal(max,2); return bits>>>index++&1;});
    assert.equal(index,rows); assert(prepared.verifyOutcome(result.outcome,result.multiplier));
    counts[result.outcome.bucket]++; plinkoPaths++;
  }
  const stakes = DEMO_BETS.map(bet=> {
    const stake=BigInt(bet*100), returned=table.reduce((sum,m,i)=>sum+BigInt(counts[i])*exactPayoutUnits(stake,m),0n), spent=stake*BigInt(2**rows);
    const rtp=Number(returned)/Number(spent); assert(rtp<=1,'Positive-expectation Plinko setting');
    return {stakeUnits:String(stake), returnedUnitsAcrossAllPaths:String(returned), spentUnitsAcrossAllPaths:String(spent), rtpPercent:rtp*100};
  });
  report.plinko.push({rows,risk,paths:2**rows,maximumMultiplier:Math.max(...table),rtpPercent:stakes[0].rtpPercent,stakes});
}
report.plinkoCoverage={serverSettings:report.plinko.length,paths:plinkoPaths,settlementCases:plinkoPaths*DEMO_BETS.length,uiSettings:'12 rows, easy/medium/hard; server also accepts expert and 8 through 16 rows',freeSpinsOrPurchases:false};

const risks=Object.keys(PENALTY_RISKS);
for(const stake of PENALTY_BETS) {
  let paths=0, min=Infinity, max=0;
  const best=path=>{
    paths++;
    const numerator=path.reduce((p,r)=>p*BigInt(PENALTY_RISKS[r].chance),1n), denominator=100n**BigInt(path.length);
    const independent=BigInt(stake)*99n*denominator/(100n*numerator), quote=BigInt(penaltyPathQuote(stake,path));
    assert.equal(quote,independent);
    const rtp=Number(quote*numerator)/Number(BigInt(stake)*denominator); min=Math.min(min,rtp);max=Math.max(max,rtp);
    if(path.length===5)return Number(quote);
    return Math.max(Number(quote), ...risks.map(r=>PENALTY_RISKS[r].chance/100*best([...path,r])));
  };
  const optimalExpected=Math.max(...risks.map(r=>PENALTY_RISKS[r].chance/100*best([r])));
  assert.equal(paths,363); assert(optimalExpected<=Number(stake)*.99+1e-8);
  report.penalty.push({stakeUnits:stake,mixedRiskPathsAndStops:paths,minimumFixedPathRtpPercent:min*100,maximumFixedPathRtpPercent:max*100,optimalAdaptiveExpectedReturnPercent:optimalExpected/Number(stake)*100,method:'Enumerate every ordered risk path of length 1 through 5, then backward induction over stop or any next risk. Misses return zero. Hero and sector are cosmetic.'});
}

assert.equal(GROWTH_RATE,.06);
const lastManualMs=Math.ceil(secondsToReachMultiplier(100)*1000)-1;
let minimum=Infinity,maximum=0,minimumAt=0,maximumAt=0;
for(let ms=0;ms<=lastManualMs;ms++) {
  const raw=Math.exp(6*ms/100000), cents=Math.floor(raw*100);
  assert.equal(multiplierAtElapsed(ms/1000),Math.exp(.06*(ms/1000)));
  // Continuous uniform model: P(point > raw)=.99/raw. Unit flooring can only reduce the return.
  const expected=cents/100*.99/raw;
  assert(expected<=.99+1e-12);
  if(expected<minimum){minimum=expected;minimumAt=ms;}if(expected>maximum){maximum=expected;maximumAt=ms;}
}
const samples48=2**48, capWinningSamples=Math.floor(.99*samples48/100);
report.lastExit={fixedAcceptedMillisecondTargets:lastManualMs+1,stakesUnits:DEMO_BETS.map(n=>String(n*100)),minimumContinuousModelRtpPercent:minimum*100,minimumAtMs:minimumAt,maximumContinuousModelRtpPercent:maximum*100,maximumAtMs:maximumAt,capMultiplier:100,cap48BitModelRtpPercent:100*capWinningSamples/samples48*100,maximum48BitDiscretizationErrorRtpPercent:100*100/samples48,method:'Source formula point=max(1,.99/r); r=0 explicitly loses. The server requires a cashout before the authoritative deadline, floors the multiplier to cents, and floors final stake settlement. All integer accepted milliseconds before the 100x cap are checked. At the cap, n=1 through floor(.0099*2^48) auto-pay 100x. Survival is the only future information exposed, so a stopping rule based on elapsed survival cannot raise the conditional fair-value bound.',freeSpinsOrPurchases:false};
report.commonWallet={liveClientRoute:'/api/demo-wallet/expansion uses DemoWalletStore.expansion with the shared DemoExpansionStore. Current slot accounting uses virtual demo wallet units. NileGameRuntime is tested as an additional adapter, not identified as the active slot route.',startCost:'stakeUnits * selected mode cost, debited once in demoExpansion. Velvet normal=1, booster=2, hyper=10, spotlight=100, super-encore=300. Cosmic normal=1, cosmic-chaos=40, ufo-invasion=75, deep-echo=135. Caramel normal=1, festival=35.',continuations:'Saved stakeUnits and mode are used. Active bonuses report returnedUnits=0; every offered continuation has zero cost; final accumulated payout is credited once.',replay:'Stored request key must match exactly. Existing operation replays skip drawing and money(). Different operation IDs cannot repeat a settled bonus and stale revisions reject duplicate moves.',supplementaryNileAdapter:'NileGameRuntime projects micro-USDT to cents with floor(available/10000), then posts available+(afterCents-beforeCents)*10000. The prior fractional remainder survives. Native wallet writes and the journal append share one transaction.',integrationTest:'server-tests/finance/house-bonus-wallet-audit.test.ts',integrationCoverage:'16 constructed complete bonus scenarios for 8 active slots on both DemoWalletStore and NileGameRuntime, plus four insufficient-purchase cases per adapter. Neopolis complete campaign and journal recovery are covered by existing nile-native-games.test.ts and neopolis-wallet.test.ts.',integrationRunSeparately:true};
report.limitations=['This is an audit report, not RTP qualification proof. It does not change or extend the legacy qualification baseline.','Plinko and Penalty results are exact enumerations. Last Exit uses the analytic continuous model with a reported 48-bit discretization bound; it does not enumerate 2^48 entropy values.','No production balances or player history were read. These checks describe repository sources, not a verified production image.','Wallet integration tests use deterministic constructed bonus rounds to check accounting; they do not estimate RTP or validate production randomness.'];
report.sources=['src/shared/arcadeCatalog.ts','server/games/originals.ts','server/games/vfair/plinko/plinko-multipliers.ts','src/shared/originalGames.ts','src/shared/crLeo.ts','server/games/crLeo.ts','server/games/rush/crash.ts','server/demoExpansion.ts','server/demoWallet.ts','server/demoWalletRoutes.ts','src/wallet/ExpansionClient.ts','server/finance/nile-game-runtime.ts'].map(path=>({path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')}));
writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({report:output,plinkoSettings:report.plinko.length,plinkoRtpPercentRange:[Math.min(...report.plinko.map(r=>r.rtpPercent)),Math.max(...report.plinko.map(r=>r.rtpPercent))],penaltyPaths:report.penalty.reduce((n,r)=>n+r.mixedRiskPathsAndStops,0),lastExitTargets:lastManualMs+1}));
