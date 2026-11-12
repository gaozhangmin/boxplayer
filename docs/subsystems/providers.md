# 网盘接入与下载

路径按本仓库根目录解释。修改前核对当前源码和调用者；本文不宣称已完成运行验收。

## 职责与源码

- [file.ts](../../src/aliapi/file.ts)：统一文件详情和下载地址入口。
- [filecmd.ts](../../src/aliapi/filecmd.ts)：文件操作分流。
- [pandal.ts](../../src/pan/pandal.ts)：目录和搜索加载。
- [uploader.ts](../../src/workerpage/uploader.ts)：上传 worker 的 provider 分流。

## 运行路径与状态

账号/provider 识别 → 目录和模型映射 → 操作能力 → 地址解析/上传/下载 → 扫描与字幕。每个入口都应按文件所属账号分流，不能掉入阿里云默认路径。

## 失败与兼容边界

提供商能力来自实际 API；不支持的分享、回收站、版本、转码或加密操作应隐藏或明确报错。CLI 破坏性操作先 dry-run，保留现有账号与文件。

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
