# AGENTS.md — BoxPlayer (aliyunpan)

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

### Mandatory macOS release acceptance gate

Before creating, publishing, or promoting **any** BoxPlayer release, build and test the actual macOS DMG. `pnpm run dev` is not an acceptable substitute because packaged Electron windows load their renderer from `file://` inside `app.asar`.

1. Produce the arm64 DMG from the release candidate.
2. Mount the generated DMG without replacing the installed application.
3. Verify the DMG's `BoxPlayer.app` contains its expected renderer assets in `app.asar`, including the main HTML entry and its referenced CSS.
4. Launch the packaged app and visually verify the main window: global theme, layout, navigation, file list, and controls must all render normally.
5. Do not create, publish, or promote the release if this test fails or cannot be completed. Record the passing DMG path and verification result in the release handoff.

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

## Testing: Vitest, Node environment, selective includes

### Mandatory Playwright bug-fix acceptance gate

Every bug fix must be verified through Playwright against an actually launched Electron application. Unit tests, type checks, source inspection, and `pnpm run dev` are supporting checks, but none of them can replace this gate.

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

## Provider Integration Checklist

When adding a new cloud-drive provider, implement the following in order unless the user explicitly excludes a step. Do not stop after only wiring file listing. Sync/change-listening is not required by default.

### 1. Account And Auth

- Read the official OAuth/API documentation and prefer stable API versions.
- Add `src/<provider>/auth.ts` with auth URL, authorization-code token exchange, and refresh token support.
- Define `CLIENT_ID` / `CLIENT_SECRET` placeholder constants, defaulting to empty strings.
- Add app key / secret fields to `.env.example`, `src/secrets.example.ts`, and `scripts/generate-secrets.mjs`.
- Add the provider to `tokenfrom` in `src/user/userstore.ts`.
- Wire login, token refresh, and drive loading in `src/user/userdal.ts`.
- Add login entry points in `src/user/UserLogin.vue` and `src/user/UserInfo.vue`.

### 2. Provider Detection And Drive Model

- Add `is<Provider>User` in `src/aliapi/utils.ts`.
- Update `GetDriveID` and `GetDriveType`, modeling third-party drives as a single-root drive.
- Filter unsupported virtual directories in `src/pan/PanLeft.vue` and `src/pan/pantreestore.ts`.

### 3. File List And Detail

- Add `src/<provider>/dirfilelist.ts`.
- Implement root listing, child directory pagination, and file detail.
- Map official file models to `IAliGetFileModel`; at minimum fill `drive_id`, `file_id`, `parent_file_id`, `name`, `isDir`, `category`, `icon`, `size`, `time`, `thumbnail`, and `content_hash`.
- Store provider-specific path, parent id, download URL, or similar metadata in `description`.
- Wire root loading, directory listing, and search-listing branches in `src/pan/pandal.ts`.
- Wire provider file detail in `src/aliapi/file.ts` `ApiFileInfo`.

### 4. Download And Playback

- Wire provider direct download URLs in `src/aliapi/file.ts` `ApiFileDownloadUrl`.
- Third-party drives usually do not have Aliyun transcode APIs; `ApiVideoPreviewUrl` / `ApiAudioPreviewUrl` should return `暂无转码信息` or `undefined`, letting playback use the raw download URL.
- Wire same-directory playlist loading in `src/layout/PageVideo.vue`, `src/utils/openfile.ts`, and `src/utils/playerhelper.ts`.
- Confirm clicking provider videos does not call Aliyun APIs.

### 5. Search

- Add `src/<provider>/search.ts`.
- Support keyword search.
- If the existing UI uses special `file_id` values for search conditions, implement parse/build/filter helpers.
- Wire search-directory branches in `src/pan/pandal.ts`.

### 6. Thumbnails And Preview

- Prefer thumbnails returned by list/detail APIs.
- If the provider needs a separate thumbnail API, add `src/<provider>/thumbnail.ts`.
- Fill `thumbnail` during file mapping so media library and file lists can use it directly.

### 7. File Operations

- Add `src/<provider>/filecmd.ts`.
- Implement create folder, move to recycle bin, permanent delete, rename, move, and copy. Clearly report unsupported official capabilities.
- Wire `ApiCreatNewForder`, `ApiTrashBatch`, `ApiDeleteBatch`, `ApiRenameBatch`, `ApiMoveBatch`, and `ApiCopyBatch` in `src/aliapi/filecmd.ts`.
- Unsupported capabilities must not fall through to the Aliyun default branch.

### 8. Sharing

- Add `src/<provider>/share.ts` with share-link creation.
- If the provider does not support password, expiration, or multi-file sharing, block it clearly in `src/aliapi/share.ts`.
- Update context-menu and top-menu share visibility.

### 9. Upload And New Files

- Add or extend `src/<provider>/upload.ts`.
- Implement in-memory upload for new text files.
- Implement local-file upload worker support for ordinary file/folder uploads.
- Implement large files using the provider-recommended session/chunk API.
- Wire `src/aliapi/uploadmem.ts` and `src/workerpage/uploader.ts`.
- Third-party drives do not support app custom encrypted/private uploads by default; hide those menu items.

### 10. Media Library Scanning

- Wire provider folder traversal in `src/utils/mediaScanner.ts`.
- Wire provider subfolder entry in `src/components/MediaLibrary.vue`.
- Show the provider name in media-library source labels.
- Confirm scanning does not call Aliyun list APIs.

### 11. Folder Picker Modal

- Treat the provider as a single-root drive in `src/pan/topbtns/SelectPanDirModal.vue`.
- Wire lazy child directory loading.
- Move, copy, and save-location picker modals must browse provider directories.

### 12. Menu Capability Boundaries

- Update `src/pan/menus/FileRightMenu.vue`, `src/pan/menus/FileTopbtn.vue`, `src/pan/menus/DirLeftMenu.vue`, and `src/pan/menus/PanTopbtn.vue`.
- Show common capabilities: download, share, rename, move to, copy to, delete, properties, scan media library, normal upload, and normal new file/folder.
- Hide Aliyun-only capabilities: lucky bottle, fast transfer, favorite, transcode-related actions, mark encrypted, clear history, color labels, copy directory tree, encrypted/private new file, encrypted/private upload, and import share.

### 13. Properties, Versions, And Recycle Bin

- Wire provider file detail in `src/pan/topbtns/ShuXingModal.vue`.
- If folder size has no official API, return 0 or hide it; do not call Aliyun folder-size APIs.
- If the provider supports file versions, add `src/<provider>/revisions.ts` and expose version listing/restoration in properties.
- If the provider supports recycle bin list/restore, add `src/<provider>/recyclebin.ts` and wire recycle-bin directory, restore, and permanent delete.
- If the official API supports only some account types or needs higher permissions, record the limitation and keep it disabled by default.

### 14. Tests

- Add provider helper tests under `src/<provider>/__tests__/`.
- Cover at least OAuth URL/token body, file-list path/body, model mapping, search path/body, share body/result mapping, file-operation body, upload session/chunk path, and version/recycle-bin path where applicable.
- Update `vitest.config.ts` to include provider tests.

### 15. Verification

- Run provider unit tests.
- Run `pnpm run build`.
- If playback/media library is involved, verify provider videos use provider download URLs, same-directory playlists use provider list APIs, media-library scans use provider list APIs, and context menus do not expose unsupported capabilities.

### Recommended File Structure

```text
src/<provider>/
  auth.ts
  dirfilelist.ts
  filecmd.ts
  search.ts
  share.ts
  upload.ts
  revisions.ts       # optional
  recyclebin.ts      # optional
  thumbnail.ts       # optional
  __tests__/
```

### Completion Criteria

- Login and token refresh work.
- The left tree shows root and folders.
- File list opens root, subdirectories, and search results.
- File detail, download, and video playback do not call the wrong provider API.
- Context menus and top menus expose only supported capabilities.
- Create folder, rename, move, copy, and delete call provider APIs.
- Share, upload, and media-library scanning are wired or explicitly reported unsupported.
- Provider unit tests pass.
- `pnpm run build` passes.

### Current Experience Notes

- Dropbox and OneDrive should both be treated as single-root third-party drives.
- Third-party drive video playback should prefer raw download URLs and must not reuse Aliyun transcode APIs.
- Media-library scanning and same-directory playlists are the easiest provider branches to miss.
- Auth pages should usually open in the system browser unless the provider explicitly requires an embedded flow.
- App key / secret placeholder constants must be included in the generated-secrets flow, not committed as real values.

## Cloud Download URL And Subtitle Contract

Treat a cloud download URL and its request headers as one value. `ApiFileDownloadUrl` must return every provider-required header in `IDownloadUrl.headers`; callers must preserve those headers through playback, downloads, previews, and subtitles.

| Provider | Download request requirements |
|---|---|
| Aliyun / Alipan | Signed CDN URL; Electron may add the Aliyun Referer/Origin for direct renderer requests. |
| 115 | `Authorization: Bearer <account token>` and `DRIVE115_DOWN_AGENT`. The User-Agent used to consume the URL must match the one used to obtain it. Direct renderer playback must register URL-to-account auth context; never rely only on the currently selected account. |
| Baidu | URL includes `access_token`; send `User-Agent: pan.baidu.com` and `Referer: https://pan.baidu.com/`. |
| 123 | The returned signed download URL is self-authorizing; API Authorization is only for obtaining the URL. |
| Quark | Account Cookie plus Quark download User-Agent, `Referer: https://pan.quark.cn/`, `Origin: https://pan.quark.cn`, and `x-urlp` when required by the OSS URL. |
| 139 | `cloud139DownloadHeaders()`: provider User-Agent, Referer, and Origin. |
| 189 | `cloud189DownloadHeaders()`: provider User-Agent and Referer. |
| PikPak | Temporary download/stream URL returned by the provider. |
| Dropbox / OneDrive | Temporary or pre-authenticated download URL returned by the provider. |
| Box | Access token is encoded into the constructed download URL. |

Subtitle rules:
- Same-directory cloud subtitles must use `ApiFileDownloadUrl`; never fetch a guessed provider URL directly.
- The web player and external players must use the subtitle-specific local proxy URL and pass `IDownloadUrl.headers` as `proxy_headers`.
- The subtitle proxy must identify the account with `user_id` and the provider with `drive_id`; do not use a global/current-account token when an account-specific token is available.
- Video streams remain direct URLs unless encryption requires the proxy. DLNA behavior is separate and must not be changed as part of subtitle or direct-play fixes.
- Any provider download-header change requires regression coverage for both the video/download URL contract and same-directory subtitle loading.

## clouddrive-cli

Standalone CLI + MCP server for agent-driven cloud-drive operations. Docs: `clouddrive-cli/README.md`. The CLI supports 8 providers and has its own npm package (`clouddrive-cli`). Separate test command: `pnpm run test:clouddrive-cli`.

## CI

Manual trigger only (`workflow_dispatch`) via `.github/workflows/release.yml`. Builds on `windows-latest` + `ubuntu-latest`, publishes draft GitHub Release. No automatic CI on push/PR.

## Subprojects (gitignored, referenced locally)

`Motrix/`, `koodo-reader/`, `CloudServiceKit/`, `XbyVideoHub/`, `OpenCLI/`, `QuarkPan/`, `PikPakAPI/` — these are local-only and not part of the main repo build.
