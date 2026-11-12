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

## 验证与维护

先读 [开发与执行约束](../agent-development.md) 和 [代码标准](../code-standards.md)。验证按本次用户要求及平台限制执行；未运行的测试、构建和真实设备检查要明确标注。契约改变时同步本文，并核对旧调用者。
