import importlib.util
import io
import json
from pathlib import Path
from subprocess import CompletedProcess
import tarfile
import tempfile
import unittest
from unittest.mock import patch


REPO = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('distributed_chat_postgres', REPO / 'scripts' / 'prepare-distributed-chat-postgres.py')
node_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(node_module)
RUN_ID = '3562ad95-b301-4ef1-a629-08f63043e39c'
SYSTEM = '7591860058616182784'


def make_plan(role):
    plan = {'format': 1, 'purpose': node_module.PURPOSE, 'role': role, 'runId': RUN_ID, 'hostId': 'a' * 64,
            'expiresAtUnixMs': 1, 'listenAddress': '10.90.0.2', 'port': 25432}
    if role != 'game':
        plan.update(peerAddress='10.90.0.3', replicationPassword='b' * 64)
    if role != 'standby':
        plan['password'] = 'c' * 64
    if role == 'primary':
        plan.update(tlsCertificateFile='/test/primary.pem', tlsKeyFile='/test/primary.key')
    if role == 'standby':
        plan.update(systemIdentifier=SYSTEM, primaryPort=25432, primaryDnsName='test-primary.example.test', tlsRootFile='/test/ca.pem')
    return plan


def tar_with(path, files):
    with tarfile.open(path, 'w') as archive:
        for name, content in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))


class FakeNode(node_module.Node):
    def __init__(self, plan, root):
        super().__init__(node_module.validate_plan(plan), runs=root)
        self.running = False
        self.commands = []
        self.boot_configs = []
        self.marker = False
        self.ready_replica = False
        self.source_system = SYSTEM
        self.extra_archive = False

    def pid(self):
        return 12345 if self.running else None

    def invoke(self, binary, args, *, sql=None, timeout=45):
        self.commands.append((binary, [str(arg) for arg in args], sql))
        if binary == 'initdb':
            self.data.mkdir()
            (self.data / 'PG_VERSION').write_text('17\n')
            (self.data / 'postgresql.auto.conf').write_text('# no overrides\n')
        elif binary == 'pg_ctl':
            self.running = args[-1] == 'start'
            if self.running:
                self.boot_configs.append((self.data / 'postgresql.conf').read_text())
        elif binary == 'pg_controldata':
            return f'Database system identifier:           {SYSTEM}'
        elif binary == 'pg_basebackup':
            root = Path(args[args.index('-D') + 1])
            tar_with(root / 'base.tar', {'PG_VERSION': b'17\n', 'postgresql.auto.conf': b'# no overrides\n'})
            tar_with(root / 'pg_wal.tar', {'000000010000000000000001': b'test'})
            if self.extra_archive:
                tar_with(root / '10001.tar', {})
        elif binary == 'psql':
            if sql is None:
                return self.source_system + '\t1\t0/ABCD\t'
            if sql.startswith('SELECT json_build_object'):
                replica = {'name': node_module.STANDBY, 'peer': self.plan.get('peerAddress'), 'state': 'streaming',
                           'syncState': 'sync', 'flushLsn': '0/AABB'}
                return json.dumps({'systemIdentifier': SYSTEM, 'serverVersion': '170010', 'runId': self.plan['runId'],
                                   'hostId': self.plan['hostId'], 'recovery': self.role == 'standby', 'fsync': 'on',
                                   'synchronousCommit': 'on', 'synchronousStandbyNames': 'FIRST 1 (royal_chat_load_standby)',
                                   'replication': [replica] if self.ready_replica else []})
            if sql.startswith('SELECT EXISTS'):
                return 't' if self.marker else 'f'
            if sql.startswith('BEGIN; INSERT INTO public.stand_probe'):
                self.marker = True
                return '0/AABC'
        return ''


class DistributedPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workspace = REPO / 'artifacts' / 'work'
        workspace.mkdir(parents=True, exist_ok=True)
        cls.temporary = tempfile.TemporaryDirectory(prefix='chat-postgres-node-test-', dir=workspace)
        cls.addClassCleanup(cls.temporary.cleanup)
        cls.root = Path(cls.temporary.name)

    def fake_node(self, role, name):
        root = self.root / name
        root.mkdir()
        return FakeNode(make_plan(role), root)

    def fake_local_guards(self):
        for name in ('private_dir', 'trusted_binary', 'require_unmounted_tree', 'tls_file'):
            self.enterContext(patch.object(node_module, name))

    def test_primary_is_private_and_marker_requires_live_synchronous_standby(self):
        self.fake_local_guards()
        node = self.fake_node('primary', 'primary')
        node.prepare()
        self.assertFalse(node.running)
        self.assertIn("listen_addresses = ''", node.boot_configs[0])
        self.assertNotIn('synchronous_standby_names', node.boot_configs[0])
        self.assertNotIn(node.plan['password'], node.owner.read_text())
        conf, hba = node.settings()
        self.assertIn("listen_addresses = '10.90.0.2'", conf)
        self.assertIn("synchronous_standby_names = 'FIRST 1 (royal_chat_load_standby)'", conf)
        self.assertIn(f'hostssl replication {node.replication_role} 10.90.0.3/32', hba)
        self.assertIn('hostnossl royal_chat_load_chat royal_chat_load_chat 10.90.0.2/32', hba)
        self.assertNotIn('0.0.0.0/0', hba)
        node.start()
        with self.assertRaisesRegex(node_module.Refused, 'synchronous-replica-required'):
            node.verify()
        node.ready_replica = True
        proof = node.verify()
        self.assertEqual(proof['minimumReplayLsn'], '0/AABC')
        self.assertEqual(proof['systemIdentifier'], SYSTEM)
        self.assertTrue(proof['markerPresent'])
        node.stop()
        self.assertFalse(node.running)
        with (node.data / 'postgresql.auto.conf').open('a') as override:
            override.write("data_directory = '/unsafe'\n")
        with self.assertRaisesRegex(node_module.Refused, 'postgres-auto-configuration-override'):
            node.start()

    def test_standby_checks_identity_and_copies_only_the_owned_cluster(self):
        self.fake_local_guards()
        node = self.fake_node('standby', 'standby')
        node.prepare()
        basebackup = next(args for binary, args, _ in node.commands if binary == 'pg_basebackup')
        self.assertIn('tar', basebackup)
        self.assertIn('sslmode=verify-full', basebackup[-1])
        self.assertIn('hostaddr=10.90.0.3', basebackup[-1])
        self.assertNotIn(node.plan['replicationPassword'], basebackup[-1])
        self.assertTrue((node.data / 'standby.signal').is_file())
        self.assertTrue((node.data / 'pg_wal' / '000000010000000000000001').is_file())
        self.assertFalse((node.work / 'backup').exists())
        self.assertIn('royal.chat_load_node_id', (node.data / 'postgresql.conf').read_text())
        node.start()
        self.assertTrue(node.status()['recovery'])
        node.stop()

        wrong = self.fake_node('standby', 'wrong-system')
        wrong.source_system = '7591860058616182785'
        with self.assertRaisesRegex(node_module.Refused, 'base-backup-source-identity-mismatch'):
            wrong.prepare()
        self.assertFalse(any(binary == 'pg_basebackup' for binary, _, _ in wrong.commands))

        tablespace = self.fake_node('standby', 'extra-tablespace')
        tablespace.extra_archive = True
        with self.assertRaisesRegex(node_module.Refused, 'unexpected-base-backup-archive'):
            tablespace.prepare()
        self.assertFalse(tablespace.data.exists())

    def test_game_uses_same_private_bootstrap_and_an_empty_owned_schema(self):
        self.fake_local_guards()
        node = self.fake_node('game', 'game')
        node.prepare()
        conf, hba = node.settings()
        sql = '\n'.join(command for _, _, command in node.commands if command)
        self.assertIn('CREATE DATABASE royal_chat_load_game OWNER royal_chat_load_game', sql)
        self.assertIn('CREATE SCHEMA royal_game AUTHORIZATION royal_chat_load_game', sql)
        self.assertNotIn('stand_probe', sql)
        self.assertNotIn('replication', hba)
        self.assertNotIn('primary_conninfo', conf)
        self.assertIn('hostnossl royal_chat_load_game royal_chat_load_game 10.90.0.2/32', hba)

    def test_rejects_public_peer_addresses_and_escaping_or_linked_tar_members(self):
        for field, bad in [('listenAddress', '203.0.113.8'), ('peerAddress', '10.90.0.2'), ('primaryDnsName', 'primary host')]:
            with self.subTest(field=field):
                with self.assertRaises(node_module.Refused):
                    node_module.validate_plan({**make_plan('standby'), field: bad})
        target = self.root / 'extract'
        target.mkdir()
        archive = self.root / 'unsafe.tar'
        tar_with(archive, {'../escape': b'bad'})
        with self.assertRaisesRegex(node_module.Refused, 'unsafe-base-backup-member'):
            node_module.extract_tar(archive, target, 10)
        self.assertFalse((self.root / 'escape').exists())
        with tarfile.open(archive, 'w') as bundle:
            member = tarfile.TarInfo('symlink')
            member.type = tarfile.SYMTYPE
            member.linkname = '../escape'
            bundle.addfile(member)
        with self.assertRaisesRegex(node_module.Refused, 'unsafe-base-backup-member'):
            node_module.extract_tar(archive, target, 10)

    def test_commit_warning_cannot_produce_verified_replay_lsn(self):
        node = node_module.Node(make_plan('primary'), runs=self.root)
        process = CompletedProcess([], 0, stdout='0/AABC\n', stderr='psql:<stdin>:1: WARNING: canceling wait for synchronous replication\n')
        with patch.object(node_module, 'trusted_binary', return_value=Path('fake-psql')), \
             patch.object(node_module.subprocess, 'run', return_value=process):
            with self.assertRaisesRegex(node_module.Refused, 'postgres-psql-failed'):
                node.local_sql('COMMIT; SELECT pg_current_wal_flush_lsn();')

    def test_cleanup_refuses_a_mount_inside_the_owned_root(self):
        with patch.object(Path, 'read_text', return_value='1 2 0:1 / /var/lib rw - ext4 test rw\n'):
            node_module.require_unmounted_tree('/var/lib/royal-chat-load/runs/sample')
        mounted = '3 2 0:1 /source /var/lib/royal-chat-load/runs/sample/data rw - ext4 test rw\n'
        with patch.object(Path, 'read_text', return_value=mounted):
            with self.assertRaisesRegex(node_module.Refused, 'unexpected-mount-in-test-node'):
                node_module.require_unmounted_tree('/var/lib/royal-chat-load/runs/sample')


if __name__ == '__main__':
    unittest.main()
