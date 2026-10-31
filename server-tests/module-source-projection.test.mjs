import test from 'node:test';
import assert from 'node:assert/strict';
import {projectedModuleContract} from '../scripts/module-source-projection.mjs';
const current={slug:'girlhub',gameId:'studio-afterglow',apiVersion:1,rulesVersion:2,progressVersion:4};
const previous={...current,progressVersion:3},contract={apiVersion:1,rulesVersion:2,progressVersion:3};
test('an unchanged contract needs no compatibility override',()=>assert.deepEqual(projectedModuleContract(current,current),current));
test('an older progress contract must be explicitly pinned to production',()=>{
 assert.deepEqual(projectedModuleContract(current,previous,{[current.gameId]:contract}),previous);
 for(const target of [undefined,{}, {[current.gameId]:{...contract,progressVersion:2}}, {[current.gameId]:{...contract,extra:true}}])assert.throws(()=>projectedModuleContract(current,previous,target));
});
test('compatibility projection cannot change identity, API, rules or advance progress',()=>{
 for(const patch of [{slug:'other'},{gameId:'other'},{apiVersion:2},{rulesVersion:1},{progressVersion:5},{progressVersion:0}])assert.throws(()=>projectedModuleContract(current,{...previous,...patch},{[current.gameId]:contract}));
});
