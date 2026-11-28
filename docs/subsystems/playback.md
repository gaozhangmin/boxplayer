# 原生播放、网关与字幕

播放中的窗口采用 Frame Player 的标题栏、时间轴和三组控件布局。工具条将音量与速度放在左侧，上一项、播放／暂停和下一项放在中央，循环、队列、音轨、字幕、视频设置、投屏、画中画和全屏保留在播放工具区。现有 BoxPlayer 的窗口状态、快捷键、设置、播放事件和原生内核继续由原来的实现处理。

路径按本仓库根目录解释。修改前核对当前源码和调用者；本文不宣称已完成运行验收。

本文涉及的 Tauri 迁移源码随 `codex/dev-tauri` 分支版本管理。原生验收使用 `tauri-app/`，不能用旧 Electron 根工程代替；源码已提交不代表目标平台已验收。

## 职责与源码

- `tauri-app/src/features/player/usePlayer.ts`（`codex/dev-tauri` 迁移源码）：播放器 UI 与会话适配。
- `tauri-app/src-tauri/src/player/mod.rs`（`codex/dev-tauri` 迁移源码）：原生播放实现。
- `tauri-app/src-tauri/src/gateway.rs`（`codex/dev-tauri` 迁移源码）：媒体请求网关。
- `tauri-app/src-tauri/src/server_playback.rs`（`codex/dev-tauri` 迁移源码）：媒体服务器播放。

## 运行路径与状态

播放意图 → 原生会话 → 准备媒体/网关 → 引擎状态 → UI。浏览器预览不提供相同原生能力；只看到页面或按钮不构成播放验收。

刮削详情和海报墙通过 `player_open_catalog_queue` 提交队列，直接文件通过 `player_open_file` 或 `player_open_local` 打开。入口在 `commands.rs` 的 `start` 合流，复用同一个 `player.html` 播放窗口。

播放器页面初始和加载时使用不透明黑底。收到当前嵌入播放会话的有效视频尺寸后，背景变透明以显示原生视频层。切换媒体时清空旧尺寸。

## 失败与兼容边界

Range、重定向、凭据、取消及一次刷新需沿网关实际调用者核对。Windows/Linux 嵌入、HDR 显示输出和 macOS 编译属于不同证据，不能相互替代。

## 验证与维护

先读 [开发与执行约束](../agent-development.md) 和 [代码标准](../code-standards.md)。验证按本次用户要求及平台限制执行；未运行的测试、构建和真实设备检查要明确标注。契约改变时同步本文，并核对旧调用者。

## 既有产品规则

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

## 网盘文件直播放进度

原生网盘文件队列使用本机 SQLite 独立的文件续播记录，按账号和文件 ID 写入断点和时长。首页「继续观看」读取当前来源的记录，并通过原生来源队列重新解析取流。媒体库队列仍读取原播放进度，完成的直播放文件从续播列表移除。
