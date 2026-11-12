# 来源与扫描适配

路径按本仓库根目录解释。修改前核对当前源码和调用者；本文不宣称已完成运行验收。

本文涉及的新 Tauri 源码仍属于本地未提交迁移工程；本次只提交规则和文档。独立克隆没有这些文件时，明确报告缺失，不用旧 Electron 根工程代替原生验收。

## 职责与源码

- `tauri-app/src/features/library/scanScheduler.ts`（本地迁移源码，尚未随本次文档提交）：新 UI 扫描调度。
- `tauri-app/src/features/files/folderFavorites.ts`（本地迁移源码，尚未随本次文档提交）：文件夹收藏适配。
- `tauri-app/src-tauri/src/catalog_migration.rs`（本地迁移源码，尚未随本次文档提交）：迁移工程的目录数据兼容入口。

## 运行路径与状态

来源选择 → 收藏/扫描调度 → 适配与持久化 → 新 UI 展示。检查调用的究竟是旧代码移植、适配层还是 Rust 命令；迁移清单完成不代表真实账号验收。

## 失败与兼容边界

迁移 UI 不能伪造保存、扫描或操作成功。来源清理与跨目录媒体关联遵循已有产品约定；用户明确延期的真实账号验收不能写成已通过。

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
