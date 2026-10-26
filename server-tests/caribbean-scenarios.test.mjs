import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {replayScenario,scenarioPath} from '../scripts/caribbean-scenarios.mjs';
import {validCaribbeanView} from '../src/shared/caribbeanTreasures.ts';
test('saved trajectories cover money outcomes, giant blocks, edges, cannon and all bonus paths',async()=>{
 const fixtures=JSON.parse(await readFile(scenarioPath,'utf8'));
 assert.equal(fixtures.rulesVersion,1);
 assert.deepEqual(fixtures.cases.map(c=>c.name).sort(),['loss','partial','return','positive','large','giant2','giant3','cannon','edge','natural-raid','natural-flagship','purchase-raid','purchase-flagship'].sort());
 for(const scenario of fixtures.cases){
  const result=replayScenario(scenario);assert(validCaribbeanView(result.view));assert.deepEqual(result.summary,scenario.expected,scenario.name);
  if(scenario.name.startsWith('natural-'))assert(result.natural);
 }
});
