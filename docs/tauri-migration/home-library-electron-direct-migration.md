# 主屏幕与媒体库原文件迁移记录

日期：2026-11-07。只读基准：Electron main `de03329729ad06bd3c4a5ce8fcab6c2775a7ac10`。实施位置：`boxplayer-tauri` 的 `feat/tauri-migration`；Electron main 保持干净，不提交、不发布。

## 迁移方式

用 Electron 原文件替换此前独立重写的 UI，不以截图逐项仿写作为实现方式。

- 完整组件直接迁入：UnifiedLibraryBrowser、UnifiedMediaRow、UnifiedHomeManagement、HomeShelfViewport、MediaDetail、MediaPosterMenu、LibraryObjectActions、TraktAccountModal、CustomMediaSeriesModal、评分/观看/空海报等组件。
- UnifiedMediaLibraryView 同时耦合视频、音乐、图书、文件和 Electron 全局导航。主屏幕横排、收藏网格、媒体库设置、侧栏、工具栏、排序下拉、集合/命名弹窗、收藏拖拽状态机和 localRow 分组逻辑从该原文件抽取；宿主只提供 Tauri 路由、工具栏挂载和数据接口。
- 分类筛选、年份/评分/网络分组、图标映射、版本偏好、合集、详情恢复/集合逻辑直接复用原工具文件。音乐/图书保持后续单独处理，播放器不改。
- 原文件快照、原始及目标 SHA-256、适配说明保存在 `tauri-app/src/features/library/electron/upstream.json` 和 `src/vendor/electron-library/upstream`。35 项映射中有 14 个完整组件模板逐字一致。大入口抽取及详情能力适配不冒充完整文件逐字一致。

校验：在 tauri-app 执行 `node scripts/verify-electron-library.mjs`；文件页仍执行 `node scripts/verify-electron-files.mjs`。

## 原生适配

| 边界 | 实现与保留行为 |
| --- | --- |
| 来源与媒体模型 | adapters/libraryData 将原生稳定文件身份投影到原版 driveFiles、季、集、版本模型；真实两集不会被扩成演示五集；同集多版本仍在同一集下 |
| 收藏与主屏幕 | 保持互斥类别放置、独立子类别、收藏统一顺序；来源菜单复用已迁入的 Files 菜单，取消分类快捷方式不会退出账号 |
| 视频详情 | 原版详情/版本选择/季集/标签/播放列表；原生播放、队列、循环、下载保留文件所属账号，显式版本先播放；不把原生 ID 当远端 fileId 请求 |
| 元数据与显示 | 原版 TMDB 搜索与匹配 UI；季集元数据和 credits 等原始详情按 JSON 持久化，避免 Vue Proxy 导致 structuredClone 失败；替换源代码固定时长/分辨率标签为真实字段 |
| 原生图片 | 封面通过账号绑定的原生下载取得 Blob，销毁时释放；缺失本地海报使用原生缩略图，不向 img 注入凭据 |
| 主页管理与服务器 | 原版管理弹窗；服务器可见项投影回各账号原生偏好；横排用原版行组件，窗口可见时加载封面；保留失败提示 |
| Trakt、评分、分享 | 原版模板；原生登录轮询/取消、凭据与同步适配，失败不会当作成功持久化 |
| 宿主 | 原版页头/侧栏模板，Tauri 窗口拖动及系统按钮仍由宿主提供；绿色主题与本地/远端收藏目录五角星保留；侧栏滚动不挤出底部操作区 |

## 尚未完成的功能边界

原版详情的“一键补全／追更”依赖 Electron main/boxplayer 工作流。该引擎的存储/状态服务已继续迁移（见 [原引擎迁移记录](boxplayer-electron-direct-migration.md)），但模型与网盘执行接口尚未接通，入口保留原样式但禁用并说明当前版本不支持；不能据此宣布整个 Electron 视频模块已 100% 功能复原。未提供伪造的任务成功、追更状态或占位服务端 API。

真实网盘/Emby/Jellyfin/Plex/Trakt 登录、真实服务器封面和播放写入，仍按用户安排后续验收。本轮不读取或改写 Electron 账号、媒体库数据库，不推进旧库迁移或完整 M4 验收。

## 验证记录

- 前端：55 文件、319 项测试通过，包含原有 40 项工作区行为回归及 8 项新增原生映射测试。
- 类型检查、前端生产构建、macOS arm64 debug app 打包通过；产物为 `tauri-app/src-tauri/target/debug/bundle/macos/BoxPlayer Dev.app`，约 122.36 MiB。
- 来源校验：主屏幕/媒体库 35 映射、14 精确模板、4 资源；文件页 32 映射、18 精确模板、2 资源，均通过。
- 连接现有 Electron 只读核对主页入口、侧栏顺序和工具栏；Tauri 新包已重启，核对主屏幕、主页管理弹窗、收藏媒体库的八类索引、网格/列表切换、原版分类菜单、独立媒体库设置页、侧栏折叠与底部区。
- 本机坐标输入工具返回 noWindowsAvailable，后台窗口截图存在重绘滞后。因此原生验证以实际控件树和界面操作结果为主，不宣称鼠标拖拽或逐像素验收通过。指针状态机由自动回归覆盖。
- 当前机器仅构建运行 macOS arm64。Windows/Linux、macOS x64 未打包验收；Apple 原生、Android 和 Electron 代码均未修改。

### 继续核对：侧栏路由归属

- 修正 Tauri 侧栏适配：主屏幕中的电影、电视、类型、评价、发行日期、系列、播放列表和独立子分类全部保留 Home 路由归属，不再点击后跳到媒体库分组高亮；媒体库内点击仍保留 Library 归属。原版组件模板不变。
- 新增 8 项回归，包括父类型隐藏后独立子类型仍可导航和选中。全套 55 文件、327 项通过；调整子分类测试夹具为真实 `:group:` 身份后，侧栏 10 项专项回归通过。类型检查、生产前端构建、macOS arm64 debug app 重新打包通过。
- 来源校验仍为媒体库 35 映射 / 14 精确模板、文件页 32 映射 / 18 精确模板。Electron main 工作区保持干净。
- 本次原生连接被 macOS ScreenCaptureKit 捕捉错误阻断，未能重启或核验新包实屏。不能把本次构建及自动测试当作实屏验收。“一键补全／追更”仍未实现，本次只读梳理其依赖，没有解除入口禁用。
