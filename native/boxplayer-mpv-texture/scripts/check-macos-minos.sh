#!/bin/bash
# Fail if any bundled native binary requires a newer macOS than the declared
# minimum for the candidate package.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$PACKAGE_DIR/../.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
if [ "$ARCH" = "x86_64" ]; then ARCH=x64; fi
MAX_MACOS_MIN_VERSION="${MAX_MACOS_MIN_VERSION:-15.0}"
BUNDLE_DIR="${BUNDLE_DIR:-$REPO_DIR/static/engine/darwin/$ARCH/mpv-texture}"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "Missing macOS MPV bundle: $BUNDLE_DIR" >&2
  exit 1
fi

checked=0
for binary in "$BUNDLE_DIR"/*.dylib "$BUNDLE_DIR"/*.node; do
  [ -f "$binary" ] || continue
  minos="$(xcrun vtool -show-build "$binary" 2>/dev/null | awk '/minos/{print $2; exit}')"
  if [ -z "$minos" ]; then
    echo "Missing macOS minimum-version metadata: $binary" >&2
    exit 1
  fi
  if ! awk -v actual="$minos" -v allowed="$MAX_MACOS_MIN_VERSION" 'BEGIN {
    split(actual, a, "."); split(allowed, b, ".");
    for (i = 1; i <= 3; i++) {
      if ((a[i] + 0) > (b[i] + 0)) exit 1;
      if ((a[i] + 0) < (b[i] + 0)) exit 0;
    }
  }'; then
    echo "$(basename "$binary") requires macOS $minos (candidate limit: $MAX_MACOS_MIN_VERSION)" >&2
    exit 1
  fi
  checked=$((checked + 1))
done

if [ "$checked" -eq 0 ]; then
  echo "No native binaries found in $BUNDLE_DIR" >&2
  exit 1
fi
echo "macOS minimum-version check passed for $checked native binaries (limit $MAX_MACOS_MIN_VERSION)"
