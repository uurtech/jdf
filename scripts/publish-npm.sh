#!/usr/bin/env bash
# Publish npm packages from this repo using NPM_TOKEN from /.env (no `npm login` needed).
#
# Packages:
#   - jdfjs/        → @uurtech/jdf
#   - tools/jdf-cli → @uurtech/jdf-cli
#
# Usage (from anywhere):
#   bash scripts/publish-npm.sh                 # publish both at current versions
#   bash scripts/publish-npm.sh patch           # bump patch on both, then publish
#   bash scripts/publish-npm.sh minor           # bump minor on both, then publish
#   bash scripts/publish-npm.sh major           # bump major on both, then publish
#   bash scripts/publish-npm.sh patch jdfjs     # bump+publish only jdfjs
#   bash scripts/publish-npm.sh patch cli       # bump+publish only @uurtech/jdf-cli
#   bash scripts/publish-npm.sh -- jdfjs        # publish jdfjs at its current version
#   bash scripts/publish-npm.sh -- cli          # publish cli at its current version

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- args -----------------------------------------------------------------
BUMP=""
TARGET="all"

case "${1:-}" in
  patch|minor|major)
    BUMP="$1"
    shift || true
    ;;
  --)
    shift || true
    ;;
esac

case "${1:-}" in
  jdfjs|cli|all)
    TARGET="$1"
    ;;
  "")
    ;;
  *)
    echo "✗ Unknown target: $1"
    echo "  Usage: bash scripts/publish-npm.sh [patch|minor|major] [jdfjs|cli|all]"
    exit 1
    ;;
esac

# --- env ------------------------------------------------------------------
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

# --- helpers --------------------------------------------------------------
publish_pkg() {
  local dir="$1"
  local label="$2"

  pushd "$REPO_ROOT/$dir" > /dev/null

  if [[ -n "$BUMP" ]]; then
    npm version "$BUMP" --no-git-tag-version
  fi

  # Temporary .npmrc with the token; cleaned up on exit from this fn.
  local npmrc_backup=""
  if [[ -f .npmrc ]]; then
    npmrc_backup=$(mktemp)
    cp .npmrc "$npmrc_backup"
  fi
  trap '[[ -n "$npmrc_backup" ]] && cp "$npmrc_backup" .npmrc && rm -f "$npmrc_backup" || rm -f .npmrc' RETURN

  cat > .npmrc <<EOF
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
registry=https://registry.npmjs.org/
always-auth=true
EOF

  local pkg_name pkg_ver
  pkg_name=$(node -p "require('./package.json').name")
  pkg_ver=$(node -p "require('./package.json').version")

  echo "→ Building $pkg_name@$pkg_ver ($label)..."
  pnpm build

  echo "→ Publishing $pkg_name@$pkg_ver to npm..."
  # `npm publish` directly — pnpm publish has a code path that 404s on first publish.
  npm publish --access public

  echo ""
  echo "✓ Published $pkg_name@$pkg_ver"
  if [[ "$pkg_name" == "@uurtech/jdf" ]]; then
    echo "  CDN: https://unpkg.com/$pkg_name@$pkg_ver/dist/jdfjs.js"
    echo "       (~30s for unpkg propagation)"
  else
    echo "  Try: npx $pkg_name@$pkg_ver --help"
  fi
  echo ""

  popd > /dev/null
}

# --- run ------------------------------------------------------------------
if [[ "$TARGET" == "all" || "$TARGET" == "jdfjs" ]]; then
  publish_pkg "jdfjs" "web embed library"
fi

if [[ "$TARGET" == "all" || "$TARGET" == "cli" ]]; then
  publish_pkg "tools/jdf-cli" "command-line tool"
fi
