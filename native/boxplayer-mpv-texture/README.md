# boxplayer-mpv-texture

N-API addon for BoxPlayer embedded MPV. macOS has a texture-rendering backend;
Windows and Linux have an opt-in software-frame renderer while their GPU texture
renderers remain unimplemented. Target-platform playback verification is pending.

## Target matrix

| Target | Native mode | Required libmpv runtime | Current bundle |
| --- | --- | --- | --- |
| macOS arm64 | IOSurface texture | `libmpv.dylib` | Present locally; manifest needs regeneration |
| macOS x64 | IOSurface texture | `libmpv.dylib` | Local macOS 26 build passes Electron playback; older-system compatibility awaits runner build |
| Windows x64 | Software frames (candidate) | `libmpv-2.dll` | Missing |
| Windows arm64 | Deferred | — | Not a current target |
| Linux x64 / arm64 | Software frames (candidate) | `libmpv.so.2` | Missing |

The Windows/Linux build requires matching SDK headers, a link library and the
runtime binary for each architecture. Stage Windows import libraries at
`deps/mpv/win32/<arch>/mpv.lib`, or Linux link libraries at
`deps/mpv/linux/<arch>/libmpv.so`, then run `pnpm run build:libmpv` on the
target OS and architecture. The default non-macOS build remains a safe stub;
the opt-in build is not yet wired into releases. The software renderer skips GL
and shared-texture creation, sends capped 1280×720 RGBA frames over Electron IPC,
and keeps libmpv playback, status, speed, audio-track and subtitle-track controls.
This compatibility route is CPU-heavy and must not be advertised as complete
until real target-platform playback tests pass.
The manual `embedded-mpv-linux.yml` and `embedded-mpv-windows-x64.yml`
workflows build candidates on matching GitHub-hosted runners, run the
production-entry Electron frame test, and inspect an unpacked app for the
complete runtime bundle. They do not publish a BoxPlayer release. A passing
target-host run remains required before release integration.

The cross-platform `build:libmpv` command checks SDK inputs before compiling.
For macOS it selects `deps/mpv/macos/<arch>/libmpv.dylib`, with the legacy
`deps/mpv/macos/libmpv.dylib` accepted only for arm64. The currently staged
legacy dylib is arm64, so an x64 build fails fast rather than silently
producing a mismatched addon. On Windows, use an MSVC-compatible
`mpv.lib` matching `libmpv-2.dll` (the mpv Windows build docs explain how to
generate one from the DLL). Linux builds link `libmpv.so` and set an
`$ORIGIN` runtime path so the packaged addon can locate a sibling
`libmpv.so.2`.

For macOS x64, Windows x64 and Linux x64/arm64, build from the official
`mpv-player/mpv` source at the pinned `v0.41.0` tag:

```bash
# On an Intel Mac with Meson, Ninja, pkg-config and mpv dependencies installed:
pnpm --dir native/boxplayer-mpv-texture run source:mac
pnpm --dir native/boxplayer-mpv-texture run build:libmpv
pnpm --dir native/boxplayer-mpv-texture run smoke:controls
```

```bash
# On native Windows x64 in an MSYS2 CLANG64 shell with Meson, Ninja and x64 deps:
pnpm --dir native/boxplayer-mpv-texture run source:win:x64
pnpm --dir native/boxplayer-mpv-texture run build:libmpv
pnpm --dir native/boxplayer-mpv-texture run smoke:controls
pnpm --dir native/boxplayer-mpv-texture run bundle:software
node scripts/check-embedded-mpv-bundles.mjs win32/x64
```

```bash
# On native Linux x64 or arm64 with Meson, Ninja, pkg-config and mpv deps:
pnpm --dir native/boxplayer-mpv-texture run source:linux
pnpm --dir native/boxplayer-mpv-texture run build:libmpv
pnpm --dir native/boxplayer-mpv-texture run smoke:controls
pnpm --dir native/boxplayer-mpv-texture run bundle:software
node scripts/check-embedded-mpv-bundles.mjs linux/x64 # or linux/arm64
```

The source scripts download the official tag archive and verify its SHA-256
before compiling. Its `.mpv-source/` directory is separate from node-gyp's
`build/`, which is deleted during addon rebuilds. Both source scripts stop on
missing toolchains or matching libraries; they do
not substitute a different-architecture DLL/dylib. The Windows CLANG64 script
generates the MSVC-compatible import library from the built DLL's exports and
stages its non-system runtime DLLs. The Windows and Linux source scripts have
not passed target-host builds yet. The macOS x64
bundle passes its manifest/architecture check and a production-entry Electron
Playwright test with a local video. An installed DMG remains a separate release
gate. See the [official compilation notes](https://github.com/mpv-player/mpv/blob/v0.41.0/README.md#compilation)
and [Windows build notes](https://github.com/mpv-player/mpv/blob/v0.41.0/DOCS/compile-windows.md).

The local Intel macOS 26 Homebrew libraries require macOS 26. Run
`ARCH=x64 MAX_MACOS_MIN_VERSION=15.0 pnpm run check:mac-minos` on a bundled
candidate before using it for older macOS releases. The isolated macOS 15
workflow enforces that limit; it does not publish a BoxPlayer release.

Run `pnpm run check:mpv-bundles` at the repository root before declaring the
target-platform bundles complete. It checks manifests, file sizes/hashes, and the
actual `.node`/libmpv binary architectures. To check just one target, use
`node scripts/check-embedded-mpv-bundles.mjs darwin/arm64`.
After building on a target machine, run `pnpm run smoke:controls` from this
package before packaging. It loads the native addon and exercises libmpv
initialization, volume, speed, track selection and status queries.

Current status:

- Builds a `.node` addon shape for the Electron 40 `sharedTexture` route.
- Exports `mpvTexture`, matching `electron/main/mpv/embeddedMpvNativeAddon.ts`.
- Routes the N-API entrypoint through `src/native/mpv_context.{h,cpp}` for the opt-in real libmpv backend.
- Adds a small `IOSurfaceTexture` render-target wrapper so the future `mpv_render_context` path has a stable texture handle boundary.
- Links Objective-C++ translation units against `IOSurface` to validate the native toolchain path.
- The opt-in libmpv backend creates and controls an mpv context, and passes load options such as start position and HTTP headers into `loadfile`.
- The opt-in libmpv backend exposes non-blocking event polling so Electron can read mpv status without calling JavaScript from libmpv-owned threads.
- The opt-in libmpv backend creates a libmpv render context and renders frames into IOSurface-backed OpenGL FBOs for Electron `sharedTexture`.
- The default stub backend has been verified to build into `build/Release/boxplayer-mpv-texture.node` and export the expected JavaScript API shape.
- The default stub rejects playback; the opt-in libmpv backend provides software frames on Windows/Linux, but target-host acceptance is still pending.
- Windows/Linux software-frame rendering is implemented but unverified on target hosts.

Expected packaged output:

```text
static/engine/darwin/arm64/mpv-texture/
  boxplayer-mpv-texture.node
  libmpv.dylib
  *.dylib
```

Manual build sketch:

```bash
cd native/boxplayer-mpv-texture
pnpm install
pnpm run build
```

The default build uses `src/mpv_context_stub.cpp` and does not link libmpv.

When node-gyp cannot write to the default user cache, point it at a writable devdir and local Node headers:

```bash
NODE_PATH=/path/to/root/node_modules/.pnpm/node-addon-api@5.1.0/node_modules \
npm_config_devdir=/private/tmp/boxplayer-node-gyp-cache \
NODE_DIR=/path/to/node \
pnpm run build:libmpv
```

The package scripts call `scripts/node-gyp-rebuild.sh`, which uses the root
repo's pinned `node-gyp@12.4.0` and defaults to `$HOME/.hermes/node` for Node
headers. Override `NODE_GYP_BIN` or `NODE_DIR` only when needed.

To sync a local libmpv SDK into the project-local dependency layout:

```bash
cd native/boxplayer-mpv-texture
LIBMPV_PREFIX=/opt/homebrew pnpm run sync:mpv:mac
```

This creates the sbtlTV-style local layout:

```text
deps/mpv/
  include/mpv/*.h
  macos/libmpv.dylib
```

`LIBMPV_PREFIX` must contain `include/mpv/client.h`, `include/mpv/render.h`,
`include/mpv/render_gl.h`, and a libmpv dylib. The source may be Homebrew for
development or a custom lower-deployment-target libmpv build for release.

To build the libmpv-backed context from the project-local deps:

```bash
cd native/boxplayer-mpv-texture
pnpm run check:libmpv
pnpm run build:libmpv
```

The native package defaults to `deps/mpv` when `npm_config_libmpv_prefix` is
not set. Override `npm_config_libmpv_prefix` and `npm_config_libmpv_lib_dir`
only when testing an external SDK.

Manual bundle sketch:

```bash
cd native/boxplayer-mpv-texture
ARCH=arm64 pnpm run bundle:mac
```

The bundler:

- copies `build/Release/boxplayer-mpv-texture.node`;
- copies local `libmpv.dylib` from `deps/mpv/macos`, Homebrew, or `LIBMPV_SOURCE`;
- recursively copies non-system dylib dependencies;
- rewrites load commands to `@loader_path/...`;
- ad-hoc signs copied `.node` and `.dylib` files for local development;
- writes `static/engine/darwin/<arch>/mpv-texture/mpv-bundle-manifest.json` with sha256 checksums and source notes.

Do not wire this package into the root install/build pipeline until packaged
Electron playback has been verified. The root Electron app must keep running
without this addon.

Development loader smoke:

```bash
cd native/boxplayer-mpv-texture
scripts/install-dev-stub.sh
```

This copies the default stub `.node` to `static/engine/darwin/<arch>/mpv-texture/boxplayer-mpv-texture.node`, the same dev resource path used by `electron/main/mpv/embeddedMpvNativeAddon.ts`. The copied stub is gitignored because it cannot render video.

Next implementation step:

1. Verify packaged Electron can load the `.node` and dylibs outside the Codex sandbox.
2. Play a local MP4 through the macOS embedded MPV surface.
3. Validate Dolby Vision Profile 5 samples.
4. Replace the Homebrew-sourced deps with a custom lower-deployment-target libmpv build before release.
