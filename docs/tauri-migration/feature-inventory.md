# BoxPlayer 迁移到 Tauri 2 + Vue 3 + Rust：功能清单与可迁移性

依据：boxplayer v5.0.38 源码，对照 cc-switch v4.0.25 架构，来源层级参考 XbyVideoHub macOS；非播放器界面样式以 Infuse macOS 为准。最后更新：2026-11-06（前端改为保留 Vue 3，见 D1、D12、1.2）。

**怎么用这份文档**：第 4 节每行最后的「保留」列，已经按你的决定填了 ✔、✘、⏸。空着的是还没决定的，请填 ✔ 或 ✘。填之前可以先看第 5 节，舍弃某些功能会连带省掉它依赖的基础设施。填完后我按保留下来的功能出实施计划。

实施入口：[迁移实施计划](implementation-plan.md)（里程碑、接口、验收与功能映射）；当前状态：[迁移进度](progress.md)。功能取舍以本文件为准。

## 0. 已定决策

| # | 决策 | 影响的条目 |
|---|---|---|
| D1 | 壳和后端与 cc-switch 一致：Tauri 2 + Rust；前端保留 Vue 3（升到 3.5）+ TypeScript + Vite，不换 React（2026-11-06 修订，原为 React，理由见 1.2） | 第 1 节 |
| D2 | 视频只保留一种播放方式（mpv）。内置网页播放器、外部播放器都舍弃。原定的「方案 A：独立 mpv 窗口」已被 D16 取代，降为备用方案 | #36–#38、#42、#46 ✘；细节见第 6 节 |
| D3 | 舍弃传输、分享、插件三个标签页；网盘标签页只舍弃左侧边栏（目录树、盘切换），右侧内容区见 D9 | #28、#30–#35 ✘ |
| D4 | 上传和下载移到「新增文件源」弹窗里已存储文件源的文件浏览器内 | 新增 #99；#21、#22 ✔ |
| D5 | 下载和上传都自研，不再基于 aria2 | #23、#24 ✘；设计见第 7 节 |
| D6 | 舍弃阿里相册、在线解压、文件加密、M3U8 下载 | #17、#18、#19、#29 ✘ |
| D7 | 非播放器界面以 Infuse macOS 的实际界面统一样式；沿用 BoxPlayer 图标和绿色。主屏幕/媒体库/文件同级及来源平铺逻辑参考原 macOS/Electron。用户明确播放器保留现有 soia UI；先修改已有页面，不为凑 Infuse 页面提前添加后续功能（2026-11-06 追加） | 新增 #102；见第 3 节 |
| D8 | AI 工作台第一版不迁移，在新架构下重新设计后再实现 | #69、#75 ⏸ |
| D9 | 网盘标签页**右侧内容区的全部功能**，在「新增文件源」弹窗的文件源浏览器里实现。D6 已舍弃的项、你已确认舍弃的连带项除外 | #99 扩展；#14–#16、#103–#117 ✔；清单见 4.3 |
| D10 | 第一版**不改写网盘 SDK**，继续用现有 TS 实现；按 8.7 留好接口，以后可以逐个网盘换成 Rust。上传因此采用 7.2 的做法 A | 8.7；7.2 |
| D11 | #66 Office 转 PDF、#76 无边框窗口、#78 单实例与协议唤起、#87 日志改回保留 | #66、#76、#78、#87 ✔ |
| D12 | 前端组件库采用 cc-switch 同一套方案的 Vue 版：shadcn-vue（基于 Reka UI + Tailwind CSS），图标用 lucide-vue-next，提示用 vue-sonner；Arco Design Vue、ant-design-vue 逐步替换掉（2026-11-06 修订，原为 React 版 shadcn/ui） | 1.1 |
| D13 | 文件源浏览器保持现在的弹窗尺寸（840px 宽） | 3.5 |
| D14 | 去掉好运瓶 | #113 ✘ |
| D15 | Linux 发布 deb、rpm、AppImage 三种（x64、arm64），全部由 Tauri 直接生成；不再发布 pacman，第一版不做 Flatpak | 6.5；第 9 节第 7 项 |
| D16 | 视频播放器：界面和播放逻辑用 [soia](https://github.com/FengZeng/soia)（Vue 3 + Rust，开源部分），把它依赖的闭源 `soia_utils` 换成参考 [Frame Player](https://github.com/risenxxx/frame-player) 自己实现的原生渲染层（mpv `--wid` 画进 WebView 下面的原生视图；macOS 用 Frame 的 libmpv 补丁）。画面在应用窗口里，播放界面是独立的播放窗口 | #95 改写；#43 🔁；#39 恢复可选；第 6 节 |
| D17 | 原生渲染层按平台分：**Windows、Linux 直接用 soia 的 `soia_utils`**（这两个平台不需要作者授权）；**macOS 参照 Frame 自己实现**（`--wid` 补丁版 libmpv），不用 `soia_utils` | 6.2 |

**连带舍弃（你已确认）**：#40 雪碧图预览、#45 DLNA 投屏、#25 URL 下载与种子下载、#26 123 和 115 离线下载（含 115 种子「云下载」和离线任务管理）。这几项虽然有的在网盘页右侧内容区，按你的确认不进入文件源浏览器。媒体获取（#73）会调用离线下载接口，这部分接口逻辑留着，只是没有界面。

**D9 里排除的网盘页功能**（属于 D6 或上面的连带项）：创建相册、移入和移出相册、相册切换、上传照片/视频到相册；双击压缩包在线解压；加密新建、私密新建、加密上传、私密上传、标记加密、加密密码弹窗；M3U8 下载；雪碧图；DLNA 投屏；云下载与 115 种子云下载；好运瓶（D14）。


## 1. 架构对照

| 层 | 现在（Electron） | 目标（壳和后端同 cc-switch） |
|---|---|---|
| 壳 | Electron 40，三平台都是 Chromium | Tauri 2，用系统 WebView：macOS WKWebView、Windows WebView2、Linux WebKitGTK |
| 前端 | Vue 3.4 + Pinia + Arco Design Vue：256 个 `.vue` 约 11.2 万行，593 个 TS 文件约 10 万行 | Vue 3.5 + Pinia + TypeScript + Vite，组件库换成 shadcn-vue（D12，见 1.1）；和 soia 播放界面同一个框架 |
| 后端 | 主进程 TS 约 1.1 万行；渲染进程开了 `nodeIntegration`、关了 `webSecurity`，50 个文件直接用 fs/http/net/crypto | Rust（tokio、reqwest、axum、rusqlite），前端只通过 `invoke` 和事件通信 |
| 视频内核 | N-API libmpv 纹理插件 + Electron `sharedTexture`；Artplayer 网页播放器；用户自选外部播放器 | soia 的 Rust 播放逻辑 + 参考 Frame Player 自研的原生渲染层（libmpv `--wid`），播放窗口用 soia 的 Vue 界面（D16） |
| 下载与上传 | aria2c（`static/engine`）+ 隐藏的上传、下载工作窗口 | Rust 自研传输引擎（第 7 节） |
| 数据库 | 渲染进程 Dexie（IndexedDB）+ 主进程 5 个 better-sqlite3 库 | Rust rusqlite 为主；Dexie 可在 WebView 里继续用 |
| 外部程序 | LibreOffice、Java + Python（OpenDataLoader） | 继续调用用户已安装的程序 |

### 1.1 前端技术栈（D12，cc-switch 方案的 Vue 版）

来源：`cc-switch/package.json`、`cc-switch/components.json`、`cc-switch/src/components/ui/`。cc-switch 用 React；下表第三列是 BoxPlayer 采用的 Vue 对应库。

| 用途 | cc-switch 用的库 | BoxPlayer 采用 | BoxPlayer 现在的 |
|---|---|---|---|
| 基础组件 | shadcn/ui：组件源码直接复制进项目（`src/components/ui/` 下 32 个，如 button、dialog、dropdown-menu、tabs、select、tooltip、sheet、table），底层是 Radix UI | shadcn-vue：同样把组件源码复制进 `src/components/ui/`，底层是 Reka UI | Arco Design Vue、ant-design-vue |
| 样式 | Tailwind CSS 3 + tailwind-merge + class-variance-authority；主题用 CSS 变量 | Tailwind CSS 4 + @tailwindcss/vite + tailwind-merge + class-variance-authority；M1 按当前 shadcn-vue 的 Vite 配置实现并锁定版本，主题用 CSS 变量 | less + 各组件自带样式 |
| 图标 | lucide-react | lucide-vue-next（已经在用，同一套图标） | lucide-vue-next、IconFont |
| 提示 | sonner | vue-sonner | Arco 的 Message |
| 表单 | react-hook-form + zod | vee-validate + zod（shadcn-vue 的 Form 组件用的就是它） | 手写；zod 已经在用 |
| 后端数据 | TanStack Query | @tanstack/vue-query 管从 Rust 取来的数据；纯前端状态继续用 Pinia（见 8.6） | Pinia |
| 长列表 | TanStack Virtual | @tanstack/vue-virtual；文件列表、媒体墙要用 | Arco 虚拟列表 |
| 其他 | framer-motion（动画）、dnd-kit（拖拽排序）、i18next（多语言）、cmdk（命令面板）、recharts（图表） | 动画用 Vue 自带的 Transition，复杂的再用 motion-v；拖拽排序用 vue-draggable-plus；多语言沿用自写 i18n（`src/i18n/index.ts`），播放窗口也接这一套；命令面板用 shadcn-vue 的 Command；图表按需再选 | 自写 i18n |

shadcn-vue 的组件代码在项目里，可以直接改样式，做 XbyVideoHub 风格的侧边栏和玻璃效果比较方便。soia 的播放界面没有用组件库（只依赖 `vue` 和 Tauri 插件），以后可以按需把它的弹层、菜单换成同一套 shadcn-vue 组件。

### 1.2 为什么前端保留 Vue（2026-11-06）

原方案照 cc-switch 换成 React。重新评估后改为保留 Vue，原因：

1. **cc-switch 值得照搬的是 Tauri 和 Rust 这一层**（命令、事件、插件、托盘、窗口配置、打包），和前端框架无关。它的业务界面和 BoxPlayer 无关，能直接借用的只有基础组件和设置页外壳，Vue 生态都有对应的库（1.1）。
2. **播放器界面本来就是 Vue。** D16 采用的 soia 是 Vue 3.5。用 React 的话主窗口和播放窗口是两套框架，要做多页面混合构建，组件、样式、多语言各维护一份（原 6.4 第 6 条风险）。保留 Vue 后这条风险没有了。
3. **业务代码改动少很多。** 36 个 Pinia store 和调用它们的 64 个 TS 文件不用动，也不用引入 zustand；83 个调用 Arco `message` 封装的文件只要把封装本身改接 vue-sonner（8.6）。
4. **网盘内容区和各种弹窗可以移植，不必重写。** `PanRight.vue`（1732 行）、`RenameMultiModal`（1216 行）、`SelectPanDirModal`（1055 行）、`ShuXingModal`（908 行）等，模板和逻辑基本照搬，主要工作是把 Arco 组件换成 shadcn-vue、把 Node IO 换成 `invoke`。

不受影响的部分：主窗口框架（#102）、媒体库海报墙等按第 3 节重做的界面，用哪个框架都是新写，工作量不变。

## 2. 判定标准

- ✅ 可迁移：Tauri 有等价能力，或是纯前端逻辑。界面沿用 Vue，组件库换成 shadcn-vue，IO 调用换成 Rust 命令即可。
- 🟡 可迁移但要重做：Node 代码要改写成 Rust，或三个平台 WebView 表现不同，需要额外适配。
- 🔴 没有等价方案：只能降级、换实现方式，或风险很高。
- 🔁 已被替代：由已定方案取代，不再单独迁移。
- ⚫ 现在就是空壳：只有界面没有逻辑，舍弃没有损失。

工作量为单人粗估：S 小于 1 周，M 1 到 3 周，L 1 到 2 个月，XL 2 个月以上。带界面的功能都已包含界面工作的成本：按第 3 节重做的界面算新写，其余按「Vue 组件移植 + 换组件库」算。

「保留」列：✔ 保留，✘ 舍弃，⏸ 第一版不做、以后再说，空着表示待你决定。

## 3. 新界面结构（参考 XbyVideoHub macOS）

### 3.1 XbyVideoHub macOS 的窗口结构

来源：`XbyVideoHub/BoxPlayer macOS/Views/MainWindowsView.swift`、`App/BoxPlayerApp.swift`。

- 主窗口是 `NavigationSplitView`，左侧边栏宽 250–280pt，可以折叠成 82–94pt 的图标栏（`MacCollapsedSidebarView`，只剩搜索、主屏幕、媒体库、文件四个图标）。
- 侧边栏顶部是搜索框，回车进入全局搜索。
- 侧边栏分三组：
  - **主屏幕**：子项是主页的各个分区，加上收藏夹和音乐。
  - **媒体库**：收藏夹、播放列表、自定义合集、最近添加、未观看、每日推荐、电影、剧集、其他、音乐、所有电影、所有剧集、迷你剧、按类型、按电视网、按评分、按发行日期、分级、分辨率、演唱会、短视频。
  - **文件**：统一的可点击入口，不再分「本地文件夹」「文件源」两类。子项直接按实际名称平铺：已添加的本地文件夹；网盘/共享未收藏任何目录时显示源本身，有收藏后显示收藏目录（整盘与子目录可并存）；媒体服务器。隐藏「本机」根占位，保留真实本地目录。只有保存过直接播放 URL 才显示对应入口。没有来源时只保留「文件」入口，不造分类或演示条目。实现依据：`MainWindowsView.dynamicEntries` 的 `.files` children，点击父项进入 `MacDriveServerHomeView`。
- 侧边栏底部：折叠按钮、Pro 订阅入口，以及账号菜单（设置、反馈与工单、检查更新、退出登录、外观）。
- Tauri 界面主题色采用森林绿：浅色 `#276749`，深色 `#82C79B`；主按钮、选中项、导航图标和焦点状态共用主题变量。应用图标沿用现有 BoxPlayer 正式品牌图标（`static/images/icon_1024x1024.png`），不使用临时播放三角标识。
- 工具栏用 unified 样式，返回按钮和操作按钮放在统一高度的玻璃胶囊里（`MacToolbarGlassCapsule`）。
- 设置是独立窗口（880×800，`unifiedCompact` 工具栏）。

### 3.2 现有标签页到新界面的对应

| 现在的顶部标签 | 新界面 |
|---|---|
| 网盘 | 左侧边栏舍弃；右侧内容区的功能搬进文件源浏览器（#99，见 3.5 和 4.3） |
| 传输 | 舍弃。传输任务列表放进文件源浏览器（#99） |
| 分享 | 舍弃 |
| 插件（工具箱） | 舍弃 |
| 媒体库 | 主界面。它现有的分区 `home`、`video`、`collection`、`files`、`music`、`book`、`server` 拆成侧边栏的「主屏幕」「媒体库」「文件」三组；书架（如保留 #62）放在「媒体库」组 |
| 搜索 | 侧边栏顶部搜索框，结果页见 #100（待定） |
| AI 工作台 | 第一版不做（⏸） |
| 设置 | 独立设置窗口，设置项随舍弃的功能精简（3.4） |

### 3.3 三个平台的外观

- **macOS**：`titleBarStyle: Overlay` 加红绿灯位置（cc-switch 已有同样的配置）；侧边栏用 Tauri 窗口配置的 `windowEffects`，取 macOS 的 sidebar 材质。
- **Windows**：去掉系统标题栏，用应用内的窗口按钮（cc-switch 在 Windows 上的做法）；Windows 11 可以用 Mica 效果。
- **Linux**：没有原生模糊，用纯色背景；是否保留系统标题栏做成设置项（cc-switch 的 `use_app_window_controls`）。
- 折叠侧边栏、玻璃胶囊工具栏都用 CSS 实现，三个平台共用。

### 3.4 设置窗口的精简

| 现在的设置页 | 处理 |
|---|---|
| `SettingAria`、`SettingDownloadAdvanced`（全部是 aria2、BT、tracker、做种设置） | 删除 |
| `SettingSecurity`（文件加密算法和密码，以及隐藏备份盘、资源盘等网盘页显示项） | 删除 |
| `SettingPan`（网盘页的显示设置：排序、列表模式、文件夹大小、文件夹预览、颜色标记、日期文件夹格式等） | 按 D9 保留，改名「文件浏览」，作用于文件源浏览器；去掉只和左侧目录树有关的项 |
| `SettingPlay` | 删除网页播放器和外部播放器相关项，只留 mpv 相关项 |
| `SettingDown`、`SettingUpload` | 合并成「传输」设置，去掉 aria2 字段，接到自研引擎（第 7 节） |
| `SettingDanmaku` | 只在保留 #98（mpv 弹幕）时留下 |
| `SettingWebDav` | 只在保留 #89（WebDAV 服务器）时留下 |
| 其余（常规、界面、账号、代理、媒体服务器播放、剧集版本、日志、调试、反馈） | 保留，按新界面重排 |

### 3.5 文件源浏览器（承接网盘页右侧内容区）

**后续实施约束（2026-11-09 记录，来源为本会话用户要求）**：用户在迁移过程中明确要求文件页整条链路直接迁移 Electron 原文件，仅适配 Tauri 底层，UI 与交互保留原版。下文早期提出的工具栏重新收纳、选中操作栏替换，以及特殊视图改成根目录虚拟列表项，是原计划的重新设计建议；与上述直接迁移要求冲突时，以后者为准。当前保留原版 `PanRight`、`DirTopPath`、`PanTopbtn`：回收站/收藏/正在观看使用原根路径下拉，全部专辑保留原视频视图工具栏入口；不额外仿写根目录卡片或第二套导航。840px 外壳、窄区适配、按提供商能力裁剪、舍弃项和 M6 传输边界不变。此澄清不豁免任何保留功能或交互的验收。

现在的「新增文件源」弹窗（`AddFileSourceModal.vue`，宽 840px）左边是「已存储的共享」列表（添加、本机、各个已保存的源），右边是 `FileSourceBrowser.vue`。按 D9，右边要装下网盘页右侧内容区的全部功能，具体条目见 4.3。界面上需要几处调整：

- **尺寸**：保持现在的 840px 宽（D13）。去掉左边的源列表，右侧浏览区大约只有 550–600px 宽，网盘页的功能要这样收纳：
  - 工具栏只露出最常用的几个按钮（返回、上传、新建、搜索、视图切换），其余操作放进「更多」菜单和右键菜单；
  - 选中文件后，工具栏换成多选操作栏（下载、移动、删除等），不另占一行；
  - 网格视图按宽度自动减少列数；
  - 传输任务面板做成工具栏上的弹出层，不占列表空间。
- **特殊视图的入口**：回收站、收藏夹、正在观看、全部专辑原来都从网盘页左侧边栏进入。侧边栏不做之后，把它们放在每个源根目录列表的顶部，和现在的「所有文件夹」并列。
- **按网盘能力显示操作**：网盘页现在用 `src/drive/providerFeatures.ts` 和各网盘的 `capabilities.ts` 决定显示哪些按钮（能否新建、重命名、移动、复制、上传、分享、导入、回收站等）。新浏览器沿用这套能力清单，不同网盘自动显示不同的操作。
- **不同类型的源**：
  - 网盘、WebDAV、AList：网盘页的全部功能，按能力清单裁剪。
  - 本机文件夹：浏览、打开预览、加入媒体库；「下载」就是复制到下载目录。
  - Jellyfin、Emby、Plex：浏览、播放、下载、收藏，没有文件管理操作。

## 4. 功能清单

编号沿用上一版，新增条目从 #95 往后编。

### 4.1 新界面与文件源

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 102 | 主窗口框架：可折叠侧边栏、搜索框、三组导航、账号菜单、玻璃胶囊工具栏、独立设置窗口 | 顶部标签页（`PageMain.vue`） | 按第 3 节重做；macOS 用 `windowEffects` 的 sidebar 材质 | ✅ | M | ✔ |
| 99 | 文件源浏览器（「新增文件源」弹窗里已存储的源）：承接网盘页右侧内容区的全部功能（4.3），加上下载、上传和传输任务列表 | `FileSourceBrowser.vue`（210 行）已能浏览、收藏、单文件下载；网盘页右侧内容区是 `src/pan` 下 `PanRight.vue`（1732 行）及其菜单和弹窗，共约 1.4 万行（含 D6 舍弃的部分） | 组件外壳和界面调整见 3.5，具体功能拆在 4.3 各行；下载、上传调用第 7 节的自研引擎（含 Box、Dropbox 的文件夹打包下载） | 🟡 | 外壳 M，4.3 合计约 L–XL | ✔ D4 D9 |
| 100 | 全局搜索：跨网盘搜文件、PanHub 资源搜索、TMDB 结果、热搜 | 搜索标签页 `PageGlobalSearch.vue` | 放到侧边栏搜索框，结果单独成页；请求走 Rust 网关 | ✅ | M | ✔ |

### 4.2 网盘与账号

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 1 | 阿里云盘（网页 token 与 OpenAPI 双通道） | `src/aliapi`，axios 直连；主进程按域名补 Origin、Referer、X-Canary、Authorization | TS SDK 保留，请求改走 Rust 网关（8.1） | 🟡 | M | ✔ |
| 2 | 百度网盘 | `src/cloudbaidu`；下载需要 UA `pan.baidu.com` 和 Referer | 同上；播放时把请求头传给 mpv | 🟡 | M | ✔ |
| 3 | 123 网盘 | `src/cloud123` | 同上 | 🟡 | M | ✔ |
| 4 | 115（含播放鉴权） | `src/cloud115`；`drive115PlaybackAuth.ts` 按 URL 注入 Authorization | 鉴权头随播放地址一起交给 mpv | 🟡 | M | ✔ |
| 5 | 夸克（Cookie 登录） | 主进程把 session cookie 合并进请求头 | Cookie 由 Rust cookie jar 管理 | 🟡 | M | ✔ |
| 6 | PikPak | `src/pikpak` | TS 保留，换请求层 | ✅ | S | ✔ |
| 7 | OneDrive、Dropbox、Box、Google Drive | OAuth（Google 用本地回环端口）+ REST | 回环回调改 Rust 小 HTTP 服务或 deep link | ✅ | M | ✔ |
| 8 | 移动云盘 139、天翼云盘 189 | 189 需要主进程恢复浏览器禁止设置的 Date 头 | 请求走 Rust 网关 | 🟡 | S | ✔ |
| 9 | 光鸭云盘 | `src/guangya` | TS 保留，换请求层 | ✅ | S | ✔ |
| 10 | WebDAV、AList 来源 | `webdav` 库 + Node http | 请求走 Rust 网关 | 🟡 | S | ✔ |
| 11 | 本地文件夹来源 | 渲染进程直接用 fs | Rust 命令（列目录、读文件、元数据） | 🟡 | S | ✔ |
| 12 | 多账号切换、自动签到、token 刷新 | `src/user` | 纯逻辑 | ✅ | S | ✔ |
| 13 | BoxPlayer 账号、Pro 会员、支付 | supabase-js；支付回调用本地 HTTP 服务（`payment:start-server`） | supabase-js 在 WebView 可用；回调改 deep link 或 Rust 回环服务 | 🟡 | M | ✔ |

### 4.3 文件源浏览器里的文件管理（原网盘页右侧内容区，D9）

来源：`src/pan/PanRight.vue`、`src/pan/menus/`（`PanTopbtn`、`FileTopbtn`、`FileRightMenu`、`TrashTopbtn`、`TrashRightMenu`、`MediaLibraryMenu`、`DirTopPath`、`FolderPreviewPopover`）、`src/pan/topbtns/` 下的弹窗。左侧边栏（`PanLeft.vue`、`DirLeftMenu.vue`、目录树）不迁移。所有操作都按 3.5 的能力清单决定是否显示。

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 14 | 文件列表：列表、缩略图、大图三种模式；按名称、时间、大小升降序共 6 种排序；文件夹大小；颜色标记显示；文件夹悬停预览；滚动加载；空文件夹提示 | `PanRight.vue` + `FolderPreviewPopover.vue` + Dexie 缓存 | 移植到新的浏览器外壳，表格换成 @tanstack/vue-virtual + shadcn-vue；列表与缓存逻辑复用 `panfilestore.ts`、`pandal.ts` | ✅ | L | ✔ D9 |
| 103 | 路径与导航：面包屑路径、返回、刷新、回到根目录 | `DirTopPath.vue` | 纯前端。原「定位到目录树」（F6）依赖左侧目录树，不做 | ✅ | S | ✔ D9 |
| 104 | 选择：单选、Ctrl/Shift 多选、全选、区间选择（Ctrl+Q 分三步）、反选、取消选择 | `PanRight.vue` + `panfilestore.ts` | 纯前端 | ✅ | S | ✔ D9 |
| 105 | 键盘快捷键：Ctrl+A/C/X/Delete/F/N/U/L/E/S/T/G/Q/H，F2、F3、F5，Backspace，空格 | `PanRight.vue` 的按键处理 | 保留；去掉加密上传用的 Ctrl+J、Ctrl+M 和定位目录树的 F6；macOS 上 Ctrl 换成 Cmd | ✅ | S | ✔ D9 |
| 16 | 搜索：当前文件夹快速筛选；跨盘搜索（阿里可选备份盘、资源盘范围）；阿里高级搜索 | `PanRight.vue` 搜索框 + `SearchPanModal.vue` | 纯逻辑；跨盘搜索和侧边栏的全局搜索（#100）共用一套实现 | ✅ | S | ✔ D9 |
| 15 | 新建：文本文件、文件夹、「日期+序号」文件夹、批量新建文件夹 | `CreatNewFileModal`、`CreatNewDirModal`、`CreatNewDirMultiModal` | 纯逻辑 | ✅ | S | ✔ D9 |
| 106 | 重命名：单个重命名；批量重命名（替换、编号、大小写等规则） | `RenameModal`、`RenameMultiModal`（1216 行）+ `renamemulti.ts`（609 行） | 规则逻辑直接复用，界面移植并换组件库 | ✅ | S–M | ✔ D9 |
| 107 | 移动与复制：移动到、复制到（目录选择器）、拖到文件夹上移动、Ctrl+C/X | `SelectPanDirModal`（1055 行）、`onRowItemDrop` | 纯逻辑，界面移植；目录选择器要能在浏览器弹窗之上再弹出 | ✅ | S–M | ✔ D9 |
| 108 | 删除与回收站：放回收站、彻底删除；回收站视图里清空、还原选中、彻底删除；阿里的「恢复」视图 | `FileTopbtn`、`TrashTopbtn`、`TrashRightMenu` | 纯逻辑；回收站入口放在源的根目录列表（3.5）。媒体库的「删除媒体」也调用这些接口 | ✅ | S | ✔ D9 |
| 109 | 属性与信息：属性弹窗、复制文件名、复制目录树、在搜索结果里「打开位置」 | `ShuXingModal`（908 行）、`CopyFileTreeModal` | 纯逻辑 | ✅ | S | ✔ D9 |
| 110 | 双击打开：视频用 mpv（播放前可选清晰度）、音频进音乐播放器、图片查看器、PDF/Word/表格/Office/代码/文本预览、电子书进阅读器 | `src/utils/openfile.ts` 按文件类型分发；`SelectVideoQualityModal` | 视频接 #95，音频接 #55，文档接 #63、#65。双击压缩包解压随 D6 舍弃 | ✅ | M | ✔ D9 |
| 111 | 阿里云盘专属：收藏与取消收藏、颜色标记与清除标记、清除播放历史、「正在观看」、「全部专辑」、清空收藏夹 | `PanTopbtn`、`FileTopbtn`、`FileRightMenu` | 纯逻辑；收藏夹、正在观看、全部专辑的入口放在源的根目录列表（3.5） | ✅ | S | ✔ D9 |
| 112 | 创建分享：给文件或文件夹生成分享链接；阿里的「快传」 | `FileTopbtn` 的「分享」「快传」+ `CreatNewShareLinkModal` | 纯逻辑；只保留创建，分享列表管理（#30）仍舍弃 | ✅ | S | ✔ D9 |
| 101 | 导入分享链接（工具栏按钮、Ctrl+L） | `DaoRuShareLinkModal` 等；全局搜索、AI 搜索、媒体获取的「转存」也调用它 | 纯逻辑 | ✅ | S | ✔ D9 |
| 113 | 好运瓶（阿里资源盘工具栏按钮） | `ShareBottleFish` 接口 | - | ✅ | - | ✘ D14 |
| 114 | 整理：移动到上一级、平铺到当前目录、选择目录并移动、媒体整理（按识别结果生成归档路径，确认后批量移动） | `PanRight.vue` 的「整理」菜单 + `buildMediaOrganizePlan` | 纯逻辑 | ✅ | S | ✔ D9 |
| 115 | 加入媒体库：扫描数据（勾选视频、音频、书籍）、加入或移出媒体库、在媒体库中查看 | `FileRightMenu` 的扫描、`MediaLibraryMenu`；`FileSourceBrowser.vue` 的「收藏即扫描」 | 两套入口合并成一套 | ✅ | S | ✔ D9 |
| 116 | 115 转码（VIP 加速转码、枫叶加速转码） | `FileRightMenu` | 纯逻辑 | ✅ | S | ✔ D9 |
| 117 | 用 AI 分析文档（选中 PDF、DOCX、EPUB、TXT、Markdown） | `FileTopbtn`、`FileRightMenu` 打开 `DocumentAIModal` | 依赖 #70 | ✅ | S | ✔ D9 |
| 17 | 阿里相册 | 阿里 API | - | ✅ | - | ✘ D6 |
| 18 | 在线解压 | 云端解压 API | - | ✅ | - | ✘ D6 |
| 19 | 文件加密（flow-enc） | `src/module/flow-enc` + 本地代理解密 | - | 🟡 | - | ✘ D6 |
| 20 | 拖拽上传 | 依赖 Electron 给 `File` 附带的本地路径 | Tauri 的 drag-drop 事件直接给路径；可以做进 #99 | ✅ | S | ✔ |

### 4.4 传输（原传输页）

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 21 | 上传（各盘分片、秒传哈希、断点续传、冲突处理） | 隐藏的 BrowserWindow（`PageWorker`）里用 Node fs 读文件、算哈希；12 个网盘有上传实现 | 自研，入口在 #99。Rust 负责读文件、算哈希、分片传输、限速、断点；各盘协议编排见第 7 节的两种分工 | 🟡 | L–XL | ✔ D4 |
| 22 | 下载（多线程、限速、断点续传） | aria2 或隐藏的下载窗口 | 自研 Rust 下载器，入口在 #99（第 7 节） | 🟡 | L | ✔ D5 |
| 23 | aria2 引擎（BT、磁力、tracker、做种、UPnP） | `electron/main/aria` + 内置 aria2c | - | 🟡 | - | ✘ D5 |
| 24 | 连接远程 aria2、Motrix 联动 | JSON-RPC | - | ✅ | - | ✘ D5 |
| 25 | URL 下载、种子文件选择 | 传输页的弹窗 + aria2 | 入口随传输页舍弃；BT 和磁力依赖 aria2 | ✅ | - | ✘ 已确认 |
| 26 | 123、115 离线下载管理 | 网盘页、传输页的弹窗 | 界面舍弃；保留 #73 时接口逻辑要留着 | ✅ | - | ✘ 已确认 |
| 27 | 传输完成通知、任务栏进度、下载时阻止休眠、下载完自动关机 | Electron Notification、`setProgressBar`、`powerSaveBlocker` | plugin-notification、`set_progress_bar`、`keepawake` crate、各平台关机命令；跟着自研引擎走 | ✅ | S | ✔ |
| 28 | 同步（空壳） | `DownSync.vue` 只有按钮 | - | ⚫ | - | ✘ D3 |
| 29 | M3U8 下载（空壳） | 只有界面 | - | ⚫ | - | ✘ D6 |

### 4.5 分享（原分享页）

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 30 | 我的分享：创建、编辑、查看 | 各盘 API | - | ✅ | - | ✘ D3 |
| 31 | 导入分享链接、转存、分享历史 | 各盘 API | 页面舍弃；导入能力单独保留为 #101 | ✅ | - | ✘ D3 |
| 32 | 分享站、漂流瓶、订阅与关注 | 阿里云盘社交接口 | - | ✅ | - | ✘ D3 |

### 4.6 工具箱（原插件页）

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 33 | 查重、扫描重复、大文件、空文件、空目录、违规文件扫描 | `src/rss` | - | ✅ | - | ✘ D3 |
| 34 | 跨账号复制、网盘复制、相册复制、整理移动、媒体整理、批量重命名 | `src/rss` | - | ✅ | - | ✘ D3 |
| 35 | 洗码、本地加密 | `rssxima`、`rssjiami` | - | 🟡 | - | ✘ D3 |

### 4.7 视频播放

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 95 | 内置播放器：soia 的播放逻辑和播放窗口 + 自研原生渲染层；BoxPlayer 把播放地址、请求头、起始进度、字幕、播放列表交给它，再接收进度回写 | 内嵌 libmpv（`MpvEmbeddedSurface.vue` + N-API 插件），只支持 macOS 稳定可用 | 见 6.2：soia 的 Rust 模块并入 `src-tauri`，macOS 上替换掉 `soia_utils` 的调用（D17）；Vue 播放界面作为单独的播放窗口页面；给 soia 补「带请求头的 HTTP 播放源」和「链接过期刷新」 | 🟡 | L（其中 macOS 渲染层约 M；Windows、Linux 沿用 soia） | ✔ D16 D17 |
| 96 | 播放控件（清晰度、音轨、字幕、倍速、选集、播放列表、信息面板） | `MpvEmbeddedSurface.vue`（3223 行） | 直接用 soia 的控件（`PlayerControls`、`RightControls`、`PlaylistDrawer` 等）；清晰度切换和选集要按 BoxPlayer 的数据补上 | ✅ | M | ✔ D16 |
| 97 | mpv 窗口界面皮肤（uosc） | - | soia 有自己的播放界面，不需要 | 🔁 | - | ✘ D16 |
| 98 | 弹幕 | 弹幕只在网页播放器里有 | soia 没有弹幕。可在 soia 的播放窗口上叠一层 HTML 弹幕（画面在原生层、网页透明叠加，正好适合），弹幕源接口 `danmakuApi.ts` 复用 | 🟡 | M | ✔ |
| 41 | 字幕搜索（assrt 等）、本地与云端字幕自动发现 | HTTP + 文件列表 | soia 自带 OpenSubtitles、SubSource 在线搜索和外挂字幕加载（`load_external_playback_track`）；assrt 和网盘里的字幕文件接到这个入口 | ✅ | S | ✔ |
| 44 | 本地播放代理（补请求头、跟随 302、m3u8 改写） | `proxyhelper.ts` 在渲染进程起 http 服务 | 舍弃网页播放器、文件加密和 DLNA 后，只在 m3u8 需要改写（分片地址也要带头）和 SOCKS 代理下播放时才用到；保留 #89 时 WebDAV 服务器也要用 | 🟡 | S（保留 #89 则 L） | ✔ |
| 43 | 内嵌 libmpv（现有的 N-API 实现） | N-API 插件 + Electron `sharedTexture` | 由 soia 的实现取代，现有代码不迁移 | 🔁 | - | ✘ D16 |
| 36 | 网页播放器（Artplayer + hls.js + dash.js） | Chromium 解码 | - | 🟡 | - | ✘ D2 |
| 37 | 网页播放器的 ASS 字幕（JASSUB） | wasm + Worker | mpv 自带 libass | 🟡 | - | ✘ D2 |
| 38 | 网页播放器的弹幕 | Artplayer 插件 | mpv 下的弹幕见 #98；弹幕源接口（`danmakuApi.ts`）可以复用 | ✅ | - | ✘ D2 |
| 39 | 画中画 / 小窗播放 | Chromium API | Windows 用 `soia_utils` 自带的原生画中画；macOS 第一版做置顶小窗口（参考 Frame 的 mini player，能浮在其他应用的全屏空间之上），系统原生画中画以后再做；Linux 没有 | ✅ | S | ✔ D17（可选） |
| 46 | 网页播放器的独立窗口 | `WebOpenWindow` | - | ✅ | - | ✘ D2 |
| 42 | 用户自选外部播放器（IINA、PotPlayer、Infuse 等） | `uiVideoPlayer = 'other'` | - | ✅ | - | ✘ D2 |
| 40 | 雪碧图预览（阿里云盘视频缩略图拼图页） | 入口在网盘页工具栏 | - | ✅ | - | ✘ 已确认 |
| 45 | DLNA 投屏 | 入口在网盘页工具栏；node-ssdp + upnp-client-ts | 要保留的话需要放到媒体详情页或 #96 面板，Rust 用 `rupnp` 实现 | 🟡 | M | ✘ 已确认 |

### 4.8 媒体库与媒体服务器（新主界面）

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 47 | 媒体库扫描（云盘与本地；自动、增量、定时） | `mediaScanner.ts`，本地部分用 fs | 云盘部分不变；本地部分改 Rust 命令 | 🟡 | M | ✔ |
| 48 | 刮削与元数据（TMDB 等）、海报墙、详情、季集、演职员 | HTTP + Vue 组件 | 纯逻辑，界面按第 3 节重做 | ✅ | L | ✔ |
| 49 | 继续观看、收藏夹、主页货架、自定义剧集、元数据编辑、个人评分、多版本选择 | Dexie + Vue 组件 | 纯逻辑；播放进度由播放器（#95）的进度事件回写 | ✅ | M | ✔ |
| 50 | 媒体图片缓存（`mscache://` 协议） | `protocol.handle` + 磁盘缓存 | `register_asynchronous_uri_scheme_protocol` | ✅ | S | ✔ |
| 51 | Jellyfin、Emby、Plex：浏览、搜索、播放、收藏、播放列表、删除、码率测试、自定义设备配置、播放上报 | `src/media-server` | 纯逻辑；用播放器直放原文件，播放上报改由播放器的进度事件触发 | ✅ | M | ✔ |
| 52 | Trakt 同步 | 主进程 `traktClient.ts` | Rust，或前端 + 网关 | ✅ | S | ✔ |
| 53 | 观看统计页 | Vue 组件 | 纯前端 | ✅ | S | ✔ |

### 4.9 音乐

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 54 | 音乐库（歌曲、歌手、专辑、自建歌单、播放队列、封面裁剪） | Vue 组件 + 扫描 | 纯逻辑 | ✅ | M | ✔ |
| 55 | 音乐播放：howler（WebView 解码）+ mpv 音频桥（处理 WebView 解不了的格式） | N-API libmpv；Linux 走子进程 | howler 照用；音频桥复用 soia 打包的 libmpv（开一个不出画面的 mpv 实例），整个应用只带一份 libmpv | 🟡 | S | ✔ |
| 56 | 粒子播放器（three.js） | WebGL | 三个 WebView 都支持 WebGL | ✅ | S | ✔ |
| 57 | 歌词（网易云、酷狗搜索；自定义歌词） | `musicsdk/kg` 用 Node crypto 和 zlib | 改用 Web Crypto + pako，或放 Rust | 🟡 | S | ✔ |
| 58 | 桌面歌词（透明置顶窗口） | 独立 BrowserWindow | 透明窗口 + `set_ignore_cursor_events`；macOS 要开 `macOSPrivateApi`（cc-switch 已开） | ✅ | S | ✔ |
| 59 | 音效、均衡器 | Web Audio | 只对 howler 生效；经 mpv 播放的格式要改用 mpv 的 `af` 滤镜 | ✅ | S | ✔ |
| 60 | 播客（RSS 订阅） | HTTP | 请求走网关 | ✅ | S | ✔ |
| 61 | 全局快捷键、媒体键 | `globalShortcut` | plugin-global-shortcut；媒体键靠各 WebView 的 MediaSession，Linux 支持不完整 | 🟡 | S | ✔ |

### 4.10 阅读与文档预览

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 62 | 书架与图书扫描 | 媒体库标签的 `book` 分区 | 纯逻辑；放在侧边栏「媒体库」组 | ✅ | M | ✔ |
| 63 | EPUB（epubjs）、PDF（pdfjs）、TXT；书签、笔记、高亮 | 纯前端库 | 纯前端 | ✅ | M | ✔ |
| 64 | 独立阅读窗口 | BrowserWindow | 多窗口 | ✅ | S | ✔ |
| 65 | Office 预览（docx-preview、mammoth、xlsx）、代码、图片（viewerjs）、MHTML | 纯前端库；多数入口在网盘页 | 纯前端。网盘页舍弃后，需要在 #99 里给文件加「预览」入口，否则只剩书架能打开 | ✅ | S | ✔ |
| 66 | Office 转 PDF | 调用用户安装的 LibreOffice | Rust 调用同一个程序 | ✅ | S | ✔ |

### 4.11 AI

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 67 | AI 服务商配置（OpenAI 兼容、Ollama、OpenRouter、AI Gateway、BoxPlayer Cloud） | ai-sdk 跑在渲染进程，靠关掉 `webSecurity` 绕开 CORS | 给 ai-sdk 传入走 Rust 的 fetch（plugin-http 提供的 fetch 可直接用） | 🟡 | S | ✔ |
| 68 | AI 搜索 Agent | 前端 pi-agent-core + 主进程审计 | Agent 循环留在前端；审计与存储搬到 Rust | 🟡 | M | ✔ |
| 69 | AI 工作台（计划、审批、执行、归档、恢复） | 主进程 `workspaceAgent` + better-sqlite3 | 第一版不迁移，在新架构下重新设计（见第 9 节第 8 项） | 🟡 | - | ⏸ D8 |
| 70 | 文档 AI（PDF 问答、引用） | 主进程 `documentInsight`；PDF 提取在 Node worker_threads 里 | 存储搬 Rust；PDF 文本提取改到前端 Web Worker 用 pdfjs | 🟡 | M | ✔ |
| 71 | OpenDataLoader PDF 解析 | 调用 Java 11+ 和 Python 3.10+ | 继续调用外部程序 | ✅ | S | ✔ |
| 72 | Reedy 书籍 AI（分块、embedding、检索、记忆、技能、指标） | 主进程 SQLite | rusqlite；向量检索可接 sqlite-vec，或保留现在的做法 | 🟡 | M | ✔ |
| 73 | 媒体获取（追剧巡检、资源搜索、转存、assrt 字幕、通知、定时唤醒） | 主进程 `mediaAcquisition` 约 1800 行 + 唤醒调度器；会用到离线下载（#26）和分享导入（#101） | 存储和调度搬 Rust；搜索、转存逻辑留前端 | 🟡 | L | ✔ |
| 74 | PanHub 资源搜索、热搜、豆瓣热门 | 主进程转发，含流式响应 | Rust reqwest 流 + 事件；界面属于 #100 | ✅ | S | ✔ |
| 75 | Agent 调用 clouddrive-cli（执行器、预检、调度、审计账本） | 只被 AI 工作台使用（`WorkspaceAgentV1Reconciler.ts`） | 随 #69 一起重新设计 | 🟡 | - | ⏸ D8 |

### 4.12 系统集成

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 76 | 无边框窗口、自定义标题栏和窗口按钮 | `frame: false` | 按 3.3 分平台处理，属于 #102 | ✅ | S | ✔ |
| 77 | 托盘与托盘菜单 | Electron Tray | Tauri tray，cc-switch 的实现可直接参考 | ✅ | S | ✔ |
| 78 | 单实例、协议唤起（OAuth 回调）、文件关联打开 | `requestSingleInstanceLock`、`setAsDefaultProtocolClient` | plugin-single-instance、plugin-deep-link、打包配置里的 `fileAssociations` | ✅ | S | ✔ |
| 79 | 开机自启、启动后隐藏到托盘 | `setLoginItemSettings` | plugin-autostart | ✅ | S | ✔ |
| 80 | 自动更新（可走更新代理） | electron-updater | plugin-updater；老用户需要过渡版本，见 8.5 | 🟡 | M | ✔ |
| 81 | 原生右键菜单、文件对话框、在文件夹中显示、打开外链 | Electron Menu、dialog、shell | Tauri menu popup、plugin-dialog、plugin-opener | ✅ | S | ✔ |
| 82 | 跟随系统深浅色 | nativeTheme | `Window::theme()` + 主题变化事件 | ✅ | S | ✔ |
| 83 | 网络代理（HTTP、SOCKS） | `session.setProxy` 作用于整个界面 | 代理统一在 reqwest 里设置，并通过 `--http-proxy` 传给 mpv（mpv 只支持 HTTP 代理，SOCKS 代理下播放要经本地代理中转）；WebView 自身的代理在 macOS 需要 14 以上 | 🟡 | S | ✔ |
| 84 | 自定义数据目录（`userdir.config`） | `app.setPath('userData')` | Rust 决定数据目录（cc-switch 有同样的覆盖逻辑）；WebView 数据目录用 `data_directory` 指定 | ✅ | S | ✔ |
| 85 | 清缓存、清 Cookie、读写 Cookie | Electron session API | `clear_all_browsing_data`；读 Cookie Tauri 2.4 起有接口，写 Cookie 建议放到 Rust cookie jar | 🟡 | S | ✘ |
| 86 | 前端直接执行任意命令（`WebExecSync`、`WebSpawnSync`） | 渲染进程可调用 exec/spawn | 改成 Rust 的白名单命令，顺带收紧安全面 | ✅ | S | ✘ |
| 87 | 日志、调试设置页、工作窗口崩溃后自动重建 | console + 自建日志 | plugin-log；传输改成 Rust 任务后不再有工作窗口 | ✅ | S | ✔ |
| 88 | 网页预览窗口（指定 UA 和 Referer 打开外部页面） | `BrowserWindow.loadURL` | 新窗口能设 UA，不能设 Referer | 🟡 | S | ✔ |

### 4.13 其他

| # | 功能 | 现在的实现 | Tauri 方案 | 判定 | 工作量 | 保留 |
|---|---|---|---|---|---|---|
| 89 | WebDAV 服务器（把网盘挂载成 WebDAV） | `webdav-server` 库跑在渲染进程 | Rust `dav-server` crate，重写文件系统适配层，下载走本地代理（会把 #44 拉回 L） | 🟡 | L | ✘ |
| 90 | clouddrive-cli、MCP 安装与 token 导出 | `InstallCli` 用 Electron 的 Node 运行 CLI | 把 CLI 编译成独立可执行文件作为 sidecar（Node SEA 或 bun compile） | 🟡 | M | ✘ |
| 91 | 多语言、主题、Pro 徽章与额度提示、赞助、反馈 | Vue 组件 | 纯前端；Pro 入口和反馈按 3.1 放进侧边栏底部 | ✅ | S | ✔ |
| 92 | PostHog 统计 | posthog-js | WebView 可用 | ✅ | S | ✔ |
| 93 | 加载 Chrome 扩展（`static/crx`，manifest 名为 demo 的 devtools 页） | `session.loadExtension` | Tauri 不支持浏览器扩展 | 🔴 | - | ✘ |
| 94 | E2E 测试（Playwright 驱动 Electron，含 mpv 和真实云盘用例） | `e2e/` 下 14 个 spec | tauri-driver 只支持 Windows 和 Linux，macOS 的 WKWebView 没有 WebDriver。macOS 上只能靠 Rust 集成测试和前端组件测试 | 🟡 | L | ✔ |

## 5. 功能之间的依赖（取舍时参考）

### 5.1 共用的基础设施

右列的功能全部舍弃后，左列的基础设施可以不做或缩小。

| 基础设施 | 需要它的功能 | 舍弃后能省多少 |
|---|---|---|
| Rust HTTP 网关与请求头规则（8.1） | 所有网盘、媒体服务器、AI、弹幕、歌词、播客、PanHub | 不能省，任何联网功能都依赖它 |
| 自研传输引擎（第 7 节） | #99、#21、#22、#20、#27 | 已定保留 |
| 本地播放代理 #44 | 需要改写的 m3u8、SOCKS 代理下的播放、WebDAV 服务器 #89 | 不保留 #89 时只做 S 级的小代理 |
| Rust SQLite 存储 | 传输任务持久化，以及 #68、#70、#72、#73 | 传输任务也要存，所以至少要一个库 |
| clouddrive-cli sidecar | #90；以后的 AI 工作台（#75）可能也要 | 不保留 #90 则省 M，第一版不用维护 Node 打包链路 |
| AI 服务商配置 #67 | #68、#70、#72、#73 | 省 S |
| 网盘能力清单（`src/drive/providerFeatures.ts` + 各网盘 `capabilities.ts`） | 4.3 的全部文件管理操作、#99 | 不能省，D9 之后浏览器按它显示按钮；直接复用现有 TS |
| 分享链接导入 #101 | 文件源浏览器工具栏、#100、#68、#73 | 已定保留（D9） |
| 离线下载接口（#26 的逻辑部分） | #73 | 不保留 #73 时整块不迁移 |
| 媒体库扫描 #47 | #48、#49、#53、#73 | 媒体库是主界面，基本不能省 |
| BoxPlayer 账号 #13 | Pro 入口与额度提示 #91、BoxPlayer Cloud AI #67、PanHub 资源搜索额度 #74 | 省 M，也不需要支付回调服务 |

### 5.2 舍弃某个网盘能省什么

现在每舍弃一个网盘，能省下：

- 它的上传实现（#21 的一部分，这是每个网盘最大的一块工作量）；
- 它在 Rust 网关里的请求头规则；
- 它在 4.3 里的专属功能：
  - 阿里云盘：收藏、颜色标记、正在观看、全部专辑（#111），快传（#112），高级搜索（#16 的一部分）；
  - 115：转码（#116）、播放鉴权；
  - 夸克：Rust cookie jar；
  - 123 和 115：离线下载接口（只有 #73 会用）。

## 6. 播放器：soia 的界面和播放逻辑 + 参考 Frame Player 的原生渲染层（D16）

### 6.1 两个参考项目

| | [soia](https://github.com/FengZeng/soia)（`/Users/yunqi/Downloads/BoxPlayer/soia`） | [Frame Player](https://github.com/risenxxx/frame-player)（`/Users/yunqi/Downloads/BoxPlayer/frame-player`） |
|---|---|---|
| 版本、热度 | v0.2.13，210★，317 个提交 | v1.43.0，52★，275 个提交 |
| 许可证 | GPL-3.0-only | GPL-3.0-or-later |
| 技术栈 | Tauri 2 + Rust（约 3.8 万行）+ **Vue 3**（约 3.1 万行）+ libmpv | Tauri 2 + Rust + Svelte 5 + libmpv（通过 [`tauri-plugin-libmpv`](https://github.com/nini22P/tauri-plugin-libmpv)，MPL-2.0） |
| 画面怎么嵌进窗口 | 全部交给闭源的 `soia_utils` 二进制（见 6.4） | **全部开源**：mpv 用 `--wid` 画进放在透明 WebView 下面的原生视图。Windows 是子 HWND；macOS 官方 mpv 不支持 `--wid`，它自己写了约 160 行的补丁（`patches/mpv-0.41.0-macos-wid-embedding.patch`），保留 gpu-next、Metal、VideoToolbox 硬解和 HDR 色调映射 |
| 平台 | macOS 13+、Windows、Linux（仅 Wayland） | Windows、macOS；不支持 Linux |
| 文档 | README | 非常详细：`docs/architecture.md`（嵌入模型和约束）、`docs/macos.md`（补丁说明和 macOS 的坑）、`docs/rules/` |

### 6.2 组合方式

**界面和播放逻辑用 soia；原生渲染层 Windows、Linux 用 soia 的 `soia_utils`，macOS 参照 Frame 自己实现（D17）。**

soia 的 Vue 界面通过 59 个 Tauri 命令和一组事件，与 soia 自己的 Rust 播放逻辑通信。接口类型由 `src-tauri/protocol` crate 生成（`src/core-client/generated`）。这套 Rust 逻辑是开源的：mpv 事件循环、播放服务、播放列表、音轨与字幕选择、外挂字幕、在线字幕、历史与续播。所以不需要照 Frame 重写整个后端。

**为什么按平台分**：`soia_utils` 只在 macOS 上需要作者服务器下发的授权（`mpv/handle.rs` 里非 macOS 平台传的是空授权），所以 Windows、Linux 直接用它最省事；macOS 上为了不依赖作者服务器，改为自己实现。

macOS 上要替换 soia 调用 `soia_utils` 的这几处（Windows、Linux 保持 soia 原样，只去掉下表最后三行不需要的功能）：

| soia 调用 `soia_utils` 的地方 | 作用 | 替换成 |
|---|---|---|
| `mpv/handle.rs`：`soia_utils_create`、`render_target_resize`、`set_render_target_visible`、`render_context_update`、`destroy` | 创建渲染视图，把 mpv 画面放到 WebView 下面，并跟随窗口尺寸 | 照 Frame 的做法，用打了 `--wid` 补丁的 libmpv，把宿主 NSView 传给 mpv，mpv 自己把视图插到最底层并跟踪尺寸（沿用 Frame 的补丁和 `scripts/build-macos-libs.sh`）。在 `mpv/handle.rs` 里按平台分支：macOS 走自研实现，其他平台照旧调 `soia_utils_create` |
| `platform/macos.rs`：`soia_sync_layer_geometry`、`set_render_target_hdr` | 图层尺寸同步、HDR 开关 | 用了 `--wid` 补丁后由 mpv 自己处理，HDR 由 mpv 的 gpu-next 输出 |
| `platform/macos.rs`：`now_playing` 一组函数、`register_media_remote` | 控制中心的「正在播放」和媒体键 | 参考 Frame 的 `now_playing.rs` |
| `platform/macos.rs`：`pip` 一组函数 | macOS 原生画中画 | 第一版改成「置顶小窗口」（Frame 的 mini player 做法，macOS 上还能浮在其他应用的全屏空间之上，见 Frame `docs/macos.md`）；系统原生画中画以后再做 |
| `mpv/stream_https.rs`：`register_stream_protocol` | 在线视频的并行分段下载 | 三个平台都不需要。BoxPlayer 的网盘链接直接交给 mpv，或经 soia 已有的本地回环网关 `media_gateway` |
| `network/protocols/smb.rs`：`soia_smb_*` | SMB 浏览和读取 | 三个平台都不需要，BoxPlayer 没有 SMB 来源。连同 soia 的 SMB 功能一起去掉 |
| `check_update.rs` 的授权请求、`mpv/handle.rs` 的 `auth_payload` | 向作者服务器取授权，交给 `soia_utils` | 三个平台都删掉，连同 soia 的每日统计上报。Windows、Linux 上 `soia_utils` 本来就只收空授权 |

这样做以后：macOS 上没有闭源二进制，也不依赖第三方服务器；Windows、Linux 上带着 `soia_utils`，但不连作者的服务器。

**libmpv 的来源也按平台分**：Windows、Linux 用 soia 的 `pnpm setup:libs` 从 [FengZeng/mpv](https://github.com/FengZeng/mpv/releases) 下载的运行时包（里面同时有 libmpv 和 `soia_utils`，两者版本配套）；macOS 用 Frame 的脚本自己编译带补丁的 libmpv。

**怎么并入 BoxPlayer：**

1. soia 的 Rust 播放模块和 `protocol` crate 作为 workspace crate（例如 `crates/player`）放进 BoxPlayer 的 `src-tauri`。它的 Tauri 命令注册进 BoxPlayer 的 `invoke_handler`，名字加 `player_` 前缀。
2. 播放时新开一个 Tauri 窗口，加载 soia 的 Vue 播放界面。Vite 用多页面构建：主窗口和播放窗口是两个入口，同一个 Vue 3.5，可以共用组件、样式和多语言。
3. BoxPlayer 通过一个 Rust 命令（例如 `player_open`）交给播放器：播放地址、请求头、起始进度、字幕列表、播放列表、标题和海报。播放器用事件回报进度、暂停、结束和换集，BoxPlayer 据此写观看记录、上报媒体服务器、同步 Trakt。
4. 要给 soia 补两处：
   - **带请求头的 HTTP 播放源**：soia 的播放源只有本地、WebDAV、DLNA、SMB（`playback_source/key.rs`）。新增一种「HTTP 地址 + 请求头」，在 `loadfile` 前设置 `http-header-fields`、`user-agent`、`referrer`。
   - **链接过期刷新**：遇到 403 时回调 BoxPlayer 重新取链，再续播（同 8.7 的 `resolve_download_url`）。
5. 第一版在播放窗口里隐藏和 BoxPlayer 重复的部分：soia 的网络面板、历史面板、设置里的重复项。投屏、浏览器遥控器、yt-dlp 先关掉，以后按需打开。

**参考 Frame 的地方不只是渲染层。** 它的文档记录了很多已经踩过的坑，实现时要逐条对照：
- 透明窗口在 mpv 出画面前会露出桌面，要先铺一层不透明背景；
- 全屏切换时 WebView 和 mpv 视图不在同一帧完成布局，要用黑色遮挡窗口过渡；
- macOS 的 CoreAudio 初始化崩溃，需要补丁 `patches/mpv-0.41.0-coreaudio-init-cleanup.patch`；
- libmpv 在 `.app` 里的加载路径和签名。

### 6.3 和现在相比

- **保留**：格式支持、硬件解码、HDR、外挂和内封字幕、多音轨、播放列表、续播。
- **更好**：画面在应用自己的窗口里，播放界面是网页控件；Windows arm64 也能用（现在的内嵌模式不支持）。
- **按平台的差异**：Windows 直接用 `soia_utils`，原生画中画、HDR、杜比视界和 soia 一致。macOS 第一版没有系统原生画中画（先用置顶小窗口代替），杜比视界能否正确显示要实测。弹幕三个平台都要自己叠加（#98）。

### 6.4 风险

1. **Windows、Linux 依赖闭源的 `soia_utils`。** 这两个平台出了渲染问题（黑屏、全屏闪烁、新系统不兼容）只能等作者修；它和 FengZeng/mpv 的 libmpv 版本绑定，想升级 mpv 要等作者先更新。**这两个平台要尽早向作者确认能否随 BoxPlayer 分发 `soia_utils`**，这个库没有单独的许可证说明。万一不行，Windows 可以照 Frame 改成子 HWND + 官方 libmpv（Frame 已经验证过），Linux 退回 6.8。
2. **Linux 只支持 Wayland。** soia 的 README 写明不支持纯 X11（代码里有一个 X11 模式，但没有测试过）。X11 用户退回 6.8 的独立 mpv 窗口。
3. **macOS 要自己编译 libmpv。** 每次升级 mpv 都要重新应用 `--wid` 补丁。Frame 已经在 mpv 0.41.0 上维护这份补丁，可以跟着它更新；补丁只改 4 个文件，冲突概率不高。
4. **macOS 上杜比视界和 HDR 效果要实测。** soia 的 `soia_utils` 里可能有专门的处理（导出符号里有 `ra_ctx_vulkan_soia`、`set_render_target_hdr`）。换成补丁版官方 mpv 后，HDR 有 gpu-next 的色调映射，杜比视界显示是否正确不确定。建议原型阶段用几段 HDR10 和杜比视界样片，和 Windows 上的 soia 对比。
5. **两套渲染层要一起维护。** `mpv/handle.rs` 和 `platform/` 里要按平台分支，macOS 一套、其他平台一套。建议保留 soia 的直接 FFI，只借鉴 Frame 的嵌入方式和补丁，不引入 Frame 用的 `tauri-plugin-libmpv`。
6. **soia 的界面代码风格和主窗口不同。** 主窗口和播放窗口都是 Vue（D1 已改为保留 Vue，原来的「两套框架」风险已消除），但 soia 没用组件库、有自己的样式和文案。第一版照原样用，只把文案接进 BoxPlayer 的多语言；以后按需换成 shadcn-vue 组件。
7. **许可证**：soia 是 GPL-3.0-only，Frame 是 GPL-3.0-or-later，BoxPlayer 是 GPL-3.0，可以合并，但整体只能按 GPL-3.0 发布。要保留两边的版权声明，并照 Frame 的 `THIRD-PARTY-NOTICES.md` 列出 libmpv、FFmpeg 等第三方组件的许可证。`soia_utils` 的分发许可见第 1 条。

### 6.5 平台支持

| 平台 | 渲染方式 | 注意事项 |
|---|---|---|
| macOS 13+（arm64、x64） | 自研：打了 `--wid` 补丁的 libmpv，NSView 在 WebView 下面，Vulkan（MoltenVK）+ gpu-next | 自己编译 libmpv，签名公证；参考 Frame 的 `scripts/build-macos-libs.sh` 和 `docs/macos.md` |
| Windows x64、arm64 | `soia_utils` + FengZeng/mpv 的 libmpv，和 soia 完全一样 | 支持原生画中画、HDR、杜比视界；不需要授权 |
| Linux x64、arm64（D15：deb、rpm、AppImage） | `soia_utils` + FengZeng/mpv 的 libmpv，只在 **Wayland** 下可用 | X11 用户退回 6.8；soia 的 deb 自带 libmpv 运行时（`bundle_runtime_libs_linux.mjs`），不依赖系统 mpv |

### 6.6 安装包体积估算（单架构，未实际打包）

libmpv 运行时（含 FFmpeg 等依赖，压缩后）在 macOS 约 20–25MB，Windows 约 25–30MB，Linux 约 33–35MB，和之前的估算相近：

| 平台 | 迁移后估算 | 现在（v5.0.38） |
|---|---|---|
| Windows | 约 55–75MB | exe 185MB |
| macOS | 约 60–85MB | dmg 177–182MB |
| Linux deb、rpm | 约 55–75MB（自带 libmpv） | deb 227–242MB |
| Linux AppImage | 约 140–170MB | 226–241MB |

### 6.7 可以整体删掉的现有代码

- 内嵌 mpv：`native/boxplayer-mpv-texture`（其中的 mac 源码构建脚本可以和 Frame 的 `build-macos-libs.sh` 合并参考）、`electron/main/mpv/`、`src/components/MpvEmbeddedSurface.vue`、`e2e/embeddedMpv*`、`.github/workflows/embedded-mpv-*.yml`
- 网页播放器：`src/layout/PageVideo.vue` 里的 Artplayer 部分、`src/module/video-plugins/`、Artplayer 系列插件、hls.js、dash.js、jassub 依赖，以及只给 JASSUB 用的 `NotoSansCJKsc-Regular.otf`
- `src/module/node-mpv/`、`playerhelper.ts` 里启动外部播放器的部分

### 6.8 备用方案：独立 mpv 窗口（原方案 A）

下面几种情况退回这个方案：Linux X11 用户；`soia_utils` 拿不到分发许可时的 Linux；某个平台的嵌入出了短期解决不了的问题。

- 随应用分发 mpv 可执行文件（Tauri sidecar）。Rust 启动 mpv 时用命令行参数传入地址、请求头（`--http-header-fields`、`--user-agent`、`--referrer`）、起始进度、字幕和播放列表，这部分从现在的 `playerhelper.ts`、`mpvPlayerPolicy.ts` 移植。
- Rust 通过 `--input-ipc-server`（macOS/Linux 用 Unix socket，Windows 用 named pipe）收发 JSON IPC，回写进度、切换音轨字幕。
- 画面在 mpv 自己的窗口里，界面用 [uosc](https://github.com/tomasklaen/uosc)，弹幕用 [uosc_danmaku](https://github.com/Tony15246/uosc_danmaku)。
- Linux 的 deb、rpm 依赖系统 mpv，AppImage 自带。

附录的调研表保留了其他方案的对比。

## 7. 自研下载与上传

### 7.1 下载（Rust）

- **来源**：网盘文件、媒体服务器文件、本地文件复制，和 `FileSourceBrowser.vue` 现在支持的三种一致。网盘页现在支持多选下载和文件夹下载，D9 之后新浏览器也要支持：文件夹递归展开成文件任务；Box、Dropbox 的文件夹可以走网盘自带的打包下载。
- **传输**：按 HTTP Range 分片并发下载；分片进度写进 SQLite，实现断点续传；全局和单任务限速；并发任务数上限（沿用 `downFileMax`、`downThreadMax`、`downGlobalSpeed`）。
- **直链过期**：网盘直链有有效期。下载中途收到 403 或链接过期时，调用对应网盘的 SDK 重新取链再续传。
- **请求头**：复用 8.1 的网关规则（百度的 UA、115 的鉴权等）。
- **完成后**：系统通知、任务栏进度、下载期间阻止休眠、可选的下载完自动关机（#27）。
- **不支持**：BT 和磁力。以后需要的话，可以用 Rust 的 BT 库（例如 librqbit）补上，不必回到 aria2。

### 7.2 上传

现在 12 个网盘有上传实现（阿里、百度、123、115、夸克、139、189、光鸭、OneDrive、Dropbox、Box、Google Drive），每家协议不同：秒传哈希算法、分片大小、预上传和完成接口都不一样。分工有两种做法：

| 做法 | 内容 | 工作量 |
|---|---|---|
| A. Rust 做 IO，TS 做协议编排（**第一版采用，D10**） | Rust 提供读文件、按算法算哈希（sha1、md5、分片 md5、阿里 proof code 等）、把指定文件区间 PUT 或 POST 到指定 URL、限速、进度事件。各网盘的上传步骤留在 TS 里，复用现有代码，只把 Node fs 换成这些 Rust 命令 | L |
| B. 全部用 Rust 重写（以后再说） | 各网盘上传协议都在 Rust 里实现，App 和 CLI 以后可以共用 | XL |

第一版用做法 A。以后某个网盘的 SDK 换成 Rust 时（8.7），它的上传也随之改成做法 B，其他网盘不受影响。

其他要点：
- 冲突处理沿用现有设置 `downUploadWhatExist`（跳过、覆盖、重命名）。
- 上传任务和下载任务放在同一个任务表、同一个传输面板里。
- 媒体服务器源不能上传；WebDAV、AList 来源目前没有上传实现，要做的话是最简单的一种（PUT）。

### 7.3 界面（放在 #99 文件源浏览器里）

- 入口沿用网盘页的位置：工具栏和右键菜单里的「下载」，工具栏的「上传文件」「上传文件夹」（Ctrl+U），以及把本地文件拖进列表上传（#20）。
- 一个传输任务面板：进度、速度、暂停、继续、重试、删除、清除已完成。可以做成浏览器里的标签页或工具栏弹出层；关闭弹窗后任务在后台继续，侧边栏或工具栏显示一个进度标记。

## 8. 不管保留哪些功能都要先解决的基础问题

### 8.1 请求层：CORS 和强制请求头

现在渲染进程关掉了 `webSecurity` 来绕开 CORS，主进程再在 `launch.ts` 的 `onBeforeSendHeaders` 里按域名统一改写 Origin、Referer、User-Agent、Cookie、Authorization。涉及的服务有阿里、夸克、百度、115、B 站、腾讯视频、Gitee，以及 189 的 Date 头。Tauri 的 WebView 没有拦截请求头的接口，WKWebView 本身也不允许。

做法：所有 API 请求改走 Rust。可以用 tauri-plugin-http（开启 `unsafe-headers` 特性才能设置 Origin、Referer 等头），也可以自写一个 `http_request` 命令。把这套改写规则集中搬到 Rust 一处，前端的 axios 换成调用它的适配器。云盘 SDK 本身（约 2.3 万行 TS）可以不动。mpv 播放和自研下载都直接用这套规则算出的请求头。

### 8.2 页面里直接加载的图片

`<img>` 的 src 现在也靠上面那段代码补头，迁移后改成 `mscache://`（#50）。舍弃网页播放器后，`<video>` 不再需要处理。

### 8.3 渲染进程里的 Node 代码

50 个非测试文件用了 fs、http、net、crypto、child_process 等，另外还有隐藏的上传、下载工作窗口。按现在的取舍，剩下要改成 Rust 命令的主要是：上传的文件读取和哈希（第 7 节）、本地文件夹来源与本地扫描（#11、#47）、播放器集成（#95）、歌词 SDK 的 crypto（#57）。网盘页右侧内容区的代码主要是调用网盘 API，很少直接用 Node，搬进浏览器时改动不大。工具箱、加密、DLNA、网页播放器相关的 Node 代码随功能一起删掉。

### 8.4 用户数据迁移

现有数据在 Electron 的 userData 目录里：Dexie（IndexedDB，Chromium 的 LevelDB 格式）、localStorage、electron-store，以及 5 个 better-sqlite3 数据库（Agent 账本、文档阅读、媒体获取、Reedy、AI 工作台）。Tauri 的 WebView 存储是另一套格式，读不了 Chromium 的 IndexedDB。

建议：最后一个 Electron 版本把 Dexie 和 localStorage 导出成 JSON，第一个 Tauri 版本启动时导入。SQLite 文件 rusqlite 能直接打开。账号 token 等敏感数据可以借机移进 Rust 侧存储。要迁移的主要是账号、文件源、媒体库（收藏、进度、元数据）、音乐和书架数据；舍弃的功能（传输记录、分享记录、工具箱等）和第一版不做的 AI 工作台数据不用迁移。

### 8.5 老用户的更新过渡

electron-updater 和 tauri-plugin-updater 的清单格式、签名方式都不同，老用户不会自动升到 Tauri 版。需要发一个 Electron 过渡版：它下载并启动 Tauri 安装包，处理旧版卸载（Windows 上两边安装器类型不同），并完成 8.4 的数据导出。过渡版里最好提示用户：传输、分享、插件页已经移除，网盘文件管理搬到了「文件」里的文件源浏览器。

### 8.6 前端业务代码与 Vue、Arco 的耦合

593 个 TS 文件里，64 个直接调用 Pinia store，83 个调用基于 Arco 的 `message` 提示封装。保留 Vue（D1）后，调用 Pinia 的文件不用改；`message` 封装本身改接 vue-sonner（D12），调用方保持原来的函数名和参数，也不用逐个改。舍弃的功能对应的文件直接删除。

状态管理：cc-switch 用 TanStack Query 管理从 Rust 取来的数据，没有全局状态库。BoxPlayer 现在有 36 个 Pinia store，很多是纯前端状态（选中项、播放队列、界面开关），继续用 Pinia。新写的、数据来自 Rust 命令的部分（例如传输任务列表、设置）可以用 @tanstack/vue-query；已有 store 第一版不迁移。

要改的是直接调用 Arco 组件 API 的地方（`Modal.confirm`、`Notification` 等）和 `.vue` 里的 Arco 组件，跟着各功能的界面工作一起换成 shadcn-vue。两套组件库可以并存一段时间，按功能逐个替换。

### 8.7 网盘 SDK 的迁移策略（D10）

**第一版不改写，原因：**

1. **代价大，用户看不到收益。** 网盘 SDK 加媒体服务器部分约 2.7 万行 TS，里面是 12 个网盘的签名、加密、分页、上传协议细节（例如阿里用到 secp256k1 签名，189 的登录和上传有自己的加密逻辑）。改写要多花约 1–2 亿 token、1–2 个月。更重要的是，每个网盘的列表、重命名、移动、分享、回收站、上传都得用真实账号重新验证一遍，而真实账号验证本来就是整个项目最慢的环节。
2. **「App 和 CLI 共用」第一版用不上。** clouddrive-cli 已经有一套独立实现（`clouddrive-cli/providers`，12 个网盘，约 3900 行 .mjs），和 App 本来就是两份代码；第一版 #90 CLI 舍弃，AI 工作台也延后了。
3. **TS 版也能满足后台任务。** 现在媒体获取的定时唤醒是主进程给渲染进程发事件（`MediaAcquisitionWakeScheduler.ts` 里的 `webContents.send('mediaAcquisition:wake')`），再由渲染进程调网盘接口。Tauri 下改成 Rust 发事件给 WebView，做法一样；窗口隐藏到托盘时 WebView 仍在运行。

**第一版要留好的接口**，以后逐个网盘换成 Rust 时，调用方不用改：

| 接口 | 第一版的做法 | 以后换成 Rust 时 |
|---|---|---|
| 请求层 | 所有网盘请求都走 Rust 网关（8.1） | 网关不变，只是调用方从 TS 换成 Rust |
| 账号 token | 存在 Rust 侧，网关负责补 Authorization 头（`launch.ts` 现在已有类似的兜底逻辑）；前端尽量不长期持有 token | 不变 |
| 下载链接刷新 | 传输引擎遇到 403 或链接过期时，通过固定接口（例如 `resolve_download_url`）向前端要新链接，前端调用 TS SDK | 同一个接口改由 Rust 实现，传输引擎不用改 |
| 上传 | 7.2 做法 A：Rust 负责读文件、算哈希、传分片，TS 负责各网盘的上传步骤 | 该网盘改成做法 B |
| 网盘能力 | 沿用 `capabilities.ts` 和 `providerFeatures.ts` 的能力清单 | Rust 端的 provider trait 照这份清单定义，前端按能力显示按钮的逻辑不变 |

**什么时候再考虑改写：** AI 工作台重新设计、CLI 回归的时候。这两项都需要在没有界面的情况下操作网盘，那时把 SDK 放进 Rust 才有实际价值。届时从最常用的两三个网盘开始，参考 CLI 那套更精简的实现，每换一个就用真实账号验证一个。

## 9. 决策事项

除第 8 项（AI 工作台，第一版之后再做）和第 9 项（`soia_utils` 分发许可）以外，全部已定（2026-11-05）。

1. （已定）「保留」列已经全部填完（共 117 项）。
2. （已定，D11：四项都改回保留）你标成 ✘、但和已保留功能有关的几项，当时的说明如下：
   - **#78 单实例与协议唤起**：OAuth 回调现在用 4 个自定义协议：`xbyboxplayer-oauth`、`boxplayer-onedriveoauth`、`boxplayer-auth`、`boxplayer-traktoauth`（`electron/main/launch.ts`）。OneDrive 等网盘（#7）、BoxPlayer 账号（#13）、Trakt（#52）都靠它们登录。舍弃协议唤起的话，这些登录要改成本地回环地址（`http://127.0.0.1:端口`），并到各家开发者后台重新登记回调地址。另外，没有单实例时，用户第二次打开应用会多出一个窗口。建议保留。
   - **#76 无边框窗口和自定义标题栏**：XbyVideoHub 风格的 macOS 窗口（红绿灯嵌在侧边栏上方、工具栏和标题栏合一）就是靠它实现的，属于 #102。如果 ✘ 的意思是 Windows 和 Linux 用系统标题栏、macOS 保持 XbyVideoHub 的样子，我就按这个改 3.3。
   - **#87 日志与调试页**：没有日志，用户反馈问题时很难排查，plugin-log 工作量是 S。
   - **#66 Office 转 PDF**：舍弃后，PPT 等只能靠 LibreOffice 转换的格式在 #110 里没法预览；docx、xlsx 仍可用前端库预览。
3. （已定，D14）好运瓶去掉。
4. （已定，D13）文件源浏览器保持现在的弹窗尺寸，收纳方式见 3.5。
5. （已定，D12，2026-11-06 修订）UI 组件库用 cc-switch 同一套方案的 Vue 版 shadcn-vue，见 1.1；前端框架保留 Vue（D1，理由见 1.2）。
6. （已定，D10）云盘 SDK：第一版保留 TS，上传用 7.2 的做法 A；以后的改写策略见 8.7。
7. （已定，D15：按建议发三种）Linux 安装包格式。Linux 不同发行版用的安装包格式不一样，当时的对比如下：

   | 格式 | 适用的发行版 | 怎么装 | mpv 怎么来 | 现在发布吗 | 近 10 个版本 GitHub 下载量 |
   |---|---|---|---|---|---|
   | deb | Ubuntu、Debian、Linux Mint、deepin 等 | 双击用软件中心安装 | 安装包声明依赖 mpv，系统自动装上，安装包小 | 发布 | 1916 |
   | AppImage | 所有发行版通用 | 单个文件，加上执行权限直接运行，不用安装 | 必须自带 mpv 和 WebKitGTK，体积大（约 140–170MB） | 发布 | 1800 |
   | pacman | Arch、Manjaro | `pacman -U` 安装 | 声明依赖 mpv | 发布 | 1075 |
   | rpm | Fedora、openSUSE、RHEL 系 | 双击或 `dnf install` | 声明依赖 mpv | 不发布 | - |
   | Flatpak | 所有发行版，通过 Flathub 商店 | 从商店安装，沙箱运行 | 清单里打包 mpv | 不发布 | - |

   对照：同期 Windows exe 下载 16748 次，macOS dmg 2205 次。另外，Tauri 自带的打包工具能直接出 deb、rpm、AppImage，出不了 pacman；cc-switch 就是发这三种。

   **结论**：发 deb、rpm、AppImage 三种，和 cc-switch 一样，全部由 Tauri 直接生成。Arch 用户（pacman 那 1075 次下载）改用 AppImage；以后需要的话，可以在 AUR 上放一个把 deb 重新打包的脚本。Flatpak 第一版不做，因为要单独维护清单并通过 Flathub 审核。
8. AI 工作台（#69、#75）的重新设计：第一版不做。等第一版主体确定后，单独出一份设计文档，内容包括它在新界面里的位置、执行方式（是否还经过 clouddrive-cli）、审批流程，以及和自研传输引擎、AI 搜索的关系。
9. （待确认，D17）向 soia 作者确认 Windows、Linux 能否随 BoxPlayer 分发 `soia_utils`。macOS 改为自研后不再需要作者的授权服务。

## 10. 建议的推进顺序（取舍确定后再细化）

1. Rust 基础设施：HTTP 网关与请求头规则、SQLite、设置存储、旧数据导入。
2. 应用外壳：按第 3 节做主窗口框架（#102）和设置窗口，加上托盘、单实例、深链（OAuth 回调）、更新，参考 cc-switch。
3. 最小可用版本：文件源（保留的网盘、本地、媒体服务器）、媒体库主界面、播放器（#95，D16）。播放器先在 Windows 上把 soia 整体接进来（`soia_utils` 现成可用），验证带请求头的网盘播放、进度回写、换集；同时在 macOS 上编译带 Frame 补丁的 libmpv，替换渲染层，用 HDR10 和杜比视界样片和 Windows 对比；最后是 Linux（Wayland）。开始前先向 soia 作者确认 `soia_utils` 的分发许可（6.4 第 1 条）。
4. 文件源浏览器：先做浏览、选择、打开和常用文件操作（#14–#16、#103–#110），再接自研下载和上传（第 7 节），最后补网盘专属功能（#111–#117）。
5. 音乐、阅读、全局搜索等其余保留项。
6. 第一版发布后：AI 工作台的重新设计与实现（第 9 节第 8 项）。

## 附录：播放内核调研（2026-11-05）

决定播放器方案之前看过的方案，星数和更新时间来自 GitHub API。最终选择见 D16、D17（soia 的界面和播放逻辑；渲染层 Windows、Linux 用 `soia_utils`，macOS 参照 Frame Player 自研），原方案 A 作为备用（6.8）。

| 方案 | 代表项目 | 结论 |
|---|---|---|
| WebView 播放 + Rust 本地实时转封装（MKV 转 fMP4/HLS，只转音频） | 无现成桌面项目；思路同 Jellyfin 服务端 remux | HEVC 仍依赖系统解码器，拖动进度的实现复杂 |
| WebView 播放 + 前端 wasm 解封装和解码 | [zhaohappy/libmedia](https://github.com/zhaohappy/libmedia)（388★，LGPL-3.0） | Safari 的 WebCodecs 只支持视频；4K HEVC 落到软解播不动 |
| WebView 播放 + 服务端转码 | [prayag17/Blink](https://github.com/prayag17/Blink)（1174★，Tauri 2 + React + react-player） | 只适合媒体服务器，不适合网盘直链 |
| mpv 独立进程 + JSON IPC（**方案 A**） | [nini22P/tauri-plugin-mpv](https://github.com/nini22P/tauri-plugin-mpv)（30★） | 三个平台都可用，最稳 |
| mpv 画面放在透明 WebView 下面，`--wid` 方式 | [Stremio/stremio-shell-ng](https://github.com/Stremio/stremio-shell-ng)（93★，只支持 Windows）、[nini22P/tauri-plugin-libmpv](https://github.com/nini22P/tauri-plugin-libmpv)（23★） | Windows 可行；Linux 嵌入不工作，macOS 未测 |
| mpv 画面放在透明 WebView 下面，`--wid` 方式，macOS 打补丁 | [risenxxx/frame-player](https://github.com/risenxxx/frame-player)（52★，GPL-3.0，Windows + macOS，全部开源）；[FengZeng/soia](https://github.com/FengZeng/soia)（210★，渲染层是闭源 `soia_utils`） | **采用**（D16、D17）：soia 提供界面、播放逻辑和 Windows/Linux 渲染层，Frame 提供 macOS 渲染层的做法 |
| mpv 画面放在透明 WebView 下面，render API 方式 | [mtaylor45/tauri-plugin-mpv](https://github.com/mtaylor45/tauri-plugin-mpv)（2★） | 只有 Linux 实际跑过，Windows 和 macOS 未验证 |
| 换成 CEF 内核 | Tauri 3.0 alpha 的 `tauri-runtime-cef`（[文档](https://v3.tauri.app/develop/cef/)）；[jellyfin/jellyfin-desktop](https://github.com/jellyfin/jellyfin-desktop)（5972★，Qt WebEngine + libmpv）；[andrewrabert/jellium-desktop](https://github.com/andrewrabert/jellium-desktop)（1875★，CEF + mpv） | 实验阶段，体积多几百 MB，背离迁移初衷 |
| libVLC、GStreamer | 没找到活跃的 Tauri 项目 | 嵌入问题相同，分发更重 |
| Flutter + media_kit | [media-kit/media-kit](https://github.com/media-kit/media-kit)、[Predidit/Kazumi](https://github.com/Predidit/Kazumi) | 靠 Flutter 的外部纹理实现，和 cc-switch 架构不同，仅作对照 |
