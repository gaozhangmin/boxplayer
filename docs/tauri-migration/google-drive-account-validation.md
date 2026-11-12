# Google Drive 真实账号反馈修正（2026-11-09）

## 当前结论：浏览时禁止任何系统钥匙串授权弹窗

用户明确要求一次也不能弹。此前「先允许一次/始终允许」的建议已撤回，不作为验收前提。稳定签名和进程缓存保留，但不替代无交互访问策略。

SystemVault所有OS凭据读、写、删除（包括旧槽清理及Trakt使用的同一实现）现经macOS无交互调用封装：串行化本应用的钥匙串调用、保存交互状态、调用期间禁止UI、结束/错误时恢复之前状态；无法静默读取时立即返回应用内CREDENTIAL_RELOGIN，提示重新登录来源，不调用系统解锁或授权UI，不放宽钥匙串ACL、不落盘明文。新登录仍保存到新的版本槽，匹配同一提供商身份时保留原账号ID；旧槽清理失败留待后续，不阻塞新账号发布。

选用此机制的依据包括本机security-framework/keyring实现，以及[Chromium关于文件型钥匙串无交互调用的实现说明](https://chromium.googlesource.com/chromium/src/crypto/+/refs/heads/main/apple/scoped_keychain_user_interaction_allowed.cc)：不能仅依赖在文件型钥匙串上不可靠的SecItem单次查询标志。平台封装仅影响本次本应用调用，不改变系统钥匙串配置。

验证：专项6项通过，其中新增测试实际检查macOS调用期间交互关闭、错误返回后恢复；原生全套223通过/10既有忽略（/tmp/vault-no-ui-native-all.log），typecheck及稳定签名macOS debug211.15MiB构建通过（/tmp/vault-no-ui-build.log）。无前端实现改动，不把旧2427全量结果冒充本次重跑。

新包已Quit→观察退出→完整路径启动。使用现有Google账号进入共享硬盘，原生AX观察到0/22项列表（含固定团队入口），无系统密码/允许弹窗、无重新登录；随后进入共享云端硬盘目录也未触发系统授权。此为当前真实账号路径的非交互读取证据；不是所有网盘或锁定钥匙串状态的真实验收。最后尝试返回时Mac锁屏，返回动作未执行；未自动解锁，不影响已取得的共享列表结果。没有实际删除/写入用户文件。

以下为历史排查记录，涉及要求用户输入Mac密码的建议均被本节取代。


用户确认浏览器OAuth授权后账号实际已出现在来源列表，因此此前不是账号保存失败；缺少自动返回应用的反馈。不得重放用户提供的含授权码回调URL，记录中不保存该URL或code。

修正：

- OAuth接收有效回调后显示、取消最小化并聚焦现有main窗口；后续token/profile/保存仍沿用原链路。适用于同一loopback OAuth流程，不创建第二个窗口或用深链重放code。
- Google来源顶层使用原FileSourceBrowser多硬盘分组，显示「我的硬盘」和「共享硬盘」；不挂载文件管理器，也不显示顶层「所有文件夹」。进入任一分组后才挂载原SourceDriveManager，并显示分组内的「所有文件夹」。返回恢复分组，不修改账号和既有收藏。
- 「我的硬盘」沿用google_root；「共享硬盘」沿用原google_shared与sharedWithMe查询，保留「共享云端硬盘」入口列出/drives的团队硬盘。不能把与我共享文件误认为团队硬盘，或只接/drives让个人账号仍缺共享文件。
- 团队硬盘及子目录复用原buildGoogleSharedDriveFilesListPath，保留corpora=drive、driveId、supportsAllDrives/includeItemsFromAllDrives和分页；目录映射按完整账号元数据隔离。共享入口与共享查询builder直接提取自Electron源码并纳入AST保真校验。

验证：新分组/进入/返回/所有文件夹位置的原组件用例、共享文件/团队硬盘分页/子目录corpus/账号隔离及坏响应等，25项聚焦通过；当前前端247文件/2427通过（/tmp/google-groups-all-final.log）；OAuth原生7项通过（/tmp/google-oauth-native.log）；typecheck、files源码207/23/2校验与macOS arm64 debug212.01MiB构建通过。首次全量与构建并发产生5秒超时及其级联失败，停止构建竞争后以maxWorkers2原测试重跑全部通过，未放宽测试断言或超时。

当前包ed248e43723e76527a90526658a79514d52cfa07b517e9ec2b7952eb2cfe803b已原生Quit→观察退出→完整路径重启；使用现有已登录账号读取，未新增登录、写入文件或创建公开分享。原生观察顶层只有两个分组，进入共享分组才出现「所有文件夹」与浏览器。工具在共享请求后仍显示加载骨架，真实共享返回结果待用户确认，不把模拟测试或仅打开入口当作真实列表验收。新的OAuth前台切回没有另发起真实授权验证。

Electron main保持只读；Apple/Android属于独立实现，本次修改限于Tauri迁移接线。M6未启动。

## 后续定位：共享列表等待的是系统钥匙串授权

用户提供系统弹窗截图，确认BoxPlayer Dev在访问com.boxplayer.migration.dev.accounts时等待登录钥匙串授权。因此此前0/0骨架不能归因于共享列表API或截图工具，新的直接证据说明原生凭据读取被系统授权阻塞。当前开发包codesign元数据显示adhoc/linker-signed、无TeamIdentifier、无稳定Internal requirements；开发重建可能触发新的授权提示。

已增加SessionVault原生进程内缓存：只有系统Vault成功读取或写入后才缓存；并发读合并，失败读不缓存，刷新/删除前清缓存，失败写/删除也不保留旧缓存。不改变钥匙串权限，不把明文写到磁盘，不绕过首次OS授权，进程重启缓存消失。原生测试222通过/10既有忽略（/tmp/google-vault-native-all.log）；新增4项验证并发首次读取、新进程再授权、拒绝后重试、刷新/退出和失败写删的失效行为。

用户需自行在系统弹窗输入Mac登录密码并选择允许；不收集或代填该密码。由于系统授权交接尚未完成，本次后续构建使用--no-bundle以保留当前已启动bundle及授权弹窗；缓存修正尚未替换当前运行包。共享列表与新的OAuth前台切回真实结果仍待此次系统授权后核查。不得宣称真实Google共享目录已验收。

缓存修正版--no-bundle构建和typecheck已通过（/tmp/google-vault-no-bundle-build.log）。当前运行bundle的SHA256仍为ed248e43723e76527a90526658a79514d52cfa07b517e9ec2b7952eb2cfe803b，确认未覆盖系统授权交接中的应用。

## 用户授权替换当前应用

已按用户「替换当前应用」指令完成app bundle打包（212.02MiB，/tmp/google-vault-replacement-build.log），SHA256 39f8d0f1cda587a7e158d538b745344e60973a9bd41075f6c1c563d28abc4656。原生菜单Quit后观察isRunning=false，再用完整bundle路径启动。文件→添加来源→已保存Google账号可打开，顶层「我的硬盘 / 共享硬盘」分组可见，未触发文件读取或再次钥匙串授权；应用停留在该分组页供用户操作。SessionVault修正现已在运行包中。真实共享列表与首次系统授权之后的连续浏览仍未验收；没有代填密码、改钥匙串权限或重新Google登录。

## 根因修正：固定开发签名，而非仅缓存凭据

用户再次指出点击文件夹仍要密码。SessionVault只能合并进程内读取，不能解决adhoc重建改变系统识别身份。沙箱内security find-identity返回0，沙箱外只读检查确认本机已有有效Apple Development身份；未新增证书或导出私钥。

开发包装脚本现可读取忽略目录.local/macos-signing.json中的本机身份；显式APPLE_SIGNING_IDENTITY优先，其他平台不注入，CI/他人机器不携带本机身份。debug签名沿用原来未启用hardened runtime的调试运行策略，因为当前mpv来自另一团队签名的Frame开发运行时；release配置不修改。此前adhoc的权限策略没有被扩大，未加钥匙串通用访问/分区权限或关闭OS授权。

已完成多次签名构建，比较指定要求完全相同：稳定identifier=com.boxplayer.migration.dev，Apple证书链及相同开发证书主体约束，不依赖二进制哈希。最终codesign --verify --deep --strict在可读取系统信任链的环境通过；沙箱内此前CSSMERR_TP_NOT_TRUSTED不代表真实系统签名失败。脚本2项测试、typecheck及构建通过（/tmp/macos-development-signing-test.log、/tmp/macos-stable-signing-final-build.log），指定要求比较记录/tmp/macos-signing-requirement-before.txt及after.txt。未声称未签名的tauri dev裸进程已解决此问题；本次修正对象为本会话持续运行的打包开发应用。

最终稳定签名包已原生Quit→观察退出→完整路径重新启动；来源列表保留Google账号和我的硬盘/共享硬盘分组。未重新登录、改凭据内容或代填系统密码。旧钥匙串条目授权给之前的adhoc应用，首次切换到稳定签名仍可能需要用户在系统弹窗一次性重新授权；选择始终允许针对的是当前签名应用，需用户自行完成。之后连续浏览/再次稳定签名重启是否无提示尚待真实授权后的用户验证，不凭签名检查或缓存测试宣称此项已验收。

「所有文件」同时已通过命名list-header槽移到原#panfilelist区域顶端，位于工具栏和选择栏之后；排序/选择不包含该行，子目录隐藏，回到根目录恢复。48项相关组件测试、源码保真207/23/2、typecheck及对应构建通过；新包AX与截图确认新位置，旧外层行不再显示。
