# 播放、字幕与提供商请求头

路径按本仓库根目录解释。修改前核对当前源码和调用者；本文不宣称已完成运行验收。

## 职责与源码

- [file.ts](../../src/aliapi/file.ts)：下载/播放地址解析与 provider 分流。
- [playbackHeaders.ts](../../src/utils/playbackHeaders.ts)：播放请求头处理。
- [mpvPlaybackSession.ts](../../src/utils/mpvPlaybackSession.ts)：mpv 播放会话边界。
- [subtitleDiscovery.ts](../../src/utils/subtitleDiscovery.ts)：同目录字幕发现。

## 运行路径与状态

选中文件 → 所属 provider/account 解析 URL 和 headers → 当前播放会话 → 引擎和字幕消费方。URL 与 headers 是一个契约；不能在字幕、代理或外部播放器分支丢失账号身份。

## 失败与兼容边界

切集、关闭与重新打开后，过期请求和事件不能修改当前会话。视频 direct-play、字幕代理和 DLNA 有各自边界，不把修复一种路径自动扩展到其他路径。

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

## 2026-11-13 桌面音乐歌词行效果（本地源码）

`src/layout/music/MusicImmersiveStage.vue` 保留播放器/歌词面板布局；歌词使用原字号缩放配置与粗体层级，非当前行轻模糊，当前行清晰，点击/悬停/键盘焦点显示半透明圆角底。点击高亮持续 1.5 秒并复用既有 seek 事件。滚轮/触摸/键盘浏览暂停自动居中 6 秒，再恢复跟随；退出组件清理定时器。歌词区域的指针/滚轮不触发背后唱片架操作。未对桌面应用手机式底部自动隐藏，未改独立悬浮歌词窗口的布局或 IPC。

仅 Vue SFC script/template 解析与差异检查通过；未启动应用或进行视觉/E2E 验收。保留其他任务的 PageMusic、媒体识别与扫描修改。


## 2026-11-16 清爽界面统一并入视觉选项

“清爽播放界面”是现有视觉场景/预设组选项的第一张卡片，不再提供独立的粒子/清爽二选一菜单。选择清爽切换到普通封面；选择任一现有粒子场景/预设切回粒子播放器。清爽与粒子场景选中状态互斥，清爽不覆盖上次粒子场景和手调参数；性能档位继续独立。

Apple iOS/iPadOS/tvOS 复用 MusicParticleSceneControls；macOS 在控制台常用预设中提供同一入口并保存模式/撤销状态。Android Phone/Pad/TV 复用 MusicReferenceSettings.particleScenes；手机存档同时保存界面模式，TV 移除旧 showInterfaceChoices 子页。原有 GPU 场景编号不变，清爽不是新的 shader 编号。

Electron 与 Tauri 的现有视觉选项中同样新增清爽卡片；配置保存 playerInterface，旧配置缺少字段仍按粒子界面读取。清爽显示原生图片和标题，保留 DOM 歌词列表，停止创建 WebGL renderer；切回任一原有预设恢复粒子。DIY 简化/完整配置面板开关不是播放器界面切换，继续保留。

Electron 云视频在解析新地址前清除上个视频的清晰度控件。只有 Artplayer 已注册该控件时才移除，首次播放及单画质切片可直接继续地址解析。

从媒体服务器单集详情播放时，优先使用当前季已加载的选集。未加载季列表时复用首页的同剧集查询，并仅在返回列表包含当前集时使用。查询失败仍可播放当前集，切换详情或服务器后忽略旧查询结果。

## 网盘文件直播放进度

从文件列表启动的内置网页或 MPV 播放器按账号、盘 ID 和文件 ID 保存独立断点，并在首页「继续观看」显示。续播重新读取文件信息并走原账号取流。直播放进度保存在本机，媒体库播放继续使用其原有进度逻辑。外部播放器的时间轴由外部应用管理。
