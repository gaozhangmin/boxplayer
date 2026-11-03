# mediary-scout 集成说明

BoxPlayer 的「AI 媒体获取」直接运行上游 [mediary-scout](https://github.com/fancydirty/mediary-scout) 的 `packages/workflow`（0BSD 风格许可）。代码以 git subtree 放在 `vendor/mediary-workflow`，BoxPlayer 只在 `electron/main/mediary/` 写宿主和适配层。

## 结构

| 位置 | 内容 |
| --- | --- |
| `vendor/mediary-workflow/` | 上游源码：Agent 循环、sandbox、技能手册、worker、追更巡检、SQLite 仓库、PanSou/TMDB 提供方、夸克/光鸭执行器 |
| `electron/main/mediary/MediaryHost.ts` | 主进程 worker 循环（3 秒轮询、启动 15 秒后开始、孤儿任务恢复、每日巡检时间点），数据库 `userData/mediary.db` |
| `electron/main/mediary/storageExecutors.ts` | 按网盘选择执行器：夸克、光鸭用上游执行器；115、123、阿里云盘、PikPak 用 `BoxPlayerStorageExecutor` |
| `electron/main/mediary/BoxPlayerStorageExecutor.ts` | 按上游 `GuangYaStorageExecutor` 写法实现 `StorageExecutor`，底层是 clouddrive-cli providers 与 `providerTransfers.ts` |
| `electron/main/mediary/resources.ts` | 模型（OpenAI 兼容，BoxPlayer 云端带 `feature`）、PanSou（经 BoxPlayer `/api/search`）、TMDB（经 BoxPlayer `/api/tmdb/proxy`） |
| `electron/main/mediary/MediaryService.ts` | 发起任务、取消、重试、取消追更，以及把上游数据映射成界面使用的 `shared/types/mediaAcquisition` 视图 |
| `src/services/mediaAcquisition/mediaryBridge.ts` | 渲染进程：应答 AI 配置请求、任务完成后扫描入媒体库、同步光鸭刷新后的 token |

每个「网盘 + 所选目录」登记为上游的一个 connected storage（`bp_<hash>`），上游在所选目录下创建 `作品 (年份)/Season NN`。

网盘登录取自 BoxPlayer 自动同步的 `~/.clouddrive-cli/tokens.json`；AI 模型配置在每次运行前向主窗口索取，不落盘。窗口关闭时排队任务会等待，不会失败。

## 我们的补丁

全部在 commit `vendor(mediary): register BoxPlayer-hosted aliyun, pikpak and cloud123 brands` 中，标注 `BoxPlayer patch`：

- `storage-brands.ts`：新增品牌 `aliyun`、`pikpak`、`cloud123`（123 开放平台，仅离线下载），以及 `BOXPLAYER_DRIVE_AUTH` 登录失效标记。
- `domain.ts`：`ResourceType` 增加 `aliyun`、`pikpak`。
- `pansou-provider.ts`：识别阿里云盘、PikPak 分享链接。
- `acquisition-v2/task-agents.ts`、`acquisition-v2/skill.ts`：三个品牌的转存说明和死链手册。
- `acquisition-v2/real-storage-adapter.ts`：`transferUntilLanded` 可滚动阿里云盘、PikPak 分享。
- `agent-error.ts`：网盘登录失效不当作 AI 模型鉴权失败。
- `tests/storage-brands.test.ts`：品牌列表断言。

另外，BoxPlayer 的 115 登录只能离线下载，宿主把 115 的候选过滤为磁力（`resources.ts`），不改上游。

## 同步上游

```bash
scripts/sync-mediary.sh ../mediary-scout
pnpm run test:mediary
```

`test:mediary` 用 Electron 自带的 Node 运行（本机 better-sqlite3 按 Electron ABI 编译）。以下上游测试不在 BoxPlayer 中运行：`*.pg.test.ts`、`postgres-schema-init`、`repository-contract-postgres`（需要 Postgres），`runtime-config`（读取上游仓库根目录的 `docker-compose.yml`）。

## 尚未接入

- 外挂字幕（assrt）：上游需要 assrt token，BoxPlayer 暂未提供设置项。
- Prowlarr、外部推送（Bark / Server 酱 / 企微 / Webhook）、巡检时间设置界面（默认北京时间 06:00）。
- 运行中的任务无法中途取消（上游 Agent 不支持中断），只能取消排队中的任务。
