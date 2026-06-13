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
#   1. publish-dmg.sh: bump reader + jdfjs + jdf-cli to same version, build dmg,
#      update Casks/jdf.rb + uurtech/homebrew-jdf, GitHub release with dmg upload.
#   2. publish-npm.sh: build + publish jdfjs (@uurtech/jdf) and jdf-cli (@uurtech/jdf-cli) to npm.
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
echo "Step 2/2: npm publish — @uurtech/jdf + @uurtech/jdf-cli"
echo "═══════════════════════════════════════════════════════════"
# publish-dmg.sh already bumped the versions in lockstep above, so don't bump again here.
bash scripts/publish-npm.sh

READER_VER=$(node -p "require('./apps/reader/package.json').version")
JDFJS_VER=$(node -p "require('./jdfjs/package.json').version")
JDFJS_NAME=$(node -p "require('./jdfjs/package.json').name")
CLI_VER=$(node -p "require('./tools/jdf-cli/package.json').version")
CLI_NAME=$(node -p "require('./tools/jdf-cli/package.json').name")

echo ""
echo "✓ Release complete."
echo "  Desktop: v$READER_VER  https://github.com/uurtech/jdf/releases/tag/v$READER_VER"
echo "  Brew:    brew upgrade --cask jdf"
echo "  Web:     npm install $JDFJS_NAME@$JDFJS_VER"
echo "  CDN:     https://unpkg.com/$JDFJS_NAME@$JDFJS_VER/dist/jdfjs.js"
echo "  CLI:     npx $CLI_NAME@$CLI_VER validate file.jdf"
