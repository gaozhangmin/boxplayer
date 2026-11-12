# HDR / Dolby Vision 本机专项测试

日期：2026-11-06。范围：新 Tauri 客户端、macOS arm64；20 个 testVideo 样片。

## 结果

- 20/20 通过 FFmpeg 8.1.2 首帧解码；20/20 在真实开发 .app 内打开、推进播放，均报告 VideoToolbox 硬解；本机 Apple M5 Pro / 48 GB。
- 发现并修复 HDR 输出切换遗漏：基线的 17 个 HDR/DV 样片虽被识别为 PQ/Dolby Vision，却输出 SDR；适配 soia hdr_output.rs 后，17/17 的 video-target-params.gamma 变为 pq，3/3 SDR 保持 bt.1886。
- 使用实际 mpv 属性采样，并非用文件名、界面 HDR 标识或截图认定输出。原生先逐片采集基线，再逐片复测；每片主要采样约 8–10 秒，部分播放至结束，不代表 20 个文件全部完成独占前台全时长性能回归。
- 8K HEVC 150M 实测 seek、暂停、全屏与返回窗口；其他片主要验证打开、推进、换片与色彩输出。全屏不是每片逐一验收。

## 逐文件记录

下表丢帧为采样期间累计计数最大值，包含切换、窗口/后台状态及测试期间的其他工作，不能视为严格同条件性能比较。完整属性摘要、SHA-256 和 DV 配置记录见 [hdr-validation-results.json](hdr-validation-results.json)。

| 文件（省略 Test Jellyfin 前缀） | 尺寸 | 输入 TRC / matrix | 基线目标 → 修正目标 | 硬解 | 观察到的最大丢帧（修正后） |
|---|---|---|---|---|---|
| 1080p AV1 10bit 3M.mp4 | 1920×1080 | bt.1886 / bt.709 | bt.1886 → bt.1886 | videotoolbox | 0 |
| 1080p AV1 HDR10 3M.mp4 | 1920×1080 | pq / bt.2020-ncl | gamma2.2 → pq | videotoolbox | 5 |
| 1080p AVC 3M.mp4 | 1920×1080 | bt.1886 / bt.709 | bt.1886 → bt.1886 | videotoolbox | 7 |
| 1080p DV P5.mp4 | 1920×1080 | pq / dolbyvision | gamma2.2 → pq | videotoolbox | 4 |
| 1080p DV P8.1.mp4 | 1920×1080 | pq / dolbyvision | gamma2.2 → pq | videotoolbox | 1 |
| 1080p HEVC 10bit 3M.mp4 | 1920×1080 | bt.1886 / bt.709 | bt.1886 → bt.1886 | videotoolbox | 0 |
| 1080p HEVC HDR10 3M.mp4 | 1920×1080 | pq / bt.2020-ncl | gamma2.2 → pq | videotoolbox | 0 |
| 4K AV1 HDR10 40M.mp4 | 3840×2160 | pq / bt.2020-ncl | gamma2.2 → pq | videotoolbox | 3 |
| 4K AV1 HDR10 50M.mp4 | 3840×2160 | pq / bt.2020-ncl | gamma2.2 → pq | videotoolbox | 0 |
| 4K AV1 HDR10 60M.mp4 | 3840×2160 | pq / bt.2020-ncl | gamma2.2 → pq | videotoolbox | 0 |
| 4K AV1 HDR10 90M.mp4 | 3840×2160 | pq / bt.2020-ncl | gamma2.2 → pq | videotoolbox | 0 |
| 4K DV P5.mp4 | 3840×2160 | pq / dolbyvision | gamma2.2 → pq | videotoolbox | 0 |
| 4K DV P8.1.mp4 | 3840×2160 | pq / dolbyvision | gamma2.2 → pq | videotoolbox | 0 |
| 4K DV P8.4.mp4 | 3840×2160 | pq / dolbyvision | gamma2.2 → pq | videotoolbox | 1 |
| 4K HEVC HDR10 100M.mp4 | 3840×2160 | pq / bt.2020-ncl | gamma2.2 → pq | videotoolbox | 0 |
| 4K HEVC HDR10 40M.mp4 | 3840×2160 | pq / bt.2020-ncl | gamma2.2 → pq | videotoolbox | 24 |
| 8K DV P5.mp4 | 7680×4320 | pq / dolbyvision | gamma2.2 → pq | videotoolbox | 3 |
| 8K DV P8.1.mp4 | 7680×4320 | pq / dolbyvision | gamma2.2 → pq | videotoolbox | 24 |
| 8K DV P8.4.mp4 | 7680×4320 | pq / dolbyvision | gamma2.2 → pq | videotoolbox | 0 |
| 8K HEVC HDR10 150M.mp4 | 7680×4320 | pq / bt.2020-ncl | gamma2.2 → pq | videotoolbox | 20 |

## 修复与回归

新增 player/hdr.rs，改编自 soia baec808 的公开 HDR 输出控制逻辑（GPL-3.0-only）。按真实 video-params.gamma 的 pq/hlg 启用输出选项；切回 SDR 时恢复先前选项，设置失败回滚。没有按 10bit 像素格式或文件名判断 HDR，没有使用 soia_utils。macOS 目标采用 soia 的 target-colorspace-hint=yes、target-trc=pq 等设置；本机 macvk 实际协商到 bt.2020 / pq，不能把请求的 display-p3 与实际协商结果混称。

新增真实 libmpv 切换回归：HDR10 → HEVC 10bit SDR → DV P5 → AVC SDR，检查 target-trc 和 target-colorspace-hint 恢复，已通过。Rust 普通测试 16 通过，3 项 ignored 集成测试单独实际执行后全部通过。开发包约 104.36 MiB，类型检查及前端构建通过；soia UI 原组件未改。

调试采集 player/audit.rs 仅在 debug_assertions 中编译，且需要显式的临时 JSON 配置和样片标题允许列表；不采集 URL、请求头、账号。测试后删除配置，关闭采样进程。报告可用 scripts/report-hdr-audit.mjs 从原始 JSONL 重新生成。

## 尚未证明的范围

1. **HDR 实际亮度与色准没有通过验收。** 后续实际窗口图层采样已确认 PQ/EDR，EDR current 最高约 7.89，详见 [原生显示链路追加报告](hdr-surface-validation.md)。下面 current=1 保留为早期快照记录。 内建 Retina 屏报告 EDR potential=16、current=1、reference=0；PQ 输出期间再次读取仍是 current=1。这是当时的系统能力报告，不等于已定位其原因，也没有改动系统亮度、显示预设或安全设置。需结合实际显示器输出和参考图/测量继续验证。
2. video-target-params 的 PQ/峰值元数据是渲染目标，**不是测得的屏幕亮度**。已追加实际 Metal 图层采集，但没有用色度计验证；特别不能将 max-luma=10000 解读为屏幕达到 10000 nit。
3. DV P5/P8.1/P8.4 的配置记录、RPU 存在和 mpv dolbyvision matrix 被识别；此处验证的是解码/色彩处理及 PQ 渲染目标，**不等于 Dolby Vision 原生信号透传或认证**。截图不证明 HDR/DV 高亮或主观色彩正确。
4. 这些样片未检出音轨，因此音画同步、多声道、音频直通未覆盖。P7、HDR10+、独立 HLG 也不在这 20 个文件中；P8.4 的 HLG 兼容基底不能代替独立 HLG 验收。
5. 有少量掉帧，不能宣称全部 60fps 零掉帧。压力性能需后续固定前台/电源/显示模式做完整片段复测。
6. Windows、Linux、macOS Intel 未运行；原 Electron、Apple 原生 macOS/iOS/iPadOS/tvOS、Android 手机/平板/TV 均未修改或代验。当前仍停在 M3 前。

参考：[mpv 原生选项手册](https://mpv.io/manual/master/)，[Jellyfin 样片目录](https://fra1.mirror.jellyfin.org/test-videos/)。原始临时证据目录：/private/tmp/boxplayer-hdr-qa/，含 metadata.json、native-baseline.jsonl、native-fixed.jsonl、display*.json 与原生截图；临时文件不作为永久归档保证。
