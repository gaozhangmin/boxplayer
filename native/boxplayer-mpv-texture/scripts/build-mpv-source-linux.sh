#!/usr/bin/env bash
# Build an architecture-matched libmpv SDK from the official source archive.
set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -m)" in
  x86_64) TARGET_ARCH=x64 ;;
  aarch64) TARGET_ARCH=arm64 ;;
  *) echo "Unsupported Linux architecture: $(uname -m)" >&2; exit 1 ;;
esac

MPV_TAG=v0.41.0
MPV_ARCHIVE_SHA256=ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209
BUILD_ROOT="${MPV_BUILD_ROOT:-$PACKAGE_DIR/.mpv-source/$TARGET_ARCH}"
SOURCE_DIR="$BUILD_ROOT/mpv"
ARCHIVE_FILE="$BUILD_ROOT/mpv-$MPV_TAG.tar.gz"
BUILD_DIR="$BUILD_ROOT/meson-build"
PREFIX="$BUILD_ROOT/install"
SDK_DIR="$PACKAGE_DIR/deps/mpv/linux/$TARGET_ARCH"

for program in curl sha256sum tar meson ninja pkg-config cc readelf; do
  command -v "$program" >/dev/null || { echo "Missing build tool: $program" >&2; exit 1; }
done

mkdir -p "$BUILD_ROOT" "$SDK_DIR" "$PACKAGE_DIR/deps/mpv/include/mpv"
if [ ! -d "$SOURCE_DIR" ]; then
  if [ ! -f "$ARCHIVE_FILE" ]; then
    curl --fail --location --silent --show-error \
      "https://codeload.github.com/mpv-player/mpv/tar.gz/refs/tags/$MPV_TAG" \
      -o "$ARCHIVE_FILE"
  fi
  echo "$MPV_ARCHIVE_SHA256  $ARCHIVE_FILE" | sha256sum --check --status
  tar -xzf "$ARCHIVE_FILE" -C "$BUILD_ROOT"
  mv "$BUILD_ROOT/mpv-0.41.0" "$SOURCE_DIR"
fi
ACTUAL_VERSION="$(head -n 1 "$SOURCE_DIR/MPV_VERSION" 2>/dev/null || true)"
if [ "$ACTUAL_VERSION" != "${MPV_TAG#v}" ]; then
  echo "Source version is $ACTUAL_VERSION, expected $MPV_TAG" >&2
  exit 1
fi

if [ ! -f "$BUILD_DIR/build.ninja" ]; then
  meson setup "$BUILD_DIR" "$SOURCE_DIR" --prefix "$PREFIX" \
    -Dlibmpv=true -Dcplayer=false -Ddefault_library=shared -Dgpl=false
fi
meson compile -C "$BUILD_DIR" -j "${MPV_BUILD_JOBS:-4}"
meson install -C "$BUILD_DIR"

LIBMPV_FILE="$(find "$PREFIX" -type f -name 'libmpv.so.2*' -print -quit)"
if [ -z "$LIBMPV_FILE" ]; then
  echo "No installed libmpv.so.2 under $PREFIX" >&2
  exit 1
fi
EXPECTED_MACHINE='Advanced Micro Devices X86-64'
if [ "$TARGET_ARCH" = arm64 ]; then EXPECTED_MACHINE=AArch64; fi
readelf -h "$LIBMPV_FILE" | grep -Eq "Machine:[[:space:]]+$EXPECTED_MACHINE" || {
  echo "Wrong libmpv architecture: $LIBMPV_FILE" >&2; exit 1;
}
cp "$PREFIX/include/mpv/"*.h "$PACKAGE_DIR/deps/mpv/include/mpv/"
cp -L "$LIBMPV_FILE" "$SDK_DIR/libmpv.so.2"
ln -sfn libmpv.so.2 "$SDK_DIR/libmpv.so"
echo "Staged official mpv $MPV_TAG $TARGET_ARCH SDK at $SDK_DIR"
