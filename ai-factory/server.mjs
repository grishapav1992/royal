import express from 'express';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { Store } from './lib/store.mjs';
import { config } from './lib/config.mjs';
import { Owner, Sessions } from './lib/owner.mjs';
import { seedTasks } from './seed.mjs';
import { randomUUID } from 'node:crypto';
import { ROLE_CATALOG } from './lib/roles.mjs';
import { selectGraph } from './lib/knowledge-graph.mjs';
import { GraphProjection } from './lib/graph-projection.mjs';
import { subscriptionUsage, requestUsageRefresh } from './lib/usage-monitor.mjs';

export async function createApp({ store, owner, sessions, options }) {
  const app = express();
  const projection = new GraphProjection(options.graphUrl);
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req,res,next) => {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (!['GET','HEAD'].includes(req.method)) {
      const origin = req.get('origin');
      if ((origin && origin !== options.origin) || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({error:'Недопустимый источник запроса.'});
    }
    next();
  });
  app.use(express.json({limit:'32kb',strict:true}));
  const limits = new Map();
  const timer = setInterval(() => { for (const [key,v] of limits) if(v.until<Date.now()) limits.delete(key); },60000); timer.unref();
  app.use('/api', (req,res,next) => {
    const strict = ['/session','/setup'].includes(req.path);
    const key = `${strict ? 'auth' : 'api'}:${req.ip}`;
    let entry = limits.get(key);
    if(!entry || entry.until<Date.now()) { entry={count:0,until:Date.now()+(strict?900000:60000)}; limits.set(key,entry); }
    if(++entry.count>(strict?30:300)) {res.setHeader('Retry-After',Math.ceil((entry.until-Date.now())/1000));return res.status(429).json({error:'Слишком много запросов. Подожди немного.'});}
    if(limits.size>10000) limits.delete(limits.keys().next().value);
    next();
  });
  const cookieOptions = {httpOnly:true,secure:options.production,sameSite:'strict',path:`${options.prefix}/`,maxAge:7*86400000};
  const token = req => req.headers.cookie?.split(';').map(v=>v.trim()).find(v=>v.startsWith('factory_session='))?.slice(16);
  const signIn = async res => res.cookie('factory_session',await sessions.create(),cookieOptions);
  app.get('/healthz',async (_req,res) => { await store.pool.query('SELECT 1'); res.json({ok:true,service:'royal-ai-factory'}); });
  app.get('/api/bootstrap',async (_req,res) => res.json({configured:await owner.configured()}));
  app.post('/api/setup',async (req,res) => {
    if(!await owner.setup(req.body?.token,req.body?.password,req.body?.email)) return res.status(403).json({error:'Ссылка настройки недействительна или уже использована.'});
    await signIn(res); res.json({ok:true});
  });
  app.post('/api/session',async(req,res) => {
    if(!await owner.verify(req.body?.password,req.body?.email)) return res.status(401).json({error:'Неверная почта или пароль.'});
    await signIn(res); res.json({ok:true});
  });
  app.use('/api',async(req,res,next) => {if(!await sessions.active(token(req))) return res.status(401).json({error:'Войди в панель.'}); next();});
  app.post('/api/session/logout',async(req,res)=>{await sessions.remove(token(req));res.clearCookie('factory_session',cookieOptions);res.json({ok:true});});
  app.get('/api/knowledge-graph',async(req,res)=>{
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 500) : '';
    const snapshot = await store.knowledgeGraph();
    const search = await projection.search(snapshot, query, 100);
    const selected = search.snapshot || selectGraph(snapshot, query, { limit: query ? 100 : 20000 });
    const { events, ...visible } = selected;
    const last = (await store.pool.query(`SELECT value FROM ${store.table}.settings WHERE key='_graph_last_exchange'`)).rows[0]?.value;
    res.json({ ...visible, projection: search.projection, sync: { last_exchange_at: last || null, event_count: events.length } });
  });
  app.get('/api/state',async(_req,res)=>{
    const [tasks,settings,runtime,subscription,factory]=await Promise.all([store.listTasks(),store.getSettings(),store.getRuntime(),subscriptionUsage(store),store.usageSummary()]);
    res.json({tasks,settings,runtime,usage:{subscription,factory},role_catalog:ROLE_CATALOG,projects:[{id:'royal',name:'Рояль'}]});
  });
  app.get('/api/usage',async(_req,res)=>{
    const [subscription,factory]=await Promise.all([subscriptionUsage(store),store.usageSummary()]);
    res.json({subscription,factory});
  });
  app.post('/api/usage/refresh',async(_req,res)=>res.status(202).json(await requestUsageRefresh(store)));
  app.get('/api/tasks/:id',async(req,res)=>{
    const task=await store.getTask(req.params.id);
    task.usage_summary=await store.usageSummary({taskId:task.id});
    task.questions=task.questions.filter(q=>q.status!=='cancelled');
    task.runs=task.runs.map(run=>({...run,summary:run.result?.summary||''}));
    task.events=task.events.map(event=>({...event,message:event.details?.message||event.details?.summary||event.type}));
    res.json(task);
  });
  app.get('/api/tasks/:id/patch',async(req,res)=>{
    const task=await store.getTask(req.params.id),candidate=task.artifact?.developer;
    const commit=candidate?.commit_sha||candidate?.commit;
    const expected=`${task.id}-${commit}.patch`;
    if(!/^[a-f0-9]{40}$/.test(commit||'')||candidate?.patch?.filename!==expected)return res.status(404).json({error:'Файл изменений пока не готов.'});
    const path=join(options.artifacts,expected);
    const info=await stat(path).catch(()=>null);
    if(!info?.isFile()||info.size>16*1024*1024)return res.status(404).json({error:'Файл изменений недоступен.'});
    res.download(path,`royal-${task.id.slice(0,8)}-${commit.slice(0,8)}.patch`);
  });
  app.post('/api/tasks',async(req,res)=>res.status(201).json(await store.createTask(req.body)));
  app.patch('/api/tasks/:id',async(req,res)=>res.json(await store.updateTask(req.params.id,req.body)));
  app.post('/api/tasks/:id/move',async(req,res)=>res.json(await store.moveTask(req.params.id,req.body,{requireRuntime:true})));
  app.post('/api/tasks/:id/answers',async(req,res)=>res.json(await store.answerQuestions(req.params.id,req.body?.answers)));
  app.post('/api/tasks/:id/action',async(req,res)=>{
    const action=req.body?.action;
    if(['approve_release','release'].includes(action)) return res.status(409).json({error:'Публикация игры пока отключена. Проверенные изменения сохраняются для отдельного выпуска.'});
    res.json(await store.action(req.params.id,action,{requireRuntime:true}));
  });
  app.post('/api/settings',async(req,res)=>{
    const patch={};
    for(const key of ['paused','auto_develop']) if(Object.hasOwn(req.body||{},key)) {
      if(typeof req.body[key]!=='boolean') return res.status(400).json({error:'Некорректная настройка.'});
      patch[key]=req.body[key];
    }
    if(Object.hasOwn(req.body||{},'role_profiles')) patch.role_profiles=req.body.role_profiles;
    if(patch.auto_develop && !(await store.getRuntime()).authenticated) return res.status(409).json({error:'Сначала подключи Codex.'});
    res.json(await store.updateSettings(patch));
  });
  app.get('/api/runtime/login',async(_req,res)=>{
    const runtime=await store.getRuntime();
    res.json({...runtime.login,authenticated:runtime.authenticated,status:runtime.authenticated?'authenticated':runtime.login?.status||'idle'});
  });
  app.post('/api/runtime/login',async(_req,res)=>{
    const runtime=await store.getRuntime();
    if(runtime.authenticated) return res.json({authenticated:true});
    if(runtime.stale) return res.status(503).json({error:'Исполнитель недоступен. Подожди восстановления сервиса.'});
    const requestId=randomUUID();
    await store.updateSettings({login_request:requestId});
    res.status(202).json({requested:true});
  });
  app.use('/api',(_req,res)=>res.status(404).json({error:'Метод не найден.'}));
  app.use(express.static(resolve(dirname(fileURLToPath(import.meta.url)),'public'),{index:'index.html'}));
  app.use((error,_req,res,_next)=>{
    const status=error.status || error.statusCode || (error.type==='entity.too.large'?413:500);
    if(status>=500) console.error('Factory request failed:',error.code||error.name);
    res.status(status).json({error:status>=500?'Сервис временно недоступен. Попробуй позже.':error.message});
  });
  return app;
}

if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const options=config();
  if(!options.databaseUrl) throw new Error('FACTORY_DATABASE_URL is required');
  if(options.production && !options.origin.startsWith('https://')) throw new Error('HTTPS origin required');
  const store=new Store({connectionString:options.databaseUrl});
  await store.init(seedTasks);
  const owner=new Owner(options.data);await owner.init();
  const sessions=new Sessions(store.pool);await sessions.init();
  const app=await createApp({store,owner,sessions,options});
  const projection = new GraphProjection(options.graphUrl);
  let refreshing = false;
  const refreshGraph = async () => {
    if (refreshing) return; refreshing = true;
    try { await projection.refresh(await store.knowledgeGraph()); }
    catch { console.error('Knowledge graph refresh failed'); }
    finally { refreshing = false; }
  };
  void refreshGraph();
  const graphTimer = setInterval(refreshGraph, 30000); graphTimer.unref();
  const server=app.listen(options.port,options.host,()=>console.log(`Factory listening on ${options.host}:${options.port}`));
  async function shutdown(){clearInterval(graphTimer);server.close();await store.close();}
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
