#!/usr/bin/env bash
# Cut a vocadito excerpt into a test fixture: mono 22.05 kHz 16-bit WAV plus its f0 and
# note annotations (annotator 1), times shifted to the cut. vocadito is CC BY 4.0
# (https://zenodo.org/records/5578807); the fixture README carries the attribution.
#
# usage: cut_vocadito.sh <vocadito dir> <track> <start s> <duration s> <out dir>
set -euo pipefail
src=$1 track=$2 start=$3 dur=$4 out=$5
mkdir -p "$out"
ffmpeg -loglevel error -y -ss "$start" -t "$dur" -i "$src/Audio/vocadito_${track}.wav" -ac 1 -ar 22050 -sample_fmt s16 "$out/audio.wav"
awk -F, -v s="$start" -v d="$dur" 'BEGIN{print "t,f0"} $1>=s && $1<s+d {printf "%.6f,%s\n", $1-s, $2}' \
  "$src/Annotations/F0/vocadito_${track}_f0.csv" > "$out/f0.csv"
awk -F, -v s="$start" -v d="$dur" 'BEGIN{print "start,hz,duration"} $1>=s && $1+$3<=s+d {printf "%.6f,%s,%s\n", $1-s, $2, $3}' \
  "$src/Annotations/Notes/vocadito_${track}_notesA1.csv" > "$out/notes.csv"
