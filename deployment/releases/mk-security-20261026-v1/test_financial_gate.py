"""Local child-process tests. No Docker daemon, PostgreSQL or server is used."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('financial_gate_under_test', HERE / 'financial_gate.py')
gate_module = importlib.util.module_from_spec(spec)
exec(compile((HERE / 'financial_gate.py').read_bytes(), str(HERE / 'financial_gate.py'), 'exec'), gate_module.__dict__)
FinancialGate, GateError = gate_module.FinancialGate, gate_module.GateError

GATE_CHILD = r'''
import json,os,select,signal,sys,time
from pathlib import Path
mode,marker=sys.argv[1:3]
seq=0; confirms=0; started=time.monotonic(); last=0
if mode=='ignore-eof': signal.signal(signal.SIGTERM,signal.SIG_IGN)
def emit(event,**extra):
 global seq
 seq+=1
 value={'format':1,'event':event,'financialLockHeld':True,'backendPid':os.getpid(),
        'transactionId':'456','seq':seq,'leaseMs':600000,**extra}
 text=json.dumps(value)+'\n'
 if mode=='partial' and event=='quiet':
  sys.stdout.write(text[:13]);sys.stdout.flush();time.sleep(.03);sys.stdout.write(text[13:]);sys.stdout.flush()
 else: print(text,end='',flush=True)
if mode=='bad-json': print('{',flush=True);time.sleep(60)
if mode=='long-line': print('x'*8192,flush=True);time.sleep(60)
if mode=='partial-eof': sys.stdout.write('{"format":');sys.stdout.flush();sys.exit(2)
if mode=='exit': sys.exit(0)
if mode=='silent': time.sleep(60)
if mode=='delayed-start': time.sleep(.3)
if mode=='waiting':
 while True: print(json.dumps({'format':1,'event':'waiting'}),flush=True);time.sleep(.03)
emit('quiet')
while True:
 now=time.monotonic()
 if mode=='exit-later' and now-started>.3: sys.exit(3)
 if now-last>.03: emit('heartbeat');last=now
 if not select.select([sys.stdin],[],[],.01)[0]: continue
 line=sys.stdin.readline()
 if not line:
  Path(marker).write_text('eof')
  if mode=='ignore-eof': time.sleep(.03);continue
  sys.exit(4)
 value=json.loads(line);nonce=value['nonce']
 if value['op']=='confirm':
  confirms+=1
  if mode=='stale' and confirms>1: continue
  if mode=='bad-nonce': nonce='0'*32
  extra={}
  if mode=='changed-pid':extra['backendPid']=os.getpid()+1
  if mode=='changed-tx':extra['transactionId']='457'
  if mode=='duplicate-seq':extra['seq']=seq
  emit('confirmed',nonce=nonce,**extra)
 else:
  Path(marker).write_text('commit')
  if mode=='release-delayed-ack':time.sleep(.3)
  print(json.dumps({'format':1,'event':'released','nonce':('0'*32 if mode=='bad-release' else nonce),
                   'committed':True,'backendPid':os.getpid(),'transactionId':'456'}),flush=True)
  if mode=='release-delayed-exit':time.sleep(.3)
  if mode=='release-nonzero':time.sleep(.2);sys.exit(9)
  if mode=='release-no-exit':signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)
  sys.exit(0)
'''

COMMAND_CHILD = r'''
import os,signal,subprocess,sys,time
from pathlib import Path
mode=sys.argv[1]
if mode=='ok': print('captured stdout');sys.exit(0)
if mode=='error': sys.exit(7)
if mode=='large': print('x'*4096);sys.exit(0)
child=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)'])
Path(sys.argv[2]).write_text(str(child.pid))
signal.signal(signal.SIGTERM,signal.SIG_IGN)
time.sleep(60)
'''


class FinancialGateTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='financial-gate-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.child = self.root / 'gate-child.py'
        self.child.write_text(GATE_CHILD)
        self.docker = self.root / 'docker'
        self.docker.symlink_to(sys.executable)
        self.marker, self.descendant = self.root / 'marker', self.root / 'descendant'
        patcher = patch.multiple(FinancialGate, _TERM_GRACE=.08, _KILL_GRACE=.5)
        patcher.start()
        self.addCleanup(patcher.stop)

    def gate(self, mode='normal', **options):
        arguments = {'min_free_bytes': 1, 'acquire_timeout': 1.5, 'lease_timeout': 5,
                     'heartbeat_timeout': .8, 'command_timeout': .8, **options}
        gate = FinancialGate([sys.executable, str(self.child), mode, str(self.marker)],
                             self.root, self.root / 'gate.log', **arguments)
        self.addCleanup(gate.close)
        return gate

    def assert_not_running(self, pid):
        deadline = time.monotonic() + 1
        while time.monotonic() < deadline:
            result = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True)
            if not result.stdout.strip() or result.stdout.strip().startswith('Z'):
                return
            time.sleep(.01)
        self.fail('Owned descendant remained running')

    def command(self, mode, *args):
        return [str(self.docker), '-c', COMMAND_CHILD, mode, *map(str, args)]

    def test_normal_acquire_confirm_command_and_explicit_release(self):
        gate = self.gate().acquire()
        first = gate._confirmed_nonce
        gate.confirm()
        self.assertNotEqual(gate._confirmed_nonce, first)
        self.assertEqual(gate.run([sys.executable, '-c', 'print("captured stdout")']), 'captured stdout\n')
        gate.release()
        self.assertTrue(gate._released)
        self.assertEqual(self.marker.read_text(), 'commit')
        self.assertEqual(gate._process.returncode, 0)

    def test_partial_json_lines_are_assembled_without_blocking(self):
        gate = self.gate('partial').acquire()
        gate.check()
        gate.release()

    def test_bad_json_long_lines_truncation_and_helper_exit_fail_closed(self):
        for mode in ['bad-json', 'long-line', 'partial-eof', 'exit']:
            with self.subTest(mode=mode), self.assertRaises(GateError):
                self.gate(mode).acquire()

    def test_nonce_sequence_and_transaction_identity_are_verified(self):
        for mode in ['bad-nonce', 'duplicate-seq', 'changed-pid', 'changed-tx']:
            with self.subTest(mode=mode), self.assertRaises(GateError):
                self.gate(mode).acquire()

    def test_waiting_cannot_extend_acquisition_deadline(self):
        started = time.monotonic()
        with self.assertRaisesRegex(GateError, 'acquisition deadline'):
            self.gate('waiting', acquire_timeout=.15).acquire()
        self.assertLess(time.monotonic() - started, 1)

    def test_delayed_start_can_acquire_only_within_its_explicit_budget(self):
        short = self.gate('delayed-start', acquire_timeout=.12)
        with self.assertRaisesRegex(GateError, 'acquisition deadline'):
            short.acquire()
        self.assertFalse(short._quiet)
        self.assertIsNotNone(short._process.returncode)
        gate = self.gate('delayed-start', acquire_timeout=1, heartbeat_timeout=.2)
        started = time.monotonic()
        gate.acquire()
        self.assertGreater(time.monotonic() - started, .25)
        self.assertIsNotNone(gate._confirmed_nonce)
        gate.release()
        self.assertTrue(gate._released)

    def test_silent_start_is_bounded_and_never_authorizes_commands(self):
        gate = self.gate('silent', acquire_timeout=.15)
        started = time.monotonic()
        with self.assertRaisesRegex(GateError, 'acquisition deadline'):
            gate.acquire()
        self.assertLess(time.monotonic() - started, 1)
        self.assertFalse(gate._quiet)
        self.assertIsNone(gate._confirmed_nonce)
        self.assertIsNotNone(gate._process.returncode)

    def test_delayed_start_does_not_consume_or_extend_the_held_lease(self):
        gate = self.gate('delayed-start', acquire_timeout=2, lease_timeout=.15).acquire()
        self.assertLess(gate._lease_deadline - time.monotonic(), .16)
        time.sleep(.18)
        with self.assertRaisesRegex(GateError, 'hard deadline'):
            gate.check()

    def test_acquisition_budget_keeps_other_security_deadlines_and_rejects_invalid_values(self):
        gate = FinancialGate([sys.executable], self.root, self.root/'defaults.log', min_free_bytes=1)
        self.addCleanup(gate.close)
        self.assertEqual((gate.acquire_timeout, gate.lease_timeout, gate.heartbeat_timeout,
                          gate.command_timeout, gate.release_exit_timeout), (900, 600, 10, 420, 120))
        for value in [0, -1, True, None, float('inf'), float('nan'), '900']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.gate(acquire_timeout=value)

    def test_buffered_heartbeats_after_supervisor_pause_do_not_renew_freshness(self):
        gate = self.gate(heartbeat_timeout=.15).acquire()
        time.sleep(.2)
        with self.assertRaisesRegex(GateError, 'stale'):
            gate.check()

    def test_live_heartbeats_cannot_substitute_for_fresh_nonce_sql_ack(self):
        gate = self.gate('stale', heartbeat_timeout=.15).acquire()
        with self.assertRaisesRegex(GateError, 'confirmation'):
            gate.confirm()

    def test_check_is_nonblocking_and_periodically_requests_confirmation(self):
        gate = self.gate().acquire()
        first = gate._confirmed_nonce
        time.sleep(.29)
        started = time.monotonic()
        gate.check()
        self.assertLess(time.monotonic() - started, .1)
        deadline = time.monotonic() + .5
        while gate._confirmed_nonce == first and time.monotonic() < deadline:
            gate.check()
            time.sleep(.01)
        self.assertNotEqual(gate._confirmed_nonce, first)
        gate.release()

    def test_command_timeout_kills_only_its_owned_group_and_marks_docker_unknown(self):
        gate = self.gate().acquire()
        unrelated = subprocess.Popen([sys.executable, '-c', 'import time;time.sleep(60)'], start_new_session=True)
        self.addCleanup(lambda: (unrelated.terminate(), unrelated.wait(timeout=2)))
        with self.assertRaises(GateError) as caught:
            gate.run(self.command('hang', self.descendant), timeout=.25)
        self.assertTrue(caught.exception.daemon_outcome_unknown)
        self.assert_not_running(int(self.descendant.read_text()))
        self.assertIsNone(unrelated.poll())
        gate.confirm()
        gate.release()

    def test_disk_drop_during_command_cancels_owned_descendant(self):
        gate = self.gate().acquire()
        disk = lambda _path: SimpleNamespace(free=0 if self.descendant.exists() else 10)
        with patch.object(gate_module.shutil, 'disk_usage', side_effect=disk):
            with self.assertRaisesRegex(GateError, 'disk reserve') as caught:
                gate.run(self.command('hang', self.descendant))
        self.assertTrue(caught.exception.daemon_outcome_unknown)
        self.assert_not_running(int(self.descendant.read_text()))

    def test_helper_exit_cancels_running_docker_child_group(self):
        gate = self.gate('exit-later').acquire()
        with self.assertRaises(GateError) as caught:
            gate.run(self.command('hang', self.descendant))
        self.assertTrue(caught.exception.daemon_outcome_unknown)
        self.assert_not_running(int(self.descendant.read_text()))

    def test_hard_lease_deadline_is_not_renewed_by_confirmations(self):
        gate = self.gate(lease_timeout=.25).acquire()
        with self.assertRaises(GateError) as caught:
            gate.run(self.command('hang', self.descendant))
        self.assertTrue(caught.exception.daemon_outcome_unknown)
        self.assert_not_running(int(self.descendant.read_text()))

    def test_every_docker_command_error_has_unknown_daemon_outcome(self):
        gate = self.gate().acquire()
        for args in [self.command('error'), [str(self.root / 'missing/docker')]]:
            with self.subTest(args=args), self.assertRaises(GateError) as caught:
                gate.run(args)
            self.assertTrue(caught.exception.daemon_outcome_unknown)
        with self.assertRaises(GateError) as caught:
            gate.run([sys.executable, '-c', 'raise SystemExit(2)'])
        self.assertFalse(caught.exception.daemon_outcome_unknown)
        gate.release()

    def test_captured_command_output_has_a_size_limit(self):
        gate = self.gate().acquire()
        with patch.object(FinancialGate, '_MAX_COMMAND_BYTES', 1024):
            with self.assertRaisesRegex(GateError, 'output exceeds') as caught:
                gate.run(self.command('large'))
        self.assertTrue(caught.exception.daemon_outcome_unknown)

    def test_release_requires_matching_commit_ack_and_bounded_exit(self):
        for mode in ['bad-release', 'release-no-exit']:
            gate = self.gate(mode, heartbeat_timeout=.2, release_exit_timeout=.2).acquire()
            with self.subTest(mode=mode), self.assertRaises(GateError):
                gate.release()
            self.assertFalse(gate._released)
            gate.close()

    def test_commit_ack_allows_cli_exit_after_heartbeat_and_lease_deadlines(self):
        gate = self.gate('release-delayed-exit', heartbeat_timeout=.15, lease_timeout=.25,
                         release_exit_timeout=.8).acquire()
        started = time.monotonic()
        gate.release()
        self.assertGreater(time.monotonic() - started, .25)
        self.assertTrue(gate._released)
        self.assertEqual(gate._process.returncode, 0)

    def test_nonzero_cli_exit_after_commit_ack_is_not_success(self):
        gate = self.gate('release-nonzero', heartbeat_timeout=.15, release_exit_timeout=.8).acquire()
        with self.assertRaisesRegex(GateError, 'without a successful release'):
            gate.release()
        self.assertTrue(gate._release_ack)
        self.assertFalse(gate._released)
        self.assertEqual(gate._process.returncode, 9)

    def test_post_ack_exit_timeout_is_bounded_and_close_reaps_cli(self):
        gate = self.gate('release-no-exit', heartbeat_timeout=.15, release_exit_timeout=.2).acquire()
        started = time.monotonic()
        with self.assertRaisesRegex(GateError, 'CLI exit deadline'):
            gate.release()
        self.assertTrue(gate._release_ack)
        self.assertFalse(gate._released)
        gate.close()
        self.assertLess(time.monotonic() - started, 1)
        self.assertIsNotNone(gate._process.returncode)

    def test_post_ack_timeout_does_not_extend_the_commit_ack_deadline(self):
        gate = self.gate('release-delayed-ack', heartbeat_timeout=.15, release_exit_timeout=1).acquire()
        with self.assertRaisesRegex(GateError, 'acknowledgement deadline'):
            gate.release()
        self.assertFalse(gate._release_ack)
        self.assertFalse(gate._released)

    def test_close_uses_eof_and_never_sends_release_or_commits(self):
        gate = self.gate('ignore-eof').acquire()
        started = time.monotonic()
        gate.close()
        self.assertLess(time.monotonic() - started, 1)
        self.assertFalse(gate._released)
        self.assertFalse(self.marker.exists() and self.marker.read_text() == 'commit')
        self.assertIsNotNone(gate._process.returncode)
        gate.close()

    def test_docker_cleanup_errors_preserve_unknown_including_base_exceptions(self):
        for error in [GateError('unreaped'), PermissionError('cannot signal'), KeyboardInterrupt()]:
            gate = self.gate().acquire()
            with patch.object(gate, '_stop', side_effect=error):
                with self.subTest(error=type(error).__name__), self.assertRaises(GateError) as caught:
                    gate.run(self.command('ok'))
            self.assertTrue(caught.exception.daemon_outcome_unknown)
            gate.close()

    def test_close_failure_cannot_mask_a_previous_unknown_docker_result(self):
        gate = self.gate().acquire()
        with self.assertRaises(GateError):
            gate.run(self.command('error'))
        with patch.object(gate, '_stop', side_effect=PermissionError('cannot signal')):
            with self.assertRaises(GateError) as caught:
                gate.close()
        self.assertTrue(caught.exception.daemon_outcome_unknown)
        gate._process.wait(timeout=1)

    def test_disk_reserve_is_generic_and_checks_each_requested_filesystem(self):
        recovery = self.gate(min_free_bytes=64 * 1024**2, disk_paths=[self.root, self.root / 'second'])
        def disk(path):
            return SimpleNamespace(free=100 * 1024**2 if Path(path) == self.root else 1)
        with patch.object(gate_module.shutil, 'disk_usage', side_effect=disk):
            with self.assertRaisesRegex(GateError, 'disk reserve'):
                recovery.acquire()
        self.assertIsNone(recovery._process)


if __name__ == '__main__':
    unittest.main(verbosity=2)
