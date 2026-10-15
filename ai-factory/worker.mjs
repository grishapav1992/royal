import { Store } from './lib/store.mjs';
import { CodexRunner } from './lib/codex.mjs';
import { ROLE_TIMEOUT_MS } from './lib/roles.mjs';
import { config } from './lib/config.mjs';
import { Workspaces, sandboxedCommand } from './lib/workspaces.mjs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { RunProgress } from './lib/progress.mjs';
import { loadProjectKnowledge, installProjectKnowledge, installGraphKnowledge, projectKnowledgeMetadata, projectKnowledgePrompt } from './lib/project-knowledge.mjs';
import { graphContext } from './lib/knowledge-graph.mjs';
import { GraphProjection } from './lib/graph-projection.mjs';
import { readCodexUsage } from './lib/codex-limits.mjs';
import { UsageMonitor } from './lib/usage-monitor.mjs';

const options=config();
const store=new Store({connectionString:options.databaseUrl});await store.init();
const runner=new CodexRunner({runsDir:join(options.data,'runs'),timeoutMs:15*60000});
const usageMonitor=new UsageMonitor(store,{readUsage:({signal})=>readCodexUsage({binary:runner.binary,spawn:runner.spawn,env:runner.env,signal})});
const graphProjection=new GraphProjection(options.graphUrl);
const workspaces=new Workspaces({source:options.source,directory:options.workspaces});
const workerId=`worker-${randomUUID()}`;
let stopping=false,active=null,loginActive=false,lastLoginRequest=null,loginController=null;
let sandboxReady=false,sandboxCheckedAt=0,sandboxChecking=false;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const leaseMs=120000;

async function runtime(){
  const available=await runner.available();
  const cliAvailable=available.available;
  if(available.available&&!sandboxChecking&&Date.now()-sandboxCheckedAt>60000&&!active){
    sandboxChecking=true;
    try{sandboxReady=(await sandboxedCommand('/bin/true',[],{cwd:'/tmp',timeoutMs:15000})).passed;}
    catch{sandboxReady=false;}
    finally{sandboxCheckedAt=Date.now();sandboxChecking=false;}
  }
  available.available=available.available&&sandboxReady;
  available.error=sandboxReady?null:'Исполнитель проверяет ограничения доступа на сервере.';
  const auth=cliAvailable?await runner.authStatus():{authenticated:false,mode:'none'};
  void usageMonitor.poll({authenticated:auth.authenticated}).catch(()=>{});
  await store.setRuntime({...available,...auth,worker_status:active?'working':loginActive?'connecting':'idle',active_task:active?.task?.id||null,release_enabled:false});
  return {available,auth};
}

async function connect(request){
  loginActive=true;lastLoginRequest=request;
  loginController=new AbortController();
  try {
    await runner.requestLogin({signal:loginController.signal,onUpdate:async login=>{await store.setRuntime({login,worker_status:'connecting'});}});
    await store.setRuntime({login:{status:'authenticated'}});
  } catch(error){await store.setRuntime({login:{status:'error',error:'Не удалось подключить Codex. Повтори вход.',code:error.code}});}
  finally{loginActive=false;loginController=null;await runtime();}
}

async function execute(claim){
  const controller=new AbortController();active={...claim,controller};
  const {job,task,token}=claim;
  const progress=new RunProgress({role:job.role,initial:claim.run.progress,write:patch=>store.recordRunProgress(job.id,token,patch),onError:()=>controller.abort()});
  const phase=async name=>{progress.phase(name);await progress.flush();};
  const beat=setInterval(async()=>{
    try{if(!await store.heartbeat(job.id,token,leaseMs))controller.abort();}catch{controller.abort();}
  },25000);beat.unref();
  try{
    if(job.role==='release')throw new Error('Production release executor is not configured');
    const path=await workspaces.prepare(task.id,{signal:controller.signal,reinstall:job.role==='tester'});
    const knowledge=await loadProjectKnowledge({source:options.source});
    const memory=await store.projectMemory({excludeTaskId:task.id,limit:10});
    const graph=await store.knowledgeGraph();
    const knowledgeMetadata=projectKnowledgeMetadata(knowledge);
    const memoryMetadata={sha256:createHash('sha256').update(JSON.stringify(memory)).digest('hex'),answer_count:memory.answers.length,delivery_count:memory.deliveries.length};
    await installProjectKnowledge(path,knowledge,{taskMemory:memory});
    await installGraphKnowledge(path,graph);
    const graphMetadata={sha256:graph.hash,node_count:graph.nodes.length,edge_count:graph.edges.length,conflict_count:graph.conflicts.length};
    if(!await store.recordRunExecution(job.id,token,{project_knowledge:knowledgeMetadata,task_memory:memoryMetadata,knowledge_graph:graphMetadata}))throw new Error('Запуск отменен или требования задачи изменились.');
    const initialHead=job.role==='tester'?await workspaces.head(path):null;
    const initialFingerprint=job.role==='tester'?await workspaces.fingerprint(path):null;
    let checks=[];
    if(job.role==='tester'){
      const expected=task.artifact?.developer?.commit||task.artifact?.developer?.commit_sha;
      const actual=await workspaces.head(path);
      if(expected!==actual)throw new Error('Кандидат изменился после разработки. Требуется повторная проверка.');
      checks=await workspaces.checks(path,{signal:controller.signal,onPhase:phase,task});
      if(initialHead!==await workspaces.head(path)||initialFingerprint!==await workspaces.fingerprint(path))throw new Error('Обязательные проверки изменили исходники кандидата.');
      if(checks.some(check=>!check.passed)){
        await store.recordRunExecution(job.id,token,{observation_status:'unavailable'});
        const failures=checks.filter(check=>!check.passed);
        const blocked=failures.every(check=>check.verification_blocked);
        const result={summary:blocked?'Проверка не завершена: среда браузерного тестирования недоступна.': 'Обязательные проверки обнаружили ошибку.',passed:false,bugs:failures.filter(check=>!check.verification_blocked).map(check=>({title:check.name,expected:'Проверка завершается успешно.',actual:check.detail.slice(-8192),steps:['Запустить указанную проверку на сохраненном кандидате в отдельной тестовой среде.'],severity:'high'})),artifact:{commit:actual,commit_sha:actual,checks}};
        await phase('saving');await progress.close();await store.finishJob(job.id,token,result);return;
      }
    }
    const {runs,events,jobs,active_run,...context}=task;
    const previousAttempt=[...(runs||[])].reverse().find(run=>run.role===job.role&&['failed','expired'].includes(run.status));
    if(previousAttempt)context.previous_attempt={status:previousAttempt.status,error:previousAttempt.error,finished_at:previousAttempt.finished_at};
    context.bugs=(context.bugs||[]).filter(bug=>bug.status==='open');
    context.project_knowledge={...knowledgeMetadata,guide:projectKnowledgePrompt(knowledge),fixture:'.factory/project-knowledge.json'};
    context.task_memory=memory;
    const graphQuery=`${task.title} ${task.description}`.slice(0,500);
    const graphSearch=await graphProjection.search(graph,graphQuery,24);
    context.knowledge_graph={...graphContext(graphSearch.snapshot?.nodes.length?graphSearch.snapshot:graph,graphQuery,{excludeTaskId:task.id}),
      node_count:graph.nodes.length,edge_count:graph.edges.length,projection_status:graphSearch.projection.status,fixture:'.factory/knowledge-graph.json'};
    const result=await runner.run({role:job.role,task:{...context,fixed_checks:checks},workspace:path,execution:claim.execution,timeoutMs:ROLE_TIMEOUT_MS[job.role],signal:controller.signal,onExecution:async patch=>{
      if(!await store.recordRunExecution(job.id,token,patch)){controller.abort();throw new Error('Запуск отменен или требования задачи изменились.');}
    },onModelStart:()=>phase('model'),onActivity:update=>progress.activity(update),onUsage:usage=>store.recordRunUsage(job.id,token,usage),onEvent:event=>{
      if(event.type==='thread.started')void store.recordEvent(task.id,'agent_started',{message:`Запущен ${({analyst:'аналитик',developer:'разработчик',tester:'тестировщик'})[job.role]||job.role}.`}).catch(()=>{});
    }});
    await phase('saving');
    if(job.role==='developer'){
      const commit=await workspaces.commit(path);
      const patch=await workspaces.exportPatch(path,task.id,commit,options.artifacts);
      result.artifact={...result.artifact,commit,commit_sha:commit,source_base:patch.base_commit,patch};
    }
    if(job.role==='tester'){
      if(initialHead!==await workspaces.head(path)||initialFingerprint!==await workspaces.fingerprint(path))throw new Error('Тестировщик изменил исходники. Проверка отклонена.');
      result.artifact={...result.artifact,commit:initialHead,commit_sha:initialHead,checks:[...checks,...(result.artifact?.checks||[])]};
      if(!checks.every(check=>check.passed))result.passed=false;
    }
    await progress.close();await store.finishJob(job.id,token,result);
  }catch(error){
    await progress.close().catch(()=>{});
    const retryable=['rate_limit','auth'].includes(error.code);
    const message=error.code==='rate_limit'?'Лимит Codex исчерпан. Задание сохранено и будет повторено.':error.code==='auth'?'Нужен повторный вход в Codex.':String(error.message).slice(0,2000);
    if(retryable)await store.deferJob(job.id,token,message,{delayMs:error.retryAfterMs||900000}).catch(()=>{});
    else await store.failJob(job.id,token,message).catch(()=>{});
  }finally{await progress.close().catch(()=>{});clearInterval(beat);active=null;await runtime();}
}

async function shutdown(){stopping=true;active?.controller.abort();loginController?.abort();await usageMonitor.close();}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
console.log('Factory worker started');
const runtimeBeat=setInterval(()=>{if(!stopping)void runtime().catch(()=>{});},20000);runtimeBeat.unref();
while(!stopping){
  try{
    await store.recoverExpired();
    const state=await runtime();
    const settings=await store.getSettings();
    if(settings.login_request&&settings.login_request!==lastLoginRequest&&!state.auth.authenticated)await connect(settings.login_request);
    if(!settings.paused&&state.available.available&&state.auth.authenticated){
      const claim=await store.claimJob(workerId,leaseMs);
      if(claim)await execute(claim);
    }
  }catch(error){console.error('Factory worker cycle failed:',error.code||error.name);}
  if(!stopping)await sleep(5000);
}
clearInterval(runtimeBeat);await usageMonitor.close();await store.close();
