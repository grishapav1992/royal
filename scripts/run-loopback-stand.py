#!/usr/bin/env python3
"""Bounded loopback control on the owned private test VPS."""
import hashlib,importlib.util,json,os,re,signal,socket,stat,subprocess,sys,time
from pathlib import Path
HELPER='b1ce729747c84a8b6228f2579175abf1a605c34682eae8244369d1a2107212d8'
SNAPSHOT='52acd98a63dcf8fc6dc323ae8b81fe755c09e8f9315a7ecaea150f3c32aa3df6'
PROFILES={(4,5,4):4,(600,30,20):4,(600,60,20):4,(1000,60,20):8,(1000,120,20):8,(2000,60,20):12,(2000,120,20):12,(3500,120,20):16,(5000,120,20):16,(5000,600,20):16,(6000,120,20):20}
ENV={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':'/root'}
class Refused(RuntimeError): pass
def require(ok,code):
 if not ok: raise Refused(code)
def private(path,uid,limit=1048576):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  s=os.fstat(f.fileno())
  require(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_uid==uid and stat.S_IMODE(s.st_mode)==0o600 and s.st_size<=limit,'private-asset-refused')
  data=f.read(limit+1);require(len(data)<=limit,'asset-size-refused');return data
def put(path,data,uid=0):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as f: f.write(data);os.fchown(f.fileno(),uid,uid)
def emit(**value): print(json.dumps(value,separators=(',',':')),flush=True)
def control_profile(plan):
 require('tlsGateway' not in plan and plan.get('sameHostGenerators') is True
         and plan.get('budget')=={'cpus':18,'memoryMiB':32768,'pidsLimit':2048},'bounded-control-profile-refused')
 workers=PROFILES.get((plan.get('clients'),plan.get('seconds'),plan.get('gameProcesses')))
 require(workers is not None,'bounded-control-profile-refused')
 return workers,900 if plan['clients']>1200 else 300
def report_completion(run,manifest,plan,exit_code,workers):
 require(type(exit_code) is int and 0<=exit_code<=255,'generator-exit-unobserved')
 path=run/'generators.json'
 info=path.lstat()
 require(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_uid==1000,'generator-report-refused')
 os.chmod(path,0o600,follow_symlinks=False)
 data=private(path,1000,16*1024**2);report=json.loads(data)
 require(report.get('productionTraffic') is False and report.get('generatorOnly') is True
         and report.get('runId')==manifest['runId'] and report.get('bundleSha256')==plan['bundleSha256']
         and report.get('targetClients')==plan['clients'] and report.get('seconds')==plan['seconds']
         and report.get('inputMode')=='browser-window' and report.get('sdkWebSocket')=='ws'
         and report.get('cleanup',{}).get('passed') is True
         and len(report.get('childExits',[]))==workers,'generator-report-refused')
 marker={'protocol':1,'purpose':'isolated-generator-completion','runId':manifest['runId'],
         'bundleSha256':plan['bundleSha256'],'generatorExitCode':exit_code,
         'reportSha256':hashlib.sha256(data).hexdigest(),'reportBytes':len(data)}
 temporary=run/'generator-completion.tmp'
 put(temporary,(json.dumps(marker,separators=(',',':'))+'\n').encode(),1000)
 with open(temporary,'rb') as stream: os.fsync(stream.fileno())
 require(not (run/'generator-completion.json').exists(),'fresh-generator-marker-required')
 os.replace(temporary,run/'generator-completion.json')
 fd=os.open(run,os.O_RDONLY|os.O_DIRECTORY)
 try: os.fsync(fd)
 finally: os.close(fd)
 return marker
def main():
 require(len(sys.argv)==3 and re.fullmatch('[a-f0-9]{64}',sys.argv[2]) is not None,'control-cli-refused')
 root=Path(sys.argv[1])
 require(re.fullmatch(r'/opt/royal-load-[a-f0-9-]{36}',str(root)) is not None and root.resolve()==root and root.stat().st_uid==0 and stat.S_IMODE(root.stat().st_mode)==0o700,'owned-root-refused')
 helper=root/'load-dedicated-stand.py'
 require(hashlib.sha256(private(helper,0)).hexdigest()==HELPER,'helper-pin-refused')
 spec=importlib.util.spec_from_file_location('owned_stand',helper);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 plan=module.load_plan(root/'plan.json')
 workers,ready_budget=control_profile(plan)
 ports=[17100]+list(range(17102,17102+workers-1))
 assets=root/'run/control-assets'
 require(assets.resolve()==assets and assets.stat().st_uid==1000 and stat.S_IMODE(assets.stat().st_mode)==0o700,'asset-directory-refused')
 data=private(assets/'metadata.json',1000)
 require(hashlib.sha256(data).hexdigest()==sys.argv[2],'generator-metadata-pin-refused')
 meta=json.loads(data);require(set(meta['outputs'])=={'generators.mjs','worker.mjs'},'generator-assets-refused')
 for name,value in meta['outputs'].items():
  data=private(assets/name,1000,8*1024**2)
  require(len(data)==value['bytes'] and hashlib.sha256(data).hexdigest()==value['sha256'],'generator-asset-pin-refused')
 require(hashlib.sha256(private(assets/'load-loopback-generator-snapshot.mjs',1000)).hexdigest()==SNAPSHOT,'snapshot-source-pin-refused')
 stand=module.Stand(plan,root/'plan.json')
 require(not stand.state_path.exists() and not stand.inspect(),'fresh-control-required')
 for port in ports:
  with socket.socket(socket.AF_INET,socket.SOCK_STREAM) as s: s.bind(('127.0.0.1',port))
 owned=None;generator=None;monitor=None;completed=False
 result={'runId':plan['runId'],'productionTraffic':False,'kind':'same-container-loopback-control','capacityConfirmed':False,
         'clients':plan['clients'],'seconds':plan['seconds'],'gameProcesses':plan['gameProcesses'],'workers':workers,'budget':plan['budget'],
         'definition':'Game, PostgreSQL, Redis, Caddy aliases and SDK generators share one cgroup. This isolates the removed Mac/public TLS path and does not prove distributed capacity.',
         'generatorMetadataSha256':sys.argv[2],'helperSha256':HELPER,'snapshotSourceSha256':SNAPSHOT}
 for number in (signal.SIGTERM,signal.SIGINT): signal.signal(number,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt()))
 try:
  stand.start();emit(phase='starting',runId=plan['runId']);deadline=time.monotonic()+ready_budget
  while True:
   status=stand.status();owned=status['containerId'] or owned
   require(status['phase'] not in ['failed','ended'],'stand-start-failed')
   if status['ready']: break
   require(time.monotonic()<deadline,'stand-start-timeout');time.sleep(1)
  result['containerId']=owned;result['standRunId']=status['standRunId']
  manifest=json.loads(private(root/'run/stand.json',1000))
  require(manifest['runId']==status['standRunId'] and manifest['bundleSha256']==plan['bundleSha256'] and manifest['clients']==plan['clients'] and manifest['seconds']==plan['seconds'],'stand-profile-refused')
  require(status['guardianActive'] and not status['cancelRequested'],'stand-ownership-refused')
  template=private(root/'resource-monitor-template.py',0).decode()
  require(template.count('__OWNED_CONTAINER_ID__')==2,'monitor-template-refused')
  monitor_file=root/'resource-monitor-control.py';put(monitor_file,template.replace('__OWNED_CONTAINER_ID__',owned).encode())
  with open(root/'resource-monitor-control.log','x') as log:
   os.chmod(log.name,0o600);monitor=subprocess.Popen(['python3',str(monitor_file)],stdin=subprocess.DEVNULL,stdout=log,stderr=log,env=ENV,start_new_session=True)
  front=status['serverApiPort']
  config={'admin':{'disabled':True},'logging':{'logs':{'default':{'writer':{'output':'discard'}}}},'apps':{'http':{'servers':{'aliases':{
   'listen':['127.0.0.1:'+str(p) for p in ports],'protocols':['h1'],'automatic_https':{'disable':True},
   'routes':[{'match':[{'path':['/__load-stand/status','/matchmake/joinOrCreate/lobby','/matchmake/joinById/*','/matchmake/reconnect/*','/workers/*']}],
    'handle':[{'handler':'reverse_proxy','upstreams':[{'dial':'127.0.0.1:'+str(front)}],'headers':{'request':{'set':{'Host':['127.0.0.1:'+str(front)]}}}}]},
    {'handle':[{'handler':'static_response','status_code':404}]}]}}}}}
  put(root/'run/loopback-aliases.json',json.dumps(config).encode(),1000)
  require(stand.inspect()['Id']==owned and stand.status()['ready'],'container-ownership-refused')
  module.command(['docker','exec','--user','1000:1000',owned,'/usr/local/bin/caddy','validate','--config','/app/run/loopback-aliases.json'],timeout=15)
  wrapper="const fs=require('node:fs');const cp=require('node:child_process');const c=cp.spawn('/usr/local/bin/caddy',['run','--config','/app/run/loopback-aliases.json'],{detached:true,stdio:'ignore'});c.once('error',()=>process.exit(1));c.once('spawn',()=>{fs.writeFileSync('/app/run/loopback-aliases.pid',String(c.pid),{mode:0o600,flag:'wx'});c.unref();});"
  module.command(['docker','exec','--user','1000:1000',owned,'node','-e',wrapper],timeout=15)
  until=time.monotonic()+5
  for port in ports:
   while True:
    try:
     with socket.create_connection(('127.0.0.1',port),timeout=.5): pass
     break
    except OSError:
     require(time.monotonic()<until,'loopback-alias-readiness-timeout');time.sleep(.1)
  require(stand.status()['ready'],'stand-readiness-lost')
  args=['docker','exec','--user','1000:1000','--env','LOAD_GENERATOR_CONTROL_SNAPSHOT=1',owned,'node',
        '--import','/app/run/control-assets/load-loopback-generator-snapshot.mjs','/app/run/control-assets/generators.mjs','--manifest','/app/run/stand.json',
        '--control-port',str(status['serverControlPort']),'--api-ports',','.join(map(str,ports)),'--workers',str(workers),'--input-mode','browser-window',
        '--sdk-websocket','ws','--output','/app/run/generators.json']
  with open(root/'generator-control.log','x') as log:
   os.chmod(log.name,0o600);generator=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=log,stderr=log,env=ENV,start_new_session=True)
  emit(phase='generators',runId=plan['runId'],clients=plan['clients']);deadline=min(time.monotonic()+plan['seconds']+600,time.monotonic()+manifest['expiresAt']/1000-time.time()-20,float(stand.state()['deadline'])-35);next_update=time.monotonic()
  while generator.poll() is None:
   require(time.monotonic()<deadline,'generator-deadline')
   if time.monotonic()>=next_update:
    emit(phase='control-running',runId=plan['runId']);next_update=time.monotonic()+10
   time.sleep(1)
  result['generatorExitCode']=generator.returncode
  result['generatorCompletion']=report_completion(root/'run',manifest,plan,generator.returncode,workers)
  until=time.monotonic()+45
  while stand.status()['phase'] not in ['ended','failed'] and time.monotonic()<until: time.sleep(1)
  completed=True
 except BaseException as error:
  result['failure']=str(error) if isinstance(error,Refused) else 'control-runtime-failed'
 finally:
  for number in (signal.SIGTERM,signal.SIGINT): signal.signal(number,signal.SIG_IGN)
  try: result['stop']=stand.terminate('loopback-control-finished');result['finalStatus']=stand.status()
  except Exception: result['stop']={'stopConfirmed':False,'privateFixtureGone':False}
  stopped=[]
  for process in [generator,monitor]:
   if process is None: stopped.append(True);continue
   try:
    if process.poll() is None:
     try: process.wait(timeout=12)
     except subprocess.TimeoutExpired: pass
    def group_alive():
     try: os.killpg(process.pid,0);return True
     except ProcessLookupError: return False
    for sig,seconds in [(signal.SIGTERM,2),(signal.SIGKILL,2)]:
     if not group_alive(): break
     os.killpg(process.pid,sig);until=time.monotonic()+seconds
     while group_alive() and time.monotonic()<until: time.sleep(.1)
    process.poll();stopped.append(not group_alive() and process.returncode is not None)
   except Exception: stopped.append(False)
  result['monitorExitCode']=monitor.returncode if monitor else None
  result['ownedChildCommandsStopped']=all(stopped)
  safe_to_purge=False
  try:
   current=stand.inspect()
   safe_to_purge=result['stop']['stopConfirmed'] and (current is None or current['Id']==owned and current['status'] in module.INACTIVE)
  except Exception: pass
  try:
   if safe_to_purge:
    for name in ['loopback-aliases.json','loopback-aliases.pid','generator-completion.json']: (root/'run'/name).unlink(missing_ok=True)
    for name in ['generators.mjs','worker.mjs','metadata.json','load-loopback-generator-snapshot.mjs']: (assets/name).unlink(missing_ok=True)
    assets.rmdir()
  except OSError: pass
  result['temporaryControlAssetsRemoved']=not assets.exists();result['controlCompleted']=completed
  module.write_private(root/'loopback-control.json',result)
  emit(phase='finished',runId=plan['runId'],controlCompleted=completed,stopConfirmed=result['stop']['stopConfirmed'],fixtureGone=result['stop']['privateFixtureGone'])
if __name__=='__main__':
 try: main()
 except Exception: emit(ok=False,code='control-preflight-failed');sys.exit(1)

