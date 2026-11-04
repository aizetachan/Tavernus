#!/usr/bin/env bash
# Añade la banda sonora a los vídeos renderizados (música del proyecto + efectos de public/sfx).
#   video/mix.sh cuento   → video/out/tavernus-cuento.mp4
#   video/mix.sh pitch    → video/out/tavernus-presentacion.mp4
set -euo pipefail
cd "$(dirname "$0")/.."
M=public/music; S=public/sfx
case "$1" in
cuento)
  IN=video/out/cuento-silent.mp4; OUT=video/out/tavernus-cuento.mp4; D=121
  ffmpeg -y -loglevel error -i "$IN" \
    -i $M/intro-partida.mp3 -i $S/ambient/ambiente-bosque-noche.mp3 -i $S/ambiente-herreria.mp3 \
    -i $S/campana.mp3 -i $S/campana.mp3 -i $S/campana.mp3 -i $S/puerta-abrir.mp3 -i $S/ambiente-taberna.mp3 \
    -filter_complex "
      [1:a]atrim=0:$D,afade=t=in:d=2,afade=t=out:st=$((D-6)):d=6,volume=0.9[mus];
      [2:a]atrim=0:14,afade=t=in:d=2.5,afade=t=out:st=10:d=4,volume=0.55,adelay=50000|50000[wind];
      [3:a]atrim=0:12,afade=t=in:d=1.5,afade=t=out:st=8:d=4,volume=0.45,adelay=26000|26000[fire];
      [4:a]volume=0.5,adelay=87400|87400[b1];
      [5:a]volume=0.5,adelay=88700|88700[b2];
      [6:a]volume=0.65,adelay=90000|90000[b3];
      [7:a]volume=0.7,adelay=98600|98600[door];
      [8:a]atrim=0:18,afade=t=in:d=2,afade=t=out:st=12:d=6,volume=0.35,adelay=101500|101500[tav];
      [mus][wind][fire][b1][b2][b3][door][tav]amix=inputs=8:normalize=0:duration=first,alimiter=limit=0.95[a]" \
    -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -c:a aac -b:a 192k -t $D -movflags +faststart "$OUT" ;;
pitch)
  IN=video/out/pitch-silent.mp4; OUT=video/out/tavernus-presentacion.mp4; D=108
  ffmpeg -y -loglevel error -i "$IN" -i $M/menu-instrumental.mp3 -i $S/dado.mp3 -i $S/dado.mp3 -i $S/puerta-abrir.mp3 \
    -filter_complex "
      [1:a]atrim=0:$D,afade=t=in:d=1.5,afade=t=out:st=$((D-5)):d=5,volume=0.85[mus];
      [2:a]volume=0.8,adelay=28200|28200[d1];
      [3:a]volume=0.8,adelay=75400|75400[d2];
      [4:a]volume=0.5,adelay=15400|15400[door];
      [mus][d1][d2][door]amix=inputs=4:normalize=0:duration=first,alimiter=limit=0.95[a]" \
    -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -c:a aac -b:a 192k -t $D -movflags +faststart "$OUT" ;;
esac
echo "listo: $OUT"
