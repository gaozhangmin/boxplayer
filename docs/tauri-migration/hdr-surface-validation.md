# macOS 原生 HDR 显示链路追加验收（2026-11-06）

本轮只验证 Apple Silicon 上 Tauri 开发包的真实播放器窗口。M3 未开始。汇总证据见 [hdr-surface-results.json](hdr-surface-results.json)；原始 JSONL 位于 /private/tmp/boxplayer-hdr-qa/surface-run/，临时目录不保证永久保留。

## 已确认的链路

在 AppKit 主线程遍历实际播放器 NSView/CAMetalLayer，区分 mpv 的 swift.View / swift.MetalLayer 与 WKWebView 图层；记录窗口所在 NSScreen，而非另一个辅助进程的默认屏幕。

| 状态 | 实际 Metal 色彩空间 | wantsEDR | EDRMetadata |
| --- | --- | --- | --- |
| 初始 AVC SDR | sRGB | false | 无 |
| DV P5 / P8.1 / P8.4、HDR10 | ITU-R 2100 PQ | true | 有 |
| 修复后 HDR → HEVC 10bit SDR | sRGB | false | 无 |
| 再次打开 HDR10 | ITU-R 2100 PQ | true | 有 |

实际像素格式为 94，即 SDK 中的 BGR10A2Unorm（10bit）。普通窗口 960×600、全屏 1496×939 均采到 PQ 图层。前台全屏 DV P8.4 时 EDR current 从 1 上升至约 7.37；修正后的 PQ 高亮图采到约 7.89，potential=16、reference=0。EDR 是系统报告的相对余量，不是实测 nit。此前 current=1 的快照不能认定硬件无法 HDR，也不能单凭大于 1 证明实际亮度或色准合格。

发现切回 SDR 后旧 EDRMetadata 对象仍保留；新增 macOS 原生清理，在 mpv 图层已退出 EDR 后置空元数据。没有更改显示亮度、系统预设、色彩空间或 WKWebView 图层。DV P8.1 → HEVC 10bit SDR → HDR10 的开发包实测确认清理及重新启用均正常。

## 实屏检查素材

scripts/generate-hdr-charts.py 生成 testVideo/calibration 下三段 1080p/10bit/FFV1 无损测试图：PQ 高亮 100/203/400/600/1000/1600、近黑 0–5，以及 SDR 灰阶。标签是输入信号的名义亮度，不是测得的屏幕亮度。生成器核对解码后的灰块码值及色彩标记；修正了最初 FFV1 帧没有携带 PQ 标记的问题，最终播放器读到 gamma=pq，实际图层为 PQ/EDR。汇总排除了错误标记版本的图层结果。

这些是辅助排查图，不能替代认证参考素材和仪器。先保持显示预设、亮度、环境光稳定，在播放器实际屏幕看高亮阶梯有无提前合并、灰阶有无偏色、近黑有无压黑。600/1000/1600 的可区分性受屏幕峰值和色调映射影响，不能把肉眼区分直接换算为实际 nit。截图和聊天预览不可用于 HDR 亮度验收。

正式亮度/色准验收需要 HDR 色度计或分光仪，记录显示器型号/预设/亮度、窗口面积和映射设置，测量灰阶、白点、EOTF、峰值及色块，按事先约定的目标和容差判断。当前没有仪器读数，保持未验收。

## Dolby Vision 的结论

当前链路是 DV 解码/色彩处理后输出 PQ/EDR；现有证据不能称为 Dolby Vision 原生信号透传或认证。若产品要求外接电视接收原生 DV，需要另行实现支持的输出链路，并结合接收端 DV 模式及 HDMI 分析仪检查信令与动态元数据；电视弹标也不能独立证明元数据正确。此项是当前未提供的能力，不能靠增加播放样片验收通过。

## 回归与边界

Rust 普通测试 16 通过、3 ignored；本轮单独重跑 HDR→SDR 选项恢复集成测试通过。cargo check、fmt、debug .app 构建通过，包约 104.43 MiB。soia 原组件未改。测试结束关闭采样进程并删除临时启用配置。

原 20 文件的 VideoToolbox/掉帧结果仍以原专项报告为准；FFV1 测试图采用软件解码，不计入该硬解结论。Windows/Linux/macOS Intel 未运行；Electron、Apple 原生 macOS/iOS/iPadOS/tvOS、Android 手机/平板/TV 均未修改或代验。

依据：[Apple CAMetalLayer EDR](https://developer.apple.com/documentation/quartzcore/cametallayer/wantsextendeddynamicrangecontent)、[NSScreen EDR 余量](https://developer.apple.com/documentation/appkit/nsscreen/maximumextendeddynamicrangecolorcomponentvalue)、[ITU-R BT.2100](https://www.itu.int/rec/R-REC-BT.2100)。

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
