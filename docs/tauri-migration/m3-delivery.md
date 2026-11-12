# M3 开发交付与验收结论

日期：2026-11-07。依据implementation-plan.md的M3及#1–10、#12、#13、#51。用户明确“真实账号稍后来验证，你先完成M3”，本次完成开发实现、自动检查和本机合成运行交付，真实账号/实际支付保留后置，不记录为通过。停在M4前，不开始媒体库扫描、刮削、Trakt或旧业务数据迁移。

## 按计划逐项审计

| 计划项 | 实际实现入口 | 本次证据/结论 |
|---|---|---|
| #1 阿里网页 | aliyun_web.rs、alipan.ts | 隔离网页登录、设备签名/刷新、目录/取链；固定签名和请求策略测试 |
| #1 阿里OpenAPI | alipan.rs、oauth.rs、alipan.ts | 独立二维码、原生交换/刷新、盘/目录/取链；协议测试与匿名二维码历史检查 |
| #2 百度 | oauth.rs、baidu.rs、cloud.ts | GET交换、查询鉴权、稳定身份、无损ID、分页/私有取链测试 |
| #3 123 | oauth.rs、cloud.ts | 内置注册配置、交换/刷新、身份、目录/分页/取链测试 |
| #4 115 | drive115.rs、oauth.rs、cloud.ts | PKCE二维码、官方主体核对/刷新、同UA鉴权下载；ID边界及句柄测试 |
| #5 夸克 | quark.rs、cookie_sessions.rs、cloud.ts | 原生QR、独立cookiejar、分页/私有取链；取消/重定向/cookie隔离测试 |
| #6 PikPak | pikpak.rs、pikpak.ts | 密码/挑战协议、主体核对/刷新、分页/原生取链测试；不自动绕过人机挑战 |
| #7 OneDrive | oauth.rs、cloud.ts | 独立PKCE/回调、官方主体/刷新核对、分页/取链测试 |
| #7 Dropbox | oauth.rs、cloud.ts | 独立PKCE/令牌轮换、官方主体/刷新核对、目录协议测试 |
| #7 Box | oauth.rs、cloud.ts | 独立OAuth/主体核对/刷新、目录分页和取链测试 |
| #7 Google Drive | oauth.rs、cloud.ts | PKCE/本机回调、主体/刷新核对、目录分页和取链测试 |
| #8 139 | cloud139.rs、cloud139.ts | 受限路由、私有签名、分页/取链测试；原协议无刷新令牌，失效重登 |
| #8 189 | cloud189.rs、cloud189.ts | QR、个人/家庭密钥/签名/刷新、超大ID、分页/取链测试 |
| #9 光鸭 | guangya.rs、guangya.ts | 主动短信、短期challenge、主体/刷新/设备头、分页/取链测试 |
| #10 WebDAV/AList | webdav.ts、alist_auth.rs、alist.ts | Basic/PROPFIND和密码/OTP/令牌来源、目录/播放测试；无刷新协议时明确重登 |
| #12 多账号/自动签到 | accounts.rs、vault.rs、autoSign.ts、settings.rs | provider+主体+base稳定重登、串账号拒绝、退出/刷新隔离；签到默认关，仅阿里网页，成功日期重开/跨年和设备更新保留测试 |
| #13 BoxPlayer账号/Pro/支付 | boxplayer_account.rs、BoxPlayerAccount.vue、membership.ts、open_website | 原生设备会话、官网网页登录确认、会员/刷新、平台范围徽章、官网定价入口、返回应用刷新；不接管正式回调协议、不把令牌拼到外链；真实付款后置 |
| #51 三家媒体服务器 | mediaServer.ts、plex.ts、playlists.ts、server_playback.rs、reporting.ts | 三家目录/搜索/收藏/播放列表及成员/删除确认/码率测试/上报接线；JF/Emby自定义设备配置沿用原实现，Plex原实现不使用该配置，不伪造额外能力 |
| 播放交接与界面要求 | player/mod.rs、gateway.rs、hls.rs、main/settings/source组件 | 当前已加载页队列、自动下一集、外置字幕私有交接、HLS恢复；文件与主屏幕/媒体库同级、统一来源、绿色/品牌图标；不迁React，不改写soia播放器UI |

审计核对了实际命令注册、来源驱动映射、账号表单、删除确认和设置入口；没有以目录里存在文件代替功能接线。更早检查点的实现过程见m3-validation.md，不将旧“未接入”描述当当前状态。

## 最终检查与产物

- 完整前端：30文件、103测试通过。
- 完整普通原生：80通过、8 ignored；跳过不计通过。TS-HLS、fMP4-HLS两个真实libmpv恢复用例单独执行均通过，包含暂停、定位和字幕关闭；fMP4还统计初始化/媒体分片读取。
- 原生.app本机合成Jellyfin闭环：虚构登录、两集列表、实际画面、鉴权字幕、两项队列、自然切集、分集上报/最终停止、退出清理通过。fixture服务已停止，真实账号未参与。
- 类型检查、Vite、Rust格式、diff和播放器CSS隔离通过。Clippy组件未安装，未执行；不是本计划既定验收命令。
- soia来源哈希当前失败：SeekBar.vue有本轮之外的样式改动；不回退、不更新manifest掩盖差异。该已知例外不作为本轮协议改动通过的证据。根Electron原生播放器等并发修改同样未触碰。

最终macOS arm64 debug产物：`tauri-app/src-tauri/target/debug/bundle/macos/BoxPlayer Dev M3 Acceptance Candidate.app`，116.46MiB。可执行文件SHA256：`e089c1b0b466e51d0f9cd36153ff0a6784bff283c88cf5f52e55a6f81c70e4e2`。包含最新fMP4 start重置及HLS并发代数修正。此最终包尚未启动；当前打开的是上一集成候选包，其原生UI/合成播放已验。二者不混称。未安装正式版、未签名公证/公开发布，未创建PR或提交。

## 后置真实验收清单

每个提供商分别检查登录、稳定重登、刷新或明确重登、目录/分页、取链、带头播放；阿里双通道分别验，189个人/家庭分别验。三家服务器额外核对搜索/收藏/列表写入/删除确认/测速/配置/开始进度停止上报/连续切集/字幕。BoxPlayer登录、会员范围和实际付款后权益更新由用户安排；本轮不执行真实扣款。保留所有未验证标记，不把一家的通过外推给另一家。

Windows/Linux、macOS x64未运行；Apple原生iOS/iPadOS/macOS/tvOS、Android手机/平板/TV、原Electron均非本次迁移修改目标，不代验。剩余真实账号、正式分发和多平台检查不会触发自动进入M4。

结论：按用户后置真实账号验收的安排，M3开发交付和当前可执行验收已完成，真实账号/支付为明确保留的后置项；停在M4前。这里不宣称全部提供商已在真实服务运行通过。
