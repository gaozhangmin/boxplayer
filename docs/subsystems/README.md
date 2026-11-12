# 子系统设计与契约

先读本任务涉及的页面，再沿源码追踪实际调用和状态写入。各页面区分现有产品约束、本地迁移实现与未验证范围。

| 子系统 | 文档 |
| --- | --- |
| 账号与会话 | [account-and-sync.md](account-and-sync.md) |
| 来源、收藏与媒体库 | [media-library.md](media-library.md) |
| 播放、字幕与提供商请求头 | [playback.md](playback.md) |
| 网盘接入与下载 | [providers.md](providers.md) |
| 发布、渠道与更新日志 | [releases.md](releases.md) |

工程命令和执行限制见 [开发约束](../agent-development.md)，代码与评审要求见 [标准](../code-standards.md)。

契约、兼容或失败语义变化时与实现同步更新；PR/提交描述触发条件、前后行为及实际证据。源码重构不改变契约则说明保持不变。文档本身不证明线上或设备已通过。
