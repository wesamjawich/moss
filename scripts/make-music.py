"""Synthesises the demo video's background music: a slow, airy music-box tune over soft pads.

    python3 scripts/make-music.py out.wav [seconds]

Everything is generated here (no samples): D major pentatonic, 13 bars, about 75 bpm at the default length.
"""
import sys
import wave
import numpy as np

SR = 44100
OUT = sys.argv[1]
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 41.6
BARS = 13
BAR = DUR / BARS
BEAT = BAR / 4
N = int(SR * (DUR + 4.0))
rng = np.random.default_rng(7)
dry = np.zeros((N, 2))      # pads
low = np.zeros((N, 2))      # bass, kept out of the reverb so the low end stays clean
wet = np.zeros((N, 2))      # plucked voices, sent to the reverb harder


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def put(bus, t0, sig, gain=1.0, pan=0.0):
    i = int(t0 * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    bus[i:i + len(sig), 0] += sig * gain * np.sqrt(0.5 * (1 - pan))
    bus[i:i + len(sig), 1] += sig * gain * np.sqrt(0.5 * (1 + pan))


def attack(sig, ms):
    n = max(1, int(SR * ms / 1000))
    sig[:n] *= np.linspace(0, 1, n)
    return sig


def bell(m, dur=3.0):
    """Music box: a pure tone with a few quickly dying partials."""
    f = hz(m)
    t = np.arange(int(SR * dur)) / SR
    s = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.85)
         + 0.40 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.40)
         + 0.15 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t / 0.22)
         + 0.07 * np.sin(2 * np.pi * 4.1 * f * t) * np.exp(-t / 0.10))
    return attack(s, 4)


def kalimba(m, dur=1.6):
    f = hz(m)
    t = np.arange(int(SR * dur)) / SR
    s = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.42)
         + 0.25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.18)
         + 0.10 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t / 0.04))
    return attack(s, 3)


def pad(m, dur):
    f = hz(m)
    t = np.arange(int(SR * (dur + 2.4))) / SR
    s = sum(np.sin(2 * np.pi * f * d * t + ph) for d, ph in ((1.0, 0.0), (1.004, 1.3), (0.996, 2.1))) / 3
    s += 0.18 * np.sin(2 * np.pi * 2 * f * t)
    env = np.minimum(1, t / 1.5) * np.minimum(1, np.maximum(0, (dur + 2.4 - t) / 2.4))
    return s * env * (1 + 0.10 * np.sin(2 * np.pi * 0.21 * t + m))


def bass(m, dur=3.0):
    f = hz(m)
    t = np.arange(int(SR * dur)) / SR
    return attack((np.sin(2 * np.pi * f * t) + 0.2 * np.sin(2 * np.pi * 2 * f * t)) * np.exp(-t / 1.5), 12)


# ---- harmony: I, vi, IV, V colours, never leaving the pentatonic mood ----
D, Bm7, Gmaj7, Asus2, A = (
    [50, 57, 62, 64, 66, 69], [47, 54, 59, 62, 66, 69], [43, 55, 59, 62, 66, 69], [45, 52, 57, 59, 64, 69], [45, 52, 57, 61, 64, 69])
CHORDS = [D, D, Bm7, Bm7, Gmaj7, Gmaj7, Asus2, A, D, Bm7, Gmaj7, Asus2, D]

for b, chord in enumerate(CHORDS):
    t0 = b * BAR
    for k, m in enumerate(chord):
        put(dry, t0, pad(m, BAR), gain=0.050, pan=(k / (len(chord) - 1) - 0.5) * 0.9)
    put(low, t0, bass(chord[0] - 12 if chord[0] > 46 else chord[0]), gain=0.17)
    if b < BARS - 1:
        put(low, t0 + 2 * BEAT, bass(chord[1] - 12, 1.6), gain=0.07)
    # a swung arpeggio that enters after the introduction and steps aside for the last bar
    if 2 <= b < BARS - 1:
        up = chord[2:] + [chord[2] + 12, chord[3] + 12]
        order = [0, 2, 4, 3, 1, 3, 5, 4] if b % 2 == 0 else [1, 3, 5, 4, 2, 4, 6, 3]
        for e, idx in enumerate(order):
            t = t0 + (e // 2) * BEAT + (0.62 * BEAT if e % 2 else 0.0)
            put(wet, t, kalimba(up[idx % len(up)]), gain=0.070 if e % 2 else 0.085, pan=0.45 * np.sin(e * 1.3 + b))

# ---- melody: (bar, beat, midi note, grace note?) ----
MELODY = [
    (1, 0, 78, 0), (1, 1, 81, 0), (1, 2, 83, 1), (1, 3.5, 81, 0),
    (2, 0, 86, 0), (2, 2.5, 83, 0), (2, 3, 81, 0),
    (3, 0, 78, 0), (3, 1, 76, 0), (3, 2, 74, 0), (3, 3, 76, 1),
    (4, 0, 78, 0), (4, 2, 83, 0), (4, 3, 81, 0),
    (5, 0, 83, 1), (5, 0.5, 81, 0), (5, 1, 83, 0), (5, 2, 86, 0), (5, 3, 88, 0),
    (6, 0, 86, 0), (6, 1.5, 83, 0), (6, 2, 81, 0),
    (7, 0, 76, 0), (7, 1, 78, 0), (7, 2, 81, 1), (7, 3, 83, 0),
    (8, 0, 81, 0), (8, 2, 86, 0), (8, 3.5, 90, 0),
    (9, 0, 90, 1), (9, 0.5, 88, 0), (9, 1, 86, 0), (9, 2, 83, 0), (9, 3, 86, 0),
    (10, 0, 83, 0), (10, 1.5, 81, 0), (10, 2, 78, 0), (10, 3, 81, 0),
    (11, 0, 83, 1), (11, 1, 81, 0), (11, 2, 76, 0), (11, 3, 81, 0),
    (12, 0, 86, 0), (12, 1, 81, 0), (12, 2, 90, 0),
]
PENT = [62, 64, 66, 69, 71]
for bar, beat, m, grace in MELODY:
    t = bar * BAR + beat * BEAT
    pan = 0.25 * np.sin(t * 0.9)
    if grace:      # a quick step up into the note
        below = max(p + 12 * ((m - p) // 12) for p in PENT if (p - m) % 12 != 0 and (p + 12 * ((m - p) // 12)) < m)
        put(wet, t - 0.07, bell(below, 0.6), gain=0.07, pan=pan)
    put(wet, t, bell(m), gain=0.16, pan=pan)
    put(wet, t + 0.75 * BEAT, bell(m, 2.0), gain=0.045, pan=-pan - 0.3)      # soft echo
    put(wet, t + 1.5 * BEAT, bell(m, 1.5), gain=0.018, pan=pan + 0.4)

# ---- wind-chime sparkles drifting high above ----
t = 1.0
while t < DUR - 2:
    put(wet, t, bell(rng.choice(PENT) + 36, 2.0), gain=0.022 * rng.uniform(0.5, 1.0), pan=rng.uniform(-0.9, 0.9))
    t += rng.uniform(0.9, 2.6)

# ---- reverb: convolution with a decaying burst of filtered noise ----
ir_n = int(SR * 3.4)
tt = np.arange(ir_n) / SR
ir = rng.standard_normal((ir_n, 2)) * np.exp(-tt / 0.95)[:, None]
ir /= np.sqrt((ir ** 2).sum(axis=0))
send = wet + 0.30 * dry
size = 1 << int(np.ceil(np.log2(N + ir_n)))
freq = np.fft.rfftfreq(size, 1 / SR)
tone = (freq / (freq + 320.0)) ** 2 / (1 + (freq / 5200.0) ** 2)      # the tail keeps to the mids: no rumble, no hiss
rev = np.stack([np.fft.irfft(np.fft.rfft(send[:, c], size) * np.fft.rfft(ir[:, c], size) * tone, size)[:N] for c in range(2)], axis=1)
mix = dry + low + 0.85 * wet + 0.9 * rev

# ---- master ----
mix = mix[: int(SR * DUR)]
n = len(mix)
fade = np.ones(n)
fi, fo = int(SR * 0.4), int(SR * 3.0)
fade[:fi] = np.linspace(0, 1, fi)
fade[-fo:] = np.cos(np.linspace(0, np.pi / 2, fo)) ** 2
mix *= fade[:, None]
mix = np.tanh(mix / np.abs(mix).max() * 1.15) * 0.82
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('wrote', OUT, f'{n / SR:.1f}s', 'peak', float(np.abs(mix).max()))
