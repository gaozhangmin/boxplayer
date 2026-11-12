# M5 最终验收审计（2026-11-09）

结论：M5 开发及当前约定的非真实账号验收完成。真实账号检查按用户要求后置；这不表示远端写操作或所有目标平台已经验收。停在 M6 前，不启动传输引擎，不提交或发布。

## 验收口径

依据 implementation-plan.md 的 M5、feature-inventory.md §3.5/§4.3，以及用户后续明确要求：直接迁移 Electron 原文件 UI/交互，只适配 Tauri 接口。§3.5 已补记这一后续要求对早期重新设计建议的优先级。每项分别使用原代码保真、宿主/协议合成测试及适用的本机实屏证据；不以提供商声明或模拟结果代替真实账号效果。

## 逐项证据

测试路径均相对 `tauri-app/tests/`。下列测试包含在当前全量 246 文件、2418 项通过结果中；原生 218 项通过、10 项既有忽略见独立日志。

| 要求 | 已核查的当前实现与证据 | 当前结论及界限 |
|---|---|---|
| 840px 外壳、约550–600px内容区、自适应布局 | AddFileSourceModal 的840/max-viewport/30%分栏；SourceDriveManager宿主适配；当前包实屏可进入21项目录、三列缩略图；选中栏修正版实屏完整显示计数和操作、视图按钮换行 | 本机构建/实屏通过；非所有缩放比例的像素测量 |
| 多层弹窗和窄内容区 | source-drive-picker、properties-ui、file-tree、import-ui、quark/guangya/pikpak-import-ui；原目录选择器内新建失败/重试/返回；用户确认接近最小宽度的属性及复制目录树内容/按钮/关闭完整 | 原组件和嵌套流程合成通过，命名窄窗场景实屏通过；带账号的服务效果后置 |
| #14 三视图、六排序、大小、颜色、预览、分页、空态 | layout-sort-menu、ali-folder-size、ali-color、manager及各提供商list测试；实屏list→thumbnail→large→list保留3/21；用户确认450ms文件夹预览、排序和更多悬停可点 | 本机交互及合成通过；远端缩略图/颜色写入后置 |
| #103 导航、根与特殊视图 | manager、local-directory-names、ali-directory-model、ali-video、ali-recover、trash、ali-open-favorites；原根路径下拉→正在观看→全部专辑测试；原生Enter/Backspace/CmdH及目录返回记录 | 原入口可达，保留原版路径和导航；真实列表后置 |
| #104 选择 | 原PanRight/store及manager、file-selection；原生单选1/21→Shift3/21→Command4/21→Command3/21、全选21/21、区间3/21、反选18/21、取消0/21 | 合成与命名原生组合通过；无文件写入 |
| #105 快捷键 | 原PanRight键盘声明保真；manager、local-shortcut-boundary、relocation、ali-open-relocation、trash、transfer-entry及各原操作测试；原生CmdA/F/Q/H、F3、Enter、Backspace、Space及输入隔离记录 | 原映射/宿主转发及功能端口通过；产生真实服务副作用的键不在用户账号上执行 |
| #16 快筛、跨盘/高级搜索 | ali-search原表单/token/范围/关闭/切源，115-search及提供商search协议测试；原生DV筛选8/21和清空21项记录 | 合成与本地筛选通过；真实远端查询后置 |
| #15 新建目录、日期序号、批量目录、文本 | 原CreatNewDir/Multi/File模板；manager、google-text、ali-text、各提供商folder测试；Guangya原流程6项+适配10项+原弹窗1项、新增native IO测试 | 六个原文本分发提供商已接线；真实创建后置，不开启M6上传队列 |
| #106 单个/批量重命名 | manager、file-selection中原renamemulti算法、各提供商rename与原始批量回执/部分失败重试测试 | 原表单/规则/关联更新合成通过；真实改名后置 |
| #107 移动、复制、目录选择、拖移、C/X | picker、relocation、各提供商move/copy、ali-web/open-relocation；跨盘完整观察→原ID对账→本地事务→播放队列重映射→恢复回执测试 | 合成通过；Open move依官方契约限同盘，真实云操作后置 |
| #108 删除、回收站、恢复 | trash、ali-open-trash、ali-recover及各提供商trash/recycle/clear；移入与直接删除区分；原菜单/确认保留 | 按原能力和独立Open公共契约通过；永久删除没有在用户文件上执行 |
| #109 属性、名字/目录树、打开位置 | properties、properties-ui、file-tree、各提供商properties及search；用户窄窗确认；当前原生右键菜单显示属性/更多，Escape关闭并取消选择 | 原模板/剪贴板合成和命名原生场景通过；未导出用户剪贴板内容 |
| #111 收藏、颜色、历史、观看/专辑、清空收藏 | ali-favorites、ali-open-favorites、ali-color、ali-history、ali-video、ali-empty；保留原请求/模型/模板，包含切源和错误拒绝 | 合成通过；真实服务效果后置 |
| #112 创建分享/快传 | share、share-providers；原快传表单/前缀结果、Ali原quick-transfer endpoint和drive_file_list；各提供商选项、组合限制、部分失败及复制结果重试 | 合成通过；未创建真实公开分享 |
| #101 分享导入 | import-read/flow/save/ui；Quark/Guangya/PikPak import及各原嵌套UI；账号/分享/目标绑定和异步回执测试 | 原四通道接线通过；真实转存后置 |
| #114 整理 | source-drive-organize、file-organize-native：上移、平铺、选目录、识别路径/确认取消及账号绑定 | 合成通过；真实媒体移动后置 |
| #116 115转码 | 115-transcode：原VIP/枫叶请求、单视频约束、服务拒绝、切源中止/迟到通知 | 合成通过；真实转码提交/效果后置；原版没有的终态轮询未新增 |
| 提供商能力 | file-provider-operation-parity：15提供商×11判断；另核查真实uploadmem/share/providerShare分发；各提供商独立协议/宿主测试 | 接线完整性通过；声明比较不当作云服务验收；Ali Open独立核查 |
| 原文件迁移、排除项 | files verifier207映射/23精确模板/2资产；library35/14/4；manager排除分支测试、原样模板；无工具箱或独立分享标签 | 当前源码通过；保留的是分享动作，不恢复舍弃导航 |
| M6传输入口 | transfer-entry、task-workspace、downloading/downed/uploading/uploaded页面与store测试：原确认/选择器、源快照、取消、未装执行器不造成功任务、ZIP模式透传 | M5接口和入口通过；任务执行器/断点/限速/后台续传均未启动 |
| 范围与数据保护 | 本地物理CRUD按§3.5排除；非视频预览M7、AI M8、入库M4；Tauri feat/tauri-migration；Electron main只读并保留并行脏改动 | 未修改其他平台或Electron，未commit/release |

## 当前产物与命令结果

- 前端：`pnpm --dir tauri-app exec vitest run --configLoader native`，246文件/2418通过；日志 `/tmp/m5-final-current-frontend.log`。
- 原生：`cargo test --offline --lib`，218通过/10既有忽略；日志 `/tmp/m5-guangya-text-native-all-unrestricted.log`。本次之后只有宿主CSS和测试/文档变化，无Rust变化。首次沙箱限制本机监听导致18失败，授权后的同套离线测试通过，不隐藏首次结果。
- 类型检查与构建通过；日志 `/tmp/m5-selection-wrap-typecheck.log`、`/tmp/m5-selection-wrap-build.log`；构建212.00MiB。
- 当前已启动并观察的macOS arm64 debug包：`3a752e9ec769c39d8c3f05356d358c825c0f42c364ad196f95629c3eb3912503`。重启通过原生Quit、观察退出、完整bundle路径启动。
- 两项源码保真校验当前再次通过。没有把仅构建或仅声明当作实屏/真实服务结果。

## 保留的后置验收及已知边界

1. 各真实账号的登录/列表/远端搜索、创建/改名/移删/恢复、分享/导入/转码实际效果，以及这些带账号嵌套页面的原生展示，仍逐提供商未验收；用户明确要求后置，不由其他提供商代验。
2. 当前运行验收为本机macOS arm64；Windows/Linux及各平台发布/升级验收留在目标平台回归与M9，未声称通过。
3. 已接受云操作后的本地catalog/播放身份/偏好回执可恢复；未知云提交意图仍是内存状态，不是跨进程的云操作重放系统。恢复备份保存在WebView localStorage，无单独备份导出界面。
4. M6尚未开始；下载/上传入口在没有执行器时明确报告不可执行，不虚构排队成功。本阶段没有实际下载或上传队列。
