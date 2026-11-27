<p align="center"><img src="screenshot/icon.svg" alt="BoxPlayer" width="96"></p>

# BoxPlayer · Tauri 桌面版

**在一处浏览本地文件、网盘和媒体服务器，用网盘 Agent 查找资源、整理文件和跟进任务。**

[English](README.en.md) · [首版发布动态](https://github.com/gaozhangmin/boxplayer/issues/540) · [GitHub Releases](https://github.com/gaozhangmin/boxplayer/releases) · [官网](https://boxplayer.cc/)

> **首版准备中。** `main` 是 Tauri 桌面版的源码入口。下面的 Agent 功能来自开发预览，相关实现仍在整合。首版支持的平台、网盘和安装包以正式发布说明为准。现有 Electron 桌面版请查看 [`electron` 分支](https://github.com/gaozhangmin/boxplayer/tree/electron)。

## 网盘 Agent

在文件页打开 **AI 助手**，就能围绕当前目录或选中的文件提问。需要处理多个来源或跟进长任务时，打开完整的 **网盘助手** 工作区。锁定上下文后，可以去其他目录浏览，手头的任务仍使用原来的范围。

| 你想做什么 | 可以怎么说 |
| --- | --- |
| 查找和盘点 | “在已连接的来源里找这部影片，再看看哪些网盘还有空间。” |
| 整理影视文件 | “预览把当前目录里的剧集按季归档的方案。” |
| 检查分享与转存 | “列出这个分享里的视频，让我选择要保存的文件。” |
| 跟进影视资源 | “为这部剧创建追更任务，找到新一集时告诉我。” |
| 批量操作 | “检查这个目录的命名和重复文件，告诉我哪些值得整理。” |

![BoxPlayer 网盘助手开发预览，左侧为对话和 Recipes，右侧为方案面板](docs/tauri-migration/evidence/ui-style/boxplayer-agent-workspace.png)

*macOS 开发版，使用本地示例媒体。*

### 先看方案，再批准写入

1. **选定范围。** 从当前目录或选中的文件开始。需要时锁定上下文。
2. **查看改动。** 在方案面板里核对新建、移动、重命名等操作，按需取消其中的项目。
3. **确认执行。** Agent 在写入前再次检查来源和目标。部分高风险操作需要额外确认。
4. **追踪结果。** 在工作区查看任务进度、执行记录和失败原因。符合条件的操作支持撤销。

**Recipes** 把剧集分季、电影归档、批量命名等重复操作做成可复用流程。定时运行可以准备方案，需要写入时由你审批。开发版也提供可选的本地 MCP 接入，默认关闭。网盘的搜索、转存、写入和撤销能力取决于提供商及账号权限。

## 用 Tauri 重做桌面端

新版用 Tauri 2 和系统 WebView 承载 Vue 界面，通过原生服务连接账号、文件、传输队列和播放器。macOS 开发版使用嵌入式 libmpv。媒体库、继续观看、文件浏览和传输各有独立入口。

![BoxPlayer Tauri 开发版的文件工作区](docs/tauri-migration/evidence/ui-style/boxplayer-files-native.png)

*macOS 上的 Tauri 开发版文件工作区。*

## 从源码运行

需要 Node.js 22.12 或更新版本、pnpm 10.32.1、Rust，以及对应平台的 Tauri 开发依赖。使用已有的开发注册配置，必要时通过 `BOXPLAYER_REGISTRATION_FILE` 指向该文件。macOS 的开发签名与 libmpv 运行库准备见 [Tauri 开发说明](tauri-app/README.md)。

```sh
cd tauri-app
pnpm --ignore-workspace install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev` 打开浏览器预览。原生播放、账号、系统集成和 Agent 运行在原生应用中。开发版使用独立的数据目录，请保留现有 Electron 用户数据。检查前端可运行 `pnpm typecheck` 和 `pnpm test`。

## 反馈与贡献

- 反馈时请附上操作系统、应用版本或提交、来源类型及复现步骤。 [GitHub Issues](https://github.com/gaozhangmin/boxplayer/issues)
- 了解工程进度及历史验证范围。 [迁移进度](docs/tauri-migration/progress.md) · [子系统文档](docs/subsystems/README.md)
- BoxPlayer 基于 [aliyunpan](https://github.com/liupan1890/aliyunpan) 继续开发，影视资源获取集成 [MediaScout](https://github.com/fancydirty/mediary-scout)。 [GPL-3.0 许可证](LICENSE)
