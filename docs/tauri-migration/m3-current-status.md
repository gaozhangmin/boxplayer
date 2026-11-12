# M3 当前交付状态

**M4最新结果：开发与合成验收完成，停在M5前；真实账号继续后置，详见 [M4验收](m4-validation.md)。**

**最新授权：真实账号登录后的检查后置，继续 M 系列，已进入 [M4](m4-current-status.md)。下文“停在 M4 前”“不得自动进入 M4”为历史边界，本次用户已明确解除；M3 真实账号项仍为待验收。**

**2026-11-07 BoxPlayer 原引擎直接复用：worker、Agent、搜索/元数据、执行器工厂及完整任务服务已拷入；73 项来源映射，63 原文件仅改名，25 项引擎测试通过。运行命名统一为 BoxPlayer。原生账号/模型绑定、目标弹窗仍待迁移，获取入口仍禁用。详见 [记录](boxplayer-electron-direct-migration.md)。**

**2026-11-07 自动获取原引擎继续迁移：已落地原 SQLite 仓库、任务/追更/通知状态服务、独立进程与 Rust 通信，详见 [迁移记录](boxplayer-electron-direct-migration.md)。22 项来源映射 / 19 原样文件；前端 327 项、存储及进程 9 项、Rust 3 项通过。macOS arm64 debug app 207.90 MiB。模型、网盘执行接口和目标弹窗仍待迁移，获取/重试/巡检不开放；真实账号未验证。未修改 Electron main，检测到的并行启动锁工作保持原状。**

**2026-11-07 最新 UI 迁移检查点：主屏幕、媒体库已改用 Electron 原文件及原片段，详见 [迁移与验收记录](home-library-electron-direct-migration.md)。前端 55 文件/319 项通过；新 macOS 开发包构建并重启核验。Electron main 保持干净。真实账号仍后置；boxplayer 自动补全/追更未迁移，保留禁用入口，不记全部视频功能验收完成。以下较早测试数量/包路径为历史记录。**

最终结论以[m3-delivery.md](m3-delivery.md)为准：开发交付完成，真实账号/支付按用户要求后置，停在M4前。以下保留来源与历史产物索引。

更新：2026-11-07。以实施计划 #1–10、#12、#13、#51 为范围，M4 未开始。用户明确真实账号验收稍后进行；以下把实现/自动检查与延期真实验收分开，不以模拟账号宣布提供商可用。

| 范围 | 当前实现和证据入口 | 实现收尾/限制 | 后置真实验收 |
|---|---|---|---|
| 阿里网页/OpenAPI | aliyun_web.rs、alipan.rs、alipan.ts；独立认证/列表/分页/取链 | 网页新增member origin需旧测试账号重登 | 两通道分别登录、刷新、分页和播放 |
| 百度、123 | oauth.rs、baidu.rs、cloud.ts；协议及大整数测试 | 内置OAuth注册配置需服务允许回调 | 各自独立闭环 |
| 115 | drive115.rs；官方身份核对/刷新、带UA播放 | 新身份核对尚未实际请求官方账号 | 扫码/稳定重登/刷新/播放 |
| 夸克 | quark.rs、cookie_sessions.rs；QR和独立cookiejar | 会话过期需真实数据核对 | 扫码/列表/分页/下载头播放 |
| PikPak、光鸭 | pikpak.rs、guangya.rs；密码/短信原生协议与测试 | 人机挑战不自动绕过 | 自行登录后独立验证 |
| OneDrive、Dropbox、Box、Google | oauth.rs、cloud.ts；PKCE和本机回调 | 各提供商注册回调约束待实际核对 | 每家独立登录/刷新/分页/播放 |
| 139、189 | cloud139.rs、cloud189.rs及TS驱动；签名/空间测试 | 139现有协议过期需重登；189个人/家庭分离 | 路由/空间/刷新/带头播放 |
| WebDAV、AList | webdav.ts、alist_auth.rs、alist.ts | AList现有令牌无刷新，过期重登 | 登录/目录分页/鉴权播放 |
| 多账号、签到 | accounts.rs、autoSign.ts；稳定ID/vault、日期重开测试 | 默认为关闭；仅阿里网页，成功日期不被设备刷新抹去 | 切换/退出/重启/真实签到 |
| BoxPlayer账号/Pro/支付 | boxplayer_account.rs、BoxPlayerAccount.vue、membership.ts | 扫码及浏览器设备确认登录、会员/刷新/范围徽章/官网方案已接；官网仅允许正式协议直接回调，开发包通过已绑定设备轮询回收会话，返回应用后查询会员 | 登录/会员/实际订单和支付均后置，不执行真实扣款 |
| JF/Emby/Plex | server_playback.rs、playlists.ts、reporting.ts；搜索/收藏/列表/删除确认/测速/配置 | Plex原实现不应用JF设备配置；新稳定身份需重登；完整原生队列运行待验证 | 每家搜索/上报/收藏/列表写入和删除单独验收 |
| 远程队列/字幕/HLS | player/mod.rs、gateway.rs、hls.rs | macOS实际.app合成Jellyfin两集自然切换、鉴权字幕显示及上报顺序通过；TS及fMP4 HLS恢复实测通过；轨道ID变化仍需真实数据覆盖 | 各真实服务器连续切集/外置字幕显示/会话失效恢复 |
| 现有非播放器UI | design-qa.md、main/settings/source/account组件 | 原有界面已统一Infuse风格/绿色；账号/来源/设置新包已原生检查；有账号的服务器管理/测速入口待验证 | 后置真实账号期间再验 |

当前自动证据：前端103项/30文件通过；原生完整80通过、8 ignored；真实libmpv标准TS-HLS重载/暂停/定位/字幕关闭单独1通过。最新集成包已包含Plex身份和浏览器设备登录补丁；新包也包含各OAuth来源刷新主体核对及旧远程字幕解封。

最新集成产物：`tauri-app/src-tauri/target/debug/bundle/macos/BoxPlayer Dev M3 Integrated Candidate.app`，116.46MiB，构建通过，已原生启动并检查账号/来源/设置入口。它包含队列/字幕/签到/会员同步、Plex稳定身份和浏览器设备登录补丁。可执行文件SHA256：`b458a070ea7814bce8af0c7d6ed2e1653fc8a96fb7e0a8eb1fb8ccb4c2a9533b`。旧窗口确认空闲后退出，最新候选包已运行并停在首页；没有未提交登录被中断。macOS arm64为当前构建平台，Windows/Linux、macOS x64未运行；Apple原生和Android/Electron未修改，不互相代验。

本页是当前状态入口；m3-validation.md保留各历史检查点，旧检查点中的“待补”不覆盖后续实际代码。M3开发交付已完成；下一步按用户时间补真实账号验收。最终Acceptance Candidate产物与已知检查例外见交付审计，不得自动进入M4。
