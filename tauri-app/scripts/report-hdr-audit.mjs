import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
const raw = process.argv[2] ?? '/private/tmp/boxplayer-hdr-qa'
const sampleDir = new URL('../../../testVideo/', import.meta.url)
const docs = new URL('../../docs/tauri-migration/', import.meta.url)
const read = file => JSON.parse(fs.readFileSync(path.join(raw, file), 'utf8'))
const jsonl = file => fs.readFileSync(path.join(raw, file), 'utf8').trim().split('\n').map(JSON.parse)
const baseline = Map.groupBy(jsonl('native-baseline.jsonl'), row => row.title)
const fixed = Map.groupBy(jsonl('native-fixed.jsonl'), row => row.title)
function summary(rows = []) {
  const valid = rows.filter(r => r.width > 0 && r.position > 0 && r.properties['video-target-params'])
  const last = valid.at(-1)
  if (!last) return null
  return { probes: valid.length, positionRange: [Math.min(...valid.map(r => r.position)), Math.max(...valid.map(r => r.position))], dimensions: [last.width,last.height], hwdec: last.properties['hwdec-current'], sourceTransfer: last.properties['video-params']?.gamma, sourceMatrix: last.properties['video-params']?.colormatrix, outputTransfer: last.properties['video-target-params']?.gamma, outputPrimaries: last.properties['video-target-params']?.primaries, outputPixelFormat: last.properties['video-target-params']?.pixelformat, hint: last.properties['target-colorspace-hint'], outputPeakMetadata: last.properties['video-target-params']?.['max-luma'], droppedFramesMax: Math.max(...valid.map(r => r.properties['frame-drop-count'] ?? 0)), decoderDroppedFramesMax: Math.max(...valid.map(r => r.properties['decoder-frame-drop-count'] ?? 0)), errors: [...new Set(rows.filter(r=>r.error).map(r=>r.error))] }
}
const results = []
for (const metadata of read('metadata.json')) {
  const hash = crypto.createHash('sha256')
  for await (const data of fs.createReadStream(new URL(metadata.name, sampleDir))) hash.update(data)
  const dovi = metadata.metadata.find(line => line.includes('DOVI configuration record'))
  results.push({ name: metadata.name, bytes: metadata.size, sha256:hash.digest('hex'), firstFrameDecodeExit:metadata.exit, hasAudio:metadata.metadata.some(line=>line.includes('Audio:')), dovi: dovi?.trim() ?? null, baseline:summary(baseline.get(metadata.name)), fixed:summary(fixed.get(metadata.name)) })
}
if (results.length !== 20 || results.some(r=>!r.baseline || !r.fixed || r.firstFrameDecodeExit !== 0)) throw new Error('Incomplete 20-file matrix')
const report = { date:'2026-11-06', hardware:read('hardware.json'), displayBefore:read('display.json'), displayDuringPq:read('display-hdr.json'), engine:'mpv v0.41.0', files: results }
fs.writeFileSync(new URL('hdr-validation-results.json', docs),JSON.stringify(report,null,2)+'\n')
let text = `# HDR / Dolby Vision 本机专项测试\n\n日期：2026-11-06。范围：新 Tauri 客户端、macOS arm64；20 个 testVideo 样片。\n\n## 结果\n\n- 20/20 通过 FFmpeg 8.1.2 首帧解码；20/20 在真实开发 .app 内打开、推进播放，均报告 VideoToolbox 硬解；本机 Apple M5 Pro / 48 GB。\n- 发现并修复 HDR 输出切换遗漏：基线的 17 个 HDR/DV 样片虽被识别为 PQ/Dolby Vision，却输出 SDR；适配 soia hdr_output.rs 后，17/17 的 video-target-params.gamma 变为 pq，3/3 SDR 保持 bt.1886。\n- 使用实际 mpv 属性采样，并非用文件名、界面 HDR 标识或截图认定输出。原生先逐片采集基线，再逐片复测；每片主要采样约 8–10 秒，部分播放至结束，不代表 20 个文件全部完成独占前台全时长性能回归。\n- 8K HEVC 150M 实测 seek、暂停、全屏与返回窗口；其他片主要验证打开、推进、换片与色彩输出。全屏不是每片逐一验收。\n\n## 逐文件记录\n\n下表丢帧为采样期间累计计数最大值，包含切换、窗口/后台状态及测试期间的其他工作，不能视为严格同条件性能比较。完整属性摘要、SHA-256 和 DV 配置记录见 [hdr-validation-results.json](hdr-validation-results.json)。\n\n| 文件（省略 Test Jellyfin 前缀） | 尺寸 | 输入 TRC / matrix | 基线目标 → 修正目标 | 硬解 | 观察到的最大丢帧（修正后） |\n|---|---|---|---|---|---|\n`
for(const r of results)text += `| ${r.name.replace('Test Jellyfin ','')} | ${r.fixed.dimensions.join('×')} | ${r.fixed.sourceTransfer} / ${r.fixed.sourceMatrix} | ${r.baseline.outputTransfer} → ${r.fixed.outputTransfer} | ${r.fixed.hwdec} | ${r.fixed.droppedFramesMax} |\n`
text += `\n## 修复与回归\n\n新增 player/hdr.rs，改编自 soia baec808 的公开 HDR 输出控制逻辑（GPL-3.0-only）。按真实 video-params.gamma 的 pq/hlg 启用输出选项；切回 SDR 时恢复先前选项，设置失败回滚。没有按 10bit 像素格式或文件名判断 HDR，没有使用 soia_utils。macOS 目标采用 soia 的 target-colorspace-hint=yes、target-trc=pq 等设置；本机 macvk 实际协商到 bt.2020 / pq，不能把请求的 display-p3 与实际协商结果混称。\n\n新增真实 libmpv 切换回归：HDR10 → HEVC 10bit SDR → DV P5 → AVC SDR，检查 target-trc 和 target-colorspace-hint 恢复，已通过。Rust 普通测试 16 通过，3 项 ignored 集成测试单独实际执行后全部通过。开发包约 104.36 MiB，类型检查及前端构建通过；soia UI 原组件未改。\n\n调试采集 player/audit.rs 仅在 debug_assertions 中编译，且需要显式的临时 JSON 配置和样片标题允许列表；不采集 URL、请求头、账号。测试后删除配置，关闭采样进程。报告可用 scripts/report-hdr-audit.mjs 从原始 JSONL 重新生成。\n\n## 尚未证明的范围\n\n1. **HDR 实际亮度与色准没有通过验收。** 内建 Retina 屏报告 EDR potential=16、current=1、reference=0；PQ 输出期间再次读取仍是 current=1。这是当时的系统能力报告，不等于已定位其原因，也没有改动系统亮度、显示预设或安全设置。需结合实际显示器输出和参考图/测量继续验证。\n2. video-target-params 的 PQ/峰值元数据是渲染目标，**不是测得的屏幕亮度**。没有采集底层显示链路或用色度计验证；特别不能将 max-luma=10000 解读为屏幕达到 10000 nit。\n3. DV P5/P8.1/P8.4 的配置记录、RPU 存在和 mpv dolbyvision matrix 被识别；此处验证的是解码/色彩处理及 PQ 渲染目标，**不等于 Dolby Vision 原生信号透传或认证**。截图不证明 HDR/DV 高亮或主观色彩正确。\n4. 这些样片未检出音轨，因此音画同步、多声道、音频直通未覆盖。P7、HDR10+、独立 HLG 也不在这 20 个文件中；P8.4 的 HLG 兼容基底不能代替独立 HLG 验收。\n5. 有少量掉帧，不能宣称全部 60fps 零掉帧。压力性能需后续固定前台/电源/显示模式做完整片段复测。\n6. Windows、Linux、macOS Intel 未运行；原 Electron、Apple 原生 macOS/iOS/iPadOS/tvOS、Android 手机/平板/TV 均未修改或代验。当前仍停在 M3 前。\n\n参考：[mpv 原生选项手册](https://mpv.io/manual/master/)，[Jellyfin 样片目录](https://fra1.mirror.jellyfin.org/test-videos/)。原始临时证据目录：/private/tmp/boxplayer-hdr-qa/，含 metadata.json、native-baseline.jsonl、native-fixed.jsonl、display*.json 与原生截图；临时文件不作为永久归档保证。\n`
fs.writeFileSync(new URL('hdr-validation.md', docs), text)
console.log(JSON.stringify({files:results.length,firstFramesPassed:results.filter(r=>r.firstFrameDecodeExit===0).length,nativeHardware:results.filter(r=>r.fixed.hwdec==='videotoolbox').length,pq:results.filter(r=>r.fixed.outputTransfer==='pq').length,sdr:results.filter(r=>r.fixed.outputTransfer==='bt.1886').length,errors:results.flatMap(r=>r.fixed.errors),drops:results.map(r=>[r.name,r.fixed.droppedFramesMax])},null,2))
