#!/usr/bin/env python3
"""Owned macOS test proxy: one local TCP stream to one interface-bound TLS stream."""
import argparse
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import random
import resource
import signal
import socket
import ssl
import stat
import sys
import time

HOST = '31.56.189.118'
PORT = 26443
SERVER_NAME = 'royal-load.test'
LISTEN_PORTS = [17100, 17102, 17103, 17104]
IP_BOUND_IF = 25
CONNECT_SECONDS = 10
IDLE_SECONDS = 900
CLOSE_SECONDS = 2
CHUNK_BYTES = 65536
DIAGNOSTIC_ROWS = 3302
DIAGNOSTIC_BYTES = 8 * 1024 * 1024
ERROR_STAGES = {'accept', 'interface-bind', 'tcp-connect', 'tls-handshake', 'to-upstream-read',
                'to-upstream-write', 'to-upstream-drain', 'to-local-read', 'to-local-write',
                'to-local-drain', 'cleanup', 'asyncio', 'unknown'}
ERROR_TYPES = {'limit', 'tls-certificate', 'tls', 'connection-reset', 'broken-pipe',
               'connection-aborted', 'timeout', 'refused', 'os-error', 'other'}
CONFIG_KEYS = {'runId', 'clientLimit', 'listenHost', 'listenPorts', 'remoteHost', 'remotePort',
               'interface', 'certSha256', 'publicCertPath', 'serverName', 'sessionSeconds'}


class Refused(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class OperationFailure(Exception):
    def __init__(self, stage, failure):
        self.stage, self.failure = stage, failure


def failure_type(failure):
    for kind, code in [(ssl.SSLCertVerificationError, 'tls-certificate'), (ssl.SSLError, 'tls'),
                       (ConnectionResetError, 'connection-reset'), (BrokenPipeError, 'broken-pipe'),
                       (ConnectionAbortedError, 'connection-aborted'), (TimeoutError, 'timeout'),
                       (Refused, 'refused'), (OSError, 'os-error')]:
        if isinstance(failure, kind):
            return code
    return 'other'


async def operation(stage, awaitable, seconds):
    try:
        # A timeout context keeps each read/drain in its existing task.
        async with asyncio.timeout(seconds):
            return await awaitable
    except Exception as failure:
        raise OperationFailure(stage, failure) from None


def regular_bytes(path, maximum, private=False):
    path = Path(path)
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise Refused('canonical-regular-file-required')
    if private:
        parent = path.parent.stat()
        if not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) != 0o700:
            raise Refused('private-config-parent-required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_size > maximum:
            raise Refused('bounded-owned-regular-file-required')
        if private and stat.S_IMODE(info.st_mode) != 0o600:
            raise Refused('private-config-mode-required')
        with os.fdopen(fd, 'rb', closefd=False) as source:
            data = source.read(maximum + 1)
        if len(data) > maximum:
            raise Refused('file-size-changed')
        return data
    finally:
        os.close(fd)


def read_config(path):
    try:
        config = json.loads(regular_bytes(path, 8192, private=True))
    except Refused:
        raise
    except Exception:
        raise Refused('invalid-private-config') from None
    if not isinstance(config, dict) or set(config) != CONFIG_KEYS:
        raise Refused('invalid-config-fields')
    if not isinstance(config['runId'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', config['runId']):
        raise Refused('invalid-run-id')
    if type(config['clientLimit']) is not int or not 1 <= config['clientLimit'] <= 6000:
        raise Refused('invalid-client-limit')
    if type(config['sessionSeconds']) is not int or not 1 <= config['sessionSeconds'] <= 3300:
        raise Refused('invalid-session-duration')
    if config['listenHost'] != '127.0.0.1' or config['listenPorts'] != LISTEN_PORTS or any(type(port) is not int for port in config['listenPorts']):
        raise Refused('fixed-loopback-listeners-required')
    if config['remoteHost'] != HOST or type(config['remotePort']) is not int or config['remotePort'] != PORT:
        raise Refused('owned-upstream-required')
    if config['interface'] != 'en0' or config['serverName'] != SERVER_NAME:
        raise Refused('fixed-interface-and-server-name-required')
    if not isinstance(config['certSha256'], str) or not re.fullmatch(r'[a-f0-9]{64}', config['certSha256']):
        raise Refused('invalid-certificate-digest')
    if not isinstance(config['publicCertPath'], str):
        raise Refused('public-certificate-required')
    return config


def tls_context(config):
    certificate = regular_bytes(config['publicCertPath'], 131072)
    if hashlib.sha256(certificate).hexdigest() != config['certSha256']:
        raise Refused('certificate-digest-mismatch')
    if b'PRIVATE KEY' in certificate or b'-----BEGIN CERTIFICATE-----' not in certificate:
        raise Refused('public-certificate-only')
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.verify_mode = ssl.CERT_REQUIRED
    context.check_hostname = True
    try:
        context.load_verify_locations(cadata=certificate.decode('ascii'))
    except Exception:
        raise Refused('invalid-public-certificate') from None
    return context


def fd_preflight(client_limit):
    required = 2 * (client_limit + 64) + 128
    if required > 16000:
        raise Refused('socket-fd-budget-exceeded')
    soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
    if hard != resource.RLIM_INFINITY and hard < required:
        raise Refused('insufficient-hard-fd-limit')
    if soft < required:
        try:
            resource.setrlimit(resource.RLIMIT_NOFILE, (required, hard))
        except (ValueError, OSError):
            raise Refused('cannot-raise-owned-soft-fd-limit') from None
    actual, _ = resource.getrlimit(resource.RLIMIT_NOFILE)
    if actual < required:
        raise Refused('insufficient-soft-fd-limit')
    return {'requiredFds': required, 'fdSoftLimit': actual}


def interface_index():
    if sys.platform != 'darwin':
        raise Refused('macos-interface-binding-required')
    try:
        index = socket.if_nametoindex('en0')
    except OSError:
        raise Refused('en0-interface-unavailable') from None
    if index <= 0:
        raise Refused('en0-interface-unavailable')
    return index


def bound_socket(index):
    raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        raw.setsockopt(socket.IPPROTO_IP, IP_BOUND_IF, index)
        raw.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        raw.setblocking(False)
        return raw
    except Exception:
        raw.close()
        raise Refused('interface-bind-failed') from None


async def close_writer(writer):
    writer.close()
    try:
        await asyncio.wait_for(writer.wait_closed(), CLOSE_SECONDS)
    except (Exception, asyncio.CancelledError):
        writer.transport.abort()


class Proxy:
    def __init__(self, config, context, index):
        self.config, self.context, self.index = config, context, index
        self.socket_limit = config['clientLimit'] + 64
        self.servers, self.tasks, self.writers = [], set(), set()
        self.stopping = False
        self.stop_event = asyncio.Event()
        self.lag_samples, self.lag_count, self.max_lag_ms = [], 0, 0.0
        self.random = random.Random(0)
        self.error_details = {}
        self.diagnostics = None
        self.stats = {'acceptedConnections': 0, 'rejectedConnections': 0, 'activeConnections': 0,
                      'peakConnections': 0, 'upstreamSocketsCreated': 0, 'tlsConnections': 0,
                      'completedConnections': 0, 'bytesToUpstream': 0, 'bytesToLocal': 0,
                      'errorCount': 0, 'errors': {}}

    async def observe_lag(self):
        next_at = time.monotonic() + 0.1
        while not self.stopping:
            await asyncio.sleep(max(0, next_at - time.monotonic()))
            now = time.monotonic()
            lag = max(0.0, (now - next_at) * 1000)
            self.record_lag(lag)
            next_at += (int(max(0, now - next_at) / 0.1) + 1) * 0.1

    def record_lag(self, lag):
        self.lag_count += 1
        self.max_lag_ms = max(self.max_lag_ms, lag)
        if self.diagnostics:
            self.diagnostics.record_lag(lag)
        if len(self.lag_samples) < 8192:
            self.lag_samples.append(lag)
        else:
            index = self.random.randrange(self.lag_count)
            if index < 8192:
                self.lag_samples[index] = lag

    def lag_summary(self):
        samples = sorted(self.lag_samples)
        p99 = samples[max(0, (99 * len(samples) + 99) // 100 - 1)] if samples else 0
        return {'periodMs': 100, 'count': self.lag_count, 'sampleCount': len(samples),
                'sampling': 'complete' if len(samples) == self.lag_count else 'bounded-reservoir',
                'p99Ms': round(p99, 3), 'maxMs': round(self.max_lag_ms, 3)}

    def error(self, code, stage='unknown', kind='other'):
        self.stats['errorCount'] += 1
        self.stats['errors'][code] = self.stats['errors'].get(code, 0) + 1
        stage = stage if stage in ERROR_STAGES else 'unknown'
        kind = kind if kind in ERROR_TYPES else 'other'
        key = stage + '/' + kind
        self.error_details[key] = self.error_details.get(key, 0) + 1

    def accept(self, reader, writer):
        self.stats['acceptedConnections'] += 1
        if self.stopping or self.stats['activeConnections'] >= self.socket_limit:
            self.stats['rejectedConnections'] += 1
            if not self.stopping:
                self.error('socket-limit', 'accept', 'limit')
            writer.close()
            return
        self.stats['activeConnections'] += 1
        self.stats['peakConnections'] = max(self.stats['peakConnections'], self.stats['activeConnections'])
        self.writers.add(writer)
        task = asyncio.create_task(self.handle(reader, writer))
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def upstream(self):
        try:
            raw = bound_socket(self.index)
        except Exception as failure:
            raise OperationFailure('interface-bind', failure) from None
        self.stats['upstreamSocketsCreated'] += 1
        try:
            await operation('tcp-connect', asyncio.get_running_loop().sock_connect(raw, (HOST, PORT)), CONNECT_SECONDS)
            reader, writer = await operation('tls-handshake', asyncio.open_connection(sock=raw, ssl=self.context,
                server_hostname=SERVER_NAME, ssl_handshake_timeout=CONNECT_SECONDS,
                ssl_shutdown_timeout=CLOSE_SECONDS, limit=CHUNK_BYTES), CONNECT_SECONDS + 1)
            self.writers.add(writer)
            self.stats['tlsConnections'] += 1
            return reader, writer
        except BaseException:
            raw.close()
            raise

    async def pump(self, reader, writer, direction):
        stage = 'to-upstream' if direction == 'bytesToUpstream' else 'to-local'
        while True:
            data = await operation(stage + '-read', reader.read(CHUNK_BYTES), IDLE_SECONDS)
            if not data:
                return
            try:
                writer.write(data)
            except Exception as failure:
                raise OperationFailure(stage + '-write', failure) from None
            await operation(stage + '-drain', writer.drain(), CONNECT_SECONDS)
            self.stats[direction] += len(data)

    async def handle(self, local_reader, local_writer):
        remote_writer, pipes = None, []
        try:
            remote_reader, remote_writer = await self.upstream()
            pipes = [asyncio.create_task(self.pump(local_reader, remote_writer, 'bytesToUpstream')),
                     asyncio.create_task(self.pump(remote_reader, local_writer, 'bytesToLocal'))]
            done, _ = await asyncio.wait(pipes, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
            self.stats['completedConnections'] += 1
        except asyncio.CancelledError:
            raise
        except Exception as failure:
            stage = failure.stage if isinstance(failure, OperationFailure) else 'unknown'
            actual = failure.failure if isinstance(failure, OperationFailure) else failure
            kind = failure_type(actual)
            code = 'tls-certificate-rejected' if kind == 'tls-certificate' else 'tls-failed' if kind == 'tls' else \
                   'stream-timeout' if kind == 'timeout' else 'stream-failed'
            if not self.stopping or kind in {'tls-certificate', 'tls'}:
                self.error(code, stage, kind)
        finally:
            for task in pipes:
                task.cancel()
            if pipes:
                await asyncio.gather(*pipes, return_exceptions=True)
            for writer in [remote_writer, local_writer]:
                if writer:
                    await close_writer(writer)
                    self.writers.discard(writer)
            self.stats['activeConnections'] -= 1

    async def start(self):
        try:
            for port in self.config['listenPorts']:
                self.servers.append(await asyncio.start_server(self.accept, '127.0.0.1', port,
                    backlog=128, limit=CHUNK_BYTES, start_serving=False))
            for server in self.servers:
                await server.start_serving()
        except BaseException:
            await self.close()
            raise

    async def close(self):
        self.stopping = True
        for server in self.servers:
            server.close()
        for writer in list(self.writers):
            writer.close()
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            try:
                await asyncio.wait_for(asyncio.gather(*tasks, return_exceptions=True), 2 * CLOSE_SECONDS + 2)
            except TimeoutError:
                self.error('stream-cleanup-timeout', 'cleanup', 'timeout')
        for writer in list(self.writers):
            writer.transport.abort()
        self.writers.clear()
        try:
            await asyncio.wait_for(asyncio.gather(*(server.wait_closed() for server in self.servers), return_exceptions=True), CLOSE_SECONDS)
        except TimeoutError:
            self.error('listener-cleanup-timeout', 'cleanup', 'timeout')


class Diagnostics:
    def __init__(self, proxy, output, monotonic=time.monotonic, wall=time.time, usage=None):
        self.proxy, self.monotonic, self.wall = proxy, monotonic, wall
        self.usage = usage or (lambda: resource.getrusage(resource.RUSAGE_SELF))
        self.started = self.previous = monotonic()
        self.started_at = self.previous_at = int(wall() * 1000)
        self.previous_cpu = self.usage()
        self.row_count = self.rows_written = self.bytes_written = 0
        self.max_cpu = self.max_lag = 0.0
        self.lag_count, self.lags, self.interval_max_lag = 0, [], 0.0
        self.random = random.Random(1)
        self.destination = None
        if output:
            fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            self.destination = os.fdopen(fd, 'wb')
        self.sample('initial')

    def record_lag(self, value):
        self.lag_count += 1
        self.interval_max_lag = max(self.interval_max_lag, value)
        if len(self.lags) < 128:
            self.lags.append(value)
        else:
            index = self.random.randrange(self.lag_count)
            if index < 128:
                self.lags[index] = value

    def sample(self, kind='sample'):
        if kind == 'initial':
            now, wall_at, usage = self.previous, self.previous_at, self.previous_cpu
        else:
            now, wall_at, usage = self.monotonic(), int(self.wall() * 1000), self.usage()
        if now < self.previous or wall_at < self.previous_at:
            raise Refused('diagnostics-clock-regressed')
        elapsed = max(0, now - self.previous)
        user = max(0, usage.ru_utime - self.previous_cpu.ru_utime)
        system = max(0, usage.ru_stime - self.previous_cpu.ru_stime)
        cpu = (user + system) / elapsed * 100 if elapsed else 0
        values = sorted(self.lags)
        p99 = values[max(0, (99 * len(values) + 99) // 100 - 1)] if values else 0
        row = {'kind': kind, 'runId': self.proxy.config['runId'], 'sampledAtMs': wall_at,
               'intervalStartedAtMs': self.previous_at, 'monotonicElapsedMs': round(max(0, now - self.started) * 1000, 3),
               'intervalMs': round(elapsed * 1000, 3), 'cpuUserSeconds': round(user, 6),
               'cpuSystemSeconds': round(system, 6), 'cpuOneCorePercent': round(cpu, 3),
               'maxRssMiB': round(usage.ru_maxrss / (1024 ** 2 if sys.platform == 'darwin' else 1024), 3),
               'counters': {key: value for key, value in self.proxy.stats.items() if key != 'errors'},
               'eventLoopLag': {'count': self.lag_count, 'sampleCount': len(values),
                                'sampling': 'complete' if len(values) == self.lag_count else 'bounded-reservoir',
                                'p99Ms': round(p99, 3), 'maxMs': round(self.interval_max_lag, 3)}}
        if self.row_count >= DIAGNOSTIC_ROWS:
            raise Refused('diagnostics-row-limit')
        data = (json.dumps(row, separators=(',', ':'), sort_keys=True) + '\n').encode('ascii')
        if self.bytes_written + len(data) > DIAGNOSTIC_BYTES:
            raise Refused('diagnostics-byte-limit')
        if self.destination:
            self.destination.write(data)
            self.destination.flush()
            self.rows_written += 1
            self.bytes_written += len(data)
        self.row_count += 1
        self.max_cpu, self.max_lag = max(self.max_cpu, cpu), max(self.max_lag, self.interval_max_lag)
        self.previous, self.previous_at, self.previous_cpu = now, wall_at, usage
        self.lag_count, self.lags, self.interval_max_lag = 0, [], 0.0
        return row

    async def observe(self):
        next_at = self.monotonic() + 1
        while not self.proxy.stopping:
            await asyncio.sleep(max(0, next_at - self.monotonic()))
            if self.proxy.stopping:
                break
            self.sample()
            now = self.monotonic()
            next_at += int(max(0, now - next_at)) + 1

    def finish(self):
        try:
            self.sample('final')
        finally:
            if self.destination:
                self.destination.close()
        return {'periodMs': 1000, 'startedAtMs': self.started_at, 'endedAtMs': self.previous_at,
                'rowCount': self.row_count, 'rowsWritten': self.rows_written, 'bytesWritten': self.bytes_written,
                'maxCpuOneCorePercent': round(self.max_cpu, 3), 'maxIntervalLagMs': round(self.max_lag, 3),
                'outputWritten': self.destination is not None}


def emit(value):
    print(json.dumps(value, separators=(',', ':'), sort_keys=True), flush=True)


async def run(config, output, diagnostics_output=None):
    context = tls_context(config)
    index = interface_index()
    descriptors = fd_preflight(config['clientLimit'])
    proxy = Proxy(config, context, index)
    loop = asyncio.get_running_loop()
    previous_exception_handler = loop.get_exception_handler()
    loop.set_exception_handler(lambda _loop, _context: proxy.error('asyncio-error', 'asyncio'))
    for signum in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(signum, proxy.stop_event.set)
    started, reason = time.monotonic(), 'signal'
    cpu_before = resource.getrusage(resource.RUSAGE_SELF)
    lag_task = diagnostic_task = diagnostics = diagnostic_summary = None
    try:
        diagnostics = Diagnostics(proxy, diagnostics_output)
        proxy.diagnostics = diagnostics
        await proxy.start()
        lag_task = asyncio.create_task(proxy.observe_lag())
        async def observe_diagnostics():
            try:
                await diagnostics.observe()
            except Exception:
                proxy.error('diagnostics-failed', 'asyncio')
                proxy.stop_event.set()
        diagnostic_task = asyncio.create_task(observe_diagnostics())
        emit({'kind': 'ready', 'runId': config['runId'], 'pid': os.getpid(), 'listenHost': '127.0.0.1',
              'listenPorts': config['listenPorts'], 'remoteHost': HOST, 'remotePort': PORT,
              'serverName': SERVER_NAME, 'interface': 'en0', 'certSha256': config['certSha256'],
              'clientLimit': config['clientLimit'], 'socketLimit': proxy.socket_limit,
              'sessionSeconds': config['sessionSeconds'], **descriptors})
        try:
            await asyncio.wait_for(proxy.stop_event.wait(), config['sessionSeconds'])
        except TimeoutError:
            reason = 'session-expired'
    finally:
        await proxy.close()
        for task in [lag_task, diagnostic_task]:
            if task:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
        if diagnostics:
            try:
                diagnostic_summary = diagnostics.finish()
            except Exception:
                proxy.error('diagnostics-failed', 'asyncio')
        for signum in (signal.SIGINT, signal.SIGTERM):
            loop.remove_signal_handler(signum)
        loop.set_exception_handler(previous_exception_handler)
    cpu_after = resource.getrusage(resource.RUSAGE_SELF)
    result = {'kind': 'finished', 'runId': config['runId'], 'reason': reason,
              'durationSeconds': round(time.monotonic() - started, 3), 'independentUpstreamPerLocalTcp': True,
              'cleanup': not proxy.tasks and not proxy.writers and proxy.stats['activeConnections'] == 0,
              'resources': {'cpuUserSeconds': round(cpu_after.ru_utime - cpu_before.ru_utime, 6),
                            'cpuSystemSeconds': round(cpu_after.ru_stime - cpu_before.ru_stime, 6),
                            'maxRssMiB': round(cpu_after.ru_maxrss / (1024 ** 2 if sys.platform == 'darwin' else 1024), 3),
                            'eventLoopLag': proxy.lag_summary(),
                            'definition': 'Own process CPU seconds and RSS high-water mark; sampled 100ms event-loop timer lateness, excluding kernel and network queues'},
              'errorDetails': proxy.error_details, 'diagnostics': diagnostic_summary, **proxy.stats}
    if output:
        fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as destination:
            json.dump(result, destination, separators=(',', ':'), sort_keys=True)
            destination.write('\n')
    emit(result)
    return 0 if result['cleanup'] and not result['errorCount'] and reason == 'signal' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--diagnostics-output', type=Path)
    args = parser.parse_args()
    try:
        config = read_config(args.config)
        for output in [args.output, args.diagnostics_output]:
            if output and (not output.is_absolute() or output.exists() or output.is_symlink()
                           or output.parent.resolve(strict=True) != output.parent):
                raise Refused('fresh-canonical-output-required')
        if args.diagnostics_output:
            parent = args.diagnostics_output.parent.stat()
            if parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) != 0o700:
                raise Refused('private-diagnostics-directory-required')
        if args.output and args.output == args.diagnostics_output:
            raise Refused('distinct-output-paths-required')
        return asyncio.run(run(config, args.output, args.diagnostics_output))
    except Exception as failure:
        emit({'kind': 'error', 'code': failure.code if isinstance(failure, Refused) else 'local-proxy-failed'})
        return 1


if __name__ == '__main__':
    sys.exit(main())
