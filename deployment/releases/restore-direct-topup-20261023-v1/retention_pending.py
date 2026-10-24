"""Image references required by unfinished application and financial releases."""
import re


def pending_image_ids(built, manifest):
    values = [built.get(key) for key in ['image', 'game', 'financial', 'gameImage', 'financialImage']]
    before = manifest.get('before', {})
    values.extend([before.get('preparedImage'), (before.get('container') or {}).get('image')])
    return {ref for ref in values if isinstance(ref, str) and re.fullmatch(r'sha256:[a-f0-9]{64}', ref)}
