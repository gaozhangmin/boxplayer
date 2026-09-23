#!/bin/bash
# Build an architecture-matched libmpv SDK from the official mpv source tree.
# Prerequisites: Xcode command-line tools, Meson, Ninja, pkg-config, and the
# development libraries required by mpv (FFmpeg, libass, libplacebo, etc.).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) TARGET_ARCH=x64 ;;
  arm64) TARGET_ARCH=arm64 ;;
  *) echo "Unsupported macOS architecture: $ARCH" >&2; exit 1 ;;
esac

MPV_TAG="v0.41.0"
MPV_ARCHIVE_SHA256="ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209"
BUILD_ROOT="${MPV_BUILD_ROOT:-$PACKAGE_DIR/.mpv-source/$TARGET_ARCH}"
SOURCE_DIR="$BUILD_ROOT/mpv"
ARCHIVE_FILE="$BUILD_ROOT/mpv-$MPV_TAG.tar.gz"
BUILD_DIR="$BUILD_ROOT/meson-build"
PREFIX="$BUILD_ROOT/install"
SDK_DIR="$PACKAGE_DIR/deps/mpv/macos/$TARGET_ARCH"

for program in curl shasum tar meson ninja pkg-config clang; do
  command -v "$program" >/dev/null || { echo "Missing build tool: $program" >&2; exit 1; }
done

mkdir -p "$BUILD_ROOT" "$SDK_DIR" "$PACKAGE_DIR/deps/mpv/include/mpv"
export CLANG_MODULE_CACHE_PATH="$BUILD_ROOT/clang-module-cache"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-10.15}"
mkdir -p "$CLANG_MODULE_CACHE_PATH"
if [ ! -d "$SOURCE_DIR" ]; then
  if [ ! -f "$ARCHIVE_FILE" ]; then
    curl --noproxy '*' -L --fail --silent --show-error \
      "https://codeload.github.com/mpv-player/mpv/tar.gz/refs/tags/$MPV_TAG" \
      -o "$ARCHIVE_FILE"
  fi
  ACTUAL_SHA256="$(shasum -a 256 "$ARCHIVE_FILE" | cut -d ' ' -f 1)"
  if [ "$ACTUAL_SHA256" != "$MPV_ARCHIVE_SHA256" ]; then
    echo "Official mpv archive checksum mismatch: $ACTUAL_SHA256" >&2
    exit 1
  fi
  tar -xzf "$ARCHIVE_FILE" -C "$BUILD_ROOT"
  mv "$BUILD_ROOT/mpv-0.41.0" "$SOURCE_DIR"
fi
ACTUAL_VERSION="$(head -n 1 "$SOURCE_DIR/MPV_VERSION" 2>/dev/null || true)"
if [ "$ACTUAL_VERSION" != "${MPV_TAG#v}" ]; then
  echo "Source version is $ACTUAL_VERSION, expected $MPV_TAG. Use another MPV_BUILD_ROOT." >&2
  exit 1
fi

if [ ! -f "$BUILD_DIR/build.ninja" ]; then
  meson setup "$BUILD_DIR" "$SOURCE_DIR" \
    --prefix "$PREFIX" \
    -Dlibmpv=true -Dcplayer=false -Ddefault_library=shared -Dgpl=false
fi
meson compile -C "$BUILD_DIR" -j 4
meson install -C "$BUILD_DIR"

LIBMPV_FILE="$(find "$PREFIX/lib" -name libmpv.dylib -print -quit)"
if [ -z "$LIBMPV_FILE" ]; then
  echo "mpv built without an installed libmpv.dylib; inspect $BUILD_DIR/meson-logs" >&2
  exit 1
fi
if ! lipo -archs "$LIBMPV_FILE" | tr ' ' '\n' | grep -qx "$ARCH"; then
  echo "libmpv architecture does not match $ARCH: $LIBMPV_FILE" >&2
  exit 1
fi

cp "$PREFIX/include/mpv/"*.h "$PACKAGE_DIR/deps/mpv/include/mpv/"
cp -L "$LIBMPV_FILE" "$SDK_DIR/libmpv.dylib"
install_name_tool -id '@rpath/libmpv.dylib' "$SDK_DIR/libmpv.dylib"
codesign --force --sign - "$SDK_DIR/libmpv.dylib"
echo "Staged official mpv $MPV_TAG SDK: $SDK_DIR/libmpv.dylib"
echo "Next: pnpm --dir native/boxplayer-mpv-texture run build:libmpv"
