#!/usr/bin/env python3
"""Soundtrack for the AI tutor notebook launch teaser (launch.html, timeline.json).

Adapted from the Huddle teaser pipeline: the same synth voices (FM e-piano, round sub, clean
drums, bells, detuned pad, reverse swells), the same bar-line arrangement idea, the same master
chain, re-keyed to G major (Gmaj7 - Em9 - Cmaj7 - D) and re-pointed at this film's cue list.
One addition: `pen`, a soft pencil-on-glass scratch for every handwritten glyph.

120 BPM, one chord per bar. Arrangement (timeline "music"): A e-piano alone, low-passed ->
B kick -> D bass, hats, pad -> F claps, hook -> H big -> K stop-time hits -> L final chord.
Every cue with a sound type is voiced. Writes out/build/audio.wav (+ music/sfx stems).

  python3 audio.py        (needs numpy + scipy)
"""
import json
import os

import numpy as np
from scipy import signal as sg
from scipy.io import wavfile
from scipy.ndimage import maximum_filter1d, uniform_filter1d

HERE = os.path.dirname(os.path.abspath(__file__))
TL = json.load(open(os.path.join(HERE, os.environ.get("TIMELINE", "timeline.json"))))
OUT = os.path.join(HERE, "out", "build")
NAME = os.environ.get("AUDIO_NAME", "audio")
SR = 48000
META, MUS = TL["meta"], TL["music"]
DUR = META["duration"]
N = int(round(DUR * SR))
BEAT, BAR = META["beat"], META["bar"]
rng = np.random.default_rng(1114)

PROG = ["Gmaj7", "Em9", "Cmaj7", "D"]
VOICE = {  # voice-led upper structures (root lives in the bass)
    "Gmaj7": [59, 62, 66, 69],
    "Em9": [59, 62, 66, 67],
    "Cmaj7": [59, 64, 67, 71],
    "D": [57, 62, 66, 69],
}
ROOT = {"Gmaj7": 43, "Em9": 40, "Cmaj7": 36, "D": 38}
STOP0, STOP1 = MUS["stop"]


def stereo(n=N):
    return np.zeros((n, 2))


def chord_of_bar(b):
    return PROG[b % 4]


def db(x):
    return 10 ** (x / 20)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def pan_gains(p):
    """equal-power pan, p in [-1, 1]"""
    a = (p + 1) * np.pi / 4
    return np.cos(a), np.sin(a)


def add(bus, sig, t, pan=0.0, gain=1.0):
    """add a mono (or stereo) signal into a stereo bus at time t (seconds)"""
    i0 = int(round(t * SR))
    if i0 >= bus.shape[0]:
        return
    if sig.ndim == 1:
        gl, gr = pan_gains(pan)
        sig = np.stack([sig * gl, sig * gr], axis=1)
    if i0 < 0:
        sig = sig[-i0:]
        i0 = 0
    n = min(sig.shape[0], bus.shape[0] - i0)
    bus[i0:i0 + n] += sig[:n] * gain


def tvec(d):
    return np.arange(int(d * SR)) / SR


def bp(x, lo, hi, order=2):
    sos = sg.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return sg.sosfilt(sos, x)


def lp(x, f, order=2):
    return sg.sosfilt(sg.butter(order, f, btype="low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sg.sosfilt(sg.butter(order, f, btype="high", fs=SR, output="sos"), x)


# ------------------------------------------------------------------ instruments
def bell(m, vel, dur=1.6, tau=0.55):
    f = mtof(m)
    t = tvec(dur)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / tau)
    x += 0.35 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / (tau * 0.5))
    x += 0.12 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t / (tau * 0.25))
    x *= np.clip(t / 0.003, 0, 1)
    return x * vel


def epiano(m, vel, dur=2.2):
    """FM electric piano: 1:1 carrier/modulator, index decays (bright attack -> mellow body)"""
    f = mtof(m)
    t = tvec(dur)
    idx = (1.1 + 1.3 * vel) * np.exp(-t / 0.22) + 0.35
    mod = idx * np.sin(2 * np.pi * f * t)
    x = np.sin(2 * np.pi * f * t + mod)
    x += 0.18 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.5)        # a little body
    tine = 0.05 * vel * np.sin(2 * np.pi * f * 7.0 * t) * np.exp(-t / 0.03)  # soft tine ping
    env = np.clip(t / 0.004, 0, 1) * np.exp(-t / (1.9 if m < 60 else 1.4))
    rel = np.clip((dur - t) / 0.25, 0, 1)
    return lp((x + tine) * env * rel * vel, 5200)


def ep_chord(bus, name, t0, vel, dur=2.2, octave=0, spread=0.5):
    for k, m in enumerate(VOICE[name]):
        v = vel * (0.9 + 0.12 * rng.random())
        add(bus, epiano(m + octave, v, dur), t0 + k * 0.007, pan=(-spread + 2 * spread * k / 3))


def trem(x, rate=4.2, depth=0.1):
    t = np.arange(len(x)) / SR
    s = np.sin(2 * np.pi * rate * t)
    y = x.copy()
    y[:, 0] *= 1 + depth * s
    y[:, 1] *= 1 - depth * s
    return y


def sub_bass(m, vel, dur):
    f = mtof(m)
    t = tvec(dur)
    x = np.sin(2 * np.pi * f * t)
    x = np.tanh(1.6 * x) / np.tanh(1.6)          # gentle harmonics so it reads on small speakers
    env = np.clip(t / 0.008, 0, 1) * np.exp(-t / 0.9) * np.clip((dur - t) / 0.04, 0, 1)
    return lp(x * env * vel, 700)


def kick(vel):
    t = tvec(0.45)
    f = 48 + 100 * np.exp(-t / 0.03)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.26)
    click = hp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.0025) * 0.35
    return lp(x + click, 6000) * vel


def clap(vel):
    t = tvec(0.25)
    n = rng.standard_normal(len(t))
    env = np.zeros_like(t)
    for k, o in enumerate((0.0, 0.008, 0.016)):
        env += (t >= o) * np.exp(-np.clip(t - o, 0, None) / (0.006 if k < 2 else 0.07))
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.03) * 0.35
    return lp(bp(n, 1100, 5200) * env + body, 7500) * vel


def hat(vel):
    t = tvec(0.07)
    x = hp(rng.standard_normal(len(t)), 7200, 3) * np.exp(-t / 0.016)
    return lp(x, 11000) * vel


def reverse_swell(name, dur=1.0):
    """next chord on e-piano, reverbed, reversed: a soft swell into the downbeat"""
    s = stereo(int((dur + 1.2) * SR))
    ep_chord(s, name, 0.0, 0.7, dur + 1.0, octave=12, spread=0.6)
    s = plate(s, 0.5)
    s = s[: int(dur * SR)][::-1]
    t = np.arange(len(s)) / SR
    s *= (np.clip(t / dur, 0, 1) ** 1.5)[:, None]
    nz = lp(hp(rng.standard_normal(len(t)), 800), 4000) * (t / dur) ** 3 * 0.08
    s += np.stack([nz, nz], 1)
    return s


# ------------------------------------------------------------------ fx
def make_plate(dur=1.1, decay=0.26, seed=5):
    r = np.random.default_rng(seed)
    t = tvec(dur)
    ir = np.zeros((len(t), 2))
    for c in range(2):
        n = r.standard_normal(len(t)) * np.exp(-t / decay)
        ir[:, c] = lp(n, 6500) * 0.7 + lp(n, 2500) * 0.3
    ir = np.concatenate([np.zeros((int(0.012 * SR), 2)), ir])
    return ir / np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True))


PLATE = make_plate()


def plate(x, wet=0.16):
    y = np.zeros_like(x)
    for c in range(2):
        y[:, c] = sg.fftconvolve(x[:, c], PLATE[:, c])[: len(x)]
    return x + wet * y


def bus_comp(x, thr_db=-22, ratio=2.0, att=0.01, rel=0.15):
    lvl = np.sqrt(uniform_filter1d(np.mean(x ** 2, axis=1), int(0.02 * SR)) + 1e-12)
    L = 20 * np.log10(lvl)
    gr = np.minimum(0, (thr_db - L) * (1 - 1 / ratio))
    gr = uniform_filter1d(gr, int(att * SR))
    r = gr.tolist()
    a = float(np.exp(-1 / (rel * SR)))
    s = 0.0
    for i, v in enumerate(r):          # release smoothing (reduction recovers no faster than rel)
        s = v if v < s else s * a + v * (1 - a)
        r[i] = s
    return x * db(np.asarray(r))[:, None]


def pad_voice(m, dur, vel):
    """two detuned saws per note, low-passed, slow attack"""
    t = tvec(dur)
    f = mtof(m)
    x = np.zeros(len(t))
    for d in (-0.07, 0.07):
        ph = (f * (1 + d / 12) * t) % 1.0
        x += 2 * ph - 1
    env = np.clip(t / 0.35, 0, 1) * np.clip((dur - t) / 0.4, 0, 1)
    return lp(x * env * vel * 0.5, 1400)


# lead hook: (beat, midi, beats) per bar of the 4-bar cycle
HOOK = [
    [(0, 81, 1.5), (1.5, 79, 0.5), (2, 77, 1), (3, 79, 1)],
    [(0, 81, 1.5), (1.5, 84, 0.5), (2, 81, 2)],
    [(0, 82, 1), (1, 81, 1), (2, 77, 1.5), (3.5, 79, 0.5)],
    [(0, 79, 1.5), (1.5, 76, 0.5), (2, 79, 2)],
]



def music():
    ep, bass, drums, bells, risers, pad, lead = (stereo() for _ in range(7))
    nb = int(np.ceil(STOP0 / BAR))
    for b in range(nb):
        t0 = b * BAR
        name = chord_of_bar(b)
        big = t0 >= MUS["bigFrom"]
        if t0 < 4.0:
            ep_chord(ep, name, t0, 0.55, 2.3)
        elif t0 < MUS["bassFrom"]:
            ep_chord(ep, name, t0, 0.62, 2.0)
            ep_chord(ep, name, t0 + 1.5 * BEAT, 0.34, 1.2)
        else:
            ep_chord(ep, name, t0, 0.66, 1.6)
            ep_chord(ep, name, t0 + 1.5 * BEAT, 0.4, 0.9)
            ep_chord(ep, name, t0 + 3 * BEAT, 0.36, 0.9)
            if big:
                ep_chord(ep, name, t0 + 1.5 * BEAT, 0.2, 0.9, octave=12, spread=0.8)
            for k, m in enumerate(VOICE[name]):
                add(pad, pad_voice(m - 12 if k == 0 else m, BAR + 0.3, 0.32 if big else 0.24), t0, pan=-0.6 + 0.4 * k)
        if t0 >= MUS["bassFrom"]:
            r = ROOT[name]
            pat = [(0, 1.3, 0.9), (2.5, 1.0, 0.7)] if t0 < MUS["clapFrom"] else [(0, 1.3, 0.95), (1.5, 0.9, 0.6), (2.5, 0.9, 0.75), (3.5, 0.45, 0.5)]
            for bt, ln, v in pat:
                add(bass, sub_bass(r + (12 if (big and bt == 3.5) else 0), v, ln * BEAT), t0 + bt * BEAT)
        if t0 >= MUS["kickFrom"]:
            add(drums, kick(0.9), t0)
            add(drums, kick(0.75), t0 + 2 * BEAT)
            if t0 >= MUS["clapFrom"] and b % 2 == 1:
                add(drums, kick(0.45), t0 + 2.5 * BEAT)
        if t0 >= MUS["clapFrom"]:
            add(drums, clap(0.5), t0 + BEAT, pan=-0.06)
            add(drums, clap(0.55), t0 + 3 * BEAT, pan=0.06)
        if t0 >= MUS["hatsFrom"]:
            for e8 in range(8):
                swing = 0.04 if e8 % 2 else 0.0
                v = (0.5 if e8 % 2 == 0 else 0.34) * (0.85 + 0.25 * rng.random()) * (1.15 if big else 1.0)
                add(drums, hat(v), t0 + e8 * BEAT / 2 + swing, pan=0.28)
        if t0 >= MUS["leadFrom"]:
            for bt, m, ln in HOOK[b % 4]:
                d = ln * BEAT
                v = 0.62 if big else 0.48
                add(lead, epiano(m - 12, v, d + 0.25), t0 + bt * BEAT, pan=0.12)
                if big:
                    add(lead, bell(m, 0.32, d + 0.6, 0.35), t0 + bt * BEAT, pan=-0.15)
    for tm in MUS["motifs"]:
        for k, m in enumerate((81, 84, 88)):
            add(bells, bell(m, 0.5 - 0.08 * k, 1.4, 0.45), tm + k * BEAT / 2, pan=(-0.3 + 0.3 * k))
    for r0, r1 in MUS["risers"]:
        add(risers, reverse_swell(chord_of_bar(int(round(r1 / BAR))), r1 - r0), r0, gain=0.9)
    return ep, bass, drums, bells, risers, pad, lead


def arrangement_lp(x):
    """A: e-piano low-passed, opening gradually across the first two bars"""
    t = np.arange(len(x)) / SR
    a0, a1 = MUS["epLowpassOpen"]
    u = np.clip((t - a0) / (a1 - a0), 0, 1)
    closed, mid = lp(x.T, 900).T, lp(x.T, 2400).T
    wc, wm, wo = np.clip(1 - 2 * u, 0, 1), 1 - np.abs(2 * u - 1), np.clip(2 * u - 1, 0, 1)
    return closed * wc[:, None] + mid * wm[:, None] + x * wo[:, None]


def hits():
    """stop-time hits (kick + sub + chord stab) under the core line, and the final ringing chord"""
    bus = stereo()
    names = {"I": "Gmaj7", "vi": "Em9", "IV": "Cmaj7"}
    for c in TL["cues"]:
        if c["type"] == "hit":
            d = 0.9 if c.get("long") else 0.5
            s = stereo(int((d + 0.6) * SR))
            add(s, kick(1.0), 0.0)
            add(s, sub_bass(ROOT[names[c["chord"]]] + 12, 0.8, d), 0.0)
            ep_chord(s, names[c["chord"]], 0.0, 0.85, d + 0.3, octave=12, spread=0.55)
            ep_chord(s, names[c["chord"]], 0.0, 0.5, d + 0.3, spread=0.4)
            s = plate(s, 0.18)
            tv = np.arange(len(s)) / SR
            s *= np.clip((d - tv) / 0.05, 0, 1)[:, None]
            add(bus, s, c["t"])
        elif c["type"] == "final":
            t0 = c["t"]
            L = DUR - t0
            s = stereo(int((L + 0.1) * SR))
            for k, m in enumerate((55, 59, 62, 66, 69, 74)):
                add(s, epiano(m, 0.8, L), k * 0.012, pan=-0.5 + 0.2 * k)
            add(s, sub_bass(43, 0.9, L), 0.0)
            add(s, kick(0.9), 0.0)
            add(s, bell(86, 0.35, L, 0.9), 0.1, pan=0.3)
            add(s, bell(90, 0.25, L, 0.9), 0.35, pan=-0.3)
            add(s, bell(83, 0.2, L, 0.9), 0.6, pan=0.0)
            s = plate(s, 0.3)
            add(bus, s, t0)
    return bus


# ------------------------------------------------------------------ sfx
LEVEL = {"click": -6, "tick": -12, "pen": -15, "pop": -8.5, "whoosh": -17, "blip": -8.5,
         "check": -9.5, "sub": -7, "chime": -11}


def sfx_pen(soft=False):
    """pencil tip on glass: a short band-passed scratch with a tiny tap at the start"""
    d = rng.uniform(0.05, 0.085) * (0.7 if soft else 1.0)
    t = tvec(d)
    n = rng.standard_normal(len(t))
    c = rng.uniform(2600, 4200)
    env = np.clip(t / 0.006, 0, 1) * np.exp(-t / (d * 0.45)) * (1 + 0.5 * np.sin(2 * np.pi * rng.uniform(28, 46) * t))
    x = bp(n, c * 0.55, c * 1.7) * env
    if not soft:
        x += np.sin(2 * np.pi * rng.uniform(900, 1300) * t) * np.exp(-t / 0.004) * 0.3
    return x


def sfx_bus():
    bus = stereo()
    counts = {}
    for c in TL["cues"]:
        ty, t, vel, pan = c["type"], c["t"], c.get("vel", 1.0), c.get("pan", 0.0)
        if ty not in LEVEL:
            continue
        counts[ty] = counts.get(ty, 0) + 1
        lvl = LEVEL[ty]
        if ty == "pen":
            x = sfx_pen(soft=c.get("soft", False))
            pan = pan or rng.uniform(-0.1, 0.1)
        elif ty in ("click", "tick"):
            x = sfx_click()
        elif ty == "pop":
            x = sfx_pop()
        elif ty == "whoosh":
            x = sfx_whoosh(c.get("dur", 0.6))
        elif ty == "blip":
            x = sfx_blip(pitch=c.get("pitch", 1.0))
        elif ty == "check":
            x = sfx_check()
        elif ty == "sub":
            x = sfx_sub()
        elif ty == "chime":
            x = bell(c["note"], 1.0, 1.4, 0.45) + 0.4 * np.concatenate([np.zeros(int(0.004 * SR)), bell(c["note"] + 12, 1.0, 1.4, 0.3)])[: int(1.4 * SR)]
        add(bus, peak_norm(x, lvl, vel), t, pan)
    return bus, counts


def sfx_click(vel=1.0):
    t = tvec(0.02)
    n = rng.standard_normal(len(t))
    x = bp(n, 2500, 9000) * np.exp(-t / 0.0022) * 0.9
    x += np.sin(2 * np.pi * 3100 * t) * np.exp(-t / 0.004) * 0.45
    x += np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.006) * 0.35
    return x * vel


def sfx_key(vel=1.0, enter=False):
    d = 0.032 if enter else 0.016
    t = tvec(d)
    n = rng.standard_normal(len(t))
    c = rng.uniform(3000, 5200)
    x = bp(n, c * 0.6, min(c * 1.9, 20000)) * np.exp(-t / (0.004 if enter else 0.0022))
    x += np.sin(2 * np.pi * rng.uniform(1700, 2300) * t) * np.exp(-t / 0.003) * 0.25
    if enter:
        x += np.sin(2 * np.pi * 150 * t) * np.exp(-t / 0.012) * 0.8
        x = x * 1.3
    return x * vel


def sfx_pop(vel=1.0):
    t = tvec(0.12)
    f = 330 + 700 * np.exp(-t / 0.014)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.clip(t / 0.0015, 0, 1) * np.exp(-t / 0.035)
    x += 0.15 * bp(rng.standard_normal(len(t)), 1500, 6000) * np.exp(-t / 0.004)
    return x * vel


def sfx_whoosh(dur=0.6, vel=1.0):
    t = tvec(dur)
    n = rng.standard_normal(len(t))
    lo, hi = bp(n, 250, 1100), bp(n, 1400, 6500)
    u = t / dur
    peak = 0.62
    env = np.where(u < peak, np.clip(np.sin(u / peak * np.pi / 2), 0, 1) ** 2.2,
                   np.clip(np.cos(np.clip((u - peak) / (1 - peak), 0, 1) * np.pi / 2), 0, 1) ** 1.6)
    mix = np.clip(u / peak, 0, 1)
    x = (lo * (1 - 0.6 * mix) + hi * (0.25 + 0.55 * mix)) * env
    p = np.linspace(-0.45, 0.45, len(t))
    gl, gr = pan_gains(p)
    return np.stack([x * gl, x * gr], axis=1) * vel


def sfx_error(vel=1.0):
    out = np.zeros(int(0.45 * SR))
    for k, (o, f0) in enumerate(((0.0, 150), (0.105, 118))):
        t = tvec(0.3)
        f = f0 * (0.72 + 0.28 * np.exp(-t / 0.04))
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) + 0.35 * np.sin(4 * np.pi * np.cumsum(f) / SR)
        x *= np.clip(t / 0.003, 0, 1) * np.exp(-t / 0.075)
        i = int(o * SR)
        out[i:i + len(x)] += x * (1.0 if k == 0 else 0.85)
    return lp(out, 700) * vel


def sfx_blip(vel=1.0, pitch=1.0):
    t = tvec(0.14)
    f = pitch * (520 + 640 * (1 - np.exp(-t / 0.018)))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = (np.sin(ph) + 0.18 * np.sin(2 * ph)) * np.clip(t / 0.003, 0, 1) * np.exp(-t / 0.045)
    return x * vel


def sfx_check(vel=1.0):
    t = tvec(0.35)
    x = sfx_click(0.5)
    y = np.sin(2 * np.pi * mtof(88) * t) * np.exp(-t / 0.09) * np.clip(t / 0.002, 0, 1) * 0.55
    y += np.sin(2 * np.pi * mtof(88) * 2 * t) * np.exp(-t / 0.03) * 0.12
    y[: len(x)] += x
    return y * vel


def sfx_chime(vel=1.0, notes=(81, 86), gap=0.11):
    out = np.zeros(int((gap + 1.3) * SR))
    for k, m in enumerate(notes):
        x = bell(m, 0.8 if k == 0 else 1.0, 1.2, 0.42)
        i = int(k * gap * SR)
        out[i:i + len(x)] += x
    return out * vel


def sfx_send(vel=1.0):
    t = tvec(0.2)
    n = bp(rng.standard_normal(len(t)), 1800, 7000)
    env = np.sin(np.clip(t / 0.2, 0, 1) * np.pi) ** 2
    x = n * env * 0.35
    b = sfx_blip(0.8, 1.35)
    out = np.zeros(int(0.36 * SR))
    out[: len(x)] += x
    i = int(0.1 * SR)
    out[i:i + len(b)] += b
    return out * vel


def sfx_sub(vel=1.0):
    t = tvec(2.2)
    f = 44 + 50 * np.exp(-t / 0.07)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.75) * np.clip(t / 0.004, 0, 1)
    x += 0.25 * lp(rng.standard_normal(len(t)), 900) * np.exp(-t / 0.01)
    return lp(x, 400) * vel


def peak_norm(x, lvl, vel):
    p = np.max(np.abs(x)) or 1.0
    return x / p * db(lvl) * vel




def sidechain(fx, depth_db=3.0):
    lvl = np.max(np.abs(fx), axis=1)
    env = np.clip(maximum_filter1d(lvl, int(0.004 * SR)) / db(-32), 0, 1)
    env = uniform_filter1d(maximum_filter1d(env, int(0.08 * SR)), int(0.03 * SR))
    return (1 - (1 - db(-depth_db)) * env)[:, None]


def write(path, x):
    wavfile.write(path, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))


# ------------------------------------------------------------------ master
def limiter(x, thr_db=-3.0, knee_db=6.0, ceiling_db=-1.3):
    lvl = np.max(np.abs(x), axis=1) + 1e-9
    look = int(0.005 * SR)
    env = maximum_filter1d(lvl, size=2 * look + 1)
    L = 20 * np.log10(env)
    T, W = thr_db, knee_db
    gr = np.zeros_like(L)
    m = (L > T - W / 2) & (L <= T + W / 2)
    gr[m] = -((L[m] - T + W / 2) ** 2) / (2 * W)
    m2 = L > T + W / 2
    gr[m2] = T - L[m2]
    gr = -maximum_filter1d(-gr, size=2 * look + 1)                  # hold (lookahead)
    gr = uniform_filter1d(gr, size=look)                              # smooth attack
    # program-dependent release: reduction may fall back no faster than ~80 ms
    r = (-gr).tolist()
    a = float(np.exp(-1 / (0.08 * SR)))
    s = 0.0
    for i, v in enumerate(r):
        s = v if v > s else s * a
        r[i] = s
    gr = -np.asarray(r)
    y = x * db(gr)[:, None]
    pk = np.max(np.abs(y))
    if pk > db(ceiling_db):
        y *= db(ceiling_db) / pk
    return y


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)


def write(path, x):
    wavfile.write(path, SR, (np.clip(x, -1, 1) * 32767).astype(np.int16))


def main():
    ep, bass, drums, bells, risers, pad, lead = music()
    ep = trem(ep, 4.2, 0.1)
    bed = ep * 1.0 + bass * 0.55 + drums * 0.5 + bells * 0.35 + risers * 0.6 + pad * 0.32 + lead * 0.55
    bed = arrangement_lp(hp(bed.T, 28).T)
    bed = plate(bed, 0.16)
    bed = bus_comp(bed)
    bed = lp(bed.T, 12000).T
    t = np.arange(N) / SR
    bed *= np.clip((STOP0 - 0.005 - t) / 0.02, 0, 1)[:, None]      # stop-time: the bed drops out on the bar
    busy = slice(int(MUS["bassFrom"] * SR), int(STOP0 * SR))
    bed *= db(-18.5 - rms_db(bed[busy]))
    hb = hits()
    hb *= db(-6.5) / (np.max(np.abs(hb)) or 1)
    music_mix = bed + hb
    fade = np.where(t < DUR - 1.6, 1.0, np.cos(np.clip((t - (DUR - 1.6)) / 1.57, 0, 1) * np.pi / 2) ** 2)[:, None]
    music_mix *= fade

    fx, counts = sfx_bus()
    fx = plate(fx, 0.08)
    sc = sidechain(fx, 3.0)
    mix = music_mix * sc + fx
    out = limiter(mix)
    os.makedirs(OUT, exist_ok=True)
    write(os.path.join(OUT, NAME + ".wav"), out)
    write(os.path.join(OUT, NAME + "_music.wav"), limiter(music_mix))
    write(os.path.join(OUT, NAME + "_sfx.wav"), limiter(fx))
    pk = 20 * np.log10(np.max(np.abs(out)))
    print(f"wrote {os.path.join(OUT, NAME + '.wav')}: {len(out) / SR:.3f}s @ {SR} Hz stereo")
    print(f"peak {pk:.2f} dBFS | mix RMS {rms_db(out):.2f} dBFS | bed RMS {rms_db(bed[busy]):.2f} dBFS | sfx RMS {rms_db(fx):.2f} dBFS")
    print("sfx cues voiced:", counts)


if __name__ == "__main__":
    main()
