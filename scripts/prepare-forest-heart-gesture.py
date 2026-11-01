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
parser.add_argument('--return-start', type=float, default=2.05)
parser.add_argument('--neutral-at', type=float, default=2.8)
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
flow.setFinestScale(0)

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

def morph_maps(displacement, amount):
    # A coarse, fold-free mesh keeps correspondence errors from tearing hair or faces.
    gx, gy = np.meshgrid(np.linspace(0, width - 1, 21, dtype=np.float32),
                         np.linspace(0, height - 1, 25, dtype=np.float32))
    base = np.stack((gx, gy), axis=2)
    delta = np.nan_to_num(cv2.remap(displacement, gx, gy, cv2.INTER_LINEAR))
    delta[:, :, 0] = np.clip(delta[:, :, 0], 1 - gx, width - 2 - gx)
    delta[:, :, 1] = np.clip(delta[:, :, 1], 1 - gy, height - 2 - gy)
    delta[0] = delta[-1] = 0
    delta[:, 0] = delta[:, -1] = 0
    cell_area = (width - 1) * (height - 1) / (20 * 24)
    for attempt in range(40):
        bad = np.zeros((24, 20), dtype=bool)
        for weight in [.25, .5, .75, 1, amount]:
            grid = base + delta * weight
            a, b, c, d = grid[:-1, :-1], grid[:-1, 1:], grid[1:, :-1], grid[1:, 1:]
            cross = lambda u, v: u[:, :, 0] * v[:, :, 1] - u[:, :, 1] * v[:, :, 0]
            bad |= (cross(b - a, c - a) < cell_area * .2) | (cross(d - b, c - b) < cell_area * .2)
        if not bad.any():
            break
        vertices = np.zeros((25, 21), dtype=bool)
        vertices[:-1, :-1] |= bad
        vertices[:-1, 1:] |= bad
        vertices[1:, :-1] |= bad
        vertices[1:, 1:] |= bad
        average = cv2.GaussianBlur(delta, (3, 3), 0)
        delta[vertices] = .65 * delta[vertices] + .35 * average[vertices]
        if attempt > 15:
            delta[vertices] *= .8
    else:
        delta[:] = 0
    moved = base + delta
    target = base + amount * delta
    bx, by, mx, my = x.copy(), y.copy(), x.copy(), y.copy()
    for row in range(24):
        for col in range(20):
            for indices in [[(row, col), (row, col + 1), (row + 1, col)],
                            [(row, col + 1), (row + 1, col + 1), (row + 1, col)]]:
                t = np.array([target[r, c] for r, c in indices])
                ref = np.array([base[r, c] for r, c in indices])
                vid = np.array([moved[r, c] for r, c in indices])
                left, top = np.maximum(0, np.floor(t.min(axis=0)).astype(int))
                right, bottom = np.minimum([width - 1, height - 1], np.ceil(t.max(axis=0)).astype(int))
                if right < left or bottom < top:
                    continue
                yy, xx = np.mgrid[top:bottom + 1, left:right + 1].astype(np.float32)
                e, f = t[1] - t[0], t[2] - t[0]
                determinant = e[0] * f[1] - e[1] * f[0]
                u = ((xx - t[0, 0]) * f[1] - (yy - t[0, 1]) * f[0]) / determinant
                v = (e[0] * (yy - t[0, 1]) - e[1] * (xx - t[0, 0])) / determinant
                mask = (u >= -.0001) & (v >= -.0001) & (u + v <= 1.0001)
                for points, mapx, mapy in [(ref, bx, by), (vid, mx, my)]:
                    sample = points[0] + u[:, :, None] * (points[1] - points[0]) + v[:, :, None] * (points[2] - points[0])
                    mapx[top:bottom + 1, left:right + 1][mask] = sample[:, :, 0][mask]
                    mapy[top:bottom + 1, left:right + 1][mask] = sample[:, :, 1][mask]
    return bx, by, mx, my

capture = cv2.VideoCapture(str(args.source))
if not capture.isOpened() or int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)) != width * 2 or int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)) != height:
    raise ValueError('Expected the existing 960x576 packed RGB/alpha clip')
temporary_output = args.review / 'prepared.mp4'
encoder = subprocess.Popen(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo',
    '-pixel_format', 'bgr24', '-video_size', f'{width*2}x{height}', '-framerate', str(fps), '-i', '-',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', str(temporary_output)], stdin=subprocess.PIPE)
metrics = []
first = last = None
try:
    for i in range(count):
        ok, source = capture.read()
        if not ok:
            raise ValueError(f'Source ended at frame {i}')
        moving = unpack(source)
        t = i / fps
        amount = smooth(t / .5) * (1 - smooth((t - args.return_start) / (args.neutral_at - args.return_start)))
        if amount <= 0:
            result = neutral.copy()
        elif amount >= 1:
            result = moving
        else:
            gray = cv2.cvtColor(np.rint(moving[:, :, :3] * 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
            forward = flow.calc(neutral_gray, gray, None)
            forward = np.clip(cv2.GaussianBlur(forward, (0, 0), 2), -96, 96)
            bx, by, mx, my = morph_maps(forward, amount)
            base = cv2.remap(neutral, bx, by, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            target = cv2.remap(moving, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
            texture = smooth(amount / .2)
            result = base * (1 - texture) + target * texture
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
temporary_output.replace(args.output)
report = {'source': str(args.source), 'sourceSha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
    'reference': str(args.reference), 'referenceSha256': hashlib.sha256(args.reference.read_bytes()).hexdigest(),
    'output': str(args.output), 'outputSha256': hashlib.sha256(args.output.read_bytes()).hexdigest(),
    'frames': count, 'fps': fps, 'seconds': count / fps, 'opencv': cv2.__version__,
    'method': 'Existing forward motion, neutral endpoints, fold-free correspondence mesh and a single moving texture outside the boundary blend',
    'entrySeconds': .5, 'returnStartSeconds': args.return_start, 'neutralBySeconds': args.neutral_at,
    'identicalNeutralEndpointsBeforeEncoding': True, 'newGenerationRequests': 0, 'curve': metrics}
(args.review / 'prepared.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({key: value for key, value in report.items() if key != 'curve'}))
