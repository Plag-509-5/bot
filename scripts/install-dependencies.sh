#!/usr/bin/env bash
set -euo pipefail

ffmpeg_bin="${FFMPEG_BIN:-${FFMPEG_PATH:-}}"
if [[ -z "$ffmpeg_bin" ]]; then
  ffmpeg_bin="$(command -v ffmpeg || true)"
fi
if [[ -z "$ffmpeg_bin" || ! -x "$ffmpeg_bin" ]]; then
  echo "FFmpeg système est requis. Installe-le ou définis FFMPEG_BIN avant le déploiement." >&2
  exit 1
fi

export FFMPEG_BIN="$ffmpeg_bin"
# Les scripts des paquets téléchargent des binaires séparément (GitHub/CDN).
# Le bot s’appuie sur FFmpeg système; Baileys est corrigé explicitement ensuite.
npm ci --ignore-scripts --no-audit --no-fund
node scripts/patch-baileys-group-status-media.js
