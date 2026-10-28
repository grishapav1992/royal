import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import uuid
import copy

spec = importlib.util.spec_from_file_location('stars_install', Path(__file__).with_name('install.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PrivateConfiguration(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.original = module.PROVIDER
        module.PROVIDER = Path(self.temporary.name)/'provider.env'
        module.PROVIDER.write_text('# existing settings\nNOWPAYMENTS_ENABLED=false\nPRIVATE_OTHER_KEY=preserve-this\n')
        self.value = {
            'TELEGRAM_BOT_TOKEN': '123:'+'x'*30, 'TELEGRAM_BOT_USERNAME': 'fixture_bot',
            'TELEGRAM_WEBHOOK_SECRET': 's'*64, 'TELEGRAM_STARS_ENABLED': 'true',
            'TELEGRAM_STARS_TRIAL': 'true', 'TELEGRAM_STARS_TRIAL_ACCOUNT_IDS': str(uuid.uuid4()),
            'TELEGRAM_STARS_USDT_UNITS_PER_STAR': '10000',
            'TELEGRAM_STARS_TERMS_URL': 'https://example.test/api/telegram-stars/terms',
            'TELEGRAM_STARS_SUPPORT_URL': 'https://t.me/fixture_bot',
            'TELEGRAM_STARS_PUBLIC_ORIGIN': 'https://example.test',
        }

    def tearDown(self):
        module.PROVIDER = self.original
        self.temporary.cleanup()

    def test_preserves_other_provider_settings_and_private_mode(self):
        module.environment(self.value)
        text = module.PROVIDER.read_text()
        self.assertIn('NOWPAYMENTS_ENABLED=false\nPRIVATE_OTHER_KEY=preserve-this\n', text)
        self.assertEqual(os.stat(module.PROVIDER).st_mode & 0o777, 0o600)
        self.assertEqual(text.count('TELEGRAM_STARS_ENABLED='), 1)

    def test_rejects_activation_outside_owner_probe_before_writing(self):
        before = module.PROVIDER.read_bytes()
        for change in [{'NOWPAYMENTS_ENABLED': 'true'}, {'TELEGRAM_STARS_TRIAL': 'false'},
                       {'TELEGRAM_STARS_USDT_UNITS_PER_STAR': '20000'},
                       {'TELEGRAM_STARS_TRIAL_ACCOUNT_IDS': self.value['TELEGRAM_STARS_TRIAL_ACCOUNT_IDS']+','+str(uuid.uuid4())},
                       {'TELEGRAM_BOT_USERNAME': 'fixture\nPGHOST=attacker'}]:
            with self.assertRaises((RuntimeError, ValueError)):
                module.environment({**self.value, **change})
            self.assertEqual(module.PROVIDER.read_bytes(), before)

    def test_existing_secret_file_is_preserved(self):
        module.PROVIDER.write_text('TELEGRAM_BOT_TOKEN_FILE=/run/secrets/existing\n')
        with self.assertRaisesRegex(RuntimeError, 'file secrets'):
            module.environment(self.value)
        self.assertEqual(module.PROVIDER.read_text(), 'TELEGRAM_BOT_TOKEN_FILE=/run/secrets/existing\n')


class Fingerprint(unittest.TestCase):
    def test_mount_order_does_not_hide_changes_to_mounts_or_environment(self):
        row = {'Config': {'Env': ['KEEP=1']}, 'HostConfig': {'ReadonlyRootfs': True},
               'Mounts': [{'Destination': '/app/data', 'Source': '/private/data', 'RW': True},
                          {'Destination': '/run/secrets/key', 'Source': '/private/key', 'RW': False}]}
        reordered = copy.deepcopy(row)
        reordered['Mounts'].reverse()
        self.assertEqual(module.container_configuration(row), module.container_configuration(reordered))
        reordered['Mounts'][0]['RW'] = True
        self.assertNotEqual(module.container_configuration(row), module.container_configuration(reordered))
        changed = copy.deepcopy(row)
        changed['Config']['Env'] = ['KEEP=2']
        self.assertNotEqual(module.container_configuration(row), module.container_configuration(changed))

    def test_image_inventory_reuse_requires_identical_image_clean_overlay_and_no_shadowing_mount(self):
        mounts = [{'Destination': '/app/data'}, {'Destination': '/app/game-modules'}]
        self.assertTrue(module.reusable_program('sha256:known', 'sha256:known', mounts, ['C /tmp']))
        self.assertFalse(module.reusable_program('sha256:other', 'sha256:known', mounts, []))
        for changed in ['/app/dist/index.html', '/app/node_modules/pg/index.js', '/app', '/app/package.json']:
            self.assertFalse(module.reusable_program('sha256:known', 'sha256:known', mounts, ['C '+changed]))
        for destination in ['/app', '/app/dist', '/app/dist-server/payments.js', '/app/node_modules/pg']:
            self.assertFalse(module.reusable_program('sha256:known', 'sha256:known', [{'Destination': destination}], []))


if __name__ == '__main__':
    unittest.main()
