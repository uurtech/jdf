#!/usr/bin/env bash
# One-shot release pipeline for the entire JDF ecosystem.
#
# Usage:
#   bash scripts/release.sh          # publish at current versions
#   bash scripts/release.sh patch    # 0.1.X → 0.1.(X+1) across all packages
#   bash scripts/release.sh minor
#   bash scripts/release.sh major
#
# What this does end-to-end:
#   1. Bumps versions in lockstep across:
#        apps/reader/package.json  +  apps/reader/src-tauri/{Cargo.toml,tauri.conf.json}
#        jdfjs/package.json
#        tools/jdf-cli/package.json
#   2. Builds the macOS .dmg (signed + notarized when APPLE_* set in /.env).
#   3. Updates Casks/jdf.rb (this repo, canonical) with new version + sha256;
#      mirrors the full file (including postflight blocks) into ../homebrew-jdf
#      and pushes the tap.
#   4. Recreates the GitHub release for the tag, uploads the .dmg, prints URL.
#   5. Builds + npm-publishes @uurtech/jdf and @uurtech/jdf-cli.
#   6. Refreshes docs/jdfjs-local/{js,css} so the landing site uses the same
#      bundle that just shipped to npm.
#   7. Rewrites pinned `@uurtech/jdf@<ver>` references in docs/index.html and
#      README.md so the public docs always point at the latest version.
#   8. Commits version bumps + docs updates to this repo, tags vX.Y.Z, pushes.
#
# Requires NPM_TOKEN + GITHUB_TOKEN in /.env.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Default bump = patch. Override with `minor` / `major`, or pass `none` to
# republish at the current version (only useful right after a failed run).
BUMP="${1:-patch}"
if [[ "$BUMP" == "none" ]]; then BUMP=""; fi
if [[ -n "$BUMP" && ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 [patch|minor|major|none]"
  exit 1
fi

echo "═══════════════════════════════════════════════════════════"
echo "Step 1/4: Desktop bundle + GitHub release + Homebrew Cask"
echo "═══════════════════════════════════════════════════════════"
bash scripts/publish-dmg.sh "$BUMP"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Step 2/4: npm publish — @uurtech/jdf + @uurtech/jdf-cli"
echo "═══════════════════════════════════════════════════════════"
# publish-dmg.sh already bumped the versions in lockstep above, so don't bump again here.
bash scripts/publish-npm.sh

# ── Versions (now bumped + published) ──────────────────────────
READER_VER=$(node -p "require('./apps/reader/package.json').version")
JDFJS_VER=$(node -p "require('./jdfjs/package.json').version")
JDFJS_NAME=$(node -p "require('./jdfjs/package.json').name")
CLI_VER=$(node -p "require('./tools/jdf-cli/package.json').version")
CLI_NAME=$(node -p "require('./tools/jdf-cli/package.json').name")
TAG="v$READER_VER"

# ── Update the CLI Homebrew Formula + mirror to the tap ────────────────────
# Formula/jdf-cli.rb is the canonical CLI recipe (Cask = the .app, Formula =
# the CLI binary). It points at the npm tarball we JUST published, so this must
# run after `publish-npm.sh`. We fetch the published tarball, hash it, sed the
# new version/url/sha256 in, then mirror the file into the tap so
# `brew install uurtech/jdf/jdf-cli` resolves the new version.
echo ""
echo "→ Updating CLI Homebrew Formula (Formula/jdf-cli.rb)"
CLI_TARBALL_URL="https://registry.npmjs.org/${CLI_NAME}/-/jdf-cli-${CLI_VER}.tgz"
CLI_TARBALL_TMP="$(mktemp)"
curl -sL "$CLI_TARBALL_URL" -o "$CLI_TARBALL_TMP"
CLI_SHA256=$(shasum -a 256 "$CLI_TARBALL_TMP" | awk '{print $1}')
rm -f "$CLI_TARBALL_TMP"
FORMULA_PATH="$REPO_ROOT/Formula/jdf-cli.rb"
if [[ -f "$FORMULA_PATH" ]]; then
  sed -i.bak -E "s|^  url \".*\"|  url \"$CLI_TARBALL_URL\"|" "$FORMULA_PATH"
  sed -i.bak -E "s|^  version \"[^\"]+\"|  version \"$CLI_VER\"|" "$FORMULA_PATH"
  sed -i.bak -E "s|^  sha256 \"[a-f0-9]+\"|  sha256 \"$CLI_SHA256\"|" "$FORMULA_PATH"
  rm -f "$FORMULA_PATH.bak"
  echo "  ✓ Formula updated → $CLI_VER (sha256 $CLI_SHA256)"
  # Mirror into the tap repo (cloned by publish-dmg.sh into ../homebrew-jdf).
  TAP_REPO_LOCAL="$REPO_ROOT/../homebrew-jdf"
  if [[ -d "$TAP_REPO_LOCAL/.git" ]]; then
    mkdir -p "$TAP_REPO_LOCAL/Formula"
    cp "$FORMULA_PATH" "$TAP_REPO_LOCAL/Formula/jdf-cli.rb"
    (
      cd "$TAP_REPO_LOCAL"
      git add Formula/jdf-cli.rb
      if ! git diff --cached --quiet; then
        git commit -m "Bump jdf-cli to $CLI_VER" >/dev/null
        git push
        echo "  ✓ Tap Formula pushed"
      else
        echo "  (tap Formula already up to date)"
      fi
    )
  else
    echo "  ⚠  tap repo not found at $TAP_REPO_LOCAL — skipping Formula mirror"
  fi
else
  echo "  ⚠  $FORMULA_PATH missing — skipping Formula update"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Step 3/4: Refresh docs/jdfjs-local + pinned version refs"
echo "═══════════════════════════════════════════════════════════"

# 3a. Mirror the just-built jdfjs bundle into the docs site so the landing
# always demos the version that was just shipped.
if [[ -f "$REPO_ROOT/jdfjs/dist/jdfjs.js" && -f "$REPO_ROOT/jdfjs/dist/jdfjs.css" ]]; then
  mkdir -p "$REPO_ROOT/docs/jdfjs-local"
  cp "$REPO_ROOT/jdfjs/dist/jdfjs.js"  "$REPO_ROOT/docs/jdfjs-local/jdfjs.js"
  cp "$REPO_ROOT/jdfjs/dist/jdfjs.css" "$REPO_ROOT/docs/jdfjs-local/jdfjs.css"
  echo "→ Mirrored jdfjs/dist → docs/jdfjs-local/"
else
  echo "⚠  jdfjs/dist not present — skipping docs/jdfjs-local refresh"
fi

# 3b. Rewrite pinned `@uurtech/jdf@<ver>` references everywhere they appear in
# docs/index.html and README.md so curl-from-CDN snippets don't lag the release.
PINNED_FILES=(
  "$REPO_ROOT/README.md"
  "$REPO_ROOT/docs/index.html"
)
for f in "${PINNED_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    # Replace any `@uurtech/jdf@<semver>` or `@uurtech/jdf-cli@<semver>` with the new versions.
    sed -i.bak -E "s|@uurtech/jdf@[0-9]+\.[0-9]+\.[0-9]+|@uurtech/jdf@${JDFJS_VER}|g" "$f"
    sed -i.bak -E "s|@uurtech/jdf-cli@[0-9]+\.[0-9]+\.[0-9]+|@uurtech/jdf-cli@${CLI_VER}|g" "$f"
    rm -f "$f.bak"
    echo "→ Rewrote pinned versions in $(basename "$f")"
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "Step 4/4: Commit + tag + push the source repo"
echo "═══════════════════════════════════════════════════════════"

# Stage every file that release steps may have touched.
git add \
  apps/reader/package.json \
  apps/reader/src-tauri/Cargo.toml \
  apps/reader/src-tauri/tauri.conf.json \
  jdfjs/package.json \
  tools/jdf-cli/package.json \
  Casks/jdf.rb \
  Formula/jdf-cli.rb \
  docs/jdfjs-local/jdfjs.js \
  docs/jdfjs-local/jdfjs.css \
  docs/index.html \
  README.md \
  2>/dev/null || true

if git diff --cached --quiet; then
  echo "→ No source-repo changes to commit (already in sync)."
else
  git commit -m "release: $TAG"
  echo "  ✓ Commit created"
fi

# Recreate the local tag (delete-and-recreate to handle re-runs at same version).
git tag -d "$TAG" >/dev/null 2>&1 || true
git tag "$TAG"

# Push branch + tag (force-pushing only the tag, never the branch).
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$CURRENT_BRANCH"
git push origin "$TAG" --force
echo "  ✓ Branch + tag $TAG pushed"

echo ""
echo "✓ Release complete."
echo "  Desktop: $TAG  https://github.com/uurtech/jdf/releases/tag/$TAG"
echo "  Brew:    brew upgrade --cask jdf"
echo "  Web:     npm install $JDFJS_NAME@$JDFJS_VER"
echo "  CDN:     https://unpkg.com/$JDFJS_NAME@$JDFJS_VER/dist/jdfjs.js"
echo "  CLI:     npx $CLI_NAME@$CLI_VER validate file.jdf"
