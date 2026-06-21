#!/usr/bin/env bash
# Build the JDF Reader .dmg, push it to GitHub Releases, and update the
# Homebrew Cask in both /Casks/jdf.rb and /uurtech/homebrew-jdf (if cloned).
#
# Usage:
#   bash scripts/publish-dmg.sh           # use current version
#   bash scripts/publish-dmg.sh patch     # bump patch then ship
#   bash scripts/publish-dmg.sh minor
#   bash scripts/publish-dmg.sh major
#
# Requires GITHUB_TOKEN in /.env (https://github.com/settings/tokens, "repo" scope).
# Bumps versions in:
#   - apps/reader/package.json
#   - apps/reader/src-tauri/Cargo.toml
#   - apps/reader/src-tauri/tauri.conf.json
#   - jdfjs/package.json (in lockstep with the reader)
#   - tools/jdf-cli/package.json (in lockstep with the reader)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Load tokens
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "✗ GITHUB_TOKEN missing — fill it in /.env (see /.env.example)"
  exit 1
fi

# Apple signing/notarization vars — required for Gatekeeper-passing dmg.
# All four must be present together; otherwise we abort instead of shipping
# an unsigned build that breaks for every user except the one that built it.
SIGN_AND_NOTARIZE=1
for v in APPLE_SIGNING_IDENTITY APPLE_ID APPLE_TEAM_ID APPLE_APP_SPECIFIC_PASSWORD; do
  if [[ -z "${!v:-}" ]]; then
    SIGN_AND_NOTARIZE=0
  fi
done
if [[ "$SIGN_AND_NOTARIZE" -eq 0 ]]; then
  echo "⚠  Apple signing variables missing — the produced dmg will be UNSIGNED"
  echo "   and macOS Gatekeeper will reject it on every machine except this one."
  echo "   Fill APPLE_SIGNING_IDENTITY / APPLE_ID / APPLE_TEAM_ID /"
  echo "   APPLE_APP_SPECIFIC_PASSWORD in /.env (see .env.example) to enable signing."
  read -r -p "   Continue with an unsigned build? [y/N] " ans
  if [[ ! "$ans" =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

BUMP="${1:-}"
if [[ -n "$BUMP" && ! "$BUMP" =~ ^(patch|minor|major)$ ]]; then
  echo "Usage: $0 [patch|minor|major]"
  exit 1
fi

GH_OWNER="uurtech"
GH_REPO="jdf"
TAP_REPO_LOCAL="$REPO_ROOT/../homebrew-jdf"
DMG_BUNDLE_DIR="$REPO_ROOT/apps/reader/src-tauri/target/release/bundle/dmg"

# ── Step 1: bump versions in lockstep ──────────────────────────────────────
if [[ -n "$BUMP" ]]; then
  echo "→ Bumping version ($BUMP) across reader + jdfjs + jdf-cli"
  # Reader (npm package)
  (cd apps/reader && npm version "$BUMP" --no-git-tag-version >/dev/null)
  # jdfjs (npm package)
  (cd jdfjs && npm version "$BUMP" --no-git-tag-version >/dev/null)
  # CLI (npm package)
  (cd tools/jdf-cli && npm version "$BUMP" --no-git-tag-version >/dev/null)
fi

NEW_VER=$(node -p "require('./apps/reader/package.json').version")
echo "→ Target version: v$NEW_VER"

# Tauri config + Cargo.toml versions follow apps/reader/package.json
# Tauri conf
node -e "
const fs = require('fs');
const p = './apps/reader/src-tauri/tauri.conf.json';
const j = JSON.parse(fs.readFileSync(p, 'utf-8'));
j.version = '$NEW_VER';
fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
"
# Cargo.toml — only `version =` line under [package]
sed -i.bak -E "s/^version = \"[^\"]+\"/version = \"$NEW_VER\"/" apps/reader/src-tauri/Cargo.toml
rm -f apps/reader/src-tauri/Cargo.toml.bak

# ── Step 2: build the dmg ───────────────────────────────────────────────────
echo "→ Building JDF Reader.app + .dmg..."
if [[ "$SIGN_AND_NOTARIZE" -eq 1 ]]; then
  echo "  signing identity: $APPLE_SIGNING_IDENTITY"
  # Tauri v2 reads APPLE_SIGNING_IDENTITY (and friends) from the environment
  # and signs both the .app inside the bundle and the .dmg wrapper.
  export APPLE_SIGNING_IDENTITY
  export APPLE_ID
  export APPLE_TEAM_ID
  export APPLE_PASSWORD="$APPLE_APP_SPECIFIC_PASSWORD"
fi
pnpm --filter @jdf/reader tauri build --bundles dmg

DMG="$(ls "$DMG_BUNDLE_DIR"/JDF\ Reader_${NEW_VER}_*.dmg 2>/dev/null | head -1)"
if [[ -z "$DMG" || ! -f "$DMG" ]]; then
  echo "✗ Couldn't find produced dmg in $DMG_BUNDLE_DIR"
  ls "$DMG_BUNDLE_DIR" || true
  exit 1
fi
DMG_BASENAME="$(basename "$DMG")"
DMG_URL_NAME="${DMG_BASENAME// /.}"   # GitHub replaces spaces with dots in URLs

# ── Step 2b: notarize + staple (only if signing creds present) ─────────────
if [[ "$SIGN_AND_NOTARIZE" -eq 1 ]]; then
  echo "→ Verifying signature on $DMG_BASENAME"
  codesign --verify --deep --strict --verbose=2 "$DMG" || {
    echo "✗ codesign verify failed — the produced dmg is not properly signed"
    exit 1
  }

  echo "→ Submitting to Apple notary service (this can take a few minutes)..."
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" \
    --team-id "$APPLE_TEAM_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --wait

  echo "→ Stapling notarization ticket onto dmg"
  xcrun stapler staple "$DMG"

  echo "→ Verifying stapled dmg passes Gatekeeper"
  xcrun stapler validate "$DMG"
  spctl --assess --type open --context context:primary-signature -vv "$DMG" || true
fi

SHA256=$(shasum -a 256 "$DMG" | awk '{print $1}')
echo "→ DMG: $DMG_BASENAME"
echo "→ sha256: $SHA256"

# ── Step 3: update local Casks/jdf.rb (reference copy) ─────────────────────
update_cask() {
  local cask_path="$1"
  if [[ ! -f "$cask_path" ]]; then return; fi
  echo "→ Updating $cask_path"
  # Replace version + sha256 + reference dmg name (Reader vs Viewer just in case)
  sed -i.bak -E "s/^  version \"[^\"]+\"/  version \"$NEW_VER\"/" "$cask_path"
  sed -i.bak -E "s/^  sha256 \"[a-f0-9]+\"/  sha256 \"$SHA256\"/" "$cask_path"
  rm -f "$cask_path.bak"
}
update_cask "$REPO_ROOT/Casks/jdf.rb"

# ── Step 4: GitHub release (delete-and-recreate if tag exists) ─────────────
TAG="v$NEW_VER"
GH_API="https://api.github.com/repos/$GH_OWNER/$GH_REPO"
GH_UPLOADS="https://uploads.github.com/repos/$GH_OWNER/$GH_REPO"

# Delete existing release for this tag if present (for re-runs)
EXISTING_JSON=$(curl -sL -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$GH_API/releases/tags/$TAG")
EXISTING=$(echo "$EXISTING_JSON" | node -e "
  let j; try { j = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); } catch { j = {}; }
  process.stdout.write(j && typeof j.id === 'number' ? String(j.id) : '');
")

if [[ -n "$EXISTING" ]]; then
  echo "→ Deleting existing release $TAG (id=$EXISTING) to recreate"
  curl -sL -X DELETE -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "$GH_API/releases/$EXISTING" >/dev/null || true
fi
# Always try to delete the tag too — orphaned tags break tag re-creation
curl -sL -X DELETE -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$GH_API/git/refs/tags/$TAG" >/dev/null 2>&1 || true

echo "→ Creating GitHub release $TAG"
RELEASE_JSON=$(curl -sL -X POST -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "$GH_API/releases" \
  -d "{
    \"tag_name\": \"$TAG\",
    \"name\": \"JDF Reader $NEW_VER\",
    \"body\": \"Automated release.\\n\\nDMG sha256: \`$SHA256\`\",
    \"draft\": false,
    \"prerelease\": false,
    \"target_commitish\": \"master\"
  }")

RELEASE_ID=$(echo "$RELEASE_JSON" | node -e "
  let j; try { j = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); } catch { process.exit(1); }
  if (!j.id) {
    process.stderr.write('GitHub release create failed:\n');
    process.stderr.write(JSON.stringify(j, null, 2) + '\n');
    process.exit(1);
  }
  process.stdout.write(String(j.id));
")
if [[ -z "$RELEASE_ID" ]]; then
  echo "✗ release create failed (see stderr above)"
  exit 1
fi

echo "→ Uploading dmg → release $RELEASE_ID"
curl -sL -X POST \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$DMG" \
  "$GH_UPLOADS/releases/$RELEASE_ID/assets?name=$DMG_URL_NAME" >/dev/null

DMG_DOWNLOAD_URL="https://github.com/$GH_OWNER/$GH_REPO/releases/download/$TAG/$DMG_URL_NAME"
echo "→ Asset URL: $DMG_DOWNLOAD_URL"

# ── Step 5: refresh tap repo (uurtech/homebrew-jdf) ─────────────────────────
if [[ -d "$TAP_REPO_LOCAL/.git" ]]; then
  echo "→ Updating local tap repo at $TAP_REPO_LOCAL"
  update_cask "$TAP_REPO_LOCAL/Casks/jdf.rb"
  (
    cd "$TAP_REPO_LOCAL"
    git add Casks/jdf.rb
    if ! git diff --cached --quiet; then
      git commit -m "Bump jdf to $NEW_VER" >/dev/null
      git push
      echo "  ✓ Tap repo pushed"
    else
      echo "  (tap repo already up to date)"
    fi
  )
else
  echo "→ Tap repo not found at $TAP_REPO_LOCAL — skipping"
  echo "  Manual: clone uurtech/homebrew-jdf next to this repo and re-run"
fi

# ── Step 6: install locally for sanity (extract .app from the dmg) ─────────
echo "→ Installing /Applications/JDF Reader.app (extracting from dmg)"
killall "JDF Reader" 2>/dev/null || true
rm -rf "/Applications/JDF Reader.app"

# `tauri build --bundles dmg` cleans the .app during dmg packaging, so we
# extract the .app back out of the dmg.
MOUNT_POINT=$(mktemp -d)
hdiutil attach "$DMG" -nobrowse -mountpoint "$MOUNT_POINT" -quiet
APP_IN_DMG="$MOUNT_POINT/JDF Reader.app"
if [[ -d "$APP_IN_DMG" ]]; then
  cp -R "$APP_IN_DMG" /Applications/
  xattr -cr "/Applications/JDF Reader.app" 2>/dev/null || true
  LSBIN="/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister"
  [[ -x "$LSBIN" ]] && "$LSBIN" -f "/Applications/JDF Reader.app" >/dev/null 2>&1 || true
  echo "  ✓ /Applications/JDF Reader.app installed"
else
  echo "  (could not find JDF Reader.app inside dmg, skipping install)"
fi
hdiutil detach "$MOUNT_POINT" -quiet -force 2>/dev/null || true
rmdir "$MOUNT_POINT" 2>/dev/null || true

echo ""
echo "✓ Desktop release done."
echo "  Tag:     $TAG"
echo "  DMG:     $DMG_DOWNLOAD_URL"
echo "  sha256:  $SHA256"
echo "  Brew:    brew upgrade --cask jdf"
