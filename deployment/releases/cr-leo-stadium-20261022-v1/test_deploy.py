"""Exercise automatic recovery exclusively inside a temporary directory."""
import ast
import io
import json
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest


class RecoveryTests(unittest.TestCase):
    def recover(self, prior_pointer):
        with tempfile.TemporaryDirectory(prefix='royal-ball-recovery-') as directory:
            root = Path(directory).resolve()
            live, backup, public = root / 'live', root / 'backup', root / 'modules'
            for path in [live / 'src/ui', backup, public / 'original-cr-vs-leo']:
                path.mkdir(parents=True)
            scene, ball = 'src/ui/CrLeoScene.ts', 'src/ui/crLeoBall.ts'
            (live / scene).write_bytes(b'new scene')
            (live / ball).write_bytes(b'new ball')
            (live / 'src/other.ts').write_bytes(b'preserve unrelated source')
            pointer = public / 'original-cr-vs-leo/active.json'
            pointer.write_text('new pointer')
            if prior_pointer:
                (backup / 'active.json').write_text('old pointer')
            with tarfile.open(backup / 'source.tgz', 'w:gz') as archive:
                member = tarfile.TarInfo(scene)
                member.size = len(b'old scene')
                archive.addfile(member, io.BytesIO(b'old scene'))
            source = ast.parse(Path(__file__).with_name('deploy.py').read_text())
            functions = [node for node in source.body if isinstance(node, ast.FunctionDef) and node.name in {'atomic', 'require', 'restore', 'write'}]
            scope = {'ROOT': root, 'LIVE': live, 'BACKUP': backup, 'PUBLIC': public, 'GAME': 'original-cr-vs-leo',
                     'OLD': {'source': {scene: 'old hash'}}, 'M': {'changes': {scene: 'new hash', ball: 'new hash'}},
                     'shutil': shutil, 'tarfile': tarfile, 'json': json}
            exec(compile(ast.Module(body=functions, type_ignores=[]), 'isolated-recovery', 'exec'), scope)
            scope['restore']()
            self.assertEqual((live / scene).read_bytes(), b'old scene')
            self.assertFalse((live / ball).exists())
            self.assertEqual((live / 'src/other.ts').read_bytes(), b'preserve unrelated source')
            self.assertEqual(pointer.read_text() if pointer.exists() else None, 'old pointer' if prior_pointer else None)
            self.assertTrue(json.loads((root / 'recovered.json').read_text())['priorPointerAndSourceRestored'])

    def test_recovery_restores_an_existing_override(self):
        self.recover(True)

    def test_recovery_restores_the_image_baseline(self):
        self.recover(False)
