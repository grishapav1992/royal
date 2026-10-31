import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {assertRewardQualifications} from './prepare.mjs';
import {projectHostSource} from '../../../scripts/build-host-projection.mjs';

const config = JSON.parse(readFileSync(new URL('./backend-projection.json',import.meta.url)));
const cache = new Map();
function read(name) {
  if (!cache.has(name)) {
    const row = config.files[name]; assert(row,name);
    const raw = execFileSync(process.env.ROYAL_GIT_BINARY || 'git',['show',row.commit+':'+row.path],{maxBuffer:32*1024**2});
    cache.set(name,projectHostSource(row,raw));
  }
  return cache.get(name);
}
test('both reward qualifications bind every exact production input and the worst eligible game choice',()=>{
  assertRewardQualifications(config,read);
});
test('a changed projected rule, reward definition or proof cannot reuse the evidence from HEAD',()=>{
  for (const name of ['src/shared/rewardSpinCatalog.ts','server/progression/freeSpins.ts','docs/game-math/qualifications/royal-fruits-rewards-v1.json']) {
    assert.throws(()=>assertRewardQualifications(config,n=>n===name?Buffer.from('{}'):read(n)));
  }
});
