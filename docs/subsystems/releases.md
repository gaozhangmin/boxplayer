# 发布、渠道与更新日志

本文承接原 `AGENTS.md` 的完整相关段落。源码路径以仓库根目录解释；版本、旧机器路径及历史验证仅为当时记录，不能当成当前发行状态。

发布前从真实二进制/渠道核对状态。TestFlight 成功上传也须记录独立 `testflight` 官网日志，不能标成 App Store 上架；这替代旧条目中 TF 不记录的限制。

## CI

Manual trigger only (`workflow_dispatch`) via `.github/workflows/release.yml`. Builds on `windows-latest` + `ubuntu-latest`, publishes draft GitHub Release. No automatic CI on push/PR.

### Release publication authorization

- On 2026-11-04, the user explicitly authorized automatic public GitHub Releases after the fix is confirmed and relevant tests pass, including the daily BoxPlayer inspection automation. No additional per-release publication confirmation is required within that scope.
- Prepare the release as a draft while builds and checks are pending. Keep electron-builder builds in draft state until the intended platform assets are complete and verified; then the agent may publish the new release and verify its public downloads and update feeds.
- A source change, passing unit tests alone, or a queued build is not proof of the reported fix. Record actual runtime verification and its platform limits; do not publish an unverified fix as complete.
- Do not delete, recreate, demote, overwrite assets on, or otherwise modify an already-public release without a separate explicit request for that exact operation. A rerun targeting a public tag must stop rather than modify that release.
- Determine the next version from the latest **public** release plus one patch version, unless the user explicitly specifies a different version. Do not move an existing public tag to new code.
- Report draft creation and build/test status accurately. Never describe a draft or queued workflow as a published release.

## 正式发布后同步官网更新日志（持久规则）

- 每次任何平台正式发布后，都必须同步 `gaozhangmin/boxplayer-site` 官网更新日志；这属于发布任务的必要步骤，不因本次只发布某一端而跳过。官网模块为 `/changelog/` 与 `/en/changelog/`，顶部导航为“更新日志 / Changelog”。
- 官网分组：Android（手机/平板/TV）、Windows/Linux（桌面端）、Apple（iOS/iPadOS、macOS、tvOS）。Apple 各平台可独立发布，按实际发布的平台标注 targets，不将其他未上线平台一起标记发布。
- 收录起点：Android 与 Apple 从 2.0.0 起；Windows/Linux 从 5.0.38 起。不生成更早历史。版本号、实际发布日期、平台与正式发布证据必须可核对，不能以构建时间冒充发布时间。
- Agent 在准备发布时，根据该正式二进制对应代码 diff 编写简中、繁中、英文三语说明，区分新增、改进、修复；复用该版本已批准/已保存的文案。CI 不调用 AI，不需要 OPENAI_API_KEY。不能把发布之后的 main 或未包含在二进制里的工作区改动写入正式说明。
- “正式发布”必须确认公开可用：Android 官方签名 APK 已发布到正式下载入口；Windows/Linux 稳定版 Release 已公开且有对应下载产物；Apple 已在 App Store 上架。仅 TF 上传/Beta 审核、商店送审、等待开发者发布、草稿 Release、排队或仅构建成功均不更新为已发布。可预存 draft，但不展示为正式记录。
- 定位官网仓库时核对 git remote；本机可有 `boxplayer-site`、`boxplayer-site-release-ci`、`boxplayer-site-changelog` 等工作区，不覆盖其他任务的脏文件。官网数据在 `src/content/changelog/releases.json`，字段与流程见 `docs/changelog.md`。运行 `node scripts/upsert-changelog.mjs <confirmed-release.json>`，按平台/版本/targets 幂等更新，保留其他端记录。
- 完成正式发布后，提交并推送官网这一条版本记录，等待官网部署成功并检查对应公开页面；交付时分别报告客户端发布、官网提交和官网部署状态。不能仅改本地数据就声称官网已更新。如部署或权限受阻，完成可做步骤并明确报告，不能漏掉官网同步。
- 用户说“触发 TF”时，Agent 先根据版本差异生成并保存文案供后续商店流程复用；该动作本身不触发官网正式发布记录。用户说“触发 App Store”时复用指定构建说明，待真正上架再同步官网；审核提交成功不等于上架。
