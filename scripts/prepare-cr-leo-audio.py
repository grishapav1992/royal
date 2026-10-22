"""Prepare the five CR vs Leo recordings from the sources in docs/artwork/cr-leo-audio.json.

Usage: python scripts/prepare-cr-leo-audio.py <downloaded-source-directory>
Needs ffmpeg on PATH or the imageio-ffmpeg Python package. Source names match sources.json.
"""
import array
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
source = Path(sys.argv[1]).resolve()
ffmpeg = shutil.which('ffmpeg')
if not ffmpeg:
    import imageio_ffmpeg
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
output = root / 'public/assets/cr-vs-leo/audio/v1'
output.mkdir(parents=True, exist_ok=True)
metadata = json.loads((source / 'sources.json').read_text()) if (source / 'sources.json').exists() else json.loads((root / 'docs/artwork/cr-leo-audio.json').read_text(encoding='utf-8'))['recordings']
pages = {item['key']: {k: item[k] for k in ('key', 'page', 'url', 'bytes')} for item in metadata}
settings = [('ambient', 'stadium', 8, 25, .14, 0), ('goal', 'goal', .8, 4.8, .20, 1.1),
            ('miss', 'miss', .65, 3.8, .18, 1.0), ('cr', 'siuuu', 0, 1.83, .19, .10),
            ('leo', 'ankara-messi', 0, 2.8, .19, .12)]
records = []
for key, name, start, duration, target, fade in settings:
    path = source / (key + '.mp3')
    args = ['-ss', str(start), '-i', str(path), '-t', str(duration), '-af', 'highpass=f=100,lowpass=f=7000']
    data = array.array('f', subprocess.check_output([ffmpeg, '-v', 'error', *args, '-ac', '2', '-ar', '44100', '-f', 'f32le', '-']))
    if key == 'ambient':
        seam_frames = 44100
        seam = array.array('f')
        for i in range(seam_frames):
            mix = i / (seam_frames - 1)
            for channel in (0, 1):
                seam.append(data[len(data) - seam_frames*2 + i*2 + channel] * (1-mix) + data[i*2 + channel] * mix)
        data = data[seam_frames*2:-seam_frames*2] + seam
    rms = math.sqrt(sum(v*v for v in data) / len(data))
    gain = min(target / rms, .82 / max(abs(v) for v in data))
    frames = len(data) // 2
    for i in range(frames):
        envelope = 1 if key == 'ambient' else min(1, i / (44100 * .015), (frames - 1 - i) / (44100 * fade))
        for channel in (0, 1):
            data[i*2+channel] *= gain * envelope
    destination = output / (name + '.mp3')
    subprocess.run([ffmpeg, '-y', '-v', 'error', '-f', 'f32le', '-ar', '44100', '-ac', '2', '-i', '-',
                    '-map_metadata', '-1', '-codec:a', 'libmp3lame', '-b:a', '96k' if key in ('ambient', 'goal', 'miss') else '128k',
                    str(destination)], input=data.tobytes(), check=True)
    record = {**pages[key], 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
              'file': destination.relative_to(root).as_posix(), 'bytes': destination.stat().st_size,
              'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(), 'startSeconds': start,
              'durationSeconds': frames/44100, 'processing': '44.1 kHz stereo, filtered and level matched; one second seam crossfade' if key == 'ambient' else '44.1 kHz stereo, filtered, level matched, attack and release fades',
              'license': 'CC0 1.0' if key in ('ambient', 'goal', 'miss') else 'User-requested short recording excerpt; uploader does not specify a reuse license',
              'credit': 'Philipp Feit / itmightgetloud, Sound Of Sankt Pauli, Freesound' if key in ('ambient', 'goal', 'miss') else 'Myinstants uploader ' + ('akakasneci' if key == 'cr' else 'marcel168')}
    if key == 'ambient': record['sourceDownload'] = 'First 1,000,001 bytes of public preview, containing over 42 seconds of audio; excerpt ends at 33 seconds.'
    records.append(record)
manifest = {'date': '2026-10-22', 'purpose': 'CR vs Leo neutral stadium loop, goal and missed-chance reactions, and the two requested signature phrases.',
            'tool': 'FFmpeg 7.1 via imageio-ffmpeg 0.6.0; no speech synthesis or voice imitation.', 'recordings': records}
(root / 'docs/artwork/cr-leo-audio.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps([{'file': r['file'], 'seconds': r['durationSeconds'], 'bytes': r['bytes']} for r in records], indent=2))
