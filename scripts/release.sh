#!/usr/bin/env bash
# Full release pipeline: bump versions, build everything, ship to npm + GitHub + Homebrew.
#
# Usage:
#   bash scripts/release.sh          # publish current versions
#   bash scripts/release.sh patch    # 0.1.0 → 0.1.1 across all packages
#   bash scripts/release.sh minor
#   bash scripts/release.sh major
#
# Steps in order:
#   1. publish-dmg.sh: bump reader+jdfjs to same version, build dmg,
#      update Casks/jdf.rb + uurtech/homebrew-jdf, GitHub release with dmg upload.
#   2. publish-npm.sh: build jdfjs, publish to npm.
#
# Requires NPM_TOKEN + GITHUB_TOKEN in /.env.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

BUMP="${1:-}"
if [[ -n "$BUMP" && ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 [patch|minor|major]"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "Step 1/2: Desktop bundle + GitHub release + Homebrew Cask"
echo "═══════════════════════════════════════════════════════════"
bash scripts/publish-dmg.sh "$BUMP"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Step 2/2: npm publish jdfjs"
echo "═══════════════════════════════════════════════════════════"
bash scripts/publish-npm.sh

READER_VER=$(node -p "require('./apps/reader/package.json').version")
JDFJS_VER=$(node -p "require('./jdfjs/package.json').version")

echo ""
echo "✓ Release complete."
echo "  Desktop: v$READER_VER  https://github.com/uurtech/jdf/releases/tag/v$READER_VER"
echo "  Brew:    brew upgrade --cask jdf"
echo "  Web:     npm install jdfjs@$JDFJS_VER"
echo "  CDN:     https://unpkg.com/jdfjs@$JDFJS_VER/dist/jdfjs.js"
