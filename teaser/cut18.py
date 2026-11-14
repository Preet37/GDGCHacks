#!/usr/bin/env python3
"""The 18 s cut: real ranges out of the rendered launch film, joined the way Huddle's combo.py
joins its films. Cues are shifted onto the output clock into timeline18.json and audio.py scores
that as one continuous track, so sound still lands on picture.

  S1 10.2-15.0   the red circle on the exact term, the hint in the margin
  S2 16.2-19.2   fix it yourself, the mark clears
  S3 22.7-25.5   Help: three hint levels
  S4 42.0-50.0   the core line, end card        (hard cut on the bar: stop-time)

Needs the frames from render.cjs in out/build/frames. Writes out/tutor-teaser-18s.mp4.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FFMPEG = os.environ.get("FFMPEG", "/opt/homebrew/bin/ffmpeg")
FRAMES = os.environ.get("FRAMES_DIR", os.path.join(HERE, "out", "build", "frames"))
FPS = 30
SEGS = [{"id": "S1", "a": 10.2, "b": 15.0}, {"id": "S2", "a": 16.2, "b": 19.2}, {"id": "S3", "a": 22.7, "b": 25.5}, {"id": "S4", "a": 42.0, "b": 50.0}]
XF = [0.3, 0.3, 0.0]            # dissolve into S2, S3; S4 is a hard cut
DROP = {"riser"}

src = json.load(open(os.path.join(HERE, "timeline.json")))
out_t, cues = 0.0, []
for k, s in enumerate(SEGS):
    if k:
        out_t -= XF[k - 1]
        if XF[k - 1]:
            cues.append({"t": round(out_t - 0.1, 3), "type": "whoosh", "id": f"cut{k}", "dur": 0.6, "vel": 0.4})
    s["out"] = round(out_t, 4)
    for c in src["cues"]:
        if s["a"] <= c["t"] < s["b"] and c["type"] not in DROP:
            cues.append(dict(c, t=round(s["out"] + c["t"] - s["a"], 4), id=f'{s["id"]}:{c.get("id", "")}'))
    out_t += s["b"] - s["a"]
DUR = round(out_t, 4)
cues.sort(key=lambda c: c["t"])
stop = SEGS[3]["out"]
TL = {
    "meta": dict(src["meta"], duration=DUR, frames=round(DUR * FPS)),
    "segments": SEGS, "xfade": XF,
    "music": {"epLowpassOpen": [0, 1], "kickFrom": 0.0, "bassFrom": 2.0, "hatsFrom": 2.0, "clapFrom": 4.0, "leadFrom": 4.0,
              "bigFrom": 6.0, "stop": [stop, stop + 4.0], "final": stop + 4.0, "risers": [[stop - 1.0, stop]], "motifs": [2.0]},
    "cues": cues,
}
json.dump(TL, open(os.path.join(HERE, "timeline18.json"), "w"), indent=1, ensure_ascii=False)
print(f"{len(cues)} cues, {DUR:.2f}s -> timeline18.json (core line at {stop:.2f}s)")

subprocess.run([sys.executable, os.path.join(HERE, "audio.py")], check=True, env=dict(os.environ, TIMELINE="timeline18.json", AUDIO_NAME="audio18"))

args, n = [FFMPEG, "-y", "-loglevel", "error"], len(SEGS)
for s in SEGS:
    fa, fb = round(s["a"] * FPS), round(s["b"] * FPS)
    args += ["-framerate", str(FPS), "-start_number", str(fa), "-i", os.path.join(FRAMES, "f%05d.png")]
    s["n"] = fb - fa
fc, cur, length = [f"[{i}:v]trim=end_frame={s['n']},setpts=PTS-STARTPTS,format=yuv420p[v{i}]" for i, s in enumerate(SEGS)], "v0", SEGS[0]["n"] / FPS
for k in range(1, n):
    d = XF[k - 1]
    if d:
        fc.append(f"[{cur}][v{k}]xfade=transition=fade:duration={d}:offset={length - d:.4f}[x{k}]")
    else:
        fc.append(f"[{cur}][v{k}]concat=n=2:v=1:a=0[x{k}]")
    cur, length = f"x{k}", length - d + SEGS[k]["n"] / FPS
args += ["-i", os.path.join(HERE, "out", "build", "audio18.wav"), "-filter_complex", ";".join(fc), "-map", f"[{cur}]", "-map", f"{n}:a",
         "-r", str(FPS), "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p",
         "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
         "-c:a", "aac", "-b:a", "256k", "-t", str(DUR), "-movflags", "+faststart", os.path.join(HERE, "out", "tutor-teaser-18s.mp4")]
subprocess.run(args, check=True)
print("wrote out/tutor-teaser-18s.mp4")
