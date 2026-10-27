from pathlib import Path
import os,sys,json,time,subprocess,secrets,fcntl
from contextlib import contextmanager
if not __debug__:
 raise RuntimeError('Optimized Python would disable operational checks')
ROOT=Path('/opt/royal-releases/nowpayments-sandbox-20261027-v1')
LEASE_NAME='cpu-priority-release-20261026-2'

def write_json(path,value):
 temporary=path.with_name(path.name+'.'+str(os.getpid())+'.tmp')
 temporary.write_text(json.dumps(value,indent=2)+'\n');os.replace(temporary,path)

def start_ticks(pid):
 return int((Path('/proc')/str(pid)/'stat').read_text().rsplit(')',1)[1].split()[19])

def weight_fd(row):
 fd=os.open(row['path'],os.O_RDWR|os.O_NOFOLLOW)
 try:
  st=os.fstat(fd)
  if (st.st_dev,st.st_ino)!=(row['device'],row['inode']):raise RuntimeError('CPU control identity changed')
  return fd
 except BaseException:
  os.close(fd);raise

def value(fd):
 os.lseek(fd,0,os.SEEK_SET);return int(os.read(fd,64))

def set_value(fd,number):
 os.lseek(fd,0,os.SEEK_SET);content=(str(number)+'\n').encode()
 if os.write(fd,content)!=len(content):raise RuntimeError('Incomplete CPU control write')
 if value(fd)!=number:raise RuntimeError('CPU control readback differs')

def activate(row):
 fd=weight_fd(row)
 try:
  if value(fd)!=row['old']:raise RuntimeError('CPU control value changed')
  set_value(fd,row['target'])
 finally:os.close(fd)

def restore(rows):
 results=[]
 for row in rows:
  out={'path':row['path'],'restored':False}
  for attempt in range(3):
   fd=None
   try:
    fd=weight_fd(row);current=value(fd)
    if current==row['target']:set_value(fd,row['old'])
    after=value(fd);out.update({'value':after,'restored':after==row['old'],'attempts':attempt+1})
    if not out['restored']:out['reason']='Unrelated CPU value retained'
    break
   except Exception as error:
    out.update({'errorType':type(error).__name__,'attempts':attempt+1})
    if attempt<2:time.sleep(.05)
   finally:
    if fd is not None:os.close(fd)
  results.append(out)
 return {'restored':all(row['restored'] for row in results),'rows':results,'at':time.time()}

@contextmanager
def lease_lock(folder):
 fd=os.open(folder/'activation.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 try:
  fcntl.flock(fd,fcntl.LOCK_EX)
  yield
 finally:
  fcntl.flock(fd,fcntl.LOCK_UN);os.close(fd)

def activate_if_live(folder,plan,watch):
 with lease_lock(folder):
  if any((folder/name).exists() for name in ['cancelled.json','release-request','finish']):raise RuntimeError('Priority lease was cancelled')
  if watch.poll() is not None:raise RuntimeError('Restore watchdog already stopped')
  if time.monotonic()>=plan['hardDeadlineMonotonic']-60:raise RuntimeError('Priority lease expired before activation')
  for row in plan['rows']:activate(row)

def cancel_and_restore(folder,plan,report):
 with lease_lock(folder):
  write_json(folder/'cancelled.json',{'nonce':plan['nonce'],'at':time.time()})
  result=restore(plan['rows']);write_json(folder/report,result)
  return result

def watchdog(folder):
 plan=json.loads((folder/'plan.json').read_text())
 write_json(folder/'ready.json',{'nonce':plan['nonce'],'pid':os.getpid()})
 try:
  while time.monotonic()<plan['hardDeadlineMonotonic'] and not(folder/'release-request').exists() and not(folder/'finish').exists():
   try:
    if start_ticks(plan['parentPid'])!=plan['parentStartTicks']:break
   except (FileNotFoundError,ProcessLookupError):break
   time.sleep(.2)
 finally:
  cancel_and_restore(folder,plan,'watchdog.json')

def hold():
 folder=ROOT/LEASE_NAME;folder.mkdir(mode=0o700)
 rows=[]
 for pid,comm,unit in [(2877,'dockerd','docker.service'),(122534,'containerd','containerd.service')]:
  p=Path('/proc')/str(pid)
  if(p/'comm').read_text().strip()!=comm:raise RuntimeError('Service process changed')
  cg=(p/'cgroup').read_text().strip().split(':')[-1]
  if cg!='/system.slice/'+unit:raise RuntimeError('Service control group changed')
  path=Path('/sys/fs/cgroup')/cg.lstrip('/')/'cpu.weight';st=path.stat()
  if path.is_symlink() or int(path.read_text())!=100:raise RuntimeError('Initial CPU weight differs')
  rows.append({'path':str(path),'old':100,'target':3023,'device':st.st_dev,'inode':st.st_ino})
 plan={'rows':rows,'parentPid':os.getpid(),'parentStartTicks':start_ticks(os.getpid()),'createdAt':time.time(),'hardDeadlineMonotonic':time.monotonic()+1800,'nonce':secrets.token_hex(16)}
 write_json(folder/'plan.json',plan)
 w=subprocess.Popen([sys.executable,str(Path(__file__).resolve()),'watchdog',str(folder)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
 try:
  wait_deadline=time.monotonic()+10
  while not(folder/'ready.json').exists():
   if time.monotonic()>=wait_deadline or w.poll() is not None:raise RuntimeError('Restore watchdog did not become ready')
   time.sleep(.05)
  if json.loads((folder/'ready.json').read_text())['nonce']!=plan['nonce']:raise RuntimeError('Restore watchdog identity differs')
  activate_if_live(folder,plan,w)
  write_json(folder/'active.json',{'pid':os.getpid(),'startedAt':time.time(),'maximumSeconds':1800,'rows':rows})
  while time.monotonic()<plan['hardDeadlineMonotonic']-2 and not(folder/'release-request').exists():time.sleep(.5)
 finally:
  result=cancel_and_restore(folder,plan,'result.json');(folder/'finish').write_text('restoration attempted\n')
  try:w.wait(timeout=3)
  except subprocess.TimeoutExpired:result['watchdogAwaitingOwnExit']=True
  print(json.dumps(result),flush=True)

if __name__=='__main__':
 if len(sys.argv)==1:hold()
 elif sys.argv[1:] == ['watchdog',str(ROOT/LEASE_NAME)]:watchdog(ROOT/LEASE_NAME)
 else:raise SystemExit('Unsupported priority operation')
