import importlib.util, sys, unittest
from pathlib import Path
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy

class ScopeTest(unittest.TestCase):
    def test_only_requested_pair_can_leave(self):
        old = b'const games = [...REWARD_SLOT_GAMES, ...ARCADE_HOUSE_GAMES];\n'
        deploy.validate_source(old, b'const games = [...ARCADE_HOUSE_GAMES];\n')
    def test_other_game_change_is_rejected(self):
        with self.assertRaises(RuntimeError):
            deploy.validate_source(b'const games = [...REWARD_SLOT_GAMES, "other"];', b'const games = [];')
    def test_unexpected_or_repeated_token_is_rejected(self):
        for old in [b'const games = [];', b'...REWARD_SLOT_GAMES, ...REWARD_SLOT_GAMES, ']:
            with self.assertRaises(RuntimeError): deploy.validate_source(old, b'')
    def test_crlf_does_not_allow_another_source_change(self):
        deploy.validate_source(b'...REWARD_SLOT_GAMES, other\r\n', b'other\n')

if __name__ == '__main__': unittest.main()
