import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {availableParallelism,totalmem} from 'node:os';
import {writeFile} from 'node:fs/promises';
import {Client,type Room} from '@colyseus/sdk';
import type {LobbyState} from '../server/state';

// Real sockets and room simulation, confined to a temporary local database.
// Prepare accounts before measuring: this is a WebSocket capacity test, not a login test.
if(process.env.NODE_ENV!=='test'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='royal_test')throw new Error('An isolated local test database is required.');
process.env.AUTH_DB_PATH='royal_websocket_load';
const {accounts}=await import('../server/accounts');
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const quantile=(values:number[],p:number)=>values.length?[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]:0;
const round=(value:number)=>Number(value.toFixed(1));

if(process.argv.includes('--server')){
  const loop=monitorEventLoopDelay({resolution:10});loop.enable();
  let lastCpu=process.cpuUsage(),lastTime=performance.now();
  await import('../server/index');
  setInterval(()=>{
    const now=performance.now(),cpu=process.cpuUsage(),memory=process.memoryUsage();
    process.send?.({kind:'metrics',cpuPercent:(cpu.user-lastCpu.user+cpu.system-lastCpu.system)/((now-lastTime)*10),
      rssMiB:memory.rss/1024**2,heapMiB:memory.heapUsed/1024**2,eventLoopP99Ms:loop.percentile(99)/1e6,eventLoopMaxMs:loop.max/1e6});
    lastCpu=cpu;lastTime=now;loop.reset();
  },1000).unref();
}else{
  const stages=[30,90,180,300,600,1000],phaseSeconds=20;
  const report:any={host:{platform:process.platform,arch:process.arch,logicalCPUs:availableParallelism(),ramGiB:round(totalmem()/1024**3)},
    setup:'Isolated local server process and temporary PostgreSQL, pre-authenticated SDK clients, no production traffic',
    workload:'30 input packets/s per client, 3 collision-integrated steps per packet, room cap 30; 20 s per stage, final stage 70 s',stages:[]};
  const members:{room:Room<LobbyState>;seq:number;sentAt:Map<number,number>;lastPatch:number;left:boolean}[]=[];
  const metrics:any[]=[],errors:{kind:string;message:string}[]=[];
  let measuring=false,acks:number[]=[],intervals:number[]=[],health:number[]=[],receivedBytes=0,packetsSent=0,maxClientBufferedBytes=0;
  let child:ReturnType<typeof spawn>|undefined;
  let inputTimer:ReturnType<typeof setInterval>|undefined,healthTimer:ReturnType<typeof setInterval>|undefined;
  const percentile=(values:number[])=>({p50:round(quantile(values,.5)),p95:round(quantile(values,.95)),p99:round(quantile(values,.99)),max:round(values.reduce((max,value)=>Math.max(max,value),0))});
  try{
    await accounts.ready;
    const tokens:string[]=[];
    let next=0;
    await Promise.all(Array.from({length:4},async()=>{
      while(next<stages.at(-1)!){const index=next++;const login=await accounts.login(`load-${crypto.randomUUID()}@example.test`,'Local-load-test-123!');await accounts.select(login.account.id,index%6);tokens[index]=login.token;}
    }));
    const reservation=createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
    const port=(reservation.address() as {port:number}).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
    const endpoint='http://127.0.0.1:'+port;
    child=spawn(process.execPath,['--env-file-if-exists=.env','--import','tsx','scripts/load-websocket.ts','--server'],{
      env:{...process.env,PORT:String(port),CODEX_SALE_API_KEY:'',NOWPAYMENTS_ENABLED:'false',CASINOAPIPRO_ENABLED:'false'},stdio:['ignore','ignore','ignore','ipc']});
    child.on('message',(message:any)=>{if(measuring&&message.kind==='metrics')metrics.push(message);});
    for(let attempt=0;;attempt++){
      if(child.exitCode!==null)throw new Error('Local game server exited during startup.');
      try{if((await fetch(endpoint+'/healthz')).ok)break;}catch{}
      if(attempt>=100)throw new Error('Local server startup timed out.');await delay(100);
    }
    const connect=async(index:number)=>{
      const before=performance.now();
      const client=new Client(endpoint,{headers:{Cookie:'royal_session='+tokens[index]}});
      const room=await client.joinOrCreate<LobbyState>('lobby',{activityProtocol:1});room.reconnection.enabled=false;
      const member={room,seq:0,sentAt:new Map<number,number>(),lastPatch:0,left:false};members.push(member);
      room.onMessage('*',()=>{});
      room.onError((code,message)=>errors.push({kind:'room-error-'+code,message:message??''}));
      room.onLeave(code=>{member.left=true;if(measuring)errors.push({kind:'disconnect',message:String(code)});});
      room.onStateChange(()=>{
        if(!measuring)return;
        const now=performance.now(),player=room.state.players.get(room.sessionId);
        if(member.lastPatch)intervals.push(now-member.lastPatch);member.lastPatch=now;
        const ack=player?.inputSeq??0;
        for(const [seq,at] of member.sentAt)if(seq<=ack){acks.push(now-at);member.sentAt.delete(seq);}else break;
      });
      (room.connection.transport as any).ws.addEventListener('message',(event:any)=>{if(measuring)receivedBytes+=event.data.byteLength??0;});
      return performance.now()-before;
    };
    for(const target of stages){
      const joins:number[]=[],failureBefore=errors.length;
      let index=members.length;
      await Promise.all(Array.from({length:10},async()=>{while(index<target){const current=index++;try{joins.push(await connect(current));}catch(error){errors.push({kind:'join',message:String(error)});}}}));
      await delay(500);
      const counts=new Map<string,number>();for(const member of members)counts.set(member.room.roomId,(counts.get(member.room.roomId)??0)+1);
      if([...counts.values()].some(count=>count>30))throw new Error('A room exceeded capacity 30.');
      for(const member of members){member.sentAt.clear();member.lastPatch=0;}
      acks=[];intervals=[];health=[];metrics.length=0;receivedBytes=0;packetsSent=0;maxClientBufferedBytes=0;
      measuring=true;const before=performance.now();
      inputTimer=setInterval(()=>{
        const now=performance.now(),direction=Math.floor((now-before)/2000)%2?1:-1;
        for(const member of members){
          if(member.left||!member.room.connection.isOpen)continue;
          const player=member.room.state.players.get(member.room.sessionId);if(!player)continue;
          const inputs=Array.from({length:3},()=>({seq:++member.seq,x:direction,y:0,ms:1000/90}));
          member.room.send('inputs',{revision:player.hallRevision,inputs});member.sentAt.set(member.seq,now);packetsSent++;
          maxClientBufferedBytes=Math.max(maxClientBufferedBytes,(member.room.connection.transport as any).ws.bufferedAmount??0);
        }
      },1000/30);
      healthTimer=setInterval(()=>{const start=performance.now();void fetch(endpoint+'/healthz',{signal:AbortSignal.timeout(5000)}).then(response=>{if(!response.ok)throw new Error('Health returned '+response.status);if(measuring)health.push(performance.now()-start);}).catch(error=>errors.push({kind:'health',message:String(error)}));},1000);
      await delay((target===stages.at(-1)?70:phaseSeconds)*1000);clearInterval(inputTimer);clearInterval(healthTimer);inputTimer=healthTimer=undefined;
      for(const member of members)if(!member.left)member.room.send('stop');await delay(150);
      const duration=performance.now()-before;measuring=false;
      report.stages.push({targetClients:target,connectedClients:members.filter(member=>!member.left).length,rooms:counts.size,maxRoomClients:Math.max(...counts.values()),
        durationSeconds:round(duration/1000),joinMs:percentile(joins),ackMs:percentile(acks),stateIntervalMs:percentile(intervals),healthMs:percentile(health),
        inputPacketsPerSecond:round(packetsSent*1000/duration),receivedMiBPerSecond:round(receivedBytes/1024**2*1000/duration),
        errorCount:errors.length-failureBefore,maxClientBufferedBytes,
        server:{samples:metrics.length,cpuMeanPercent:round(metrics.reduce((sum,m)=>sum+m.cpuPercent,0)/Math.max(1,metrics.length)),cpuMaxPercent:round(Math.max(0,...metrics.map(m=>m.cpuPercent))),
          maxRssMiB:round(Math.max(0,...metrics.map(m=>m.rssMiB))),eventLoopP99Ms:round(Math.max(0,...metrics.map(m=>m.eventLoopP99Ms))),eventLoopMaxMs:round(Math.max(0,...metrics.map(m=>m.eventLoopMaxMs)))}});
      console.error(JSON.stringify(report.stages.at(-1)));
      if(errors.length>failureBefore)break;
    }
    report.errors=errors;report.ok=report.stages.length===stages.length&&errors.length===0;
  }catch(error){report.ok=false;report.failure=String(error);process.exitCode=1;}
  finally{
    measuring=false;if(inputTimer)clearInterval(inputTimer);if(healthTimer)clearInterval(healthTimer);
    await Promise.allSettled(members.map(member=>member.room.leave()));
    if(child&&child.exitCode===null)await new Promise<void>(resolve=>{child!.once('exit',()=>resolve());child!.kill('SIGTERM');});
    await accounts.close();
  }
  await writeFile('artifacts/websocket-optimization/load-current.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
}
