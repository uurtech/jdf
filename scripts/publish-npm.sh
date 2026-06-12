#!/usr/bin/env bash
# Publish jdfjs to npm using NPM_TOKEN from /.env (no `npm login` needed).
#
# Usage (from anywhere):
#   bash scripts/publish-npm.sh           # publish current version
#   bash scripts/publish-npm.sh patch     # bump patch then publish
#   bash scripts/publish-npm.sh minor     # bump minor then publish
#   bash scripts/publish-npm.sh major     # bump major then publish

set -euo pipefail

# Resolve repo root (scripts/.. → /)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT/jdfjs"

# Load tokens from repo-root .env
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

if [[ -z "${NPM_TOKEN:-}" ]]; then
  echo "✗ NPM_TOKEN missing — fill it in /.env (see /.env.example)"
  exit 1
fi

if [[ "${1:-}" =~ ^(patch|minor|major)$ ]]; then
  npm version "$1" --no-git-tag-version
fi

# Temporary .npmrc with the token; cleaned up on exit.
NPMRC_BACKUP=""
if [[ -f .npmrc ]]; then
  NPMRC_BACKUP=$(mktemp)
  cp .npmrc "$NPMRC_BACKUP"
fi
cleanup() {
  if [[ -n "$NPMRC_BACKUP" ]]; then
    cp "$NPMRC_BACKUP" .npmrc
    rm -f "$NPMRC_BACKUP"
  else
    rm -f .npmrc
  fi
}
trap cleanup EXIT

cat > .npmrc <<EOF
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
registry=https://registry.npmjs.org/
always-auth=true
EOF

PKG_NAME=$(node -p "require('./package.json').name")
PKG_VER=$(node -p "require('./package.json').version")

echo "→ Building $PKG_NAME@$PKG_VER..."
pnpm build

echo "→ Publishing to npm..."
# Use npm CLI directly — pnpm publish has a code path that 404s on first publish.
npm publish --access public

echo ""
echo "✓ Published $PKG_NAME@$PKG_VER"
echo "  CDN: https://unpkg.com/$PKG_NAME@$PKG_VER/dist/jdfjs.js"
echo "       (~30s for unpkg propagation)"
