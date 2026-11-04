import {isMainThread,parentPort,workerData} from 'node:worker_threads';
import {manualStakeCase} from './manual-stake-case.mjs';

if(isMainThread||!workerData?.runtimeModule?.startsWith('data:text/javascript;base64,'))throw Error('Manual-stake worker requires the parent runtime snapshot');
const runtime=await import(workerData.runtimeModule);
parentPort.on('message',({id,task})=>{
  try{
    const start=performance.now(),result=manualStakeCase(runtime,task.game,task.policy,task.index);
    parentPort.postMessage({id,result,durationMs:Math.round(performance.now()-start)});
  }catch(error){parentPort.postMessage({id,error:{name:error.name,message:error.message,stack:error.stack,code:error.code}});}
});
parentPort.postMessage({ready:true});
