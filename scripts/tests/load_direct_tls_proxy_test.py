"""Offline configuration, binding and real loopback TLS checks for the owned proxy."""
import asyncio
import contextlib
import hashlib
import importlib.util
import json
import io
import os
from pathlib import Path
import socket
import signal
import ssl
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace

SOURCE = Path(__file__).resolve().parents[1] / 'load-direct-tls-proxy.py'
spec = importlib.util.spec_from_file_location('owned_tls_proxy', SOURCE)
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


def config(certificate):
    return {'runId': 'offline-proxy-test', 'clientLimit': 600, 'listenHost': '127.0.0.1',
            'listenPorts': [17100, 17102, 17103, 17104], 'remoteHost': '31.56.189.118', 'remotePort': 26443,
            'interface': 'en0', 'certSha256': hashlib.sha256(certificate.read_bytes()).hexdigest(),
            'publicCertPath': str(certificate), 'serverName': 'royal-load.test', 'sessionSeconds': 3300}


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='royal-proxy-test-', dir='/private/tmp')
        self.root = Path(self.directory.name)
        os.chmod(self.root, 0o700)
        self.cert = self.root / 'public.pem'
        self.cert.write_text('-----BEGIN CERTIFICATE-----\nnot-a-certificate\n-----END CERTIFICATE-----\n')
        self.file = self.root / 'config.json'
        self.save(config(self.cert))

    def tearDown(self):
        self.directory.cleanup()

    def save(self, value):
        self.file.write_text(json.dumps(value))
        os.chmod(self.file, 0o600)

    def test_fixed_schema_rejects_endpoint_and_limit_changes(self):
        self.assertEqual(proxy.read_config(self.file), config(self.cert))
        for change in [{'remoteHost': '127.0.0.1'}, {'remotePort': 443}, {'listenHost': '0.0.0.0'},
                       {'listenPorts': [17100, 17101, 17103, 17104]}, {'interface': 'utun7'},
                       {'serverName': 'other.test'}, {'clientLimit': 6001}, {'clientLimit': True},
                       {'sessionSeconds': 3301}, {'extra': 'rejected'}]:
            self.save({**config(self.cert), **change})
            with self.assertRaises(proxy.Refused):
                proxy.read_config(self.file)

    def test_config_permissions_symlink_and_hardlink_are_rejected(self):
        os.chmod(self.file, 0o644)
        with self.assertRaisesRegex(proxy.Refused, 'private-config-mode'):
            proxy.read_config(self.file)
        os.chmod(self.file, 0o600)
        os.chmod(self.root, 0o755)
        with self.assertRaisesRegex(proxy.Refused, 'private-config-parent'):
            proxy.read_config(self.file)
        os.chmod(self.root, 0o700)
        alias = self.root / 'link.json'
        alias.symlink_to(self.file)
        with self.assertRaises(proxy.Refused):
            proxy.read_config(alias)
        alias.unlink()
        os.link(self.file, alias)
        with self.assertRaises(proxy.Refused):
            proxy.read_config(self.file)

    def test_pinned_public_certificate_rejects_digest_and_private_key(self):
        value = config(self.cert)
        with self.assertRaisesRegex(proxy.Refused, 'certificate-digest-mismatch'):
            proxy.tls_context({**value, 'certSha256': '0' * 64})
        self.cert.write_text('-----BEGIN PRIVATE KEY-----\nnever-accepted\n')
        with self.assertRaisesRegex(proxy.Refused, 'public-certificate-only'):
            proxy.tls_context(config(self.cert))

    def test_native_binding_is_ipv4_en0_and_closes_on_failure(self):
        with patch.object(proxy.sys, 'platform', 'darwin'), patch.object(proxy.socket, 'if_nametoindex', return_value=11) as lookup:
            self.assertEqual(proxy.interface_index(), 11)
            lookup.assert_called_once_with('en0')
        with patch.object(proxy.sys, 'platform', 'linux'):
            with self.assertRaisesRegex(proxy.Refused, 'macos-interface-binding'):
                proxy.interface_index()
        raw = Mock()
        with patch.object(proxy.socket, 'socket', return_value=raw) as factory:
            self.assertIs(proxy.bound_socket(11), raw)
            factory.assert_called_once_with(socket.AF_INET, socket.SOCK_STREAM)
            raw.setsockopt.assert_any_call(socket.IPPROTO_IP, 25, 11)
            raw.setsockopt.assert_any_call(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            raw.setblocking.assert_called_once_with(False)
            raw.setsockopt.side_effect = OSError('ignored-private-message')
            with self.assertRaisesRegex(proxy.Refused, 'interface-bind-failed'):
                proxy.bound_socket(11)
            raw.close.assert_called_once()

    def test_fd_budget_raises_only_own_soft_limit_and_preserves_hard(self):
        with patch.object(proxy.resource, 'getrlimit', side_effect=[(256, 16000), (12256, 16000)]), patch.object(proxy.resource, 'setrlimit') as setter:
            self.assertEqual(proxy.fd_preflight(6000)['requiredFds'], 12256)
            setter.assert_called_once_with(proxy.resource.RLIMIT_NOFILE, (12256, 16000))
        with patch.object(proxy.resource, 'getrlimit', return_value=(256, 1024)), patch.object(proxy.resource, 'setrlimit') as setter:
            with self.assertRaisesRegex(proxy.Refused, 'insufficient-hard-fd-limit'):
                proxy.fd_preflight(600)
            setter.assert_not_called()

    def test_full_session_loop_lag_tracking_is_bounded_with_exact_maximum(self):
        instance = proxy.Proxy(config(self.cert), None, 11)
        for index in range(33000):
            instance.record_lag(index % 100)
        summary = instance.lag_summary()
        self.assertEqual(summary['count'], 33000)
        self.assertEqual(summary['sampleCount'], 8192)
        self.assertEqual(summary['maxMs'], 99)
        self.assertEqual(summary['sampling'], 'bounded-reservoir')
        self.assertLessEqual(summary['p99Ms'], summary['maxMs'])

    def test_diagnostics_covers_full_session_and_final_flush_without_unbounded_memory(self):
        clock = [0.0]
        cpu = lambda: SimpleNamespace(ru_utime=clock[0] * 0.3, ru_stime=clock[0] * 0.2, ru_maxrss=1024 ** 2)
        instance = proxy.Proxy(config(self.cert), None, 11)
        output = self.root / 'resources.jsonl'
        diagnostics = proxy.Diagnostics(instance, output, monotonic=lambda: clock[0],
                                        wall=lambda: 1700000000 + clock[0], usage=cpu)
        for index in range(3300):
            clock[0] += 1
            instance.stats['bytesToLocal'] += 10
            diagnostics.record_lag(index % 11)
            diagnostics.sample()
        clock[0] += 0.25
        summary = diagnostics.finish()
        self.assertEqual(summary['rowCount'], 3302)
        self.assertEqual(summary['rowsWritten'], 3302)
        self.assertEqual(summary['bytesWritten'], output.stat().st_size)
        self.assertLess(summary['bytesWritten'], 8 * 1024 ** 2)
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        rows = [json.loads(line) for line in output.read_text().splitlines()]
        self.assertEqual(rows[0]['kind'], 'initial')
        self.assertEqual(rows[0]['intervalMs'], 0)
        self.assertEqual(rows[-1]['kind'], 'final')
        self.assertEqual(rows[-1]['intervalMs'], 250)
        self.assertEqual(rows[-1]['counters']['bytesToLocal'], 33000)
        self.assertEqual(summary['maxCpuOneCorePercent'], 50)
        self.assertEqual(summary['maxIntervalLagMs'], 10)
        self.assertFalse(hasattr(diagnostics, 'rows'))
        for previous, current in zip(rows, rows[1:]):
            self.assertEqual(current['intervalStartedAtMs'], previous['sampledAtMs'])
        with self.assertRaisesRegex(proxy.Refused, 'row-limit'):
            diagnostics.sample()

    def test_diagnostic_lag_reservoir_and_clock_failure_are_bounded(self):
        clock = [10]
        instance = proxy.Proxy(config(self.cert), None, 11)
        usage = lambda: SimpleNamespace(ru_utime=0, ru_stime=0, ru_maxrss=0)
        diagnostics = proxy.Diagnostics(instance, None, monotonic=lambda: clock[0], wall=lambda: clock[0], usage=usage)
        for index in range(10000):
            diagnostics.record_lag(index)
        clock[0] += 1
        row = diagnostics.sample()
        self.assertEqual(row['eventLoopLag']['count'], 10000)
        self.assertEqual(row['eventLoopLag']['sampleCount'], 128)
        self.assertEqual(row['eventLoopLag']['maxMs'], 9999)
        self.assertEqual(row['eventLoopLag']['sampling'], 'bounded-reservoir')
        clock[0] -= 2
        with self.assertRaisesRegex(proxy.Refused, 'clock-regressed'):
            diagnostics.sample()


class OperationTests(unittest.IsolatedAsyncioTestCase):
    async def test_timeout_runs_in_existing_task_and_external_cancellation_is_preserved(self):
        current = asyncio.current_task()
        async def task_identity():
            return asyncio.current_task()
        self.assertIs(await proxy.operation('to-local-read', task_identity(), 1), current)
        with self.assertRaises(proxy.OperationFailure) as failure:
            await proxy.operation('to-upstream-drain', asyncio.sleep(3600), 0.001)
        self.assertEqual(failure.exception.stage, 'to-upstream-drain')
        self.assertEqual(proxy.failure_type(failure.exception.failure), 'timeout')
        task = asyncio.create_task(proxy.operation('to-local-read', asyncio.sleep(3600), 10))
        await asyncio.sleep(0)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task

    async def test_reset_stage_is_sanitized_and_still_counts_as_failed_connection(self):
        instance = proxy.Proxy({'clientLimit': 1}, None, 11)
        class Reader:
            def __init__(self, reset=False):
                self.reset = reset
            async def read(self, _size):
                if self.reset:
                    raise ConnectionResetError('private cookies and peer must never appear')
                await asyncio.sleep(3600)
        class Writer:
            transport = Mock()
            def close(self):
                pass
            async def wait_closed(self):
                pass
        remote = Writer()
        async def upstream():
            return Reader(True), remote
        instance.upstream = upstream
        instance.stats['activeConnections'] = 1
        await instance.handle(Reader(), Writer())
        self.assertEqual(instance.stats['errorCount'], 1)
        self.assertEqual(instance.stats['errors'], {'stream-failed': 1})
        self.assertEqual(instance.error_details, {'to-local-read/connection-reset': 1})
        self.assertEqual(instance.stats['activeConnections'], 0)
        self.assertNotIn('private', json.dumps(instance.error_details))
        instance.error('asyncio-error', 'private-stage', 'private-type')
        self.assertEqual(instance.error_details['unknown/other'], 1)

    async def test_write_backpressure_failure_is_attributed_before_bytes_are_counted(self):
        instance = proxy.Proxy({'clientLimit': 1}, None, 11)
        class Reader:
            async def read(self, _size):
                return b'offline-only'
        class Writer:
            def write(self, _data):
                pass
            async def drain(self):
                raise BrokenPipeError('never report this private message')
        with self.assertRaises(proxy.OperationFailure) as failure:
            await instance.pump(Reader(), Writer(), 'bytesToUpstream')
        self.assertEqual(failure.exception.stage, 'to-upstream-drain')
        self.assertEqual(proxy.failure_type(failure.exception.failure), 'broken-pipe')
        self.assertEqual(instance.stats['bytesToUpstream'], 0)


class LoopbackTlsTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix='royal-proxy-tls-test-', dir='/private/tmp')
        cls.root = Path(cls.directory.name)
        for name, hostname in [('valid', 'royal-load.test'), ('wrong', 'wrong.test')]:
            configuration = cls.root / (name + '.cnf')
            configuration.write_text('[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\nCN=' + hostname + '\n[ext]\nsubjectAltName=DNS:' + hostname + '\nbasicConstraints=critical,CA:TRUE\n')
            subprocess.run(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                            '-config', str(configuration), '-keyout', str(cls.root / (name + '.key')),
                            '-out', str(cls.root / (name + '.pem'))], timeout=20, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    async def asyncSetUp(self):
        self.received, self.server_tasks, self.server_writers = [], set(), set()
        self.proxy = self.server = None
        self.patches = []
        asyncio.get_running_loop().set_exception_handler(lambda _loop, _context: None)

    async def asyncTearDown(self):
        if self.proxy:
            await self.proxy.close()
        if self.server:
            self.server.close()
        for writer in list(self.server_writers):
            await proxy.close_writer(writer)
        tasks = list(self.server_tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self.server:
            await asyncio.wait_for(self.server.wait_closed(), 3)
        for replacement in reversed(self.patches):
            replacement.stop()

    async def setup_proxy(self, served='valid', trusted='valid', client_limit=2):
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.load_cert_chain(self.root / (served + '.pem'), self.root / (served + '.key'))

        async def echo(reader, writer):
            task = asyncio.current_task()
            self.server_tasks.add(task)
            self.server_writers.add(writer)
            self.received.append(writer.get_extra_info('peername'))
            try:
                while data := await reader.read(65536):
                    writer.write(data)
                    await writer.drain()
            finally:
                self.server_tasks.discard(task)
                self.server_writers.discard(writer)
                await proxy.close_writer(writer)

        self.server = await asyncio.start_server(echo, '127.0.0.1', 0, ssl=server_context)
        remote_port = self.server.sockets[0].getsockname()[1]

        def local_socket(_index):
            raw = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            raw.setblocking(False)
            return raw

        for replacement in [patch.object(proxy, 'HOST', '127.0.0.1'), patch.object(proxy, 'PORT', remote_port), patch.object(proxy, 'bound_socket', side_effect=local_socket)]:
            replacement.start()
            self.patches.append(replacement)
        value = {**config(self.root / (trusted + '.pem')), 'listenPorts': [0], 'clientLimit': client_limit}
        self.proxy = proxy.Proxy(value, proxy.tls_context(value), 11)
        await self.proxy.start()
        return self.proxy.servers[0].sockets[0].getsockname()[1]

    async def test_real_tls_each_local_stream_has_independent_upstream_and_cleans_up(self):
        port = await self.setup_proxy()
        clients = [await asyncio.open_connection('127.0.0.1', port) for _ in range(3)]
        for index, (reader, writer) in enumerate(clients):
            payload = ('offline-message-' + str(index)).encode()
            writer.write(payload)
            await writer.drain()
            self.assertEqual(await asyncio.wait_for(reader.readexactly(len(payload)), 3), payload)
        self.assertEqual(self.proxy.stats['tlsConnections'], 3)
        self.assertEqual(self.proxy.stats['upstreamSocketsCreated'], 3)
        self.assertEqual(len(set(self.received)), 3)
        await self.proxy.close()
        for reader, writer in clients:
            self.assertEqual(await asyncio.wait_for(reader.read(), 3), b'')
            await proxy.close_writer(writer)
        self.assertEqual(self.proxy.stats['activeConnections'], 0)
        self.assertEqual(self.proxy.stats['errorCount'], 0)
        self.assertFalse(self.proxy.tasks)
        self.assertFalse(self.proxy.writers)

    async def test_wrong_certificate_authority_is_rejected_before_forwarding(self):
        await self.assert_rejected_tls('valid', 'wrong')

    async def test_correctly_trusted_wrong_server_name_is_rejected(self):
        await self.assert_rejected_tls('wrong', 'wrong')

    async def assert_rejected_tls(self, served, trusted):
        port = await self.setup_proxy(served, trusted)
        reader, writer = await asyncio.open_connection('127.0.0.1', port)
        self.assertEqual(await asyncio.wait_for(reader.read(), 3), b'')
        await proxy.close_writer(writer)
        await self.proxy.close()
        self.assertEqual(self.proxy.stats['tlsConnections'], 0)
        self.assertEqual(self.proxy.stats['errors'], {'tls-certificate-rejected': 1})
        self.assertEqual(self.proxy.stats['activeConnections'], 0)

    async def test_socket_limit_rejects_excess_without_creating_an_upstream(self):
        port = await self.setup_proxy(client_limit=1)
        self.proxy.socket_limit = 1
        reader, writer = await asyncio.open_connection('127.0.0.1', port)
        writer.write(b'one')
        await writer.drain()
        self.assertEqual(await asyncio.wait_for(reader.readexactly(3), 3), b'one')
        extra_reader, extra_writer = await asyncio.open_connection('127.0.0.1', port)
        self.assertEqual(await asyncio.wait_for(extra_reader.read(), 3), b'')
        await proxy.close_writer(extra_writer)
        self.assertEqual(self.proxy.stats['upstreamSocketsCreated'], 1)
        self.assertEqual(self.proxy.stats['rejectedConnections'], 1)
        self.assertEqual(self.proxy.stats['peakConnections'], 1)
        await proxy.close_writer(writer)

    async def test_intentional_signal_path_publishes_clean_safe_resource_summary(self):
        loop, printed = asyncio.get_running_loop(), io.StringIO()

        def install(signum, callback):
            if signum == signal.SIGTERM:
                loop.call_later(0.02, callback)

        value = {**config(self.root / 'valid.pem'), 'listenPorts': [0]}
        diagnostics_output = self.root / 'signal-diagnostics.jsonl'
        with patch.object(proxy, 'interface_index', return_value=11), patch.object(proxy, 'fd_preflight', return_value={'requiredFds': 1456, 'fdSoftLimit': 1456}), \
             patch.object(loop, 'add_signal_handler', side_effect=install), patch.object(loop, 'remove_signal_handler'), contextlib.redirect_stdout(printed):
            result = await proxy.run(value, None, diagnostics_output)
        self.assertEqual(result, 0)
        ready, finished = map(json.loads, printed.getvalue().splitlines())
        self.assertEqual(ready['kind'], 'ready')
        self.assertEqual(finished['kind'], 'finished')
        self.assertEqual(finished['activeConnections'], 0)
        self.assertTrue(finished['cleanup'])
        self.assertEqual(finished['reason'], 'signal')
        self.assertEqual(finished['errorCount'], 0)
        self.assertIn('cpuUserSeconds', finished['resources'])
        self.assertIn('eventLoopLag', finished['resources'])
        rows = [json.loads(line) for line in diagnostics_output.read_text().splitlines()]
        self.assertEqual([row['kind'] for row in rows], ['initial', 'final'])
        self.assertEqual(finished['diagnostics']['rowsWritten'], len(rows))
        self.assertEqual(finished['diagnostics']['bytesWritten'], diagnostics_output.stat().st_size)
        self.assertTrue(finished['diagnostics']['outputWritten'])
        self.assertEqual(finished['errorDetails'], {})
        for key in ['secret', 'token', 'certificate', 'payload', 'publicCertPath']:
            self.assertNotIn(key, ready)
            self.assertNotIn(key, finished)


if __name__ == '__main__':
    unittest.main()
