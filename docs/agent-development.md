# 开发、执行与工程约束

Tauri 桌面端维护在 `main`，命令以 `tauri-app/package.json` 为准。Electron 的开发、IPC 与 E2E 约束随 [`electron` 分支](https://github.com/gaozhangmin/boxplayer/blob/electron/docs/agent-development.md) 维护。

## Tauri 任务定位

- 新应用在 `tauri-app/`；先读其 `tauri-app/README.md`、`tauri-app/package.json` 和 `docs/tauri-migration/progress.md`，再追踪实际原生入口。
- 在 `tauri-app/` 中，`pnpm dev` 是浏览器预览，`pnpm tauri dev` 是原生应用；二者验证范围不同。按变更选取 package 中的专项测试及 `src-tauri/Cargo.toml` 检查。
- 保留独立开发标识与数据目录，不导入或覆盖 Electron 用户数据。迁移报告中的历史结论需核对当前提交，不据此宣称 Windows/Linux 已验收。
- 此 checkout 的迁移源码与文档已纳入版本管理；提交前检查实际 diff，不自动提交运行缓存、账号数据或其他任务的修改。

## 问题反馈默认检查所有平台

- 用户每次反馈问题或要求修复时，默认分别检查 Electron（Windows/macOS/Linux）、Tauri 桌面端、Android 手机/平板/TV、Apple iOS/iPadOS/macOS/tvOS，无需用户再次声明所有平台。
- 按各平台实际支持的功能检查对应实现及共享数据影响；不把手机端功能套到 TV。tvOS 和 Android TV 不支持添加本地文件夹，此类问题检查是否错误暴露入口或占位项，不新增本地文件夹能力。
- 分别检查四个客户端 checkout 并修复实际发现的同类问题；交付区分代码检查、实际运行验证及未覆盖范围。
- 本地设备占位父项只用于已存储共享等来源管理入口；支持本地文件夹的平台，主页和文件首页应显示用户添加的实际文件夹。
- 仓库按兄弟目录 `boxplayer`、`boxplayer-tauri`、`BoxPlayer_Android`、`XbyVideoHub` 定位，并核对 remote；其他机器按实际路径定位。

## “All Platforms” Scope

- When the user says “all platforms” (`所有平台`), inspect all four client checkouts: `../boxplayer`, `../boxplayer-tauri`, `../BoxPlayer_Android`, and `../XbyVideoHub`.
- Implement Electron in `../boxplayer`, Tauri in `../boxplayer-tauri/tauri-app`, Android phone/tablet/TV in `../BoxPlayer_Android`, and native Apple platforms in `../XbyVideoHub`.
- Inspect and modify each repository independently. Do not assume a change in one repository propagates to the other two.

## Tauri 构建与检查

在 `tauri-app/` 使用 Node.js 22.12 或更新版本、pnpm 10.32.1、与 `@types/bun` 版本一致的 Bun、Rust 和系统 Tauri 依赖。

```sh
cd tauri-app
pnpm --ignore-workspace install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm tauri build --debug --no-bundle
```

应用注册配置、开发签名、播放器运行库和开发数据目录见 [Tauri 开发指南](../tauri-app/README.md)。在独立目录验证打包依赖时，使用独立构建输出和合成注册配置。

命令行工具可在 [`clouddrive-cli/`](../clouddrive-cli/) 独立安装、运行与测试。

## GitHub Issue workflow

When the user asks to handle GitHub Issues, first fetch the complete list of unfinished/open Issues in the requested repository. Review each Issue individually, identify its likely cause and affected code, and report the triage before changing code. Then implement fixes and run focused regression tests for each applicable Issue. Do not jump straight into a code change based only on the newest Issue or close an Issue before its fix is verified. If the repository or Issue access is unavailable, state that limitation rather than assuming the list is complete.

## 验证

前端和 sidecar 按 `tauri-app/package.json` 中的脚本核查，Rust 用 `tauri-app/src-tauri/Cargo.toml`。真实账号、媒体源和原生运行须根据任务授权单独验证。记录验证所用源码及平台，区分编译、测试与安装包验收。
