# BoxPlayer libmpv SDK

This directory stores the project-local libmpv SDK used by the macOS embedded
MPV native addon.

Expected layout:

```text
deps/mpv/
  include/mpv/client.h
  include/mpv/render.h
  include/mpv/render_gl.h
  macos/libmpv.dylib
  macos/x64/libmpv.dylib
  macos/arm64/libmpv.dylib
```

The headers are used only when building `boxplayer-mpv-texture.node`.
The dylib is copied into BoxPlayer's Electron resources together with its
transitive runtime dependencies.

Use `scripts/sync-mpv-deps-mac.sh` to populate this directory from a local
libmpv SDK such as Homebrew or a custom lower-deployment-target build.
