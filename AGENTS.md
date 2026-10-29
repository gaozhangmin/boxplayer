# AGENTS.md — BoxPlayer (aliyunpan)

## 问题反馈默认检查所有平台

- 用户每次反馈问题或要求修复时，默认分别检查 Electron（Windows/macOS/Linux）、Android 手机/平板/TV、Apple iOS/iPadOS/macOS/tvOS，无需用户再次声明所有平台。
- 按各平台实际支持的功能检查对应实现及共享数据影响；不把手机端功能套到 TV。tvOS 和 Android TV 不支持添加本地文件夹，此类问题检查是否错误暴露入口或占位项，不新增本地文件夹能力。
- 分别检查三个仓库并修复实际发现的同类问题；交付区分代码检查、实际运行验证及未覆盖范围。
- 本地设备占位父项只用于已存储共享等来源管理入口；支持本地文件夹的平台，主页和文件首页应显示用户添加的实际文件夹。
- 本机仓库位于 /Users/yunqi/Downloads/BoxPlayer 下的 aliyunpan、BoxPlayer_Android、XbyVideoHub；其他机器按实际路径定位。

## “All Platforms” Scope

- When the user says “all platforms” (`所有平台`), treat it as one request spanning all three repositories: `~/aliyunpan`, `~/BoxPlayer_Android`, and `~/XbyVideoHub`.
- Implement the Electron/aliyunpan surface in `~/aliyunpan`; implement Android phone, tablet, and Android TV in `~/BoxPlayer_Android`; implement macOS, iOS/iPadOS, and tvOS in `~/XbyVideoHub`.
- Inspect and modify each repository independently. Do not assume a change in one repository propagates to the other two.

## Quick reference

```bash
pnpm install          # install deps (pnpm only, never npm/yarn)
pnpm dev              # hot-reload Electron dev server
pnpm run build        # typecheck + bundle (vue-tsc --noEmit && vite build)
pnpm run test         # focused Vitest suite (not full repo)
pnpm run test:clouddrive-cli  # clouddrive-cli tests only
```

## Home Category Context Menus

- Categories and independently placeable subcategories, including series, playlists, movie/TV child categories, genre, rating, score, and release-date values, use the same placement context-menu state machine.
- An unplaced item shows “Add to Home” and “Add to Favorites”; both actions prompt for a user-defined display name.
- After either add action succeeds, or when the item is initially visible on Home, the menu immediately switches to “Remove from Home” and “Rename Favorite.” The menu must not allow simultaneous Home and Favorites placement.
- “Remove from Home” clears whichever placement contains the item. Renaming a favorite changes only its Favorites card title and does not rename the Home or sidebar title.
- Exception: media server categories expose only Favorites actions (plus play / loop / shuffle); their Home shelf is managed in the Add to Home sheet and is independent of the Favorites card.

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

### Release ownership: drafts only

- The human user owns the final publication of every GitHub Release. The agent and CI may prepare commits/tags, build and upload assets, and create/update **draft releases only** when requested.
- Requests such as “发布 release”, “更新 release”, “重新提交代码更新 release”, or “继续发布” mean prepare/update a draft; they do **not** authorize making it public. The user publishes it manually in GitHub.
- Never run `gh release edit --draft=false`, create a non-draft release, or enable automatic publication in a workflow or packaging configuration. Keep electron-builder `releaseType` set to `draft` and the workflow's final release update in draft state.
- Do not delete, recreate, demote, overwrite assets on, or otherwise modify an already-public release without a separate explicit request for that exact operation. A rerun targeting a public tag must stop rather than modify that release.
- Determine the next version from the latest **public** release plus one patch version, unless the user explicitly specifies a different version. Do not move an existing public tag to new code.
- Report draft creation and build/test status accurately. Never describe a draft or queued workflow as a published release.

## Subprojects (gitignored, referenced locally)

`Motrix/`, `koodo-reader/`, `CloudServiceKit/`, `XbyVideoHub/`, `OpenCLI/`, `QuarkPan/`, `PikPakAPI/` — these are local-only and not part of the main repo build.

## 文件来源浏览与收藏规则

- 网盘、网络共享、媒体服务器沿用本地文件夹的来源浏览与收藏交互；取消网盘、网络共享的文件夹收藏（子文件夹或整盘“所有文件”）会移除收藏卡片，并清除从该文件夹（整盘即整个网盘）刮削到媒体库的媒体，但保留来源，也不删除网盘或共享里的文件。媒体库里可添加到收藏夹和主屏幕的类别（如电影下的按类型、按评价或某个具体类别）取消收藏只移除快捷卡片，不影响已收录媒体。删除来源会清理该来源的全部关联媒体。
- 媒体服务器使用服务端元数据，不为服务器目录启用本地刮削。
- 远端视频列表行右侧提供可操作的下载入口；解析与下载均使用文件所属账号，并保留所需请求头。
- 媒体服务器分类的收藏夹卡片与主页横排相互独立、可同时存在：分类卡片菜单只提供 播放 / 循环播放 / 随机播放 / 添加到收藏夹（已收藏时为 从收藏夹移除 / 重命名收藏夹），不提供添加到主屏幕，主页横排在“添加到主页”弹窗中管理；具体电视剧、季等内容条目只允许收藏卡片。本地媒体库分类仍按主屏/收藏夹互斥规则。
- 网盘、网络共享没有收藏时，文件 tab 显示网盘卡片，进入后为文件浏览（显示所有类型）。有任一收藏后文件 tab 隐藏该网盘卡片、只显示收藏卡片，取消最后一个收藏后恢复；已存储共享始终列出所有网盘。Electron 没有已存储共享页，网盘卡片始终显示。
- 整盘收藏有两个入口且效果相同：网盘卡片菜单的“添加到收藏夹”和已存储共享中网盘根目录“所有文件夹”占位的五角星。卡片名为“所有文件”，list 视图显示所属网盘名；整盘收藏与子文件夹收藏可同时存在。
- 从收藏卡片（主屏幕收藏夹或文件 tab）进入时为海报样式，只显示文件夹和视频，仍按目录逐级进入。文件 tab 卡片、主屏幕收藏夹卡片和已存储共享五角星都可取消收藏。
- 媒体服务器不走刮削，文件 tab 内默认海报浏览；添加后固定显示在主屏幕收藏夹，不能取消收藏。
- “添加到收藏夹”与“添加到主页”是两种行为。主屏幕编辑弹窗标题为“添加到主页”；只添加到收藏夹的项目不出现在其“显示项目”中。
- 浏览样式按入口区分。新增文件来源 → 已存储共享（网盘、网络共享、媒体服务器）是纯文件浏览：紧凑列表行（小的橙色图标、名称、“日期 - 大小”），文件夹行右侧五角星，视频行右侧下载入口，空目录显示“空文件夹 / 这儿什么都没有。”。文件 tab 和主屏幕进入的文件夹是媒体库海报样式，列表（海报底板 + 标题 + 简介）和网格两种布局可切换：已收藏刮削的文件夹显示刮削海报、只显示视频；文件 tab 未收藏的网盘、共享卡片没有刮削，开启“显示视频预览”时用视频缩略图代替海报，否则显示图标，非视频文件也显示，列表副标题为“日期 - 大小”。两种海报浏览里的子文件夹都可添加到收藏夹。
- 点击视频直接播放；手机上点击图片、PDF 直接预览，TV 可预览图片。
- 在已收藏并刮削过的文件夹（含整盘收藏）里再收藏子文件夹，不重新刮削，只新增收藏卡片。
- 取消这类仍被其他收藏覆盖的子文件夹收藏（整盘“所有文件”或上级文件夹收藏还在）时，只移除卡片，媒体库里的媒体保留，因为它们属于覆盖它的那个收藏。
- 用户添加的本地文件夹从文件 tab 和主屏幕进入时，视频优先显示刮削海报，刮削不到元数据时才回退到本地视频缩略图。
- 媒体服务器的收藏卡片（主屏幕收藏夹与文件 tab 一致）按类型使用不同菜单：分类文件夹为 播放 / 循环播放 / 随机播放 / 从收藏夹中移除 / 重命名收藏夹 / 在主屏幕隐藏（已隐藏时为在主屏幕显示）/ 选择封面；电视剧等内容文件夹为 播放 / 循环播放 / 随机播放 / 收藏（切换服务器端收藏）/ 选择封面。“在主屏幕隐藏”只影响主屏幕，文件 tab 仍显示该卡片。
- 主屏幕收藏夹卡片和文件 tab 对应卡片使用一致的菜单与收藏状态；按实际能力覆盖 Apple、Android（含 TV）和 Electron，TV 不新增本地文件夹入口。
