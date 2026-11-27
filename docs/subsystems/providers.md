# provider 与旧工程边界

路径按本仓库根目录解释。修改前核对当前源码和调用者；本文不宣称已完成运行验收。

本文涉及的 Tauri 迁移源码随 `codex/dev-tauri` 分支版本管理。原生验收使用 `tauri-app/`，不能用旧 Electron 根工程代替；源码已提交不代表目标平台已验收。

## 职责与源码

- `tauri-app/src/features/files/adapters/sourceServices.ts`（`codex/dev-tauri` 迁移源码）：文件来源服务适配。
- `tauri-app/src-tauri/src/accounts.rs`（`codex/dev-tauri` 迁移源码）：原生账号与请求身份。
- `tauri-app/src-tauri/src/file_manager.rs`（`codex/dev-tauri` 迁移源码）：本机文件管理。
- `tauri-app/src-tauri/src/network_share.rs`（`codex/dev-tauri` 迁移源码）：网络共享。

## 运行路径与状态

新 files 入口 → sourceServices/移植层 → 原生 provider 请求或文件管理。仅在确认运行路径后修改；不能因根目录有同名旧文件就当它仍被使用。

## 失败与兼容边界

Tauri 沿用 iOS 的 Emby 兼容 User-Agent 匹配规则：`drivemby.com` 与其子域，或主机名包含 `younoyes`、`onatoshi`。这些地址的 Emby 登录/API/封面，以及匹配的媒体播放、字幕和文件下载使用 `SenPlayer`。网关按每次跳转的目标主机重新判定，跨源凭据限制照常生效。

下方从旧入口迁移的 15 步 checklist 属于 Electron 接入参考。Tauri 应映射到自己的真实实现，不照抄 Electron IPC 命令或把旧测试作为原生通过。

OAuth 遇到构建时注入的 `synthetic-*` 注册占位值时按缺少注册配置处理。真实登录验收使用相应应用的有效注册，并以目标平台的授权回调与保存结果为准。

## 验证与维护

先读 [开发与执行约束](../agent-development.md) 和 [代码标准](../code-standards.md)。验证按本次用户要求及平台限制执行；未运行的测试、构建和真实设备检查要明确标注。契约改变时同步本文，并核对旧调用者。

## 既有产品规则

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

## clouddrive-cli

Standalone CLI + MCP server for agent-driven cloud-drive operations. Docs: `clouddrive-cli/README.md`. The CLI supports 8 providers and has its own npm package (`clouddrive-cli`). Separate test command: `pnpm run test:clouddrive-cli`.

## CLI 操作规则

使用 clouddrive-cli 时，先运行 `clouddrive-cli list --format json` 发现命令，再用 `clouddrive-cli providers capabilities --format json` 检查能力。破坏性操作先 dry-run；文件 ID 必须来自实际 list/walk/search/tree 结果，不能猜测；大结果用 `--output <file.json>`。

### 139 云盘官方登录

Tauri 支持在独立登录窗口使用 139 官网提供的认证方式。网页登录完成后，从成功的官方文件列表请求接收云盘凭据，再通过原生路由校验和账号存储保存来源。密码和短信验证码由官网处理。

## 已添加来源编辑与连接测试（2026-11-19）

Tauri 添加来源的已保存共享列表与旧来源管理入口均提供独立铅笔入口。编辑页复用原 accountId 更新名称/连接，不创建重复账号；密码留空沿用安全存储中的凭据，不回显密码。右上角“移除此共享”经过确认后仅移除本机账号，底部保存/网速测试/端点按钮等宽对齐；媒体服务器网速测试与端点管理复用既有实现。

添加共享时先显示连接测试反馈；SMB/NFS/FTP 和媒体服务器沿用原生连接/鉴权成功后保存的链路，WebDAV 改为使用尚未保存的草稿凭据执行根路径 PROPFIND（Depth 0），成功且返回有效 multistatus 后才 account_save。AList 令牌方式验证根目录列表后才保存。失败不生成账号，保留表单并用确认弹窗提示；取消中断原生 auth job 或前端 HTTP 测试，测试被取消后不继续 account_save。独立原生来源窗口使用 NativeServerRegistry/useNativeLogin 的同一反馈路径。
