# 原生账号、设置与持久化

路径按本仓库根目录解释。修改前核对当前源码和调用者；本文不宣称已完成运行验收。

本文涉及的 Tauri 迁移源码随 `codex/dev-tauri` 分支版本管理。原生验收使用 `tauri-app/`，不能用旧 Electron 根工程代替；源码已提交不代表目标平台已验收。

## 职责与源码

- `tauri-app/src-tauri/src/accounts.rs`（`codex/dev-tauri` 迁移源码）：Accounts、Account 和凭据关联。
- `tauri-app/src-tauri/src/vault.rs`（`codex/dev-tauri` 迁移源码）：平台凭据保险库边界。
- `tauri-app/src-tauri/src/settings.rs`（`codex/dev-tauri` 迁移源码）：SettingsStore、prepare、resolve_data_dir。
- `tauri-app/src-tauri/src/storage.rs`（`codex/dev-tauri` 迁移源码）：迁移工程的数据存储。

## 运行路径与状态

新 UI/适配层 → 原生命令 → Accounts/SettingsStore → 平台 vault 或本地存储。设置 prepare 接收 expected_revision；成功保存后推进 revision，旧 writer 收到 REVISION_CONFLICT 后应重新读取。

## 失败与兼容边界

SETTINGS_INVALID、SCHEMA_UNSUPPORTED 和读取错误必须保留原文件并报错；文件确实不存在才初始化默认值。不得把开发数据目录指向 Electron 真实数据。

## 验证与维护

先读 [开发与执行约束](../agent-development.md) 和 [代码标准](../code-standards.md)。验证按本次用户要求及平台限制执行；未运行的测试、构建和真实设备检查要明确标注。契约改变时同步本文，并核对旧调用者。
