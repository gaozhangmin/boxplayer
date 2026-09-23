#!/bin/bash
# Bundle boxplayer-mpv-texture.node + libmpv.dylib + transitive dylib deps
# into BoxPlayer's static macOS engine directory.
#
# This script is intentionally manual. It does not download anything.
# It expects a local libmpv installation, usually from Homebrew.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$PACKAGE_DIR/../.." && pwd)"
ARCH="${ARCH:-$(uname -m)}"
BUILD_DIR="${BUILD_DIR:-$PACKAGE_DIR/build/Release}"
OUTPUT_DIR="${OUTPUT_DIR:-$REPO_DIR/static/engine/darwin/$ARCH/mpv-texture}"
NODE_FILE="${NODE_FILE:-$BUILD_DIR/mpv_texture.node}"

if [ "$ARCH" = "aarch64" ]; then
  ARCH="arm64"
fi

if [ ! -f "$NODE_FILE" ]; then
  echo "[bundle] missing native addon: $NODE_FILE" >&2
  echo "[bundle] run: cd native/boxplayer-mpv-texture && pnpm install && pnpm run build" >&2
  exit 1
fi

if command -v brew >/dev/null 2>&1; then
  HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-$(brew --prefix)}"
else
  HOMEBREW_PREFIX="${HOMEBREW_PREFIX:-/opt/homebrew}"
fi

LIBMPV_SOURCE="${LIBMPV_SOURCE:-}"
if [ -z "$LIBMPV_SOURCE" ]; then
  for candidate in \
    "$PACKAGE_DIR/deps/mpv/macos/$ARCH/libmpv.dylib" \
    "$PACKAGE_DIR/deps/mpv/macos/libmpv.dylib" \
    "$HOMEBREW_PREFIX/opt/mpv/lib/libmpv.dylib" \
    "$HOMEBREW_PREFIX/lib/libmpv.dylib" \
    "/usr/local/opt/mpv/lib/libmpv.dylib" \
    "/usr/local/lib/libmpv.dylib"; do
    if [ -f "$candidate" ]; then
      LIBMPV_SOURCE="$candidate"
      break
    fi
  done
fi

if [ -z "$LIBMPV_SOURCE" ] || [ ! -f "$LIBMPV_SOURCE" ]; then
  echo "[bundle] libmpv.dylib not found. Set LIBMPV_SOURCE=/path/to/libmpv.dylib" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
cp "$NODE_FILE" "$OUTPUT_DIR/mpv_texture.node"
cp "$NODE_FILE" "$OUTPUT_DIR/boxplayer-mpv-texture.node"
cp "$LIBMPV_SOURCE" "$OUTPUT_DIR/libmpv.dylib"
chmod 755 "$OUTPUT_DIR/mpv_texture.node" "$OUTPUT_DIR/boxplayer-mpv-texture.node" "$OUTPUT_DIR/libmpv.dylib"

BREW_LIB_DIRS=""
if [ -d "$HOMEBREW_PREFIX/opt" ]; then
  BREW_LIB_DIRS="$(find "$HOMEBREW_PREFIX/opt" -maxdepth 3 -type d -name lib 2>/dev/null | tr '\n' ':')"
fi
BREW_LIB_DIRS="${PACKAGE_DIR}/deps/mpv/macos/$ARCH:${PACKAGE_DIR}/deps/mpv/macos:${BREW_LIB_DIRS}${HOMEBREW_PREFIX}/lib:/usr/local/lib"

resolve_dep() {
  dep="$1"
  case "$dep" in
    /usr/lib/*|/System/*) return 1 ;;
    @rpath/*|@loader_path/*)
      libname="${dep##*/}"
      IFS=':' read -r -a dirs <<< "$BREW_LIB_DIRS"
      for dir in "${dirs[@]}"; do
        if [ -f "$dir/$libname" ]; then
          python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$dir/$libname"
          return 0
        fi
      done
      return 1
      ;;
    "$HOMEBREW_PREFIX"*|/usr/local/*)
      if [ -f "$dep" ]; then
        python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "$dep"
        return 0
      fi
      return 1
      ;;
  esac
  return 1
}

rewrite_to_loader_path() {
  target="$1"
  dep="$2"
  dep_name="$(basename "$dep")"
  install_name_tool -change "$dep" "@loader_path/$dep_name" "$target" 2>/dev/null || true
}

install_name_tool -id "@loader_path/libmpv.dylib" "$OUTPUT_DIR/libmpv.dylib" 2>/dev/null || true
install_name_tool -change "@rpath/libmpv.dylib" "@loader_path/libmpv.dylib" "$OUTPUT_DIR/mpv_texture.node" 2>/dev/null || true
install_name_tool -change "$LIBMPV_SOURCE" "@loader_path/libmpv.dylib" "$OUTPUT_DIR/mpv_texture.node" 2>/dev/null || true
install_name_tool -change "@rpath/libmpv.dylib" "@loader_path/libmpv.dylib" "$OUTPUT_DIR/boxplayer-mpv-texture.node" 2>/dev/null || true
install_name_tool -change "$LIBMPV_SOURCE" "@loader_path/libmpv.dylib" "$OUTPUT_DIR/boxplayer-mpv-texture.node" 2>/dev/null || true
otool -L "$OUTPUT_DIR/mpv_texture.node" | tail -n +2 | awk '{print $1}' | while read -r dep; do
  case "$(basename "$dep")" in
    libmpv*.dylib)
      install_name_tool -change "$dep" "@loader_path/libmpv.dylib" "$OUTPUT_DIR/mpv_texture.node" 2>/dev/null || true
      install_name_tool -change "$dep" "@loader_path/libmpv.dylib" "$OUTPUT_DIR/boxplayer-mpv-texture.node" 2>/dev/null || true
      ;;
  esac
done

QUEUE_FILE="$(mktemp)"
DONE_DIR="$(mktemp -d)"
trap 'rm -f "$QUEUE_FILE"; rm -rf "$DONE_DIR"' EXIT

echo "$OUTPUT_DIR/libmpv.dylib" > "$QUEUE_FILE"

while [ -s "$QUEUE_FILE" ]; do
  current="$(head -n 1 "$QUEUE_FILE")"
  tail -n +2 "$QUEUE_FILE" > "$QUEUE_FILE.tmp" && mv "$QUEUE_FILE.tmp" "$QUEUE_FILE"
  base="$(basename "$current")"
  if [ -f "$DONE_DIR/$base" ]; then
    continue
  fi
  touch "$DONE_DIR/$base"

  otool -L "$current" | tail -n +2 | awk '{print $1}' | while read -r dep; do
    case "$dep" in
      /usr/lib/*|/System/*) continue ;;
    esac
    dep_base="$(basename "$dep")"
    case "$dep_base" in
      Python|Python3) continue ;;
    esac
    resolved="$(resolve_dep "$dep" || true)"
    if [ -z "$resolved" ] || [ ! -f "$resolved" ]; then
      echo "[bundle] unresolved dependency: $dep" >&2
      continue
    fi
    if [ ! -f "$OUTPUT_DIR/$dep_base" ]; then
      cp "$resolved" "$OUTPUT_DIR/$dep_base"
      chmod 755 "$OUTPUT_DIR/$dep_base"
      install_name_tool -id "@loader_path/$dep_base" "$OUTPUT_DIR/$dep_base" 2>/dev/null || true
      echo "$OUTPUT_DIR/$dep_base" >> "$QUEUE_FILE"
      echo "[bundle] + $dep_base"
    fi
    rewrite_to_loader_path "$current" "$dep"
  done
done

find "$OUTPUT_DIR" -maxdepth 1 \( -name "*.dylib" -o -name "*.node" \) -print0 | xargs -0 codesign --force --sign - 2>/dev/null || true

MANIFEST="$OUTPUT_DIR/mpv-bundle-manifest.json"
python3 "$SCRIPT_DIR/write-bundle-manifest.py" "$OUTPUT_DIR" "$MANIFEST" "$ARCH" "$LIBMPV_SOURCE"

echo "[bundle] output: $OUTPUT_DIR"
echo "[bundle] manifest: $MANIFEST"
otool -L "$OUTPUT_DIR/mpv_texture.node" | head -n 12
