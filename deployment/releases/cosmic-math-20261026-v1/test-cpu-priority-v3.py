from pathlib import Path
import runpy,tempfile,os,json,time,hashlib,subprocess,sys
from types import SimpleNamespace
HERE=Path(__file__).resolve().parent
if not __debug__:raise RuntimeError('Optimized Python disables test assertions')
m=runpy.run_path(str(HERE/'cpu-priority-release-v3.py'),run_name='priority_local_test');passed=[]
with tempfile.TemporaryDirectory() as d:
 root=Path(d)
 def row(name,current=3023):
  p=root/name
  if p.exists() or p.is_symlink():p.unlink()
  p.write_text(str(current)+'\n');s=p.stat();return {'path':str(p),'old':100,'target':3023,'device':s.st_dev,'inode':s.st_ino}
 def folder(name):
  p=root/name;p.mkdir();return p
 def plan(rows):return {'rows':rows,'parentPid':99999999,'parentStartTicks':0,'hardDeadlineMonotonic':time.monotonic()+600,'nonce':'0'*32}
 a,b=row('first'),row('second');Path(a['path']).unlink();r=m['restore']([a,b]);assert not r['rows'][0]['restored'] and r['rows'][1]['restored'];passed.append('first-path-error-does-not-block-second')
 a,b=row('first'),row('second');replacement=root/'replacement';replacement.write_text('100\n');os.replace(replacement,a['path'])
 try:m['activate'](a);raise AssertionError('Replacement accepted')
 except RuntimeError:pass
 assert int(Path(a['path']).read_text())==100;r=m['restore']([a,b]);assert not r['rows'][0]['restored'] and r['rows'][1]['restored'];passed.append('opened-file-identity-guard')
 a,b=row('first'),row('second');Path(a['path']).write_text('777\n');r=m['restore']([a,b]);assert int(Path(a['path']).read_text())==777 and r['rows'][1]['restored'];passed.append('foreign-value-retained')
 a,b=row('first'),row('second');Path(a['path']).unlink();Path(a['path']).symlink_to(b['path']);r=m['restore']([a,b]);assert not r['rows'][0]['restored'] and r['rows'][1]['restored'];passed.append('symlink-rejected')
 a,b=row('first'),row('second');f=folder('dead-parent');j=plan([a,b]);(f/'plan.json').write_text(json.dumps(j));m['watchdog'](f);assert json.loads((f/'watchdog.json').read_text())['restored'] and(f/'cancelled.json').exists();passed.append('dead-parent-watchdog-restores-and-cancels')
 a,b=row('first',100),row('second',100);f=folder('early-release');j=plan([a,b]);(f/'ready.json').write_text('{}');(f/'release-request').write_text('release')
 try:m['activate_if_live'](f,j,SimpleNamespace(poll=lambda:None));raise AssertionError('Early release accepted')
 except RuntimeError:pass
 m['cancel_and_restore'](f,j,'watchdog.json')
 try:m['activate_if_live'](f,j,SimpleNamespace(poll=lambda:None));raise AssertionError('Cancelled lease reactivated')
 except RuntimeError:pass
 assert all(int(Path(x['path']).read_text())==100 for x in [a,b]);passed.append('release-between-ready-and-activate-remains-terminal')
 a,b=row('first',100),row('second',100);f=folder('expired');j=plan([a,b]);j['hardDeadlineMonotonic']=time.monotonic()-1
 try:m['activate_if_live'](f,j,SimpleNamespace(poll=lambda:None));raise AssertionError('Expired lease accepted')
 except RuntimeError:pass
 assert all(int(Path(x['path']).read_text())==100 for x in [a,b]);passed.append('expired-lease-never-activates')
 a,b=row('first',100),row('second',100);f=folder('locked-order');j=plan([a,b]);(f/'plan.json').write_text(json.dumps(j))
 childcode="from pathlib import Path;import runpy,json,sys;m=runpy.run_path(sys.argv[1],run_name='priority_child_test');f=Path(sys.argv[2]);(f/'attempting').write_text('1');m['cancel_and_restore'](f,json.loads((f/'plan.json').read_text()),'watchdog.json')"
 with m['lease_lock'](f):
  child=subprocess.Popen([sys.executable,'-c',childcode,str(HERE/'cpu-priority-release-v3.py'),str(f)])
  until=time.monotonic()+3
  while not(f/'attempting').exists():
   assert child.poll() is None and time.monotonic()<until;time.sleep(.01)
  time.sleep(.05);assert child.poll() is None and not(f/'cancelled.json').exists()
  for r in [a,b]:m['activate'](r)
 child.wait(timeout=3);assert child.returncode==0 and all(int(Path(x['path']).read_text())==100 for x in [a,b])
 try:m['activate_if_live'](f,j,SimpleNamespace(poll=lambda:None));raise AssertionError('Post-restore activation accepted')
 except RuntimeError:pass
 passed.append('cross-process-lock-orders-activation-before-terminal-restore')
result={'passed':True,'scenarios':passed,'sourceSha256':hashlib.sha256((HERE/'cpu-priority-release-v3.py').read_bytes()).hexdigest()};(HERE/'cpu-priority-v3-test-results.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
