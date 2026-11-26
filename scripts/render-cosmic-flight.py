"""Render the three original Cosmic Escape recordings. Requires NumPy and FFmpeg."""
import math
import subprocess
from pathlib import Path

import numpy as np

RATE = 44100
TAU = 2 * math.pi
rng = np.random.default_rng(2296)


def clock(seconds):
    return np.arange(round(RATE * seconds)) / RATE


def hz(note):
    return 440 * 2 ** ((note - 69) / 12)


def place(beat, sound, pan=0):
    """Wrap releases and delay taps into the downbeat of the next orbit."""
    start = round(beat * BEAT * RATE) % FRAMES
    split = min(FRAMES - start, len(sound))
    for channel, gain in enumerate((math.cos((pan + 1) * math.pi / 4),
                                    math.sin((pan + 1) * math.pi / 4))):
        mix[start:start + split, channel] += gain * sound[:split]
        mix[:len(sound) - split, channel] += gain * sound[split:]


def envelope(t, attack, release):
    return np.minimum(1, t / attack) * np.minimum(1, (t[-1] - t) / release)


def pad(start, pitches):
    t = clock(8 * BEAT + 0.76)
    swell = envelope(t, 0.52, 0.76) ** 1.4
    for i, note in enumerate(pitches):
        phase = TAU * hz(note) * t
        for spread in (-1, 1):
            drift = 0.17 * np.sin(2.7 * t + i + spread)
            voice = np.sin(phase * (1 + spread * 0.0014) + drift)
            voice += 0.26 * np.sin(2 * phase + drift) + 0.11 * np.sin(3 * phase)
            place(start, 0.038 * voice * swell, spread * (0.38 + 0.12 * i))


def bass(start, note, length, accent):
    t = clock(length * BEAT)
    phase = TAU * hz(note) * t
    wave = np.sin(phase) + 0.42 * np.sin(2 * phase) + 0.18 * np.sin(3 * phase)
    place(start, accent * wave * envelope(t, 0.015, 0.09) * np.exp(-2.0 * t))


def keys(start, note, level, pan, sustained=False, length=1):
    t = clock(length * BEAT + (0.54 if sustained else 0.30))
    phase = TAU * hz(note) * t
    if sustained:
        phase += 0.15 * np.sin(TAU * 4.3 * t) * np.minimum(1, t / 0.5)
        wave = np.sin(phase) + 0.27 * np.sin(2 * phase) + 0.13 * np.sin(3 * phase)
        amplitude = envelope(t, 0.085, 0.54) * np.exp(-0.75 * t)
    else:
        wave = np.sin(phase + 1.65 * np.exp(-8 * t) * np.sin(2 * phase))
        amplitude = envelope(t, 0.009, 0.24) * np.exp(-4.8 * t)
    dry = level * amplitude * wave
    place(start, dry, pan)
    for delay, gain, side in ((0.75, 0.29, 0.75), (1.5, 0.14, -0.67), (2.25, 0.065, 0.42)):
        place(start + delay, dry * gain, side)


def kick(start, strength):
    t = clock(0.30)
    phase = TAU * (47 * t + 3.0 * (1 - np.exp(-32 * t)))
    place(start, strength * np.sin(phase) * np.exp(-13 * t) * envelope(t, 0.005, 0.05))


def percussion(start, rim, strength, pan):
    t = clock(0.15 if rim else 0.075)
    noise = rng.standard_normal(len(t))
    high = np.diff(noise, prepend=0) * 0.23
    if rim:
        high += np.sin(TAU * 390 * t) * np.exp(-55 * t)
        high += 0.5 * np.sin(TAU * 710 * t) * np.exp(-75 * t)
    place(start, strength * high * np.exp(-(28 if rim else 52) * t) * envelope(t, 0.003, 0.024), pan)


def orbital_drift():
    # Two bars per harmony. The bridge opens up to C and D before the final return to A.
    harmonies = {
        'Am9': (33, [55, 59, 60, 64]), 'Fmaj9': (29, [53, 57, 64, 67]),
        'C/G': (31, [55, 59, 60, 64]), 'D6': (38, [54, 57, 59, 64]),
        'Em7': (40, [55, 59, 62, 64]), 'Dm9': (38, [53, 57, 60, 64]),
        'Cmaj9': (36, [55, 59, 62, 64]), 'Gsus': (31, [55, 57, 60, 62]),
    }
    changes = ['Am9', 'Fmaj9', 'C/G', 'D6', 'Am9', 'Fmaj9', 'Dm9', 'Em7',
               'Cmaj9', 'Gsus', 'Dm9', 'Em7', 'Am9', 'Fmaj9', 'D6', 'Gsus']
    # Call, answer, variation, cadence. Silence between phrases leaves space for the reels.
    phrases = [
        [(0.5, 76, 1.35), (2.5, 71, 0.65), (3.5, 72, 1.6), (6.0, 67, 1.15)],
        [(0.5, 69, 1.45), (2.75, 72, 0.65), (4.0, 76, 1.55), (6.0, 74, 1.05)],
        [(0.5, 76, 1.3), (2.5, 79, 0.65), (3.5, 74, 1.65), (6.0, 71, 1.15)],
        [(0.5, 69, 1.55), (3.0, 71, 0.85), (4.5, 69, 2.1)],
    ]
    for block, chord in enumerate(changes):
        root, voices = harmonies[chord]
        start = block * 8
        bridge = 8 <= block < 12
        lift = 4 <= block < 8 or block >= 12
        pad(start, voices)
        for bar in range(2):
            downbeat = start + 4 * bar
            notes = [(0, root, 1.25, 0.17), (2.5, root + 7, 0.65, 0.11)]
            if lift:
                notes += [(1.75, root + 12, 0.45, 0.09), (3.5, root + (7 if bar else 12), 0.43, 0.09)]
            for offset, pitch, length, level in notes:
                if not bridge or offset == 0:
                    bass(downbeat + offset, pitch, length, level)
            kick(downbeat, 0.14 if bridge else 0.22)
            if not bridge:
                kick(downbeat + (2.75 if bar and lift else 2), 0.15)
                percussion(downbeat + 1.02, True, 0.067, -0.16)
                percussion(downbeat + 3.02, True, 0.078, 0.16)
            for step in range(4):
                if not bridge or step % 2:
                    percussion(downbeat + step + 0.52, False, 0.053 if lift else 0.038, (-1) ** step * 0.4)
            pattern = [(0.75, 1), (1.5, 3), (2.75, 2), (3.5, 0)] if lift else [(1.5, 3), (3.25, 1)]
            for offset, index in pattern:
                if not bridge or bar == 1:
                    keys(downbeat + offset, voices[(index + bar) % 4] + 12, 0.088, (index - 1.5) * 0.32)
        theme = phrases[block % 4]
        if bridge:
            theme = [(1.5, voices[-1] + 12, 2.5), (5.5, voices[1] + 12, 1.8)]
        for offset, note, length in theme:
            keys(start + offset, note, 0.125 if lift else 0.104, -0.12, True, length)


def save_track(slug, title):
    master = np.tanh(mix * 1.25)
    master *= 0.80 / np.max(np.abs(master))
    # Short fades let different tempos and keys meet without an abrupt cut.
    for length, edge in ((round(RATE * 0.12), 'in'), (round(RATE * 0.42), 'out')):
        ramp = np.linspace(0, 1, length)[:, None]
        if edge == 'in':
            master[:length] *= ramp
        else:
            master[-length:] *= ramp[::-1]
    pcm = np.rint(master * 32767).astype('<i2')
    target = Path(__file__).resolve().parents[1] / 'public/assets/cosmic-guardians/music' / (slug + '.m4a')
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', str(RATE),
                    '-ac', '2', '-i', 'pipe:0', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
                    '-metadata', 'title=' + title, '-metadata', 'album=Cosmic Escape', str(target)],
                   input=pcm.tobytes(), check=True)


def neon(start, note, length, level, pan):
    """A warm, mildly detuned saw lead with a moving low-pass colour."""
    t = clock(length * BEAT + 0.23)
    phase = TAU * hz(note) * t + 0.095 * np.sin(TAU * 5.1 * t)
    wave = np.zeros_like(t)
    for harmonic in range(1, 8):
        colour = (0.5 + 0.5 * np.exp(-harmonic * t * 1.5)) / harmonic ** 1.55
        wave += colour * (np.sin(phase * harmonic) + 0.5 * np.sin(phase * harmonic * 1.0021))
    dry = level * wave * envelope(t, 0.027, 0.23)
    place(start, dry, pan)
    place(start + 0.75, dry * 0.24, -0.66)
    place(start + 1.5, dry * 0.095, 0.6)


def gated_snare(start, level):
    t = clock(0.25)
    noise = rng.standard_normal(len(t))
    body = np.sin(TAU * (169 * t + 0.7 * (1 - np.exp(-43 * t))))
    clap = np.exp(-22 * t) + 0.6 * np.exp(-35 * np.abs(t - 0.018))
    hit = level * (body * np.exp(-22 * t) + noise * clap * 0.37) * envelope(t, 0.003, 0.07)
    place(start, hit, -0.07)
    place(start + 0.10, hit * 0.21, 0.64)


def ion_runner():
    # B minor. Syncopated octave bass locks to the kick while a saw lead answers in long notes.
    roots = [35, 31, 38, 33, 35, 31, 40, 33, 31, 38, 33, 35, 35, 31, 40, 33]
    chords = {35: [54, 57, 59, 62], 31: [54, 55, 59, 62], 38: [54, 57, 61, 62],
              33: [52, 57, 59, 61], 40: [52, 55, 59, 62]}
    hooks = [
        [(0.75, 71, 0.65), (1.75, 74, 0.85), (3.25, 78, 1.65), (6, 76, 1.1)],
        [(0, 74, 1.7), (2.75, 71, 0.65), (4.5, 69, 1.3), (6.5, 71, 0.8)],
        [(0.75, 69, 0.7), (1.75, 74, 0.85), (3.25, 78, 1.6), (6, 81, 1.1)],
        [(0, 76, 1.5), (2.5, 73, 0.85), (4, 71, 1.2), (6.25, 69, 0.8)],
    ]
    for block, root in enumerate(roots):
        start = block * 8
        breakdown = 8 <= block < 10
        pad(start, chords[root])
        for bar in range(2):
            at = start + bar * 4
            for beat in range(4):
                if not breakdown or beat == 0:
                    kick(at + beat, 0.245 if beat % 2 == 0 else 0.17)
                if not breakdown and beat % 2:
                    gated_snare(at + beat + 0.012, 0.16)
                if not breakdown:
                    percussion(at + beat + 0.5, False, 0.085 if beat % 2 else 0.072, 0.38)
                    if block >= 4 and beat == 3:
                        percussion(at + 3.76, False, 0.05, -0.44)
            pattern = [(0.5, 0), (1.25, 0), (1.75, 12), (2.5, 7), (3.25, 0), (3.75, 12)]
            for step, interval in ([(0, 0)] if breakdown else pattern):
                bass(at + step, root + interval, 1.6 if breakdown else 0.48, 0.235)
            if (4 <= block < 8 or block >= 12) and bar:
                for step, idx in ((0.25, 0), (1.5, 1), (2.25, 2), (3.5, 3)):
                    keys(at + step, chords[root][idx] + 12, 0.065, -0.55)
        notes = [(0, chords[root][2] + 12, 3), (4, chords[root][0] + 12, 2.4)] if breakdown else hooks[block % 4]
        for step, pitch, length in notes:
            neon(start + step, pitch, length, 0.094, 0.12)


def beacon(start, note, level, pan):
    t = clock(3.9)
    phase = TAU * hz(note) * t
    glass = np.sin(phase + 1.55 * np.exp(-2.4 * t) * np.sin(phase * 2.006))
    glass += 0.23 * np.sin(phase * 3.97) * np.exp(-2.8 * t)
    dry = level * glass * np.exp(-1.42 * t) * envelope(t, 0.024, 0.9)
    place(start, dry, pan)
    place(start + 1, dry * 0.38, -pan)
    place(start + 2.5, dry * 0.16, pan)


def bow(start, note, beats, level):
    t = clock(beats * BEAT + 0.85)
    phase = TAU * hz(note) * t + 0.13 * np.sin(TAU * 3.8 * t)
    tone = np.sin(phase) + 0.44 * np.sin(2 * phase) + 0.16 * np.sin(3 * phase) + 0.11 * np.sin(4 * phase)
    place(start, level * tone * envelope(t, 0.60, 0.85), -0.18)


def far_beacon():
    # Triple metre. A bowed response fills the gaps in a slowly returning radio call.
    skies = [
        (38, [54, 57, 61, 64]), (35, [54, 57, 61, 62]),
        (30, [52, 56, 57, 61]), (33, [52, 57, 59, 61]),
        (31, [54, 57, 59, 62]), (38, [54, 57, 61, 64]),
        (40, [55, 59, 62, 66]), (33, [52, 57, 59, 64]),
        (38, [54, 57, 61, 64]), (35, [54, 57, 61, 62]),
        (31, [54, 57, 59, 62]), (33, [52, 57, 59, 64]),
    ]
    for block, (root, chord) in enumerate(skies):
        at = block * 6
        t = clock(6 * BEAT + 1.15)
        for idx, note in enumerate(chord):
            phase = TAU * hz(note) * t
            for side in (-1, 1):
                breath = np.sin(phase * (1 + side * 0.001) + 0.31 * np.sin(1.7 * t + idx))
                breath += 0.19 * np.sin(2 * phase + side * 0.4)
                place(at, 0.054 * breath * envelope(t, 1.25, 1.15), side * 0.75)
        bow(at + 0.25, root, 4.7, 0.142)
        if block % 2 == 0:
            for step, idx in ((0.85, 3), (2.5, 2), (4.0, 1)):
                beacon(at + step, chord[idx] + 12, 0.115, 0.52)
        else:
            bow(at + 0.45, chord[1], 2.4, 0.093)
            bow(at + 3.2, chord[0], 1.5, 0.088)
            beacon(at + 4.7, chord[3] + 12, 0.082, -0.5)
        if 4 <= block < 9:
            for step, idx in ((0, 0), (1.5, 1), (3, 2), (4.5, 1), (5.5, 3)):
                keys(at + step, chord[idx], 0.10, (idx - 1.5) * 0.3)


for title, slug, bpm, beats, score in (
    ('Orbital Drift', 'orbital-drift', 100, 128, orbital_drift),
    ('Ion Runner', 'ion-runner', 118, 128, ion_runner),
    ('Far Beacon', 'far-beacon', 72, 72, far_beacon),
):
    BEAT = 60 / bpm
    FRAMES = round(RATE * BEAT * beats)
    mix = np.zeros((FRAMES, 2), dtype=np.float32)
    score()
    save_track(slug, title)
