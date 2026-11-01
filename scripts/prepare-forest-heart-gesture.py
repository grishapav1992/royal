"""Prepare one existing packed-alpha gesture with a common neutral entry and exit.

Development-only asset tool. Requires numpy, opencv-python-headless and ffmpeg.
No generation API, credentials or game mathematics are used.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

import cv2
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('reference', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--review', type=Path, required=True)
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
args.review.mkdir(parents=True, exist_ok=True)
cv2.setNumThreads(2)
width, height, count, fps = 480, 576, 72, 24
reference = cv2.imread(str(args.reference), cv2.IMREAD_UNCHANGED)
if reference is None or reference.shape != (768, 640, 4):
    raise ValueError('Expected the actual 640x768 RGBA elf reference')
reference = cv2.resize(reference, (width, height), interpolation=cv2.INTER_AREA)

def premultiply(bgra):
    rgba = bgra.astype(np.float32) / 255
    rgba[:, :, :3] *= rgba[:, :, 3:4]
    return rgba

neutral = premultiply(reference)
neutral_gray = cv2.cvtColor(np.rint(neutral[:, :, :3] * 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
y, x = np.mgrid[:height, :width].astype(np.float32)
flow = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)

def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * t * (t * (t * 6 - 15) + 10)

def unpack(frame):
    alpha = frame[:, width:, 0:1].astype(np.float32) / 255
    rgb = frame[:, :width].astype(np.float32) / 255
    return np.concatenate((rgb * alpha, alpha), axis=2)

def pack(frame):
    alpha = np.clip(frame[:, :, 3:4], 0, 1)
    rgb = np.divide(frame[:, :, :3], np.maximum(alpha, 1 / 255))
    rgb[alpha[:, :, 0] < 1 / 255] = 0
    return np.rint(np.clip(np.concatenate((rgb, np.repeat(alpha, 3, axis=2)), axis=1), 0, 1) * 255).astype(np.uint8)

def remap(image, displacement, fraction):
    return cv2.remap(image, x - displacement[:, :, 0] * fraction, y - displacement[:, :, 1] * fraction,
                     cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)

capture = cv2.VideoCapture(str(args.source))
if not capture.isOpened() or int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) != width * 2 or int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) != height:
    raise ValueError('Expected the existing 960x576 packed RGB/alpha clip')
encoder = subprocess.Popen(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo',
    '-pixel_format', 'bgr24', '-video_size', f'{width*2}x{height}', '-framerate', str(fps), '-i', '-',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', str(args.output)], stdin=subprocess.PIPE)
metrics = []
first = last = None
try:
    for i in range(count):
        ok, source = capture.read()
        if not ok:
            raise ValueError(f'Source ended at frame {i}')
        moving = unpack(source)
        t = i / fps
        amount = smooth(t / .5) * (1 - smooth((t - 2.05) / .75))
        if amount <= 0:
            result = neutral.copy()
        elif amount >= 1:
            result = moving
        else:
            gray = cv2.cvtColor(np.rint(moving[:, :, :3] * 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
            forward = flow.calc(neutral_gray, gray, None)
            backward = flow.calc(gray, neutral_gray, None)
            # Limit bad correspondence spikes around transparent hair and costume edges.
            forward = np.clip(cv2.GaussianBlur(forward, (0, 0), 1.4), -32, 32)
            backward = np.clip(cv2.GaussianBlur(backward, (0, 0), 1.4), -32, 32)
            result = remap(neutral, forward, amount) * (1 - amount) + remap(moving, backward, 1 - amount) * amount
        packed = pack(result)
        if first is None:
            first = packed.copy()
        last = packed
        encoder.stdin.write(packed.tobytes())
        metrics.append({'frame': i, 'seconds': round(t, 6), 'gestureAmount': round(amount, 6)})
        if i in [0, 6, 12, 24, 48, 56, 62, 67, 71]:
            alpha = np.clip(result[:, :, 3:4], 0, 1)
            color = np.divide(result[:, :, :3], np.maximum(alpha, 1 / 255))
            rgba = np.rint(np.clip(np.concatenate((color, alpha), axis=2), 0, 1) * 255).astype(np.uint8)
            cv2.imwrite(str(args.review / f'frame-{i:02d}.png'), rgba)
finally:
    capture.release()
    encoder.stdin.close()
    status = encoder.wait()
if status:
    raise RuntimeError('Video encoding failed')
if not np.array_equal(first, last):
    raise AssertionError('Neutral endpoint frames differ before encoding')
report = {'source': str(args.source), 'sourceSha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
    'reference': str(args.reference), 'referenceSha256': hashlib.sha256(args.reference.read_bytes()).hexdigest(),
    'output': str(args.output), 'outputSha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
    'frames': count, 'fps': fps, 'seconds': count / fps, 'opencv': cv2.__version__,
    'method': 'Existing forward motion, neutral endpoint constraint, premultiplied bidirectional optical-flow interpolation near entry and exit',
    'entrySeconds': .5, 'returnStartSeconds': 2.05, 'neutralBySeconds': 2.8,
    'identicalNeutralEndpointsBeforeEncoding': True, 'newGenerationRequests': 0, 'curve': metrics}
(args.review / 'prepared.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'curve'}))
