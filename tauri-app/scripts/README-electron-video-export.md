# Electron 视频媒体库过渡导出

`electron-video-export.mjs` 是独立只读导出器，不修改 Electron main，不打开真实账号库，不读取 `itoken`。调用者只能传入自己明确选择的 IndexedDB **副本**。`readVideoTable(database)` 用 readonly 事务读取旧版 `imedia_item`；主屏幕/收藏配置、播放列表、个人状态和自定义系列通过明确的 JSON 副本参数传入，不能直接枚举/打包所有 localStorage。

`exportVideoLibrary` 参数：

- `sourceVersion`：旧版版本号。
- `items`：`readVideoTable` 的原版 MediaLibraryItem 数组。
- `bindings`：`JSON.stringify([userId || driveServerId, driveId]) → {sourceId, local}`；每个文件都必须绑定目标 Tauri 来源，不能用当前选中账号代替。真实账号稍后登录时，按其目标 ID 准备导出副本。
- `sources`：本地 `{id,name,path}` 数组，路径指向同一台机器实际目录；远端账号凭据不在迁移包里。
- `positions`：`{key,position,duration}` 数组；`playlists`、`series`：名称到旧媒体 ID 数组；`flags`：旧媒体 ID 到 favorite/watched/personalRating/continueHidden/continueAdded。
- `preferences`：明确选中的首页/分类收藏布局、文件收藏及显示偏好 JSON 字符串。目标已有同名偏好保留，新导入偏好只补缺。

导出拆分实际剧集/版本，统一映射集合引用。嵌入元数据移除 driveFiles、原账号请求头、token、Cookie、签名图片/链接，公开 TMDB 图片保留。目标原生导入验证格式、表计数、SHA-256、文件身份、集合引用和进度；任一错误拒绝，事务失败回滚。重复摘要不再次增加媒体记录，目标已有记录优先，不覆盖较新进度或手工元数据。

`tests/fixtures/electron-video-v2.json` 是使用该导出器生成的合成旧版导出副本，供 Rust 真正导入和幂等回归。IndexedDB 测试建立含 `imedia_item` 和诱饵 token 表的合成库，实际验证只读导出，不操作用户数据。真实旧库副本的现场验收仍需要用户提供/选择，不以合成数据宣称已读取真实旧库。

Tauri 设置 → 数据迁移可导出 v2 全库包，导入兼容 M2 的 v1 本地来源/位置包。导入前快照保存在独立应用数据库 `catalog_imports.backup`；失败回滚由 SQLite 事务执行，不修改原导出文件。

本地身份处理：导出器把本地绝对文件路径收敛为已声明根目录内的相对路径，拒绝 `..` 与逃逸路径。原生导入按 Tauri 的 canonical 路径规则重新生成来源/文件身份，同时重映射播放列表、自定义系列和偏好中的身份引用；有实际时长时，将百分比进度转换为播放器的秒数续播记录。临时真实目录测试验证导入 ID 与原生 `local_list` ID、播放器续播键完全一致。
