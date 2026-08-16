#!/usr/bin/env bash
# Stage the web app into www/ for Capacitor.
#
# capacitor.config.json points at www/ rather than video_pixelator/ because
# Capacitor copies its webDir wholesale — it ignores .gitignore — and that
# directory also holds .git (48 MB) and samples/ (50 MB), none of which belong
# in an APK.
#
# What counts as "the app" is defined once, in ./stage-app.sh,
# which the website build uses too.
set -euo pipefail

cd "$(dirname "$0")"
rm -rf www
./stage-app.sh www

echo "Contents:"
find www -type f | sed 's|^www/|  |' | sort
