# boxplayer — Agent 入口

## 开始工作

1. 阅读 [子系统索引](docs/subsystems/README.md)，选择本任务涉及的契约并核对链接源码。
2. 修改代码前阅读 [开发与执行约束](docs/agent-development.md)、[代码标准](docs/code-standards.md) 和 [经验记录](LESSONS.md)；更深目录的 AGENTS.md 也必须读取。
3. 契约、状态、失败或兼容行为变化时同步所属文档；交付写明实际检查与未验证范围。

## 不可遗漏的约束

- Electron 默认连接用户已运行的开发应用；未明确要求 E2E 不另启应用或执行 E2E。build 会递增版本并清理 dist/release；不要作为无副作用检查。
- AI 每次犯错都必须在修正后、结束当前任务前追加工作区根 LESSONS.md；包括用户指出、自行发现和重复发生的错误。记录事实、原因、修正、预防与证据；根文件缺失或不可写时暂存本仓库 [LESSONS.md](LESSONS.md)。
- 保留其他任务的改动、暂存状态、账号、签名与数据；不把本文档整理扩展为业务发布授权。

## 跨仓库协作

完整工作区存在时，另外读取父目录 AGENTS.md、docs/repositories.md 与 docs/subsystems/README.md。默认问题排查包括 Electron、Tauri、Android Phone/Pad/TV 与 Apple iOS/iPadOS/macOS/tvOS；按实际受影响实现修改，用户限定范围优先。TV 不新增本地文件夹能力。

独立克隆时上述父文件可能不存在，本仓库文档仍须独立可用。需要跨仓库调查再定位兄弟 checkout 和 remote，不能依赖旧机器绝对路径。
