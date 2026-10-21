"""Render Royal's original magical foley palette. Requires numpy and ffmpeg."""
from pathlib import Path
import hashlib
import json
import math
import subprocess
import tempfile
import wave
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'public/assets/dracona/audio'
RATE = 44100
RNG = np.random.default_rng(87231)


def timeline(seconds):
    return np.arange(round(seconds * RATE)) / RATE


def fade(signal, attack=.012, release=.16):
    signal = signal.copy()
    a, b = min(len(signal), round(attack * RATE)), min(len(signal), round(release * RATE))
    signal[:a] *= np.sin(np.linspace(0, math.pi / 2, a)) ** 2
    signal[-b:] *= np.cos(np.linspace(0, math.pi / 2, b)) ** 2
    return signal


def air(seconds, low=240, high=4800):
    count = round(seconds * RATE)
    frequencies = np.fft.rfftfreq(count, 1 / RATE)
    color = np.minimum(1, frequencies / low) ** 3 / (1 + (frequencies / high) ** 6)
    spectrum = np.fft.rfft(RNG.normal(size=count)) * color / np.sqrt(np.maximum(100, frequencies))
    result = np.fft.irfft(spectrum, n=count)
    return result / max(.001, np.std(result))


def bell(frequency, seconds=1.35, softness=.008):
    t = timeline(seconds)
    out = np.zeros_like(t)
    for multiple, weight, decay in [(1, 1, .85), (2.003, .30, .38), (2.756, .14, .23), (4.071, .045, .11)]:
        vibrato = .0028 * np.sin(2 * math.pi * 4.1 * t)
        out += weight * np.sin(2 * math.pi * frequency * multiple * t + vibrato) * np.exp(-t / decay)
    return fade(out, softness, .22)


def add(destination, signal, at=0, level=1, pan=0):
    start = round(at * RATE)
    length = min(len(signal), len(destination) - start)
    if length <= 0:
        return
    angle = (pan + 1) * math.pi / 4
    destination[start:start + length, 0] += signal[:length] * level * math.cos(angle)
    destination[start:start + length, 1] += signal[:length] * level * math.sin(angle)


def room(dry, wet=.28):
    # Sparse early reflections and a diffuse, high-frequency-damped stone room.
    out = dry.copy()
    for seconds, gain in [(.043, .24), (.079, .18), (.127, .13), (.191, .095), (.283, .065), (.419, .036), (.613, .018)]:
        delay = round(seconds * RATE)
        if delay < len(out):
            out[delay:] += dry[:-delay, ::-1] * gain * wet
    for channel in range(2):
        spectrum = np.fft.rfft(out[:, channel])
        frequencies = np.fft.rfftfreq(len(out), 1 / RATE)
        out[:, channel] = np.fft.irfft(spectrum / np.sqrt(1 + (frequencies / 6300) ** 8), n=len(out))
    return out


def pad(seconds, notes, level=.055):
    t = timeline(seconds)
    out = np.zeros((len(t), 2))
    envelope = np.sin(np.linspace(0, math.pi, len(t))) ** 1.5
    for index, f in enumerate(notes):
        for channel, detune in enumerate([.9987, 1.0013]):
            voice = np.sin(2 * math.pi * f * detune * t + .16 * np.sin(t * 1.7 + index))
            voice += .13 * np.sin(2 * math.pi * f * 2 * detune * t)
            out[:, channel] += voice * envelope * level
    return out


def make_cast():
    out = np.zeros((round(1.35 * RATE), 2))
    t = timeline(.72)
    gust = air(.72, 420, 3300) * np.sin(np.linspace(0, math.pi, len(t))) ** 2
    gust *= .75 + .25 * np.sin(2 * math.pi * (24 * t + 42 * t * t))
    add(out, fade(gust), .015, .12, -.18)
    for at, f, volume, pan in [(.17, 587.33, .12, -.6), (.25, 880, .09, .15), (.40, 1318.51, .075, .6), (.51, 1760, .032, .25)]:
        add(out, bell(f, .82), at, volume, pan)
    return room(out, .7)


def make_settle():
    out = np.zeros((round(.65 * RATE), 2))
    t = timeline(.14)
    contact = air(.14, 900, 2900) * np.exp(-t * 47)
    add(out, fade(contact, .004, .06), .01, .065)
    add(out, bell(440, .59, .018), .015, .07, -.12)
    return room(out, .4)


def make_cascade():
    out = np.zeros((round(1.24 * RATE), 2))
    for at, f, pan in [(0, 587.33, -.55), (.075, 880, .4), (.15, 1174.66, -.2), (.24, 1318.51, .55)]:
        add(out, bell(f, .95, .01), at, .105 if at == 0 else .067, pan)
    t = timeline(.44)
    add(out, fade(air(.44, 1200, 4700) * np.sin(np.linspace(0, math.pi, len(t))) ** 2), .08, .023)
    return room(out, .85)


def make_portal():
    out = np.zeros((round(2.05 * RATE), 2))
    t = timeline(1.38)
    envelope = np.sin(np.linspace(0, math.pi, len(t))) ** 1.9
    for pan, delay in [(-.65, .01), (.65, .07)]:
        gust = air(1.38, 180, 1800) * envelope * (.8 + .2 * np.sin(t * 38))
        add(out, fade(gust, .1, .28), delay, .057, pan)
    low = (np.sin(2 * math.pi * 146.83 * t) + .35 * np.sin(2 * math.pi * 220 * t)) * envelope
    add(out, fade(low), .13, .065)
    add(out, bell(440, 1.2, .045), .58, .10, -.28)
    add(out, bell(659.25, 1.2, .055), .67, .075, .42)
    return room(out, 1.2)


def make_bonus():
    out = np.zeros((round(3.7 * RATE), 2))
    out += pad(3.7, [146.83, 220, 293.66, 349.23], .024)
    # Original five-note celesta gesture, followed by a luminous open chord.
    for at, f, pan in [(.04, 587.33, -.5), (.25, 698.46, -.2), (.49, 880, .15), (.79, 1318.51, .55), (1.12, 1174.66, .25)]:
        add(out, bell(f, 2), at, .115, pan)
    for f, pan in [(587.33, -.45), (880, 0), (1318.51, .45)]:
        add(out, bell(f, 1.75, .07), 1.60, .085, pan)
    shimmer = fade(air(2.5, 1700, 5200), .7, 1.0) * .012
    add(out, shimmer, .55, 1, .1)
    return room(out, 1.1)


def make_finish():
    out = pad(2.8, [146.83, 220, 369.99], .016)
    for i, f in enumerate([293.66, 440, 554.37, 880, 1174.66]):
        add(out, bell(f, 2.1, .025), .04 + i * .125, .11 - i * .012, -.5 + i * .25)
    return room(out, 1)


def make_fizzle():
    out = np.zeros((round(.95 * RATE), 2))
    t = timeline(.5)
    dust = air(.5, 1100, 3100) * np.sin(np.linspace(0, math.pi, len(t))) ** 2
    add(out, fade(dust, .04, .2), .025, .035, .1)
    add(out, bell(293.66, .8, .04), .06, .045, -.12)
    return room(out, .65)


def make_quick(kind):
    seconds = .78 if kind == 'portal' else .64
    out = np.zeros((round(seconds * RATE), 2))
    length = .34 if kind == 'portal' else .23
    t = timeline(length)
    add(out, fade(air(length, 250 if kind == 'portal' else 650, 2500)
        * np.sin(np.linspace(0, math.pi, len(t))) ** 2, .02, .09), 0, .06 if kind == 'portal' else .045)
    notes = [440, 659.25] if kind == 'portal' else [587.33, 880, 1318.51]
    for i, f in enumerate(notes):
        add(out, bell(f, .47, .012), .07 + i * .055, .08 - i * .015, -.35 + i * .35)
    return room(out, .6)


def write_wave(path, samples):
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(np.rint(np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    palette = {}
    cues = {'cast': make_cast, 'settle': make_settle, 'cascade': make_cascade, 'portal': make_portal,
            'bonus': make_bonus, 'finish': make_finish, 'fizzle': make_fizzle}
    cues.update({name + '-quick': lambda name=name: make_quick(name) for name in ['cast', 'cascade', 'portal']})
    with tempfile.TemporaryDirectory(prefix='royal-dracona-audio-') as scratch:
        for name, render in cues.items():
            signal = render()
            # Preserve relative dynamics; remove DC and leave generous peak headroom.
            signal -= signal.mean(axis=0)
            signal *= 2.7
            peak = float(np.max(np.abs(signal)))
            signal *= min(1, .72 / max(.001, peak))
            for channel in range(2):
                signal[:, channel] = fade(signal[:, channel], .006, .12)
            wav = Path(scratch) / (name + '.wav')
            target = OUT / (name + '.mp3')
            write_wave(wav, signal)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), '-map_metadata', '-1',
                            '-c:a', 'libmp3lame', '-q:a', '2', '-ar', str(RATE), str(target)], check=True)
            palette[name] = {'seconds': len(signal) / RATE, 'peakDbfs': round(20 * math.log10(max(.00001, np.max(np.abs(signal)))), 2),
                             'rmsDbfs': round(20 * math.log10(max(.00001, np.sqrt(np.mean(signal ** 2)))), 2),
                             'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'bytes': target.stat().st_size}
    (OUT / 'palette.json').write_text(json.dumps({'title': 'Moonlit Manor', 'original': True,
        'source': 'games/dracona/tools/make_audio.py', 'sampleRate': RATE, 'channels': 2,
        'recordingsOrMelodiesFromFilms': False, 'cues': palette}, indent=2) + '\n')
    print(json.dumps(palette, indent=2))


if __name__ == '__main__':
    main()
