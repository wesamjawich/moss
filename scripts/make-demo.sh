#!/usr/bin/env bash
# Records the whole demo video: frames, closing stills, music, final mp4.
#   npm run demo            (needs Node, ffmpeg, and python3 with numpy for the music)
#   SOFTWARE=1 npm run demo (no GPU: slow)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${OUT:-demo/koke-demo.mp4}
WORK=$(mktemp -d)
npx playwright install chromium >/dev/null 2>&1 || true
npx vite build >/dev/null
npx vite preview --port 4173 >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null || true' EXIT
sleep 2
mkdir -p "$WORK/frames" "$WORK/stills" "$(dirname "$OUT")"
node scripts/record-demo.cjs "$WORK/frames"
node scripts/record-stills.cjs "$WORK/stills"
N=$(ls "$WORK/frames" | wc -l | tr -d ' ')
read -r O1 O2 O3 O4 TOT FO < <(python3 -c "d=$N/24; print(*[round(d-0.5+i*2.1,3) for i in range(4)], round(d+8.4,3), round(d+7.7,3))")
AUDIO=()
MAP=()
if python3 scripts/make-music.py "$WORK/music.wav" "$TOT" >/dev/null 2>&1; then AUDIO=(-i "$WORK/music.wav"); MAP=(-map 5:a -c:a aac -b:a 160k -shortest); else echo "No music (python3 with numpy not found)"; fi
Z="scale=1560:3376,zoompan=z='1+0.0006*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=63:s=780x1688:fps=24,format=yuv420p,setsar=1"
ffmpeg -y -loglevel error -framerate 24 -i "$WORK/frames/%05d.jpg" -i "$WORK/stills/still0.png" -i "$WORK/stills/still1.png" -i "$WORK/stills/still2.png" -i "$WORK/stills/still3.png" "${AUDIO[@]}" \
  -filter_complex "[0]format=yuv420p,setsar=1,fps=24[m];[1]$Z[a];[2]$Z[b];[3]$Z[c];[4]$Z[d];[m][a]xfade=transition=fade:duration=0.5:offset=$O1[x1];[x1][b]xfade=transition=fade:duration=0.5:offset=$O2[x2];[x2][c]xfade=transition=fade:duration=0.5:offset=$O3[x3];[x3][d]xfade=transition=fade:duration=0.5:offset=$O4,fade=t=in:st=0:d=0.5,fade=t=out:st=$FO:d=0.65[v]" \
  -map "[v]" "${MAP[@]}" -c:v libx264 -preset slow -crf 24 -pix_fmt yuv420p -movflags +faststart "$OUT"
rm -rf "$WORK"
echo "Wrote $OUT"
