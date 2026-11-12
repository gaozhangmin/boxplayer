# 开发、执行与工程约束

本文承接原 `AGENTS.md` 的完整相关段落。源码路径以仓库根目录解释；版本、旧机器路径及历史验证仅为当时记录，不能当成当前发行状态。

## 问题反馈默认检查所有平台

- 用户每次反馈问题或要求修复时，默认分别检查 Electron（Windows/macOS/Linux）、Tauri 桌面端、Android 手机/平板/TV、Apple iOS/iPadOS/macOS/tvOS，无需用户再次声明所有平台。
- 按各平台实际支持的功能检查对应实现及共享数据影响；不把手机端功能套到 TV。tvOS 和 Android TV 不支持添加本地文件夹，此类问题检查是否错误暴露入口或占位项，不新增本地文件夹能力。
- 分别检查四个客户端 checkout 并修复实际发现的同类问题；交付区分代码检查、实际运行验证及未覆盖范围。
- 本地设备占位父项只用于已存储共享等来源管理入口；支持本地文件夹的平台，主页和文件首页应显示用户添加的实际文件夹。
- 仓库按兄弟目录 `boxplayer`、`boxplayer-tauri`、`BoxPlayer_Android`、`XbyVideoHub` 定位，并核对 remote；其他机器按实际路径定位。

## “All Platforms” Scope

- When the user says “all platforms” (`所有平台`), inspect all four client checkouts: `../boxplayer`, `../boxplayer-tauri`, `../BoxPlayer_Android`, and `../XbyVideoHub`.
- Implement Electron in `../boxplayer`, Tauri in `../boxplayer-tauri/tauri-app`, Android phone/tablet/TV in `../BoxPlayer_Android`, and native Apple platforms in `../XbyVideoHub`.
- Inspect and modify each repository independently. Do not assume a change in one repository propagates to the other two.

## Quick reference

```bash
pnpm install          # install deps (pnpm only, never npm/yarn)
pnpm dev              # hot-reload Electron dev server
pnpm run build        # typecheck + bundle (vue-tsc --noEmit && vite build)
pnpm run test         # focused Vitest suite (not full repo)
pnpm run test:clouddrive-cli  # clouddrive-cli tests only
```

## Package manager: pnpm only

Lockfile is `pnpm-lock.yaml`. `package-lock.json` and `yarn.lock` are in `.gitignore`.
Never use `npm install` or `yarn`.

## Node version

`engines.node >= 22.12.0` in package.json. Electron 40 requires Node 22.12+ during install/build.

## Build pipeline order matters

`pnpm run build` runs **version bump → typecheck → vite bundle**. The version bump (`version.mjs`) auto-increments the patch version in package.json before every build. The build removes `dist/` and `release/` directories on start.

`pnpm run build:electron` calls `build` first, then runs `electron-builder`.

For platform-specific packaging:
```bash
pnpm run build:mac       # unsigned macOS
pnpm run build:mac:signed  # signed + notarized
pnpm run build:linux
pnpm run build:windows
pnpm run build:all       # cross-platform, sequential
```

## Sensitive config: generated secrets

Private client IDs, client secrets, API keys, and private API URLs live outside git:

```bash
pnpm run secrets:generate
```

Local development reads them from `.env.local` and generates `src/secrets.generated.ts`. GitHub Actions reads the same keys from GitHub Secrets and runs `scripts/generate-secrets.mjs --mode=ci --strict` before building.

`.env.local` and `src/secrets.generated.ts` are ignored and must never be committed. `src/config.ts` should import generated secrets or use placeholders, not contain real private values.

## Architecture: Electron + Vue 3 + Vite

| Directory | Purpose |
|---|---|
| `electron/main/` | Electron main process (entry: `electron/main/index.ts`) |
| `electron/preload/` | Preload scripts |
| `src/` | Vue 3 renderer (components, views, stores, API modules) |
| `shared/` | Code shared between main + renderer |
| `scripts/` | Build, CLI entry points, config management |
| `clouddrive-cli/` | Standalone CLI package (published to npm as `clouddrive-cli`) |

Path aliases (set in `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`):
- `@shared/*` → `shared/*`
- `@main/*` → `electron/main/*`

Cloud provider API modules in `src/`: `aliapi/`, `cloudbaidu/`, `cloud123/`, `cloud115/`, `pikpak/`, `onedrive/`, `box/`, `dropbox/`, `quark/`, `cloud139/`, `cloud189/`.

## GitHub Issue workflow

When the user asks to handle GitHub Issues, first fetch the complete list of unfinished/open Issues in the requested repository. Review each Issue individually, identify its likely cause and affected code, and report the triage before changing code. Then implement fixes and run focused regression tests for each applicable Issue. Do not jump straight into a code change based only on the newest Issue or close an Issue before its fix is verified. If the repository or Issue access is unavailable, state that limitation rather than assuming the list is complete.

## Testing: Vitest, Node environment, selective includes

### Default app inspection: attach to the existing dev app

- Unless the user explicitly asks to execute E2E tests, always connect to the app the user already started with `pnpm run dev` for inspection, reproduction, debugging, and UI verification.
- Use the existing Electron CDP endpoint (normally `http://127.0.0.1:9223`; confirm the active endpoint). Playwright may attach with `chromium.connectOverCDP`; do not use `electron.launch`, spawn another Electron process, or start another `pnpm run dev` instance.
- Preserve the running app's real user-data directory, accounts, settings, and playback state. Do not substitute an isolated/temporary profile or seed test data into the user's app.
- Requests to review, investigate, reproduce, fix, or verify a bug are not explicit requests to run E2E tests. Do not automatically run `pretest:e2e`, `test:e2e`, or Playwright specs whose fixtures launch a separate app.
- If the existing app or relevant window is unavailable, report that and ask the user to start/reopen it. Do not silently launch a replacement. Request approval before restarting the user's dev app when a main-process or native-module change requires it.
- This rule takes precedence over the E2E workflow below. Record what was actually verified in the existing dev app; do not describe attached-session checks as production E2E acceptance. A pending E2E gate does not authorize launching another app.

### Playwright acceptance gate when E2E execution is explicitly requested

When the user explicitly asks to execute E2E tests, verify bug fixes through Playwright against an actually launched Electron application using the workflow below. Unit tests, type checks, source inspection, and merely starting `pnpm run dev` cannot replace this E2E gate.

1. Add or update a Playwright regression test that reproduces the reported failure through the user-visible application flow.
2. Build the production Electron entry with `pnpm run pretest:e2e`; do not test stale `dist/` output or an installed older BoxPlayer build.
3. Run the focused Playwright regression test and record the exact command and result.
4. For cloud-drive bugs, use the configured real account and exercise the real provider API. Do not skip the relevant real-account case or replace it with mocks.
5. For platform-specific behavior that cannot execute on the current host, run Playwright on the target platform before calling the bug fixed. If that is unavailable, report the fix as unverified/blocked rather than complete.
6. A failed, skipped, or unexecuted Playwright regression test blocks declaring the bug fixed and blocks release publication.

Keep the regression test after the fix so the same bug cannot silently return.

Tests run in Node environment (not jsdom). The `vitest.config.ts` lists explicit test directories — not a glob over `**/*.test.ts`. Tests outside these paths are not picked up:

- `electron/main/core/__tests__/`, `electron/main/aria/__tests__/`
- `shared/__tests__/`, `scripts/__tests__/`
- `src/down/motrix-integration/`, `src/media-server/__tests__/`
- `src/utils/__tests__/`, `src/aliapi/__tests__/`
- `src/pikpak/__tests__/`, `src/quark/__tests__/`
- `src/dropbox/__tests__/`, `src/onedrive/__tests__/`, `src/box/__tests__/`
- `clouddrive-cli/__tests__/`

Default `pnpm run test` runs only a subset (aria2 tests, motrix integration, a couple utils files).

When adding tests in a new directory, update `vitest.config.ts`.

## Pre-commit hooks

Do not rely on pre-commit cleanup for secrets. Secret safety is handled by keeping real values in ignored/generated files and GitHub Secrets.

## Formatting conventions

From `.prettierrc`:
- Single quotes, no semicolons
- 260 printWidth (very wide)
- No trailing commas
- LF line endings
- `sortAttributes: true` on HTML/Vue

## TypeScript

- `tsconfig.json` targets ESNext, moduleResolution node, strict mode, `@shared/*` and `@main/*` path aliases
- Includes `src/` and `shared/`, excludes `shared/__tests__`
- References `tsconfig.node.json` for Electron-side code

## Subprojects (gitignored, referenced locally)

`Motrix/`, `koodo-reader/`, `CloudServiceKit/`, `XbyVideoHub/`, `OpenCLI/`, `QuarkPan/`, `PikPakAPI/` — these are local-only and not part of the main repo build.
