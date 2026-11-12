# BoxPlayer 自动获取引擎

直接迁入原 TypeScript 工作流，保留 worker、Agent、搜索、选源、校验、整理与追更的业务逻辑。只适配宿主、数据库、网络/账号端口和 BoxPlayer 命名。

## 已接入

- `upstream/`：原 SQLite、命令、worker、Agent 循环/沙箱、电影/多季/追更流程、PanSou/TMDB、受限网盘执行器工厂及依赖。原文件只做命名替换，来源审计会逐字校验规范化后的内容。
- `service.ts`：完整原任务服务，保留创建、取消、重试、状态、追更和通知逻辑。`views.ts` 仅兼容导出，不再另写任务映射。
- `engine.ts`：原宿主的队列消费、账号上下文、每日巡检和模型装配；`host.ts` 管理独立数据库生命周期与目标身份。
- `BoxPlayerStorageExecutor.ts`：原文件执行器，保留目录范围、真实落地校验和登录错误分类。
- `runtimeBindings.ts`：私有宿主端口，后续绑定 Rust 账号、模型配置及请求能力。WebView 没有设置凭据或任意执行器的接口。
- Rust `src-tauri/src/boxplayer.rs` 管理 `boxplayer-host` 独立进程。数据为应用私有 `boxplayer/boxplayer.db`，消息及事件使用 BoxPlayer 名称。

当前 `status` 为 `storageReady=true, engineReady=true, workerReady=false`：引擎已编入运行进程，原生账号/模型尚未绑定，队列不会被错误执行。获取入口仍禁用。真实网盘转存/离线操作、模型配置绑定、原目标弹窗及落地扫描联动仍待迁移。

`source-audit/` 和 `*.source` 保留原始来源、许可证及原名，只用于离线审计，不打入运行进程。运行源码、脚本入口、类型、事件和产物均统一为 BoxPlayer。不会修改 Electron main、读取 Electron 账号或 CLI token 文件。

## 验证

```sh
pnpm build:boxplayer
pnpm test:boxplayer
node scripts/verify-electron-boxplayer.mjs
pnpm tauri build --debug --bundles app
```

构建需要锁定版本的 Bun，用户无需安装 Node/Bun。跨平台必须产生与目标匹配的原生进程。本轮只验证 macOS arm64。

回归使用临时数据库、合成账号和 AI SDK 的测试模型，包含原 worker、原文件执行器、重启恢复/隔离、编译进程协议及宿主到原 Agent 工具循环的链路；不调用真实云模型、不写入真实网盘。
