# 文件页直接迁移记录

日期：2026-11-07。基准：Electron main de03329729ad06bd3c4a5ce8fcab6c2775a7ac10。修改仅位于 feat/tauri-migration 工作区，Electron main 不修改。

## 实现方式

文件页采用原文件迁入，而非继续逐项仿写。完整组件保留原 template/style；UnifiedMediaLibraryView.vue 的文件首页、侧栏、工具栏和菜单按原代码片段抽取。MediaPanRight 的目录渲染与菜单定义迁入独立组件。映射、原始快照、SHA-256 与明确的适配例外见 tauri-app/src/features/files/electron/upstream.json；运行 node scripts/verify-electron-files.mjs 可校验。

32 个原文件映射中，18 个组件模板逐字一致。并非所有文件可逐字复制：Electron IPC、Node 文件路径、Webview、账号存储与播放入口需要通过 Tauri 原生命令替代。对应实现集中于 features/files/adapters，文件列表原生控制器仅提供数据、目录导航和动作接口。

| 链路 | 原版组件/区域 | 适配范围 |
| --- | --- | --- |
| 文件根、侧栏、网格/列表、排序、选择、上下文菜单 | UnifiedMediaLibraryView 的原文件区域 | Tauri 来源模型、路由、持久化和工具栏挂载生命周期 |
| 目录与视频卡片 | MediaPanRight、FileBrowserCard、LocalMediaFileCard | 本地相对路径、远端分页、缩略图、播放队列与下载 |
| 添加/编辑与已存储共享 | AddFileSourceModal、FileSourceBrowser、SourceFormSurface | 受保护目录选择、凭据存储、账号更新 |
| 网盘登录 | UserLogin 原模板/样式 | 原生登录会话；Ali Webview 替换为二维码；移除用户明确不要的自定义 client_id |
| 服务器/Plex | AddMediaServerModal、PlexResourcesModal、测速弹窗 | 原生发现、资源不透明标识、连接更新与测速 |
| 视频操作弹窗 | 元数据、个人评分、分享、集合选择 | 原生目录持久化、TMDB、Trakt、剪贴板与分享接口 |

保留已批准的绿色主题、本地及远端收藏目录五角星图标。播放器保持现状。其他平台不修改；本轮是 Tauri 迁移，Electron 为只读基准。

## 验证

- 前端全量测试：54 文件、311 项通过。
- Rust 测试：109 通过、10 忽略；被忽略项不算验收通过。
- 类型检查、前端构建、macOS debug app 打包通过。
- 来源快照检查：32 映射、18 精确模板、2 位图通过。
- 新原生包实屏：文件根工具栏、卡片上下文八项菜单、本地 testVideo 目录、视频上下文菜单、添加来源列表、Emby 表单显示正常；本地收藏侧栏显示五角星。页面切换曾发现 Teleport 宿主生命周期错误，已使用 mounted-ready 适配修复，并在新包确认。
- 目录循环/随机播放动作通过原生队列接口传递，不再降级成打开目录；继续观看新增/移除按实际状态适配。

真实网盘和服务器账号登录、远端目录/播放/下载、Plex 真实资源发现由后续真实账号验证确认。原生鼠标拖拽受界面工具限制，只有指针状态机回归测试通过，不宣称实屏拖拽通过。此记录不等于 M3 真实账号验收完成，也不推进到 M4。
