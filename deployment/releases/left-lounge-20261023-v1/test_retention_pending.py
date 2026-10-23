import unittest
from retention_pending import pending_image_ids


class PendingReleaseImages(unittest.TestCase):
    def test_single_image_build_keeps_both_different_previous_images(self):
        refs = ['sha256:' + digit * 64 for digit in ['a', 'b', 'c']]
        self.assertEqual(pending_image_ids({'image': refs[0]},
            {'before': {'preparedImage': refs[1], 'container': {'image': refs[2]}}}), set(refs))

    def test_game_and_financial_build_keep_both_candidates_and_their_base(self):
        refs = ['sha256:' + digit * 64 for digit in ['a', 'b', 'c']]
        self.assertEqual(pending_image_ids({'game': refs[0], 'financial': refs[1]},
            {'before': {'preparedImage': refs[2]}}), set(refs))

    def test_missing_and_malformed_optional_references_are_ignored(self):
        self.assertEqual(pending_image_ids({'game': None, 'financialImage': 'sha256:invalid'},
            {'before': {'container': None}}), set())


if __name__ == '__main__':
    unittest.main()
