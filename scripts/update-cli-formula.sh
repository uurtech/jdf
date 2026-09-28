#!/usr/bin/env bash
# Update Formula/jdf-cli.rb (repo + tap) to the npm tarball of the CLI version in
# tools/jdf-cli/package.json. Used when release.sh could not fetch the tarball yet
# (the registry serves fresh scoped tarballs with a delay). Waits up to 30 min.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$REPO_ROOT"
CLI_NAME=$(node -p "require('./tools/jdf-cli/package.json').name")
CLI_VER=$(node -p "require('./tools/jdf-cli/package.json').version")
URL="https://registry.npmjs.org/${CLI_NAME}/-/jdf-cli-${CLI_VER}.tgz"
TMP="$(mktemp)"
for i in $(seq 1 60); do
  curl -sL "$URL" -o "$TMP"
  if file "$TMP" | grep -q gzip; then break; fi
  echo "  … $URL not served yet (attempt $i/60), retrying in 30 s"; sleep 30
done
file "$TMP" | grep -q gzip || { echo "✗ tarball still not available"; exit 1; }
SHA=$(shasum -a 256 "$TMP" | awk '{print $1}'); rm -f "$TMP"
sed -i.bak -E "s|^  url \".*\"|  url \"$URL\"|; s|^  version \"[^\"]+\"|  version \"$CLI_VER\"|; s|^  sha256 \"[a-f0-9]+\"|  sha256 \"$SHA\"|" Formula/jdf-cli.rb; rm -f Formula/jdf-cli.rb.bak
echo "✓ Formula → $CLI_VER ($SHA)"
TAP="$REPO_ROOT/../homebrew-jdf"
if [[ -d "$TAP/.git" ]]; then cp Formula/jdf-cli.rb "$TAP/Formula/jdf-cli.rb"; (cd "$TAP" && git add Formula/jdf-cli.rb && git commit -qm "Bump jdf-cli to $CLI_VER" && git push && echo "✓ tap pushed"); fi
git add Formula/jdf-cli.rb && git commit -qm "formula: jdf-cli $CLI_VER" && git push origin "$(git rev-parse --abbrev-ref HEAD)" && echo "✓ repo pushed"
