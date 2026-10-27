#!/usr/bin/env bash
# Fetch third-party assets at build time (kept out of the repository):
#  - Apple's web-music-ipod Web Component (publicly served on music.apple.com 404 pages)
#  - The built-in demo library JSONs (Apple's public iPod easter-egg data)
#  - jsmediatags (MIT)
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p web/assets/vendor web/data

echo "Fetching Apple iPod component..."
curl -fsSL -o web/assets/vendor/web-music-ipod.esm.js \
  https://music.apple.com/includes/ipod/web-music-ipod.esm.js

echo "Fetching built-in library data (CN / US storefronts)..."
curl -fsSL -o web/data/cn.json https://music.apple.com/includes/ipod/data/cn/index.json
curl -fsSL -o web/data/us.json https://music.apple.com/includes/ipod/data/us/index.json

echo "Fetching jsmediatags (MIT)..."
curl -fsSL -o web/assets/vendor/jsmediatags.min.js \
  https://cdn.jsdelivr.net/npm/jsmediatags@3.9.7/dist/jsmediatags.min.js

echo "Applying local component patches (backlight removal, Albums menu, App Settings entry)..."
python3 tools/patch-bundle.py

echo "Done."
