import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {wildNudgeModelReport,nudgeRtpError} from '../scripts/game-math/wild-nudge-model.mjs';
import {rtpInputs,validateRtpProof,checkGameRtp} from '../scripts/game-math/rtp-gate.mjs';
import {GAME_MODULES} from '../src/modules/GameModuleCatalog.ts';
const policy=JSON.parse(await readFile(new URL('../scripts/game-math/rtp-policy.json',import.meta.url),'utf8')).profiles['studio-wild-nudge'];

test('the exact complete-round evidence is reproducible on every stake and includes a reachable global maximum',async()=>{
  const report=await wildNudgeModelReport(),archived=JSON.parse(await readFile(new URL('../docs/concepts/wild-nudge/math-model.json',import.meta.url),'utf8'));
  assert.deepEqual(report,archived);assert.equal(report.scope,'mathematical-model-only');assert.equal(report.releaseQualified,false);assert.equal(nudgeRtpError(report,policy),null);
  assert.equal(report.enumeration.jointStopSpace,'1073741824');assert.equal(report.enumeration.reelCensusChecks,640);assert.equal(report.enumeration.lines.length,40);assert.equal(report.enumeration.maximumTriggerFields,2160);
  assert.equal(report.stakeChecks.length,6);assert.equal(report.bonusStages.length,8);
  assert(Math.abs(report.components.baseRtp.value+report.components.bonusRtp.value-report.exactRtp.value)<1e-14);
  assert.equal(report.exactMaximum.paidRoundPoints,860790);assert.equal('interval95' in report,false);
});
test('the target check uses the exact fraction and ignores a forged display value',()=>{
  for(const fraction of ['958/1000','962/1000'])assert.equal(nudgeRtpError({exactRtp:{fraction,value:0}},policy),null);
  for(const fraction of ['957999/1000000','962001/1000000'])assert(nudgeRtpError({exactRtp:{fraction,value:.96}},policy));
});
test('model evidence cannot qualify a release or enter the runnable catalogue',async()=>{
  const id='studio-wild-nudge',inputs=await rtpInputs(process.cwd(),id);
  assert.throws(()=>validateRtpProof(id,{...inputs,policy:{...inputs.policy,releaseStatus:'model-only'}},{releaseQualified:true}),/Mathematical model only/);
  const report=await wildNudgeModelReport();assert.throws(()=>validateRtpProof(id,inputs,{...report,releaseQualified:true}));
  assert(GAME_MODULES.some(game=>game.gameId===id));assert((await checkGameRtp(process.cwd(),GAME_MODULES,[id])).verified>=1,'Selected release and affected shared sources must be qualified');
});
