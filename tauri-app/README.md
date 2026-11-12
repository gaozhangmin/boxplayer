# BoxPlayer Tauri development shell

M2 migration workspace: Tauri 2, Vue 3.5, Pinia, Reka UI, shadcn-vue-style local components and Tailwind CSS 4. The existing Electron project remains independent.

```sh
cd tauri-app
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm tauri dev
```

`pnpm dev` is a browser-only preview on `http://127.0.0.1:1428`. It explicitly disables native settings and does not persist fake data. `pnpm tauri dev` starts the native app and the Vite server. Settings and player pages are separate entries. Native macOS playback uses a worker-owned libmpv handle embedded in the player window; the browser preview cannot play through this backend.

The CLI wrapper uses a workspace-local Rust installation at `.local/cargo` and `.local/rustup` when present, otherwise the system Rust toolchain. The local installation is ignored, is not shipped, and does not change shell profiles. A fresh checkout requires Rust and the target platform's Tauri prerequisites. Rust checks with a local installation:

```sh
export CARGO_HOME="$PWD/.local/cargo"
export RUSTUP_HOME="$PWD/.local/rustup"
export PATH="$CARGO_HOME/bin:$PATH"
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

The development identifier is `com.boxplayer.migration.dev`; only `boxplayer-migration-dev://` is registered. No production BoxPlayer OAuth schemes or accounts are imported. Native launch-at-login registration is opt-in in Settings; `--autostart` honors the “start hidden” option. The tray menu provides an explicit Quit action. Closing the main window hides it by default; closing settings/player destroys only that window.

Rust alone persists versioned settings using atomic file replacement. A stale writer receives `REVISION_CONFLICT` and reloads; corrupt or future-schema files are preserved and startup fails instead of overwriting them. The UI does not claim a save succeeded when persistence or OS integration fails.

The default data directory is Tauri's application-data directory for the development identifier. Set an absolute `BOXPLAYER_DEV_DATA_DIR` before starting to use another development-only location. Alternatively place an absolute path as plain text in `userdir.config` under that default development directory. Resolution precedes settings and logs initialization. Never point this at the existing Electron user-data directory. The WebView's own storage remains under the isolated development identifier; Rust persists business settings, sources and positions.

A local macOS development bundle can be generated with:

```sh
pnpm tauri build --debug --bundles app --config '{"bundle":{"active":true}}'
```

The resulting `src-tauri/target/debug/bundle/macos/BoxPlayer Dev.app` is a local debug artifact, not a signed/notarized public release. Its media file registration uses `LSHandlerRank=Alternate` and does not request the default handler role. Developer scheme and file-open smoke checks use repository fixtures, not production accounts.

File selection and file-open requests play supported local videos. Development deep links emit a payload-free UI notice; provider authentication is reserved for M3. No OAuth code, account token or playback URL is logged. Duplicate OS/plugin delivery within two seconds is deduplicated; the pending queue is bounded to 20 requests. A raw development executable on macOS is not a registered `.app` URL handler: test OS URL/file associations only after creating a development bundle.

## M2 playback and migration prototype

Use Files → Add file source to choose a local folder, then select a video. Sources and progress are stored in `library.sqlite3` under the isolated development data directory. Pause, seek, audio/subtitle selection, volume, speed, adjacent-video navigation and fullscreen use the current playback session. Same-basename SRT/ASS/VTT subtitles are discovered locally.

Before a macOS build, prepare the development runtime:

```sh
node scripts/prepare-mpv-runtime.mjs
pnpm tauri build --debug --bundles app --config '{"bundle":{"active":true}}'
```

The preparation script defaults to the installed Frame Player runtime and accepts a Resources directory as its first argument. It creates an ignored, hashed copy, excluding `libmpv-wrapper` and `soia_utils`; see THIRD_PARTY_NOTICES.md. A fresh checkout has no binary runtime. Windows/Linux embedding and release runtime builds remain unverified.

Rust provides an HTTP gateway with media/account identity, explicit headers, redirect credential isolation, timeout/cancel, Range streaming and one 403 refresh. M2 tests use local authenticated fixtures; real provider SDK resolution is M3. Settings export/import operates only on the versioned local-source/progress prototype, with checksum validation, idempotence and transactional rollback. It does not import Electron databases or credentials.

After preparing the runtime, run the separately gated native-library tests (the second needs this workspace's Test_Video samples):

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml player::integration_tests -- --ignored --nocapture
```

See [M2 acceptance](../docs/tauri-migration/m2-validation.md). M3 development delivery is recorded in [M3 delivery](../docs/tauri-migration/m3-delivery.md); the provider checklist remains in [M3 status](../docs/tauri-migration/m3-current-status.md). Real provider-account acceptance is deferred at the user's request. M4 has not started.

See [implementation plan](../docs/tauri-migration/implementation-plan.md) and [progress](../docs/tauri-migration/progress.md) for acceptance status. Windows/Linux code and successful macOS compilation do not substitute for target-platform runtime validation.

The player interface now directly imports vendored soia components, not a locally redesigned layout. Run `node scripts/check-soia-upstream.mjs` to verify the original templates/styles against the source manifest. Native API compatibility lives in `src/features/player/soia/`; the page adapts current session state/events to the original component props. Casting, PiP, online subtitles and advanced playlist management remain unconnected and report that status. Native playback checks use the workspace `testVideo/` directory.

HDR routing now adapts soia's public `hdr_output.rs`, detecting PQ/HLG from actual video parameters and restoring prior options for SDR. See [HDR/DV acceptance](../docs/tauri-migration/hdr-validation.md). Opt-in debug probes read `boxplayer-playback-audit.json` from the user temp directory, with `{ "output": "/absolute/report.jsonl", "titles": ["allowed sample title"] }`; release builds exclude the probe. Remove this config and stop the player to disable an active probe. `node scripts/report-hdr-audit.mjs /path/to/raw-directory` rebuilds the compact report and sample hashes. The current run has disabled the probe; real display output remains only partially validated.

### 原生 HDR 图层诊断与测试图

调试采样还输出同名 `.surface.jsonl`，包含实际 mpv Metal 图层的色彩空间、像素格式、EDR 标记和窗口所在屏幕的 EDR 余量。仅 debug + 显式临时配置启用；结束时退出采样进程并删除配置。详见 ../docs/tauri-migration/hdr-surface-validation.md。

生成测试图：`python3 scripts/generate-hdr-charts.py --output ../../testVideo/calibration --ffmpeg '/Applications/Frame Player.app/Contents/Resources/ffmpeg'`。生成后核对无损码值及解码色彩标记。名义信号 nit 不代表实测屏幕 nit。

### M3 开发配置

此目录通过 .npmrc 的 ignore-workspace=true 保持 package/lock 与父 Electron 工程独立。依赖安装可显式使用 `pnpm --ignore-workspace install --frozen-lockfile`。

应用注册项从父项目已有生成配置的有限键清单或 `BOXPLAYER_<KEY>` 环境变量读入 Rust 的 ignored 构建输出；不读取用户账号数据库。115 QR 使用本地二维码库；OAuth 使用独立本机回调，需匹配提供商应用注册。不得将生成配置、token 或 QR 内容写入验收报告。

M3 account storage now keeps a short key reference in the platform vault and authenticated encrypted payloads under the development data directory's credential-payloads/. Preserve this directory when moving the same machine's development data; copying it alone does not transfer the OS-vault key. Do not add credential payloads or generated provider config to artifacts/reports. Platform-vault runtime tests use unique synthetic entries and remove them afterward.
