#!/bin/sh
# Rebuild out/tutor-launch.mp4 (and the 18 s cut) from scratch.
#   ./build.sh            needs: node + puppeteer-core (npm i), Google Chrome, python3 with numpy + scipy, ffmpeg
set -e
cd "$(dirname "$0")"
FFMPEG=${FFMPEG:-/opt/homebrew/bin/ffmpeg}
FRAMES="$PWD/out/build/frames"
mkdir -p "$FRAMES"
python3 timeline.py                       # cue list -> timeline.json (picture and sound both read it)
python3 audio.py                          # -> out/build/audio.wav
FRAMES_DIR="$FRAMES" START=0 END=750 node render.cjs &   # two halves in parallel
FRAMES_DIR="$FRAMES" START=750 node render.cjs
wait
"$FFMPEG" -y -loglevel error -framerate 30 -i "$FRAMES/f%05d.png" -i out/build/audio.wav \
  -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 256k -shortest -movflags +faststart out/tutor-launch.mp4
python3 cut18.py                          # -> out/tutor-teaser-18s.mp4 from the same frames
echo "wrote out/tutor-launch.mp4 and out/tutor-teaser-18s.mp4"
