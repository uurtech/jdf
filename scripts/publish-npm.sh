#!/usr/bin/env bash
# Publish jdfjs to npm using the token from .env (no `npm login` needed).
#
# Usage:
#   cd jdfjs
#   bash scripts/publish.sh           # publish current version
#   bash scripts/publish.sh patch     # bump patch, then publish
#   bash scripts/publish.sh minor     # bump minor, then publish
#   bash scripts/publish.sh major     # bump major, then publish

set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env from jdfjs/.env or repo root .env
set -a
# shellcheck disable=SC1091
[[ -f .env ]] && source .env
# shellcheck disable=SC1091
[[ -f ../.env ]] && source ../.env
set +a

if [[ -z "${NPM_TOKEN:-}" ]]; then
  echo "✗ NPM_TOKEN is not set."
  echo "  Copy .env.example to .env and add your token from https://www.npmjs.com/settings/~/tokens"
  exit 1
fi

# Optional version bump
if [[ "${1:-}" =~ ^(patch|minor|major)$ ]]; then
  npm version "$1" --no-git-tag-version
fi

# Write a temporary .npmrc that uses the token, then clean up on exit.
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

echo "→ Building..."
pnpm build

echo "→ Publishing $(node -p "require('./package.json').name")@$(node -p "require('./package.json').version")"
pnpm publish --access public --no-git-checks

echo ""
echo "✓ Published. CDN propagation takes ~30s."
echo "  Check: curl -sI https://unpkg.com/$(node -p "require('./package.json').name")/dist/jdfjs.css"
