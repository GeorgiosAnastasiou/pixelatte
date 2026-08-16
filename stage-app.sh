#!/usr/bin/env bash
# Stage the web app into a destination directory.
#
# Two things need a copy of the app and neither wants the whole repo: the
# Capacitor build (../sync-web.sh -> www/) and the website (./build-site.sh ->
# docs/app/). This is the one description of what "the app" actually consists
# of, so the two can never drift apart.
#
# Usage: ./stage-app.sh <destination>
set -euo pipefail

DEST=${1:?usage: stage-app.sh <destination>}
# Resolve before cd, so a relative destination means what the caller meant.
mkdir -p "$DEST"
DEST=$(cd "$DEST" && pwd)

cd "$(dirname "$0")"

rm -rf "${DEST:?}"/*
cp index.html "$DEST/"
cp -r css "$DEST/"
cp -r js "$DEST/"

# Node-only files: the test harnesses and the ESM marker that lets Node treat
# js/*.js as modules. The browser needs neither.
rm -f "$DEST"/js/*.test.js "$DEST/js/package.json"

# ---- welcome artwork -------------------------------------------------------
# The app opens on a random picture from assets/welcome. A WebView cannot list
# a directory, so the listing is baked here instead: add images to the folder,
# re-run this, and they are in. The README is for whoever is adding art and has
# no business being shipped.
mkdir -p "$DEST/assets/welcome"
shopt -s nullglob nocaseglob

welcome=()
for f in assets/welcome/*.png assets/welcome/*.jpg assets/welcome/*.jpeg \
         assets/welcome/*.webp assets/welcome/*.gif; do
    cp "$f" "$DEST/assets/welcome/"
    welcome+=("$(basename "$f")")
done

shopt -u nullglob nocaseglob

{
    printf '['
    for i in "${!welcome[@]}"; do
        [ "$i" -gt 0 ] && printf ','
        # Escape the two characters that can appear in a filename and break JSON.
        printf '"%s"' "$(printf '%s' "${welcome[$i]}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    done
    printf ']\n'
} > "$DEST/assets/welcome/manifest.json"

echo "Staged app into $DEST ($(du -sh "$DEST" | cut -f1), ${#welcome[@]} welcome image(s))"
