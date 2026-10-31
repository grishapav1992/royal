import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sampleStatistics} from './rtp-stakes.mjs';

// The two qualification looks and seeds are fixed in policy before sampling.
// Calibration streams are separate and cannot be substituted for these streams.
export async function sampleStakePolicy(game,policy,output,progress=()=>{}) {
 assert.equal(policy.kind,'sampled-slots');await mkdir(output,{recursive:true});
 for(const choice of policy.choices){
  let record;
  for(let look=0;look<policy.qualificationLooks.length;look++){
   const streams=[];
   for(const seed of policy.seeds)streams.push(await new Promise((accept,reject)=>{
    const worker=new Worker(new URL('./rtp-stakes-worker.mjs',import.meta.url),{workerData:{game:policy.samplerGame,choice,seed,rounds:policy.qualificationLooks[look]},execArgv:['--import','tsx']});
    worker.on('error',reject);worker.on('message',message=>{if(message.error)reject(Error(message.error));else if(message.result)accept(message.result);else if(message.progress)progress(message.progress);});
   }));
   const statistics=sampleStatistics(streams,policy.confidenceZ),passed=Math.abs(statistics.rtp-policy.target)<=policy.tolerance&&statistics.halfWidth<=policy.maxHalfWidth95&&statistics.interval95[1]<=policy.maxUpper95;
   record={game:policy.samplerGame,choice,look:look+1,streams,statistics,passed};
   await writeFile(resolve(output,policy.samplerGame+'-'+choice+'.json'),JSON.stringify(record,null,2)+'\n');
   progress({game,choice,look:look+1,passed,...statistics});if(passed)break;
  }
  assert(record.passed,'Qualification budget failed: '+game+':'+choice);
 }
}
if(process.argv[1]&&new URL(import.meta.url).pathname===resolve(process.argv[1])){
 const args=process.argv.slice(2),game=args[args.indexOf('--game')+1],out=args.indexOf('--output');
 assert(args.includes('--game')&&out>=0,'Use --game <id> --output <task-owned-directory>');
 const registry=JSON.parse(await readFile(new URL('./rtp-policy.json',import.meta.url),'utf8'));
 await sampleStakePolicy(game,registry.stakePolicies[game],resolve(args[out+1]),value=>console.log(JSON.stringify(value)));
}
