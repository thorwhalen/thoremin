#!/usr/bin/env bash
# Fetch the cardinal vowel recordings from Wikimedia Commons (Denelson83, CC BY-SA 3.0, GFDL) and
# convert each to a test fixture: mono 22.05 kHz 16-bit WAV named by the vowel. The fixture
# README carries the attribution; docs/research/datasets.md the row.
#
# usage: fetch_vowels.sh <out dir>
set -euo pipefail
out=$1
mkdir -p "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
while read -r name file; do
  curl -sfL -A "thoremin-fixtures/0.1" -o "$tmp/$name.ogg" "https://commons.wikimedia.org/wiki/Special:FilePath/$file.ogg"
  ffmpeg -loglevel error -y -i "$tmp/$name.ogg" -ac 1 -ar 22050 -sample_fmt s16 "$out/$name.wav"
done <<'LIST'
i Close_front_unrounded_vowel
e Close-mid_front_unrounded_vowel
epsilon Open-mid_front_unrounded_vowel
a Open_front_unrounded_vowel
alpha Open_back_unrounded_vowel
open-o Open-mid_back_rounded_vowel
o Close-mid_back_rounded_vowel
u Close_back_rounded_vowel
LIST
