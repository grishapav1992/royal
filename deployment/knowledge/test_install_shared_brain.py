import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location('install_shared_brain', Path(__file__).with_name('install-shared-brain.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallSharedBrainTest(unittest.TestCase):
    def layout(self, root):
        unit_root = root / 'systemd'; unit_root.mkdir()
        runtime = root / 'runtime' / 'bin'; runtime.mkdir(parents=True)
        for name in ['node', 'uv']:
            path = runtime / name; path.write_bytes(b'executable'); path.chmod(0o700)
        return unit_root, root / 'config'

    def bundle(self, root, commit):
        source = root / 'releases' / commit; source.mkdir(parents=True)
        names = installer.CORE | {'docs/project-brain.md', 'ai-factory/project-knowledge/PROJECT.md'}
        rows = []
        for name in sorted(names):
            path = source / name; path.parent.mkdir(parents=True, exist_ok=True)
            raw = ('verified:' + name + ':' + commit).encode()
            if name == 'ai-factory/project-knowledge/manifest.json':
                raw = json.dumps({'schema_version':1,'summary':'PROJECT.md','documents':['docs/project-brain.md']}).encode()
            if name.endswith('.service'):
                raw = ('[Service]\nExecStart=' + str(root/'runtime/bin/node') + ' '
                       + str(root/'current/scripts/shared-brain-update.mjs') + '\n# ' + commit + '\n').encode()
            path.write_bytes(raw)
            rows.append({'path':name, 'sha256':hashlib.sha256(raw).hexdigest()})
        receipt = source / 'install-receipt.json'
        receipt.write_text(json.dumps({'schemaVersion':1,'githubVerified':True,'sourceCommit':commit,'files':rows}))
        return source, receipt

    def apply(self, source, receipt, root, unit_root, config_root, run):
        return installer.install(source, receipt, root, unit_root, config_root, os.getuid(), run)

    def temporary(self):
        # A normal home ancestor is trusted; system temporary roots are often world writable.
        return tempfile.TemporaryDirectory(prefix='.royal-brain-test-', dir=Path.home())

    def test_exact_bundle_installs_atomic_current_previous_and_enabled_config(self):
        with self.temporary() as temp:
            root = Path(temp); units, config = self.layout(root); run = Mock()
            first, first_receipt = self.bundle(root, 'a'*40)
            result = self.apply(first, first_receipt, root, units, config, run)
            self.assertEqual((root/'current').resolve(), first)
            self.assertFalse((root/'previous').exists())
            self.assertEqual(json.loads((config/'enabled.json').read_text()), {'schemaVersion':1,'enabled':True})
            self.assertFalse(result['gameRestarted']); self.assertFalse(result['graphUpdateQueued'])
            second, second_receipt = self.bundle(root, 'b'*40)
            self.apply(second, second_receipt, root, units, config, run)
            self.assertEqual((root/'current').resolve(), second)
            self.assertEqual((root/'previous').resolve(), first)
            self.assertTrue((first/'install-receipt.json').exists())
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual([command[:2] for command in commands], [['systemd-analyze','verify'],['systemctl','daemon-reload']]*2)

    def test_tampered_and_unreceipted_files_cannot_change_active_generation(self):
        for mode in ['tampered', 'extra', 'secret', 'incomplete']:
            with self.subTest(mode=mode), self.temporary() as temp:
                root = Path(temp); units, config = self.layout(root); source, receipt = self.bundle(root, 'a'*40); run = Mock()
                if mode == 'tampered': (source/'scripts/project-brain.mjs').write_text('unreviewed')
                if mode == 'extra': (source/'extra.txt').write_text('unreceipted')
                if mode == 'secret':
                    value = json.loads(receipt.read_text()); value['files'][0]['path'] = '.env'; receipt.write_text(json.dumps(value))
                if mode == 'incomplete':
                    value = json.loads(receipt.read_text()); value['files'] = value['files'][1:]; receipt.write_text(json.dumps(value))
                with self.assertRaises(RuntimeError): self.apply(source, receipt, root, units, config, run)
                run.assert_not_called(); self.assertFalse((root/'current').exists())

    def test_failed_systemd_reload_rolls_back_pointers_unit_and_config(self):
        with self.temporary() as temp:
            root = Path(temp); units, config = self.layout(root)
            first, receipt = self.bundle(root, 'a'*40)
            self.apply(first, receipt, root, units, config, Mock())
            old_unit = (units/installer.UNIT).read_bytes(); old_config = (config/'enabled.json').read_bytes()
            second, receipt = self.bundle(root, 'b'*40)
            run = Mock(side_effect=[None, RuntimeError('daemon reload failed'), None])
            with self.assertRaisesRegex(RuntimeError, 'daemon reload failed'):
                self.apply(second, receipt, root, units, config, run)
            self.assertEqual((root/'current').resolve(), first)
            self.assertFalse((root/'previous').exists())
            self.assertEqual((units/installer.UNIT).read_bytes(), old_unit)
            self.assertEqual((config/'enabled.json').read_bytes(), old_config)
            self.assertTrue(second.exists())

    def test_source_links_outside_pointer_and_missing_runtime_are_blocked(self):
        for mode in ['link', 'pointer', 'runtime']:
            with self.subTest(mode=mode), self.temporary() as temp:
                root = Path(temp); units, config = self.layout(root); source, receipt = self.bundle(root, 'a'*40); run = Mock()
                if mode == 'link':
                    path = source/'scripts/project-brain.mjs'; path.unlink(); path.symlink_to(root/'runtime/bin/node')
                if mode == 'pointer': (root/'current').symlink_to(root/'runtime', target_is_directory=True)
                if mode == 'runtime': (root/'runtime/bin/node').unlink()
                with self.assertRaises((RuntimeError, OSError)):
                    self.apply(source, receipt, root, units, config, run)
                run.assert_not_called()

    def test_context_manifest_requires_all_bound_documents(self):
        with self.temporary() as temp:
            root = Path(temp); units, config = self.layout(root); source, receipt = self.bundle(root, 'a'*40); run = Mock()
            value = json.loads(receipt.read_text())
            value['files'] = [row for row in value['files'] if row['path'] != 'docs/project-brain.md']
            (source/'docs/project-brain.md').unlink(); (source/'docs').rmdir()
            receipt.write_text(json.dumps(value))
            with self.assertRaisesRegex(RuntimeError, 'Incomplete graph knowledge context'):
                self.apply(source, receipt, root, units, config, run)
            run.assert_not_called()


if __name__ == '__main__': unittest.main()
