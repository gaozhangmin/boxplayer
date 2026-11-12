# M2 验收记录

日期：2026-11-06。范围：implementation-plan.md 的 M2 最小流程。本机 macOS arm64 验收通过；停在 M3 前。本记录不将播放器完整功能行 #95/#96 或全部目标平台记为完成。

## 按计划验收

| 计划条件 | 实现与证据 | 结果 |
|---|---|---|
| 本地来源→列表→实际播放 | 原生目录选择器添加仓库 e2e/assets；统一「文件」入口下直接显示 assets，列出真实文件，点击 mpv-sample.mp4；独立 Tauri 播放窗内显示真实 320×180、30 秒样片和 mpv v0.41.0 | 本机通过 |
| 暂停、seek、关闭重开恢复 | 实际暂停、进度滑块键盘 seek；关闭播放器后重开；再暂停在 15 秒、退出整个开发应用并重启，来源仍在；日志 `Resuming playback at 15.000 seconds`，播放窗从该位置继续，随后暂停在 19.2 秒 | 本机通过 |
| HTTP 请求头、字幕和 403 刷新 | 本机 axum fixture 检验 UA/Referer/Origin/Date/Authorization、同源重定向保留、跨源移除凭据、Range 206、过期链接 403 后刷新一次；字幕使用独立账号鉴权。额外用真实 libmpv 加载该 HTTP 媒体、选择鉴权字幕并 seek | 自动测试通过；无真实网盘账号验收 |
| macOS 不依赖 soia_utils | Rust 直接动态加载 libmpv；原生 NSView 嵌入。运行进程 lsof 显示加载开发 .app 内 Resources/runtime/libmpv.dylib 和 libMoltenVK.dylib，无 soia_utils / libmpv-wrapper；运行时复制脚本亦排除二者 | 本机通过 |
| 合成迁移往返、拒绝损坏、不改源数据 | 版本化本地来源/进度包，计数与 SHA-256 校验，SQLite 事务和导入摘要；测试覆盖往返、重复导入、损坏拒绝、来源保持、触发器注入失败后的目标事务回滚 | 自动测试通过；仅 M2 格式原型 |

截图临时保存在 `/private/tmp/boxplayer-tauri-m2-playback.png` 和 `/private/tmp/boxplayer-tauri-m2-restart.png`，不纳入源码。原生还观察到同名 SRT 被自动选中、全屏后画面与控件同步扩展。未把这些观察扩展为全部编码、声道和显示器的兼容性结论。

## 检查命令

在 `boxplayer/tauri-app/` 执行；本机工具链环境见 README。

| 命令 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test` | 6 文件、16 测试通过；含来源平铺、文件夹/视频操作身份、播放器当前 session 和旧事件拒绝 |
| `pnpm build` | 通过，三个页面 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 通过 |
| `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml` | 15 通过、2 ignored；ignored 项如下单独实际执行，并非未测 |
| `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` | 通过 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml player::integration_tests -- --ignored --nocapture` | 2 通过：真实 libmpv 的 HTTP/字幕/刷新；HDR/DV 样片读取 |
| `pnpm tauri build --debug --bundles app --config '{"bundle":{"active":true}}'` | macOS arm64 debug .app 构建通过，约 104.13 MiB；原生实际启动 |

HDR 测试读取本机 `testVideo` 的 1080p AV1 HDR10、DV P5、DV P8.1 样本，检查媒体加载、尺寸和时长，并打印可用 video-params。P8.1 可读到 dolbyvision/pq/bt.2020 元数据。该测试使用 headless 输出，**不证明 HDR 亮度、色彩、EDR、DV 色调映射或显示器实际输出正确**；这些仍需显示设备验收。

## 实现边界

- Rust 是来源、进度和设置的持久化入口；来源路径规范化，目录遍历和指向根外的符号链接被拒绝。播放 worker 独占 mpv handle，关闭时先保存、释放 mpv，再销毁宿主窗口。播放事件带 session/item/sequence，控制拒绝旧 session。
- HTTP 网关保留 provider/account/file 身份，媒体和字幕分别注册，转发 Range；链接关闭后撤销。请求超时和取消可区分；刷新只重试一次且核对身份，跨源跳转不携带认证头。主窗的真实 provider 刷新适配器尚未接入，当前明确返回不可刷新，留到 M3。
- 当前迁移 UI 提供本地来源/进度 JSON 的原生导出和导入；UI 对话框未单独冒烟，事务和格式由 Rust 自动测试验收。没有导入 Electron 用户库、真实账号或凭据，完整旧数据迁移归 M4。
- 当前本地浏览是最小列表；完整排序、批量操作、多视图和文件管理仍归 M5。HLS 清单改写、真实提供商默认头、完整代理设置和全部播放扩展没有由本次 fixture 代验。

## 运行时来源与平台

开发运行时复制自本机已安装的 Frame Player，mpv 自报 v0.41.0；复制脚本记录每个文件的 SHA-256，附带原 LICENSE/THIRD-PARTY-NOTICES.md，排除 wrapper 和 soia_utils。libmpv SHA-256：`7cb9c54215af49a49ac12cd945a9b1f2163f940a3def32702a959dd27af72e8f`。拷贝位于忽略的 `.local/runtime/macos/`，构建后位于开发包 Resources/runtime；运行时不要求 Frame 应用继续运行。

soia 参考版本 baec808，Frame 源码参考版本 5a05260；soia 控件及 FFI 改编清单、许可证见 tauri-app/THIRD_PARTY_NOTICES.md。**预编译运行时与 Frame 源码版本之间的可复现构建关系尚未证明**。正式分发前仍须固定源码构建运行时、补齐最终依赖声明，并做签名/公证与安装更新验收，归 M9。

| 客户端/平台 | 本次状态 |
|---|---|
| Tauri macOS arm64 | 上述源码、检查、开发包及原生最小播放流程通过 |
| Tauri macOS Intel | 未构建、未运行 |
| Tauri Windows x64/arm64 | 未构建、未运行；原生渲染宿主待实现 |
| Tauri Linux X11/Wayland、x64/arm64 | 未构建、未运行；原生渲染宿主待实现 |
| 现有 Windows/Electron | 未改主工程入口、依赖、版本；未启动或执行运行回归 |
| Apple 原生 macOS、iOS/iPadOS、tvOS | 不修改、不构建；macOS 仅作侧栏交互参考 |
| Android 手机/平板、Android TV | 不修改、不构建、不运行 |

开发数据只写 `com.boxplayer.migration.dev` 的独立目录。原搜索相关未提交改动保持；没有发布、提交或推送。本阶段结束，不启动 M3。

## M2 界面纠正验收（2026-11-06）

上一版只改编了 soia 两个控件，不能称为直接集成 soia 播放界面；本次已替换。`src/vendor/soia/` 直接纳入原 PlayerHeader / PlayerControls / LeftControls / RightControls / SeekBar / ControlSlider / SideActionsNav / PlaylistDrawer / ContextMenu / CastDevicePopover 及其原样样式。`upstream-manifest.json` 保存源码 SHA-256，`node scripts/check-soia-upstream.mjs` 验证 59 个来源文件。允许的源码差异只有两组件的原生 import 重定向和 useCasting 的发现事件参数类型；原模板、SVG 与样式未重写。兼容模块不导入 soia 的 mock 业务数据、凭据或 soia_utils。播放器窗口使用 soia 原深色主题，主应用仍保持正式图标和森林绿主题。

侧栏重新核对 macOS MainWindowsView.swift 的 SidebarEntry.sample：主屏幕、媒体库、文件都是可选择、可折叠的同级根入口，子来源仅置于文件之下，不再用主屏幕/媒体库分组标题包住其他入口。MainSidebarNav 回归测试检查三个 sibling 根、选择和独立折叠。

最终 macOS arm64 debug .app 约 104.22 MiB。原生选择 testVideo 目录，列出其 14 个真实文件；播放 1080p DV P5、4K AV1 HDR10 40M 和 50M。原 soia 倍速菜单实际切到 1.25x，暂停与键盘 seek、原 Next 按钮切换下一文件通过，原播放列表抽屉前台展开可见并显示 14 项。没有把样片可播放扩大为 HDR 色彩/亮度、8K 流畅性或全部样片验收。截图：`/private/tmp/boxplayer-soia-integrated.png`、`/private/tmp/boxplayer-tauri-sidebar-roots.png`。原生开发应用保留打开，视频暂停。

本次前端 7 文件/17 测试、typecheck、构建、Rust fmt/check 与 15 项普通测试通过。投屏、PiP、Shader、双字幕/字幕外观、在线字幕及高级播放列表管理仍待对应阶段接入；原入口给出未接入提示，不执行伪操作。基础画面调节/延迟/缩放经受限命令适配，未穷举原生验收；播放器对 Rust 只开放列出的有限动作，不允许任意 mpv 命令。macOS Intel、Windows、Linux 未验证；旧 Electron、Apple 原生与 Android 各客户端没有改动。本轮仍停在 M3 前。

收尾再次显式执行两个 ignored 的 libmpv 集成测试，2/2 通过（HTTP 鉴权/字幕/403 与 testVideo 的 HDR/DV 样本读取）；不能将默认测试的 ignored 数目解释为这些测试本轮未执行。

## 顶部栏样式隔离修正（2026-11-06）

直接集成组件仍可能受到宿主全局样式干扰。之前 bootstrap.ts 导入主应用 style.css，Tailwind preflight 与 button/input 的 font reset 改变了 soia 原按钮和输入框的浏览器默认样式。本次将主样式移到 main/settings 各自入口，player 只加载 soia 原样式、提示组件样式和最小窗口容器样式。原 PlayerHeader 模板、图标、尺寸规则未修改。

Rust snapshot 新增 displayPath：本地文件提供规范化路径，让 soia 原函数显示 ~/Downloads/...；远程媒体只提供标题，不把签名 URL 或认证数据作为显示路径。新增路径显示断言通过。pnpm typecheck、17 前端测试、Rust fmt/check、debug .app 构建通过；59 份 soia 来源校验通过。scripts/check-player-css.mjs 检查构建后的 player.html 所有直接 CSS，确认没有主界面 reset/导航样式泄漏。

本机用 testVideo/Test Jellyfin 4K HEVC HDR10 100M.mp4 验证普通窗口及原全屏按钮切换后的顶部布局，路径、信息/队列及右侧按钮可见。截图 /private/tmp/boxplayer-soia-header-window.png、/private/tmp/boxplayer-soia-header-fullscreen.png。开发包约 104.24 MiB；本次没有新增 Windows/Linux 或其他客户端运行验证，M3 未开始。

## HDR/DV 专项追加

本机完整 20 文件矩阵及 HDR 输出遗漏修正见 [hdr-validation.md](hdr-validation.md)。以该报告的渲染目标与实屏验收边界为准；不能用本报告早期的样片读取证据认定 HDR 显示已通过。

## 原生 HDR 显示链路追加（2026-11-06）

实际 mpv Metal 图层的 PQ/EDR、10bit 格式及 HDR→SDR 元数据清理已验证；EDR current 动态达到约 7.89，更新早期 current=1 的解释。生成可复现高亮/近黑/SDR 测试图。物理亮度/色准仍待实屏与仪器验收，当前未提供 DV 原生信号透传。详见 [追加报告](hdr-surface-validation.md)。仍停在 M3 前。

## 用户实屏高亮初检（2026-11-06）

用户在实际播放器全屏查看 PQ 高亮阶梯后，确认 600、1000、1600 三档能够区分，记录为实屏高亮阶梯可区分性初检通过。此结论来自用户肉眼反馈，不代表测得对应 nit，不扩展为色准、近黑或 DV 实景通过。

下一项为近黑测试图检查，随后检查 DV P5/P8.1/P8.4 实景及切回 SDR。精确亮度/色准仍待仪器测量，当前未提供原生 DV 透传；M3 未开始。

## 用户实屏近黑初检（2026-11-06）

用户查看全屏近黑测试图后，针对 0.1、0.5、1、5 阶梯确认“有区分”，记录为这些近黑阶梯的肉眼可区分性初检通过。未收到偏色结论；不将此反馈扩展为最暗 0.005/0.01 档、仪器色准或 DV 实景验收通过。下一项为 DV P5/P8.1/P8.4 实景检查，仍停在 M3 前。

## 用户实屏 DV P5 初检（2026-11-06）

用户查看 Test Jellyfin 4K DV P5.mp4 后，确认未见明显偏紫、偏绿、颜色失真或亮部大片发白，记录为该样片的实屏明显异常初检通过。不扩展为仪器色准、其他 DV profile 或原生 DV 信号透传通过。下一项为 P8.1，仍停在 M3 前。

## 用户实屏 DV P8.1 初检（2026-11-06）

用户查看 Test Jellyfin 4K DV P8.1.mp4 后反馈“正常”，针对明显偏色、颜色失真或亮部大片发白的检查记录为该样片实屏初检通过。不代表仪器色准或原生 DV 信号透传通过。下一项为 P8.4，仍停在 M3 前。

## 用户实屏 DV P8.4 初检（2026-11-06）

用户查看 Test Jellyfin 4K DV P8.4.mp4 后反馈“正常”，针对明显偏色、颜色失真或亮部大片发白的检查记录为该样片实屏初检通过。至此高亮、指定近黑阶梯及 DV P5/P8.1/P8.4 的用户实屏初检均已记录；精确亮度/色准和原生 DV 信号透传结论不变。下一项为切回 SDR 的实屏检查，仍停在 M3 前。

## M2 实屏补验收尾（2026-11-06）

用户确认从 DV P8.4 切回 Test Jellyfin 1080p HEVC 10bit 3M.mp4（SDR）后画面“正常”，针对异常发亮、发灰或偏色的检查记录为该次切换实屏初检通过。

本轮用户实屏补验结果：

| 项目 | 用户反馈及结论 |
| --- | --- |
| PQ 高亮阶梯 600 / 1000 / 1600 | 能区分，肉眼可区分性初检通过 |
| 近黑阶梯 0.1 / 0.5 / 1 / 5 | 有区分，肉眼可区分性初检通过 |
| 4K DV P5 | 未见询问中的明显偏紫、偏绿、颜色失真或亮部大片发白 |
| 4K DV P8.1 | 正常，明显异常初检通过 |
| 4K DV P8.4 | 正常，明显异常初检通过 |
| DV → HEVC 10bit SDR | 正常，切换后明显异常初检通过 |

本轮计划的实屏初检已完成。证据限于本机开发包、上述样片及用户肉眼反馈，不代表仪器测得的峰值亮度、EOTF、白点或色准通过；最暗 0.005/0.01 档未验收，独立灰阶偏色检查未单独确认。当前输出为 DV 解码/色彩处理后的 PQ/EDR，未提供原生 DV 信号透传。严格性能及其他平台的验证边界保持不变。

M2 本轮补验收尾，停在 M3 前；未启动账号/提供商迁移，未发布。
