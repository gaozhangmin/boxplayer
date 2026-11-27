<div align="center">

<a href="https://xbyvideohub.com/"><img src="screenshot/icon.svg" width="104" alt="BoxPlayer 图标"></a>

# BoxPlayer

**把硬盘、网盘、NAS 和媒体服务器里的内容，放进同一座媒体库。**

在电脑、手机、平板和电视上看电影、追剧、听歌、读书。全新的 Tauri 桌面端加入了网盘 Agent，可以把查找、归档和批量命名变成一份逐项可审的方案。

[![GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/gaozhangmin/boxplayer)](https://github.com/gaozhangmin/boxplayer/stargazers)

**[下载](#下载)** · **[快速开始](#快速开始)** · **[网盘 Agent](#网盘-agent)** · **[文档](#文档)** · **[社区](#社区)** · **简体中文** · [English](README.en.md)

<img src="screenshot/readme/movie-detail.png" width="1000" alt="BoxPlayer Tauri 版的《机器人总动员》详情，展示剧照、影片资料、演员和播放入口">

<sub>macOS Tauri 开发版实屏。影片资料与图片来自 TMDB。</sub>

</div>

> **Tauri 首版正在准备中。** 本页实屏展示开发版，Agent 和相关能力仍在整合。正式支持的平台、功能和安装包请查看 [首版发布跟踪 #540](https://github.com/gaozhangmin/boxplayer/issues/540)。

## 下载

| 设备 | 版本入口 |
| --- | --- |
| iPhone、iPad、Mac、Apple TV | [App Store](https://apps.apple.com/us/app/boxplayer/id6739804060) |
| Android 手机、平板、Android TV | [BoxPlayer 官网](https://xbyvideohub.com/) |
| Windows、Linux、macOS 桌面端 | [GitHub Releases · 已发布桌面版本](https://github.com/gaozhangmin/boxplayer/releases) |
| Tauri 桌面开发版 | [首版发布跟踪](https://github.com/gaozhangmin/boxplayer/issues/540) · [本地启动](#tauri-桌面端) |

各客户端支持的来源、格式和功能以对应版本为准。

## 快速开始

1. **加一个来源。** 在文件页添加本地文件夹，登录一个网盘，或连接 Emby、Jellyfin、Plex 等媒体服务器。
2. **打开一个文件，或建立媒体库。** 想马上看就直接点开视频。想按影视信息浏览，就选择影视目录进行扫描，随后在媒体库中按海报、季集和分类查看。
3. **下次接着看。** 从「继续观看」恢复播放，或者把常看的内容加入收藏和播放列表。

<img src="screenshot/readme/media-library.png" width="1000" alt="Tauri 桌面版媒体库，展示电影与系列的海报墙">

## 网盘 Agent

在 Tauri 开发版的「文件」页打开 **AI 助手**，从当前目录和所选文件开始。也可以从影视详情把一部电影或剧集交给网盘助手。需要在浏览其他目录时保留当前任务范围，可以锁定上下文。

<img src="screenshot/readme/drive-agent.png" width="1000" alt="Tauri 网盘助手实屏，左侧为会话、Recipes 和指令输入，右侧为方案 Diff、获取与巡检及运行证据">

### 按季整理剧集的实例

> 检查当前剧集目录，按季分文件夹，把能确认的集数统一命名为 `剧名.S01E01.ext` 这种格式。先给我预览，把集数不确定的文件列出来。

1. **限定目录。** 打开剧集所在目录并锁定上下文。只想处理几集时，先选中这些文件。
2. **审阅方案。** 打开「方案 Diff」，核对原路径、目标目录与新文件名，取消勾选有疑问的条目。
3. **执行并核对。** 点击「批准并执行所选」。执行前会重新检查来源和目标。完成后在「运行证据」中核对回执，符合条件的操作可撤销。

### Agent 可以帮你做什么

| 场景 | 使用方式 |
| --- | --- |
| 查找文件、盘点目录 | 查找指定片名，汇总文件结构、大小或可用空间。可搜索的范围取决于来源能力。 |
| 媒体归档、批量命名 | 用电影归档、剧集分季或批量重命名 Recipe 生成方案，再逐项确认。 |
| 导入分享 | 先浏览分享内容，选定文件和转存目标后提交方案。转存能力随网盘而异。 |
| 找源、补集和跟进 | 把作品交给 MediaScout，在「获取与巡检」中跟踪候选及任务结果。 |
| 重复处理目录 | 保存常用规则为 Recipe，或设置定时巡检，生成待审方案。 |

搜索、上传、转存和写入能力取决于网盘及账号权限。开发版支持自带模型密钥（BYOK）。可选的本地 MCP 服务默认关闭，开启后通过本机配对接入，外部客户端提交写入提案后仍需在 BoxPlayer 审批。

## 影片、音乐、阅读与文件

### 播放与媒体库

从网盘、局域网和媒体服务器直接打开视频。扫描影视目录可补齐海报、简介和季集信息。播放时可选择音轨、切换字幕和调整倍速，也可在支持的客户端使用外挂字幕或外部播放器。

### 网盘、网络共享与传输

| 来源 | 示例 |
| --- | --- |
| 网盘 | 阿里云盘、百度网盘、115、123、夸克、天翼云盘、Google Drive、OneDrive、Dropbox |
| 本地与网络文件 | 本地文件夹、SMB、NFS、WebDAV、AList |
| 媒体服务器 | Emby、Jellyfin、Plex |

多个来源可在文件页统一浏览。支持的网盘可上传、下载和转存分享，传输进度在应用内查看。

<img src="screenshot/readme/connect-sources.png" width="680" alt="Tauri 添加共享窗口显示本地文件夹、网络协议和云服务入口">

### 音乐、图书与文档

在音乐库按歌曲、歌手、专辑或歌单浏览，管理播放队列，在支持的播放器里看歌词。书架可阅读 EPUB、PDF 等图书，保存书签、批注和阅读进度。支持的客户端也提供文档预览和问答，托管 AI 等服务可在对应的 BoxPlayer Pro 版本中使用。

<img src="screenshot/readme/music-library.png" width="1000" alt="Tauri 音乐库实屏，显示分类、曲目列表和播放控制">

## Tauri 桌面端

新一代桌面端从 Electron 重构到 **Tauri 2**。Vue 界面运行在系统 WebView，Rust 原生层负责窗口、存储和媒体访问，macOS 开发版使用嵌入式 libmpv。新版源代码位于默认分支 `main` 的 [`tauri-app/`](tauri-app/)，Electron 工程的历史分支为 [`electron`](https://github.com/gaozhangmin/boxplayer/tree/electron)。

要在本机运行原生开发版，需要 Node.js 22.12 或更新版本、pnpm 10.32.1、与 `@types/bun` 版本一致的 Bun、Rust 和系统对应的 Tauri 开发依赖。将应用注册配置放在 `tauri-app/.local/provider-registration.ts`，也可使用 `BOXPLAYER_REGISTRATION_FILE` 指定配置文件。macOS 开发签名和播放器运行库的准备步骤见 [桌面开发指南](tauri-app/README.md)。

```sh
cd tauri-app
pnpm --ignore-workspace install --frozen-lockfile
pnpm tauri dev
```

开发实例使用独立的 Tauri 数据目录。前端检查可运行 `pnpm typecheck` 和 `pnpm test`。

## 文档

| 想了解什么 | 入口 |
| --- | --- |
| 首版什么时候可用 | [Tauri 首版发布跟踪](https://github.com/gaozhangmin/boxplayer/issues/540) |
| 来源与扫描如何接入 | [来源与扫描](docs/subsystems/media-library.md) · [服务商适配](docs/subsystems/providers.md) |
| 桌面播放如何工作 | [播放、原生网关与字幕](docs/subsystems/playback.md) |
| 如何开发和调试 Tauri | [桌面开发指南](tauri-app/README.md) · [迁移进度](docs/tauri-migration/progress.md) |
| 如何从终端整理文件 | [clouddrive-cli](clouddrive-cli/README.md)，含目录遍历、整理计划和 dry run |

## 社区

[GitHub Issues](https://github.com/gaozhangmin/boxplayer/issues) · [Telegram](https://t.me/+wjdFeQ7ZNNE1NmM1)

反馈问题时请附上客户端版本、操作系统、来源类型和复现步骤。Agent 问题可以附上已脱敏的方案或回执截图。

## 许可与致谢

本仓库采用 [GPL-3.0](LICENSE)。BoxPlayer 基于 [aliyunpan](https://github.com/liupan1890/aliyunpan) 继续开发，影视获取集成 [MediaScout](https://github.com/fancydirty/mediary-scout)。Tauri 的第三方组件见 [第三方声明](tauri-app/THIRD_PARTY_NOTICES.md)。请使用有权访问的媒体，并遵循所连接服务的条款。
