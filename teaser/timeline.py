#!/usr/bin/env python3
"""Cue list for the AI tutor notebook launch teaser (50 s, 30 fps, 120 BPM, bar = 2 s).

One source of truth, same idea as the Huddle pipeline: every on-screen beat is a cue. launch.html
reads the cue times (and the handwriting itself: one `pen` cue per glyph), audio.py voices every
cue that has a sound type (pen, click, tick, pop, whoosh, blip, check, chime, hit, final).
Writes timeline.json.

  A  0-4    the problem: AI homework help hands you the answer
  B  4-10   write by hand; pause and it reads your work
  D 10-16   the red circle on the exact term, the hint in the margin
  E 16-20   fix it yourself, the mark clears
  F 20-26   Help: three hint levels
  G 26-30   select the problem, hold Help, ask out loud
  H 30-34   write "graph this"
  I 34-38   import a PDF worksheet, work on top of it
  J 38-42   how it works: handwriting -> Gemini -> math check -> the page
  K 42-46   stop-time: the core line
  L 46-50   end card
"""
import json
import os
import random

HERE = os.path.dirname(os.path.abspath(__file__))
rnd = random.Random(11)
FPS, DUR = 30, 50.0
cues = []


def cue(t, ty, id, **kw):
    cues.append({"t": round(t, 3), "type": ty, "id": id, **kw})


def pen(seq, tokens, t0, per=0.1, vel=0.8, pan=0.0, jitter=0.3):
    """one cue per handwritten glyph (launch.html builds the line from these); returns end time.
    tokens: list of glyphs; ' ' is a silent gap, '^2' a superscript 2."""
    t = t0
    for i, ch in enumerate(tokens):
        if ch == " ":
            cue(t, "gap", seq, i=i, ch=ch)
            t += per * 0.55
            continue
        cue(t, "pen", seq, i=i, ch=ch, vel=round(vel * (0.75 + 0.25 * rnd.random()), 2), pan=pan)
        t += per * (1 + jitter * (rnd.random() - 0.5))
    return t


def tok(s):
    """'f(x) = 3x^2 + 2x' -> glyph tokens"""
    out, i = [], 0
    while i < len(s):
        if s[i] == "^":
            out.append("^" + s[i + 1])
            i += 2
        else:
            out.append(s[i])
            i += 1
    return out


def note(seq, text, t0, dur, pan=0.2):
    """the tutor's margin note writes itself: a start cue, soft scratches, an end time"""
    cue(t0, "reveal", seq, text=text, dur=dur)
    n = max(3, int(dur / 0.085))
    for k in range(n):
        cue(t0 + dur * k / n + 0.02 * rnd.random(), "pen", seq + "_s", vel=round(0.28 + 0.12 * rnd.random(), 2), pan=pan, soft=True)


# ---------------------------------------------------------------- A: the problem
cue(0.4, "reveal", "capA1")
cue(0.95, "pop", "chatCard", vel=0.55)
cue(1.35, "pop", "chatAsk", vel=0.6, pan=0.25)
for i, t in enumerate((1.9, 2.1, 2.3, 2.5)):
    cue(t, "tick", f"chatL{i}", vel=0.55, pan=-0.2)
cue(2.75, "check", "chatAns", vel=0.6, pan=-0.2)
cue(2.6, "reveal", "capA2")
cue(3.6, "reveal", "A_out")

# ---------------------------------------------------------------- B: write, pause, it reads
cue(3.75, "whoosh", "tab_in", dur=0.7, vel=0.45)
cue(4.2, "reveal", "capB1")
e = pen("L1", tok("f(x) = 3x^2 + 2x"), 4.75, per=0.105)
e = pen("L2", tok("f′(x) = 6x + 1"), e + 0.3, per=0.105)
cue(7.75, "reveal", "penUp")
cue(8.0, "reveal", "capB2")
cue(8.25, "tick", "busy1", vel=0.5)
cue(8.25, "reveal", "lblPause")
cue(9.0, "blip", "read1", vel=0.5, pitch=1.0, pan=-0.2)
cue(9.2, "blip", "read2", vel=0.5, pitch=1.12, pan=-0.2)
cue(9.2, "reveal", "lblRead")
cue(9.4, "reveal", "busy1_off")
cue(9.0, "riser", "riseD", dur=1.0)

# ---------------------------------------------------------------- D: the circle and the hint
cue(10.0, "whoosh", "pushD", dur=0.8, vel=0.4)
cue(10.1, "reveal", "capD0")
cue(10.75, "whoosh", "circle", dur=0.45, vel=0.7, pan=0.1)
cue(11.2, "pop", "circleDone", vel=0.8, pan=0.1)
note("noteD", "Check the derivative of 2x. What happens to the x?", 11.55, 1.5)
cue(12.6, "pop", "lblCheck", vel=0.45, pan=0.4)
cue(13.3, "reveal", "capD1")
cue(15.3, "whoosh", "pullD", dur=0.7, vel=0.3)

# ---------------------------------------------------------------- E: fix it, the mark clears
cue(16.1, "reveal", "capE")
cue(16.75, "whoosh", "erase", dur=0.35, vel=0.55, pan=0.05)
pen("fix", ["2"], 17.35, per=0.2, vel=0.9)
cue(17.75, "tick", "busy2", vel=0.5)
cue(18.6, "reveal", "busy2_off")
cue(18.6, "check", "clear", vel=0.8, pan=0.1)
cue(18.62, "chime", "clearChime", note=81, vel=0.6)
cue(19.55, "whoosh", "pan1", dur=0.7, vel=0.4)

# ---------------------------------------------------------------- F: Help, three levels
cue(20.1, "reveal", "capF0")
pen("P2", tok("d/dx (x sin x)"), 20.25, per=0.07)
cue(21.2, "reveal", "touchF")
HINTS = [
    ("Which rule handles a product like x sin x?", "a nudge"),
    ("Try the product rule: (uv)′ = u′v + uv′.", "a bigger push"),
    ("Worked step: u = x and v = sin x, so u′v = 1 · sin x. Now you do uv′.", "a worked step"),
]
for k, (tt, text) in enumerate(((21.7, HINTS[0]), (23.25, HINTS[1]), (24.5, HINTS[2]))):
    cue(tt, "click", f"help{k}", vel=0.9, pan=0.5)
    cue(tt + 0.42, "pop", f"lvl{k}", vel=0.6, pan=0.55, label=text[1])
    note(f"hint{k}", text[0], tt + 0.45, 0.6 + 0.15 * k)
cue(22.7, "reveal", "capF1")

# ---------------------------------------------------------------- G: ask out loud
cue(26.1, "reveal", "capG")
cue(26.45, "tick", "select", vel=0.6)
cue(27.05, "click", "holdStart", vel=0.9, pan=0.5)
cue(27.1, "blip", "listen", vel=0.7, pitch=0.9, pan=0.5)
SAID = ["why", "do", "I", "need", "the", "product", "rule?"]
for i, w in enumerate(SAID):
    cue(27.3 + i * 0.16, "word", "said", i=i, w=w)
cue(28.55, "click", "holdEnd", vel=0.7, pan=0.5)
cue(28.6, "blip", "sent", vel=0.6, pitch=1.3, pan=0.5)
note("voiceNote", "Because x and sin x are multiplied, and both change with x.", 28.95, 0.7)
cue(29.0, "riser", "riseH", dur=1.0)
cue(29.55, "whoosh", "pan2", dur=0.7, vel=0.4)

# ---------------------------------------------------------------- H: graph this
cue(30.1, "reveal", "capH")
e = pen("G1", tok("g(x) = x^2 − 4"), 30.3, per=0.085)
e = pen("G2", tok("graph this"), e + 0.2, per=0.08)
cue(32.1, "tick", "busy3", vel=0.5)
cue(32.75, "reveal", "busy3_off")
cue(32.8, "pop", "figure", vel=0.8, pan=0.3)
cue(32.95, "whoosh", "curve", dur=0.6, vel=0.5, pan=0.3)
cue(33.45, "chime", "curveDone", note=86, vel=0.5, pan=0.3)
cue(33.6, "whoosh", "pan3", dur=0.7, vel=0.4)

# ---------------------------------------------------------------- I: import a worksheet
cue(34.1, "reveal", "capI")
cue(34.25, "reveal", "touchI")
cue(34.7, "click", "import", vel=0.9, pan=0.5)
cue(35.3, "pop", "sheet", vel=0.8)
e = pen("W1", tok("f′(x) = 3x^2 − 5"), 35.85, per=0.09)
cue(37.6, "reveal", "I_out")
cue(37.65, "whoosh", "toJ", dur=0.8, vel=0.5)

# ---------------------------------------------------------------- J: how it works
cue(38.15, "reveal", "capJ")
for k, t in enumerate((38.5, 38.95, 39.4, 39.85)):
    cue(t, "pop", f"node{k}", vel=0.65, pan=-0.6 + 0.4 * k)
for k, t in enumerate((40.25, 40.6, 40.95)):
    cue(t, "blip", f"hop{k}", vel=0.6, pitch=1.0 + 0.12 * k, pan=-0.4 + 0.4 * k)
cue(41.3, "check", "landed", vel=0.7, pan=0.6)
cue(40.4, "reveal", "jfoot")
cue(41.0, "riser", "riseK", dur=1.0)

# ---------------------------------------------------------------- K: the core line (stop-time)
cue(42.0, "hit", "pay1", chord="I")
cue(43.5, "hit", "pay2", chord="vi")
cue(44.5, "hit", "pay3", chord="IV", long=True)

# ---------------------------------------------------------------- L: end card
cue(46.0, "final", "lock")
cue(46.05, "sub", "lockSub", vel=0.8)
cue(46.1, "whoosh", "ring", dur=0.5, vel=0.4)
cue(46.45, "reveal", "wordmark")
cue(47.1, "reveal", "tagline")
cue(47.7, "pop", "built", vel=0.45)
cue(48.1, "reveal", "byline")

cues.sort(key=lambda c: c["t"])
TL = {
    "meta": {"fps": FPS, "width": 1920, "height": 1080, "duration": DUR, "frames": int(DUR * FPS),
             "bpm": 120, "beat": 0.5, "bar": 2.0, "key": "G major", "progression": ["Gmaj7", "Em9", "Cmaj7", "D"]},
    "sections": [{"id": k, "t": t} for k, t in (("A", 0), ("B", 4), ("D", 10), ("E", 16), ("F", 20), ("G", 26), ("H", 30),
                                                ("I", 34), ("J", 38), ("K", 42), ("L", 46), ("END", DUR))],
    # arrangement changes on bar lines only
    "music": {"epLowpassOpen": [0, 4], "kickFrom": 4.0, "bassFrom": 10.0, "hatsFrom": 10.0, "clapFrom": 20.0, "leadFrom": 20.0,
              "bigFrom": 30.0, "stop": [42.0, 46.0], "final": 46.0,
              "risers": [[9.0, 10.0], [29.0, 30.0], [41.0, 42.0]], "motifs": [10.0, 20.0, 38.0]},
    "cues": cues,
}
json.dump(TL, open(os.path.join(HERE, "timeline.json"), "w"), indent=1, ensure_ascii=False)
print(f"{len(cues)} cues, {DUR}s -> timeline.json")
