# 账号与会话

路径按本仓库根目录解释。修改前核对当前源码和调用者；本文不宣称已完成运行验收。

## 职责与源码

- [boxplayerAuth.ts](../../src/utils/boxplayerAuth.ts)：官网登录 code 换取 app session、Supabase 会话与访问 token、订阅读取、设备扫码登录。
- [userdal.ts](../../src/user/userdal.ts)：网盘账号装载与 provider 分流；不等同于官网 Pro 会话。
- [userstore.ts](../../src/user/userstore.ts)：网盘用户状态，检查 provider/account 标识的所有读写者。

## 运行路径与状态

网页登录回调 → exchangeBoxPlayerLoginCode / restoreBoxPlayerAuth → 既有 session 存储 → getBoxPlayerAccessToken → API/订阅读取。设备登录的 pending/scanned 仍是等待，不等于认证失败；退出或取消后不能保存旧轮询结果。

## 失败与兼容边界

官网账号、网盘账号和订阅权限分开追踪。fetchBoxPlayerSubscription 的 invalid_auth_token 分支有会话重试逻辑；改 token 优先级时同时核对 AI、订阅与购买入口，不能只改登录按钮。

网盘容量独立于身份与会话刷新：夸克读取 `/1/clouddrive/member` 的 `total_capacity/use_capacity`，天翼通过当前账号签名请求 `portal/getUserSizeInfo.action` 的 `cloudCapacityInfo`（个人空间）。缺失、无效或失败的容量响应保留上次值并返回失败，身份/会话刷新不得把容量重置为零；不把家庭容量混入个人账号汇总。

夸克身份与容量请求独立执行，身份接口失败不能阻止容量刷新；合并时先身份、后容量，避免较慢的身份响应覆盖新容量。账号刷新将失败结果传回调用者，不能把身份成功当作容量成功。账号弹窗从响应式账号列表读取当前账号容量；底层 `UserTokenMap` 不是响应式对象，不能只依赖其 Pinia getter 的缓存值显示刷新结果。

## 验证与维护

先读 [开发与执行约束](../agent-development.md) 和 [代码标准](../code-standards.md)。验证按本次用户要求及平台限制执行；未运行的测试、构建和真实设备检查要明确标注。契约改变时同步本文，并核对旧调用者。
