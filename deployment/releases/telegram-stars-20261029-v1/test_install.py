import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
import uuid

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


if __name__ == '__main__':
    unittest.main()
