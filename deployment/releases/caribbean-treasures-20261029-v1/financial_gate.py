"""Supervise one financial transaction and only this helper's child processes."""
import json
import math
import os
from pathlib import Path
import re
import secrets
import selectors
import shutil
import signal
import subprocess
import time


class GateError(RuntimeError):
    def __init__(self, message, *, daemon_outcome_unknown=False):
        super().__init__(message)
        self.daemon_outcome_unknown = bool(daemon_outcome_unknown)


class FinancialGate:
    _MAX_LINE = 4096
    _MAX_READ = 65536
    _MAX_COMMAND_BYTES = 16 * 1024**2
    _POLL = 0.05
    _TERM_GRACE = 0.5
    _KILL_GRACE = 1.0

    def __init__(self, command, cwd, log_path, *, min_free_bytes, disk_paths=(),
                 acquire_timeout=900, lease_timeout=600, heartbeat_timeout=10,
                 command_timeout=420, release_exit_timeout=120):
        self.command = self._arguments(command)
        self.cwd, self.log_path = Path(cwd), Path(log_path)
        self.disk_paths = tuple(Path(path) for path in disk_paths) or (self.cwd,)
        if type(min_free_bytes) is not int or min_free_bytes <= 0:
            raise ValueError('Invalid financial gate disk reserve')
        self.min_free_bytes = min_free_bytes
        for name, value in [('acquire_timeout', acquire_timeout), ('lease_timeout', lease_timeout),
                            ('heartbeat_timeout', heartbeat_timeout), ('command_timeout', command_timeout),
                            ('release_exit_timeout', release_exit_timeout)]:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise ValueError('Invalid financial gate timeout')
            setattr(self, name, float(value))
        self._selector = selectors.DefaultSelector()
        self._process = self._command_process = self._log = None
        self._buffer = bytearray()
        self._output = bytearray()
        self._command_eof = False
        self._quiet = self._closed = self._released = self._release_ack = False
        self._identity = None
        self._sequence = 0
        self._lease_deadline = self._last_confirmed = None
        self._pending = self._release_nonce = self._confirmed_nonce = None
        self._release_ack_at = self._release_ack_deadline = None
        self._failure = None
        self._daemon_unknown = False

    @staticmethod
    def _arguments(args):
        if not isinstance(args, (tuple, list)) or not args or not all(isinstance(arg, (str, os.PathLike)) for arg in args):
            raise ValueError('Expected a nonempty command argument list')
        return [os.fspath(arg) for arg in args]

    def _fail(self, message):
        if self._failure is None:
            self._failure = GateError(message)
        raise self._failure

    def _disk(self):
        try:
            sufficient = all(shutil.disk_usage(path).free >= self.min_free_bytes for path in self.disk_paths)
        except OSError:
            self._fail('Cannot verify financial gate disk reserve')
        if not sufficient:
            self._fail('Financial gate disk reserve exhausted')

    def _event(self, raw):
        try:
            event = json.loads(raw)
        except (ValueError, UnicodeError):
            self._fail('Invalid financial gate JSON')
        if not isinstance(event, dict) or type(event.get('format')) is not int or event['format'] != 1:
            self._fail('Invalid financial gate event')
        kind = event.get('event')
        if kind == 'error':
            self._fail('Financial gate reported an error')
        if kind == 'waiting':
            if self._quiet:
                self._fail('Financial gate returned to draining')
            return
        identity = (event.get('backendPid'), event.get('transactionId'))
        if type(identity[0]) is not int or identity[0] <= 0 or not isinstance(identity[1], str) or not re.fullmatch(r'[0-9]+', identity[1]):
            self._fail('Invalid financial gate transaction identity')
        if self._identity is not None and identity != self._identity:
            self._fail('Financial gate transaction changed')
        if kind == 'released':
            if not self._quiet or self._release_nonce is None or self._release_ack or event.get('nonce') != self._release_nonce or event.get('committed') is not True:
                self._fail('Invalid financial gate release acknowledgement')
            now = time.monotonic()
            if self._release_ack_deadline is None or now >= self._release_ack_deadline:
                self._fail('Financial gate release acknowledgement deadline exceeded')
            self._release_ack = True
            self._release_ack_at = now
            return
        if kind not in ['quiet', 'heartbeat', 'confirmed'] or self._release_ack:
            self._fail('Unexpected financial gate event')
        sequence, lease = event.get('seq'), event.get('leaseMs')
        if event.get('financialLockHeld') is not True or type(sequence) is not int or sequence <= self._sequence or type(lease) is not int or lease <= 0:
            self._fail('Invalid financial gate lock acknowledgement')
        now = time.monotonic()
        if kind == 'quiet':
            if self._quiet:
                self._fail('Duplicate financial gate quiet event')
            self._quiet, self._identity = True, identity
            self._lease_deadline = now + min(self.lease_timeout, lease / 1000)
        elif not self._quiet:
            self._fail('Financial gate heartbeat preceded quiet')
        if kind == 'confirmed':
            if self._pending is None or event.get('nonce') != self._pending[0] or now - self._pending[1] > self.heartbeat_timeout:
                self._fail('Financial gate confirmation is stale or unrelated')
            self._confirmed_nonce, self._last_confirmed = self._pending[0], now
            self._pending = None
        self._sequence = sequence

    def _gate_output(self):
        remaining = self._MAX_READ
        while remaining:
            try:
                chunk = os.read(self._process.stdout.fileno(), min(8192, remaining))
            except BlockingIOError:
                return
            if not chunk:
                self._selector.unregister(self._process.stdout)
                if self._buffer:
                    self._fail('Truncated financial gate event')
                if not self._release_ack:
                    self._fail('Financial gate output closed before release')
                return
            remaining -= len(chunk)
            self._buffer.extend(chunk)
            while b'\n' in self._buffer:
                raw, _, rest = self._buffer.partition(b'\n')
                self._buffer = bytearray(rest)
                if not raw or len(raw) > self._MAX_LINE:
                    self._fail('Financial gate event exceeds its limit')
                self._event(raw)
            if len(self._buffer) > self._MAX_LINE:
                self._fail('Financial gate event exceeds its limit')

    def _pump(self, timeout=0):
        for key, _mask in self._selector.select(timeout):
            if key.data == 'gate':
                self._gate_output()
            else:
                try:
                    chunk = os.read(key.fileobj.fileno(), 65536)
                except BlockingIOError:
                    continue
                if not chunk:
                    self._selector.unregister(key.fileobj)
                    self._command_eof = True
                else:
                    self._output.extend(chunk)
                    if len(self._output) > self._MAX_COMMAND_BYTES:
                        raise GateError('Supervised command output exceeds its limit')

    def _health(self):
        if self._failure is not None:
            raise self._failure
        if self._closed or self._released or self._process is None:
            self._fail('Financial gate is not active')
        if self._process.poll() is not None:
            self._fail('Financial gate exited before release')
        now = time.monotonic()
        if self._quiet and now >= self._lease_deadline:
            self._fail('Financial gate hard deadline exceeded')
        if self._pending is not None and now - self._pending[1] >= self.heartbeat_timeout:
            self._fail('Financial gate confirmation deadline exceeded')
        if self._last_confirmed is not None and now - self._last_confirmed >= self.heartbeat_timeout:
            self._fail('Financial gate confirmation became stale')
        self._disk()

    def _send(self, operation, nonce):
        content = (json.dumps({'op': operation, 'nonce': nonce}, separators=(',', ':')) + '\n').encode()
        try:
            written = os.write(self._process.stdin.fileno(), content)
        except (BrokenPipeError, BlockingIOError, OSError):
            self._fail('Financial gate input is unavailable')
        if written != len(content):
            self._fail('Financial gate input was incomplete')

    def _challenge(self):
        nonce = secrets.token_hex(16)
        self._pending = (nonce, time.monotonic())
        self._send('confirm', nonce)
        return nonce

    def acquire(self):
        if self._process is not None or self._closed:
            raise GateError('Financial gate cannot be acquired twice')
        try:
            self._disk()
            if any(path.is_symlink() for path in [self.log_path, *self.log_path.parents]):
                self._fail('Financial gate log symlink rejected')
            descriptor = os.open(self.log_path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
            self._log = os.fdopen(descriptor, 'ab', buffering=0)
            self._process = subprocess.Popen(self.command, cwd=self.cwd, stdin=subprocess.PIPE,
                                             stdout=subprocess.PIPE, stderr=self._log, start_new_session=True)
            os.set_blocking(self._process.stdout.fileno(), False)
            os.set_blocking(self._process.stdin.fileno(), False)
            self._selector.register(self._process.stdout, selectors.EVENT_READ, 'gate')
            # Docker startup precedes the helper's independent 180 second SQL drain.
            deadline = time.monotonic() + self.acquire_timeout
            while not self._quiet:
                self._health()
                if time.monotonic() >= deadline:
                    self._fail('Financial gate acquisition deadline exceeded')
                self._pump(min(self._POLL, max(0, deadline - time.monotonic())))
            if time.monotonic() >= deadline:
                self._fail('Financial gate acquisition deadline exceeded')
            self.confirm()
            return self
        except BaseException:
            try:
                self.close()
            except GateError:
                pass
            raise

    def confirm(self):
        self._health()
        self._pump()
        self._health()
        if not self._quiet:
            self._fail('Financial gate has not drained')
        while self._pending is not None:
            self._health()
            self._pump(self._POLL)
        nonce = self._challenge()
        while self._confirmed_nonce != nonce:
            self._health()
            self._pump(self._POLL)
        self._health()

    def check(self):
        self._health()
        self._pump()
        self._health()
        if not self._quiet:
            self._fail('Financial gate has not drained')
        if self._pending is None and time.monotonic() - self._last_confirmed >= min(2, self.heartbeat_timeout / 3):
            self._challenge()

    def run(self, args, *, cwd=None, timeout=None):
        args = self._arguments(args)
        docker = Path(args[0]).name == 'docker'
        process = None
        try:
            self.confirm()
            if self._command_process is not None:
                raise GateError('A supervised command is already active')
            limit = self.command_timeout if timeout is None else timeout
            if isinstance(limit, bool) or not isinstance(limit, (int, float)) or not math.isfinite(limit) or limit <= 0:
                raise GateError('Invalid supervised command timeout')
            deadline = min(time.monotonic() + min(limit, self.command_timeout), self._lease_deadline)
            process = subprocess.Popen(args, cwd=self.cwd if cwd is None else cwd, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=self._log, start_new_session=True)
            self._command_process = process
            self._output, self._command_eof = bytearray(), False
            os.set_blocking(process.stdout.fileno(), False)
            self._selector.register(process.stdout, selectors.EVENT_READ, 'command')
            while True:
                self.check()
                if time.monotonic() >= deadline:
                    raise GateError('Supervised command deadline exceeded')
                self._pump(min(self._POLL, max(0, deadline - time.monotonic())))
                code = process.poll()
                if code is not None and self._command_eof:
                    if code != 0:
                        raise GateError('Supervised command failed with exit code ' + str(code))
                    self.check()
                    return self._output.decode('utf8')
        except (GateError, OSError, UnicodeError) as error:
            self._daemon_unknown |= docker
            raise GateError(str(error), daemon_outcome_unknown=docker) from error
        except BaseException as error:
            self._daemon_unknown |= docker
            raise GateError('Supervised command interrupted', daemon_outcome_unknown=docker) from error
        finally:
            if process is not None:
                cleanup_error = None
                try:
                    try:
                        self._selector.unregister(process.stdout)
                    except KeyError:
                        pass
                    self._stop(process)
                except BaseException as error:
                    cleanup_error = error
                try:
                    process.stdout.close()
                except BaseException as error:
                    cleanup_error = cleanup_error or error
                if process.poll() is not None:
                    self._command_process = None
                if cleanup_error is not None:
                    self._daemon_unknown |= docker
                    raise GateError('Supervised command cleanup failed',
                                    daemon_outcome_unknown=self._daemon_unknown) from cleanup_error

    def release(self):
        self.confirm()
        self._release_nonce = secrets.token_hex(16)
        self._release_ack_deadline = min(time.monotonic() + self.heartbeat_timeout, self._lease_deadline)
        self._send('release', self._release_nonce)
        while True:
            deadline = (self._release_ack_at + self.release_exit_timeout
                        if self._release_ack else self._release_ack_deadline)
            if time.monotonic() >= deadline:
                self._fail('Financial gate release CLI exit deadline exceeded' if self._release_ack
                           else 'Financial gate release acknowledgement deadline exceeded')
            if not self._release_ack:
                self._disk()
            self._pump(min(self._POLL, max(0, deadline - time.monotonic())))
            code = self._process.poll()
            if code is not None:
                if code != 0 or not self._release_ack:
                    self._fail('Financial gate exited without a successful release')
                self._released = True
                return

    @classmethod
    def _stop(cls, process):
        # Killing a Docker client does not cancel work already accepted by its daemon.
        for number, grace in [(signal.SIGTERM, cls._TERM_GRACE), (signal.SIGKILL, cls._KILL_GRACE)]:
            try:
                os.killpg(process.pid, number)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                continue
            if number == signal.SIGTERM:
                # Descendants can outlive the leader, so finish this owned group too.
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            return
        raise GateError('Cannot reap an owned financial gate child')

    def close(self):
        if self._closed:
            return
        self._closed = True
        errors = []
        try:
            if self._command_process is not None:
                try:
                    self._stop(self._command_process)
                except BaseException as error:
                    errors.append(error)
            if self._process is not None:
                try:
                    if self._process.stdin is not None:
                        self._process.stdin.close()
                    if not self._released and self._process.poll() is None:
                        self._stop(self._process)
                except BaseException as error:
                    errors.append(error)
            for process in [self._command_process, self._process]:
                for stream in [getattr(process, 'stdout', None), getattr(process, 'stdin', None)]:
                    if stream is not None:
                        try:
                            stream.close()
                        except BaseException as error:
                            errors.append(error)
        finally:
            self._selector.close()
            if self._log is not None:
                self._log.close()
        if errors:
            raise GateError('Financial gate cleanup failed', daemon_outcome_unknown=self._daemon_unknown) from errors[0]
