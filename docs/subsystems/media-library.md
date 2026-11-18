# 来源、收藏与媒体库

## 桌面歌词拖动更新（2026-11-14，本地源码）

悬停透明更新：鼠标移出隐藏工具条并将组件背景设透明；流光 Canvas 的透明绘制模式跳过底色/大范围底光，不是仅隐藏 DOM 背景，仍保留粒子文字和拖尾。移入恢复背景/操作，透明时关闭残留右键菜单。主播放器不启用此透明开关。

独立桌面歌词默认解锁，可从歌词内容/空白处拖动；按钮、颜色输入等交互区域排除。拖动期间监听 window mousemove/mouseup/blur，释放或组件销毁清理监听，手动锁定与原点击穿透设置保留。该组件无歌词前进/后退控件。本次未启动桌面应用验收。

## 音乐下载状态（2026-11-14，本地源码）

进度圈布局更新：移除播放器独立右上角状态，MusicBottomConsole 的现有视觉控制菜单按钮内居中叠加 ring 模式 MusicDownloadBadge，中心保留原图标。无单独的百分比或状态字样，不拦截鼠标；队列标记仍显示完整状态。

PageMusic 为队列/迷你队列和播放器右上角提供下载状态。通过 Dexie liveQuery 读取现有持久任务，同时合并下载/已下载 Pinia 即时更新；以 user_id/drive_id/file_id 三元组匹配，不依赖同名文件。MusicDownloadBadge 显示真实任务进度环/百分比、完成勾号、失败警示及暂停/取消/排队；未知大小保持不定进度，字节满额不等于任务完成。订阅随播放器销毁清理。未增加新的音乐下载引擎或下载入口。类型/单测结果单独报告，未运行应用或实际下载验收。

## 独立桌面流光组件更新（2026-11-13，本地源码）

- 视觉设置中的歌词模式决定播放器歌词按钮与桌面歌词窗口的默认模式；开启桌面歌词后，同步当前行、播放/暂停、模式与文字/光/背景三色。组件工具条可临时切换普通/流光，双击锁定/解锁、拖动/缩放，置顶与鼠标穿透沿用原窗口能力。
- Electron 修复原来不存在的 desktop-lyrics.html 路径：新增独立 Vue 入口与 Vite 多页输入，资源使用相对路径，打包从 asar/dist 加载，避免重启整套账号/播放初始化。主进程缓存最新状态，组件就绪后重放，标准化 text/next/playing 与配置数据；新增当前窗口 move 命令。
- 本段覆盖早期“不改变独立悬浮歌词窗口”的范围。类型检查、桌面 payload 与流光排版共 7 项单测通过；未构建安装包或启动新应用验收。

## 桌面歌词模式（2026-11-13，本地源码）

PageMusic 视觉设置 → 歌词外观支持普通/流光（默认普通），pm.lyricPresentation 与 pm.flowingColors 独立持久化。MusicFlowingLyrics.vue/FlowingLyrics.ts 使用 Canvas 字形颗粒、扫光、光丝及底光，隐藏 console 并卸载原 Three 舞台。支持文字/光/背景颜色；双击或 Escape 退出，右键切回普通或调色。暂停冻结、减少动态效果静态显示、后台停止动画，退出释放调度与观察器。类型检查及相关 7 项单元测试通过；未启动应用视觉验收，不改变独立悬浮歌词窗口。

路径按本仓库根目录解释。修改前核对当前源码和调用者；本文不宣称已完成运行验收。

## 职责与源码

- [mediaScanner.ts](../../src/utils/mediaScanner.ts)：扫描入口与 provider 文件遍历。
- [mediaSourceMembership.ts](../../src/utils/mediaSourceMembership.ts)：mediaDriveFileKey、mergeDriveFileSources、reconcileMediaItemSource。
- [mediaScrapeMerge.ts](../../src/utils/mediaScrapeMerge.ts)：mergeScrapedMedia 和 associateScrapedFiles 的媒体与文件关联。
- [favorites.ts](../../src/utils/favorites.ts)：收藏入口的公共逻辑。

## 运行路径与状态

来源和账号 → 文件夹收藏 → 遍历/匹配 → 合并媒体与关联文件 → 持久化及展示。取消收藏时按仍有效的 folder/source membership 决定清理范围，不能把同一媒体的其他文件来源一并删除。

## 失败与兼容边界

扫描失败不是空目录；hash/接口错误不是确认无匹配。检查整盘、父子目录重叠收藏、重复扫描与部分失败，保留旧资料和其他来源关联。

## 验证与维护

先读 [开发与执行约束](../agent-development.md) 和 [代码标准](../code-standards.md)。验证按本次用户要求及平台限制执行；未运行的测试、构建和真实设备检查要明确标注。契约改变时同步本文，并核对旧调用者。

## 既有产品规则

## Home Category Context Menus

- Categories and independently placeable subcategories, including series, playlists, movie/TV child categories, genre, rating, score, and release-date values, use the same placement context-menu state machine.
- An unplaced item shows “Add to Home” and “Add to Favorites”; both actions prompt for a user-defined display name.
- After either add action succeeds, or when the item is initially visible on Home, the menu immediately switches to “Remove from Home” and “Rename Favorite.” The menu must not allow simultaneous Home and Favorites placement.
- “Remove from Home” clears whichever placement contains the item. Renaming a favorite changes only its Favorites card title and does not rename the Home or sidebar title.
- Exception: media server categories expose only Favorites actions (plus play / loop / shuffle); their Home shelf is managed in the Add to Home sheet and is independent of the Favorites card.

## 文件来源浏览与收藏规则

- 网盘、网络共享、媒体服务器沿用本地文件夹的来源浏览与收藏交互；取消网盘、网络共享的文件夹收藏（子文件夹或整盘“所有文件”）会移除收藏卡片，并清除从该文件夹（整盘即整个网盘）刮削到媒体库的媒体，但保留来源，也不删除网盘或共享里的文件。媒体库里可添加到收藏夹和主屏幕的类别（如电影下的按类型、按评价或某个具体类别）取消收藏只移除快捷卡片，不影响已收录媒体。删除来源会清理该来源的全部关联媒体。
- 媒体服务器使用服务端元数据，不为服务器目录启用本地刮削。
- 媒体服务器浏览页不展示本地媒体库扫描提示。已存储共享中打开媒体服务器时直接列出实际库或条目，不添加“所有文件夹”收藏占位。
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

## 目录缓存循环保护

TreeStore 的父目录路径、向上尺寸更新和子目录尺寸递归均检测当前遍历链的重复 ID；遇到循环引用抛出错误，不无限追加路径、递归计算，也不将损坏缓存认作成功空目录。有效目录树顺序与尺寸语义保持；此保护不等于已修复产生循环的提供商响应或本地缓存写入原因。

本轮真实天翼家庭目录诊断确认：family-root → personal-root → 空父 ID；旧内存缓存又包含“空 ID → personal-root”条目，旧路径遍历未将空父 ID 视为结束而继续回到根，形成循环并耗尽堆。修复将空父 ID 作为强制终止，并在构造目录缓存投影时排除空 ID 条目；不删除账号、原始持久缓存或远端文件。循环检测继续保护非空 ID 的异常环。

## 音乐头部后台队列（2026-11-14）

`musicEnrichment` 不等待头部读取。`musicHeadMetadata` 投递独立任务；`musicAccountQueue` 按账号串行、文件去重、1 秒间隔与 429/Retry-After 冷却。IPC 结构化返回节流字段，解析运行于 Web Worker；有效下载地址在内存短时复用，成功标记探测版本。头部补写与在线补写按歌曲串行合并，内嵌标签优先，删除/手动信息检查后再保存。

临时在线失败采用约 1 分钟退避、正常无匹配/线索不足采用约 1 小时退避；不降低可靠线索及置信度门槛。音乐库显示期间定时检查到期项目，离开时停止目录补全计时器。封面加载失败记录诊断、标记地址并隔离 5 分钟，不将非空地址视为永远有效；专辑传播避开隔离地址。临时本地导入先播放，后补头部标签。

细节及原生端未验证范围见工作区 `docs/music-metadata-review.md` 的 2026-11-14 补记；本轮不含客户端发布。


## 2026-11-14 更新：只在用户播放当前歌曲时读取头部

本节取代此前“扫描后自动后台读取整库”的触发规则。音乐扫描/点击刮削只枚举、保存文件提示及请求在线元数据 API；在线请求结束即结束本次刮削，不再提交任何音频头部任务。导入/进入音乐库/排队/预加载也不触发标签读取。

用户实际选择播放歌曲后，仅该曲投递后台头部任务，复用播放器已经取得的 URL 和原始 headers，不再次调用网盘下载地址接口；最多读取 offset-0 的 1 MiB，共享本地解析核心不变。账号队列、429 冷却和 Retry-After 保留。读取失败不设置音频重试计时器，等待以后用户再次播放；不能借失败重试重新解析下载地址。成功持久化探测版本，避免重复读取。自动切歌和交叉渐变预加载不主动补标签。

Android Phone/Pad/TV 共用 MusicHeadJobs 与播放器入口；Apple iOS/iPadOS/macOS/tvOS 共用 DriveAudioPlayerManager；Electron 和 Tauri checkout 分别接入播放页。媒体服务器继续使用其服务端元数据，不额外读取原始音频。Tauri 本地选择器不再逐文件读取标签；播放后的 bridge 采用限量流读取和取消，保留请求头。

本轮没有 API 协议或官网调用变更，无需部署 API。未执行客户端发布。


## 2026-11-14：音乐分批发布

检查确认扫描器分目录/分页 appendTracks 后更新 Pinia，在线补全每个 API 批次保存，无需等待整轮。新增回归：13 首拆 11+2，第二批仍未返回时已有 11 首保存。相关 3 文件 16 项通过；本轮无 Electron 业务逻辑改动、应用启动或 E2E。


## 2026-11-15：本地音频自动后台提取

本地选择器结束后调用 scheduleLocalTrackHeads；local 身份及本地 URL 双重检查，后台串行 IO + Web Worker，成功保存探测版本，失败继续其余文件。网络来源保持播放时才读。13 项相关测试和 vue-tsc 通过，未应用/E2E 验证。
