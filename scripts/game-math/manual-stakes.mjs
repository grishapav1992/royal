import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {dirname,extname,relative,resolve} from 'node:path';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {MANUAL_STAKE_RANGE,manualStakeCase} from './manual-stake-case.mjs';
import {runManualStakeTasks} from './manual-stake-pool.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const sourceHash=bytes=>createHash('sha256').update(bytes).digest('hex');
const runtimeInputs={};
// Record the actual bytes consumed by esbuild, including JSON import attributes.
const snapshot={name:'manual-runtime-snapshot',setup(api){api.onLoad({filter:/\.(?:mjs|js|ts|tsx|json)$/},({path})=>{
  const contents=readFileSync(path),name=relative(root,path).replaceAll('\\','/');
  runtimeInputs[name]=sourceHash(contents);
  return {contents,loader:{'.mjs':'js','.js':'js','.ts':'ts','.tsx':'tsx','.json':'json'}[extname(path)],resolveDir:dirname(path)};
});}};
const built=await build({stdin:{contents:"export {runtimeRound} from './scripts/game-math/stake-runtime.mjs'; export {gameBetCents,parseGameStake,validGameStake} from './src/shared/gameStakes.ts';",resolveDir:root},bundle:true,write:false,plugins:[snapshot],format:'esm',platform:'node',logLevel:'silent'});
const runtimeModule='data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].contents).toString('base64');
const runtime=await import(runtimeModule);
const cache=new Map();

export {MANUAL_STAKE_RANGE};
export const manualRuntimeBindings=()=>({...runtimeInputs});
const currentRuntime=()=>{for(const[name,hash]of Object.entries(runtimeInputs))assert.equal(sourceHash(readFileSync(resolve(root,name))),hash,'Manual-stake runtime changed after compilation: '+name);};
export const MANUAL_WALLET_STAKES=Object.freeze([11,15,29,57,99,101,235,4999]);
export const walletStakes=policy=>policy.manualStakeRange
  ? [...new Set([...policy.stakes,...MANUAL_WALLET_STAKES])].sort((a,b)=>a-b) : policy.stakes;

const evidence=cases=>({range:MANUAL_STAKE_RANGE,checks:cases.length*4991,cases,
    interpretation:'Exhaustive accepted-cent runtime replay per allowed mode or choice. The reviewed stake-independent latent full-round model and exact rational final-ticket identity apply to every accepted cent. Bought Caribbean rounds normalize to the actual charged integer price. These replays are compatibility and scaling checks, not a statistical RTP estimate.'
  });

/** Every accepted cent is replayed, with the same independent path at each price. */
export function qualifyManualStakes(game,policy){
  assert.deepEqual(policy.manualStakeRange,MANUAL_STAKE_RANGE);
  const key=game+JSON.stringify(policy);
  if(cache.has(key))return structuredClone(cache.get(key));
  currentRuntime();
  const result=evidence(policy.choices.map((_,index)=>manualStakeCase(runtime,game,policy,index)));
  currentRuntime();
  cache.set(key,structuredClone(result));return result;
}

export async function prepareManualStakeChecks(records,{workers,onProgress,fresh=true}={}){
  currentRuntime();
  const unique=new Map(records.map(({game,policy})=>[game+JSON.stringify(policy),{game,policy}]));
  const pending=[];
  for(const[key,record]of unique){
    assert.deepEqual(record.policy.manualStakeRange,MANUAL_STAKE_RANGE);
    if(fresh)cache.delete(key);
    if(!cache.has(key))pending.push({key,...record});
  }
  const tasks=pending.flatMap(({game,policy})=>policy.choices.map((_,index)=>({game,policy,index})));
  const start=performance.now(),computed=await runManualStakeTasks(tasks,{runtimeModule,workers,onProgress});
  currentRuntime();
  let cursor=0;
  for(const{key,policy}of pending){const cases=computed.results.slice(cursor,cursor+policy.choices.length);cursor+=cases.length;assert.equal(cases.length,policy.choices.length);cache.set(key,evidence(cases));}
  assert.equal(cursor,computed.results.length);
  return {policies:pending.length,choices:tasks.length,checks:tasks.length*4991,workers:computed.workers,durationMs:Math.round(performance.now()-start)};
}

export function validateManualStakes(game,policy,proof){
  assert.deepEqual(proof,qualifyManualStakes(game,policy));return true;
}
