import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {availableParallelism,totalmem} from 'node:os';
import {writeFile} from 'node:fs/promises';

// Multiple client processes keep the load generator from becoming the bottleneck.
if(process.env.NODE_ENV!=='test'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='royal_test')throw new Error('An isolated local test database is required.');
process.env.AUTH_DB_PATH='royal_websocket_load';
const {accounts}=await import('../server/accounts');
const clients=1000,workerCount=4,seconds=70,stepsPerPacket=process.argv.includes('--60hz')?2:3;
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const round=(value:number)=>Number(value.toFixed(1));
const metrics:any[]=[],workers:ReturnType<typeof spawn>[]=[];
let game:ReturnType<typeof spawn>|undefined,measuring=false;
const report:any={setup:'One real game server, four independent SDK client processes, isolated temporary PostgreSQL; no production traffic',
  host:{platform:process.platform,arch:process.arch,logicalCPUs:availableParallelism(),ramGiB:round(totalmem()/1024**3)},targetClients:clients,targetPacketsPerSecond:clients*30,seconds,
  workload:{stepsPerPacket,targetInputStepsPerClientPerSecond:stepsPerPacket*30,allPlayersMoving:true,browserPredictionSendWindow:false}};
const request=(worker:ReturnType<typeof spawn>,command:object,responseType:string)=>new Promise<any>((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(new Error('Load worker response timed out: '+responseType));},120000);
  const onMessage=(message:any)=>{if(message.kind===responseType){cleanup();resolve(message);}else if(message.kind==='error'){cleanup();reject(new Error(message.reason));}};
  const onExit=(code:number|null)=>{cleanup();reject(new Error('Load worker exited: '+code));};
  const cleanup=()=>{clearTimeout(timer);worker.off('message',onMessage);worker.off('exit',onExit);};
  worker.on('message',onMessage);worker.once('exit',onExit);worker.send(command);
});
try{
  await accounts.ready;const tokens:string[]=[];let next=0;
  console.error('Preparing 1000 authenticated accounts in an isolated local database.');
  await Promise.all(Array.from({length:4},async()=>{while(next<clients){const index=next++;const login=await accounts.login(`distributed-load-${crypto.randomUUID()}@example.test`,'Local-load-test-123!');await accounts.select(login.account.id,index%6);tokens[index]=login.token;}}));
  const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  const endpoint='http://127.0.0.1:'+port;
  game=spawn(process.execPath,['--env-file-if-exists=.env','--import','tsx','scripts/load-websocket.ts','--server'],{
    env:{...process.env,PORT:String(port),CODEX_SALE_API_KEY:'',NOWPAYMENTS_ENABLED:'false',CASINOAPIPRO_ENABLED:'false'},stdio:['ignore','ignore','ignore','ipc']});
  game.on('message',(message:any)=>{if(measuring&&message.kind==='metrics')metrics.push(message);});
  for(let attempt=0;;attempt++){
    if(game.exitCode!==null)throw new Error('Local game server exited.');
    try{if((await fetch(endpoint+'/healthz')).ok)break;}catch{}
    if(attempt>=100)throw new Error('Local game startup timed out.');await delay(100);
  }
  for(let i=0;i<workerCount;i++){
    const worker=spawn(process.execPath,['--import','tsx','scripts/load-websocket-worker.ts'],{stdio:['ignore','ignore','ignore','ipc']});
    worker.on('message',(message:any)=>{if(message.kind==='heartbeat')console.error(JSON.stringify({worker:i,connectedClients:message.connectedClients,inputPacketsPerSecond:round(message.inputPacketsPerSecond)}));});
    workers.push(worker);
  }
  const ready=await Promise.all(workers.map((worker,i)=>request(worker,{kind:'connect',endpoint,tokens:tokens.slice(i*clients/workerCount,(i+1)*clients/workerCount)},'ready')));
  report.ready=ready;
  console.error('All client generators are ready; starting 70 seconds of continuous movement.');
  measuring=true;const before=performance.now();
  const results=await Promise.all(workers.map(worker=>request(worker,{kind:'measure',seconds,stepsPerPacket},'result')));
  measuring=false;report.durationSeconds=round((performance.now()-before)/1000);report.workers=results;
  const occupancy=new Map<string,number>();for(const result of ready)for(const {id,count} of result.rooms)occupancy.set(id,(occupancy.get(id)??0)+count);
  const max=(key:string)=>Math.max(0,...metrics.map(metric=>metric[key]));
  report.summary={connectedClients:results.reduce((sum,result)=>sum+result.connectedClients,0),rooms:occupancy.size,maxRoomClients:Math.max(...occupancy.values()),
    inputPacketsPerSecond:round(results.reduce((sum,result)=>sum+result.inputPacketsPerSecond,0)),receivedMiBPerSecond:round(results.reduce((sum,result)=>sum+result.receivedBytes,0)/1024**2/report.durationSeconds),
    errorCount:results.reduce((sum,result)=>sum+result.errorCount,0),
    inputRateTargetPercent:round(results.reduce((sum,result)=>sum+result.inputPacketsPerSecond,0)/(clients*30)*100),
    ackP95MsByWorker:results.map(result=>result.ackMs.p95),ackP99MsByWorker:results.map(result=>result.ackMs.p99),maxAckMs:Math.max(...results.map(result=>result.ackMs.max)),
    unacknowledgedPackets:results.reduce((sum,result)=>sum+result.unacknowledgedPackets,0),
    server:{samples:metrics.length,cpuMeanPercent:round(metrics.reduce((sum,metric)=>sum+metric.cpuPercent,0)/Math.max(1,metrics.length)),cpuMaxPercent:round(max('cpuPercent')),
      maxRssMiB:round(max('rssMiB')),eventLoopP99Ms:round(max('eventLoopP99Ms')),eventLoopMaxMs:round(max('eventLoopMaxMs'))}};
  report.ok=report.summary.connectedClients===clients&&report.summary.errorCount===0&&report.summary.maxRoomClients<=30;
  report.generatorSustainedTarget=report.summary.inputRateTargetPercent>=90;
}catch(error){report.ok=false;report.failure=String(error);}
finally{
  measuring=false;
  await Promise.all(workers.map(worker=>new Promise<void>(resolve=>{if(worker.exitCode!==null){resolve();return;}worker.once('exit',()=>resolve());worker.send({kind:'shutdown'});})));
  if(game&&game.exitCode===null)await new Promise<void>(resolve=>{game!.once('exit',()=>resolve());game!.kill('SIGTERM');});
  await accounts.close();
}
await writeFile('artifacts/websocket-optimization/'+(stepsPerPacket===2?'load-distributed-60hz.json':'load-distributed.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
