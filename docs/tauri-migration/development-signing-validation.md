# macOS 开发启动稳定签名验证

日期：2026-11-20。范围：Tauri macOS 原生开发启动；未变更 Electron、Android、Swift 客户端或发行流程。

## 修复

Tauri CLI 2.12.4 的 dev 通过 cargo run 执行裸二进制，单设 APPLE_SIGNING_IDENTITY 不足以替代链接器产生的 adhoc 签名。包装器配置两种 Darwin target runner，runner 在每次首次启动和 Rust 重载前 codesign、严格验证，再 exec 原应用参数。真实路径通过环境传递，临时 launcher 使用无空格路径。缺少稳定证书或冲突 runner/config 时停止启动。

## 已执行

- Vitest development-signing + development-runner：8 项通过；包括签名失败不启动、配置 identifier、两架构、覆盖保护、空格及字面参数。
- pnpm typecheck：通过。
- 实际 Cargo fixture：环境 runner 覆盖配置文件数组 runner；签名失败阻止执行，参数保真。
- pnpm tauri dev：实际编译、签名、运行；仅 touch main.rs（无内容差异）触发第二次 Rust 重载，再次签名与运行。
- 最终 executable identifier 为 com.boxplayer.migration.dev，TeamIdentifier 与既有开发 .app 一致，codesign -dr 输出的 designated requirement 一致。
- 只读 Keychain ACL 元数据检查：68 项签名 requirement 匹配，两个活动 Emby 来源均无不匹配；剩余 1 项为历史 cdhash 条目。不读取 secret data，不修改 ACL。条目数是本次快照，不是测试断言。
- 独立源码评审无阻塞缺陷。

## 边界

未完成原生 UI 中 Emby 内容加载验收；原生裸进程未被当前应用自动化库存正确识别，避免另启动旧 .app 冒充本次开发验证。运行中的 Vite 曾报告并行修改 PageGlobalSearch.vue 的编译错误，不属于本次签名改动。未执行跨平台运行或正式发布。已有锁定钥匙串或其他身份创建的条目仍可能要求用户操作。

本机临时证据：/tmp/tauri-signed-dev-final.log、/tmp/tauri-dev-signing-typecheck.log、/tmp/tauri-dev-signing-cargo-fixture.json；不作为发布附件。
