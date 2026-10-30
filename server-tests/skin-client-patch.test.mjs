import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchSkinClient } from '../deployment/releases/skin-walk-alignment-20261030-v1/patch-client.mjs';
const source = `const sheets=new Map();
function load(id){if(sheets.has(id))return sheets.get(id);throw new Error('Invalid skin atlas / Skin artwork unavailable')}
function has(id){return sheets.has(id)}
function draw(c){const p=[0,1,1,0,2,2];c.drawImage(p);c.roundRect(0,0,1,1)}
const unrelatedWalletRules=(stake)=>Math.floor(stake*97/100);
const unrelatedMessage='Остальные игры и кошелёк';`;

test('the client transformation preserves every byte outside the three skin functions', () => {
  const result = patchSkinClient(source, 'const __royalSkinWalkAlignment20261030={};');
  assert.equal(result.changes.length, 3);
  let previous = 0;
  for (const change of result.changes) {
    assert(result.code.includes(source.slice(previous, change.start)));
    previous = change.end;
  }
  assert(result.code.endsWith(source.slice(previous)));
  assert(result.code.includes("const unrelatedMessage='Остальные игры и кошелёк';"));
  assert(result.code.includes('const unrelatedWalletRules=(stake)=>Math.floor(stake*97/100);'));
});

test('ambiguous or already patched bundles are rejected before publication', () => {
  assert.throws(() => patchSkinClient(source + source, ''), /unambiguous/);
  assert.throws(() => patchSkinClient('__royalSkinWalkAlignment20261030;' + source, ''), /already present/);
});
