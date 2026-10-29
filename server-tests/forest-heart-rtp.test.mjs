import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {forestHeartModelReport,rtpError} from '../scripts/game-math/forest-heart-model.mjs';
import {rtpInputs,validateRtpProof,checkGameRtp} from '../scripts/game-math/rtp-gate.mjs';
import {GAME_MODULES} from '../src/modules/GameModuleCatalog.ts';

const report=await forestHeartModelReport();
test('archived exact model is reproducible, covers all actions, held states and stakes, and stays inside its target',async()=>{
  const archived=JSON.parse(await readFile(new URL('../docs/concepts/forest-heart/math-model.json',import.meta.url),'utf8'));
  assert.deepEqual(archived,report);
  assert.equal(report.enumeration.boards,4096);
  assert.equal(report.enumeration.rotationComparisons,49152);
  assert.equal(report.enumeration.heldStates,243);
  assert.equal(report.enumeration.bonusComparisons,131072);
  assert.equal(report.bonusStages.length,4);
  assert.equal(report.strategies.length,14);assert.equal(report.stakeChecks.length,30);
  assert.equal(report.releaseQualified,false);assert.equal(report.scope,'mathematical-model-only');
  assert.equal(rtpError(report),null);
  assert.equal('interval95' in report,false);
  for(const row of report.strategies){
    assert(row.rtp.decimal<=report.optimalRtp.decimal);
    assert(row.rtp.decimal>=report.strategies.find(row=>row.choice==='pass').rtp.decimal);
  }
  assert.equal(report.bonusStages[0].expectedFlowers.decimal,report.baseExpectedFlowers.decimal);
  assert(Math.abs(report.components.baseRtp.decimal+report.components.bonusRtp.decimal-report.optimalRtp.decimal)<1e-14);
});
test('RTP target uses the exact rational result, ignoring a forged display decimal',()=>{
  assert(rtpError({optimalRtp:{numerator:'999',denominator:'1000',decimal:.96}}));
  assert.equal(rtpError({optimalRtp:{numerator:'958',denominator:'1000'}}),null);
  assert.equal(rtpError({optimalRtp:{numerator:'962',denominator:'1000'}}),null);
  assert(rtpError({optimalRtp:{numerator:'957999',denominator:'1000000'}}));
  assert(rtpError({optimalRtp:{numerator:'962001',denominator:'1000000'}}));
});
test('the candidate cannot qualify or enter the runnable catalogue using offline model evidence',async()=>{
  const id='studio-forest-heart',inputs=await rtpInputs(process.cwd(),id);
  assert.equal(inputs.policy.releaseStatus,'qualified');
  assert.throws(()=>validateRtpProof(id,inputs,{...report,qualified:true}));
  assert((await checkGameRtp(process.cwd(),GAME_MODULES,[id])).verified>=1);
});
