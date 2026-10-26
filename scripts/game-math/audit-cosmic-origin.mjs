// Reproduce a saved-state validation gap. This does not call an HTTP API or alter a database.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {startLuelonSlotGame,moveLuelonSlotGame} from '../../server/games/luelonSlots.ts';
import {validLuelonSlotSettlement} from '../../src/shared/luelonSlots.ts';
const game='studio-cosmic-escape',stake='100',spent='4000',draw=max=>max-1;
const start=startLuelonSlotGame(game,{luelon:{mode:'cosmic-chaos'}},stake,draw);
const first=moveLuelonSlotGame(start.luelon,stake,0,'luelon-spin',undefined,draw);
assert(first.luelon.spin.frames[0].events.length===0);
assert.equal(first.luelon.history[0].featuresBefore.multiplier,1);
assert(validLuelonSlotSettlement(game,'active',stake,spent,'0',first.luelon));
const forged=structuredClone(first.luelon),spin=forged.history[0],frame=spin.frames[0];
spin.featuresBefore.multiplier=50;spin.featuresAfter.multiplier=50;forged.bonus.features.multiplier=50;
let total=0n;
for(const win of frame.wins){win.factor=50;win.payoutUnits=String(BigInt(stake)*BigInt(win.payHundredths)*50n/100n);win.uncappedPayoutUnits=win.payoutUnits;total+=BigInt(win.payoutUnits);}
frame.payoutUnits=String(total);frame.uncappedPayoutUnits=String(total);spin.payoutUnits=String(total);spin.uncappedPayoutUnits=String(total);forged.totalPayoutUnits=String(total);forged.spin=spin;
const accepted=validLuelonSlotSettlement(game,'active',stake,spent,'0',forged);
let moveAccepted=false;
if(accepted){const continued=moveLuelonSlotGame(forged,stake,forged.revision,'luelon-spin',undefined,draw);moveAccepted=continued.luelon.spin.featuresBefore.multiplier===50;}
const paths=['src/shared/luelonSlots.ts','src/shared/luelonSlotsLines.ts','server/games/luelonSlots.ts','src/shared/casinoExpansion.ts','server/demoExpansion.ts'];
const report={generatedAt:new Date().toISOString(),gameId:game,issue:'Purchased first free-spin origin is not anchored after history becomes nonempty',severity:'defence-in-depth validation gap, not a demonstrated client payout exploit',expectedStartMultiplier:1,forgedStartMultiplier:50,legitimateInitialTotalPayoutUnits:first.luelon.totalPayoutUnits,forgedTotalPayoutUnits:String(total),forgedStateAccepted:accepted,forgedContinuationAccepted:moveAccepted,clientReachability:'HTTP operations contain action, stake/settings at start or sessionId/revision at move; clients do not send the full saved view. The forged object is injected directly into the local validator, bypassing the trusted server store. This does not show that a player can change a multiplier.',rootCause:'validLuelonLineHistory anchors purchased initial features only when history is empty. With nonempty purchased history, the first featuresBefore multiplier is not compared with mode.startMultiplier; all subsequent arithmetic can be internally consistent.',qualificationConstraint:'The affected mathematical validation source is frozen by the RTP gate. A fix requires a reviewed Cosmic policy and full-round qualification with source hashes; the legacy baseline must not be changed to bypass it.',sourceHashes:Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))};
const output=process.argv[2]??'docs/game-math/cosmic-origin-audit-20261025.json';writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,forgedStateAccepted:accepted,forgedContinuationAccepted:moveAccepted}));if(accepted)process.exitCode=2;
