"""TCP diagnostics parser and read-only ownership checks without SSH or ss execution."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch

SOURCE = Path(__file__).resolve().parents[1] / 'load-tls-tcp-status.py'
SPEC = importlib.util.spec_from_file_location('tls_tcp_status_tested', SOURCE)
DIAGNOSTIC = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DIAGNOSTIC)
RUN = 'e67dc241-1a2e-4b3f-91d0-037b901c929e'
STAND_RUN = 'a4e53b5a-6725-45b6-961f-670dca22bdb7'
CONNECTED = b'''ESTAB 4 32 31.56.189.118:26443 192.0.2.10:60100
\t cubic wscale:7,7 rto:208 rtt:3.5/0.8 retrans:1/5 bytes_retrans:4096 bytes_acked:12000 bytes_sent:14000 notsent:800
  0 8 [::ffff:31.56.189.118]:26443 [::ffff:192.0.2.11]:60101
\t cubic rto:212 rtt:8.25/0.25 retrans:0/2 bytes_retrans:2048 bytes_acked:9000 bytes_sent:11000 notsent:200
'''


def gateway():
    return {'ready': True, 'closed': False, 'assetsRemoved': False, 'runId': RUN, 'standRunId': STAND_RUN,
            'containerId': 'a' * 64, 'certificateSha256': 'b' * 64, 'configSha256': 'c' * 64,
            'caddyPid': 900, 'caddyStartTicks': '12345', 'port': 26443, 'serverName': 'royal-load.test',
            'unusedSecret': 'NEVER-OUTPUT-THIS'}


class TlsTcpStatusTests(unittest.TestCase):
    def test_canned_tcp_variants_preserve_queue_retrans_bytes_rtt_and_coverage(self):
        value = DIAGNOSTIC.parse_ss(CONNECTED)
        self.assertEqual(value['connectedFlows'], 2)
        self.assertEqual(value['tcpInfoFlows'], 2)
        self.assertEqual((value['recvQueueBytesTotal'], value['recvQueueBytesMax']), (4, 4))
        self.assertEqual((value['sendQueueBytesTotal'], value['sendQueueBytesMax']), (40, 32))
        self.assertEqual((value['retransCurrentTotal'], value['retransTotalActiveFlowsTotal']), (1, 7))
        self.assertEqual(value['bytesRetransActiveFlowsTotal'], 6144)
        self.assertEqual(value['bytesAckedActiveFlowsTotal'], 21000)
        self.assertEqual(value['bytesSentActiveFlowsTotal'], 25000)
        self.assertEqual((value['notSentBytesTotal'], value['notSentBytesMax']), (1000, 800))
        self.assertEqual((value['rttMsMean'], value['rttMsMax'], value['rtoMsMax']), (5.875, 8.25, 212))
        self.assertTrue(all(count == 2 for count in value['coverage'].values()))
        self.assertNotIn('192.0.2', json.dumps(value))
        self.assertNotIn('31.56', json.dumps(value))

    def test_missing_fields_and_zero_connections_have_explicit_zero_coverage(self):
        value = DIAGNOSTIC.parse_ss(b'0 0 31.56.189.118:26443 192.0.2.10:60000\n\t cubic rtt:1/0.1\n')
        self.assertEqual(value['connectedFlows'], 1)
        self.assertEqual(value['coverage']['rtt'], 1)
        self.assertEqual(value['coverage']['retrans'], 0)
        self.assertEqual(value['coverage']['bytes_retrans'], 0)
        empty = DIAGNOSTIC.parse_ss(b'')
        self.assertEqual(empty['connectedFlows'], 0)
        self.assertTrue(all(count == 0 for count in empty['coverage'].values()))

    def test_counter_decreases_after_a_flow_closes_are_not_interpreted_as_negative_loss(self):
        earlier = DIAGNOSTIC.parse_ss(CONNECTED)
        later = DIAGNOSTIC.parse_ss(CONNECTED.split(b'  0 8')[0])
        self.assertLess(later['retransTotalActiveFlowsTotal'], earlier['retransTotalActiveFlowsTotal'])
        self.assertLess(later['bytesSentActiveFlowsTotal'], earlier['bytesSentActiveFlowsTotal'])
        self.assertIn('closed flows disappear', DIAGNOSTIC.DEFINITION)
        self.assertIn('not total loss', DIAGNOSTIC.DEFINITION)

    def test_malformed_wrong_port_wrong_state_duplicate_and_out_of_budget_data_refuse(self):
        samples = [b'0 0 31.56.189.118:443 192.0.2.10:60000\n',
                   b'LISTEN 0 0 31.56.189.118:26443 192.0.2.10:60000\n', b'\t cubic rtt:1/0.1\n',
                   b'0 0 31.56.189.118:26443 192.0.2.10:60000\n\t bytes_sent:-1\n',
                   b'0 0 31.56.189.118:26443 192.0.2.10:60000\n\t rtt:NaN/1\n',
                   b'0 0 31.56.189.118:26443 192.0.2.10:60000\n\t retrans:5\n',
                   b'0 0 31.56.189.118:26443 192.0.2.10:60000\n\t bytes_sent:1 bytes_sent:2\n',
                   b'0 0 31.56.189.118:26443 192.0.2.10:60000\n\t bytes_sent:999999999999999999\n',
                   b'\xff', b'x' * (DIAGNOSTIC.MAX_BYTES + 1)]
        for sample in samples:
            with self.subTest(sample=sample[:100]), self.assertRaises(DIAGNOSTIC.Refused):
                DIAGNOSTIC.parse_ss(sample)

    def test_collect_checks_same_live_gateway_twice_and_only_exports_numeric_aggregates(self):
        stand = Mock(plan={'runId': RUN})
        stand.tls_status.return_value = gateway()
        sampler = Mock(return_value=CONNECTED)
        with patch.object(DIAGNOSTIC.time, 'time', return_value=1791750000):
            value = DIAGNOSTIC.collect(stand, sampler)
        self.assertEqual(stand.tls_status.call_count, 2)
        stand.tls_status.assert_called_with(probe=False)
        sampler.assert_called_once_with()
        self.assertEqual(value['sampledAtMs'], 1791750000000)
        self.assertEqual(value['standRunId'], STAND_RUN)
        self.assertEqual(value['containerId'], 'a' * 64)
        encoded = json.dumps(value)
        for forbidden in ['192.0.2', 'NEVER-OUTPUT-THIS', 'certificateSha256', 'caddyPid', 'raw', 'peer']:
            self.assertNotIn(forbidden, encoded)

    def test_inactive_or_cancelled_gateway_refuses_before_sampling(self):
        for change in [{'ready': False}, {'closed': True}, {'assetsRemoved': True}, {'runId': STAND_RUN}, {'port': 443}]:
            stand = Mock(plan={'runId': RUN})
            stand.tls_status.return_value = {**gateway(), **change}
            sampler = Mock(return_value=CONNECTED)
            with self.subTest(change=change), self.assertRaises(DIAGNOSTIC.Refused):
                DIAGNOSTIC.collect(stand, sampler)
            sampler.assert_not_called()

    def test_provenance_change_after_ss_refuses_entire_snapshot(self):
        for change in [{'containerId': 'd' * 64}, {'caddyStartTicks': '12346'}, {'certificateSha256': 'd' * 64},
                       {'standRunId': RUN}, {'ready': False}]:
            stand = Mock(plan={'runId': RUN})
            stand.tls_status.side_effect = [gateway(), {**gateway(), **change}]
            with self.subTest(change=change), self.assertRaises(DIAGNOSTIC.Refused):
                DIAGNOSTIC.collect(stand, lambda: CONNECTED)

    def fake_child(self):
        child = Mock()
        child.stdout.fileno.return_value = 11
        live = {'value': True}
        child.poll.side_effect = lambda: None if live['value'] else 0
        child.kill.side_effect = lambda: live.update(value=False)
        child.wait.side_effect = lambda **_: live.update(value=False) or 0
        return child

    def test_ss_command_has_fixed_source_port_no_process_data_and_three_second_deadline(self):
        child = self.fake_child()
        selector = MagicMock()
        selector.__enter__.return_value = selector
        selector.select.return_value = [(None, None)]
        with patch.object(DIAGNOSTIC.subprocess, 'Popen', return_value=child) as popen, \
                patch.object(DIAGNOSTIC.selectors, 'DefaultSelector', return_value=selector), \
                patch.object(DIAGNOSTIC.os, 'read', side_effect=[CONNECTED, b'']), \
                patch.object(DIAGNOSTIC.time, 'monotonic', return_value=100):
            self.assertEqual(DIAGNOSTIC.read_ss(), CONNECTED)
        self.assertEqual(popen.call_args.args[0], DIAGNOSTIC.SS_COMMAND)
        self.assertNotIn('-p', DIAGNOSTIC.SS_COMMAND)
        self.assertEqual(popen.call_args.kwargs['stderr'], DIAGNOSTIC.subprocess.DEVNULL)
        self.assertEqual(selector.select.call_args.args, (3,))
        child.kill.assert_not_called()
        child.stdout.close.assert_called_once()

    def test_ss_output_budget_kills_only_its_child_and_never_returns_a_partial_sample(self):
        child = self.fake_child()
        selector = MagicMock()
        selector.__enter__.return_value = selector
        selector.select.return_value = [(None, None)]
        chunks = [b'x' * 65536] * 16 + [b'x']
        with patch.object(DIAGNOSTIC.subprocess, 'Popen', return_value=child), \
                patch.object(DIAGNOSTIC.selectors, 'DefaultSelector', return_value=selector), \
                patch.object(DIAGNOSTIC.os, 'read', side_effect=chunks), \
                patch.object(DIAGNOSTIC.time, 'monotonic', return_value=100):
            with self.assertRaisesRegex(DIAGNOSTIC.Refused, 'tcp-status-byte-budget'):
                DIAGNOSTIC.read_ss()
        child.kill.assert_called_once_with()
        child.stdout.close.assert_called_once()

    def test_ss_timeout_closes_its_pipe_and_does_not_emit_native_error(self):
        child = self.fake_child()
        selector = MagicMock()
        selector.__enter__.return_value = selector
        with patch.object(DIAGNOSTIC.subprocess, 'Popen', return_value=child), \
                patch.object(DIAGNOSTIC.selectors, 'DefaultSelector', return_value=selector), \
                patch.object(DIAGNOSTIC.time, 'monotonic', side_effect=[100, 103.1]):
            with self.assertRaisesRegex(DIAGNOSTIC.Refused, 'tcp-status-timeout'):
                DIAGNOSTIC.read_ss()
        child.kill.assert_called_once_with()
        child.stdout.close.assert_called_once()

    def test_private_file_reader_refuses_public_mode_symlink_and_hardlink(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory).resolve() / 'plan.json'
            path.write_bytes(b'{}')
            path.chmod(0o600)
            fstat = os.fstat

            def root_fstat(descriptor):
                actual = list(fstat(descriptor))
                actual[4] = 0
                return os.stat_result(actual)

            with patch.object(DIAGNOSTIC.os, 'fstat', side_effect=root_fstat):
                self.assertEqual(DIAGNOSTIC.private_bytes(path, 64), b'{}')
                path.chmod(0o644)
                with self.assertRaises(DIAGNOSTIC.Refused):
                    DIAGNOSTIC.private_bytes(path, 64)
                path.chmod(0o600)
                link = path.with_name('link.json')
                link.symlink_to(path)
                with self.assertRaises(DIAGNOSTIC.Refused):
                    DIAGNOSTIC.private_bytes(link, 64)
                link.unlink()
                os.link(path, link)
                with self.assertRaises(DIAGNOSTIC.Refused):
                    DIAGNOSTIC.private_bytes(path, 64)

    def test_unverified_helper_never_executes_and_frozen_helper_pin_matches_source(self):
        helper_source = SOURCE.with_name('load-dedicated-stand.py')
        self.assertEqual(hashlib.sha256(helper_source.read_bytes()).hexdigest(), DIAGNOSTIC.HELPER_SHA256)
        root = '/opt/royal-load-' + RUN
        plan = {'runId': RUN, 'targetHost': '31.56.189.118', 'ownedRoot': root, 'helperSha256': DIAGNOSTIC.HELPER_SHA256}
        values = [json.dumps(plan).encode(), b'raise AssertionError("UNVERIFIED-SOURCE-EXECUTED")']
        with patch.object(DIAGNOSTIC, 'private_bytes', side_effect=values), \
                patch.object(Path, 'lstat', return_value=Mock(st_mode=stat.S_IFDIR | 0o700, st_uid=0)):
            with self.assertRaisesRegex(DIAGNOSTIC.Refused, 'frozen-helper-digest-mismatch'):
                DIAGNOSTIC.load_stand(Path(root) / 'plan.json')

    def test_machine_mismatch_refuses_before_importing_the_verified_helper(self):
        root = '/opt/royal-load-' + RUN
        plan = {'runId': RUN, 'targetHost': '31.56.189.118', 'ownedRoot': root,
                'helperSha256': DIAGNOSTIC.HELPER_SHA256, 'machineIdSha256': hashlib.sha256(b'another-host\n').hexdigest()}
        source = SOURCE.with_name('load-dedicated-stand.py').read_bytes()
        with patch.object(DIAGNOSTIC, 'private_bytes', side_effect=[json.dumps(plan).encode(), source]), \
                patch.object(Path, 'lstat', return_value=Mock(st_mode=stat.S_IFDIR | 0o700, st_uid=0)), \
                patch.object(Path, 'open', return_value=io.BytesIO(b'test-host\n')), \
                patch.object(DIAGNOSTIC.importlib.util, 'module_from_spec') as module:
            with self.assertRaisesRegex(DIAGNOSTIC.Refused, 'dedicated-machine-identity-mismatch'):
                DIAGNOSTIC.load_stand(Path(root) / 'plan.json')
        module.assert_not_called()


if __name__ == '__main__':
    unittest.main()
