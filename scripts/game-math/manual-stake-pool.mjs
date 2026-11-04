import assert from 'node:assert/strict';
import {availableParallelism} from 'node:os';
import {Worker} from 'node:worker_threads';
import {manualStakeCase} from './manual-stake-case.mjs';

export function manualStakeWorkers(requested=process.env.ROYAL_RTP_WORKERS){
  const count=requested===undefined||requested===''?Math.min(4,Math.max(1,availableParallelism()-1)):Number(requested);
  assert(Number.isSafeInteger(count)&&count>=1&&count<=16,'ROYAL_RTP_WORKERS must be an integer from 1 to 16');
  return count;
}

export async function runManualStakeTasks(tasks,{runtimeModule,workers,onProgress}={}){
  const count=Math.min(manualStakeWorkers(workers),tasks.length);
  if(!tasks.length)return {results:[],workers:0};
  const results=Array(tasks.length),threads=[];
  const record=(id,result,durationMs)=>{
    const task=tasks[id],choice=task.policy.choices[task.index];
    assert(result&&result.choice===choice&&result.seed===((task.policy.seeds[1]+task.index*7919)>>>0)
      &&result.denominations===4991&&/^[a-f0-9]{64}$/.test(result.sha256),'Incomplete manual-stake worker result');
    assert(results[id]===undefined,'Duplicate manual-stake worker result');results[id]=result;
    onProgress?.({phase:'manual-choice',gameId:task.game,choice,index:task.index,status:'passed',durationMs});
  };
  if(count===1){
    const runtime=await import(runtimeModule);
    for(const[id,task]of tasks.entries()){
      onProgress?.({phase:'manual-choice',gameId:task.game,choice:task.policy.choices[task.index],index:task.index,status:'started'});
      const start=performance.now();record(id,manualStakeCase(runtime,task.game,task.policy,task.index),Math.round(performance.now()-start));
    }
    return {results,workers:1};
  }
  let closing=false,next=0,finished=0;
  try{
    await new Promise((accept,reject)=>{
      const assign=worker=>{
        if(next>=tasks.length){worker.job=null;return;}
        const id=next++,task=tasks[id];worker.job=id;
        onProgress?.({phase:'manual-choice',gameId:task.game,choice:task.policy.choices[task.index],index:task.index,status:'started'});
        worker.postMessage({id,task});
      };
      for(let i=0;i<count;i++){
        // Both inputs are plain ESM. Parent CLI/test/tsx flags are not worker flags.
        const worker=new Worker(new URL('./manual-stake-worker.mjs',import.meta.url),{workerData:{runtimeModule},execArgv:[]});
        worker.job=null;worker.ready=false;threads.push(worker);
        worker.on('error',reject);
        worker.on('exit',code=>{if(!closing)reject(Error('Manual-stake worker exited before completion: '+code));});
        worker.on('message',message=>{
          try{
            if(message.ready){assert(!worker.ready,'Duplicate worker initialization');worker.ready=true;assign(worker);return;}
            assert(worker.ready&&Number.isInteger(worker.job)&&message.id===worker.job,'Unexpected manual-stake worker message');
            if(message.error){const error=Error(message.error.message);error.name=message.error.name;error.code=message.error.code;throw error;}
            record(message.id,message.result,message.durationMs);finished++;
            if(finished===tasks.length){closing=true;accept();}else assign(worker);
          }catch(error){reject(error);}
        });
      }
    });
    assert.equal(results.filter(Boolean).length,tasks.length,'Missing manual-stake case');
    return {results,workers:count};
  }finally{closing=true;await Promise.all(threads.map(worker=>worker.terminate()));}
}
