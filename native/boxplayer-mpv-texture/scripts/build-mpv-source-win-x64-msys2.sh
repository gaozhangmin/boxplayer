#!/usr/bin/env bash
# Build official mpv v0.41.0 on native Windows x64 in an MSYS2 CLANG64 shell.
# The resulting DLL is NOT an MSYS2 mpv binary package; FFmpeg/libass/etc.
# come from MSYS2 and their non-system runtime DLLs are staged alongside it.
set -euo pipefail

if [[ "${MSYSTEM:-}" != CLANG64 || "$(uname -m)" != x86_64 ]]; then
  echo 'Run in an MSYS2 CLANG64 x64 shell.' >&2
  exit 1
fi

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MPV_TAG=v0.41.0
MPV_ARCHIVE_SHA256=ee21092a5ee427353392360929dc64645c54479aefdb5babc5cfbb5fad626209
BUILD_ROOT="${MPV_BUILD_ROOT:-$PACKAGE_DIR/.mpv-source/x64}"
SOURCE_DIR="$BUILD_ROOT/mpv"
ARCHIVE_FILE="$BUILD_ROOT/mpv-$MPV_TAG.tar.gz"
BUILD_DIR="$BUILD_ROOT/meson-build"
PREFIX="$BUILD_ROOT/install"
SDK_DIR="$PACKAGE_DIR/deps/mpv/win32/x64"

for program in curl sha256sum tar meson ninja pkg-config clang llvm-readobj llvm-dlltool awk; do
  command -v "$program" >/dev/null || { echo "Missing build tool: $program" >&2; exit 1; }
done
mkdir -p "$BUILD_ROOT" "$SDK_DIR" "$PACKAGE_DIR/deps/mpv/include/mpv"
if [[ ! -d "$SOURCE_DIR" ]]; then
  if [[ ! -f "$ARCHIVE_FILE" ]]; then
    curl --fail --location --silent --show-error \
      "https://codeload.github.com/mpv-player/mpv/tar.gz/refs/tags/$MPV_TAG" \
      -o "$ARCHIVE_FILE"
  fi
  echo "$MPV_ARCHIVE_SHA256  $ARCHIVE_FILE" | sha256sum --check --status
  tar -xzf "$ARCHIVE_FILE" -C "$BUILD_ROOT"
  mv "$BUILD_ROOT/mpv-0.41.0" "$SOURCE_DIR"
fi
ACTUAL_VERSION="$(head -n 1 "$SOURCE_DIR/MPV_VERSION" 2>/dev/null || true)"
if [[ "$ACTUAL_VERSION" != "${MPV_TAG#v}" ]]; then
  echo "Source version is $ACTUAL_VERSION, expected $MPV_TAG" >&2
  exit 1
fi

if [[ ! -f "$BUILD_DIR/build.ninja" ]]; then
  meson setup "$BUILD_DIR" "$SOURCE_DIR" --prefix "$PREFIX" \
    -Dlibmpv=true -Dcplayer=false -Ddefault_library=shared -Dgpl=false
fi
meson compile -C "$BUILD_DIR" -j "${MPV_BUILD_JOBS:-4}"
meson install -C "$BUILD_DIR"

LIBMPV_FILE="$(find "$PREFIX" -type f -iname 'libmpv-2.dll' -print -quit)"
if [[ -z "$LIBMPV_FILE" ]]; then
  echo "No installed libmpv-2.dll under $PREFIX" >&2
  exit 1
fi
cp "$LIBMPV_FILE" "$SDK_DIR/libmpv-2.dll"
cp "$PREFIX/include/mpv/"*.h "$PACKAGE_DIR/deps/mpv/include/mpv/"

# The MSVC node-gyp build uses the .def file to generate its own import lib.
# Only exported names are included; never derive symbols from a different DLL.
{ printf 'LIBRARY libmpv-2.dll\nEXPORTS\n';
  llvm-readobj --coff-exports "$LIBMPV_FILE" | awk '/^[[:space:]]*Name: / { print "  " $2 }';
} > "$SDK_DIR/libmpv-2.def"
if ! grep -q 'mpv_create' "$SDK_DIR/libmpv-2.def"; then
  echo 'Official libmpv DLL export table is missing mpv_create.' >&2
  exit 1
fi
llvm-dlltool -d "$SDK_DIR/libmpv-2.def" -l "$SDK_DIR/mpv.lib" -m i386:x86-64

# Stage the non-system DLL dependency closure. Windows system DLLs are not in
# /clang64/bin, so they are deliberately left to the OS loader. A missing
# non-system dependency fails the build instead of shipping a broken bundle.
declare -A visited=()
collect_imports() {
  local binary="$1" name key source
  while IFS= read -r name; do
    [[ -n "$name" ]] || continue
    key="${name,,}"
    [[ -z "${visited[$key]:-}" ]] || continue
    visited[$key]=1
    source="$(find /clang64/bin -maxdepth 1 -type f -iname "$name" -print -quit)"
    if [[ -z "$source" ]]; then
      case "$key" in
        api-ms-win-*|ext-ms-*) continue ;;
      esac
      if [[ -n "$(find /c/Windows/System32 -maxdepth 1 -type f -iname "$name" -print -quit 2>/dev/null)" ]]; then continue; fi
      echo "Missing non-system DLL $name (imported by $binary)" >&2
      return 1
    fi
    cp "$source" "$SDK_DIR/$(basename "$source")"
    collect_imports "$source"
  done < <(llvm-readobj --coff-imports "$binary" | awk '/^[[:space:]]*Name: [^ ]+\.[dD][lL][lL]$/ { print $2 }')
}
collect_imports "$LIBMPV_FILE"
echo "Staged official mpv $MPV_TAG x64 SDK and dependency DLLs at $SDK_DIR"
