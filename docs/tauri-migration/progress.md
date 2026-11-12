## 2026-11-09：浏览网盘不再触发系统密码弹窗

SystemVault已切换为macOS无交互调用，不能静默读取时在应用内提示重新登录，不再要求用户允许一次。原生223通过/10忽略、构建通过；新包已重启，用现有Google账号读取共享视图22项且无系统授权窗口。详细证据见 [Google真实账号修正](google-drive-account-validation.md)。M6未启动。

## 2026-11-09：Google真实账号反馈修正

用户已确认OAuth账号保存成功；补齐授权回调前台切回，以及Google「我的硬盘 / 共享硬盘」分组与分组内所有文件夹。详细实现、测试、当前实屏结果及未验证项见 [Google账号反馈修正](google-drive-account-validation.md)。未推进M6，未改Electron main。

## 2026-11-09：M5 当前约定范围验收完成，停在 M6 前

最终逐项审计见 [M5验收审计](m5-acceptance-audit.md)。按用户要求，真实账号检查后置；其余开发、原文件迁移、能力接线、协议/组件合成、本机文件交互及命名窄窗场景已完成验收。不得把本阶段完成解释为真实远端操作或Windows/Linux已验收。

当前前端246文件/2418通过，原生218通过/10既有忽略；typecheck、源码保真校验及macOS arm64 debug212.00MiB构建通过。当前运行3a752e9e包已通过原生Quit→观察退出→完整路径重启，testVideo21项正常，选中计数完整、原操作按钮可用、视图按钮换行。原生右键菜单显示「属性 / 更多」，Escape关闭并取消选择。曾出现ScreenCaptureKit-3812，重绑定同一实例恢复；进入目录短暂骨架后Raise操作读取到21项，不据此前异常重启或改写文件逻辑。没有用户文件写入或真实公开分享。

真实账号/真实服务效果继续保留未验证，目标平台回归按计划后续执行。M6传输引擎没有开始；不自动推进M6。Electron main未改动，保留并行src/setting/index.vue、src/i18n/index.ts、.github/workflows/discord-release.yml、public/community/。没有提交、推送或发布。

以下为历史检查点，不覆盖上述最终审计结论及明确后置项。

## 2026-11-09: 实屏多选/三种视图验证；发现并修正选中计数挤压

### 选中栏修正版构建结果

54项聚焦回归（3文件）、typecheck、macOS arm64 debug构建212.00MiB通过；新可执行SHA256 3a752e9ec769c39d8c3f05356d358c825c0f42c364ad196f95629c3eb3912503。日志 /tmp/m5-selection-wrap-focused.log、/tmp/m5-selection-wrap-typecheck.log、/tmp/m5-selection-wrap-build.log。新包尚未重启，换行修正仍待实屏验收；此次没有Rust实现改动，不重跑原生全套。

同一112af093运行实例重新绑定后，AX已能读取testVideo21项，和用户上轮确认一致。实屏操作：点击索引1→1/21，Shift点击索引3→3/21，Command点击索引4→4/21，再Command点击同项→3/21；切换列表→缩略图→大图→列表，所有切换均保留3/21，最终取消选择→0/21。截图显示缩略图在约550–600px右内容区自适应三列、文件夹与视频原图标正常；不把此截图推断为所有显示缩放或全部提供商缩略图结果。过程中工具报告bundle改变，重新获取同一app状态后再继续，没有另启进程或重启。未播放或修改样片。

截图同时暴露选中操作栏过宽时计数被截断。只在SourceDriveManager宿主CSS加组换行、选中计数不压缩及自适应高度，不更改原PanRight模板/按钮/回调。新样式需要打包后实屏再确认，不能用旧截图宣布修正已验收。原始源码校验207/23/2已通过；聚焦回归、类型检查与新构建结果后续追加。没有新增镜像CSS实现的测试。

inventory3.5补记用户后来明确要求的原文件直接迁移约束：与早期工具栏重排、根目录虚拟入口建议冲突时，以保留原UI交互为准；现有原根路径下拉和全部专辑工具栏仍需保持可达。840px、窄区适配及全部保留功能的验收要求不变。

M5 active；下一项具体待验收为选中操作栏换行修正版实屏。真实账号后置；M6未启动；Electron main只读。

## 2026-11-09: 最新包启动与本地列表用户验收；15提供商能力对应检查通过

按已有重启授权，用原生应用菜单Quit，随后观察isRunning=false，再从完整路径启动112af093新包。原生无障碍树确认主屏幕→文件→添加文件源→Mac→testVideo；来源与收藏入口保留，未触发账号登录、上传或文件写操作。进入testVideo后工具AX和截图持续显示0/0加载骨架；重新绑定同一应用后仍如此。只读进程采样（PID80692，/tmp/m5-latest-native-directory.sample.txt）显示应用主线程/运行时等待事件，未捕获到目录读取线程，不能据此证明目录读取阻塞。用户对当前最新包明确回复「列表正常显示且能操作」，因此接受用户实际列表加载/操作结果；不把工具骨架画面当作应用正常截图或像素测量证据。未为截图异常再次重启。

新增 file-provider-operation-parity.test.ts：15个原版云盘/WebDAV/AList提供商，每个比较11项M5文件能力（建目录、重命名、移动、复制、文本、回收站移入/列表/还原/删除/清空、创建分享），15项参数化测试通过。比较对象为Electron原能力声明与当前Tauri实际支持判断，专门防止遗漏原版提供商接线；不代表服务端操作已验证。独立OpenAli公共协议、本地物理CRUD和M6传输引擎不混入该矩阵，仍按已记录边界验收。

本检查点只有新增测试和文档，没有应用代码变化，不重复构建或原生全套。前一检查点245文件/2403前端及218原生/10忽略仍为相应构建证据；本次另加15项能力测试通过，不虚报新的全量测试总数。当前实际运行包已更新为112af093，替代此前96d4d257。真实账号后置，M5继续收口其余交互矩阵，M6未启动。Electron main保持只读。

## 2026-11-09: 光鸭新建文本接入原版弹窗与原生 IO；全量回归和打包通过

上一个检查点确认的光鸭文本缺口已接通。仍调用原文件提取的 apiGuangyaUploadBuffer，不另写弹窗或上传状态机；其 hash/token/info/PUT/timer 依赖接到 Tauri 原生操作句柄。原生保存文档字节、上传凭证及 OSS 签名材料，前端只取得句柄、MD5、任务标识与净化结果。命令仅接受主窗口；账号元数据和凭据指纹在操作前后核对；关闭/切源取消句柄，在途 token 和 PUT 不重复提交；保留原版秒传及任务轮询流程。创建成功后确认文件 ID、文件类型、名称、父目录和 UTF-8 字节长度。已有文本创建窗口作用域检查保持有效。

Provider audit: Electron src/drive/uploadmem.ts 的实际六个分发分支与当前 Tauri 文本能力集一致（Ali web、Dropbox、OneDrive、Box、Google、Guangya；Open Ali 独立通道不冒充 web）。另检查 Electron src/drive/share.ts 创建分享分发与 sources/share.ts：九个提供商集合相同；providerShare.ts 的 Quark/Guangya/PikPak 导入加 Ali 原通道与当前四个导入提供商相符。这是来源/接线审计，不替代真实账号结果或所有分享选项验收。

**前端245文件/2403测试通过；原生218通过/10既有忽略；typecheck及macOS arm64 debug构建212.00MiB通过。** 新增原流程6项、文本适配10项和原弹窗1项测试；后者证实原输入/提交/关闭流程与无 transfer_ 调用。原快捷键用例此前把 Guangya text:false 作为旧预期，现按 Electron 实际能力改为true，32项快捷键/宿主测试通过。首次全前端只有该旧预期失败，修正后全量重跑通过。原生首次沙箱执行18项因本机回环监听 Operation not permitted 失败；获自动授权后相同离线全套通过。5项新增原生测试涵盖独立固定 OSS/HMAC-SHA1 签名、UTF-8、凭证/目标/路径拒绝、原版任务状态与数值 ID、字符串code及上传中业务响应；原始响应/凭证不回显。

Files源码校验207/23/2、library35/14/4通过。可执行文件SHA256 112af093ade68a7505650b0b2a520f04cc4b464c9e8c9a30162e5e4c3d008276。日志 /tmp/m5-guangya-text-all-final.log、/tmp/m5-guangya-text-native-all-unrestricted.log、/tmp/m5-guangya-text-build.log。新包未重启；当前运行实例仍不是此次构建。没有真实账号调用、用户文件改动、提交或发布。Electron main未修改，观察到并保留并行改动 src/setting/index.vue 和 .github/workflows/discord-release.yml。此为 Tauri 专属接口迁移，Apple/Android不作改动。

M5仍active；其余验收以当前索引为准，未凭此单项宣布整体验收。真实账号后置，M6未启动，未实现传输队列。

## 2026-11-09: 提供商审计发现光鸭文本创建漏迁；原版上传流程已迁入

直接检查 Electron src/drive/uploadmem.ts 的真实分发，而非仅依赖 Agent 能力声明：原版支持 aliyun、dropbox、onedrive、box、google、guangya；Tauri supportsRemoteTextCreation 当前缺少 guangya。这是 M5 新建文本的接入缺口，不是提供商不支持，不得据此关闭本阶段。

已从当前 Electron src/guangya/upload.ts 原文件提取 apiGuangyaUploadBuffer 到 drive/electron/providers/guangyaTextFlow.ts，保存完整来源快照及提交号。只将 MD5、token、任务查询、PUT 和定时器改为注入 IO；保留原版秒传优先、单次 PUT、同一任务轮询、10 次轮询上限及错误返回。源码 AST 保真校验通过：207 mappings / 23 exact templates / 2 assets。新增 6 项合成测试全部通过，覆盖 UTF-8 字节及目标参数、秒传不上传、单次上传后轮询、token 失败、PUT 失败、终态失败与轮询超时；vue-tsc 通过。

尚未连接生产原生 IO，未启用光鸭文本能力，未进行真实账号请求。下一步必须补齐账号/窗口作用域绑定、原生凭证及 OSS 签名上传、任务回执和创建后身份/父目录/长度验证，再连接现有原版文本弹窗并做集成测试。此内存文档创建不创建 M6 上传队列。本次没有 Rust 修改、全套测试重跑、应用打包或重启，不将此前 2386 项全量结果冒充本次结果。Electron main 未改动；原有 src/setting/index.vue 脏改动保留。M5 active；M6 not started。

## 2026-11-09: 用户确认窄窗属性与目录树弹窗可用

用户按验收请求将 Tauri 主窗口缩窄到接近最小宽度，在 Mac → testVideo 中检查「属性」及「更多 → 复制目录树」，回复「两个窗口均完整可用」。据此接受这两个窗口的内容、底部按钮及关闭操作在该窄窗场景下可用。此项为用户实屏验收，未测得实际窗口像素宽度；不推广为全部提供商、多层弹窗或精确几何验收。

该确认对应当时运行的 96d4d257 恢复修正版，不代表最新 4adbafc7 OpenAPI 修正版已启动。未进行真实账号操作或文件修改。M5 继续进行能力与剩余菜单矩阵核验，真实账号后置，M6 未启动；Electron main 保持只读，保留已有 src/setting/index.vue 修改。

## 2026-11-09: Official OpenAPI contract review completed; direct deletion and list-limit fixes integrated

Browser fallback successfully opened vendor-authored Yuque documentation without login;earlier HTTP reader failures did not establish missing vendor contracts. Primary pages inspected2026-11-09:
- [Move/copy](https://www.yuque.com/aliyundrive/zpfszx/gzeh9ecpxihziqrc):move is explicitly limited to currentdrive even though optionalto_drive_id exists;copy defines destinationdrive separately. Keep Open cross-drive MOVE rejected beforeIO with a contract-specific message;web cross-drive support remains separate.
- [Recycle/delete](https://www.yuque.com/aliyundrive/zpfszx/get3mkr677pf10ws):documents trash,delete,and async-task status. Reviewed public chapter does not provide bin listing,restore or empty endpoints. Those Open-only management entries remain outside the exposed public-contract capability set;this is not a claim that vendor has no private/service capability.
- [List/search/favorites](https://www.yuque.com/aliyundrive/zpfszx/zqkqp6):list/search/starred pagination maximum100. Normal Open list previously requested200;now100 on every cursor page. Existing favorites reader already uses100. The reviewed list body does not offer a recycle-bin selector.

Added documented Open direct DELETE through original ApiDeleteBatch/body,adapting only its account guard to the existing web/Open trash account port. AST provenance manifest updated for that declared guard transform;original request declaration/UI templates retained. Open transport binds receipt to operation so an unresolved trash intent cannot become permanentdelete. It validates active source identity first,requires matching delete acknowledgement identities,continues accepted async-task confirmation on retry,and verifies final file absence before reporting success. Merelytrashed is insufficient for permanent deletion;officialNotFound.FileId now joins existing absent-code aliases. Synchronous empty task field is allowed only with final verification;202stillrequires taskID. Lost/ambiguous acceptance is never automatically reposted.

Direct active-file deletion and recycle-bin purge capability checks are separate:Open source offers original direct-delete shortcut/menu,while no bin listing/restore/purge/clear UI is enabled. Source action and original helper guards now agree with this context;host confirms local catalog purge only after remote evidence,and retains rows/receipts on sync failure. No arbitrary native cloud endpoint or web-token fallback was introduced.

**Full frontend243files/2386tests passed,typecheck/buildpassed;files/library verifiers206/23/2 and35/14/4passed.** Focused final4files/61passed preceded last2async cases+1pagination case;full run includes them. New11casescover documented delete/absence,trash≠delete,taskretry,norepost,operationbinding,3unmatchedacks,originalCmdShiftDelete/catalogisolation,emptytask200vs202,and100itemcursorpages. Two earlier tests still assumed deleteunsupported/useddelete as invalid path;updated them to exercise truly unexposed restore/purge after the official contract was established. Logs /tmp/m5-open-contract-focused-final.log,/tmp/m5-open-contract-types-final.log,/tmp/m5-official-open-contract-all.log,/tmp/m5-official-open-contract-build.log. macOSarm64debug211.84MiB,SHA256 4adbafc7a8abeaaeb3a08dba4cbcb5e432dbcf54eeb28b2d1e3a4a4511663e46. NoRust edit/native-suite rerun;prior213passed/10ignored remains earlier evidence. New bundle not restarted;running96d4d257conflict-recovery package remains earlier native evidence. No real-account deletion or new accountlogin.

Open move/recycle public-contract review is now evidence-backed rather than unresolved-documentation work. Public-contract-absent management operations remain capability-gated;real-account acceptance remains deferred. Remaining M5 work focuses on complete native840px/narrow/stacked-dialog/menu matrix and final requirement-by-requirement review. M5active;M6notstarted. Electron main was not edited;latest status contains concurrent src/setting/index.vue modification,which is preserved. No commit/release or Apple/Androidchanges.

## 2026-11-09: Explicit conflict recovery with verified backups and deferred-startup browsing

Remote preference recovery now accepts an explicit conflict-decision callback. Production startup and original Ali cross-drive synchronization use an existing Arco Modal.confirm surface with “稍后” and “备份并恢复”,same component used by original property/restore dialogs. No automatic conflict overwrite:defer leaves preferences and native receipt untouched. Approval captures current memory/persisted state,checks neither changed while confirmation was open,creates a uniquely keyed durable localStorage backup including original persisted bytes,reads it back,then writes accepted after-preferences and invokes the existing player-before-native acknowledgement. Backup quota/error/unverified write aborts before replacing current settings. Malformed persisted JSON may be backed up verbatim and replaced only after explicit approval. Separate backup IDs retain edits made again after a lost acknowledgement;existing backups are not overwritten. Backups remain in application WebView storage;no separate export/restore-backup screen was added.

Startup handles recovery deferral/failure separately from source/catalog reads. Existing notification surface offers persistent RetryRecovery action;file/source browsing and membership initialization continue. Automatic scan startup,focus-triggered scans and scan-setting-triggered ticks wait for successful recovery. A successful retry refreshes source/catalog and starts the existing scheduler. This is not a bypass of the native pending-write barrier:manual writes remain subject to existing journal checks.

**Full frontend243files/2375tests passed;typecheck/build passed.** Eight additional recovery cases coverapproval/backup order,defer,current/persisted edits during confirmation,backup failure/readback failure,corrupt raw-state backup and repeated-edit backup retention. Three actual Arco dialog cases exercise both buttons and showEscape/mask clicks do not approve. Focused recovery+commit2files/33passed;prompt1file/3passed. First prompt fixture wrongly used non-existentModal.destroyAll and then saw a prior closing modal;fixed teardown to wait for each original modal to unmount. Initial full run had only these prompt-fixture failures;final full suite passed. Logs /tmp/m5-recovery-conflict-focused.log,/tmp/m5-recovery-prompt-focused-final.log,/tmp/m5-recovery-conflict-all-final.log,/tmp/m5-recovery-conflict-build.log. Files/library verifiers206/23/2 and35/14/4 passed. NoRust changes/native-suite rerun;prior213passed/10ignored remains earlier evidence.

macOS arm64 debug211.82MiB executableSHA256 96d4d25796440df19038047fbe3ad7674c722c27e470c9a7779ebd1069e6df50. Authorized nativeQuit,observedisRunning=false,opened exact new bundle. Native AX checked normal startup/home/File/AddSource/Mac/testVideo21entries,no recovery error/selection/filter. No conflict/pending receipt was injected into user data;native conflict branch itself remains synthetic component/storage acceptance,not real-account recovery acceptance. App left onMac/testVideo. No test video opened this checkpoint,no real account/provider write or current-preference restore performed.

M5active. Conflict recovery now has an explicit production action and retry path;remaining acceptance focuses on full native geometry/nested-provider menus and Open-only recycle/cross-drive contracts,with real accounts deferred. M6notstarted. Electron mainclean/read-only;no commit/release or Apple/Androidchanges.

## 2026-11-09: Native CmdQ interval/CmdH home/Enter/Backspace/Space gates verified

Inspected original PanRight keyboard handler and native default-menu setup before testing possible macOS accelerator conflict. On the existing5c324eac app,selected a testVideo row thenCmd+Q: process stayed running and original interval control switched to CancelSelection. Clicked interval start/end rows1/3:3of21 selected and interval mode ended. Original Reverse yielded18of21;Cancel returned0of21. No accelerator override or original keyboard change was required.

Native child navigation:calibration showed4entries;Cmd+H returned21entry testVideo root. Enter from a singly selected calibration row opened4entries;Backspace from source-row focus returned21. Space focused original quick filter;typedgray left1matching item;Cmd+A/Backspace cleared to4children and additionalBackspace while input remained focused did not navigate. After cancellation's asynchronous focus recovery,Backspace returned21entries/no selection. An immediate cancel+Backspace in the same automation call happened before focus recovery and left4entries;after observing current state,the nextBackspace succeeded. Do not describe this as proof of zero-delay focus transfer. F5 after cancellation kept21entries/no error; no read-counter instrumentation was captured,so only observable operability is accepted.

**Incidental test playback:** double-click navigation into calibration allowed the second click to hit newly loaded BoxPlayer HDR highlight steps.mkv,opening the player. Closed its native window immediately and returned to file browser;later navigation used single selection+Enter. The player's loading UI was observed,not successful playback. Source file contents were not modified;native resume state for this test sample may have been saved and no before-state was captured for rollback. No unrelated file/account operation or real cloud request. App leftMac/testVideo21entries,emptyfilter,0selection,playerclosed. No app restart this checkpoint.

Added3 source-host component boundary tests:bothCtrl andCmd aliases for cloud-only copy/cut/create/upload/import/rename/share/favorite/delete plusF2 issue no native calls or file changes on local sources;filter text editing retains default keyboard behavior and does not forward file commands. Focused1file/3passed,typecheckpassed. Logs /tmp/m5-shortcut-boundary-focused.log,/tmp/m5-shortcut-boundary-types.log. No application/nativecode edit,build or native-suite rerun. Previous full frontend241files/2361passed and native213passed/10ignored remain earlier evidence;do not silently increment full-suite totals from this focused run. Electron main verifiedclean/read-only.

M5active. These named local native shortcuts and modifiers supersede earlier uncertainty for their tested contexts;remote write shortcuts remain provider-component/service tests with real accounts deferred. Native pixel geometry/complete nested/provider popup matrix,Open-only recycle/cross-drive contracts and conflicting-preference recovery UX remain unresolved. M6notstarted;no commit/release or Apple/Androidchanges.

## 2026-11-09: User accepted native hover menus; original menu interaction matrix verified

User explicitly confirmed current Tauri Mac/testVideo sorting and selected-file More menus both expand on hover and their options can be clicked: “两个菜单均正常展开并可点选”. Original PanRight sorting and FileTopbtn More declarations use trigger=hover. Therefore preceding AX click/Return attempts did not establish an application regression; no trigger or original template was changed. Accept this user-observed native hover/open/click gate for these two menus on running5c324eac package,not all nested provider menus or exact geometry.

Added original component interaction coverage for each of six sort options (name/time/size,both directions) by hovering the real sorting dropdown and selecting its translated label. Assertions check folder-first file order,displayed selected rows,and original selection behavior: choosing the unchanged order retains selection; changing order clears it. This is the original mOrderListData contract,not a new Tauri policy. Three original view buttons exercise list→thumbnail→large→list rendering and preserve selected IDs/data. Added an original root dropdown→NowWatching→toolbar AllAlbums case; collection request/model/breadcrumb results are verified. AllAlbums was already exposed by original PanTopbtn within the video view; no duplicate entry or replacement UI was added.

**Full frontend241files/2361tests passed,typecheck passed.** Seven layout/sort interaction cases plus one root-to-album navigation case were added. Focused special navigation2files/21passed and final layout/sort1file/7passed. Initial menu fixture selected always-mounted hidden context options because it searched all dropdown nodes; restricted it to the six actual translated sort labels. Fixture also incorrectly expected selection retention after changed sorting and searched view buttons inside the sort-only div; corrected against the original component/store behavior. Typecheck caught passing typed translation function directly to map; corrected to a typed key lambda. Final full run includes these fixes and no unhandled errors. Logs /tmp/m5-original-special-navigation-focused.log,/tmp/m5-layout-sort-menu-verified.log,/tmp/m5-original-menu-matrix-all.log,/tmp/m5-original-menu-matrix-types.log. Files/library verifiers206/23/2 and35/14/4 passed.

**No application/native code changed this checkpoint; no rebuild,restart or native-suite rerun.** Current built retry package6d2bc917 and running5c324eac remain distinct prior artifacts; native213passed/10ignored is earlier evidence. Synthetic component tests do not establish native pixel geometry or real-account service behavior. No new screenshots or account/file writes. Electron main verified clean/read-only.

M5 remains active. Native sorting/More hover gate now accepted with user evidence; full nested/provider menu and840px/narrow-window geometry,remaining shortcut combinations,and Open-only recycle/cross-drive contract review still need current evidence. Startup conflicting-preference handling remains fail-closed. Real accounts deferred;M6notstarted. No commit/release or Apple/Android modifications.

## 2026-11-09: Existing error retry preserves original move synchronization; latest native selection smoke

SourceDriveManager's existing error-row Retry button now retains the original Ali web/Open move/copy action for unresolved IDs. A failed local catalog/identity synchronization retries the retained original destination and receipt rather than refreshing away its source row. Successful batch IDs are excluded from ordinary partial-failure retries. Scope/account checks run before retry; changing source clears the callback and same-ID owner replacement refuses another request. A later host synchronization failure preserves the full unacknowledged original action. Successful retry clears the existing error row. Original Electron templates/menus/request handlers remain unchanged; the Tauri host error button is the only UI binding changed.

**Full frontend240files/2353tests passed; typecheck and macOS arm64 debug build211.82MiB passed.** Two new original-host component cases prove the existing button completes local synchronization with a single provider move POST,and owner replacement refuses further IO. Earlier focused2files/11passed preceded the owner case; final full result includes both. Logs /tmp/m5-relocation-ui-retry-focused.log,/tmp/m5-relocation-ui-retry-types.log,/tmp/m5-relocation-ui-retry-all.log,/tmp/m5-relocation-ui-retry-build.log. Files/library verifiers206/23/2 and35/14/4 passed. Executable SHA256 6d2bc91789276a15f9f60b5afc952c9627ba29b8f13cdd4821310cdbaaae1ac4. No native edit/native-suite rerun this checkpoint; prior213passed/10ignored remains earlier evidence. This retry bundle has not been restarted.

Before the retry edit,authorized native Quit→observedisRunning=false→exact5c324eac web-integration bundle launch completed. Native AX inspection verified startup,File/AddSource/Mac/testVideo21entries,select row→Cmd+A21/21,cancel0/21,Cmd+F→DV0/8,and clear→0/21. App left atMac/testVideo with filter empty and no selection. During this check ScreenCaptureKit-3811 recovered by rebinding the same live app without restarting. Screenshot repeatedly showed underlying File home while AX reported open source browser; no screenshot-based geometry or dropdown acceptance is claimed. Sort/More AX activation and Return produced no observable menu tree; keep this gate unaccepted rather than treating an attempted click as proof. No real account or file mutation.

Open-contract research: official developer portal https://www.alipan.com/developer returned no readable documentation; vendor Yuque https://www.yuque.com/aliyundrive/zpfszx could not be fetched. Public search did find Alibaba Cloud PDS ListRecyclebin https://www.alibabacloud.com/help/en/pds/drive-and-photo-service-dev/developer-reference/api-pds-2022-03-01-listrecyclebin,which is a PDS domain_id/RAM service contract,not proof of an openapi.alipan.com OAuth recycle endpoint. No PDS endpoints or web credentials were substituted into the Open channel. Local Open adapter still has only trash insertion and same-drive move/copy; full Open recycle and cross-drive contracts remain unresolved,not declared unsupported.

M5active;real accounts deferred;M6notstarted. Remaining current gates are indexed below; early chronological matrices are historical evidence and require current-source verification. Electron main verified clean/read-only;no commit/release or Apple/Android changes.

## 2026-11-09: Original web cross-drive move connected end to end to local identity commit

Original Ali ApiMoveBatch now runs cross-drive web moves only inside the complete observation scope and with an explicit synchronization callback. SourceDriveManager supplies that callback through relocateRemoteFiles; it consumes the transport's accepted full before/after/pairs receipt,builds detached catalog/favorite drafts,submits a stable native transaction payload,runs durable preference recovery and waits for player-worker acknowledgement. The batch reports identitySynced IDs; the host reloads committed catalog and skips ordinary same-drive reference updates for those IDs,clears stale command/list rows,and releases transport/local retry jobs only after host reconciliation. Original picker/menu/drag handlers and original provider request body remain unchanged. No separate cloud request is added by local commit/recovery.

Registered remote_identity_commit validates web-Ali provider and source account,then holds current account metadata stable through the native catalog/progress/alias transaction. Accounts.with_current rejects removed or replaced metadata before running the callback. This IPC commits **local references only**; complete remote observation/acceptance validation occurs in the original transport and frontend coordinator,not as a second native cloud operation. Playback transition lock serializes native submission with player transitions. Native ordinary catalog event reload is emitted after commit; pending preferences retain their durable barrier until acknowledgement.

Local coordinator retains the exact UUID,revision,catalog,prefs and moves on lost commit response,lost acknowledgement or later host reload failure; retries do not rebuild an already committed plan. Only a distinct REMOTE_IDENTITY_REVISION precommit rejection discards the draft for a fresh projection. Store/persisted-preference conflicts,corrupt storage,unverified writes,scope changes,changed owner or changed observation reject without silently replacing settings. Normalizes the matching prior preference shape before native commit so restart comparison remains exact. Durable postcommit recovery is connected; provider submission intent remains in-memory and this does **not** claim process-crash recovery of an unknown cloud submission.

**Full frontend240files/2351tests passed; full native213passed/10existingignored; typecheck/build passed.** Added10 local-commit cases and3 original-wrapper/batch integration cases covering confirmed full receipt,retry without another cloud POST,identitySynced reporting,stable payload through host acknowledgement,persistence/owner/scope/mapping conflicts and definite revision rebase. New account-lock case rejects changed/removed metadata before callback. First native attempt failed because its fixture was inserted outside the module owning MemoryVault; moved the case into the existing tests module and final full native suite passed. Logs /tmp/m5-cross-drive-integrated-all-final.log,/tmp/m5-cross-drive-integrated-native-final.log,/tmp/m5-cross-drive-integrated-types.log,/tmp/m5-cross-drive-integrated-build.log. Files/library verifiers206/23/2 and35/14/4 passed. macOS arm64 debug211.82MiB; executable SHA256 5c324eac4daca868c569e76efaa67aa63adbb11d1cd4b1a673e536769005d6f9. No bundle restart or native real-account move acceptance in this checkpoint; current running app remains olderf3290c recovery-smoke package.

Web cross-drive entry is now connected when invoked by the original file-page host callback; raw/unscoped calls remain rejected. **OpenAPI cross-drive remains gated** because vendor contract/mapping is unestablished,not because this web integration proves it unsupported. Remaining M5 gates include Open recycle/cross-drive contract review,conflict recovery UI and full native shortcut/menu/840px geometry acceptance. Real accounts remain explicitly deferred;M5active;M6notstarted. Electron main clean/read-only;no commit/release or Apple/Android modification.

## 2026-11-09: Worker queue reconciliation connected to durable recovery acknowledgement

Player now accepts an internal Reconcile message and returns a worker acknowledgement. It projects the entire queue,queue subtitles and loaded remote-subtitle descriptors into detached clones using committed native aliases; only after all projections and current-index validation succeed does it replace live references and publish current item/source and queue identities. Session ID,position,paused state,volume,speed,titles and track state remain intact; no mpv reload or stop is issued. A projection error preserves all old live references. The backend remote_operation_ack command holds playback_transition,waits for this worker acknowledgement,and only then acknowledges the durable preference receipt. Channel failure or5s acknowledgement timeout leaves the receipt pending; an already-enqueued reconciliation may finish later and the next retry canonicalizes the same identities idempotently.

Gateway pending subtitle cache retains its private root descriptor so old keys can match only a proven canonical source/account/file identity. It consumes the newest matching entry,removes obsolete equivalent entries,canonicalizes each subtitle and preserves one-use behavior and120s expiry. Account revocation now clears root-owned entries even if their subtitle list is empty. Mapped lazy subtitle descriptors are resolved by register_mode before URL validation; otherwise a canonical boxplayer-queue descriptor would be rejected as an HTTP URL. Existing live proxy streams continue until normal refresh; no forced playback disruption.

**Final full native212passed/10existingignored** after command integration. Four new player cases cover complete active queue/subtitle/snapshot remap with playback-state preservation,atomic failure,invalid-index rollback and worker acknowledgement/idle no-op; new gateway cache case covers canonical old-root matching,foreign-account rejection,subtitle identity projection and one-use consumption. Logs /tmp/m5-live-queue-focused.log,/tmp/m5-live-queue-native-all.log,/tmp/m5-live-queue-native-final.log,/tmp/m5-live-queue-build.log. Typecheck and macOS arm64 debug211.60MiB build passed; executable SHA256 d86db173f18596532ebd85015d73b2a6500c4c66cb3945a37c7795d4d581f52f. No frontend edit or frontend-suite rerun; prior239/2338 remains earlier evidence. Bundle not restarted; current app remains recovery-smoke packagef3290c. No real provider/account operation or user-data seed.

**Still no live remote identity commit entry.** The queue update is connected to recovery acknowledgement,not yet to the original move's accepted observation/transaction submission. Public cross-drive guard remains. Next: bind original accepted receipt and exhaustive snapshots to native commit,run preference recovery/worker acknowledgement,and integrate original picker/menu without duplicate catalog relocation. Conflict recovery UI,Open recycle contracts and full native shortcut/menu/geometry matrix remain. M5active;real accounts deferred;M6notstarted. Electron main verified clean/read-only;no commit/release or Apple/Android changes.

## 2026-11-09: Durable playback file aliases bound to gateway resolution

Native identity transaction now records source-scoped old/new file locations in remote_file_aliases in the same SQLite transaction as catalog,progress aliases and recovery receipt. resolve_media follows the durable chain with one read transaction,canonical location checks and cycle/depth bounds; cross-account descriptors are untouched. A mapped descriptor discards old URL,headers and expiry and becomes a lazy queue descriptor. Failed catalog/progress transaction does not install playback aliases. Successive moves and process-like reopen preserve resolution.

Production Backend now constructs Gateway with the library-backed identity resolver. Player load canonicalizes media and subtitle descriptors before URL resolution. Gateway queue resolution canonicalizes before requesting a new URL,retains strict source/account/file checks,and rejects a result if the committed identity changed during refresh. Proxy registration resolves mapped old descriptors instead of registering stale URLs. Existing403/401 refresh uses the same canonical resolver; HLS session invalidation and child-session restart behavior are retained. No arbitrary file replacement is authorized by a provider refresh result.

**Full native207passed/10existingignored**; nine remote_identity focused tests passed. Five new native cases cover durable scoped descriptor resolution,URL/header invalidation,rollback without alias installation,corrupt file-alias cycles,gateway committed identity and in-flight remap rejection (gateway owner and remap checks share one case). Existing successive-move test additionally checks file-ID chain resolution. Full native ran with authorized localhost socket access. Logs /tmp/m5-player-identity-focused.log,/tmp/m5-player-identity-native-all.log,/tmp/m5-player-identity-build.log. Typecheck and macOS arm64 debug build passed,211.44MiB; executable SHA256 2aba5fcda69d10db070ee3658d7c4b64676214ac733220b2cd99efceaf864751. No frontend code change or frontend-suite rerun; previous239files/2338passed remains earlier evidence. Current running app is still priorf3290c recovery package; this newer bundle not restarted/runtime accepted.

**Not complete active-session coordination.** Already-playing queue entries/snapshot identities and cached external-subtitle descriptors are not proactively rebound; an existing proxy can keep its current stream until normal refresh. No native accepted-operation commit command exists and the public cross-drive guard remains enabled. Next work must connect accepted provider observations to commit,and update active queue/snapshot/session references as part of that coordination; progress aliases plus load/refresh resolution alone are insufficient. Open recycle contracts,conflict recovery UI and full native shortcut/menu/geometry gates remain. M5active,real accounts deferred,M6notstarted. Electron main verified clean/read-only;no commit/release or Apple/Android changes.

## 2026-11-09: Startup recovery now persists and acknowledges committed remote preferences

Added registered remote_operations_pending and remote_operation_ack native commands, calling the existing durable transaction journal. No command accepts an arbitrary remote identity commit and no provider operation is replayed. Main startup runs remote recovery before local recovery, source refresh and catalog load. Frontend validates receipts and preferences, compares current memory and persisted settings against the exact before/after states (object-key order independent), persists and reads back the accepted after-state, updates the store, checks synchronous watcher interference, then sends matching preferences to native acknowledgement. Conflicting edits, corrupt storage, failed or unverified writes retain the native pending receipt; lost acknowledgement can retry the already-persisted after-state. Empty pending list does not write preferences. Concurrent recovery is coalesced per store. Conflict-resolution UI is not implemented yet; conflicts currently reach the existing startup error toast and remain pending.

**Frontend239files/2338tests passed; focused2files/24tests passed (15remote+9local); native remote_identity6tests passed; typecheck/build passed.** Files verifier206/23/2; library35/14/4. Full native suite was not rerun; prior202passed/10ignored is earlier evidence. Logs /tmp/m5-remote-recovery-focused.log, /tmp/m5-remote-recovery-types.log, /tmp/m5-remote-recovery-native.log, /tmp/m5-remote-recovery-all-final.log, /tmp/m5-remote-recovery-build.log. New macOS arm64 debug bundle211.38MiB; executable SHA256 f3290c40881cae8d953a930bcc4f282e912b8ee654795ebf6b93cbb97bb91111.

Authorized restart completed through native Quit, then observed isRunning=false, then opened exact new bundle. Initial new-launch ScreenCaptureKit-3811 recovered by binding same live app, without another restart. New package startup/home/file page/Add Source/Mac/testVideo passed native inspection; testVideo loaded21entries. Screenshot and accessibility tree show rendered list, original filter/sort/view controls and local favorites. This is a normal startup/no-pending-receipt smoke check; crash recovery with pending transactions is covered by synthetic tests, not injected into user data. No real accounts/files changed and no pending remote move seeded into the user application. App left onMac/testVideo.

M5 remains active. Public cross-drive guard remains until accepted-operation/native commit binding,active player queue/gateway identity coordination and original picker/menu integration are completed. Open recycle contracts,native shortcut/menu/geometry matrix and conflict recovery UI remain unresolved. Real accounts deferred;M6 not started. Electron main clean/read-only;no commit/release or Apple/Android modifications.

## 2026-11-09: Original cross-drive move bound to complete observed receipts

Internal web Ali move transport now requires a source/account/pane/operation-bound observation scope before any cross-drive write. It reads the complete source snapshot before recording submission intent, keeps intent before the original POST, accepts an explicitly returned changed root ID, then reads the complete accepted target tree and validates observed descendant pairs. Original ApiMoveBatch request body is retained. Failed read-only preflight permits retry; ambiguous submission never reposts; target verification retry uses the retained original source snapshot and accepted job. Receipts are owner-bound and return detached snapshot arrays. Public relocateAliFile cross-drive guard remains enabled: this is an internal transport foundation, not an enabled user feature or a durable cloud-operation journal.

**4 files/46 focused tests passed; full frontend 238 files/2323 tests passed; typecheck passed.** Source verifiers: files206/23/2, library35/14/4. Logs: /tmp/m5-cross-drive-receipt-focused.log, /tmp/m5-cross-drive-receipt-types.log, /tmp/m5-cross-drive-receipt-all.log. Eight new receipt cases cover unscoped rejection, exact original request/changed root, verification retry without repost/source reread, incomplete descendants, preflight retry, lost acceptance response, same-ID owner replacement and detached receipt mutation. No native changes or native rerun in this checkpoint; no rebuilt/restarted bundle or real-provider request. Prior native202passed/10ignored remains earlier evidence.

User confirmed calibration hover preview normally appears; that local native display gate remains accepted. Remaining M5 work: bind native catalog/progress transaction and persisted preference recovery/ack to accepted observations, coordinate active player queue/session identities, integrate original picker/menu, resolve Open recycle contracts, complete native shortcut/menu/geometry matrix. Real accounts deferred; M5 active; M6 not started. Electron main remains untouched. No commit/release or Apple/Android changes.

## 2026-11-09: Source-bound exhaustive move snapshots and observed descendant pairing

Added aliMoveSnapshot.ts, reusing original Ali metadata methods plus existing source-driver directory listing. Selected roots are reread through original native-bound detail ports and checked against expected parent; full directory trees are walked breadth-first across every page without changing pane rows/navigation. Original normalized models must match account,file/parent identity,name,type and size; duplicate nodes/cursors,wrong parent,virtual root,depth/node limit,changed owner or pane lifetime reject the observation. This is read-only preparation/verification; no provider move or local file mutation is issued.

pairObservedAliMoveNodes combines explicit accepted-root ID pairs with descendant IDs actually present in both observations under the target drive. It then reruns complete cross-drive identity validation. A descendant with changed ID is NOT matched by equal name/size/hash; absent provider mapping remains an explicit unresolved identity instead of guessed success. Extra target nodes or changed child content reject. Snapshot completeness is relative to successful provider pagination; this does not bind any root-pair object to an actual accepted move receipt yet.

**3files/28focused tests passed** (10 new snapshot/pairing +18 existing identity/reference),typecheck passed. Coverage: multi-page nested traversal,model/hash projection,repeat cursor/node rejection,wrong-parent/type projections,root changed before preflight,same-ID owner change stops next page,virtual-root write-before-read guard,observed descendantIDs,ambiguous changed descendantIDs,extra target/changed content. Logs `/tmp/m5-move-snapshot-focused.log`, `/tmp/m5-move-snapshot-types.log`. No fullfrontend rerun,bundle rebuild or native rerun in this unused-reader checkpoint; previous236/2305 frontend and202native/10ignored remain earlier evidence. Existing app instance not restarted.

**Still not wired to provider move/persistence.** Original cross-drive guard remains. Next: attach before/after reads to original web move receipt/session,coordinate native active queue and expose only a bound native commit/recovery path,persist/ack WebView preference changes,and integrate original picker/menu behavior with acceptance. Open snapshot reads are supported through its own existing API channel; this does NOT establish Open cross-drive move vendor support. M5 active;real accounts deferred;M6 not started. Electron main clean/read-only;no commit/release or Apple/Android changes.

## 2026-11-09: Native reference transaction and durable preference acknowledgement foundation

Added remote_identity.rs as an internal native module, not an IPC command or provider mutation. commit validates canonical cross-drive pairs,unique/disjoint mappings,catalog schema/revision,unchanged foreign-source media and size limits; an immediate SQLite transaction moves resume rows,adds durable old→new resume aliases,saves the new catalog revision and a fingerprinted recovery receipt containing before/after preference payloads. Target progress collision or any later error rolls back all preceding writes. Same receipt ID+payload retry returns original revision without replay; changed payload rejects. Preference acknowledgement requires matching source and exact persisted after-preferences; ack compacts payload but retains fingerprint/revision for retries. Unacknowledged receipts block ordinary catalog writers through the shared existing journal barrier. This is **SQLite atomicity plus a durable WebView acknowledgement protocol**, not one transaction across SQLite and localStorage.

Library.position/save_position now resolve aliases inside their read/immediate-write transactions. Old active descriptor progress writes follow persisted alias chains even after process-like reopen or successive moves; remap cannot race between alias lookup and progress insertion. Corrupt/cyclic aliases reject progress writes rather than inventing a key. This handles progress persistence only: active queue/mediaURL/source snapshot rebinding is not implemented by this foundation and remains a before-enable gate. Recovery records do not move remote files,restore a provider task or commit browser preferences automatically.

**6 new native tests passed**:joint catalog/position/receipt commit,matching ack and retry,transaction rollback on target progress collision,old descriptor writes after reopen and multiple moves,stale revision/foreign metadata/changed retry rejection,and corrupt alias cycle. Final full native **202 passed/10 existing ignored**. Initial sandbox full run184passed/18failed/10ignored:all18 failed binding localhost withPermissionDenied; same full offline suite passed with allowed sandbox escalation. Final frontend **236 files/2305 tests passed**,typecheck and macOS arm64 debug **211.08MiB** build passed. Files/library verifiers206/23/2 and35/14/4 passed. SHA256 `d236fb24961c49c5119979e38d2f947b9ca360c7edd12fb290b14e572b9590fe`. Logs `/tmp/m5-remote-identity-native-focused.log`, `/tmp/m5-remote-identity-native-final.log`, `/tmp/m5-remote-identity-frontend-all.log`, `/tmp/m5-remote-identity-build.log`. Build has unused internal-foundation/dead-code warnings alongside existing warnings; no failure. New bundle not restarted/runtime accepted; test storage used temporary SQLite databases only.

**Not yet connected to live cross-drive operations.** No new IPC exposed,provider receipts/snapshots not bound,no frontend preference recovery invocation,no active queue descriptor remap and no cross-drive guard removal. Required next: validated provider snapshot/receipt broker,frontend persisted-preference acknowledgement and conflict recovery,live session/queue coordination,original picker/menu integration and acceptance. M5 active;real accounts deferred;M6 not started. Electron main remains clean/read-only. No user-file operation,account login,commit/release or Apple/Android changes; shared native resume regression was checked because this Tauri storage code affects both local and remote playback.

## 2026-11-09: Detached cross-drive catalog/favorite reference drafts implemented

Added prepareAliCrossDriveReferences atop revalidated explicit complete snapshot mapping. It builds detached drafts only: updates canonical media IDs,file locations,parent/ancestry,confirmed filenames,nested collection members and playlist/series references; retains legacy non-derived media IDs,manual titles,watch progress,ratings and other metadata. Retained originalMetadata drive-file paths/parents/source-folderIDs/last-played references follow the same explicit map,including nested media structures and subtitle descriptors where their owner matches. Foreign account metadata is not rewritten merely because remote location strings coincide. Mapped scan roots follow moved folders; unrelated scan ownership is retained rather than enrolling an unrequested destination scan.

Folder favorites and their names,covers,hidden-on-home and ordering dictionaries follow mapped folder identities while custom favorite labels remain intact. Target media/favorite collisions,conflicting display settings,dangling/duplicate group references,incomplete catalog descendant maps or invalid destination ancestry reject the entire draft without mutating input. Returned source/from/to pairs are input to a future native resume-key transaction,not a claim that playback positions were migrated.

Focused **2files/18tests passed** (9 identity +9 reference cases),typecheck passed. Tests cover detached/unchanged originals,IDs/ancestors/groups/favorite settings,metadata/native file references,foreign owner isolation,legacyIDs,nested collection children,conflicts and missing descendants/invalid ancestry. Initial target-collision fixture incorrectly retained old folder ancestry for an already-target item; corrected it to a valid target location,then tested actual collision rejection. Logs `/tmp/m5-cross-drive-references-focused.log`, `/tmp/m5-cross-drive-references-types.log`. No fullfrontend rerun,bundle rebuild,Rust edits/native-unit rerun or runtime assertion; latest full234/2287 remains earlier evidence.

**Still not connected to provider move or persistence.** Cross-drive write guard remains. Required next: exhaustive observed snapshot/receipt binding,atomic native catalog+preferences+resume reconciliation with active-player references and retry handling,and original picker/menu integration. JSON draft transformation alone is not atomic storage or provider success. M5 active,real accounts deferred,M6 not started. Electron main not edited;no commit/release or Apple/Android changes.

## 2026-11-09: Complete cross-drive identity-map validation kernel added; move still blocked

Current stable-ID move path updates parent/ancestry only; Ali unified location includes driveId, so that path cannot safely serve cross-drive moves. Existing web transport additionally requires movedfile_id to equal original ID. Catalog save is a revision-guarded catalog transaction, not a joint remap of favorites and native playback-position keys. Root move receipt does not prove descendant identities. These are actual implementation gaps; deferred real-account checks do not waive them.

Added pure aliCrossDriveIdentity native-boundary validation for explicit before/after node snapshots and one-to-one returned mappings. Requires canonical source locations,selected roots,all snapshot nodes represented exactlyonce,distinct target IDs,target-drive agreement,preserved filetype/size and matching contenthash when both available,unchanged descendant names while allowing a renamed selected root,mapped child-parent relationships,no selected root nested under another selected root,and no orphan/cyclic/overdeep subtree. Snapshots are copied; no provider request,source file mutation or UI write. This validates completeness relative to supplied snapshots only: exhaustive provider pagination and authoritative mapping provenance must still be established by the future caller, never inferred from file names or a root receipt.

**9 focused tests passed**,typecheck passed. Covers changed descendantIDs,server-renamed root,root-onlyreceipt rejection,duplicate targets,wrong parent,size/hash/name/type mismatch,orphan/cycle,wrongdrive and noncanonical IDs. Logs `/tmp/m5-cross-drive-identity-focused.log`, `/tmp/m5-cross-drive-identity-types.log`. No fullfrontend rerun,bundle rebuild,native-unit rerun or runtime assertion at this unused-kernel checkpoint; latest full234/2287/build remains prior evidence.

**Cross-drive move remains write-blocked** in relocateAliFile. Remaining before enabling: bind before/after exhaustive snapshot reads to original provider operation and accepted receipt,remap catalog/media/group IDs/folder ancestry and source favorites without collisions,atomically reconcile native resume keys and durable preferences/catalog state,handle active playback and synchronization retry,and integrate original picker/drag/menu paths with tests. Do not mark requirement107 complete from pure validation tests. M5 active,real accounts deferred,M6 not started. Electron main remains clean/read-only; no commits/releases or Apple/Android changes.

## 2026-11-09: Automatic Ali web folder sizes wired to original list and size sorting

Source browser now starts a lifecycle-bound read-only scheduler for Ali web accounts when originaluiFolderSize preference is enabled. Preserves50s warmup and10s backup/15s resource check cadence, seven-day direct-estimate freshness, original bidirectional full-directory index, original direct-file request and original tree sum/cache methods. Root discovery is cached instead of requesting drive-info every tick; jobs run serially with account/source checks. Each original direct-size invocation gets one real directory, avoiding its first-success return silently marking other batch memberszero. Original first100 sizeDESC direct-file estimate remains an estimate; no exact recursive-file total claim and no Open-token fallback to web endpoints.

Cache persists direct sizes/times using source-owner/drive namespaces, throttles saves5s and flushes before disposal. Reopening reconstructs a validated directory index and restores fresh direct stats without rereading every folder. Invalid/corrupt/unsafe cache rolls back and triggers actual reads. Same-ID different public owner uses separate durable namespace. In-memory original-method log keys are opaque session IDs, not serialized owner metadata; memory maps released on disposal. Refresh and file mutations invalidate cached statistics/index; disabled preference/local/non-web providers do not start web stats requests. Source replacement/close aborts subsequent reads/publication, preserving successful old estimates on failures instead of publishing a falsezero.

Host publication updates original row models and invokes original mRefreshListDataShow(true), preserving selection while updating active size sort. Newly mapped rows use published totals. Original component templates/handlers unchanged. PersistuiFolderSize alongside existing settings. Source-host integration test proves a/b folders update to10/20 bytes, descend-size orderb/a, selecteda retained, original cell text10.00B/20.00B; close cancels warmup and disabled persisted preference prevents requests. Service tests cover50s start, nested sums,restored seven-daycache,explicit refresh,corruption,disposal,late owner check and read failure; transport now also rejects duplicate IDs within one page before original overlap shortcut could truncate the index.

Final frontend **234 files/2287 tests passed**; earlier focused5files/37 passed, followed by2 new cases included in final full run. Typecheck and final macOS arm64 debug **211.07MiB** build passed. Source verifiers206/23/2 and35/14/4 passed. Final binary SHA256 `359597848f681a0be31658256461641f3866589cd1e48226e2eb24c03fe3cf3c`. Logs `/tmp/m5-size-refresh-focused.log`, `/tmp/m5-size-refresh-types.log`, `/tmp/m5-size-refresh-final.log`, `/tmp/m5-size-refresh-final-build.log`. No Rust edit/native-unit rerun. New stats bundle not restarted/native-real-account accepted; currently running local hover package remains preceding evidence. **Real-account stats checks deferred** under user authorization.

This supersedes prior 'automatic list sizes not wired' development gap for Ali web; it does not prove all-provider stats or native account runtime. M5 remains active: cross-drive move identity reconciliation, retained provider contract gaps and complete native geometry/shortcut/menu gates still unaccepted. Local physical CRUD excluded by3.5, M6 not started. Electron main read-only: current external state now clean at7cd6d4c (previous concurrent dirty work changed externally); no Electron writes/commit/release performed here. Tauri remainsfeat/tauri-migration; Apple/Android unchanged.

## 2026-11-09: Original full directory-index, tree aggregation and cache methods migrated

Added original AliDirList.ApiFastAllDirList (simultaneous ascending/descending folder searches, original overlap completion) through a web-account-bound native port. Original request shape/endpoints/body preserved. Native port validates fixed queries/request IDs, matched two-page receipts,drive identity,parent/name,size,count,cursors and conflicting overlap identity; rejects repeated cursor pairs instead of spinning. Owner/pane/lifetime guards reject late pages after source/account replacement. Open tokens cannot call this web-only index contract.

Copied original TreeStore TotalSize, GetDirSizeNeedRefresh and SaveDirSizeNeedRefresh with only declared export/import adaptation; verifier now **206 mappings/23 exact templates/2 assets**. Native cache data port installs a complete root-linked directory graph, rejects duplicate/orphan/cyclic/overdeep nodes, preserves valid direct-file cache for surviving folders and drops removed nodes, then invokes original recursive sum. Safe-integer aggregate overflow cannot replace existing totals. Account/drive namespaces are separate. Original refresh-age uses604800seconds and original relative timestamp epoch. No new full recursive file scan or replacement sum algorithm.

Focused **3files/28tests passed** including13 direct-size cases,7 original-index transport cases and8 cache/aggregate cases; typecheck and library verifier35/14/4 passed. Invalid-graph parameterized fixture was corrected after typecheck caught tuple spreading, so final tests explicitly assert missing-parent/cycle/duplicate error messages. Logs `/tmp/m5-size-index-focused.log`, `/tmp/m5-size-index-types.log`. No full frontend rerun,bundle rebuild,native-unit rerun or real-account query in this unused-kernel checkpoint. Last full frontend229/2248 and launched hover bundle remain earlier evidence.

**Not yet wired to automatic list updates**: source-browser background lifecycle scheduler, durable cache loading/saving/invalidation and ordinary row/sort publication remain next. Persist callback exists as a native adapter seam; it is not a claim of durable cache implementation. Requirement14 automatic-folder-size display remains incomplete. M5 active,real accounts deferred,M6 not started. Original Electron main remains read-only; no commit/release or Apple/Android changes.

## 2026-11-09: Original automatic-folder-size read kernel migrated; integration still pending

Read-only Electron source review confirms PageMain.ts waits50s then schedules backup/resource size refresh checks at10/15s, PanDAL.aUpdateDirFileSize uses a604800s cache age and30-folder chunks, and TreeStore stores direct-byte estimates then aggregates along its complete directory index. ApiDirFileSize searches direct children type=file,limit100,sizeDESC and does not follow next_marker. Its first successful read returns from inside its loop; do not assume one invocation reads every supplied folder. This is an original estimate, not an exact recursive byte count. Preserve the original function rather than replace it with unrelated recursive scanning.

Extracted original AliDirFileList.ApiDirFileSize by declared class-member transform into electron/providers/aliDirectorySize.ts; AST verifier203 mappings/23 exact templates/2 assets passed. New source-bound native read port sends the exact original web endpoint/body and prevents Open-token fallback. It binds account/pane/lifetime before and after IO, validates response size entries/count/cursor/safe sums, captures truncation, and calls the original function for a single real folder per read. A confirmed-response flag is mandatory: original catch can return its initialzero map on failure, which must not become a successfulzero estimate. Unknown/malformed/error responses do not update statistics.

**13 new focused tests passed**, typecheck passed. Coverage: exact body/direct sums,valid emptyzero,truncated first page without implicit extra scan,negative/string/unsafe sums/over100items/bad cursor/businesserror,unscoped request,Open channel rejection,same-ID owner replacement,stale lifetime and fresh retry. Logs `/tmp/m5-directory-size-focused.log`, `/tmp/m5-directory-size-types.log`. No full frontend rerun or app rebuild at this kernel-only checkpoint; last full frontend229/2248 and launched211.07MiB hover package remain previous evidence. No Rust edit/native-unit rerun or real account query.

**Automatic list-size feature still incomplete**: native directory-index loading, original TreeStore aggregate/cache update logic,background lifecycle schedule and row/sort refresh are not yet wired. Do not mark requirement14 satisfied by this reader, accepted hover preview or folder-properties statistics. M5 active,real accounts deferred,M6 not started. Electron main untouched/read-only with same4 concurrent dirty files. No user-file mutation,commit/release or Apple/Android changes.

## 2026-11-09: Original folder hover preview integrated; user confirmed native display

Requirement14 audit found folder preview missing from Tauri (cancelFolderPreview was a no-op, also in current Electron PanRight); copied the existing Electron FolderPreviewPopover.vue directly, retaining its exact template/styles,450ms hover delay,180ms leave delay,12-item cap,6s default auto-hide and panel-enter pause behavior. Copied original folderPreview cache wrapper (five-minute TTL and concurrent promise reuse); adapted provider IO to source-bound driver/native local listing and cache key to host/context/public-account identity. Source host delegates original list/grid row hover through original selection-index mapping; file clicks/drag/scroll/context menu/navigation/dialog/source changes cancel the preview. Existing original PanRight template and interaction handlers untouched. Added original IconFont local registration and CSP bridge for unchanged inline preview image fallback. Read-only preview does not change current path/selection or write user files.

Final frontend **229 files/2248 tests passed**,39 focused manager/image-error tests. Typecheck and macOS arm64 debug **211.07MiB** build passed. Files verifier **202 mappings/23 exact templates/2 assets**; library35/14/4 passed. Original preview component/helper snapshots include per-file source commitcf3059e3b89cd27eb1a3075a1f311d57c4b31688. Tests cover450ms gating,12 cap,short hover cancellation,180ms hide/cache reuse,disabled preference,late result after source change,same-ID owner cache isolation and CSP fallback. Logs `/tmp/m5-hover-focused.log`, `/tmp/m5-hover-all.log`, `/tmp/m5-hover-build.log`. No Rust edit/native-unit rerun.

Exact bundle restarted via native Quit, observed oldisRunning=false; new binary SHA256 `8be657758393d777fd9a9fd41428514805deb7015ba02dc574586f2c410fb823`. Native tools verified Mac/testVideo loads21entries. CUA exposes no pointer-hover API; zero-page scroll was rejected and not treated as hover. User was asked to hover calibration for~half a second and explicitly confirmed **“正常弹出预览”**. Record this as user-observed native preview display for this local folder, not remote-provider preview acceptance or full geometry/auto-hide matrix. No real accounts used. Current package left open onMac/testVideo.

M5 remains active: remaining provider/identity reconciliation and complete native shortcut/menu/geometry gates not yet fully accepted. Real-account checks deferred; M6 not started. Local physical CRUD remains excluded by inventory3.5. Electron main preserved/read-only with concurrent dirty files, no commit/release or Apple/Android changes.

## 2026-11-09: Native cancel-selection→Cmd+F/F3 focus gate accepted

The preceding013f4a package was tested with actual coordinate row/cancel clicks after rebinding; cancel left AX focus on HTML and following Cmd+F/typing did not reach filter. This confirms the earlier behavior was not solely AX activation. Vue nextTick-only recovery was insufficient on this native path. Host recovery now runs after the Vue removal flush and on requestAnimationFrame, retaining source/lifetime/disconnected-control/new-focus guards. Original Electron templates and handlers remain unchanged. Component regressions explicitly wait the frame and prove keyboard recovery plus preservation of newly acquired input focus.

Final frontend **229 files/2243 tests passed**,28 manager tests; typecheck and macOS arm64 debug **211.07MiB** build passed. Source verifiers200/22/2 and35/14/4 passed. Logs `/tmp/m5-selection-frame-focused.log`, `/tmp/m5-selection-frame-all.log`, `/tmp/m5-selection-frame-build.log`. No Rust edit/native-unit rerun.

Native Quit→observedisRunning=false→exact new bundle launch completed. Executable SHA256 `a047226ef4280f5ad54b9deab310d63e287bd2098f8cf533e50488714e790df3`. New package Mac/testVideo loaded21entries. Original row-button selection then cancel left focused UI element source-browser container; subsequent Cmd+F and typedM5-frame-focus changed filter value and displayed0/0/empty state. Cleared input with Cmd+A/Backspace, restoring0/21. Repeated from a focused input: select row→cancel→F3→typeP8.4 changed actual filter value and displayed0/5 under original fuzzy rules. Cleared back to0/21; left source browser/filter open. This supersedes the prior unresolved cancel→shortcut gate for these native AX-activation paths; final true-coordinate repetition encountered toolnoWindowsAvailable and was not accepted. ScreenCaptureKit-3812/noWindowsAvailable recovered by rebinding the same running app; no restart was done solely due observation failures.

M5 remains active: full native shortcut/menu/geometry matrix and cross-drive/provider gaps still require separate evidence. Real accounts deferred; M6 not started. No user-file write, real provider operation, clipboard export, Electron main change, commit/release or Apple/Android changes.

## 2026-11-09: Selection-control focus restoration regression; native gate still open

Native existing-app checks confirmed selection counts1→3→4 for single/Shift-range/Command-add, then cancel→0/21. Direct filter input with unmatched text showed0/0 and original empty-folder text; Cmd+A/Backspace in input cleared text and restored0/21 without leaving directory. A subsequent cancel-selection→Cmd+F sequence did not focus/type into filter through AX action. Reproduced lost focus in a mounted-original regression (outside focus, click original cancel button, button unmounts); it failed before host fix. Host capture now checks removed original button.qujian after Vue update, restoring source focus only if lifetime unchanged and no new control gained focus. Two nextTick boundaries are required because capture precedes original handler/render scheduling. Test also proves a newly focused input is not stolen. Original templates/function bodies untouched.

Final frontend **229 files/2243 tests passed**;28 manager cases. Typecheck and macOS arm64 debug **211.07MiB** build passed. Source verifiers200/22/2 and35/14/4 passed. Early first-fix subset/full runs failed because focus check preceded unmount; final logs `/tmp/m5-selection-focus-final.log`, `/tmp/m5-selection-focus-build.log` supersede them. No Rust edit/native-unit rerun.

Native Quit followed by observed isRunning=false, then exact final bundle opened. SHA256 `013f4a4172dbae41d8933ad6171748e6cd565dac0551adac5ef3b004bf6b51af`. Final package loaded testVideo21entries and real coordinate row click focused source host. However AX cancel→Cmd+F→typed text still produced no filter value; subsequent true-coordinate cancel attempts twice returnednoWindowsAvailable despite rebinding same still-running app. Thus **native cancel→shortcut gate is NOT accepted** and needs investigation of AX activation versus physical click and/or actual remaining focus bug. Do not mark it fixed from DOM tests. Left app onsource manager/Mac/testVideo0/21, clear filter. New Open favorites code is now in launched package but no real account tested.

M5 active; M6 not started. Cross-drive identity reconciliation and remaining provider/native geometry/shortcut/menu gates remain. No real-account or user-file mutation, clipboard export, commit/release or Electron main write. Apple/Android excluded from this Tauri-only host change.

## 2026-11-09: Ali Open favorites connected to retained original UI

Closed an actual adapter gap: original menus classified both Ali channels as Ali accounts, while favorite/list/clear host ports accepted web accounts only. Open accounts now have the favorites navigation entry and can use the original menu favorite/unfavorite and original clear-first-page loop across drives. No Electron component template or extracted original function body changed. Original favorite-list recipe is adapted at its HTTP boundary to POST openFile/starredList with drive_id/marker/limit/order_by/order_direction; web retains its original custom-index endpoint/body. Open favorite update uses get→update(starred)→get with original file parent/type/name identity checks; no web credential fallback. A retry skips update when detail already has the requested starred state. No delete request or catalog deletion is used to clear favorites.

Protocol reference: official SDK pinned source [AliyunpanFileScope](https://github.com/alibaba/aliyunpan-android-sdk/blob/7a1f62c1d657372d52603eccf7a219aa9a947069/opensdk/src/main/java/com/alicloud/databox/opensdk/scope/AliyunpanFileScope.kt), GetStarredList / UpdateFile / GetFile. This proves SDK request contracts, not current real-account permissions or production success. Owner/lifetime checks cover root discovery, list response and every Open update/readback boundary; same-ID account replacement cannot update current UI or submit the next request. Repeated/non-starred list rows and unconfirmed updates fail visibly; partial clear preserves remaining entries. Foreground verification only, not durable task recovery.

Final frontend **229 files /2241 tests passed** (includes13 Open and8 existing web favorites cases). Typecheck and final macOS arm64 debug bundle **211.07MiB** passed. Source verifiers200 mappings/22 exact templates/2 assets and library35/14/4 passed. Logs `/tmp/m5-open-favorites-focused.log` (earlier20-case subset), `/tmp/m5-open-favorites-final.log`, `/tmp/m5-open-favorites-final-build.log`. No Rust source edit/native-unit rerun. Bundle not restarted or real-account verified in this checkpoint; current running instance is not assumed to contain these changes.

**M5 active; real accounts deferred; M6 not started.** Cross-drive identity reconciliation, remaining retained provider contracts and complete native840px/keyboard/menu gates remain unaccepted. Local physical CRUD excluded by inventory3.5; M7/M8 features and M6 engine not added. Electron main is read-only: current concurrent dirty work includes MediaLibrary.vue, openfile.ts, seekThumbnailPreview.ts and MediaServerWorkspace.vue; none modified here. Tauri branch remains feat/tauri-migration. Apple/Android unchanged because this is a Tauri-only adapter migration. No user-file mutation, remote account request, commit or release performed.

## 2026-11-09: User confirmed testVideo remains usable during inspection timeout

User answered the menu-fix package inspection question: “列表正常显示且能操作”. Record this as user-observed local file-list rendering and interaction acceptance. The background sampling/GUI-tool timeout alone does not establish an application directory-opening hang. This confirmation does not establish remote-provider operations, exact 840px geometry, or full M5 completion. Real-account checks remain deferred; M5 active, M6 not started. No application code or Electron main changes in this checkpoint.

## 2026-11-09: Mouse-selected row focus fixed; native navigation and nested property/tree menus verified

Native inspection first confirmed Cmd+Q starts original range selection without quitting the app, and Cmd+H returns calibration→testVideo without hiding it. No native menu rewrite was needed. Enter then failed to enter a mouse-selected folder in that preceding8b5569 package while both fixture-list and real Arco-list Enter tests passed. Added a focused reproduction that leaves DOM focus outside the browser before mouse-only row selection; it failed before the host correction. SourceDriveManager now focuses its keyboard host on captured clicks in original file/grid rows and selection buttons, without scrolling. Other interactive descendants (filter/toolbar/favorite/links etc.) keep their focus. Original file-open helper and all component templates remain unchanged. This closes the WebKit button-focus/navigation-destroys-old-row gap rather than rewriting original keyboard behavior.

Added regression covers outside-focus row click→Enter, Enter/Backspace/F5, actual Arco virtual list with multiple entries, and filter/favorite/toolbar focus isolation. Focused **29 tests passed**; full frontend **228 files/2228 tests passed**. Final app build includes successful typecheck/Vite/native bundling **211.07MiB**. Source verifier200 mappings/22 exact templates/2 assets; library35/14/4 passed. No Rust edits/native-unit rerun. Logs `/tmp/m5-row-focus-{before,focused,all,build}.log`, plus `/tmp/m5-navigation-focused.log` and `/tmp/m5-real-list-navigation.log`.

Final exact bundle restarted after native Quit and observing old process stopped. Executable SHA256 `a8a5bffccae7545522e2d3a264f2dd529bbd3b61ffa54327659a146c5bb5594d`. Native final-package checks: clicking calibration selection focuses source browser; Return enters calibration4entries; Backspace returns testVideo21entries; F5 retains normal21-entry list/no error. Right-click local video shows original Properties/More menu; Properties opens above source manager with actual142.65MB/date/name; Escape closes only Properties. Context-menu Escape also leaves source manager. More submenu shows Copy filename/Copy directory tree; latter opens retained modal with selected filename and1file/0folders. Opened all3 dropdowns and inspected choices: Linux/Win10, files/folders, Unicode/ASCII/path. Those visible choices match current read-only Electron CopyFileTreeModal.vue lines324–344; no option was changed and no clipboard copy/download/file write was executed. Closed tree layer and cleared selection; left source manager/testVideo0/21.

IntermittentnoWindowsAvailable during submenu click recovered by rebinding same running app; rechecked screenshot before continuing. Native menu/screenshots are subset evidence, not all remote-provider menus or exact logical840px measurement. Cmd+Q/H observations were on preceding8b5569 package; finala8a5bf runtime proves focus/navigation/property/tree subset above. No real account/login/provider mutation/user-file changes. **M5 active, real accounts deferred, M6 not started.** Cross-drive move identity reconciliation and remaining retained provider/native gates are not accepted; local physical CRUD remains excluded by section3.5. Electron main remains read-only with same3 concurrent dirty files; Android/Apple unchanged for this Tauri-specific host fix.

## 2026-11-09: Original row keyboard routing fixed; final-package native keyboard and four-task pages accepted

SourceDriveManager previously exempted every focused button from unmodified navigation keys, unintentionally bypassing original PanRight row-selection handlers. Narrowed that exemption for original `.fileitem button.select` / `.griditem button.select`: direction keys/Space/Enter/Escape now reach original helpers from these row controls. Toolbar/menu/favorite buttons keep their own activation/navigation; input editing remains excluded. No original component template or helper body changed.

Added meaningful regression: original row-select button ArrowDown selects next file, Space focuses quick filter, Cmd+F/F3 focus actual placeholder input, favorite does not forward into drive keyboard store, existing toolbar-key checks remain. Before fix row-arrow test failed. Initial focus assertions targeted a hidden select input, corrected to actual quick-filter input; favorite Space may be prevented by Arco itself, so assertion checks no drive-store forwarding. Focused25 passed; final frontend **228 files/2224 tests passed**. Initial build caught test DOMElement.focus typing; corrected with HTMLButtonElement type assertion only. Final app build includes successful typecheck/Vite/native bundling **211.07MiB**. Source verifier200 mappings/22 exact templates/2 assets; library35/14/4 passed. No Rust edits/native-unit rerun.

Final exact bundle restarted through native Quit after observing old process isRunning=false. This runtime now includes earlier share-owner/web-move/original123-batch code, but those provider behaviors remain fixture-only and real-account deferred. New-package local runtime:21testVideo entries loaded; row selection ArrowDown from4KAV1HDR1040M visibly selected50M and scrolled it into view; Space and Cmd+F focused quick-filter in AX; F3 from a different selected row focused input and following P8.4 text updated filter; cleared back to21/no selection. Earlier Cmd+F/F3 native uncertainty is superseded by this final-package observation. Prior package also verified Cmd+A21/21, range button start/end selected3/21, reverse18/21, cancellation0/21. Do NOT claim full Cmd+Q/H or full shortcut matrix.

Also completed previously missing native four-task-tab gate in this final package: source manager→Transfer file→Downloading, Downloaded, Uploading, Uploaded all screenshot-inspected with matching selected tab/title/toolbars/empty state. AX exposes hidden task panes together and reports no diff on switching; screenshots establish actual visible state. Original-pixel coordinates corrected the prior inability to switch combined AX tab labels. Closing task layer retained source manager/testVideo. Zero jobs/controller; no upload/download engine or user file operation. M6 unchanged/not started.

Bundle executable SHA256 `8b55694377b2c06515659e04199cfa3af4c30df525a3147c34214826771a38ad`. Logs `/tmp/m5-row-keyboard-{before,focused,all,build,final-build}.log`; evidence `evidence/m5-row-keyboard-native-2026-11-09.json`. Test-only type assertion came after full run; final build typechecks it, no runtime behavior change. Full native840px logical geometry, remaining shortcuts/nested menus/provider operations and cross-drive identity reconciliation remain unaccepted. Local physical CRUD remains excluded by section3.5. Real accounts deferred; **M5 active, M6 not started**. Electron main read-only with same3 dirty files preserved; Apple/Android unchanged for this Tauri host adaptation.

## 2026-11-09: Ali web same-drive move synchronization and native six-sort/layout checks

Preserved original ApiMoveBatch/ApiBatchMaker and nested Cmd+X directory picker. Web transport now retains accepted move receipts until catalog acknowledgement (copy still releases its verification receipt immediately). On local catalog save failure the original row/selection metadata remains unchanged, the command reports failure, and explicit retry rereads actual destination detail before synchronization without repeating the move POST. Guarded web catalog write now checks exact public owner/lifetime like Open. Receipts bind original file identity/owner; changed target parent/type/trashed state cannot be promoted to success. Matched definite4xx subrequest rejection permits explicit corrected retry; missing/ambiguous reply remains non-replayable. This is bounded foreground receipt handling, NOT durable/process-restart recovery or a transfer queue.

Final focused **3 files/24 tests passed**: original web/Open picker, file/folder moves, server autorename, manual title/progress/descendant ancestry preservation, catalog failure retry, delayed owner replacement, receipt acknowledgement, changed remote target and definite rejection. Initial typecheck exposed optional-session narrowing errors; added explicit presence checks, final build typecheck passed. Final frontend **228 files/2221 tests passed**. Source verification200 mappings/22 exact templates/2 assets; library35/14/4 passed. Final macOS arm64 debug **211.07MiB** bundle built; no Rust source change/native unit rerun. New bundle not restarted; no real account/remote write acceptance. Logs `/tmp/m5-ali-web-move-{focused,final,final-build}.log`.

Native UI checks on the already-running preceding211.05MiB package (local read-only list, not latest network code acceptance): all six sort options actually clicked, displayed label and reordered rows read after each. Size descending starts527.2/351.5/307.0MB; ascending begins10.7MB; time ascending putsNov3 entries beforeNov6, descending reverses that date ordering. Name descending starts1080p HEVC entries, name ascending returns4K AV1 entries (original numeric ordering); folders stay first. List/thumbnail/bigimage screenshots inspected: default thumbnail3cols/bigimage2cols. Actual macOS Window→Move&Resize→Left screenshot showed source toolbar/list within narrowed window, long names wrap; thumbnail mode also visible. Restored list/name-asc and Window→Return to Previous Size, confirmed21 entries/no selection. Source manager left open ontestVideo. This supersedes earlier 'sort choices only, no actual selection' gate for this local package; not a full keyboard/multilayer/hover-provider acceptance or independent840px logical-width measurement.

CUA screenshot is JPEG2320x1560 when displayed1903x1280: coordinate targets require original-pixel scaling. Using corrected coordinates enabled actual hover-menu selection without changing trigger behavior. IntermittentnoWindowsAvailable/-3812 recovered by rebinding the still-running app (not restarting). No files/accounts/favorites changed; temporary layout/sort/window settings restored. Structured evidence `evidence/m5-native-six-sort-layout-2026-11-09.json`.

Cross-drive move remains incomplete and write-blocked. Official Alibaba Aliyunpan SDK scope documents a MoveFile toDriveId parameter (https://alibaba.github.io/aliyunpan-android-sdk/opensdk/com.alicloud.databox.opensdk.scope/-aliyunpan-file-scope/index.html); it does NOT establish the descendant-ID mapping or catalog/position/favorite reconciliation required here. PDS references/search results were not used as an Alipan protocol substitute. Do not claim vendor lack of support. Scope correction remains: local physical CRUD is excluded by section3.5, not a completion gate. **M5 active; remaining retained-operation gaps and complete native UI gates remain; real accounts deferred; M6 not started.** Electron main untouched with the same3 concurrent dirty files; Apple/Android unchanged.

## 2026-11-09: Share sessions bind original account identity; source-scope correction reaffirmed

Fixed retained original share-dialog native session: capture public account metadata when the session is created, and require both pane account and stored account to match it at every existing lifecycle check. Same-ID replacement now rejects before a request, after pending results, before later Google permission/Dropbox setting/Ali title mutations, and before reuse of cached links or clipboard-delivery retries. No original template/request builders changed. Native credential rotation without a public owner change is outside this public-metadata guard; an already submitted remote share is not rolled back.

Focused **66 tests passed**: nine provider pre-submit substitution cases, multi-step Google/Dropbox/Ali boundaries, stale Ali cached receipt and mounted original dialog clipboard/remaining-file checks. One initial existing123 fixture mutated userId inside an active session; corrected it to dispose/reopen a new session, preserving missing UID and incomplete receipt assertions. Final full frontend **227 files /2211 tests passed**. Typecheck passed within final build; files provenance200 mappings/22 exact templates/2 assets, library35/14/4. macOS arm64 debug **211.07MiB** app built. No Rust changes/native unit rerun; latest bundle not restarted/runtime accepted. No real share creation/account login/user-file operation. Logs `/tmp/m5-share-owner-{focused,all,build}.log`.

**Scope correction (authoritative section3.5, already recorded2026-11-08):** local physical create/rename/move/copy/delete/journal expansion is NOT an M5 completion requirement. Current local action guard intentionally rejects it; native write prototypes are test-only. Earlier Nov9 checkpoint phrases demanding remaining local path reconciliation are stale and superseded here. Do not reopen local CRUD as a migration task. Preserve existing recovery of any already-created development journals. Local retained scope is browsing/preview/library; download-copy execution belongs toM6. Native media-server management remains browse/play/download/favorites only. Plan maps#110 nonvideo open toM7,#117 AI toM8,#115 library toM4; these are not missing M5 implementations.

M5 still requires provider-capability/source-aligned retained operations and complete native840px/narrow/menu/keyboard acceptance; hiding unsupported ports is not proof. Ali cross-drive move still explicitly rejects before submission; Open recycle list/restore/delete contracts remain unestablished, not asserted vendor-unsupported. Real accounts deferred, M6 not started. Electron main read-only, same three dirty files preserved; Apple/Android unchanged for this Tauri-specific session adapter.

## 2026-11-09: Original 123 aggregate rename protocol restored; local runtime subset verified

Supersedes the earlier sequential-batch adaptation below. Extracted **Cloud123RenameResult and apiCloud123RenameBatch directly from the existing Electron snapshot**, with only declared native account/fetch replacements. Original aggregate POST `/api/v1/file/rename` and `renameList: ["id|name"]` construction retained and AST/source hash verified. Original batch-dialog template, preview and partial-success selection logic retained. Single-file rename continues its original PUT route. Bound native scope rejects unowned/mismatched aggregate requests and checks lifecycle around POST; all input IDs/names and actual detail identities are preflighted before the batch write. Names containing wire delimiter `|` reject before requests.

The adapter does not trust the original method's inferred all-success/empty-parent/file-type results: postflight detail verifies every actual ID/parent/type/name and returns only confirmed items. Explicit retry omits rows already at the desired name; original modal partial successes are removed from checked rows and failures stay checked. Catalog synchronization remains guarded and retryable without repeating confirmed remote writes. Foreground-only recovery; no process-restart/durable rename journal or remote rollback claimed.

Final frontend **227 files /2195 tests passed**. Includes original batch modal submit/partial-selection/retry and 10 dedicated original protocol cases. Initial added modal fixture incorrectly used `applyto='all'`; corrected to original enum `full`, then focused4 and full227/2195 passed. Typecheck passed; source verifier **200/22/2**, library **35/14/4**. Final macOS arm64 debug app bundle **211.07 MiB** built. No Rust changes or native-unit rerun. This latest bundle not restarted; account HTTP remains deferred.

Native runtime separately restarted the **preceding211.05MiB** package via exact bundle after observing old process not running. Home→Files→Add source→Mac→testVideo yielded21 visible items and screenshot. P5 filtering returned3 entries, select-all3/3 and cancellation0/3 passed. Sort popup AX contained all six choices; no actual sort-option selection acceptance. Screenshot service -3812 occurred on sort click but subsequent AX confirmed open popup. Escape had -3811; subsequent AX showed source modal closed, so menu-only Escape behavior remains unaccepted. This does not establish exact840px measurement/narrow/full nested/keyboard matrix or latest cloud protocol behavior. No real account/file mutations/settings seeded.

Evidence: `evidence/m5-local-controls-runtime-2026-11-09.json`, `evidence/m5-123-original-batch-2026-11-09.json`. Logs `/tmp/m5-123-original-{batch-final,batch-build,batch-types,modal}.log`. Electron main remains read-only with the same three concurrent dirty files preserved. Tauri-specific migration only; Apple/Android apps unchanged. **M5 active; remaining provider/local reconciliation/native UI gates unfinished; real accounts deferred; M6 not started.**

## 2026-11-09: 123 original batch-dialog port connected

Removed the production `apiCloud123RenameBatch` placeholder. The unchanged original RenameMultiModal now dispatches to the account-bound renameBatch host. Native adaptation deliberately uses the already migrated original single-file PUT method sequentially, not the original aggregate POST endpoint, whose acknowledgement inferred success for every input and returned empty parents/file types. No original dialog/template/preview/selection algorithm changed; this checkpoint does not claim source-identical batch HTTP protocol.

Each item checks actual detail identity/parent/type/current name before mutation and verifies final detail afterward. Already-desired names recover local synchronization without another PUT. Only verified successes return; partial failures remain available to original dialog handling. Exact public account, source generation and owning dialog are checked across awaits. Catalog save failure returns no successful rows, defers host metadata changes, and allows explicit retry; stable media IDs/manual titles/progress remain intact. Already-submitted remote writes are not rolled back. No durable operation journal/process-restart recovery established.

Verification: frontend full **226 files /2183 tests passed**, followed by final added dialog-close lifecycle regression **3/3 host tests passed** (full run preceded that one test-only addition). Focused provider/host suite 28 passed before added lifecycle case. Typecheck passed; source verifier **200 mappings /22 exact templates /2 assets**, library **35/14/4**. macOS arm64 debug **211.05MiB** app bundle passed. No Rust changes/native unit rerun. New bundle **not restarted or runtime-accepted** this checkpoint; current app remains previous bundle. No real account/login/remote write/user-file changes. Electron main read-only; its three existing dirty files preserved. Android/Apple excluded from this Tauri-specific adapter change.

M5 remains active: other retained provider operations, local durable path reconciliation and complete 840px/native menu/keyboard gates remain unfinished. Real accounts deferred; M6 not started. Logs `/tmp/m5-123-rename-{focused,final,lifetime,types,build}.log`.

# Tauri 迁移进度

## 2026-11-08: Ali Open move-to-trash original command integrated

Original ApiTrashBatch/ApiBatchMaker/ApiBatchSuccess body construction and Delete keyboard/menu chain retained; only native account guard adapted to isolated Open accounts. Fixed Open `get` preflight checks the actual selected ID/drive/parent/name/type before `recyclebin/trash`; optional async_task/get must finish before postcondition confirms trashed detail or explicit404 file-not-found. Endpoint reference is the local Apple provider's existing trashItem, not PDS API documentation. No Open token goes to web APIs, no share token accepted. Open list/restore/permanent/purge/empty remain unimplemented: no authoritative contract established this turn; do not infer vendor absence or implement guessed endpoints.

Foreground receipt prevents duplicate mutation after network ambiguity, continues only the original accepted task, and retains verified result through catalog failure. Original row/selection stays for explicit synchronization retry; catalog commit/lifecycle guard must succeed before receipt acknowledgement and row removal. Known quota/auth rejections allow explicit re-preflight/retry without automatic POST retry. Web route also rejects same-ID account replacement and cannot reuse pending receipts under another owner. Receipts are not durable mutation journals; restart/closed-source reconciliation and other response codes remain acceptance gaps.

Focused **3 files/35 tests passed**; final full frontend **224 files/2169 tests passed**. Typecheck/source checks passed:200 mappings/22 exact templates/2 assets, library35/14/4. Final macOS arm64 debug **211.05MiB** build passed. Initial added folder test fixture changed file variable without updating pane.file mock; corrected the fixture and reran focused/full successfully. No Rust implementation changes/native unit rerun; previous196/10 is historical. Final exact bundle restarted after observing prior process isRunning=false; native Home→Files→Add source navigation passed and source manager left open. This startup check does not accept Open HTTP/delete/native account behavior. No real accounts, remote file deletion, account login or user-file modification.

Other M5 provider operations and complete native UI/keyboard/menu/geometry gates remain pending. **M5 active; real accounts deferred; M6 not started.** Electron main read-only; concurrent dirty work preserved.

See [evidence](evidence/m5-ali-open-trash-2026-11-08.json).

## 2026-11-08: Ali web editor-text protocol integrated

Connected original unchanged text dialog to `aliText.ts` and registered native `ali_text_create`/`ali_text_cancel`. The previous protocol-only/no-command/no-UI limitation is superseded. Aliyun **web** memory-text capability now enabled for actual read resource/backup drive roots or folders; synthetic account root rejects. Native account metadata must match stored account, session prepares before credential binding, every subsequent step checks public identity/vault header+refresh binding. Fixed API endpoints use native vault credentials; create proof derives from the exact prepared Authorization header. Signed PUT is restricted to issued validated storage destinations, without account Authorization/Cookie. Original400/429 complete retry retained; no blind create retry, destructive cleanup or optimistic success. Final details validate full identity/name/size/SHA1, and frontend checks the public receipt.

Bounded transient cancellation registry handles cancel-before-start, per-account concurrency and main-window ownership. Frontend scope cancellation covers dialog close, source transition, unmount and same-ID account replacement. Old/late results cannot update another context. Already-sent remote operations are not rolled back: failure/cancel requires refresh to inspect actual server state. Credential/session replacement during operation conservatively aborts later steps; durable mutation resume/journal is not implemented. This is one-editor-document mutation, not M6 task engine/persistence. OpenAPI accounts remain separate, not enabled/fallen back to web by this change.

Final full frontend **222 files/2148 tests passed** (includes added source-switch test); focused initial16 tests. Native focused28 passed; **full native196 passed/10 existing ignored/0 failed**, using local-loopback-capable test execution and synthetic/temp state only. Final typecheck and macOS arm64 debug **211.05MiB package passed**, includes Vite/native link. Source verifier200 mappings/22 exact templates/2 assets; library35/14/4. Native test initially caught invalid test fixture use of caller-assigned account IDs; fixed fixture to use Accounts.save-generated IDs, final results above. No real account/token/provider write/user file operation. New package not restarted; no Ali text native-runtime acceptance this turn. Existing Apple signed-part helper inspected as local reference only; no Apple/Android/Electron writes.

Real provider/session/signed-destination/upload validation remains deferred. Remaining M5 provider operations and complete native UI gates continue. **M5 active, real accounts deferred, M6 not started.** Electron main read-only; same three concurrent dirty files preserved.

See [evidence](evidence/m5-ali-text-integrated-2026-11-08.json).

## 2026-11-08: Ali editor-text native protocol kernel (not wired)

Ported the original Electron UploadMem/GetBuffHashProof/createWithFolders/complete protocol into native `ali_text_protocol.rs`: SHA1/proof, UTF-8 byte length, original part sizing, refuse-conflict body, receipt/destination validation, drive/folder preflight and create→all PUT parts→complete→verified file detail workflow. No general M6 engine, tasks or persistence. Protocol corrections explicitly differ from original bugs: failed PUT stops before complete; empty file does not index missing first part; >10MiB editor content uses every original part; root substring IDs are not rewritten; rapid upload still requires authoritative file metadata/hash; conflict/cancel never causes automatic delete/overwrite/blind retry. Types containing issued URLs have no Serialize/Debug.

**19 focused native tests passed**,178 other native tests filtered out. ASCII/unicode proof fixtures were generated by executing the original Node crypto algorithm with fake tokens; synthetic TextIo covers success/failure/cancel/conflict/drive membership/empty/multipart sequencing. No live provider/account/token/user-file operation. Original three source snapshots and Rust adaptation hashes added to provenance manifest; this is an explicit native protocol port, not byte-identical TS reuse.

**Not user-available:** TextIo has no production vault/session/HTTP implementation, native cancellation registry, account-lifetime binding or renderer command; original text dialog and supportsRemoteTextCreation remain unchanged and Ali stays disabled. Need those integrations before testing the real flow. No new app bundle, runtime, full native regression or frontend test rerun this turn. M5 remains active; real accounts deferred; M6 not started. Electron main read-only; concurrent dirty work preserved.

See [evidence](evidence/m5-ali-text-protocol-2026-11-08.json).

## 2026-11-08: Original four-task workspace now connected

Completed original `DownDowning.vue`/`DowningStore.ts` presentation and original `down/index.vue` four-page navigation, including original sidebar/layout CSS with native namespace scoping. Only explicitly excluded plan rows23/24/25/28 nodes are removed: aria-only detail, BT/torrent/URL/drop surfaces, Sync/M3U8 panes. Start/pause/delete/priority commands now use native interfaces without old aria/Dexie or optimistic task-state mutation. Added M5 row99 transfer entry in source manager; opens a declared840px nested task window using original four-page shell. Earlier task-page “not navigable” limitations are superseded by this actual integration, not by engine completion.

Initial native screenshot revealed missing icons because original Electron global IconFont registration was not present. Added explicit original IconFont imports in all task views/shell and actual-SVG component assertions; rebuilt/restarted final explicit210.75MiB bundle only after observing old isRunning=false. Final native screenshot (after Window→BoxPlayer Dev redraw) shows sidebar/toolbar icons. Start All visibly reports service unavailable and leaves zero tasks. macOS actual Move & Resize→Left screenshot shows downloading toolbar/filter wrapping inside window and visible close button; previous size restored; closing task window retained source manager. These are native subset checks, not complete four-page/menu acceptance: coordinate tab click failed ScreenCaptureKit-3811 and AX combines the four labels. Four-page switching is covered by mounted tests; no real tasks/accounts or file modifications. Width840 is declaration, not independent pixel measurement.

Full frontend **221 files/2139 tests passed before final icon imports**; final focused2 files/8 tests passed with real icons. Final package build includes typecheck/Vite/native bundling and passed; source verifier196 mappings/22 exact templates/2 assets, library35/14/4. No Rust edits/native test rerun (168 passed/10 ignored is historical). Remaining M5 provider operations and complete native UI/keyboard/menu gates continue; actual execution/persistence/controllers remain M6. Electron main read-only; concurrent dirty work preserved. **M5 active; real accounts deferred; M6 not started.**

See [structured evidence](evidence/m5-task-workspace-2026-11-08.json).

## 2026-11-08: Original completed-download page (not yet navigable)

Migrated original `DownDowned.vue` exact template/scoped styles and `DownedStore.ts` presentation/selection/filter/statistics. Original deletion confirmation is retained verbatim: default record-only; explicit checkbox for irreversible local-file removal. Filesystem/database calls delegate to per-store `completedDownloadActions` and `downedTaskPorts`, bound only while host is alive. Cloud/remote/folder destructive file removal is rejected; partial failures retain records, successful backend changes trigger an authoritative reread, not optimistic pending-delete flags. Open/reveal passes record IDs, caps at original first ten requested records and does not treat cloud/remote tasks as local files. Closed confirmations and stale reads cannot invoke disposed controllers. Fixed original row-delete target bug without changing template. Original cloud source label and video extension predicate retained with renderer-only adapters; no aria/Node path/old database imported.

Focused **9 tests** and final full frontend **219 files/2131 tests passed**; typecheck passed after fixing a type-import name collision. Vite build passed with existing chunk/reka-ui warnings. Source verifier **191 mappings/23 exact templates/2 assets**, library35/14/4. Tests use synthetic records/controllers and original confirmation callbacks; no real files were deleted. No Rust changes/native regression/new native bundle/GUI acceptance. Task shell/main navigation remains pending; this page is not yet reachable in the application. Downloading page remains pending, and no native record controller/engine is installed. These boundaries are not native operation acceptance. Remaining M5 gates continue; real accounts deferred, M6 not started. Electron main and concurrent dirty work preserved.

See [evidence](evidence/m5-downed-page-2026-11-08.json).

## 2026-11-08: Original completed-upload page (not yet navigable)

Migrated Electron `DownUploaded.vue` with exact template and original styles, original `UploadedStore.ts` selection/filter algorithms, and only the two upload-record interfaces from `dbupload.ts` (no Dexie). `UploadedTaskPane.vue` isolates store and keyboard/mouse context. `uploadedTaskPorts.ts` binds record read/clear/open to an injected controller, passing record ID rather than renderer-supplied paths. No production controller/engine is installed. Original numeric range sentinel and per-row clear targeting bugs corrected; Meta selection adapted. Stale/closed-pane results, duplicate IDs and failed record clearing are covered; no optimistic removal.

Focused 7 tests and final full frontend **218 files/2122 tests passed**. Typecheck/Vite build passed (existing large-chunk and reka-ui useId warnings). Source verifier **186 mappings/22 exact templates/2 assets**; library35/14/4. No Rust edits/native tests/new native bundle or GUI acceptance. This and the uploading page remain unreferenced by main navigation; Vite build does not establish task entry/chunk/runtime completion. Downloading/downloaded original pages and original task shell/entry remain pending. Local open/reveal/cloud locate controls are controller interfaces, not real native operation acceptance. Real accounts deferred, M5 active, M6 not started. Electron main cf3059e not written; three concurrent dirty files preserved.

See [evidence](evidence/m5-uploaded-page-2026-11-08.json).

## 2026-11-08：阿里开放移动/复制接线检查点

- 原同盘移动、同/跨盘复制与Cmd+C/Cmd+X目录选择器已接；开放任务终态后核对目标，移动的catalog失败原目标重试不重复POST。跨盘移动身份对账仍拦截，真实账号/新包实屏及完整矩阵后置。
- 206文件/1987项前端测试、类型检查、来源校验及macOS arm64 debug包210.55MiB构建通过；无Rust修改，168通过/10忽略为原生历史基线。
- [详细验收记录](m5-validation.md)与[结构化证据](evidence/m5-alipan-open-relocation-adapter-2026-11-08.json)。Electron main只读，未提交/发布，M5 active，M6未开始。

## 2026-11-08：阿里独立开放账号原重命名链路

- 原 Electron ApiRenameBatch、批量body builder、单项/批量模板和命名算法保留，仅将该声明账号guard及底层端口适配独立开放账号。网页账号仍发原adrive/v4/batch，开放账号仅发固定openFile/get→update→get；不混用令牌或回退网页接口。原返回isDir表达式倒置继续保留，通过已有native wrapper按已读取真实类型核对，不为迁移修改原算法。
- 固定OpenAPI路径据本机CloudServiceKit原renameItem/attributesOfItem，update的check_name_mode=refuse同时与[Apache OpenDAL原实现](https://nightlies.apache.org/opendal/opendal-docs-release-v0.47.1/docs/rust/src/opendal/services/aliyun_drive/core.rs.html)核对，保留原冲突拒绝语义。提交前验证原ID、盘、父目录、名称和类型，提交后重读实际详情；只凭update成功或异步回执不报告完成。明确拒绝项不计入原successList，批量继续其他项。
- 新增命令作用域，把调用方generation检查透传到原异步每一步；pane/context、同ID账号公开身份变化后停止后续请求。独立开放账号的宿主catalog事务亦绑定发起身份，防止迟到重命名写入新页面。已发出的请求不因此回滚，未知结果/跨应用重启恢复仍未完整闭合，不能把本轮作用域当持久化日志。
- 新增15项协议与3项原组件回归：原单项弹窗、原批量编排的部分成功、冲突/旧详情/错误父目录及类型、账号替换/窗口切换/调用方代际取消；稳定catalog ID、手工标题和播放进度保留。批量命名算法与模板沿用此前来源校验；本轮组件测试没有冒称完整批量规则弹窗的原生视觉验收。全部使用mock HTTP/来源，真实账号/真实IPC后置。
- 最终 **204文件/1965项前端测试通过**；定向3文件32项；单独及构建内typecheck通过；来源173映射/20模板/2资源及媒体库35映射/14模板/4资源通过；macOS arm64 debug app **210.55MiB构建通过**。沿用CLI `--configLoader native`。无Rust修改，未重跑原生测试，168通过/10忽略仍为先前基线。新包未重启/实屏。
- Electron main只读核对干净，HEAD9d5f831，Tauri为feat/tauri-migration；无真实账号或用户文件写操作，无提交/发布/播放器修改。开放通道移动复制/回收/分享导入、网页文本/跨盘身份及完整界面矩阵继续，M5 active，真实账号后置，M6未开始。

证据：`/tmp/m5-ali-open-rename-focused.log`、`/tmp/m5-ali-open-rename-types.log`、`/tmp/m5-ali-open-rename-all.log`、`/tmp/m5-ali-open-rename-build.log`；[协议与验收边界](evidence/m5-alipan-open-rename-adapter-2026-11-08.json)。

## 2026-11-08：阿里独立开放账号原新建目录链路

- 核对跨盘移动时确认原网页方法的跨盘身份对账仍缺；没有移除拦截冒充完成。另发现本机CloudServiceKit已有阿里OpenAPI createFolder/attributesOfItem协议，可作为底层通道适配依据：固定openFile/create与openFile/get，使用所选真实drive_id/parent_file_id。
- 原 Electron ApiCreatNewForder、原单项/日期序号目录表单及模板保留。仅将此声明的账号guard适配为支持阿里网页/独立开放账号；其他网页方法仍保留原网页账号guard，不把开放令牌转发给网页API。开放通道的native端口映射原创建语义到openFile/create，保留refuse，去掉网页专用空description；创建返回ID后读openFile/get确认盘/父目录/名称/类型/ID。网页通道既有请求体和单次请求行为不变。
- SourceDriveManager原能力交集接回独立开放账号新建目录；createAliFolder透传调用方生命周期并绑定当前pane/context及账号公开身份。账号/来源变化后不继续详情读取或更新原页面。仍要求已读到的实际资源盘/备份盘或盘内目录，不把账号UUID或虚拟账号首页当成物理盘。
- 新增13项协议与3项原组件回归，覆盖OpenAPI固定URL/body、资源盘/备份盘、真实ID回填和刷新、原Shift+Cmd+N/表单、配额失败保留表单并显式重试、错误详情和迟到账号/窗口切换。全部为合成HTTP/组件，未操作真实账号或用户文件。
- 最终 **202文件/1947项前端测试通过**；定向2文件29项；单独及构建内typecheck通过；来源173映射/20模板/2资源、媒体库35映射/14模板/4资源通过；macOS arm64 debug app **210.55MiB构建通过**。沿用CLI `--configLoader native`。无Rust修改，未重跑原生测试，168通过/10忽略为先前基线。新包未重启/实屏，不能据此认定真实授权或开放通道整体通过。
- 独立开放账号的重命名/移动复制/回收/分享导入、网页文本/跨盘身份、完整原能力及界面矩阵继续。Electron main只读且检查干净（外部HEAD9d5f831），Tauri为feat/tauri-migration，无提交/发布/播放器修改；M5 active，真实账号后置，M6未开始。

证据：`/tmp/m5-ali-open-folder-focused.log`、`/tmp/m5-ali-open-folder-types.log`、`/tmp/m5-ali-open-folder-all.log`、`/tmp/m5-ali-open-folder-build.log`；[底层协议依据与边界](evidence/m5-alipan-open-folder-adapter-2026-11-08.json)。

## 2026-11-08：本地浏览器实屏选择/布局与系统窄窗复验

- 原窗口未重启。通过系统“窗口→BoxPlayer Dev”（makeKeyAndOrderFront）激活后，截图恢复显示来源弹窗；进入testVideo立即显示21项。此前无障碍加载/旧截图不构成应用死锁证据。原生坐标点击和scroll仍返回noWindowsAvailable，而AX控件及键盘可操作；不能据此修改原hover菜单触发方式。
- 实屏确认三种原布局均能渲染并恢复列表；Cmd+A为21/21、取消为0/21；通过可访问复选框的Shift范围得到3/21；区间选择入口→第1项→第5项得到5/21，反选16/21，再取消0/21。Command/Control修饰点击在本轮操作的是复选框，不能扩大为原文件行修饰键组合已验收。
- 快速筛选“DV P5”由21项变3项，无匹配字符串为0项并显示原“空文件夹”，清空后恢复21项。进入calibration实读4项及面包屑，父目录返回恢复testVideo21项；双击进入过程中也新开了预览窗口，已仅关闭该新窗口，播放器代码未改。
- 使用macOS系统“移动与调整大小→左侧”检查窄窗口的列表/缩略图及工具栏，再用“返回先前大小”恢复原窗口；最终恢复列表、空筛选及0/21。长文件名会换行，部分日期在可见右边界截断，不冒称全部文本/嵌套弹窗完美通过。源码width=840仍保留，本轮没有CSS精确尺寸测量。
- 运行实例来自此前1908项的123批量复制候选，磁盘包后来已重建；没有据bundle文件变化假定运行中代码自动更新。因此这些证据不验证较后的文本作用域/123清空接口，真实账号仍后置。完整六排序、悬停预览/滚动分页、多层弹窗/全部快捷键及其他M5原能力继续。无源代码修改，未重复运行测试/构建；1931前端、168原生通过/10忽略与210.55MiB是上一代码检查点结果。本轮仅补实屏证据，不把该子集当M5整体完成。Electron main不动，M5 active，M6未开始。

结构化现场记录：[本地浏览器实屏子集](evidence/m5-local-browser-runtime-2026-11-08.json)。

## 2026-11-08：123 原全局清空回收站与固定网页端点

- 直接从 Electron 原快照提取 apiCloud123TrashDeleteAll，保留 POST `https://www.123pan.com/api/v1/file/trash_delete_all?t=...` 和 `{event:'recycleClear',RequestSource:null}`；仅替换renderer取token/fetch。原版使用getCloud123Token的同一账号凭据，未发明另一种网页登录或用单项永久删除循环替代原全局清空。新增AST声明校验，清空能力接回原toolbar/topTrashDeleteAll。
- native账号边界仅为已有 `https://open-api.123pan.com` 授权的123账号放行原固定网页POST路径和唯一数字t参数；不保存通用网页origin授权，不放行其他提供商/方法/路径/伪域/HTTP/userinfo/fragment/额外查询参数。鉴权保留native，renderer不获取令牌。前端端口另核对原请求体。
- 清空前沿用宿主完整回收站分页快照；原清空回执成功后重新读取回收站，仅在实际空且无后续游标时确认。来源/账号身份和页面代际每阶段核对；本机catalog同步亦绑定该作用域。未确认清空时保留原行及媒体库关联，不凭code=0清理。这里没有真实账号请求，原网页端点能否接受当前账号授权仍属于后置验收；未知结果不自动重试，若重做原清空操作仍是全局清空，不能当作快照逐项删除。
- 新增7项合成协议用例、2项原组件用例和1项Rust域名边界用例。定向2文件21项通过；原工具栏清空、失败保留列表/catalog、分页与同ID换号均有证据。测试操作全为mock或本机临时fixture，没有清空真实回收站或修改用户文件。
- 最终 **201文件/1931项前端测试通过**；原生 **168通过/10忽略**（包含本机回环服务，沙箱外合成回归通过）；来源173映射/20模板/2资源及媒体库35映射/14模板/4资源通过。macOS arm64 debug app **210.55MiB构建通过**，构建含typecheck。沿用CLI `--configLoader native`。最初裸cargo因PATH未配置退出127，之后使用仓库.local/cargo和.local/rustup正确运行，前者不作通过证据。新包尚未重启/实屏。
- Electron main仅只读观察，期间出现发布/夸克并行改动，未修改、回退或提交它们。Tauri仍feat/tauri-migration，无提交/发布/播放器修改；M5 active，真实账号后置，阿里开放通道/文本/跨盘身份及完整840px/窄窗/菜单矩阵等仍待完成，M6未开始。

证据：`/tmp/m5-123-clear-focused.log`、`/tmp/m5-123-clear-native-focused.log`、`/tmp/m5-123-clear-native-all.log`、`/tmp/m5-123-clear-all.log`、`/tmp/m5-123-clear-build.log`。

## 2026-11-08：文本创建生命周期隔离及新包实屏复查

- 核对阿里原 uploadmem.ts 后确认其令牌哈希证明、createWithFolders、PUT与complete链路仍待完整native适配；未把令牌搬回renderer、未把接口存在记为阿里文本已接，也未推进M6传输引擎。
- 实际发现并修复已接四提供商的迁移遗漏：文本创建原先只按账号ID核对，没有绑定来源窗口和原文本弹窗。新增 textCreationScope，捕获公开Account身份并核对实时账号/生命周期；SourceDriveManager传入sourceGeneration、disposed及原dialog对象。Google/OneDrive直接预检/提交/详情、Box/Dropbox原上传函数的native请求适配器均检查同一作用域。原组件模板、上传方法和请求体不变。每来源在途创建不并发重入，失败后释放作用域；不增加后台队列。
- 新增11项作用域回归和3项原组件回归：四提供商预检中切源/同ID换号、命令并发/失败清理、迟到结果；原来源卸载/切换和仅关闭原文本弹窗均在提交前停止。协议/native请求全部合成mock；已发出的请求不能由前端撤回，停止后续请求不等于回滚远端已受理操作。真实账号/真实IPC未验收。
- 最终 **200文件/1922项测试通过**；构建包含typecheck通过；来源173映射/20模板/2资源及媒体库35映射/14模板/4资源通过；macOS arm64 debug app **210.53MiB构建通过**。沿用CLI `--configLoader native`，无Rust修改，原生167通过/10忽略仅为历史基线。
- 按既有授权用CUA退出旧应用，应用清单确认旧实例isRunning=false后打开123批量复制候选（此前1908项构建）。真实profile保留，主屏幕/文件首页及新增来源→Mac可读；进入testVideo后AX仍显示加载中0/0，截图停在文件首页旧帧。Raise及重新绑定未使此次列表可见；点击返回后AX立即回到Mac本地文件夹。仅证明新候选启动/导航及等待时返回可响应，不能记本次目录加载、布局/排序/快捷键矩阵通过，亦不能仅凭工具表现认定应用崩溃。未杀进程或再启动第二实例。当前运行的123候选不包含本轮文本作用域修改，新文本候选仅构建。
- Electron main再次只读检查干净。无真实账号/用户文件写操作、提交、发布或播放器改动；M5 active，阿里开放通道/文本、123网页清空和完整840px/窄窗/菜单矩阵等继续，真实账号后置，M6未开始。

证据：`/tmp/m5-text-scope-focused.log`（6文件64项）、`/tmp/m5-text-scope-focused-final.log`（最终两个相关文件19项）、`/tmp/m5-text-scope-all.log`、`/tmp/m5-text-scope-build.log`。首次定向的未支持提供商错误顺序回归已按原语义修正，初次失败不作通过证据。

## 2026-11-08：123 原多项异步复制与原目录选择链路

- 从既存 Electron 原源码快照直接提取 apiCloud123CopyBatch，按既有明确替换规则只适配 token/fetch，新增 AST 声明校验。保留原 `/api/v1/file/async/copy`、fileIds/targetDirId 与多项一次提交分支；不改为逐项同步复制。native transport 仅放行此固定接口/POST、原字段与安全整数ID。
- relocationMutations 接回原多项分支；复制前通过原宿主完整列表读取目标快照，非根目录核对真实详情。原业务回执仅表示受理，之后核对唯一新增ID、名称、类型、文件大小/可用摘要及实际详情父目录。只返回已确认选中项；无新副本/多义结果保留未确认，不以code=0直接报告完成。目录差异核对仍非独立任务ID的因果证明，不能替代真实账号核验或宣称已实现独立服务端任务终态查询。
- 当前进程保存待确认记录，不启动后台引擎。重复点击并发合并；关闭/同ID换身份/扩展重叠选择禁止转发旧请求；部分成功后只重选一个未确认项仍续查原批任务，不退回单项POST。已确认目标ID跨重试不可重复归属于另一个源文件。明确业务拒绝及已知HTTP拒绝可重新操作；真正发送前取消释放记录；网络未知或畸形回执保留，禁止重POST。无跨应用重启恢复，未知回执仍需人工核对。
- 新增16项合成协议回归及1项挂载原组件测试。原多选Cmd+C→原“复制文件到”→原嵌套目录选择→一次批量POST→已确认目标的链路通过，源行仍保留，复制不更新媒体库身份。不是Rust IPC、真实账号、真实文件或新版实屏验收；没有使用用户文件。
- 最终 **199文件/1908项测试通过**；构建内typecheck、来源173映射/20模板/2资源、媒体库35映射/14模板/4资源通过。macOS arm64 debug app **210.53MiB构建通过**，使用CLI `--configLoader native`。最终代码比此前定向50项日志额外细分提交前取消文案，以全量最终日志为准。无Rust修改，167通过/10忽略仍为历史原生基线，新包尚未重启/实屏。
- Electron main只读核对干净，HEAD外部更新为c788ba3；本任务未提交。M5保持active：123网页清空、阿里开放通道/文本/跨盘移动及其余原能力、完整840px/窄窗口/菜单矩阵继续；真实账号后置，M6未开始。无发布或播放器修改。

证据：`/tmp/m5-123-batch-focused-final.log`、`/tmp/m5-123-batch-ui.log`、`/tmp/m5-123-batch-all-final.log`、`/tmp/m5-123-batch-build-final.log`。早期类型返回推断及旧“批量未接”测试已随新分支修正，初次失败日志不记通过。

## 2026-11-08：123 复制回执的账号身份隔离

- 核对剩余矩阵时发现，123单项复制的进程内待确认记录仅按账号ID区分，原检查只验证当前文件名称。同ID账号身份替换可能复用旧回执。cloud123Copy现在捕获公开Account元数据，每次异步确认前后同时核对当前store账号、传入账号及窗口；回执保留owner，身份不一致拒绝续查和重复提交。原同步复制方法/请求体不变。
- 提交前核对原文件ID、来源、名称、类型及父目录，拒绝迟到选中项。新增6项合成回归覆盖提交期间换号、确认期间换号、同ID新身份续查和三类文件身份变化；此前同身份重开窗口续查、并发合并及未知回执不重复提交测试仍通过。这不证明真实账号令牌轮换或真实IPC已验收。
- 定向19项通过；全量 **197文件/1891项通过**，typecheck通过，来源校验173映射/20模板/2资源及媒体库35映射/14模板/4资源通过；macOS arm64 debug app **210.53MiB 构建通过**。测试和构建沿用CLI `--configLoader native`，新包未重启/实屏验收。本轮无Rust修改，原生测试未重跑。
- 已同步#114矩阵到原整理算法/23协议与6原组件证据，仍保留新版实屏和真实接口验收。123原多项异步复制及网页清空没有因本轮单项隔离而计完成；阿里开放通道与完整实屏矩阵等仍待。Electron main只读检查干净；无真实账号或用户文件写操作，无提交/发布/播放器修改，M5 active，M6未开始。

证据：`/tmp/m5-123-copy-identity.log`、`/tmp/m5-123-copy-identity-types.log`、`/tmp/m5-123-copy-identity-all.log`、`/tmp/m5-123-copy-identity-build.log`。

## 2026-11-08：原整理链路作用域、根目录与菜单实屏复验

- 保留 Electron organize/mediaOrganize 原分组、整体上移、拆开目录、媒体推断、目录创建顺序与结果统计；仅把动态全局命令替换为捕获当前来源窗口的 driveToolPorts。每次异步读写前后检查窗口、来源和账号身份，同账号重开窗口也不转发旧操作；普通建目录失败仍按原逐计划失败统计继续。来源清单以 AST 声明及明确替换校验原算法。
- 共享 directoryRoots 映射原提供商根目录别名；SourceDriveManager 的列表、移动目标、祖先和目录选择路径统一归一化。新建文件夹用返回的真实 ID 注册 commandRows；面包屑保留真实父级链及初始来源目录，原“整体上移一层”和整理后移动不再依赖不存在的目录行。
- 新增23项作用域/整理协议合成测试及6项原组件接线测试，覆盖原媒体整理、初始子目录、整体上移、拆开到当前目录、嵌套目录选择移动和取消确认。均使用模拟驱动/命令，不代表真实账号或 Rust IPC 文件写操作。
- 定向3文件38项、全量 **197文件/1885项通过**，类型检查和来源校验通过（文件173映射/20模板/2资源，媒体库35映射/14模板/4资源）。macOS arm64 debug app **210.53MiB 构建通过**。默认 Vitest 配置打包加载曾停滞；同一 Vite 配置改用 CLI `--configLoader native` 后通过，未改依赖或测试配置。构建同样用临时 beforeBuildCommand 覆盖传入该参数，保留 sidecar 与前端类型检查。原启动任务在确认替代检查通过后正常中断，不记作通过。
- 用户确认菜单修正版 testVideo“列表正常显示且能操作”。本轮在同一运行实例实屏看到21项、右键“属性/更多”，取消选择后 **0/21 且菜单消失**，菜单取消选择收起子项已复验。不是对全套快捷键、嵌套菜单或精确840px布局的总体验收；新整理候选仅构建，尚未运行。
- 本轮无 Rust 修改，167通过/10忽略仅为先前原生基线。真实账号检查后置；阿里开放通道及其余原能力/完整实屏矩阵继续核对。M5保持 active，M6未开始；Electron main只读，无真实账号或用户文件写操作，无提交、发布或播放器修改。

证据：`/tmp/m5-organize-focused-final.log`、`/tmp/m5-organize-all.log`、`/tmp/m5-organize-types.log`、`/tmp/m5-organize-build.log`。默认配置加载采样：`/tmp/m5-organize-{test-process,vitest-process,esbuild-process}-sample.txt`。

## 2026-11-08：PikPak 原分享导入与默认根目录语义

- 直接提取 Electron `src/pikpak/share.ts` 的公开头、匿名信息/访问令牌、原文件映射、完整游标分页和 restore 方法，新增逐声明 SHA 来源映射。仅将 fetch、renderer token lookup/auth headers 换为窗口作用域的公开/native账号端口，并把作用域透传到原读取方法；没有重写导入输入、分享树、目录选择器及其模板。
- 原公开 GET `/drive/v1/share`、`/drive/v1/share/detail` 保留 limit/thumbnail_size/order/share_id/parent_id/pass_code或pass_code_token/page_token 和原 UA，native accountId 为空；固定 POST `/drive/v1/share/restore` 由所选受保护native账号发送原 share_id/pass_code_token/file_ids。renderer无账号token占位或伪Authorization值。每次请求及响应检查窗口/账号/来源，校验分页数据；保留原重复游标错误，不输出截断成功。
- **原版默认保存到根目录，不是迁移新限制。** Electron `apiPikPakSaveShareFilesBatch` 明确使用 `_parentFileId` 且请求中不发parent字段；原 `src/pikpak/__tests__/share.test.ts` 还明确验证选择child-folder时仍restore到root。本轮按直接复用要求保留这条行为，不补造目标API、不偷偷追加移动，也不宣称文件已落到选择的子目录。本窗口去重按真实默认根目录计算，换选另一目录不能重复POST同一未知/在途/成功项。
- 原 share.import 能力及 SourceDriveManager 的原输入→原内容树→原嵌套目录选择→转存writer已接。新增17项协议和1项原组件链路回归，覆盖原参数/映射/公开凭据边界、分页/重复/无效数据/提取码、原根目录语义、异步/未知/明确拒绝、账号/窗口切换和去重。协议/组件HTTP账号均为合成mock，真实账号仍后置。异步202/任务回执只记async提交，不宣称独立任务终态或跨重启恢复。
- 原能力声明中明确 share.import=true 的保留提供商为阿里、夸克、光鸭、PikPak；这四类原导入端口现均已有接线与合成证据。不能继续把其他原本不开放导入的提供商列成泛化缺项；Tauri阿里开放通道与网页通道的账号/接口对齐仍是明确待办。
- 最终前端 **195文件/1856项通过**；类型检查通过；来源 **173映射/20完整模板/2资源**、媒体库35映射/14模板/4资源；macOS arm64 debug包 **210.53MiB构建通过**。定向5文件64项、原表单/三个提供商原组件/菜单收起5文件17项通过。本轮无Rust修改，未重跑原生测试，167通过/10忽略仍为先前基线。
- 当前正在运行的仍是上一轮菜单收起修正版95601；未因相同目录等待或截图旧帧重启它，用户对该现场的反馈仍待。新PikPak包仅构建，未冒称已运行或真实账号验收。原菜单收起修正后的实屏、完整840px/窄窗/快捷键/布局矩阵及剩余整理/开放通道/接口继续核对。整理原helper已迁入，但逐步异步调用是否绑定原页面生命周期、各操作原组件/协议证据仍需补齐，不凭函数存在记完成。
- Electron main只读，观察到外部HEAD更新为b781f2d、工作区无输出，本任务未改动或提交。Tauri仍feat/tauri-migration。无真实账号/用户文件写操作、无提交/发布/播放器改动；M5保持active，M6未开始。

日志：`/tmp/m5-pikpak-import-focused.log`、`/tmp/m5-pikpak-import-ui.log`、`/tmp/m5-pikpak-import-types.log`、`/tmp/m5-pikpak-import-all.log`、`/tmp/m5-pikpak-import-build.log`。


## 2026-11-08：光鸭原分享导入与原菜单收起监听

- 从 Electron `src/guangya/share.ts` 直接提取原公开摘要/访问令牌、文件映射、完整分页、restore_share 转存声明；从 `src/guangya/auth.ts` 仅提取原公开URL/UA/did/traceparent生成器，不复制client配置或账号令牌实现。逐声明SHA校验通过，原导入输入、分享树、选择模式与目录选择器模板不变。
- 原 guangyaPublicPost 的fetch接到带窗口作用域的native公开请求：accountId为空，仅带原公开头；账号restore_share由所选受保护native账号发送。保留原 accessToken/fileIds/parentId 请求体和原光鸭根目录别名。公开响应/后续页与写请求都检查账号、来源、窗口生命周期；畸形/重复/不完整分页不能伪装成空目录成功。
- SourceDriveManager接回光鸭原 share.import 能力和writer分派。16项新增协议回归与1项原组件链路回归覆盖 Cmd+L→原输入→原分享树→原嵌套目录选择→根目录转存，及原字段/别名/公开头、跨页、错误提取码、私有凭据边界、未知/明确拒绝/异步回执、去重/部分重选、账号替换和窗口关闭。HTTP/账号数据均为合成mock，不代表真实登录验收。202或任务ID只返回原UI支持的async提交状态；本窗口内保留确认和未知记录，不重POST未知请求，不宣称跨重启恢复或独立任务终态。
- 实屏已证明原右键菜单、更多→复制文件名/复制目录树子菜单及原属性弹窗能够显示并操作；属性窗口在原始截图1680×1280的较窄窗口仍显示名称、大小、时间和底部按钮，Cmd+A实际选中21/21，取消选择回到0/21。外层AddFileSourceModal原定义width=840/max-width=100vw-40保留；这些为当前实际窗口/本地样片的子集证据，不扩展为全部提供商、精确CSS尺寸测量或所有布局/快捷键通过。
- 上述实屏还暴露了真正的迁移遗漏：菜单在外部点击/取消选择后仍留在页面。Electron `layout/PageMain.vue` 原有window click冒泡与keydown捕获监听，Tauri宿主原先未接。SourceDriveManager现在复用已迁入的原 onHideRightMenu，并在挂载期间绑定/卸载对应监听；跳过输入和其他嵌套弹窗的按键，不改菜单模板/触发方式。新增3项回归证明外点/取消选择、Cmd+A和行按钮/Window Escape、输入编辑及卸载清理；初次Window键盘模拟发现event.target可能非Element，已用Element判断修正后通过。
- 最终前端 **193文件/1838项通过**，最新Tauri构建含类型检查通过；来源 **172映射/20完整模板/2资源**，媒体库35映射/14模板/4资源通过；macOS arm64 debug app **210.53MiB构建通过**。本轮没有Rust修改，未重跑原生回归，167通过/10忽略是上一轮基线。
- 已按既有授权重启到菜单修正版，先由应用清单确认旧实例退出再启动。此候选进入testVideo后仍在等目录读取；只读sample显示AppKit主线程在CFRunLoop/mach_msg等待事件，local_list→Library::list→read_dir/open位于Tokio blocking线程，证明后台化已在实际二进制生效，不证明目录IO耗时已消失。没有因截图旧帧或读取延迟重启/杀进程。终端读取同一testVideo目录立即得到21项，应用后台仍等待open，当前只能定位为该进程的目录访问等待，不推断为已确认的系统权限原因。已询问用户实际画面/是否有系统文件权限提示，保留同一进程与现场；菜单收起修正后的实屏复验继续，当前不能标通过。
- Electron main保持只读；本轮只读观察到HEAD从56c5ac3更新到d754c38，工作区无输出；这是外部并行工作，不是本任务提交。Tauri仍feat/tauri-migration。无真实账号/用户文件写操作、提交/发布或播放器改动。M5保持active，真实账号后置，不进入M6；PikPak导入、阿里开放通道、整理/其余接口与完整实屏矩阵继续核对。

日志：`/tmp/m5-guangya-import-{focused,ui,types,all,build}.log`；最终菜单修正回归/构建为`/tmp/m5-menu-dismiss-{focused,all,types,build}.log`，其中最新build包含类型检查；实际候选线程采样`/tmp/m5-menu-dismiss-runtime-sample.txt`。


## 2026-11-08：夸克原分享导入链路与窄窗本地目录复验

- 从 Electron `src/quark/share.ts` 直接提取原 token/detail/anonymous、文件映射、完整分页、批量转存与任务轮询声明。新增逐声明 SHA 来源映射，不重写原表单/分享树/目标目录模板；原 save 请求保留 fid_list/fid_token_list、stoken、to_pdir_fid、pdir_save_all=false、scene=link。只把网络请求和模块级文件令牌表适配为受保护账号与每窗口独立作用域，补齐原匿名信息调用的作用域透传。
- SourceDriveManager 原先既有方法与能力开关都只放行阿里，已同时接入夸克。原 Cmd+L 输入弹窗 → 链接/提取码 → 原分享树 → 原嵌套目录选择器 → 夸克根目录映射 → 转存完成后的原刷新链路已有组件证据。只允许本来源目标及已读取文件夹；根目录为该账号原 quark_root→0，不依赖不存在的根目录列表行。
- 每次请求及响应检查来源/窗口/账号身份。文件令牌不跨窗口复用，重读缺少令牌的文件清除旧能力；分页拒绝重复ID、畸形数据及未完整列出的空页，不把截断结果当成功。成功项在本窗口去重；相同在途调用合并，重叠未知操作不重发。已获任务ID时按原轮询继续查询，不再POST；缺少任务回执或网络结果未知时要求核对目标。回执状态仅在本窗口/进程，未实现跨重启恢复，也不冒称真实账号或所有服务端异常已验证。
- 原生账号授权仅为已有 drive-pc.quark.cn 授权的夸克账号放行原 drive.quark.cn 的三个固定分享端点及原 GET/POST 方法；未扩充保存的通用授权域。新增原生边界用例覆盖跨提供商、未授权账号、其他路径/方法、伪域、HTTP、userinfo与fragment拒绝。
- 新增16项协议与1项原组件接线测试；HTTP/账号响应均为合成mock，不代表真实网络或登录验收。定向原阿里读取/转存/原表单及夸克协议42项、夸克原组件1项通过；最终前端 **190文件/1818项通过**、类型检查通过、原生 **167通过/10忽略**。来源追溯 **170映射/20完整模板/2资源**，媒体库35映射/14模板/4资源；macOS arm64 debug包 **210.53MiB构建通过**。初次组件测试暴露了夸克 share.import 能力开关遗漏，修复后重新通过；另一次测试中误用的自拟目录选择按钮文案按原“保存分享文件到/选择”修正，未改原版UI来迁就测试。
- 本轮实屏使用仍在运行的上一版后台目录读取候选（不是新夸克包的账号验证）。将窗口拖窄后，截图原始像素从2320×1560变为1840×1280；Mac→testVideo实际返回21项，原列表、快速筛选、布局/排序/区间选择按钮和底层文件数据可见。仅说明此窗口与此次读取，不将像素尺寸直接冒称CSS840px完整测量。来源弹窗和列表能操作并关闭；更多菜单为原hover触发，AX点击/Return未展开，后续拖动触发工具曾返回noWindowsAvailable，同一窗口复读和关闭仍正常。嵌套菜单/精确几何/全部快捷键和布局矩阵尚未通过实屏验收，不据此更改原菜单触发逻辑。
- Electron main未写入；其并行MPV等工作区改动继续保留。无真实账号/用户文件写操作、无提交/发布、不改播放器、不推进M6。M5仍active：其他分享导入提供商、阿里开放通道对齐、原文件整理与剩余接口及实屏矩阵继续核对。

日志：`/tmp/m5-quark-import-focused.log`、`/tmp/m5-quark-import-ui.log`、`/tmp/m5-quark-import-types.log`、`/tmp/m5-quark-import-all.log`、`/tmp/m5-quark-import-native.log`、`/tmp/m5-quark-import-build.log`。


## 2026-11-08：WebDAV/AList 原只读模型及本地目录后台读取

- 直接提取 Electron `src/utils/webdavClient.ts` 的原路径、模型和列表声明，纳入原文件快照与 SHA 校验；仅替换 POSIX 路径和请求端口。WebDAV/AList 保留原图标、分类、时间、缩略图、哈希等字段，由 native 维持认证与来源身份边界。AList 保留 page=1/per_page=0/refresh=false 完整列表请求及 code=0/200 兼容；目录逃逸、重复项、已知不完整列表和切换账号响应不被接受。
- 能力范围以 Electron `src/services/agent/providerCapabilities.ts` 为准：WebDAV/AList 只读，支持浏览/播放/下载/扫描等，原版不开放创建、重命名、移动、复制、上传、分享、搜索及回收管理。修正此前把未实现写操作列为待接的矩阵，不将原只读能力误写成提供商官方限制。
- 新增模型/传输与原组件回归；最终前端 188 文件/1801 项通过、类型检查通过，来源校验 169 映射/20 模板/2 资源，媒体库 35 映射/14 模板/4 资源通过。该批次 macOS arm64 debug app 构建通过，210.45MiB；不等于真实账号验收。
- 实屏已看到文件页收藏星标、已保存 Mac 来源及添加来源双栏弹窗。进入 Mac → testVideo 后界面工具超时；用户确认“文件列表正常显示且能操作”。线程采样发现 `local_list → Library::list → read_dir → open` 在 AppKit 主线程等待。已把 local_list 改为 async，并把完整路径校验/数据库读取/目录枚举移到 spawn_blocking；不改变返回结构、原路径安全校验或文件操作能力。此发现不能断言应用死锁或崩溃，也未把用户确认扩大为菜单/窄窗验收。
- 原生回归首次因沙箱禁止回环监听失败，沙箱外复跑通过（166 通过/10 忽略）。后台读取修改后的 macOS arm64 debug 新包构建通过（210.53MiB，`/tmp/m5-local-list-build.log`）。经已授权重启，新包进入 testVideo 时仍处于目录加载中，但窗口 AX 可立即读取，关闭来源弹窗即时响应；这仅证明等待期间 UI 可响应，未证明此次目录加载完成或耗时问题解决。旧包实屏曾显示21项及视频右键“属性/更多”菜单；嵌套项尚未验收。840px/窄窗口、嵌套菜单和其他原能力仍待完整验收。M5 保持 active，真实账号后置，M6 未开始。未改 Electron main、真实账号或用户文件，未提交/发布。

证据：`/tmp/m5-readonly-dav-{focused,ui,types,all,build}.log`、`/tmp/m5-readonly-dav-app-sample.txt`、`/tmp/m5-local-list-native-unrestricted.log`。沙箱失败日志 `/tmp/m5-local-list-native.log` 不作通过证据。


## 2026-11-08：百度原始字节长ID与创建回调身份闭合

- 百度六个native JSON读取边界（列表/搜索、详情、目录创建、重命名、移动、复制/回收）统一复用已迁入且来源校验过的Electron preserveCloud189LargeIds，在JSON.parse之前保护超出安全范围的整数字面量。未另写数值猜测算法；普通安全数字和字符串内容保持。已经解码成不安全Number的调用参数仍由baiduFileId拒绝，不从浮点数猜原始数字。
- 原始HTTP响应中的未加引号fs_id与taskid可保留十进制字符串，详情查询继续发送原有不带引号的fsids=[十进制ID]，没有把稳定ID强制转Number。新增从mock nativeCall响应字节经真实rawRequest/text/parser/原模型/原文件命令的验证，覆盖超过MAX_SAFE_INTEGER、uint64上界任务ID和新副本ID；小数、负数、指数不安全ID仍拒绝，文件名中的数字/转义字符串不被改写。
- 排查同时发现创建身份不一致：原apiBaiduCreateDir只返回物理path，而迁入列表使用稳定fs_id。新增调用期folder上下文，在原创建回执已校验path/isdir/fs_id后，将实际稳定ID传回host；原POST、rtype、时间戳和错误映射不改。账号身份/来源生命周期在解析父目录、发送和接收后检查；不把内部scope传为真实账号，不增加renderer token。
- 保留普通原新建弹窗不自动选中的行为。原回调现在获得与重载列表相同的稳定ID（适配此前物理路径/ID混用），物理path仍存于原文件模型，未改收藏的路径语义。新增原组件回归验证回调、关闭和重载后的实际长ID行，不为了测试新增选中逻辑。
- 修订旧测试中“原始JSON长整数必拒绝”及创建返回物理path的断言，分别用原始未引用数字的字节保真、创建稳定ID/实际表单路径同时核对替代；保留已经解码的不安全Number拒绝和错误大小/非法ID检查。新增9项桥/组件测试，定向8文件134项通过。最终全量前端 **186文件/1764项通过**、类型检查通过；文件来源 **168映射/20模板/2资源**、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.45MiB构建通过**。
- 无Rust修改，未重跑原生测试，166通过/10忽略仍是历史基线；上述“native”测试是合成字节桥，不是实际Rust网络/真实账号。百度异步任务未独立轮询、未知创建或未知写回执、跨应用重启恢复及其他M5原支持功能仍待，不因长ID测试通过宣称M5完成。完整840px/窄窗/多层菜单实屏待解锁，本轮未重启/CUA，真实账号后置。
- 更新百度验收矩阵的创建身份和原始长ID边界。Electron main既有MPV脏改动保留，未写入/清理；Tauri仍feat/tauri-migration。无真实账号/用户文件写操作、提交或发布；M5 active，M6未开始。

日志：`/tmp/m5-baidu-integer-folder.log`、`/tmp/m5-baidu-integer-focused.log`、`/tmp/m5-baidu-integer-types.log`、`/tmp/m5-baidu-integer-all.log`、`/tmp/m5-baidu-integer-build.log`。


## 2026-11-08：百度原复制/回收、路径与回执核对、目录弹窗标题顺序

- 从只读Electron main 59c09e9的src/cloudbaidu/filemanager.ts扩展直接提取原apiBaiduCopy/apiBaiduDelete，保留requestFileManager、copy async=1/ondup=fail和delete async=2/字符串路径数组/不带ondup。原token/fetch替换沿既有native边界；文件映射/逐声明SHA与完整快照继续校验，不重写原复制/删除算法或模板。
- 新增调用期上下文只允许原固定官方filemanager路径、copy/delete操作、原字段/请求头及已核对的真实物理路径，实际账号授权留在native。不接受root修改、路径/回执交叉、额外字段；明确HTTP4xx（408除外）/业务/逐项拒绝允许主动重试，408/5xx/丢失/畸形回执保留未知不再次发送。既有百度重命名/移动的HTTP408也修正为未知分类，新增直接传输边界回归。
- 复制预读稳定fs_id元数据、实际父目录、目标位置/祖先链与完整旧ID集合；拒绝同名、自身/后代/原位置。提交回执后核对原文件仍在、目标唯一新增同名同类型ID/大小，并读取新ID实际详情核对路径、名称、类型和已知MD5。回收要求原回执与实际父目录已移除原ID；taskid只作为接受证据，未伪称任务终态或真实回收列表记录。
- 相同请求合并，复制/回收/移动/重命名互斥。修正首次预读尚未填真实路径时并发相同请求误判的问题：保存选中路径上下文，仍由实际元数据核对后才提交。成功回执遇关闭时可保留旧操作证据，但不写已关闭/切源页面；回收回执留到catalog成功，刷新/F5或重开来源可同步已消失的旧行，并清理同来源播放列表/系列引用。
- 原组件回归最初用flushPromises不足以等待百度列表的crypto.subtle摘要完成，已改为等待真实ListLoading/目录行，而非改应用时序。测试同时发现实际UI差异：原目录选择器标题被放在native prepare之后，慢列表时闪过通用标题。已把原操作标题赋值移回异步prepare之前，和Electron原顺序一致；延迟真实预读promise的组件测试证明仍在加载时已显示“复制文件到”。模板不变，targetSha及明确适配说明已更新。
- 新增22项原表单、目录/详情/摘要、回执/未知/拒绝/408、并发/互斥/关闭回归及6项原Cmd+C/Cmd+Delete、慢预读标题、刷新/重开保存恢复、迟到切源组件回归；连同已有移动/重命名定向4文件64项通过。旧测试中“百度复制尚未开放”的断言按已实现能力更新，同时保留复制失败不能错误提交move的检查。最终全量前端 **185文件/1755项通过**、类型检查通过；文件来源 **168映射/20模板/2资源**、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.45MiB构建通过**。
- 无Rust修改，未重跑原生测试，166通过/10忽略为历史基线。百度异步任务未单独轮询；taskid与目录状态不能扩展为任务终态验证。原始数值长ID/任务ID、未知回执缺少可查询身份及跨应用重启恢复仍有边界，未凭合成测试抹除。真实账号/真实IPC后置，840px/窄窗/嵌套菜单实屏待解锁；本轮未CUA/重启或声称实屏通过。
- 已更新百度验收矩阵。其他M5原支持接口及完整界面验收仍待，M5保持active，不进入M6。Electron main既有MPV脏改动保留，未写入/清理；Tauri仍feat/tauri-migration。未执行真实账号/用户文件写操作、提交或发布。

日志：`/tmp/m5-baidu-batch-existing.log`、`/tmp/m5-baidu-batch-focused.log`、`/tmp/m5-baidu-batch-ui.log`、`/tmp/m5-baidu-batch-types.log`、`/tmp/m5-baidu-batch-all.log`、`/tmp/m5-baidu-batch-build.log`。


## 2026-11-08：139原复制/回收、原组件与写请求备用路径隔离

- 从只读Electron main 59c09e9的src/cloud139/filecmd.ts直接扩展提取原apiCloud139CopyBatch/apiCloud139TrashBatch，保留batchCopy/batchTrash URL、fileIds/parentFileId结构、返回及未知错误处理。沿既有精确catch适配透传明确原生拒绝，逐声明SHA/完整快照与168映射校验通过；原模板、菜单编排与Electron main不改。
- 新增仅在调用期存在的native请求上下文，将原函数内部user参数适配回受保护真实账号，限定固定端点/原请求体/账号身份与来源生命周期；不把内部scope当账号ID或暴露token。底层主/备用个人云线路保持原行为，但每次发送和失败重试均检查生命周期；同类保护也接到既有新建/重命名/移动，原生发送前才标记submitted。新增3项旧操作主路径404后关闭即停止备用写请求的回归。
- 复制预读实际文件与完整目标祖先链，记录目标旧ID，拒绝同名冲突/自身/后代/原位置；原请求成功回执后核验原文件仍在、目标唯一新增同名同类型ID，普通文件大小与原快照匹配。只查询重试，不再提交已在途请求；结果不确定、失去源文件、大小不符或多候选都不返回成功。这里仍是原接口成功回执加目录差异确认，不冒称官方返回过新副本操作ID。
- 回收保持原trash.move能力，不开放原版缺失的列表/还原/永久删除/清空。原batchTrash成功回执和实际源目录移除均满足才清理同来源媒体库、播放列表/系列引用。请求回执丢失时，即使外部文件已消失也保持未知；明确拒绝允许主动重试。同文件复制/回收/移动/重命名互斥，相同请求并发合并。
- 成功回执恰逢来源关闭时，仅保留旧操作的接受证据，生命周期检查仍阻止页面/本机状态更新。回收记录保留到catalog同步成功，刷新/F5或重开来源可恢复已确认但本机失败的清理，旧行消失亦可达；关闭/切源/同账号ID换身份的排队写入沿既有受保护分支取消。记录仍只在进程内，未知回执和跨应用重启的完整处置未完成。
- 新增21项协议、个人云原body、确认/未知/拒绝、源与目标实际状态、冲突、互斥/并发、关闭与备用路由测试及7项原Cmd+C目录选择器/Cmd+Delete、部分成功、刷新/重开恢复、迟到切源组件测试；包含旧链路的定向5文件83项通过。最终全量前端 **183文件/1727项通过**、类型检查通过；文件来源 **168映射/20模板/2资源**、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.45MiB构建通过**。无Rust修改，未重跑原生测试，166通过/10忽略仍为历史已验证基线。
- 更新139验收矩阵，保留移动本机同步失败恢复、复制差异确认非独立任务ID证明等边界；真实账号/真实IPC仍后置。本轮未重启/实屏，既有解锁请求待回复，完整840px/窄窗/多层菜单矩阵未自动通过。百度与其他M5原支持功能仍需继续，不进入M6。
- Electron main既有MPV脏改动保留，未写入/清理；Tauri仍feat/tauri-migration。未执行真实账号/用户文件写操作、提交或发布，M5保持active。

日志：`/tmp/m5-cloud139-batch-existing.log`、`/tmp/m5-cloud139-batch-focused.log`、`/tmp/m5-cloud139-batch-ui.log`、`/tmp/m5-cloud139-batch-types.log`、`/tmp/m5-cloud139-batch-all.log`、`/tmp/m5-cloud139-batch-build.log`。


## 2026-11-08：天翼原移入回收站、同步恢复与原能力边界复核

- 对只读Electron main 59c09e9的src/cloud189/capabilities.ts及providerFileCmd.ts核对：天翼仅trash.move=true，原版不开放回收站列表、还原、永久删除、清空。接入已迁入的apiCloud189TrashBatch及原DELETE批任务，保留原Cmd+Delete/菜单调用，不通过隐藏应该迁移的入口替代验收，也不新增原版未支持的回收管理。
- 提交前核对实际父目录的JSON稳定ID、个人/家庭空间、名称/类型；拒绝空间根、跨空间父项及已变化文件。完成要求原任务成功并且实际原目录不再返回该ID；单凭源目录消失、未完成/失败/跳过任务都不算回收成功。这里只证明原DELETE操作及源目录移除，不冒称读取过真实回收记录。
- 已知任务ID只查询原任务；任务已确认后只查实际目录。创建回执丢失/畸形且无ID时保留未知，不重复DELETE；明确创建拒绝供主动重试，查询失败不冒充提交拒绝。相同请求并发合并，回收与重命名/移动/复制互斥，回执留到本机同步成功。
- 普通删除通过既有purgeDeletedCatalog清理同来源文件或文件夹后代，并清理播放列表/系列引用，不影响其他来源同ID。刷新/F5、关闭重开来源可确认原任务并重试本机保存，即使旧行已消失。恢复和写入队列均检查来源/账号身份；新增同账号ID换身份恰逢本机保存排队的回归，阻止旧catalog写入并返回空成功列表，避免原菜单误删新身份行。进程回执仍非跨应用重启持久日志。
- 依据原始capabilities.ts修正文档中误列的缺口：百度/139/189/夸克均upload.memory=false，不把它们的新建文本当迁移待办；夸克copy=false及trash.restore/delete/empty=false，按原版不开放记录。百度/139仍需迁入的移动复制/回收接口保留待办，未缩减M5其他原支持功能。
- 新增17项个人/家庭文件目录、原DELETE表单、任务/目录双确认、未知/明确失败、并发/互斥/身份测试及7项原快捷键、文件夹后代与分组清理、刷新/重开恢复、迟到切源和排队换号组件测试。最终全量前端 **181文件/1699项通过**、类型检查通过；文件来源 **168映射/20模板/2资源**、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.45MiB构建通过**。本轮无Rust改动，未重跑原生测试，166通过/10忽略仍为上一轮基线。
- 本轮CUA再次明确返回Mac锁屏，已结束该界面阶段；既有解锁请求待回复，没有重复要求许可、启动/重启或记实屏通过。完整840px/窄窗/多层菜单验收、其他M5源接口仍待，真实账号后置；M5保持active，不进入M6。
- Electron main既有MPV脏改动保留，未写入/清理；Tauri仍feat/tauri-migration。没有真实账号/用户文件写操作、提交或发布。

日志：`/tmp/m5-cloud189-trash-focused.log`、`/tmp/m5-cloud189-trash-types.log`、`/tmp/m5-cloud189-trash-all.log`、`/tmp/m5-cloud189-trash-build.log`。


## 2026-11-08：天翼原COPY批任务与原复制弹窗

- 继续复用已迁入的Electron apiCloud189CopyBatch/batch，不重写COPY表单和轮询算法；接入既有relocateRemoteFiles及原Cmd+C/目录选择器，只开放已实现的天翼复制能力。原模板及Electron main均未修改。移动与复制共用实际分页目录读取/目标路径核验，移动回归同步通过。
- 提交前从实际源目录核对ID、名称/类型和目标祖先链，完整记录目标目录原有ID并拒绝同名冲突；原任务确认完成后，要求目标中恰有一个新ID、同名同类型副本且原文件仍存在，普通文件两端大小与原快照匹配。不能仅凭目录中新出现的同名项推断未知提交成功；失败/跳过任务、原文件消失、大小不符、多个新候选均保留未确认。
- 已知任务ID查询重试复用原任务，不再次创建；任务已完成而副本未可见时，后续只查目录，不重复提交或轮询。创建回执丢失且无任务ID时保持未知，不凭外部新增项释放记录。明确创建拒绝允许主动重试；相同请求并发合并，复制/移动/重命名同文件互斥，确认复制后释放。
- 审查修正批任务关闭边界：原生HTTP返回的有效创建taskId先保存到旧操作进程回执，再检查来源生命周期，避免关闭窗口恰逢创建回执返回而丢失查询身份。仍不更新已关闭/切源页面，换号检查保持。复制不改原文件媒体库归属，不自动把未扫描副本导入媒体库。
- 新增18项个人/家庭、文件/目录、原表单/任务回执、冲突/未知/实际副本、并发/互斥/关闭恢复测试及3项原复制弹窗、原命令重试、切源组件测试。最终全量前端 **179文件/1675项通过**、类型检查通过；文件来源 **168映射/20模板/2资源**、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.45MiB构建通过**。本轮无Rust代码修改，未重跑原生测试，166通过/10忽略为上一轮已验证基线。
- 验收矩阵拆开原先混写为“待接”的百度/夸克/139/189行，按现有文件夹、重命名、移动/复制和回收接口逐列记录，未把账号或实屏标通过。天翼DELETE原声明已迁入但其请求端口/实际结果确认仍待接；不能以迁入声明或绿色测试宣称整盘文件管理已完成。
- 本轮未重新进行CUA/重启/实屏，上一阶段锁屏的解锁请求仍待用户回复。840px/窄窗/嵌套弹窗菜单矩阵、天翼回收及其他M5缺口继续；真实账号仍后置，进程回执不等于跨重启持久恢复。不进入M6。
- Electron main既有MPV相关脏改动仍保留，本任务未写入/清理；Tauri仍feat/tauri-migration。未执行真实账号/用户文件写操作、提交或发布。M5保持active。

日志：`/tmp/m5-cloud189-copy-focused.log`、`/tmp/m5-cloud189-copy-ui.log`、`/tmp/m5-cloud189-copy-types.log`、`/tmp/m5-cloud189-copy-all.log`、`/tmp/m5-cloud189-copy-build.log`。


## 2026-11-08：天翼原批任务移动、家庭签名与本机同步恢复

- 从Electron main 59c09e9直接提取原mutableScope/batch/apiCloud189TrashBatch/apiCloud189MoveBatch/apiCloud189CopyBatch及完整源快照，保留createBatchTask表单、个人会话checkBatchTask、30秒/60次/500ms轮询、冲突与部分成功处理；清单新增168号来源映射。仅catch增加明确原生提交拒绝透传，消息仍由外层报告。复制/回收声明虽迁入，本轮没有把其端口或界面能力冒称已完成。
- 修复native家庭批任务会话选择：固定POST /batch/createBatchTask.action从原form的唯一有效familyId选家庭会话；同路径个人表单选个人，checkBatchTask始终个人。签名与same_session共用选择逻辑；拒绝家庭ID重复、空/非法、错误表单类型和非POST。不向renderer暴露会话密钥或接受自定义会话选择头。原生合成签名/会话轮换与个人/家庭批请求测试通过。
- 天翼移动接入原目录选择器/Cmd+X和既有移动编排。预读文件稳定JSON ID、名称/类型、个人/家庭父空间与实际目标层级，拒绝原位置/自身/后代/跨空间。提交后必须核验同ID位于目标且已从原目录消失，不能用任务接收或原函数返回输入ID代替结果。
- 每个文件保留进程内任务回执，已知任务ID重试由原算法只查询原任务；创建回执丢失/畸形且无ID时只查询实际目录，绝不再次提交。明确创建4xx（408除外）/业务拒绝才释放供主动重试；轮询403等不当作创建拒绝。相同操作并发合并；重命名和移动互斥至确认/本机同步。
- 回执保留到catalog同步完成。刷新/F5或重新打开来源会从记录确认原任务及目标，并重试本机同步，即使旧目录已没有原行；保留媒体稳定ID、手工标题、播放进度及扫描归属。失败继续显示错误，关闭/切源/换号校验阻止迟到恢复写入。当前仅进程内恢复，跨应用重启日志仍未完成。
- 新增20项移动协议/个人家庭/文件目录/任务时序/未知与明确失败/实际状态/并发/互斥/生命周期测试及5项原组件目录选择器、未知刷新恢复、本机保存失败刷新/重新打开恢复。全量前端 **177文件/1651项通过**，其后仅追加3项测试且该文件 **20项通过**；未将追加测试冒称已纳入该次全量。类型检查、文件来源 **168映射/20模板/2资源**、媒体库35映射/14模板/4资源通过。原生首次沙箱运行因本机监听权限导致18项失败；获自动授权解除监听限制后重跑全量 **166通过/10既有忽略**。macOS arm64 debug app **210.45MiB构建通过**。
- CUA检查明确返回Mac锁屏，已请求用户解锁并结束该界面阶段，未启动/重启应用或记新包实屏通过。840px/窄窗/多层菜单完整矩阵仍未验收，真实账号后置。天翼复制/回收和其他M5缺口继续，不进入M6。
- Electron main HEAD仍59c09e9，原有MPV脏改动保留，本任务未写入/清理；Tauri仍feat/tauri-migration。没有真实账号/用户文件写操作、提交或发布，M5保持active。

日志：`/tmp/m5-cloud189-move-focused.log`、`/tmp/m5-cloud189-move-timing.log`、`/tmp/m5-cloud189-move-types.log`、`/tmp/m5-cloud189-move-all.log`、`/tmp/m5-cloud189-batch-native.log`、`/tmp/m5-cloud189-move-native-all.log`、`/tmp/m5-cloud189-move-build.log`。


## 2026-11-08：新增来源弹窗用户确认与天翼属性接线

- 用户确认“新增文件源”弹窗在实屏正常显示。此前AX已打开而截图仍为首页的现象，不作为应用绘制失败；此确认只覆盖弹窗显示，不扩展为全部菜单、窄窗或新包验收。
- 天翼普通文件属性接入既有原属性弹窗，沿已迁入的Electron mapper，通过所属目录分页重新核对原生JSON文件身份、个人/家庭空间、父项和类型，返回实际名称、大小、图标与时间；不信任旧选中项，不猜测新的详情端点。创建时间无独立字段仍留空，不将更新时间冒充创建时间。
- 普通文件夹统计复用既有完整遍历器，统计大小/文件数/子目录数及sizeStr一起更新；读取失败不返回部分或零统计。聚合入口、跨空间父项与回收站不使用普通属性接口。账号替换、关闭与切源后的迟到读取拒绝。
- 新增11项合成回归：个人/家庭长ID、跨空间、消失/类型变化、回收拒绝、完整目录统计、分页定位、遍历失败、切源与换号。全量前端 **175文件/1629项通过**，类型检查通过；文件来源167映射/20模板/2资源、媒体库35映射/14模板/4资源校验通过。macOS arm64 debug app **210.42MiB构建通过**。
- 未重启应用、未进行新版实屏/真实账号/真实签名IPC验证，无Rust修改，未重跑原生测试。Electron main既有MPV脏改动保留，本轮未写入；Tauri独立feat/tauri-migration。天翼移动/复制/回收及其余M5验收矩阵继续，M5 active，M6未开始。

日志：`/tmp/m5-cloud189-properties-all.log`、`/tmp/m5-cloud189-properties-types.log`、`/tmp/m5-cloud189-properties-build.log`。


## 2026-11-08：天翼原重命名、同步确认重试与切源隔离

- 图标审查：直接cmp当前Electron main与Tauri文件界面的IconFont.vue，退出码0，组件完全一致；当前两端本就使用相同映射，没有为迁移另外替换图标库。本轮未修改图标组件，不把组件相同扩展为所有图标/CSS/实屏已验收。
- 从Electron main 59c09e9直接提取原mutableScope/apiCloud189Rename，保留个人POST、家庭GET、文件renameFile/目录renameFolder、destFileName/destFolderName及familyId参数。Native详情接口只提供从所属父目录已预读核对的选中项，不错误猜测个人详情端点或自动扫其他空间；账号签名留在既有Rust HTTP通道。原模板不改；原catch仅加入明确原生拒绝的透传，错误显示由外层统一处理，原消息调用使用适配端口，精确替换及说明已记录于清单。
- 提交前核对稳定JSON ID、个人/家庭空间、父目录、名称和类型，拒绝跨空间父项；提交后重新读取实际父目录，只有同ID的新名称/类型匹配才返回。HTTP 4xx（408除外）和明确业务拒绝释放记录，可在原表单主动重试；408/5xx/网络/畸形回执为未知，后续仅查询。实际原生发送前才标记submitted，预读阶段关闭或换号不会留下伪在途操作；相同请求并发共用一次提交。
- 当前进程内记录最多128个，直到catalog同步成功才确认释放。接到原“重命名”入口：确认/本机同步重试后再打开原弹窗，使用原store/tree重命名方法更新已确认名称；解决刷新后行已为新名称、原弹窗同名直接关闭导致无法确认的可达性问题。本机同步失败、未知请求刷新后确认、批量部分失败均有原组件证据，不以隐藏协议调用代替可达入口。
- 审查又发现确认重试await期间切换来源可能在新页面打开旧重命名弹窗，已加generation/来源检查，同时覆盖既有百度入口。新增相同native文件ID但不同账号的实测组件回归，旧请求完成不改新列表、不打开新弹窗、不重复发送。旧来源已确认的catalog同步行为沿既有约定处理。
- 新增20项协议/空间/明确拒绝/未知确认/生命周期/并发回归及7项原表单、手工标题/进度保留、本机同步重试、刷新后同名确认、明确拒绝重试、批量部分成功和切源组件回归；定向连同既有百度4项共31项通过。最终全量 **174文件/1618项通过**、类型检查通过；文件来源 **167映射/20模板/2资源**、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.42MiB构建通过**。
- 记录仍只在当前进程，跨应用重启/未知结果被外部改成其他状态后的完整处置尚未完成。没有真实账号、Rust签名IPC或新包实屏验收；无Rust代码修改，未重跑原生测试，165通过/10忽略仍为历史基线。天翼移动/复制/回收及其他M5矩阵、840px/窄窗菜单与M6入口继续，真实账号后置。
- 未执行用户文件/账号写操作、应用重启、提交或发布。Electron main保留原有MPV脏改动，本任务未写入或清理；Tauri仍独立feat/tauri-migration。M5保持active，M6未开始。

日志：`/tmp/m5-cloud189-rename-focused.log`、`/tmp/m5-cloud189-rename-types.log`、`/tmp/m5-cloud189-rename-all.log`、`/tmp/m5-cloud189-rename-build.log`。

## 2026-11-08：天翼原文件模型、身份适配与分页隔离

- 从Electron main 59c09e9的dirfilelist.ts直接提取原mapCloud189FileToAliModel；新增逐声明SHA/完整源快照追溯，mapper本体不改。列表沿原方法按folderList/fileList设置isFolder，并给出所属家庭与已知请求父目录，再用原mapper生成图标、拼音、大小/时间格式、时间戳、缩略图优先级及description。仅在native身份边界把file_id/parent_file_id转换为现有个人/家庭JSON ID；description保留原提供商标识。原SourceDriveManager允许已验证189原模型进入原store。
- 拒绝已丢精度ID、非标识类型、控制字符、负/非安全大小、畸形名称/缩略图和无效时间，不再用泛型文本图标或把错误大小改成0掩盖。可选大小缺失时仍沿原mapper默认值，不能据此声称已取得真实文件夹统计。原集合分类保持，即使raw isFolder字段相反，也按原folderList/fileList规则处理。
- 原生临时分页游标从裸页码改为绑定账号ID/用户/设备/线路和个人/家庭目录，记录已见ID以拒绝非相邻重复页。账号移除/换号后的迟到列表及下载链接不返回。聚合根和家庭集合不接受普通目录游标；原native根别名进入既有聚合根且不错误JSON.parse。这里保持既有native聚合导航，未冒称天翼所有特殊根已经整页实屏验收。
- 新增22项原模型完整字段、个人/家庭同ID隔离、集合分类、根别名、异常字段、分页范围、重复页、账号替换和原日期/缩略图回退回归；已有原表单组件额外核对原store目录图标、父身份和description。原创建确认的重复页错误现在由更早的native列表验证拒绝，相关测试同步核对该错误，未放宽重复页要求。定向5文件55项通过；最终全量 **172文件/1591项通过**、类型检查通过，文件来源 **166映射/20模板/2资源**、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.42MiB构建通过**。
- 无Rust代码修改，未重跑原生测试，165通过/10忽略仍为历史基线。原图标字段进入store不等于已经核验新包实际图形、缩略图/鉴权或真实账号；天翼重命名/移动/复制/回收及完整原详情、其他M5矩阵、840px/窄窗菜单和M6入口继续。未执行真实账号/用户文件写操作、应用重启、提交或发布。Electron main仍59c09e9并保留既有MPV脏改动，本任务未写入或清理；M5保持active，M6未开始。

日志：`/tmp/m5-cloud189-model-focused.log`、`/tmp/m5-cloud189-model-types.log`、`/tmp/m5-cloud189-model-all.log`、`/tmp/m5-cloud189-model-build.log`。

## 2026-11-08：天翼原新建文件夹、个人/家庭空间与无损ID链路

- 从只读Electron main 59c09e9直接提取原apiCloud189Mkdir、个人/家庭ID转换及原内存元数据缓存辅助声明、原大整数JSON保护函数与公开API/UA常量；3份完整源快照、逐声明SHA及唯一导出JSON保护器的替换加入清单。原新建函数、请求参数、个人/家庭POST差异和原弹窗模板保持，不引入renderer会话密钥或签名实现。
- Native创建适配仅允许固定官方createFolder端点和原参数：个人parentFolderId，家庭familyId/parentId，以及folderName/空relativePath。会话限定账号身份、来源生命周期和选中的空间/父目录，内部scope结束时清理原函数写入的临时元数据缓存；scope不作为真实账号ID传入native。不在聚合入口、家庭集合入口或伪造的跨空间ID下提交写请求；返回空间、目录ID及实际目标列表中名称/类型均须核对后才返回完成。
- 原创建返回folderId以字符串保留。发现既有native GET列表仍可能先用普通JSON.parse丢失长ID，故通用json读取新增可选解码参数（现有调用默认不变），天翼读取使用原preserveCloud189LargeIds；未另写数值猜测算法。新增直接从mock native响应字节走真实rawRequest/request/json桥的回归，证明个人/家庭读取及POST创建→GET确认两端未给加引号的大整数ID均无损；显式返回其他家庭的列表项拒绝，不投影为当前空间。
- 原新建表单、失败保留/显式重试、完成后刷新与定位native JSON身份已接通，额外核验原Cmd/Ctrl+Shift+N文件夹快捷键；最初快捷键测试误用不带Shift的文本新建键，依据原处理器改正测试输入后通过，未修改原快捷键逻辑或让天翼文本新建误开放。日期/批量文件夹继续复用原编排，但该两种专门入口的天翼完整回归尚未单列完成。
- 新增25项原协议/空间/确认/大整数/异常/生命周期回归，2项native响应字节桥回归及3项原表单组件回归；定向4文件33项通过，最后原快捷键组件单独3项通过。全量 **171文件/1569项通过**、类型检查通过；文件来源 **165映射/20模板/2资源**、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.42MiB构建通过**。无Rust代码修改，未重跑原生测试；165通过/10忽略仍为历史原生基线。
- **验证边界**：native桥测试仍是本机合成字节，不能代替真实Rust签名IPC、天翼账号或新包实屏。天翼普通列表仍是既有native driver，完整原mapper/重命名/移动/复制/回收等继续；请求未知且缺少可用目录ID时的新建结果恢复未完成。其他M5矩阵、840px/窄窗菜单及M6入口仍需继续，真实账号后置。
- 本轮没有真实账号/用户文件写操作、应用重启、提交或发布。末次核对Electron main HEAD仍59c09e9，但已有MPV相关脏改动；本任务只读main，未写入或清理这些现有文件，不称其工作区干净。Tauri仍单独feat/tauri-migration，M5保持active，M6未开始。

日志：`/tmp/m5-cloud189-folder-focused.log`、`/tmp/m5-cloud189-folder-keyboard.log`、`/tmp/m5-cloud189-folder-types.log`、`/tmp/m5-cloud189-folder-all.log`、`/tmp/m5-cloud189-folder-build.log`。

## 2026-11-08：光鸭原详情、属性与读取会话隔离

- 接上光鸭属性端口，复用已迁入的原apiGuangyaFileDetail和mapGuangyaFileToAliModel，不修改原ShuXingModal。核对同一稳定ID、实际父目录、原resType/dirType分类及选中类型；名称、大小、时间、缩略图、MIME和摘要字段异常拒绝，普通文件缺少实际大小不冒充0字节。保留原字段别名、日期语义及创建日期回退；明确md5/sha1来源才标算法，通用contentHash不猜算法。原公开模型投影不复制服务端私有字段。
- 原详情主接口失败会回退根目录列表。新增native详情读取会话：原函数只接收一次性内部scope标识，由请求适配层解析回真实账号，并在主请求与回退每一请求前后检查所属会话。关闭或换号后不发回退请求；同账号两个并发属性读取的guard互不影响，结束后移除scope，不写profile或传给native作为真实账号ID。原详情/回退声明和请求体保持，不修改原函数catch。
- 普通文件夹复用上一轮完整walker统计与5000项/循环/失败/溢出保护；原控件显示的大小、文件数、子目录数与JSON投影保持一致。光鸭没有已接入的回收视图属性，未用普通详情冒充回收信息。
- 新增19项协议/字段/日期/摘要/遍历/主接口回退/关闭/账号替换及并发会话回归，2项原属性弹窗、复制JSON及完整文件夹统计组件回归。定向3文件43项通过；最终全量 **168文件/1539项通过**，类型检查通过；文件来源162映射/20模板/2资源、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.42MiB构建通过**。
- 本轮无Rust修改，未重跑原生测试，165通过/10忽略仍为历史基线；没有真实账号/IPC/新包实屏验收。其他提供商接口、回收目录呈现、840px/窄窗菜单和M6入口仍需继续，真实账号后置。Electron main核对仍59c09e9且干净，未改；无真实账号/用户文件写操作、应用重启、提交或发布。M5保持active，M6未开始。

日志：`/tmp/m5-guangya-properties-focused.log`、`/tmp/m5-guangya-properties-types.log`、`/tmp/m5-guangya-properties-all.log`、`/tmp/m5-guangya-properties-build.log`。

## 2026-11-08：完整文件夹属性统计与分页间账号检查

- 接上上节明确保留的普通文件夹统计缺口：本地、139、夸克和百度属性共用现有source-bound walker，完整遍历后才计算文件大小/文件数/子目录数。夸克和百度不再把原mapper的file_count=0当统计；已确认为空目录时才显示真实零。原属性模板不改，大小、file_count及sizeStr同时更新，避免原界面与复制JSON仍留旧目录大小/格式化字符串。
- 遍历中途失败、循环/重复项、超过5000项、负/NaN/不安全单文件大小或总和溢出均明确失败，不返回部分统计。回收站文件夹不能用普通目录读取，仍不进行此类遍历，回收目录内部统计/未知值呈现尚未验收；未把它计为普通目录统计通过。
- 属性会话增加账号用户/设备/线路快照校验，walker每步及native list每页前后执行该校验；SourceDriveManager内部list端口仅新增可选校验回调，原调用的3个参数保持可用。真实原组件回归模拟第一页100项后账号被替换，明确确认未发送第二页请求；不只在整个遍历完毕后丢弃结果。
- 新增11项完整后代、失败、大小、溢出、5000项上限、账号替换和回收隔离回归；2项原夸克/百度属性模板的完整统计/JSON回归，1项native分页端口账号替换回归。两项原空目录用例改为先验证实际空列表再报告零。初次组件测试在SHA异步列表尚未完成时读取空表单，改为等待真实最终控件值后通过，没有修改原模板或降低统计要求。
- 定向4文件62项通过；最终全量 **167文件/1518项通过**，类型检查通过；文件来源162映射/20模板/2资源、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.42MiB构建通过**。本轮无Rust变更，未重跑原生测试，165通过/10忽略仍为历史原生基线。
- 未执行真实账号或新包实屏验收；其他提供商操作/统计、回收目录呈现、840px/窄窗及M6入口仍需继续，真实账号后置。Electron main核对仍59c09e9且干净，未改；无真实账号/用户文件写操作、应用重启、提交或发布。M5保持active，M6未开始。

日志：`/tmp/m5-folder-properties-focused.log`、`/tmp/m5-folder-properties-types.log`、`/tmp/m5-folder-properties-all.log`、`/tmp/m5-folder-properties-build.log`。

## 2026-11-08：夸克与百度原详情接入属性弹窗

- 在未改原ShuXingModal模板的前提下，补夸克/百度native属性端口。夸克复用原apiQuarkFileDetail和经过验证的原mapper，核对同一fid、实际父目录及文件/文件夹类型；回收视图从原独立回收列表读取，不错误请求普通目录详情。百度复用原apiBaiduFileMetas、稳定ID验证及原mapBaiduFileToAliModel，保留实际路径、MD5、缩略图、媒体时长与原description；长fs_id全程字符串，不经Number取整。
- 读取实际创建/修改时间，0时间按原mapper规则回退；日期/大小/摘要/媒体时长/缩略图类型异常不当成功。百度dlink=0且现有详情边界移除服务端额外dlink，原弹窗复制JSON只取原模型公开投影，不带临时下载链接或未知私有字段。文件夹mapper的file_count=0不当作实际目录统计；两家完整目录统计及未知值在原弹窗中的呈现仍未验收，不能把本轮数据接线称作完整属性体验。
- 两家属性读取绑定账号用户/设备/线路及pane来源context，账号替换、关闭或切源后的迟到结果不进入属性。属性路径解析同时补真实父项ID和目录类型校验：缓存若返回另一个文件，不拼成貌似有效的目录路径；未知实际父目录显示既有“路径暂不可用”，不沿用过时位置。此问题由新增回归实际捕获后修正。
- 新增25项原详情/时间回退/回收/路径/数据异常/未知统计/账号隔离回归、2项真实原属性模板及复制JSON组件回归；初始定向含既有通用属性共38项通过，最后2项零修改时间回退已入全量。最终前端 **167文件/1504项通过**、类型检查及build内类型检查通过，文件来源162映射/20模板/2资源、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.42MiB构建通过**。
- 没有真实账号、原生详情IPC或新包实屏验收；无Rust代码修改，未重跑原生测试，165通过/10忽略仍为历史基线。其他提供商操作、文件夹统计呈现、840px/窄窗嵌套菜单及M6入口继续；未将局部接口接线算作M5完成。Electron main核对仍59c09e9且干净，未改；无用户文件/账号写操作、应用重启、提交或发布。M5保持active，M6未开始。

日志：`/tmp/m5-quark-baidu-properties-focused.log`、`/tmp/m5-quark-baidu-properties-types.log`、`/tmp/m5-quark-baidu-properties-all.log`、`/tmp/m5-quark-baidu-properties-build.log`。

## 2026-11-08：原生文件右键菜单观察与139属性接入

- 本轮重新连接既有开发应用成功，原先停留的Mac→testVideo来源浏览器可从AX读取21项，并能获取实际列表截图；截图确认目录五角星、原视频图标、列表大小/日期和选择工具栏正常显示。右键视频后，截图明确出现“属性 / 更多”菜单，选区为1/21；这比此前仅AX选中证据更强，补齐该本地文件右键菜单的实际绘制观察。没有执行文件写操作或修改收藏。
- 点击截图中的属性项后，界面工具点击及随后同一应用AX读取均timeoutReached；未因此重启应用，也未判定崩溃。无法确认该点击是否到达弹窗，属性、多层弹窗、准确840px和窄窗口仍未验收。此应用是既有运行实例，不将其当作本轮新属性代码或最新提供商端口的运行验证。
- 静态检查本地属性路径未见写操作，超时原因仍未知。另发现139属性端口仍明确拒绝：现复用所属父目录的已验证139分页/原mapper，以稳定ID、来源和类型确认实时详情，再投影至原ShuXingModal；不调用原来只查根目录的简化详情来假装支持嵌套。保留原视频图标、时间、大小、缩略图和description，未知创建日期不编造。
- 文件夹沿用现有source-bound walker完整遍历后计算大小/文件数/目录数；5000项限制、循环或目录读取失败不显示零或部分统计，大小汇总超安全范围明确报错。关闭、来源context变化和账号身份替换后的迟到结果不进入原属性窗口。没有新增UI模板或目录树界面。
- 新增8项属性协议/路径/聚合/失败/隔离回归及1项原属性弹窗与复制JSON组件回归；定向3文件28项通过。最终全量 **165文件/1477项通过**、类型检查通过；文件来源162映射/20模板/2资源、媒体库35映射/14模板/4资源通过；macOS arm64 debug app **210.42MiB构建通过**。首次类型/构建发现测试夹具递增可选context，改显式赋值后类型检查与构建重跑通过；生产逻辑未因该夹具改动而修改。
- 本轮无Rust修改，未重跑原生测试；165通过/10忽略仍为历史原生基线，不与前端文件数混淆。139真实属性/缩略图/IPC、新包实屏、其他提供商操作及M6入口仍继续；真实账号后置。Electron main仍59c09e9且干净，未改；无真实账号/用户文件写操作、应用重启、提交或发布。M5保持active，M6未开始。

日志：`/tmp/m5-cloud139-properties-focused.log`、`/tmp/m5-cloud139-properties-types.log`、`/tmp/m5-cloud139-properties-all.log`、`/tmp/m5-cloud139-properties-build.log`。

## 2026-11-08：139 明确拒绝与未知结果分流

- 解决上节保留的“明确拒绝仍占据待确认操作，无法主动重新提交”：Tauri通用HTTP边界增加SourceHttpError，保留数值status，既有错误提示文字及rawRequest响应契约保持。139把明确业务拒绝与HTTP 4xx（408除外）作为确定拒绝；404仅尝试原有备用路由，路由耗尽才向操作层传递拒绝。408、5xx、网络和畸形响应仍为未知，不凭文字误判后自动重发。
- 原139 apiCloud139Rename/apiCloud139MoveBatch的catch会吞掉原生拒绝，故在源提取清单加入两条精确平台适配：仅透传Cloud139RequestRejected，其余错误保持原catch行为。原请求字段、成功分支及UI模板不改。操作宿主捕获明确拒绝后释放当前文件记录和跨操作归属，允许用户在原弹窗/原目标重新提交；未知记录继续仅查询。该适配已经过原文件SHA/逐声明替换追溯，不能描述为这两个catch逐字未改。
- 新增20项回归：8项HTTP数值状态/原提示保持，移动业务/400/401/403/409/429明确拒绝重试、408/500未知只查询、终态404路由耗尽后重试、重命名业务/403重试，以及同一个原重命名弹窗先拒绝后成功的组件链路。定向5文件67项通过，最终全量 **164文件/1468项通过**；类型检查、文件来源162映射/20模板/2资源、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.42MiB构建通过**。
- 本轮无Rust代码修改，未重跑原生测试；未运行新包实屏或真实账号操作。原生165通过/10忽略仍只是历史基线。进程内记录的跨重启恢复、本机catalog同步失败恢复、其他提供商操作与840px/窄窗菜单仍需继续；没有将这次重试分流算作M5整体完成。Electron main核对仍59c09e9且干净，未改；无用户文件写操作、应用重启、提交或发布，M5保持active，M6未开始。

日志：`/tmp/m5-cloud139-rejection-focused.log`、`/tmp/m5-cloud139-rejection-types.log`、`/tmp/m5-cloud139-rejection-all.log`、`/tmp/m5-cloud139-rejection-build.log`。

## 2026-11-08：139 原移动、目录选择器与终态确认

- 在既有Electron main 59c09e9 filecmd源提取中加入原apiCloud139MoveBatch，保留/file/batchMove及fileIds/parentFileId字段；原函数和原目录选择器模板不改。Native请求边界仅允许已适配的单项移动，原多选编排逐项处理并报告部分失败；复制尚未接入，不将其误记为139原版不支持。
- 原SourceDriveManager模型适配补139根父项cloud139_root、/、0到空根身份，目标根入口同样归一化，避免原目录选择器把根占位当普通父目录继续查找。原文件mapper仍保持完整源内容，只有宿主身份边界调整；此前store回归期待cloud139_root已同步改为native空根。
- 提交前逐页核对原父目录同一文件名称/类型；按原选择器已加载的祖先ID链从根逐级核对实际目录，拒绝原位置、自身、子目录、伪造/缺少目标上下文。提交后再次核对祖先链、目标目录中的同一稳定ID/名称/类型及原目录已不含该ID，最后复核目标层级，才返回完成。原函数吞掉请求错误后的空数组或返回输入ID均不单独作为终态证据。
- 未确认移动保留最多128个当前进程内记录，相同请求并发合并；原目标重试仅查询，不重复POST。与139重命名共享同文件操作归属，未知移动时阻止改名或改投其他目标。账号用户/设备/线路或来源生命周期变化时停止，预提交失败释放记录。原函数吞掉的明确拒绝与网络未知目前同样保守保留，如何安全重新提交明确拒绝仍需补齐，不冒称完整重试策略；记录亦未持久化，远端成功后本机同步失败的恢复仍未完成。
- 新增15项移动协议/目标层级/终态/身份/未知重试/跨操作与并发回归，另新增原Ctrl+X→目录选择器→移动回调组件回归，确认稳定媒体ID、手工标题、观看进度保留并更新实际目标祖先链。定向3文件42项通过（最终额外目标层级复核已纳入全量）；最终前端 **164文件/1448项通过**，类型检查通过，文件来源162映射/20模板/2资源、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.42MiB构建通过**。无Rust代码修改，165通过/10忽略仍为历史基线，未重复声称本轮原生测试。
- 本轮只有合成协议、原组件及本机打包证据，真实139移动/原生IPC/新包实屏仍未验收。139复制/回收、其他提供商矩阵、840px/窄窗菜单和M6传输入口继续；没有真实账号/用户文件写操作、应用重启、提交或发布。Electron main仍59c09e9且干净，本轮未改；M5保持active，M6未开始。

日志：`/tmp/m5-cloud139-move-focused.log`、`/tmp/m5-cloud139-move-types.log`、`/tmp/m5-cloud139-move-all.log`、`/tmp/m5-cloud139-move-build.log`。

## 2026-11-08：139 原文件模型、分页范围与列表store接入

- 从只读Electron main 59c09e9的src/cloud139/dirfilelist.ts直接提取原Cloud139FileItem、listFromResponse和mapCloud139FileToAliModel，新增完整源快照及逐声明SHA；仅导出原响应提取器，mapper内容不改。既有native路由/签名与新旧接口请求继续作为平台边界，不复制renderer凭据，也未将仍由native适配的请求方法称作整份dirfilelist已原样迁移。
- 替换139列表的泛型模型投影，保留原图标、拼音、大小/时间格式、时间戳、缩略图与description；原SourceDriveManager允许139的electronModel进入原store，并核对来源/文件/名称/类型身份。旧catalogID/contentID、catalogList/contentList组合沿原mapper；显式实际父目录须与请求目标一致，超安全数值ID、冲突类型、负/不安全大小、无效时间与缩略图类型拒绝，不回退空成功。
- 139分页游标现在绑定来源ID、账号用户/设备/线路与物理父目录，并保存已见token/ID以拒绝非相邻循环和跨页重复。请求前后核对账号仍存在且身份未变。旧接口仍按原生既有offset+100分页；权限失败不切旧接口。过去“相同nextCursor当结束”会把重复页当正常结束，本轮改为明确报错；既有协议测试同步核对，不能把截断当通过。只影响当前进程临时分页游标，无持久账号/收藏重写。
- 新增19项原模型/旧别名/媒体字段/游标隔离/重复页/账号移除/畸形响应回归，以及1项原store模型集成回归；连同既有139协议/操作共48项定向通过。最终全量前端 **163文件/1432项通过**、类型检查通过；文件来源 **162映射/20模板/2资源**，媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.42MiB构建通过**。无Rust代码修改，165通过/10忽略仍只是历史基线，本轮未重跑原生测试。
- **验证边界**：保留原thumbnail字段不等于已证明真实139缩略图及原生鉴权显示；没有真实账号、原生IPC或新包实屏验收。139移动/复制/回收、其他提供商矩阵、持久操作恢复、840px/窄窗菜单与传输入口仍需继续。没有真实账号/用户文件写操作、应用重启、提交或发布。Electron main核对仍59c09e9且工作区干净；M5保持active，M6未开始。

日志：`/tmp/m5-cloud139-model-focused.log`、`/tmp/m5-cloud139-model-types.log`、`/tmp/m5-cloud139-model-all.log`、`/tmp/m5-cloud139-model-build.log`。

## 2026-11-08：139 原新建文件夹及重命名接入

- 从只读Electron main 59c09e9921a433789303af485767b76e7dc8a732的src/cloud139/filecmd.ts直接提取原apiCloud139Mkdir/apiCloud139Rename；完整源快照及逐声明SHA加入追溯。原/file/create字段（folder、空description、force_rename）与/file/update的fileId/fileName保持，原弹窗模板不改；仅用native账号签名HTTP及既有/hcy、/orchestration路由替代renderer凭据。只在缺路由时沿用备用路径，不对权限失败换线路。
- 原函数返回值不直接作为完成：新建按返回稳定ID逐页查询目标目录，确认实际文件夹后返回，不猜路径；保留force_rename原语义，同名冲突时接受提供商返回且实际存在的改名目录身份。重命名前核对原目录同一文件名称/类型，之后核对同ID、目标名称和类型才同步原列表/catalog。列表及命令边界拒绝超安全范围数值ID，避免取整后操作别的文件；重复身份/分页及过大确认目录明确拒绝。
- 重命名结果未知时保留当前进程内最多128个记录，原入口重试只读目录，不重复POST；相同请求并发合并，账号用户/设备/线路、来源生命周期变化时停止提交或确认。该记录不是持久化日志。创建缺ID/确认失败后的跨重启恢复、重命名已远端完成但本机同步失败的完整恢复仍未解决，未列作通过。
- 新增22项协议回归及3项原新建/重命名弹窗组件回归，含实际目录确认、原自动改名语义、六种根别名、分页、权限拒绝、身份替换、切源、未知结果查询重试及原列表/catalog同步；定向连同既有139协议共28项通过。首次fixture的it.each把行数组展开成参数，修正fixture后通过，原UI未改。
- 最终全量前端 **162文件/1412项通过**，类型检查通过；文件来源 **161映射/20模板/2资源**、媒体库35映射/14模板/4资源通过，macOS arm64 debug app **210.42MiB构建通过**。本轮无Rust修改，未重跑原生测试，165通过/10忽略仅为历史基线；没有新包实屏/真实账号/原生签名IPC验证。
- 139普通列表仍沿用既有native driver，并未完成原mapper完整迁移；移动、复制、回收及其他M5矩阵、持久恢复、840px/窄窗菜单和传输入口仍需继续。未对真实账号或用户文件执行写操作，未重启用户应用、提交或发布。Electron main仍59c09e9且工作区干净；Tauri仍feat/tauri-migration。M5保持active，M6未开始。

日志：`/tmp/m5-cloud139-focused.log`、`/tmp/m5-cloud139-types.log`、`/tmp/m5-cloud139-all.log`、`/tmp/m5-cloud139-build.log`。

## 2026-11-08：夸克移入回收站的实际记录确认

- 修正此前明确保留的“code=0仅证明请求受理”缺口：原apiQuarkTrashBatch、原回收列表方法及UI模板不改，native边界提交后逐页读取实际回收列表，以同一稳定fid、名称、文件/文件夹类型及有效record_id确认后才返回成功。跨页重复身份拒绝，不凭任务/空成功回执移除原文件行或媒体库引用。
- 提交结果未知或回收记录暂不可见时，保留最多128个当前进程内待确认项；原删除入口重试只读回收列表，不重复POST，相同文件并发合并。明确HTTP 4xx/非零整数业务code作为拒绝释放记录，可主动重试；网络、5xx及畸形回执保持未知。每页前后检查来源生命周期及账号用户/设备/线路，切源、换号不报告成功。
- 新增12项终态/未知结果/拒绝重试/分页/隔离/并发协议回归，另加原SourceDriveManager键盘回归：第一次未确认时文件行和catalog保留，再次使用原快捷键确认后才移除，总共仅一次POST。首次组件测试重复点击已选行导致取消选择，修正测试为按原保留选区重试后通过，未改原UI选择逻辑。
- 最终全量前端 **160文件/1387项通过**，类型检查通过，macOS arm64 debug app **210.42MiB构建通过**；文件来源160映射/20模板/2资源、媒体库35映射/14模板/4资源通过。本轮无Rust代码修改，未重复执行原生测试；旧165通过/10忽略仅为历史基线。
- **边界**：上述为合成协议/原组件与本机打包证据，真实夸克回收记录及原生IPC仍待账号验收。记录仅进程内，跨重启未知操作恢复、远端完成后本机catalog同步失败的持久恢复仍未解决；没有将这些计作完成。840px/窄窗菜单、其他提供商矩阵和传输入口继续保留缺口。Electron main核对仍main且干净，本轮不写入；无真实账号/用户文件操作、提交、发布或新包重启。M5保持active，M6未开始。

日志：`/tmp/m5-quark-confirm-focused.log`、`/tmp/m5-quark-confirm-ui.log`、`/tmp/m5-quark-confirm-types.log`、`/tmp/m5-quark-confirm-all.log`、`/tmp/m5-quark-confirm-build.log`。

## 2026-11-08：用户确认来源弹窗正常、新包窗口复核

- 用户再次确认“新增文件源”弹窗实际正常显示；此前截图偶尔只显示背景，不作为应用弹窗绘制故障证据，不据此修改原版模板或CSS。
- 沿用已授权重启流程，退出旧应用后先用只读进程观察确认已结束，再通过界面工具打开最新debug bundle，保留现有用户profile。新包的文件首页、添加共享及Mac已存储来源可从无障碍树读取：添加共享列出本地、网络、云服务及媒体服务器分组；Mac列出assets/testVideo和各自移除收藏按钮。未执行移除、登录或文件写操作。
- 点击Mac的testVideo后，界面工具报noWindowsAvailable；应用清单仍标记BoxPlayer Dev运行中，重新连接报timeoutReached。该证据不足以判定应用崩溃、锁屏或弹窗绘制问题；未反复启动实例。840px/窄窗、多层弹窗和contextmenu完整实屏验收仍未通过，不将控件可读等同视觉与交互验收。
- 本轮仅补充运行观察记录，没有代码改动或重跑测试；159文件/1374项、类型检查、210.42MiB包均为上一检查点结果。真实账号继续后置，M5保持active，M6未开始；Electron main未修改。

## 2026-11-08：百度移动的进程内刷新/重开恢复

- 补齐上轮明确保留的“移动后旧目录已没有该文件，无法选中确认同步”链路：提交时记录目录选择器已经加载并校验的目标祖先上下文，原SourceDriveManager加载入口（包括F5刷新和重新挂载来源）按所属账号查询已提交记录，以原稳定fs_id确认结果，再同步catalog/preferences并确认释放；确认函数只读取已有submitted记录，不能自动创建并POST新移动。
- 恢复不依赖旧列表或目录选择器仍在场。按原祖先链更新稳定目的目录和父链，保留媒体ID/标题/观看状态；偏好设置在catalog异步保存后读取最新对象再合并，避免覆盖期间新增/替换的偏好。只有所属来源的扫描会在确认后取消，切源或账号身份改变时不提交同步；失败保留记录，继续显示明确失败，不当作空成功。
- 对已经被移动的旧物理路径文件夹入口，用已核对fs_id的实际新路径重定向当前目录、根入口、面包屑和返回历史；保留既有路径收藏的展示身份，不猜测子目录数字ID。原root导航不会再次回到失效旧路径。原组件模板/按钮不改，没有增加传输或恢复页面。
- 额外复核补强目标终态：确认源文件实际位置后，再读取原选中目标目录ID，核对它仍在记录的位置；目标/祖先层级变化时明确拒绝确认或提交，避免把被别的目录复用的路径当成选中目标。预提交及结果确认均校验记录的祖先路径；不凭旧目录树快照认定目标层级。
- 新增7项恢复/隔离/并发偏好/旧路径映射回归、3项原F5/重开来源/旧文件夹入口组件回归，另补2项目标终态/层级变更协议回归。定向3文件30项通过；最终全量前端 **159文件/1374项通过**，类型检查及macOS arm64 debug app **210.42MiB构建通过**。文件来源160映射/20模板/2资源、媒体库35映射/14模板/4资源通过。本轮无Rust修改，165通过/10既有忽略只是历史基线。
- 本节证明的是**当前进程内**通过原加载入口可达的恢复，取代上轮对此路径的未完成记录；记录未持久化，跨应用重启、外部改变目标层级后的完整重新选择/修复仍未完成，缺少祖先上下文的非UI直接请求不会被猜测同步。真实账号/原生IPC、840px/窄窗实屏菜单、百度复制回收及其他M5矩阵/传输入口仍继续。没有用户文件或真实账号操作，没有重启/另起应用、提交或发布；Electron main保持59c09e9且干净，本轮未写入。M5保持active，M6未开始。

日志：`/tmp/m5-baidu-recovery-focused.log`、`/tmp/m5-baidu-recovery-types.log`、`/tmp/m5-baidu-recovery-all.log`、`/tmp/m5-baidu-recovery-build.log`。


## 2026-11-08：百度原移动请求、目录选择器及引用同步

- 在已迁入的filemanager源声明中加入原apiBaiduMove，保留path/dest单项filelist、async=1、ondup=fail；原rename提取未改，只将native fetch分派至rename/move适配器。来源快照按本轮实际读取的Electron main **59c09e9921a433789303af485767b76e7dc8a732**记录：main由外部合并从c2ce416推进，工作区干净，本轮只读；对比这两commit，cloudbaidu及原relocation.ts无差异，既有其他快照提交不覆盖。
- Native移动先按稳定fs_id确认原文件和目标目录实际路径/类型，拒绝原位置、自身及子目录；目标根精确别名转盘根。提交后读取同一文件ID，只有名称/类型和实际目标路径匹配才成功。taskid、HTTP成功或仅路径回执不代替实际状态；业务/逐项/4xx拒绝可重试，网络/未知结果保留在途记录并仅查询。账号用户/设备/线路及来源生命周期逐步检查，部分失败逐项返回。
- 移动和重命名共享同一文件的进程内操作归属：未确认或本机未同步时，不允许对该文件提交另一类写操作。移动确认记录同样保留到catalog/preferences同步后释放。复制当前仍未适配，不把原版支持说成提供商不支持，也不将其隐藏状态当M5完成证据。
- 原Ctrl+X、SelectPanDirModal、原移动编排及按钮保持。Native同步保留稳定视频ID、手工标题、观看进度及收藏属性，更新目的目录/祖先链、原元数据真实路径及parentFileId；文件夹下物理路径与旧路径收藏（连同自定义封面/顺序）同步。只有同步完成才改当前列表/移除已移动项；本机同步失败时保留原列表记录，重新打开原目录选择器并选择原目标可仅查询/重试同步，不再POST。不是新增传输任务界面或M6引擎。
- 新增15项协议/目标校验/部分失败/未知结果/跨操作回归及3项原快捷键、选择器、文件/文件夹同步与UI可达重试组件回归；定向含已有rename共22项通过。最终全量前端 **158文件/1362项通过**，类型检查及macOS arm64 debug app **210.42MiB构建通过**。文件来源160映射/20模板/2资源、媒体库35映射/14模板/4资源通过；本轮无Rust修改，165通过/10既有忽略只是历史原生基线。
- **仍未验收/实现**：进程内记录不是持久化日志；关闭/刷新来源后，如何在原文件已不在旧目录的情况下从UI重新定位并确认待同步移动，尚无完整恢复链路（协议端口可按原ID查询，不等于UI可达）。跨重启恢复、百度复制/回收、其他提供商矩阵、传输入口、840px/窄窗原生菜单以及真实账号继续后置/处理。没有真实云端/用户文件操作、重启/另起应用、提交或发布；M5保持active，M6未开始。

日志：`/tmp/m5-baidu-move-focused.log`、`/tmp/m5-baidu-move-ui.log`、`/tmp/m5-baidu-move-types.log`、`/tmp/m5-baidu-move-all.log`、`/tmp/m5-baidu-move-build.log`。


## 2026-11-08：百度原重命名、结果确认及引用同步

- 从Electron main c2ce416的filemanager.ts直接提取原requestFileManager、apiBaiduRename及响应声明/常量，新增完整快照与SHA。原单项filelist、async=1和ondup=overwrite保留；仅移除renderer token并换账号绑定native HTTP，不改原重命名/批量重命名模板。适配器拒绝顶层及逐项errno错误、不匹配路径和不适用请求；4xx/明确业务拒绝与网络/5xx未知结果分开。
- 请求前按稳定fs_id读取实际路径/名称/类型，核对原父目录/已读模型；检查来源生命周期及账号用户/设备/线路身份，避免切源后继续POST。提交后再次读同一fs_id，只有实际名称、类型与目标路径匹配才返回成功。taskid、空info或仅路径回执不作为完成证明；未知结果重试只查询，不盲目重发。相同文件同名并发合并，未确认结果阻止另一个目标名；有限128个未确认记录，**仅当前进程内**，跨重启恢复尚未实现。
- 确认记录保留到本机同步成功后才确认释放。远端成功但catalog/preferences失败时可重试同步而不再次POST。核对原RenameModal发现同名输入会直接关闭，故将该恢复接到现有“重命名”入口：先沿原焦点选择逻辑选择目标，再仅查询/修复待确认项，随后打开原弹窗。组件测试通过真实原入口恢复，不能用直接调用隐藏端口代替可达UI验收。
- Native模型保持fs_id，更新实际path/description和同源已读子路径；媒体库保留ID、进度、已观看、收藏、播放列表、手工标题，只更新实际文件名及受影响物理folderPath/ancestors/catalogRoots。原元数据的driveFiles按来源核对；外部来源与同名前缀目录不改。旧路径收藏迁移路径及其ID，带上自定义标题/封面/隐藏状态/顺序，已有稳定ID收藏保持；检测收藏/设置冲突时不覆盖用户设置，报告本机同步失败。批量只同步真正确认的条目，失败项明确保留。
- 新增19项协议/未知结果/并发/来源身份回归、4项引用同步及4项原弹窗/批量/恢复组件回归，定向27项通过。最终全量前端 **156文件/1344项通过**，类型检查及macOS arm64 debug app **210.42MiB构建通过**。文件来源160映射/20模板/2资源、媒体库35映射/14模板/4资源通过；本轮无Rust修改，165通过/10既有忽略仅为历史原生基线。早期回归发现同名恢复不可达及无选区焦点回退问题，已修正后重跑，最终以本节日志为准。
- 真实百度重命名/覆盖语义/异步兼容性、原生IPC及840px/窄窗菜单仍未验收；本轮没有真实账号/用户文件操作。进程内记录不等于持久化操作日志，跨重启未知结果/同步恢复继续保留缺口。百度移动复制回收等其他能力及M5提供商矩阵/传输入口继续；Electron main仍c2ce416且工作区干净，无重启/另起应用、提交或发布。M5保持active，M6未开始。

日志：`/tmp/m5-baidu-rename-focused.log`、`/tmp/m5-baidu-rename-types.log`、`/tmp/m5-baidu-rename-all.log`、`/tmp/m5-baidu-rename-build.log`；早期`/tmp/m5-baidu-rename-ui.log`为同名恢复端口改接原入口前的检查，最终恢复证明在focused/all中。


## 2026-11-08：百度稳定目录身份与原详情接口

- 核对重命名依赖时确认，上一检查点为目录保留物理路径ID虽兼容旧简化driver，却偏离Electron原fs_id且会让重命名后身份变化。本轮**修正该投影**：普通目录与文件均保留原稳定fs_id；path独立保留。已存储的物理路径收藏/直接目录入口仍可读取，并未把旧路径当数值ID。上一检查点“目录ID投影为路径”的描述以本节为准。
- 从Electron main c2ce416直接抽取apiBaiduFileMetas及响应模型，快照/SHA新增；只去掉renderer token和浏览器fetch，改账号绑定native元数据请求。fsids支持经过验证的十进制字符串，以原JSON数字字面量精确编码，不经Number取整。dlink固定0、原其他元数据开关保留，当前adapter一次查1个已绑定ID；返回ID/实际路径/名称/类型均核对，结果移除dlink字段。服务端如果仍用超安全范围的JSON数字返回ID会拒绝，尚无原生无损数字转换，不能将其算作完整大整数协议兼容。
- SourceDriver读取稳定目录ID时走原详情解析其当前物理路径，再用原列表接口；native cursor同时绑定入口身份和实际路径/排序。普通页父身份使用已知稳定父ID；搜索结果继续保存实际父路径以支持打开位置。创建子目录也先解析已选择的稳定父ID，避免在错误位置新建。DirectoryPicker可以沿稳定ID读取子层，无需恢复被排除的左目录树。
- 原浏览器保留旧路径收藏的显示/移除身份：星标与收藏事件在确认同源旧收藏存在时使用原收藏路径，原列表行fs_id保持不改，也不因读取自动重写用户收藏/封面/排序。新增组件用例核对已有收藏不重复、原ID不变；按稳定ID打开目录和原模型父身份亦有组件回归。重命名后的旧路径收藏/媒体引用迁移仍须在写操作接入时完成，本轮不冒称已处理。
- 新增12项详情协议/身份/精度/错误/目标目录及创建子目录回归，另补2项原组件回归；定向3文件35项通过。最终全量前端 **153文件/1317项通过**，类型检查及macOS arm64 debug app **210.40MiB构建通过**。文件追溯159映射/20模板/2资源、媒体库35映射/14模板/4资源通过。本轮无Rust变更，165通过/10既有忽略仅为历史基线。
- **仍未完成**：百度重命名请求/逐项或异步回执/路径引用同步，以及移动复制回收等写能力；下一步继续。没有真实账号详情/图片/原生IPC或840px/窄窗菜单验收，没有用户文件/账号写操作、重启/另起应用或提交发布；Electron main仍c2ce416且干净。M5保持active，M6未开始。

日志：`/tmp/m5-baidu-identity-focused.log`、`/tmp/m5-baidu-identity-ui.log`、`/tmp/m5-baidu-identity-types.log`、`/tmp/m5-baidu-identity-all.log`、`/tmp/m5-baidu-identity-build.log`；`/tmp/m5-baidu-metadata-focused.log`为补齐账号提供商拒绝前的早期定向结果，最终通过以identity日志为准。


## 2026-11-08：百度原普通列表与递归搜索

- 从只读Electron main c2ce416迁入原apiBaiduFileListPage、apiBaiduSearch、响应模型与mapBaiduFileToAliModel，完整源快照及逐声明替换加入清单。只替换renderer token和浏览器fetch边界/响应类型；原列表1000条、原递归搜索500条单批、原请求参数/mapper保留。普通列表替换既有简化driver，搜索接回原PanRight入口；不宣称原搜索支持无限分页。
- 原生账号请求固定官方list/search端点，User-Agent用原生字典传递，无renderer凭据；rawRequest新增可选超时参数供百度保留原request.ts的15秒，其他调用默认30秒不变。原方法用message.error后返回空列表的路径，adapter错误边界改为throw；search业务失败在json响应边界抛错，不伪装成空成功。账号移除检查仍拒绝迟到结果；原catch提示可能显示“超时”，没有据该文案判定实际网络超时。
- 原mapper保留图标/拼音/缩略图URL、时间大小、哈希、path与fs_id描述。仅将目录身份投影为现有native物理路径以兼容浏览/收藏/播放边界，文件ID保持字符串，拒绝已不安全的数字。实际父目录由完整path导出，核对目录页父路径及文件名/类型；递归搜索结果保留真实父目录，原“打开位置”和Back能退出/回到搜索。含root的物理路径不改成盘根。
- 普通目录沿原adapter.ts三行排序映射读取既有目录排序，覆盖name/time/size六种服务端请求。游标绑定账号/视图/物理路径/排序/offset，保留原每次+1000偏移；拒绝重复ID、重复整页及失效排序游标。分页has_more但空页明确报错。目录路径与fs_id重复分别校验，杜绝同一提供商身份被两个路径掩盖。
- 新增20项协议/模型/分页/排序回归及2项原浏览器目录/搜索/打开位置/Back集成回归。旧cloud-protocols百度fixture改为账号绑定native HTTP，保留长字符串ID和拒绝数值精度丢失验证。定向4文件33项、最终全量前端 **152文件/1303项通过**；类型检查及macOS arm64 debug app **210.40MiB构建通过**。文件追溯158映射/20模板/2资源、媒体库35映射/14模板/4资源通过。本轮无Rust修改，165通过/10忽略为既有原生基线，未重跑。
- 仍缺百度重命名/移动复制/回收完成契约等写操作适配；原生图片URL实际可用性、真实账号、840px/窄窗菜单未验收。其他提供商矩阵、精确操作回执与M6入口衔接继续。没有真实账号/用户文件操作、重启/另起应用或提交发布；Electron main仍c2ce416且干净，M5保持active，M6未开始。

日志：`/tmp/m5-baidu-list-focused.log`、`/tmp/m5-baidu-list-types.log`、`/tmp/m5-baidu-list-all.log`、`/tmp/m5-baidu-list-build.log`。


## 2026-11-08：百度原新建文件夹链路

- 从Electron main c2ce416的upload.ts只抽取原创建目录声明、响应类型与路径拼接helper，未导入上传引擎/分片/Node依赖。完整源快照和5项声明追溯加入清单。原表单path/isdir/rtype/local时间戳、默认rtype=0拒绝冲突及-8/-10/-7错误映射保留；去掉renderer token读取与URL token拼接，改为已有native账号HTTP。
- 原normalizePath的includes(root)会把/root-library、/Movie/root等真实目录改成盘根；在路径边界改为精确根别名，变更逐字记录。拒绝相对路径、空路径段、点段、反斜线/控制字符及含凭据URL。仅允许固定官方create目录路径、原表单/请求头；HTTP User-Agent以原生请求字典传递，避免浏览器Headers过滤受限头。首轮定向测试发现过滤问题，修正后才通过，不把此前“异常测试因错误原因抛错”当验证。
- 成功回执核对实际path、isdir=1及不丢精度的fs_id，拒绝原函数缺path时直接回退输入路径的虚假确认；支持原生响应已经使用字符串表示的长ID，数值型超安全范围则拒绝，不取整。创建结果仍返回原目录绝对路径身份，与现有百度目录浏览方式一致。响应字段核对参考[百度SDK的MkdirResponse定义](https://pkg.go.dev/github.com/baidu-netdisk/baidu-drive-sdk-go/baidudriver/api#MkdirResponse)；官方文档页面本轮访问失败，未将SDK类型或合成fixture当真实服务验收。
- 接入原新建文件夹端口与能力交集，百度文本新建仍按原版不支持。新增26项协议/路径/回执/错误/账号回归，原浏览器快捷键组件追加百度1项；定向45项、最终全量前端 **150文件/1281项通过**。类型检查及macOS arm64 debug app **210.40MiB构建通过**。文件追溯157映射/20模板/2资源、媒体库35映射/14模板/4资源通过；本轮无Rust修改，165通过/10既有忽略仅为历史基线。
- **尚未接完**：百度重命名原filemanager存在逐项错误/异步结果及ID与物理路径转换，普通列表仍为简化模型，后续继续原源码迁入；本轮不能将它们计完成。其他提供商矩阵、回收最终状态、传输入口及840px/窄窗原生菜单仍需继续。无真实账号写操作/用户文件变更，无重启/另起应用，Electron main仍c2ce416且干净。M5保持active，M6未开始。

日志：`/tmp/m5-baidu-folder-focused.log`、`/tmp/m5-baidu-folder-types.log`、`/tmp/m5-baidu-folder-all.log`、`/tmp/m5-baidu-folder-build.log`。


## 2026-11-08：夸克普通列表与搜索原源码迁入

- 将Electron c2ce416原`apiQuarkFileList`与`apiQuarkSearch`声明加入已有快照提取。唯一平台分支替换是移除读取renderer token并调用`window.WebQuarkFileList`的Electron preload分支；其精确原文替换已记录在upstream清单。原native请求分支、普通目录100条页号/排序/风险文件参数，搜索200条单批、排序和高亮参数保持。凭据仍只在原生会话，未引入renderer Cookie/token。
- 替换SourceDriver中夸克的简化列表实现；普通目录、搜索和回收站共用原mapper的身份适配，保留图标、拼音、格式、时间/大小、缩略图URL及描述。目录页核对实际父目录；搜索保留真实结果父目录，缺父目录拒绝冒充根目录。分页游标绑定账号/普通视图/父目录，保留原页号，并校验重复ID、前页重复及非相邻整页重复hash；错误、畸形和不完整分页不当空成功。原搜索仅200条单批，不宣称无限分页。
- 原组件回归复现并修正适配层“搜索结果就在当前目录时，打开位置仍留搜索模式”的问题：打开位置先保存搜索历史、退出query，再读实际目录，Back恢复原搜索。保持原组件和模板不改。新增19项协议/模型/分页和2项原浏览器集成回归。旧cloud-protocols夸克测试改用账号注册、原生HTTP及绑定游标，并将跨用例clear改reset避免失败前未消费mock队列污染百度测试；兼容9项通过。
- 最终全量前端 **149文件/1254项通过**，类型检查通过；macOS arm64 debug app **210.40MiB构建通过**。文件追溯156映射/20模板/2资源，媒体库35映射/14模板/4资源通过。本轮无Rust修改，沿用165通过/10既有忽略历史基线，未重复执行原生测试。首轮全量发现旧协议fixture未跟随接口迁移；已更新后重跑全量通过，不将首轮失败结果列作通过。
- 验证仅合成协议和组件、本机编译打包；没有真实夸克列表/搜索/缩略图显示、IPC或原生菜单实屏证据。回收受理到最终记录确认、其他提供商操作、下载/上传/任务入口与840px/窄窗仍需继续。Electron main仍c2ce416且工作区干净；没有用户文件或真实账号写操作，没有重启/另起应用，M5保持active，M6未开始。

日志：`/tmp/m5-quark-list-new.log`、`/tmp/m5-quark-list-ui.log`、`/tmp/m5-quark-list-focused.log`、`/tmp/m5-quark-list-compat.log`、`/tmp/m5-quark-list-types.log`、`/tmp/m5-quark-list-all.log`、`/tmp/m5-quark-list-build.log`。


## 2026-11-08：夸克原移动、回收与回收站浏览

- 扩展两份既有Electron c2ce416快照的声明提取：原`apiQuarkMoveBatch`、`apiQuarkTrashBatch`、`apiQuarkTrashList`、文件模型mapper和时间转换直接复用，原请求体、独立`file/recycle/list`与100条页号协议保留。原模型的图标、拼音、格式/时间/大小、原父目录和record_id描述进入原PanRight store；不以普通目录请求冒充回收站。DTO在明确dir布尔字段存在但file_type缺省时补齐对应type后交原mapper，避免其缺省0将文件判成目录。
- Native边界扩展请求白名单、业务code=0确认、ID/记录ID安全校验与回收列表形状/总数检查；回收游标绑定账号及trash视图，拒绝重复身份/重复前页、缺总数的满页与不一致分页，不把错误当空列表。移动读取实际目标文件夹，在提交前检查来源生命周期，提交后再核对文件ID/名称/类型/目标父目录，部分失败逐项返回。
- 按原夸克能力只开放移动、移入回收站及回收站列表；复制、恢复、彻底删除和清空仍是原版不支持。将“可浏览回收站”和“可恢复”端口分开，并在原SourceDriveManager直接命令入口发送前再次拒绝不支持的操作，未修改原工具栏/菜单模板。原组件回归覆盖面包屑回收站入口、原文件模型、选择后按钮可见性及直接命令拒绝。
- 发现原目录选择器会把quark_root/backup_root等视图标识原样传给简化列表，补native根标识转0，增加5种根别名回归，避免移动目标目录列表错误。新增合计38项测试（37协议/分页+1原组件）；定向3文件71项通过，全量前端 **147文件/1233项通过**。类型检查及macOS arm64 debug app **210.40MiB构建通过**；文件追溯156映射/20模板/2资源，媒体库35映射/14模板/4资源通过。本轮无Rust修改，165通过/10既有忽略为此前原生基线，未重新执行。
- **证据边界**：移入回收站当前沿原code=0成功回执，只证明请求受理，尚无真实账号或回收记录终态核对，不能声称异步删除最终完成；这点及未知结果恢复仍留M5验收缺口。普通夸克列表尚非完整原mapper迁入，其他提供商操作、下载/上传/任务入口与840px/窄窗菜单实屏仍需继续。没有对真实账号或用户文件执行操作，本轮未重启/另起用户应用；Electron main仍为c2ce416且工作区干净。M5保持active，M6未开始。

日志：`/tmp/m5-quark-move-focused.log`、`/tmp/m5-quark-move-types.log`、`/tmp/m5-quark-move-all.log`、`/tmp/m5-quark-move-build.log`。


## 2026-11-08：夸克原新建文件夹与重命名链路

- 从只读Electron main `c2ce416260706ff31a426a44d18ad1e414f864ad`直接抽取原`apiQuarkMkdir`、`apiQuarkRename`、详情方法、响应类型/列表提取与查询参数构造器；两份完整源快照和逐声明SHA追溯已加入清单。保留原请求体及`pr/fr/uc_param_str/__t/__dt`参数，不改原模板或重写操作弹窗。仅导出原query builder供native适配器共用。
- Tauri端口使用现有账号绑定HTTP及原生Cookie会话，renderer不读凭据。请求范围限原新建、重命名与详情，校验输入和业务错误、拒绝不安全数值ID；请求返回后再次检查账号存在。原重命名仅按响应truthy判成功且`file_type=0`有falsy误判，原声明保持，外层以实际详情核对ID、名称、父目录和文件/文件夹类型，确认后才返回成功。详情原本回退首条的不匹配结果不能冒充完成。
- 接入原SourceDriveManager既有新建与重命名端口及能力交集，未把夸克不支持的文本新建打开。新增27项协议回归，并将夸克加入原浏览器快捷键组件回归；定向2文件45项通过。全量前端 **146文件/1195项通过**，类型检查通过，macOS arm64 debug app **210.40MiB构建通过**。文件来源 **156映射/20模板/2资源**、媒体库35映射/14模板/4资源通过；本轮无Rust修改，原生165通过/10既有忽略仅为既有基线，未重复声称运行。
- 原生UI工具可读取当前应用主页与已存储来源弹窗。尝试菜单退出后仍能读到原窗口，未观察到旧进程终止，因此未另起实例，也不把本轮界面作为最新包运行验收。用户已明确确认来源弹窗实际正常显示；此前截图背景差异保持按工具观测限制处理，不据此改CSS。
- 真实夸克账号新建/重命名与原生菜单、840px/窄窗未验收；其他提供商操作、精确复制回执及M6入口保留仍需继续。M5保持active，M6未开始。本轮未修改Electron main、真实云端或用户文件；不提交/发布。

日志：`/tmp/m5-quark-focused.log`、`/tmp/m5-quark-ui.log`、`/tmp/m5-quark-types.log`、`/tmp/m5-quark-all.log`、`/tmp/m5-quark-build.log`。


## 2026-11-08：原缩略图失败处理的CSP适配

- 核对原键盘代码：清除历史没有对应原快捷键；Ctrl+M属于D9明确排除的加密上传，保持不恢复。没有为清除历史新增或占用该键。
- 原PanRight预览使用onerror内联脚本跳转imgerror.png，而Electron跟踪文件及public/assets目录均未找到该资源；Tauri现有script-src又不允许内联脚本。保持原模板及CSP不改，在SourceDriveManager底层增加捕获错误事件的桥接：只处理本面板或原popimg/preimg传送弹窗里那条精确的legacy fallback，移除失败事件属性，按原网格既有方式隐藏失败图片，避免反复请求缺失资源。后续load成功恢复原display，再次失败仍可处理。
- 监听只在所属面板存活/连接时生效，卸载同时移除error/load监听；不接管其他图片/原Vue错误处理。新增6项纯DOM及1项真实原组件mount/unmount集成回归，覆盖传送弹窗、无关图片、失活/断开、成功恢复及重复失败。全量前端 **145文件/1167项通过**，类型检查与macOS arm64 debug app **210.40MiB构建通过**。
- 文件追溯154映射/20模板/2资源、媒体库35映射/14模板/4资源通过；本轮无Rust修改，沿用165通过/10既有忽略基线，既有reka-ui/useId与大chunk提示保持。组件证明错误处理接线，不把它当成真实阿里图片/CSP实屏验收；真实账号图片、菜单及840px/窄窗视觉仍需继续。
- 未操作真实账号/用户文件，Electron main工作区核对无改动；其他M5提供商能力、精确复制回执和M6入口继续，M5保持active，M6未开始。

日志：`/tmp/m5-image-fallback-focused.log`（前33项，后补2项已入全量）、`/tmp/m5-image-fallback-all.log`、`/tmp/m5-image-fallback-build.log`。


## 2026-11-08：阿里视频鉴权缩略图的原生私有图片通道

- 原mapper/PanRight模板保持；仅在model身份适配时，把原阿里视频快照URL映射到既有mscache协议的独立/file-thumbnail路由。img仍按原src绑定、按显示需要请求；不在列表读取前批量下载图片，不把Bearer/Cookie交给renderer。native从所属Aliyun账号调用既有Backend.request补鉴权，跟随既有网关策略取得图片。
- 前后端严格核对固定api.aliyundrive.com/v2/file/download、原video/snapshot,t_106000,f_jpg,ar_auto,m_fast处理参数、时间戳及drive/file身份；拒绝其他host、userinfo、额外/重复query、凭据query和整文件下载。private URI限本地协议来源及account/url/revision三字段。缓存身份绑定账号/账号用户与线路/drive/file/内容hash或更新时间，原t时间戳不导致重复缓存；复用原account_cache，退出账号清理策略保持，写入前后及返回前检查账号仍存在且用户/线路未变。
- 私有图片响应不设置public CORS星号，浏览器Cache-Control为no-store（错误响应亦no-store）；native只接受JPEG/PNG/WebP，最多8MiB，最多4个在途图片读取。公开TMDB路由原范围保持，不将任意provider URL接入公开cache。这是图片资源读取，不是M6传输引擎。
- 前端新10项、原生新3项边界回归；合计全量前端 **144文件/1160项通过**，类型检查通过。原生全量 **165通过/10既有忽略**（授权沙箱外合成本机HTTP监听），macOS arm64 debug app **210.40MiB构建通过**。文件追溯154映射/20模板/2资源、媒体库35映射/14模板/4资源通过；既有reka-ui/useId、大chunk及测试构建实验local命令警告保持。
- **验证边界**：新增测试证明URI/原始快照范围、账号/版本缓存键投影及既有缓存隔离/退出清理回归；没有真实阿里图片响应、最新包custom-scheme IPC/图片展示或Windows/Linux运行证据。因此上一轮“缺原生鉴权通道”现已实现，“真实缩略图展示待验收”仍保留，不能将代码和mock代替实图通过。其他提供商矩阵、精确复制回执、入口衔接与840px/窄窗菜单实屏继续。未操作真实账号/用户文件或Electron main；M5仍active，M6未开始。

日志：`/tmp/m5-private-artwork-focused.log`（前20项，后补2个URL拒绝参数已入全量）、`/tmp/m5-private-artwork-types.log`、`/tmp/m5-private-artwork-native-focused.log`、`/tmp/m5-private-artwork-native-all.log`、`/tmp/m5-private-artwork-all.log`、`/tmp/m5-private-artwork-build.log`。


## 2026-11-08：阿里正在观看/视频专辑原列表链路

- 从Electron main c2ce416的dirfilelist.ts直接提取getFileInfo、_FileListOnePage、原recentList/video list/compilation list方法及原响应接口/构造器；fileModelDrive.ts整文件原样迁入。原图标、拼音、大小/时间格式、媒体时长/尺寸/播放游标、违规标记、hash、description和分页排序处理保留；原模板不改。D6排除加密工具，DecodeEncName native边界保留原未解密分支，保留加密名/标记，不重新引入加密密码设置；账户级虚拟视频视图没有物理目录大小缓存。
- 通过原navigationOptions的正在观看入口及原PanTopbtn近期/全部专辑切换走专用接口，虚拟ID不当作实际文件夹请求。原recentList请求体为空且不支持分页marker；视频专辑沿原100条/marker/updated_at desc请求，跨页原500项上限保留。逻辑文件ID包住实际drive/file，专辑组使用video+compilationId视图key进入原compilation/list，修改只在native ID/导航适配边界。
- “正在观看”和“全部专辑”为并列面包屑，专辑内层级正常追加，Back回到原分类。响应/游标绑定账号与视图，拒绝错误业务响应、畸形项目、重复身份/重复marker，旧来源迟到结果不改新面板。原列表模型确实进入原store，不用泛型文本图标代替。
- 新增12项协议/原组件回归通过，包含原媒体字段、专辑嵌套、并列路径、500项跨页边界、异常响应、游标范围、切源及D6未解密显示分支。全量前端 **143文件/1150项通过**，类型检查与macOS arm64 debug app **210.33MiB构建通过**。文件追溯 **154映射/20模板/2资源**、媒体库35映射/14模板/4资源通过；本轮无Rust变更，沿用162通过/10既有忽略基线，既有reka-ui/useId及大chunk提示保持。
- **仍未验收**：真实阿里账号/近期列表或专辑接口实际结果、鉴权缩略图下载边界及原生菜单/窄窗视觉。原mapper产生的鉴权下载缩略图URL目前保留，但没有证明原生鉴权能随图片请求生效；默认图标显示或mock媒体字段不算缩略图通过。没有新增图片相册功能（D6仍排除）。其余提供商矩阵、精确复制回执和M6入口衔接继续。未操作真实账号/用户文件或Electron main；M5仍active，M6未开始。

日志：`/tmp/m5-ali-video-focused.log`（最终12项）、`/tmp/m5-ali-video-types.log`、`/tmp/m5-ali-video-all.log`（最终1150项）、`/tmp/m5-ali-video-build.log`。


## 2026-11-08：新包原生响应复查、用户确认弹窗正常、阿里清除历史

- 按既有重启授权打开键盘修正后210.33MiB包，同一用户profile读取testVideo21项；AX中工具栏Enter后仍在原目录，F5重新生成21项列表。右键动作只确认选中1/21，未获得可验收菜单。截图继续偶尔只显示背景；**用户本轮明确回复“弹窗正常显示”**，按截图工具差异记录，不据此改CSS或宣称应用弹窗不可见。菜单/窄窗/完整视觉矩阵仍未通过。UI阶段结束时关闭来源弹窗，没有云端/本机文件写操作。
- 本轮只读核对Electron main HEAD为c2ce416260706ff31a426a44d18ad1e414f864ad（外部任务推进，工作区干净）；两份新历史源快照已与该commit内容SHA逐一核对并写入各自upstreamCommit，旧快照基线不改。
- 从Electron AliFile.ApiUpdateVideoTime/AliFileCmd.ApiFileHistoryBatch直接抽取原方法，保留零游标字符串、openFile/video/updateRecord路径选择与每3项Promise.all编排；只替换提供商/账号路由、加入来源生命周期检查和native HTTP边界。原菜单clearHistory端口接账号所属实际drive/file复合ID解码，备份盘/资源盘分别提交；不让虚拟根或其他来源落入阿里默认分支。原进度写入设置默认true并在适配设置中保存；关闭时明确拒绝，避免原方法跳过请求后被当作成功。
- 同一来源重复激活复用在途操作；失败后释放锁，可重试，旧来源迟到结果不刷新新来源。只有全部请求被接受后刷新并取消选择，业务拒绝不清选区、不报成功。**这里确认的是请求被接受，未用真实账号核对服务端观看记录已归零。** 没有更新或清除本机媒体库的观看历史来冒充云端操作。
- 新增原浏览器9项测试，覆盖请求体、三项并发、双盘、业务拒绝、切源、设置关闭、根目录、重复提交及失败重试；全量前端 **142文件/1138项通过**，类型检查和macOS arm64 debug app **210.33MiB构建通过**。文件来源 **152映射/20模板/2资源**、媒体库35映射/14模板/4资源通过；本轮无Rust变更，沿用162通过/10既有忽略基线，既有reka-ui/useId及大chunk提示保持。
- 本轮新增历史端口包未再做真实账号/原生菜单验收；其他提供商能力、正在观看/专辑、精确复制回执、M6入口衔接及完整840px/窄窗键鼠菜单继续。M5仍active，M6未开始，Electron main工作区核对无改动。

日志：`/tmp/m5-ali-history-focused.log`（前7项，后补防重复/重试两项已入全量）、`/tmp/m5-ali-history-types.log`、`/tmp/m5-ali-history-all.log`、`/tmp/m5-ali-history-build.log`。


## 2026-11-08：恢复原生实屏检查与控件键盘事件隔离

- Mac已可访问，按既有授权从UI退出旧应用并打开刚构建的Box阶段210.33MiB候选；保留原profile，未登录账号/填充测试账号/修改用户文件。从文件首页→添加文件源→Mac→testVideo，原生IPC读取 **21项**（含calibration目录），进入calibration读取 **4项**。观察列表/缩略图/大图实际切换；Cmd+A选中21/21，取消已选恢复0/21；当前目录near black筛选从4项到1项，清空恢复4项，最后恢复列表并关闭来源弹窗。
- CUA初始AX点击后截图停留背景，但前台键盘Tab后显示真实来源弹窗/列表；随后能连续观察筛选和布局截图，不能把早期截图差异认定为CSS不可见并据此修改样式。坐标点击有一次noWindowsAvailable，重新读取AX正常且应用清单仍running；没有将其当崩溃或自行另起profile。证据为本chat CUA原生截图/AX，不声称已测出精确CSS尺寸或通过完整840px/窄窗矩阵。
- 检查发现适配层keydown.capture拦截全部Enter/空格/方向键，焦点在工具栏按钮时也可能触发原列表打开。只改SourceDriveManager适配边界：无修饰的激活/导航键交给button/link/menuitem/option/tab；Cmd/Ctrl快捷键与列表本身仍走原处理器，输入框隔离保留。原PanRight、模板和keyboardhelper不改。新增回归证明控件事件不被preventDefault/不触发native打开，焦点在控件时Cmd+A仍选择3项。
- 定向原组件16项通过；全量前端 **141文件/1129项通过**，类型检查及macOS arm64 debug app **210.33MiB构建通过**。文件追溯150映射/20模板/2资源、媒体库35映射/14模板/4资源通过。本轮无Rust变更，沿用162通过/10既有忽略基线；既有reka-ui/useId及大chunk提示保持。
- **证据边界**：本轮原生UI检查发生在上述键盘修正之前，修正后候选尚未重启复验；排序下拉、右键、属性等嵌套弹窗及窄窗口仍未验收，不能以三种布局可见替代。其他提供商能力、精确复制回执和M6入口衔接继续。M5仍active，M6未开始，Electron main工作区核对无改动。

日志：`/tmp/m5-native-keyboard-focused.log`、`/tmp/m5-native-keyboard-all.log`、`/tmp/m5-native-keyboard-build.log`。


## 2026-11-08：Box原内存文本函数与固定上传域名

- 从Electron Box upload.ts直接迁入apiBoxUploadBuffer及其原FormData/属性构造、conflict处理和50MB限制声明；Blob/Uint8Array保留原逻辑，Node Buffer仅用类型别名适配。原函数的boxUploadRequest底层改为在本地序列化原FormData，再经native原始HTTP发送；不引入磁盘、会话、分片、预检或传输引擎。原共享文本弹窗保持，Box按实际端口启用upload.memory。
- native只为已授权api.box.com的Box账号允许精确https://upload.box.com/api/2.0/files/content POST；其他路径/方法/query/fragment/userinfo/相似域名拒绝。新增Box端点边界与实际临时DB/内存vault鉴权头注入测试；保留Dropbox边界回归。创建前核对实际目录，创建后核对ID/名称/父目录/类型/长度/回收状态；409错误体即使含entries也不作为成功数据。
- 新增Box底层11项及原弹窗1项通过；快捷键能力覆盖Box已接及光鸭文本暂未接。全量前端 **141文件/1128项通过**，类型检查通过；原生全量 **162通过/10既有忽略**（授权沙箱外合成HTTP监听），macOS arm64 debug app **210.33MiB构建通过**。文件追溯 **150映射/20模板/2资源**、媒体库35映射/14模板/4资源通过，既有reka-ui/useId、大chunk及测试构建实验命令警告保持。
- 验收矩阵同步四家文本端口和光鸭移动/复制/回收的当前证据，删除光鸭在“全部待接”行的重复项；不是将真实账号、精确复制回执或实屏标通过。未知提交恢复及其他提供商文本/保留能力、M6入口衔接与完整840px/窄窗/键鼠菜单实屏继续。无真实账号/用户文件操作，Electron main工作区核对无改动；M5保持开发中，M6未开始。

日志：`/tmp/m5-box-text-focused.log`、`/tmp/m5-box-text-types.log`、`/tmp/m5-box-text-native-focused.log`、`/tmp/m5-box-text-native-all.log`、`/tmp/m5-box-text-all.log`、`/tmp/m5-box-text-build.log`。


## 2026-11-08：Dropbox原三次重试及错误响应保留

- 从既有Electron upload快照抽取原uploadBufferWithRetry及parseDropboxContentError，原函数体、最多3次循环和800/1600/2400ms等待保留；Uint8Array类型别名代替Node Buffer类型，Sleep/native请求通过边界导入。原accessToken形参在本适配中只承载本地账号ID，native请求shim逐次解析所属账号并调用保险库鉴权端口，不读取/返回真实token。未引入后台传输队列。
- 通用transport拆出rawRequest保留非2xx状态/body，原request继续原有状态错误行为；仅Dropbox原协议错误解析使用raw端口，避免409同名冲突被提前丢为通用错误。Unicode内容和原refuse提交参数各次重试保持一致；账号在等待时退出不再发下一次请求。
- 新增原时序/账号退出回归及raw/普通HTTP端口两项测试；定向18项通过。全量前端 **140文件/1115项通过**，类型检查和macOS arm64 debug app **210.31MiB构建通过**。文件追溯149映射/20模板/2资源、媒体库35映射/14模板/4资源通过；本轮无Rust修改，沿用上一轮原生160通过/10既有忽略基线；既有reka-ui/useId、大chunk提示保持。
- 上一轮“Dropbox原三次重试待迁入”已补齐；未知提交结果、跨重启幂等、真实账号及原生界面仍未验收，不因此把整个M5标完成。其他提供商文本/保留能力、精确复制回执、M6入口衔接及完整840px/窄窗键鼠菜单实屏继续。Electron main工作区核对无改动；无真实账号/用户文件写入，M6未开始。

日志：`/tmp/m5-dropbox-retry-focused.log`、`/tmp/m5-dropbox-retry-types.log`、`/tmp/m5-dropbox-retry-all.log`、`/tmp/m5-dropbox-retry-build.log`。


## 2026-11-08：Dropbox原文本提交参数及native内容域名边界

- 从Electron upload.ts抽取toDropboxWriteMode/buildDropboxCommitInfo，沿用既有原buildDropboxChildPath、refuse/add/autorename=false与原版文本弹窗。编辑框UTF-8内容用原POST /2/files/upload提交，Dropbox-API-Arg中的非ASCII字符转为等值JSON Unicode转义，避免原生HTTP头拒绝中文/emoji；不把token传入renderer，不接磁盘/会话/分片/任务引擎。
- native Accounts.authorize只为已授权https://api.dropboxapi.com的Dropbox账号额外允许精确https://content.dropboxapi.com/2/files/upload POST，拒绝其他路径/方法/query/fragment/userinfo/相似域名及错误provider。不扩展持久化auth_origins；保险库凭据覆盖renderer同名鉴权头。新增2项native测试验证固定端点与实际账号/vault头注入，纯临时DB和内存vault，没有访问OS真实凭据。
- 写前解析父目录ID到实际路径；写后读取实际文件ID/名称/路径/长度确认。原版uploadBufferWithRetry的三次重试还未迁入，未知创建结果及跨重启恢复也未完成；不能以当前提交路径和元数据检查认定Dropbox完整文本链路验收通过。其他提供商文本仍有缺口。
- 新增Dropbox10项底层及1项原弹窗组件通过；最终全量前端 **139文件/1111项通过**，类型检查通过。原生全量在授权沙箱外合成本机HTTP监听环境 **160通过/10既有忽略**，macOS arm64 debug app **210.31MiB构建通过**。来源验证文件 **149映射/20模板/2资源**、媒体库35映射/14模板/4资源通过；既有reka-ui/useId、大chunk及测试构建中实验local命令警告保持。
- 未访问真实账号/用户文件或修改Electron main；没有最新包真实IPC/实屏验收。M5仍开发中，其他提供商能力、原重试语义、精确复制回执、M6入口衔接及完整840px/窄窗/键鼠菜单实屏继续，M6未开始。

日志：`/tmp/m5-dropbox-text-focused.log`、`/tmp/m5-dropbox-text-types.log`、`/tmp/m5-dropbox-text-native-focused.log`、`/tmp/m5-dropbox-text-native-all.log`、`/tmp/m5-dropbox-text-all.log`、`/tmp/m5-dropbox-text-build.log`。


## 2026-11-08：OneDrive原文本路径与弹窗接线

- 从Electron main的onedrive/upload.ts原样抽取encodePathSegment/buildOneDriveSmallUploadPath，新增快照及hash；保留原PUT/application/octet-stream/250MB限制和原同名写入语义。native适配仅发送编辑框UTF-8文本，账号凭据留原生；未接磁盘、上传会话、分片或任务引擎。原共享文本弹窗不改，Google/OneDrive按实际端口启用upload.memory。
- 写前确认实际根或指定文件夹ID；写后确认实际文件ID/名称/父目录/长度/file facet/回收状态，HTTP/业务错误和异常详情不报成功。未知提交结果仍需先刷新目标，不能声称跨重启幂等或真实账号创建通过。
- 新增OneDrive12项底层及1项原弹窗验证；与既有Google合计26项定向通过。第一次全量有1项旧快捷键断言仍假定OneDrive文本不支持；改成OneDrive支持/Box暂未接入两种能力的明确断言，没有skip。最终全量 **138文件/1100项通过**，类型检查与macOS arm64 debug app **210.31MiB构建通过**。文件追溯 **148映射/20模板/2资源**、媒体库35映射/14模板/4资源通过；无Rust修改，不重复原生单元测试，既有reka-ui/useId及大chunk提示保持。
- 无真实账号、用户文件操作或最新实屏/真实IPC验收；Electron main工作区核对无改动。其他提供商文本/保留能力、精确复制回执、M6入口衔接及完整840px/窄窗/键鼠菜单实屏仍需继续。M5保持开发中，M6未开始。

日志：`/tmp/m5-onedrive-text-focused.log`、`/tmp/m5-onedrive-text-types.log`、`/tmp/m5-onedrive-text-all.log`（最终1100项）、`/tmp/m5-onedrive-text-build.log`。


## 2026-11-08：Google原文本创建弹窗的native接线

- 从Electron main的google/upload.ts直接抽取buildGoogleMultipartUploadBody，原multipart头尾、metadata和UTF-8内容构造不改，新增快照/hash追溯；仅为编辑框内存文本接原multipart endpoint，不迁磁盘/分片/resumable上传和任务引擎。原文本弹窗、表单、提交中状态、失败保留及成功刷新/关闭逻辑保持原版。
- SourceDriveManager对Google接upload.memory能力，DriveUploadMem.UploadMem/createTextDirect进入独立native请求适配器；鉴权留native，不返回或伪造access_token。先读取实际目标文件夹ID，再用原multipart body发送Unicode文本；创建后读取实际ID/名称/父目录/文件长度/回收状态确认。加密创建仍明确拒绝。其他提供商文本接口尚未完成，不能以仅Google接线认定#15整体完成。
- 新增底层11项、原组件2项通过，覆盖Unicode、目标身份、HTTP/业务错误、创建后冲突、账号移除、原弹窗成功刷新/失败保留。全量前端 **137文件/1086项通过**，类型检查和macOS arm64 debug app **210.31MiB构建通过**；文件追溯 **147映射/20模板/2资源**、媒体库35映射/14模板/4资源通过。无Rust修改，沿用最近原生158通过/10既有忽略基线；既有reka-ui/useId、大chunk提示保持。
- 无真实账号/用户文件操作或最新包真实IPC/实屏证据；超时或未知创建结果需先刷新目标确认，不将当前实现描述为跨重启幂等。Electron main工作区核对无改动，M5仍开发中，其他提供商矩阵/文本、精确复制回执、M6入口衔接及完整840px/窄窗/键鼠菜单实屏继续；M6未开始。

日志：`/tmp/m5-google-text-focused.log`、`/tmp/m5-google-text-types.log`、`/tmp/m5-google-text-all.log`、`/tmp/m5-google-text-build.log`。


## 2026-11-08：光鸭原搜索声明与原列表模型

- 从Electron main bbee219dd5159c7c26473fb2fbaf5a05d351420e 的src/guangya/search.ts迁入apiGuangyaSearch原声明，新增源码快照/hash校验；原函数保留通配父目录“*”、原最多读取200项后的忽略大小写名称筛选及默认30条上限。它不是完整服务端无限分页搜索，不增加nextCursor或夸大搜索范围。原模型drive_id仅由适配器绑定实际账号，保留图标、缩略图、hash及原父目录用于打开位置。
- SourceDriver.search接原浏览器导航和能力入口；参数/账号/重复ID/异常元数据检查在native适配边界。原metadata的message.error边界改为向作用域调用方抛错，防止原列表catch后吞错为空搜索；抽取的原声明体不变。新建/重命名详情回退链路一并回归通过。
- 定向56项通过；新增原组件searchMovie导航/原模型进入store验证。全量前端 **135文件/1073项通过**，类型检查与macOS arm64 debug app **210.31MiB构建通过**；文件追溯 **146映射/20模板/2资源**、媒体库35映射/14模板/4资源通过。无Rust变更，未重复原生单元测试；既有reka-ui/useId及大chunk提示保持。
- 没有真实账号或用户文件操作；Electron main HEAD及干净工作区只读核对。无新包真实IPC/实屏证据，M5仍开发中，其他提供商保留能力、强复制回执、M6入口衔接及完整840px/窄窗键鼠/菜单实屏矩阵仍待继续；M6未开始。

日志：`/tmp/m5-guangya-search-focused.log`、`/tmp/m5-guangya-search-types.log`、`/tmp/m5-guangya-search-all.log`、`/tmp/m5-guangya-search-build.log`。


## 2026-11-08：光鸭复制迟到确认隔离

- 修复旧并发调用的迟到确认可能清除较新复制待确认记录的竞态；成功/预提交失败清理都先比较记录身份。复制入口捕获提交时的文件元数据，避免等待列表期间原选择对象被改名或改大小后改变确认条件。新增真实异步顺序组件外回归验证两轮并发复制只有两次提交，旧调用不能删除新一轮记录；另验证元数据快照。
- 定向复制14项通过；全量前端 **134文件/1062项通过**，类型检查及macOS arm64 debug app **210.31MiB构建通过**。本轮没有原模板/Rust修改，不重复来源映射/原生单元基线；没有真实账号/用户文件/最新实屏验收。日志：`/tmp/m5-guangya-copy-races.log`、`/tmp/m5-guangya-copy-races-all.log`、`/tmp/m5-guangya-copy-races-build.log`。
- 目录差异仍非提供商操作ID证明，之前标注的并发同名/递归一致性/进程重启缺口不因此完成。其他M5提供商保留能力、入口与完整原生840px/窄窗检查继续；M5保持active，M6未开始，Electron main工作区核对无改动。


## 2026-11-08：光鸭原复制和回收操作接线

- 从既有Electron filecmd快照直接抽取apiGuangyaCopyBatch/apiGuangyaTrashBatch，保留原函数体、请求路径/body及返回约定，更新来源hash；原transport接copy_file/delete_file，验证文件ID集合与目标。原moveBatch/copyBatch/trashBatch接同一原版浏览器动作，复制不删除源条目，回收成功继续走既有媒体库同步。
- 复制适配器在提交前记录目标目录ID，原请求业务成功后再列出目标，按新增ID/名称/类型/文件大小/已有内容hash匹配唯一副本；未出现或存在多个候选均不报完成。并发点击共享一次提交，待确认重试只查询。**这是目录差异确认，非提供商操作ID证明**；同名并发写入仍可能混淆，真实账号及目录递归内容一致性未验收，不能声明精确回执已完成。待确认记录只在本进程内保留，不是持久化传输队列；重启后需先核对目标，不能宣称跨重启去重通过。业务/传输未确认的受理结果保留未知状态，后续偶然出现同名条目也不报成功。
- 光鸭原能力声明支持trash.move但recycleBin=false：接原回收请求和部分失败，不新增回收站列表/还原/清空/彻底删除能力。复制/回收原组件新增两项验证，底层复制12项、回收6项通过。最终全量前端 **134文件/1060项通过**，类型检查和macOS arm64 debug app **210.31MiB构建通过**。文件追溯145映射/20模板/2资源、媒体库35映射/14模板/4资源通过；无Rust修改，沿用最近原生158通过/10既有忽略基线，既有reka-ui/useId和大chunk提示保持。
- M5保持开发中：其他提供商及光鸭剩余保留能力、强复制结果回执/不确定结果恢复、M6入口衔接及完整840px/窄窗/菜单键鼠实屏仍待继续。未访问真实账号、用户文件或修改Electron main；未开始M6。实屏环境最近明确为Mac锁屏，不把本轮测试/构建当真实IPC与原生UI验收。

日志：`/tmp/m5-guangya-copy-focused.log`（最终27项）、`/tmp/m5-guangya-actions-focused.log`（33项，后补回收组件前）、`/tmp/m5-guangya-actions-all.log`、`/tmp/m5-guangya-actions-build.log`。


## 2026-11-08：光鸭原移动方法与目标确认

- 从既有 Electron filecmd.ts 快照抽取原 apiGuangyaMoveBatch，函数体/参数保留并更新追溯hash。原生传输白名单接原 move_file，请求验证 fileIds/parentId；移动前确认目标文件夹，移动后通过原详情函数确认同一文件ID、名称、类型及目标父目录。未确认的项目按原批量返回结构进入失败列表，不凭HTTP成功同步媒体库。
- 原 SourceDriveManager 的 moveBatch 接该方法，沿用已有目标祖先校验、部分成功/失败、来源切换停止、媒体库目录更新。新增8项底层协议/结果确认及1项原组件动作验证。光鸭复制端口仍未完成，明确保留为M5缺口，不能因暂未开放菜单而计验收通过；回收/其他保留能力也需继续。
- 定向45项通过（新增组件前），最终原组件6项通过；全量前端 **132文件/1040项通过**；类型检查和macOS arm64 debug **210.31MiB构建通过**。文件追溯145映射/20模板/2资源通过，本轮无Rust修改，不重复原生单元测试；既有reka-ui/useId及大chunk提示保持。
- 原生界面工具本轮再次明确返回Mac锁屏/无法自动解锁；未启动替代profile、未操作用户文件或真实账号，不把自动测试代替真实IPC/840px/窄窗实屏。既有解锁问题仍待回复，独立源码工作继续。Electron main工作区无改动，M5保持开发中，M6未开始。

日志：`/tmp/m5-guangya-move-focused.log`、`/tmp/m5-guangya-move-component.log`、`/tmp/m5-guangya-move-types.log`、`/tmp/m5-guangya-move-all.log`、`/tmp/m5-guangya-move-build.log`。


## 2026-11-08：光鸭原版列表与文件模型贯通

- 直接抽取 Electron dirfilelist.ts 原 apiGuangyaFileListPage/mapGuangyaFileToAliModel 声明，原请求体、图标/拼音/类型/大小日期格式、MIME、缩略图、哈希和 description 保留，来源快照及目标校验同步。SourceDriveManager 使用原模型，仅将根 parent_file_id 转为界面根身份，并适配 video2 播放分类。
- 列表通过原生账号绑定请求，页码仍从0开始，每页100。游标绑定账号与父目录；拒绝重复标识/整页、错误父目录、异常大小/时间/缩略图、超出安全范围的数字ID、请求期间移除账号，以及没有实际数组的畸形响应。有效空数组正常结束，不用“空列表”掩盖协议失败。未向真实账号发请求。
- 定向协议/列表/操作/原组件 **39项通过**；后补原模型进入原版store的组件用例，该组件文件 **5项通过**。全量前端 **131文件/1030项通过**（后补该1项前），类型检查通过。来源验证文件 **145映射/20模板/2资源**、媒体库 **35映射/14模板/4资源**通过。macOS arm64 debug app **210.31MiB构建通过**，仍有既有reka-ui/useId和大chunk提示。本轮无Rust改动，原生单元测试沿用最近158通过/10既有忽略基线；构建不代替真实IPC/实屏验收。
- M5仍在开发，其他提供商保留操作、下载/上传/任务入口衔接、完整840px/窄窗/键鼠/菜单实屏矩阵仍待完成；真实账号检查后置，M6未开始。Electron main工作区核对无改动。

日志：`/tmp/m5-guangya-list-focused.log`、`/tmp/m5-guangya-list-component.log`、`/tmp/m5-guangya-list-types.log`、`/tmp/m5-guangya-list-all.log`、`/tmp/m5-guangya-list-build.log`。


## 2026-11-08：本机物理目录名与网盘虚拟状态隔离

- 修复本机真实目录叫root/backup_root/search/search2026/trash/favorite/recover/pic/pic_root/mypic/color-red/video-all/refresh/back等时被当作根别名、搜索条件、回收站类型或导航命令的错误。物理路径只用于native IO与收藏；界面目录key经localDirectoryKeys隔离。原PanRight、panfilestore与弹窗模板不改，不将此问题绕过为禁用这些合法目录名。
- 本机打开目录、初始收藏路径和面包屑使用独立view key；store.SelectDirType保持普通pan，标题和图标按真实目录显示，trash不再显示回收站图标。实际文件file_id/path及player_open_local参数不编码；对看似内部key的真实目录名也只解码界面封套一次，不把%2F当成路径分隔符。收藏/扫描读取model.path，避免把界面key存入收藏或送进扫描器。
- 原排序端口优先读新view key，缺少时兼容旧物理路径排序记录（根目录旧backup_root记录）；新排序写入隔离key，不覆盖旧记录，root与重名目录不再共用新偏好。
- 新增23项本机保留能力组件回归，涵盖17种目录名、4种已存储收藏初始路径、原路径扫描/播放/返回与排序兼容。定向含既有目录树/属性/原浏览器共 **41项通过**；全量前端 **130文件/1010项通过**、类型检查通过。来源验证文件145映射/20模板/2资源，媒体库35映射/14模板/4资源通过。本轮无Rust修改，未重复原生单元测试，最近原生基线158通过/10既有忽略。
- macOS arm64 debug app **210.31MiB构建通过**（仍有既有reka-ui/useId和大chunk提示）；没有新包真实IPC/实屏证据，没有真实账号请求、用户文件改动或本机物理写管理入口。后续仍需完成其他网盘保留功能、下载/上传入口衔接及完整840px/窄窗/选择键盘/原生菜单视觉矩阵。M5保持开发中，M6未开始，Electron main核对无改动。

日志：`/tmp/m5-local-directory-names-focused.log`、`/tmp/m5-local-directory-names-types.log`、`/tmp/m5-local-directory-names-all.log`、`/tmp/m5-local-directory-names-build.log`。


## 2026-11-08：按第3.5节纠正来源类型边界；光鸭原新建/重命名

- **范围纠正，以此覆盖此前把本地物理CRUD列为M5门槛的记录。** feature-inventory.md 第3.5节明确：网盘/WebDAV/AList按提供商能力承接网盘管理；本机仅浏览、预览、加入媒体库，下载是复制到下载目录（引擎归M6）；媒体服务器仅浏览/播放/下载/收藏。Electron FileSourceBrowser 的本地rename/remove只是收藏名称/移除收藏；MediaLibrary.deleteMediaFromMenu明确deleteRecordOnly。此前新增的本机物理创建/改名/移动/私有回收不是复原原版所必需，不再要求它们完成才能结束M5，也不把它们计为原版对齐证据。
- 本机files.createFolder/upload.memory/files.rename/files.move能力撤回；直接管理action同样拒绝，收藏/媒体记录操作及浏览/本地播放不受影响。local_file_create/rename/move从invoke清单移除，写原型及相关Rust入口保留为cfg(test)代码，避免随产品构建暴露；已产生开发日志的恢复/偏好确认保留，不能因范围修正遗弃已有日志。旧本机CRUD正向组件断言改为16项实际保留能力/写前拒绝/播放绑定测试，原纯算法/日志/子进程恢复测试保留。失效的本机创建测试未被skip；目录树/属性迟到回调用实际可用的只读弹窗重新验证。
- 光鸭apiGuangyaMkdir/apiGuangyaRename及所依赖原metadata/根列表回退函数按原声明迁入，原函数体及请求body保留。来源快照逐字校验；新文件单独记录Electron main当前commit bbee219dd5159c7c26473fb2fbaf5a05d351420e，不覆盖原de033基线。native账号请求替代渲染器token，限制文件端点和参数，保留2xx语义；验证业务状态、ID安全数值、实际详情ID/名称/类型及父目录，不以缺详情的HTTP成功冒充完成。原局部error交由作用域宿主显示，避免旧来源toast。
- 光鸭16项定向通过（协议12/原弹窗4）；范围定向45项、只读弹窗补测5项通过。最终全量前端 **129文件/987项通过**；类型检查通过；原生全量 **158通过/10既有忽略**，cfg(test)阶段有5个仅测试命令原型unused警告；产品原生构建无此前23项原型dead-code警告。文件来源 **145映射/20模板/2资源**，媒体库35映射/14模板/4资源通过；最终macOS arm64 debug app **210.31MiB构建通过**，前端仍有既有reka-ui/useId和大chunk提示。
- Box官方文档、GitHub连接器及只读下载本轮均无法连接，未据不可靠搜索摘要猜Box临时取链协议。仍待补Box/其他来源实际取链和完整操作矩阵、网盘文本创建、本机下载入口的M6接口衔接、全部840px/窄窗/原生菜单及浏览导航验收；本机路径与虚拟目录同名的浏览边界也待专门验证。真实账号后置；本轮没有请求真实账号或改变用户文件，未做新包真实IPC/实屏，M5仍未完成，M6未开始，Electron main核对无改动。

日志：`/tmp/m5-guangya-mutations-focused.log`、`/tmp/m5-guangya-mutations-all.log`（范围修正前984项）、`/tmp/m5-source-scope-focused.log`、`/tmp/m5-source-scope-dialogs.log`、`/tmp/m5-source-scope-types.log`、`/tmp/m5-source-scope-all.log`（最终987项）、`/tmp/m5-source-scope-native-final.log`、`/tmp/m5-source-scope-build.log`。


## 2026-11-08：原本地目录选择/拖放移动接线

- 注册local_file_move；校验注册来源、真实父目录、同来源相对路径、嵌套来源与符号链接，按原文件名移动，不允许覆盖/自己或子目录。先投影偏好检查目标冲突，使用已接的journal+catalog+positions事务，完成偏好确认后才返回成功。仍与播放转换互斥并要求关闭播放器，跨卷rename仍明确拒绝而非静默复制删除。
- 本地files.move能力接原ApiMoveBatch：继续使用原SelectPanDirModal、menuCopySelectedFile(cut)、dropMoveSelectedFile与原返回ID/选择清理/目录刷新流程，没有另写选择器或拖放UI。目标/选择限定同来源；操作前取消此来源扫描，逐项记录成功与失败。实际路径变更由与重命名共用的适配器确认，批次内目录变化可解析后续路径；同步后的catalog回读，不再对路径身份套用远端稳定IDpatch。
- 补服务测试：目标根目录、保留basename、IPC响应丢失后的确认、前序目录恢复后的源/目标路径转换、无效父目录及偏好失败。原组件覆盖真实迁入的cut选择器与dropMove命令、部分失败只重试失败项、原位置/子目录写前拒绝。当前本地files.copy未接，不把隐藏未接能力算完成。
- 第一次原生全量157通过/1失败/10忽略，暴露SIGKILL检查点测试时序问题：kill发出后回调能继续返回。测试回调现在kill成功后停在pause循环直到信号终止，并在恢复前先断言prepared阶段未移动文件；三个检查点随后重复6轮均通过，再跑最终原生全量 **158通过/10既有忽略**。这是测试夹具检查点修正，不把首次失败从验收记录中抹去。
- 最终前端 **127文件/969项通过**，定向 **34项通过**，类型检查通过；原生local_定向 **28通过/1既有忽略**（最终pause修正前），最终全量为上述158/10。来源验证：文件143映射/20模板/2资源，媒体库35映射/14模板/4资源。macOS arm64 debug app **210.81MiB构建通过**（仍有原回收原型2项dead-code、既有reka-ui/useId及大chunk提示）。
- 本轮仍只有合成native组件调用及临时目录/独立测试子进程实测，没有操作用户文件或真实账号，也未做新包真实IPC/840px/窄窗实屏。完整Tauri应用中断/偏好跨进程确认、播放期间改名/移动、本地复制/回收恢复和其他提供商剩余矩阵均待继续；M5不完成，M6未开始。Electron main核对无改动。

日志：`/tmp/m5-local-move-focused.log`、`/tmp/m5-local-move-types.log`、`/tmp/m5-local-move-all.log`、`/tmp/m5-local-move-native-focused.log`、`/tmp/m5-local-move-native-all.log`（最终结果）、`/tmp/m5-local-move-process-stress.log`、`/tmp/m5-local-move-build.log`。


## 2026-11-08：原版本地单项/批量重命名接线

- 注册local_file_rename，复用同一文件名/来源/嵌套来源校验与journaled relocate。请求携带当前文件偏好，native先投影检查收藏冲突，再改变文件；回执只返回schema/source/from/to/directory/operationId，不把内部inode/全目录快照作为重命名回执返回。与playback_transition互斥；当前仍要求关闭任何活动播放器后执行本地重命名，避免旧队列/进度键继续写入，此边界不能描述成已验证边播边改名。
- 原RenameModal/RenameMultiModal模板及原重命名算法不改，SourceDriveManager本地能力和原renameBatch命令接专用适配器。每项在写文件前取消当前来源扫描；native完成catalog/positions事务后，重放收藏偏好并ack，再回读catalog，不再用remote稳定ID的改名patch覆盖本地路径身份。部分成功按原file_id返回原弹窗，只重试失败项。
- 本地源的原版批量树把file_id当稳定句柄，实际是相对路径。本浏览器适配层在弹窗存续期间保留路径过渡，将旧树键/子目录加载转换到实际路径；原弹窗继续用原键更新预览与选择。弹窗关闭时刷新实际路径ID并清掉临时过渡/目录缓存，来源切换也清理，未修改原树算法。已接受的旧来源操作仍完成其偏好同步，新来源UI不接迟到回调，后续批次停止。
- 提交前已恢复成功的同一改名无需重提；IPC丢失但恢复回执证明同一from/to则确认结果。若用户在恢复后改用不同新名称，先把旧句柄翻译到当前真实路径再提交，不要求多失败一次。prefs写入/ack失败仍保留native日志而不报完整成功。
- 补catalog事务保护：存在未确认本地日志时，普通catalog.save及source removal拒绝覆盖，避免旧扫描/跨窗操作丢失新路径身份。日志自己的元数据事务不走此公共写接口；ack后恢复普通写入。新增原生测试验证拒绝与ack后恢复。
- 最终前端定向 **27项通过**（service14、恢复9、原组件4）；全量前端 **126文件/953项通过**；类型检查通过（最终包内再次执行）。原生local_定向 **24通过/1既有忽略**，全量 **154通过/10既有忽略**；文件来源143映射/20模板/2资源、媒体库35映射/14模板/4资源通过。最终macOS arm64 debug app **210.70MiB构建通过**，仍有既有reka-ui/useId、大chunk和原回收原型2项dead-code提示。
- 本轮原弹窗走合成native端口，原生文件测试只用临时目录；没有改用户文件/真实账号，也未重启最新包做真实IPC/实屏。此前最后实屏检查仍为Mac锁屏。**仍须继续**：应用/子进程实际中断恢复验收、完整批量树/父子目录实屏矩阵、本地移动及回收恢复接线、其他M5提供商与菜单/窄窗等缺口。不能以本地改名子项完成认定整个M5完成；M6未开始，Electron main核对无改动。

日志：`/tmp/m5-local-rename-focused.log`、`/tmp/m5-local-rename-types.log`、`/tmp/m5-local-rename-all.log`、`/tmp/m5-local-rename-native-focused.log`、`/tmp/m5-local-rename-native-all.log`、`/tmp/m5-local-rename-build.log`。


## 2026-11-08：主界面启动恢复与收藏偏好确认

- 注册 local_operations_recover / local_operation_preferences / local_operation_ack 三个恢复端口，主窗在fileSources.refresh、catalog.load和定时扫描之前调用。恢复与播放器使用既有playback_transition互斥；存在待处理日志且播放器会话仍活跃时拒绝恢复，提示先关闭播放器，而不在播放中改进度身份。native工作放spawn_blocking，不在UI线程执行SQLite/文件检查。
- 前端localRecovery.ts按native applied回执请求原生收藏投影；核对操作ID/来源，保存并读回tauri.filePreferences，再更新Pinia偏好并ack日志。存储失败、回执错误、ack丢失都保留native日志；已保存的路径过渡可幂等重放。投影期间用户改了偏好就基于最新文档重算（最多3次），不覆盖迟到期间的其他收藏/显示设置；并发初始化共用一次恢复。失败会阻止本次初始化继续加载媒体库/启动扫描，并显示现有错误提示，不能带未恢复数据继续扫描。
- 加固日志读取：SQLite主键/source_id必须与body里的ID/来源一致且操作ID为UUID，不一致不恢复；新增临时数据库损坏回归，未动文件。
- 9项前端定向测试通过；全量前端 **124文件/935项通过**、类型检查通过；原生local_定向22通过/1既有忽略（损坏日志补测前），最终原生全量 **153通过/10既有忽略**。来源验证文件143映射/20模板/2资源、媒体库35映射/14模板/4资源通过。native生产引用后dead-code从21降至4（原回收原型2项、尚未开放的snapshot/relocate 2项），不隐藏警告。
- macOS arm64 debug app构建 **210.54MiB通过**（既有reka-ui/useId、大chunk及4项dead-code提示仍在）。本轮界面工具再查明确Mac锁屏，未执行新包真实IPC/实屏或应用进程杀死后重启验收，尚不能把mock invoke与临时目录恢复测试当作完整运行验收。
- **仍须继续**：实际local relocate写命令与原版重命名/移动UI接线、活动播放器/扫描并发、跨进程中断与偏好恢复实测；本地回收/恢复也未接此日志。恢复端口存在不等于全部本地文件操作完成。没有真实账号请求、用户文件修改或Electron main改动；Tauri仍为feat/tauri-migration，M5开发中，M6未开始。

日志：`/tmp/m5-local-recovery-focused.log`、`/tmp/m5-local-recovery-types.log`、`/tmp/m5-local-recovery-all.log`、`/tmp/m5-local-recovery-native-focused.log`、`/tmp/m5-local-recovery-native-all.log`、`/tmp/m5-local-recovery-build.log`。


## 2026-11-08：本地重命名/移动持久化意图与元数据恢复（尚未公开）

- 新增 local_journal.rs，将前一轮纯身份投影接入实际临时目录移动与SQLite恢复：先FULL同步写入source唯一的操作意图，再执行不覆盖目标的原子rename及双亲目录sync；同一SQLite事务更新catalog、全部快照普通文件的positions（包括未扫描文件）和applied日志。只有UI持久化收藏偏好后才能ack清理；在此之前阻止同来源继续新操作，避免丢失路径过渡。
- 恢复不重复移动/删除文件：原路径身份一致且目标确实不存在时取消未开始意图；原路径确实不存在且目标dev/inode/type与日志一致时只补元数据；两侧并存、不同inode、权限/缺失/来源根变化等不明确状态保留日志并报错，不猜测。不把一般metadata错误当作NotFound。applied与catalog/positions同事务写入，重复恢复不再次递增revision。
- 写前检查catalog身份/集合碰撞及已知目标进度碰撞；恢复中的冲突回滚全部数据库更新并保留日志。目录快照拒绝符号链接、注册的嵌套来源和特殊文件；采用迭代遍历及文件/目录上限。跨卷移动不回退到删除/复制；非Unix稳定文件身份仍待实现。未加入传输引擎。
- **9项定向测试通过**，覆盖真实临时目录改名/目录移动、未扫描播放进度、手工标题/集合、意图后未移动/移动后未提交的模拟中断、重复数据库恢复、来源ack校验、冲突事务回滚、写前拒绝及嵌套来源/符号链接。最初夹具使用/var临时目录别名导致身份断言失败，现按实际Library规范路径修正，最终全量原生 **152通过/10既有忽略**。这是模拟中断/重新打开数据库，**尚非真实应用进程被杀再启动验收**。
- 当前还没有公开invoke或接原版重命名/移动弹窗；前端偏好重放与ack、启动恢复调用、活动播放器/扫描并发协调仍须接完。回收/恢复原型也尚未接此日志，不能据重命名/移动测试认定本地回收通过。新模块目前尚无生产入口，当前21项dead-code警告如实保留；本轮未重复前端/原生app打包或实屏，最新UI包仍为此前210.10MiB。
- 测试仅操作tempfile目录和临时数据库，没有改用户文件/真实账号；Tauri保持feat/tauri-migration，Electron main核对为空。M5继续，M6未开始。

日志：`/tmp/m5-local-journal-focused.log`、`/tmp/m5-local-journal-native-all.log`。


## 2026-11-08：本地重命名/移动身份投影（尚未接写命令）

- 核对当前真实数据链：本地 list 的 row.id 是绝对规范路径 SHA256，catalog item.id 为 JSON[sourceId,row.id]，fileId 是相对路径；播放器位置键则是 SHA256(JSON[sourceId,"local",绝对路径SHA256])。不能只更新显示名或相对路径，否则重扫会产生新身份并丢失关联。
- 新增 local_identity.rs 作为后续操作日志事务的纯投影层。文件/目录路径改变时，重建现有扫描器需要的媒体ID、相对文件路径、名称/父路径/祖先及受影响扫描归属；同步播放列表、系列和嵌套 collectionMovies 引用。原评分、收藏、进度、手工/刮削标题等元数据保留，未匹配且名称等于文件名的条目才跟随文件名。限定 local=true且sourceId一致，目录前缀按完整路径边界匹配，拒绝媒体目标冲突；全部在副本计算，任何错误不部分覆盖输入catalog。
- 同层新增实际播放器进度键映射函数，使用活的 ResolvedMedia::key() 做契约测试；后续必须对移动前全部普通文件快照调用，不能只处理已扫描媒体。新增 tauri.filePreferences 投影：路径书签ID、子目录路径及关联names/covers/hiddenOnHome/order一起更新；保留自定义名称/封面/来源根隐藏状态，冲突拒绝覆盖。偏好原数据同样在失败时保持原状。
- 7项原生定向测试通过；原生全量143通过/10既有忽略，随后收紧双斜线/尾斜线等非规范路径并再次7项定向通过。本轮纯原生投影层，未重复前端测试或原生app打包，最新UI包仍为上一检查点210.10MiB；未做新实屏或真实账号检查。新helper尚无生产调用，所以当前有9项dead-code警告（含原有2项），不能将测试通过描述成用户可用本地重命名/移动。
- **后续必做**：接持久化操作日志及文件系统/数据库一致性恢复；事务中同步catalog和positions，收藏偏好需持久化交付并在UI确认后完成日志；再注册命令/接原版弹窗并验证中断与重启恢复。当前没有新增公开写命令，没有修改真实文件，Electron main核对无改动。M5继续，M6未开始。

日志：`/tmp/m5-local-identity-focused.log`、`/tmp/m5-local-identity-native-all.log`。


## 2026-11-08：123 单项复制回执跨面板保留

- 核对 Electron 的 apiCloud123CopyBatch 与 adapter：多选确实应走原 `/api/v1/file/async/copy`，而原方法只凭 code=0 返回输入 ID，没有任务完成查询。当前没有取得该端点可核验的完成契约；检索到的图床 `/oss/source/copy/process` 是不同功能，不能套用；官方语雀文档本轮访问返回403。继续保留批量异步完成确认缺口，未把多选改成循环单项复制、未虚构任务端点，也没有将提交成功写成完成。
- 修复已有原单项复制的 native 适配边界：目标 ID 在来源生命周期检查之前保存；未确认回执由绑定面板的 WeakMap 改为最多128条的当前进程账号/原文件/目标/名称/类型映射，重新挂载同一来源可继续核对实际目标，不因切换面板丢失回执而重复POST；并发同一命令共用原提交，未知提交结果也跨面板保留为未知。只在目标 ID/名称/类型/父目录实际确认后清理。没有后台执行、持久化传输队列或M6实现。
- 13 项单项复制定向测试通过，新增“提交后切源并重新挂载”“未知回执重新挂载”“并发一次提交”覆盖。全量前端 **123 文件 / 926 项通过**，类型检查及 macOS arm64 debug app 构建 **210.10 MiB通过**。文件来源验证143映射/20模板/2资源，媒体库35映射/14模板/4资源通过；本轮无Rust变更，未重复原生单元测试，最近原生基线仍为136通过/10既有忽略。
- 无真实账号请求或用户文件变更；Electron main 核对无修改。最新包未取得原生实屏/IPC证据。检查本地原型确认重命名/移动/回收仍未暴露：需要同步 catalog 的媒体身份、散列播放进度键及 filePreferences 收藏路径，并补持久化操作日志/恢复；不能只注册命令绕过此门槛。
- **M5保持开发中**：123异步批量/网页清空、本地身份与日志、其他提供商剩余矩阵及完整840px/窄窗/菜单键鼠实屏待完成；真实账号后置，M6未开始。

日志：`/tmp/m5-cloud123-copy-receipt-focused.log`、`/tmp/m5-cloud123-copy-receipt-types.log`、`/tmp/m5-cloud123-copy-receipt-all.log`、`/tmp/m5-cloud123-copy-receipt-build.log`。


## 2026-11-08：PikPak 独立下载链接端口

- 原属性弹窗“复制下载链接”改接专用 pikpak_download_url 原生命令，不再调用会返回 boxplayer-prepared 句柄的播放器 resolve。原模板、按钮和生命周期检查保留；其他来源继续走既有端口并保留必要鉴权边界，不能据此认定所有盘取链完成。
- Rust 将既有、按 Electron apiPikPakDownloadInfo 适配的 captcha/detail 握手提取为共用内部函数，保留账号/设备与挑战值在原生端。播放仍返回带原 UA 的受保护句柄；显式复制动作按 Electron getPikPakDownloadUrl 的 streamUrl 优先、web_content_link 回退规则返回直接 HTTP(S) URL，仅投影 schema/source/account/file/url/空headers。下载拒绝文件夹、回收条目、未完成 phase、错误 ID 和含 userinfo/非HTTP URL；不把整个详情或 captcha 响应交给 UI。
- 定向前端 **18 项通过**（包括新增来源切换和文件夹/回收站写前拒绝）；全量前端 **123 文件 / 921 项通过**，其后补充的 2 项边界测试另行定向通过。类型检查通过。原生定向 **5 项通过**，原生全量 **136 项通过 / 10 项既有忽略**。第一次沙箱内全量的 18 个本机 HTTP 监听测试报 PermissionDenied，已按授权沙箱外重跑并全部通过，没有掩盖原失败。
- macOS arm64 debug app 构建 **210.10 MiB 通过**（仍有既有两个 dead-code、reka-ui/useId 与大 chunk 提示）；来源校验仍为文件 143 映射/20 模板/2 资源，媒体库 35 映射/14 模板/4 资源。本轮没有真实账号请求或用户文件修改。暂未取得新包实屏/IPC证据，不能将 mock invoke 或原生投影测试当作云端下载成功。
- M5 仍在开发：其他提供商操作及下载链接、本地身份同步和操作恢复、123 异步复制及网页回收清空、阿里剩余功能、完整键鼠/菜单/840px与窄窗实屏仍未完成。真实账号后置；Electron main 未改动，M6 未开始。

日志：`/tmp/m5-pikpak-download-focused.log`、`/tmp/m5-pikpak-download-types.log`、`/tmp/m5-pikpak-download-all.log`、`/tmp/m5-pikpak-download-native-focused.log`、`/tmp/m5-pikpak-download-native-all.log`、`/tmp/m5-pikpak-download-native-all-unrestricted.log`、`/tmp/m5-pikpak-download-build.log`。


## 2026-11-08：PikPak 原回收站命令与清空分支

- 原 apiPikPakTrashBatch / TrashRestore / TrashDelete 现接账号与来源绑定的 native 端口，保留原 IDs-only 请求体；与移动复制共用有界任务终态核验，不把提交成功或 running 100% 当作完成。回收后核对原回收列表的 ID/类型；还原后核对实际 live 详情，保留提供商可能改变的名称和父目录。详情读取仅在原属性弹窗的回收站上下文允许 trashed 项，不放宽普通修改校验。
- 清空流程从 Electron topTrashDeleteAll 的 PikPak if 分支直接提取，保留“读完全部分页，再每 100 项删除”的原循环。native 适配器增加分页范围/重复保护、来源切换检查和任务核验；失败保留已确认批次，媒体库仅清理当前捕获来源的成功 ID。新增 AST if 分支提取验证，不以手写近似循环冒充原代码。
- 14 项定向协议/原浏览器组件测试通过；全量前端 **123 文件 / 920 项通过**；类型检查和 macOS arm64 debug app 构建（**210.07 MiB**）通过。文件来源校验 **143 映射 / 20 完整模板 / 2 资源**；媒体库 **35 映射 / 14 完整模板 / 4 资源**。本轮无 Rust 变更，未重复原生单元回归；构建仍有既有两个 dead-code 及前端 chunk 提示。
- 本轮界面工具再次明确报告 Mac 锁屏，未获得最新包原生实屏/IPC验收；既有解锁问题待回复。没有登录真实账号、提交真实云端任务或修改用户文件。Electron main 核对仍无工作区修改。
- **M5 仍未完成**：其他提供商矩阵、本地路径身份同步与持久化操作恢复、123 异步复制/网页清空、阿里剩余特殊功能及 Open 通道、独立下载链接、完整快捷键/选择/菜单矩阵和 840px/窄窗口实屏仍需补齐。真实账号检查按用户要求后置；M6 未开始，不把本轮回收站子项当作整体验收。

日志：`/tmp/m5-pikpak-trash-focused.log`、`/tmp/m5-pikpak-trash-types.log`、`/tmp/m5-pikpak-trash-all.log`、`/tmp/m5-pikpak-trash-build.log`。


**2026-11-08 M5最新：PikPak原移动/复制接任务终态核验，未确认任务重试不重发；移动后实际改名/位置同步。新增15项，全前端121文件/906项、类型及210.07MiB包通过。回收写操作与其他M5缺口继续，M6未开始。**

**2026-11-08 M5最新：PikPak原属性模型接入，下载链接端口拒绝内部播放句柄；新增15项，全前端119文件/891项、类型和210.07MiB包通过。目录未知计数/独立链接及其余M5缺口继续；实屏复核仍锁屏，M6未开始。**

**2026-11-08 M5最新：PikPak原列表/模型接普通浏览和目录树，回收过滤仅协议读取；新增17项，全前端117文件/876项、类型及210.07MiB包通过。任务终态/回收写操作及其余M5缺口继续，M6未开始。**

**2026-11-08 M5最新：PikPak原新建/重命名及详情确认接入，新增19项，全前端115文件/859项、类型及210.07MiB包通过。move/copy异步回执和其余M5缺口仍待继续；原生实屏待解锁，M6未开始。**

**2026-11-08 M5最新：115原列表/队列/模型接通浏览、目录选择和目录树，根身份与跨页回环适配；新增19项，全前端113文件/840项、类型及210.07MiB包通过。M5其余缺口和原生实屏继续，M6未开始。**

**2026-11-08 M5最新：115原详情API/属性模型接入，SHA1/时间/路径/目录计数及来源隔离新增13项；全前端111文件/821项、类型及210.07MiB包通过。原列表映射与其余M5缺口、原生实屏仍待继续，M6未开始。**

**2026-11-08 M5最新：115原搜索方法/结果模型接入，保留图标/拼音/缩略图及真实父目录；新增17项，全前端109文件/808项、类型及210.07MiB包通过。其余搜索语义、M5缺口及原生实屏继续，M6未开始。**

**2026-11-08 M5最新：115原回收站列表/还原/永久删除/整库清空接入，19项协议与5项组件验证通过；全前端107文件/791项、类型及210.06MiB包通过。真实账号/原生实屏仍后置或待解锁，其他M5缺口继续，M6未开始。**

**2026-11-08 M5最新：115原新建/重命名/移动/复制/移入回收站方法接入；新增28项，全前端105文件/769项、类型和210.06MiB包通过。115回收站管理、其余提供商/本地日志及实屏矩阵仍待继续，M5未完成，M6未开始。**

**2026-11-08 M5最新：115原版VIP/枫叶转码提交链路迁入，保护账号鉴权、详情身份及来源切换回执；新增10项，全前端102文件/741项、类型和210.06MiB包通过。仅任务接受，不代表转码完成；原生菜单验收与其他M5缺口仍待继续，M6未开始。**

**2026-11-08 M5最新：原版高级搜索弹窗及topSearchAll迁入，普通/高级搜索接实际盘范围与分页校验；全前端101文件/731项、类型和210.06MiB包通过。体积筛选沿用原版未实现状态；实屏当前因Mac锁屏待继续，M5未完成，M6未开始。**

**2026-11-08 M5最新：阿里原颜色搜索方法/双盘范围辅助直接迁入并接颜色入口，7项新协议测试；全前端715项、类型及210.06MiB包通过。高级搜索完整链路、历史等能力及实屏仍待继续，M5未完成，M6未开始。**

**2026-11-08 M5最新：阿里原颜色菜单/描述合并迁入，保留每文件加密标记并确认回执后更新；7项新增，全前端708项、类型及210.06MiB包通过。颜色筛选/历史等剩余项和实屏仍待继续，M5未完成，M6未开始。**

**2026-11-08 M5最新：阿里原云盘收藏列表/收藏/取消/双盘清空迁入，8项新组件协议测试；全前端701项、类型及210.06MiB包通过。颜色/历史等其余能力及实屏矩阵仍待继续，M5未完成，M6未开始。**

**2026-11-08 M5最新：阿里原独立恢复视图/选中恢复/100项分批与会员提示接入；8项新增，全前端693项、类型和210.06MiB包通过。其余特殊视图、提供商及实屏矩阵仍待继续；M5未完成，M6未开始。**

**2026-11-08 M5最新：阿里原整个回收站清空链路接通，按原反复第一页逻辑清两盘，部分失败仅同步确认ID；3项新组件协议测试，全前端685项、类型及210.06MiB包通过。独立恢复视图及其余矩阵仍待继续，M5未完成，M6未开始。**

**2026-11-08 M5最新：阿里原双盘回收站分页、移入/还原/永久删除方法迁入，任务终态和还原详情核对；14项新增，全前端682项、类型和210.06MiB包通过。整库清空、独立恢复视图和其余矩阵仍待继续，M5未完成，M6未开始。**

**2026-11-08 M5最新：阿里原移动/复制方法与构造/结果映射迁入，同盘移动和同盘/跨盘复制接异步终态/目标详情确认；跨盘移动身份对账仍待接。10项新增，全前端668项、类型和210.06MiB包通过；实屏矩阵未闭合，M5继续，M6未开始。**

**2026-11-08 M5最新：阿里网页原重命名方法和batch构造迁入，底层核对双盘身份/父目录/类型；14项新增，全前端658项、类型和210.04MiB包通过。开放通道、其他文件操作与实屏矩阵仍待继续，M5未完成，M6未开始。**

**2026-11-08 M5最新：阿里网页原新建文件夹方法迁入，账号ID与双盘位置分离，支持已读取目录及收藏直接进入；13项新增，全前端644项、类型和210.04MiB包通过。开放通道/其他文件操作及实屏矩阵仍待补齐，M5继续，M6未开始。**

**2026-11-08 M5最新：123原单项复制接新对象详情确认及失败重试去重，未用逐项循环替代原批量分支。10项新增，全前端631项、类型和210.04MiB包通过；批量完成确认、网页清空及实屏等仍待补齐，M5继续，M6未开始。**

**2026-11-08 M5最新：123原回收站分页/还原/还原详情接入；12项新增，全前端621项、类型和210.04MiB包通过。原网页清空、异步复制、其他提供商及实屏矩阵仍待继续，M5未完成，M6未开始。**

**2026-11-08 M5最新：123原新建文件夹/重命名/移动/移入回收站函数接入原生账号端口，14项新增；全前端609项、类型、210.04MiB包通过。123异步复制与回收站管理、其他盘和实屏矩阵仍待补齐；M5继续，M6未开始。**

**2026-11-08 M5最新：OneDrive原复制函数接202/Location匿名监测与新对象校验，错误重试不重提任务；17项新增，全前端595项、类型及210.04MiB包通过。真实账号、监测重定向终态及实屏仍待验收，M5继续，M6未开始。**

**2026-11-08 M5最新：OneDrive原移动/删除方法已接，根目标解析实际ID，移动核对身份/父目录、删除仅认204；异步复制仍待接。全前端578项、类型、210.04MiB包通过。真实账号及实屏未验收，M5未完成，M6未开始。**

**2026-11-08 M5最新：Dropbox原批量移动/复制/删除已接，终态/部分回执和原自动改名保留；全前端565项、类型及210.04MiB包通过，另补目录同步3项通过。窗口退出未确认，未启动第二实例，实屏未验收。M5继续，M6未开始。**

**2026-11-08 M5最新：Dropbox原重命名函数已接，原生账号元数据解析真实路径并确认ID/名称/类型/目标；全前端552项、类型和210.04MiB原生包通过。现有开发窗口仅空白标题栏，未算实屏验收。M5仍进行中，M6未开始。**

**2026-11-08 M5最新：阿里原分享导入产品链路已接，包括Cmd+L、原内容树、嵌套目标选择及copy回执/部分重试；83文件541项前端、类型、210.04MiB原生包通过。真实账号与新包实屏未验收，其余提供商/文件操作矩阵仍有缺口。M5继续，M6未开始。详见[m5-validation.md](m5-validation.md)。**

**M5 最新检查点：原版列表/菜单、创建、单个/批量重命名、目录选择器已接入；Box/Google 移动复制与回收站完成协议/组件接线。前端444项、类型检查及209.89MiB原生包通过。本轮无Rust修改，未重跑原生单元测试；真实账号和新包实屏未验收。M5未完成，M6未开始。详见 [逐项验收矩阵](m5-validation.md) / [M5状态](m5-current-status.md)。**

**2026-11-07 当前阶段：M5 goal 进行中，真实账号检查后置，停在 M6 前。原版 PanRight、列表 store、工具栏与右键菜单已接入来源浏览器；剩余原版弹窗、文件写操作链路及实屏验收尚未完成，不能标记 M5 完成。[当前状态](m5-current-status.md)。下方停在 M5 前的说明为上一阶段历史记录。**

**2026-11-07 M4 goal交付：开发与本机合成验收完成，停在M5前。[逐项验收](m4-validation.md) / [当前状态](m4-current-status.md)。前端349项、原生125项（10项原有忽略）、引擎25项通过；macOS arm64包209.49MiB。真实账号、真实用户旧库副本及其他平台未验证，按用户安排后置/留目标阶段。以下“进行中”为历史记录。**

**2026-11-07 当前阶段：M4 进行中。用户授权继续 M 系列，真实账号登录后的检查统一延期；先推进媒体库扫描、数据一致性与旧数据迁移。M8 自动获取引擎的提前复用不代表 M8 完成。当前执行清单见 [M4 状态](m4-current-status.md)。旧“停在 M4 前”记录不再限制本次授权。**

**2026-11-07 BoxPlayer 原引擎直接复用：worker、Agent、搜索/元数据、执行器工厂及完整任务服务已拷入；73 项来源映射，63 原文件仅改名，25 项引擎测试通过。运行命名统一为 BoxPlayer。原生账号/模型绑定、目标弹窗仍待迁移，获取入口仍禁用。详见 [记录](boxplayer-electron-direct-migration.md)。**

**2026-11-07 自动获取原引擎继续迁移：已落地原 SQLite 仓库、任务/追更/通知状态服务、独立进程与 Rust 通信，详见 [迁移记录](boxplayer-electron-direct-migration.md)。22 项来源映射 / 19 原样文件；前端 327 项、存储及进程 9 项、Rust 3 项通过。macOS arm64 debug app 207.90 MiB。模型、网盘执行接口和目标弹窗仍待迁移，获取/重试/巡检不开放；真实账号未验证。未修改 Electron main，检测到的并行启动锁工作保持原状。**

**2026-11-07 最新 UI 迁移检查点：主屏幕、媒体库已改用 Electron 原文件及原片段，详见 [迁移与验收记录](home-library-electron-direct-migration.md)。前端 55 文件/319 项通过；新 macOS 开发包构建并重启核验。Electron main 保持干净。真实账号仍后置；boxplayer 自动补全/追更未迁移，保留禁用入口，不记全部视频功能验收完成。以下较早测试数量/包路径为历史记录。**

**2026-11-07 新授权范围：先对齐 Electron 视频媒体库、主屏幕、文件与服务器，音乐/图书另行处理。本轮页面/菜单实现已集成，最终51文件288前端测试、105原生测试通过（10项忽略），118.79MiB开发包已打开并完成本机导航/菜单复验；真实账号和Trakt回跳仍待验收。详见 [页面对齐清单](library-electron-parity.md)。下方 M3 完成及停在 M4 前为历史状态。**

**2026-11-07最终开发交付：[M3交付审计](m3-delivery.md)。按用户安排，真实账号/支付验收后置；实现、103前端/80普通原生测试、TS/fMP4实际libmpv恢复及原生合成服务器闭环完成。最终Acceptance Candidate已构建，保留SeekBar来源哈希差异，不记全部检查通过。停在M4前。以下为历史检查点。**

2026-11-07补充：会员状态共享store、侧栏范围徽章、返回应用刷新与账号切换/退出清空已接线；6项定向测试、类型检查及CSS隔离通过。真实购买后状态未验收，尚未重打包，M3仍进行中，M4未开始。

更新：2026-11-07。执行计划：[implementation-plan.md](implementation-plan.md)。

最新M3检查点：BoxPlayer账号扫码弹窗、原生会员查询与401刷新、官网方案入口已接线，来源账号管理不混入BoxPlayer账号。93前端测试、类型检查/构建、播放器来源/CSS检查通过；116.17MiB独立账号候选包构建成功，未启动，保留用户窗口。真实账号/会员/支付、原生视觉及其余M3项待验收，M4未开始。详见m3-validation.md最新检查点。

## 当前状态

**2026-11-07 当前入口：[M3收尾清单](m3-current-status.md)。用户明确真实账号验证后置，先完成M3实现和自动检查；未计真实账号通过。** 以下M1/M2状态与测试表是历史基线。最新集成候选包116.44MiB已构建、未启动，101前端及77普通原生回归通过；Plex稳定身份后续补丁尚未更新至该包。M4未开始。

**M2 本机最小流程验收完成，停在 M3 前。** 新工程在 [`../../tauri-app/`](../../tauri-app/README.md)。已实现本地源→浏览→嵌入 mpv 播放→进度保存/重启恢复，HTTP 网关及本地来源/进度迁移格式原型。逐项证据和限制见 [m2-validation.md](m2-validation.md)。真实网盘账号、媒体扫描和旧 Electron 数据迁移仍属后续阶段。下文 M1 证据保留为历史基线，不能代替 M2 验收。

功能基线 117 项：保留 85、舍弃 30、延后 2；主责映射未改变。Windows/Linux 与 macOS Intel 仍待目标平台验证，不把本机通过当作全平台通过。

| 阶段 | 状态 | 证据/下一步 |
|---|---|---|
| M0 | 文档准备完成 | 已核对源码、建立功能映射与验收标准 |
| M1 | macOS arm64 基线验收完成 | 8 个前端测试、6 个 Rust 测试、原生构建、开发 .app 和下述冒烟验证通过；其他平台待验证 |
| M2 | macOS arm64 最小流程验收完成 | 16 前端 + 15 Rust 测试；2 项实际 libmpv 集成测试；原生播放/冷启动续播通过，详见 m2-validation.md |
| M3 | 待开始 | 全部来源与账号真实验证 |
| M4 | 开发与合成验收完成 | 扫描/元数据/缓存/迁移已验收，真实账号与真实用户旧库后置，停在M5前 |
| M5 | 进行中 | 原版文件管理页/store/菜单已接入；写操作、剩余弹窗与完整 840px 验收未完成 |
| M6 | 待开始 | 自研传输与各网盘上传 |
| M7 | 待开始 | 播放扩展、音乐、阅读与预览 |
| M8 | 待开始 | 搜索、AI、媒体获取 |
| M9 | 待开始 | 三平台回归、打包、更新过渡 |

## M1 实现

- 独立 package.json、pnpm-lock.yaml、Vite 多页面构建、Cargo.toml/Cargo.lock 和开发 identifier `com.boxplayer.migration.dev`。没有修改 Electron 根 package/锁文件/版本/入口。
- Vue 3.5.45、Pinia 3.0.4、Reka UI 2.11.0、Tailwind 4.3.4、vue-sonner 2.0.9；本地 Button 采用 shadcn-vue 组件组合方式，配置在 components.json。按当前兼容配置使用 Tailwind 4，并同步功能方案表。未导入 soia/Frame 的播放代码和二进制。
- main/settings/player 三入口；三组导航、折叠侧栏、工具栏、独立设置窗和明确的未接入播放器页面。简中/英文、系统/浅色/深色主题。浏览器预览标明限制，不能伪保存设置或调用原生能力。
- Rust 设置 schemaVersion/revision、原子替换与写失败保护；跨窗口监听先于初次读取，忽略旧版本事件，冲突时重新读取而不覆盖另一窗口的更新。
- 主窗关闭保留进程、托盘与原生菜单、窗口单例、文件对话框、限定外链和数据目录打开；开发专用协议与文件唤起队列；macOS 双重 URL 事件去重；自动启动开关和 `--autostart` 隐藏行为。
- 自定义开发数据目录通过环境变量或开发目录内的 `userdir.config` 在设置与日志初始化前解析。WebView 自身存储仍在独立开发 identifier 的默认目录；没有读取 Electron 的业务存储。
- Rust 日志存入开发数据目录 logs；打开请求仅记录数量，不记录 OAuth URL、路径或 token。第三方说明在 tauri-app/THIRD_PARTY_NOTICES.md。

## 自动检查证据

以下命令在 `boxplayer/tauri-app/` 执行。Cargo 使用 `.local/cargo`、`.local/rustup`，环境设置见 README。

| 检查 | 结果 |
|---|---|
| `pnpm install --ignore-workspace --frozen-lockfile --offline` | 通过；独立锁文件可复现 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 3 个文件、8 个测试通过；覆盖跨窗事件/初读竞态、旧版本拒绝、写失败、冲突重读、浏览器边界和设置视图 |
| `pnpm build` | 通过；生成 index/settings/player 三页面，未改根项目版本 |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check` | 通过 |
| `cargo test --locked --offline --manifest-path src-tauri/Cargo.toml` | 6 个测试通过；持久化/重开、写失败、损坏/未来 schema 保护、目录解析、事件去重及队列上限 |
| `cargo check --locked --offline --manifest-path src-tauri/Cargo.toml` | 通过 |
| `pnpm tauri dev --no-watch` | 本机编译并启动真实开发进程；随后退出，改用 .app 做原生冒烟 |
| `pnpm tauri build --debug --bundles app --config '{"bundle":{"active":true}}'` | 通过；最终 macOS arm64 开发 .app 约 37.15 MiB |

工具链由官方 static.rust-lang.org 下载：rustc 1.99.1，rustup 1.29.3；保存在 `.local/` 并忽略，不更改 shell profile。原先的 Rust 缺失问题已解决。Command Line Tools 可用；未安装完整 Xcode，但本机开发包已成功构建。前端安装提示 lucide-vue-next 版本已弃用（方案 D12 指定库，当前锁定 0.468.0）；后续升级图标包需单独评估，不影响本轮检查。

## macOS arm64 原生冒烟证据

通过原生应用 UI 操作开发 `.app`，不是以浏览器预览或组件测试代替。截图保存在 `/private/tmp/boxplayer-tauri-m1-native.png`（临时验收产物，不纳入源码）。

| 场景 | 实际观察 |
|---|---|
| 独立窗口 | 主窗口打开；设置/播放窗口可独立创建和关闭，关闭子窗回到主窗；播放页明确说明无 mpv 后端 |
| 侧栏 | 折叠与展开生效，存储 revision 随更新递增 |
| 主题与语言 | 设置窗改深色和英文，主窗同步；退出后重开仍保留深色、英文和折叠状态；最后恢复简中和展开侧栏 |
| 原生菜单 | 实测发现初版菜单未弹出；改成异步原生调用并传显式逻辑坐标后重建，菜单可见，Settings 菜单项打开设置窗 |
| 文件选择 | 原生 Open 对话框打开，Cancel 后正常回到主窗口；此阶段只选文件，不播放 |
| 关闭/恢复 | 关闭主窗后进程仍存活；日志记录 hidden to tray。第二次启动转发请求、恢复已有窗口，系统进程检查仍只有一个实例。未单独点击系统菜单栏托盘图标，不能把这一动作记为已测 |
| 自动启动 | UI 启用时实际创建 `~/Library/LaunchAgents/BoxPlayer Dev.plist`，关闭后文件移除；最终保持关闭。没有注销/重新登录系统 |
| 隐藏启动 | UI 保存 startHidden=true，退出后以最终 .app 的可执行文件加 `--autostart` 启动；日志确认 remains hidden，进程存活；开发协议随后恢复主窗。最终还原 startHidden=false |
| 开发协议 | macOS `open boxplayer-migration-dev://...` 唤起现有窗口并显示收到请求；最终构建修复双重事件后，一次唤起显示一次通知；没有调用正式 OAuth |
| 文件关联 | macOS Open With 将仓库的 `e2e/assets/mpv-sample.mp4` 交给开发 app，收到打开请求。Info.plist 只注册开发协议，媒体关联 rank=Alternate；没有改正式协议或默认媒体应用 |
| 日志 | 实际产生启动、隐藏/恢复、接收请求数量等日志；没有输出链接载荷 |

本次验证过的系统开关仅作用于新开发应用。开发 app 保持打开以供查看，登录项未保留；原 Electron 没有启动、重启或执行 E2E。

## 目标平台状态

| 平台 | 源码/配置 | 构建 | 原生运行 | 正式安装/更新 |
|---|---|---|---|---|
| macOS arm64 | 已实现 M1 + M2 最小流程 | 通过，debug .app | M1 历史基线 + M2 播放/续播通过，托盘图标直接点击未单测 | 未做；未正式签名公证/发布 |
| macOS x64 | 共用源码/配置 | 未构建 | 未运行 | 未运行 |
| Windows x64/arm64 | 自定义窗口按钮和平台配置已写 | 未构建 | 未运行 | 未运行 |
| Linux x64/arm64 | 共用源码，默认系统装饰 | 未构建 | 未运行 | 未运行 |
| Linux Wayland/X11 播放 | 属于 M2/M9 | 未构建 | 未运行 | 未运行 |

Android 手机/平板/TV 和 Apple 原生 iOS/iPadOS/macOS/tvOS 不在本次桌面迁移修改范围。

## 工作区与后续限制

- 开始时已有搜索相关的本地改动；包括 PageGlobalSearch.vue、GlobalSearchModal.vue、globalSearch.ts、incrementalSearch.ts 及相关测试，均未修改或回退。
- M0 对 `docs/tauri-migration/*.md` 的忽略例外保留；新工程自己的 `.gitignore` 另外允许三个 HTML 入口和第三方说明被追踪，排除工具链、node_modules、dist、target/gen。
- 当前还不是可替代 Electron 的产品。真实账号、支付/Pro、媒体扫描、旧数据导入、更新、完整账号菜单等按后续阶段实现；导航中尚无这些业务数据。
- M2 直接使用 libmpv 和 Rust HTTP 网关，不链接/加载 `soia_utils`；原生 NSView 嵌入已验证。HDR10/DV 样本只验收读取，实际 HDR 显示、SMB 等真实来源及正式运行时源码构建仍待后续验证。
- macOS 自动化冒烟覆盖不等于 #94 全平台回归；其他平台、系统重登录、正式安装与更新仍须后续验证。

## M1 侧栏修正（2026-11-06）

用户指出「文件」不应分成本地文件夹和文件源。对照原生 `MainWindowsView.swift` 的 `dynamicEntries`（约 319–390 行）及 `.files` 路由修正：

- 移除两个固定占位分类，改成可选择的统一「文件」入口。
- 新增 FilesSidebar 和来源快照到侧栏行的映射。实际本地目录、网盘/共享收藏、媒体服务器按名称平铺；网盘无收藏才显示源本身；隐藏本机根占位；直接 URL 入口仅在保存过 URL 时显示。
- 保留稳定来源 ID 和目录 ID，避免同名文件夹选错；侧栏整体收起时只保留文件父入口图标。运行时来源快照仍为空，等待 M2/M3 接入真实数据；测试 fixture 不写入用户数据。
- 已通过 13 个前端测试（新增 5 个侧栏规则/组件用例）、类型检查和三页面构建。原生 Swift、Android 和旧 Electron 不修改；这是新 Tauri 共用侧栏的修正。
- 已重建 macOS arm64 开发 .app（约 37.16 MiB），实际窗口确认只有统一「文件」入口，没有两个错误分类；点击后标题与导航选中状态切到文件。截图：`/private/tmp/boxplayer-tauri-files-sidebar.png`。Windows/Linux 的共用实现已更新，但未做目标平台运行验证。

## M1 品牌与主题修正（2026-11-06）

- 按用户澄清修正应用图标：从现有 `static/images/icon_1024x1024.png` 原样复用正式品牌资产，替换临时三角；生成并配置 macOS ICNS、Windows ICO 和 PNG，同步侧栏、favicon、托盘。没有更改文件导航图标的含义。
- 界面主题采用森林绿：浅色 #276749，深色 #82C79B；前景分别用白色 / #11281B。主按钮文字对比度分别 6.73:1 / 7.89:1，侧栏背景上的强调色分别 5.80:1 / 7.21:1。
- 前端 13 个测试、类型检查和构建通过；绿色主题与品牌图标纳入 macOS 开发包。Windows ICO 已生成，Windows 运行未验证。
- macOS arm64 开发包重建成功（约 37.90 MiB），原生窗口已确认正式品牌图标与绿色按钮/导航强调色；关于窗口提供应用级图标。截图：`/private/tmp/boxplayer-tauri-green-theme.png`。

## M2 验收与停止位置

M2 已按实施计划验收，详见 [m2-validation.md](m2-validation.md)。最终开发包约 104.13 MiB，包含独立 libmpv 运行时；原生播放、暂停/seek、关闭重开和整个应用重启续播已验证。迁移格式原型、HTTP/字幕鉴权与刷新通过自动测试。保留正式应用图标、森林绿主题及统一「文件」侧栏。

按本轮用户要求停在 M3 前。下次若授权 M3，再逐个接入并验证真实来源、账号与刷新流程；当前没有启动提供商迁移，也没有公开发布。

## M2 界面纠正（2026-11-06）

按用户纠正，直接集成 soia 原播放器组件/菜单/播放列表抽屉和样式，撤掉自做的播放按钮布局；原始模板、SVG、样式有 SHA-256 校验。主屏幕、媒体库、文件改为三个可选择的同级根，独立展开子项。用 testVideo 的 DV P5、4K AV1 HDR10 40M/50M 做原生播放、暂停/seek、倍速和下一集验证；17 前端、15 普通 Rust 测试通过，开发包约 104.22 MiB。见 [纠正验收](m2-validation.md#m2-界面纠正验收2026-11-06)。未接入能力和平台限制保留，仍停在 M3 前。

顶部栏追加修正：播放器移除主应用 Tailwind/reset 样式，保留 soia 原控件默认样式；本地标题传入 displayPath。普通窗口与全屏原生检查完成，17 前端测试及构建检查通过。详情见 m2-validation.md 顶部栏修正记录。

## HDR/DV 专项测试（2026-11-06）

20 个 testVideo 样片完成元数据/首帧解码及真实开发包基线、修正后两轮播放采样，全部使用 VideoToolbox。发现 HDR 输出路由遗漏，补入 soia 公开 HDR 控制逻辑后，17 个 HDR/DV 渲染目标转为 PQ，3 个 SDR 保持 SDR；16 个 Rust 普通测试及单独执行的 3 个 libmpv 集成测试通过。早期采样 EDR current=1，后续实际窗口采样最高约 7.89；用户已确认高亮阶梯可区分。精确亮度/色准和严格性能仍未验收，当前未提供 Dolby Vision 原生信号透传。逐文件、丢帧计数与边界见 [HDR 专项报告](hdr-validation.md)。临时调试采集已关闭，仍停在 M3 前。

## 原生 HDR 显示链路追加（2026-11-06）

实际 mpv Metal 图层的 PQ/EDR、10bit 格式及 HDR→SDR 元数据清理已验证；EDR current 动态达到约 7.89，更新早期 current=1 的解释。生成可复现高亮/近黑/SDR 测试图。物理亮度/色准仍待实屏与仪器验收，当前未提供 DV 原生信号透传。详见 [追加报告](hdr-surface-validation.md)。仍停在 M3 前。

## 用户实屏高亮初检（2026-11-06）

用户在实际播放器全屏查看 PQ 高亮阶梯后，确认 600、1000、1600 三档能够区分，记录为实屏高亮阶梯可区分性初检通过。此结论来自用户肉眼反馈，不代表测得对应 nit，不扩展为色准、近黑或 DV 实景通过。

下一项为近黑测试图检查，随后检查 DV P5/P8.1/P8.4 实景及切回 SDR。精确亮度/色准仍待仪器测量，当前未提供原生 DV 透传；M3 未开始。

## 用户实屏近黑初检（2026-11-06）

用户查看全屏近黑测试图后，针对 0.1、0.5、1、5 阶梯确认“有区分”，记录为这些近黑阶梯的肉眼可区分性初检通过。未收到偏色结论；不将此反馈扩展为最暗 0.005/0.01 档、仪器色准或 DV 实景验收通过。下一项为 DV P5/P8.1/P8.4 实景检查，仍停在 M3 前。

## 用户实屏 DV P5 初检（2026-11-06）

用户查看 Test Jellyfin 4K DV P5.mp4 后，确认未见明显偏紫、偏绿、颜色失真或亮部大片发白，记录为该样片的实屏明显异常初检通过。不扩展为仪器色准、其他 DV profile 或原生 DV 信号透传通过。下一项为 P8.1，仍停在 M3 前。

## 用户实屏 DV P8.1 初检（2026-11-06）

用户查看 Test Jellyfin 4K DV P8.1.mp4 后反馈“正常”，针对明显偏色、颜色失真或亮部大片发白的检查记录为该样片实屏初检通过。不代表仪器色准或原生 DV 信号透传通过。下一项为 P8.4，仍停在 M3 前。

## 用户实屏 DV P8.4 初检（2026-11-06）

用户查看 Test Jellyfin 4K DV P8.4.mp4 后反馈“正常”，针对明显偏色、颜色失真或亮部大片发白的检查记录为该样片实屏初检通过。至此高亮、指定近黑阶梯及 DV P5/P8.1/P8.4 的用户实屏初检均已记录；精确亮度/色准和原生 DV 信号透传结论不变。下一项为切回 SDR 的实屏检查，仍停在 M3 前。

## M2 实屏补验收尾（2026-11-06）

用户确认从 DV P8.4 切回 Test Jellyfin 1080p HEVC 10bit 3M.mp4（SDR）后画面“正常”，针对异常发亮、发灰或偏色的检查记录为该次切换实屏初检通过。

本轮用户实屏补验结果：

| 项目 | 用户反馈及结论 |
| --- | --- |
| PQ 高亮阶梯 600 / 1000 / 1600 | 能区分，肉眼可区分性初检通过 |
| 近黑阶梯 0.1 / 0.5 / 1 / 5 | 有区分，肉眼可区分性初检通过 |
| 4K DV P5 | 未见询问中的明显偏紫、偏绿、颜色失真或亮部大片发白 |
| 4K DV P8.1 | 正常，明显异常初检通过 |
| 4K DV P8.4 | 正常，明显异常初检通过 |
| DV → HEVC 10bit SDR | 正常，切换后明显异常初检通过 |

本轮计划的实屏初检已完成。证据限于本机开发包、上述样片及用户肉眼反馈，不代表仪器测得的峰值亮度、EOTF、白点或色准通过；最暗 0.005/0.01 档未验收，独立灰阶偏色检查未单独确认。当前输出为 DV 解码/色彩处理后的 PQ/EDR，未提供原生 DV 信号透传。严格性能及其他平台的验证边界保持不变。

M2 本轮补验收尾，停在 M3 前；未启动账号/提供商迁移，未发布。

## M3 启动（2026-11-06）

用户授权以 goal 完成 M3，按实施计划验收，停在 M4 前。用户选择在 Tauri 中逐个登录，不读取 Electron 现存凭据。源码实现、自动测试、真实账号和目标平台运行分别记账。

当前正在实现账号凭据边界与网络源/媒体服务器入口；不是 M3 完成。Rust 系统 vault 使用 keyring 3.6.3（macOS Keychain、Windows Credential Manager、Linux Secret Service），公开 SQLite 元数据不存凭据。WebDAV/AList 协议及 Jellyfin/Emby 登录、浏览、取链、收藏、播放上报已开始接入，真实账号未验收。其余保留提供商、BoxPlayer 登录/会员/支付继续实现。M4 未开始。

M3 中间检查点：已启动首批网络源登录表单；继续补入 OneDrive/Dropbox/Box/Google 的 OAuth/刷新与独立协议、Plex PIN/资源匹配/浏览/收藏/上报；前端 25 项、Rust check 及 OAuth 两项测试通过。真实账号尚无通过记录，详细状态见 [M3 验收记录](m3-validation.md)。M3 未完成，M4 未开始。

M3 追加：115 扫码入口已在 106.33 MiB 原生开发包实际显示，默认应用注册配置生效；尚无扫码确认后的真实账号流程通过记录。macOS vault 合成条目读写删除实测通过。已补一次性媒体凭据句柄、账号管理及退出撤销代码；28 前端测试、21 Rust 普通测试通过。继续 M3，不进入 M4。

M3 追加：108.12 MiB 开发包实际显示夸克 QR 和账号管理入口；真实扫码确认后的来源流程仍未验证。Cookie jar、加密大凭据存储、重定向 Set-Cookie 与账号隔离、401/403 媒体刷新已补回归；30 前端、26 Rust 普通测试通过，macOS 大条目 vault 实测通过。继续 M3，不进入 M4。

M3 用户反馈纠正：文件页默认改为统一来源列表；新增来源改为已储存来源侧栏 + 分类服务目录 + 独立表单。保留绿色，复用提供商品牌图标，默认隐藏 OAuth 注册参数；补服务器端口/HTTPS。33 前端测试、类型检查、前端构建及 108.24 MiB macOS 开发包构建通过。浏览器导航/渲染有截图；新包原生运行和完整视觉验收尚未通过，不标记 M3 完成。

用户进一步明确：网盘不提供高级选项或自定义 Client ID/Secret。已彻底移除网盘表单的注册参数及回调端口输入，统一使用构建内置注册配置；只有服务器/网络共享保留端口和 HTTPS 高级连接项。缺配置错误不再要求用户填写 Client ID。39 前端测试与类型检查通过。

M3 登录协议补充：百度 GET token、原生查询注入/IPC URL 脱敏、超大 fs_id 无损；百度/123 OAuth、稳定身份与重登保存已接线。AList 原生密码/OTP + profile 验证与 UI 切换接入。42 前端、33 Rust 完整普通测试通过，新增百度大整数/URL 脱敏定向通过；真实账号矩阵仍未通过。M3 未完成，M4 未开始。

M3 阿里 OpenAPI：扫码/原生令牌交换刷新与 TS 盘列表/分页/取链接线；官方匿名二维码申请及本机会话取消实测通过，无用户登录。修复官方图片格式及前端导航后晚到二维码的串会话问题。46 前端、36 Rust 普通回归通过；阿里网页通道及真实账号矩阵仍待完成，M4 未开始。

UI 优先修正：按用户最新要求，已有非播放器页面改为 Infuse 风格，保留 BoxPlayer 图标/绿色；播放器明确不改。主窗/文件/来源/账号/设置已修改，47 前端测试和 soia/CSS 校验通过；109.02 MiB 新包实际打开，原生真实来源列表、偏好设置与关闭行为已查看。UI 风格检查单独通过，M3 账号与协议矩阵仍未完成，M4 未启动。

M3 后续源码检查点：阿里网页登录入口/独立网页驱动与原生签名会话已接线，真实登录未验收，运行中的 UI 包未重启加载这部分；光鸭目录分页/取链 TS 驱动已迁入，登录/刷新/设备头仍待实现，不能标为来源完成。详见 m3-validation.md 最新检查点；M4 未启动。

M3 光鸭后续：原生短信认证/刷新与来源表单已接线，内置应用配置，凭据入 vault；不显示网盘高级设置。54 前端、46 Rust 普通测试通过，5 ignored；没有发送真实短信，完整真实账号矩阵仍待验收，运行窗口未重启，M4 未启动。

M3 PikPak：原生密码登录/刷新/签名取链与一次性媒体句柄、TS 目录分页、来源表单已接线；修正统一请求层遗漏原生短信账号业务鉴权失败后刷新的判断。58 前端及49 Rust普通测试通过（5 ignored），真实账号未验收，M4 未启动。

最新 macOS 开发包构建成功，109.48 MiB；包含阿里网页/光鸭/PikPak 接线，未重启当前窗口，原生新入口及真实账号矩阵仍待验收。

M3 移动云盘139：原生令牌校验/路由授权/正文签名，TS 新旧目录分页与取链、表单已接线；62前端与52 Rust普通测试通过（5 ignored），构建通过，真实账号未验收。139没有现成刷新令牌协议，过期重登；189仍待接入。本轮源码未替换上个109.48MiB开发包，未重启窗口，M4未启动。

M3 天翼189：原生扫码、个人/家庭会话与签名/刷新、TS 分页取链和来源表单已接线；66前端与58 Rust普通测试通过（6 ignored），官方匿名二维码申请/本地取消另行通过。真实账号和新包原生界面仍待验收，当前窗口未重启，M4未启动。

最新 macOS 开发包115.25MiB构建成功，包含139/189；在途QR取消修正后58普通Rust回归及单独天翼匿名检查通过。原生清单确认开发应用仍在运行，保留窗口未重启，新包原生入口/真实账号验收继续待办。

M3 媒体服务器：搜索接已有侧栏；三家播放列表创建/成员管理/浏览与删除确认已接线，修正快照中的服务器来源身份。81前端测试/类型检查/构建及播放器来源/CSS检查通过，真实写入/删除没有执行，码率/设备配置及账号矩阵等仍待验收，M4未启动。

媒体服务器改动已打入115.25MiB macOS开发包，构建成功；未重启用户窗口，来源/搜索/播放列表真实账号验收仍待继续。

M3 设备配置/播放链路：全局 JF/Emby 配置持久化，原生私有播放协商（含 Plex）、JF/Emby 5MB 原生测速和 HLS 子资源代理已接线。87前端、66普通Rust测试通过（7 ignored）；新增真实libmpv本地HLS测试另行通过。真实账号、新配置原生交互、Plex文件测速及会话失效恢复等仍待验收，未改播放器UI，M4未启动。

本轮新开发包115.59MiB构建并切换，已原生查看来源目录/光鸭表单。用户开始Emby登录，已保留表单停止界面操作；尚无真实登录完成证据。87前端、66普通Rust及单独libmpv HLS测试通过，M3其余项继续，M4未启动。

2026-11-08 M5属性/目录树检查点：迁入原弹窗并接部分提供商详情及版本/权限，77文件456测试、类型和209.90MiB原生开发包通过；新包AX连接超时未实屏验收。M5仍进行中，不进入M6。详见m5-validation.md和m5-current-status.md。

2026-11-08 M5版本接口检查点：Dropbox属性/版本恢复、OneDrive版本/恢复接原生端口；Box版本与Google权限补分页。77文件462测试、类型、209.90MiB原生开发包通过，追溯98/20/2；现有应用AX仍超时，未重启，实屏未验收。M5仍进行，不进入M6。

2026-11-08 M5原创建分享检查点：原完整弹窗/格式迁入，Box选项与逐文件部分失败/剪贴板重试隔离接通；78文件468测试及209.90MiB原生开发包通过，追溯101/20/2。导入分享/其他提供商完整选项仍缺，新包实屏未验收；M5继续，不进入M6。

2026-11-08 M5分享提供商检查点：Google/OneDrive/123/光鸭原创建协议迁入；123与光鸭组合/选项接通，Google分页复用权限。79文件476测试、类型与209.90MiB原生包通过，追溯106/20/2；真实账号/最终实屏未验证。M5仍进行中，未进入M6。

2026-11-08 M5 Dropbox分享检查点：原分享模块迁入，完整分页/错误隔离/丢失确认重查及已有链接设置确认；79文件484测试、类型与209.90MiB原生包通过，追溯107/20/2。真实账号与最终实屏未验收，M5继续，未进入M6。

2026-11-08 M5夸克分享检查点：原组合/密码/有效期/任务/公开链接链路迁入，任务完成确认与来源隔离；79文件492测试、类型/原生包通过，追溯108/20/2。实屏与真实账号未验收，M5继续，不进入M6。

2026-11-08 M5 PikPak检查点：原组合/有效期/生成提取码链路及原生签名参数接通，保留旧调用；79文件497前端测试、Rust134通过/10原有忽略、类型与209.95MiB原生包通过。追溯109/20/2；真实账号/最终实屏未验收，M5继续，不进入M6。

2026-11-08 M5阿里普通分享/快传检查点：原类方法与表单快传分支接回，双盘JSON位置解码及业务码/错通道校验；79文件505测试、类型/209.95MiB原生包通过，追溯111/20/2。实屏/账号验收与其他M5项仍缺，不进入M6。

2026-11-08 M5付费/标题更新检查点：原123付费表单与协议、阿里原批量标题更新及确认失败重试接通；79文件512测试、类型/209.95MiB原生包通过，追溯111/20/2。未执行真实账号写入，实屏/其他M5项未验收，不进入M6。

2026-11-08 M5导入读取基础：原阿里匿名token/metadata/分页/图标映射迁入并接匿名网关，8项新协议测试、全前端520项、类型/209.95MiB包通过；追溯113/20/2。未接入口/原弹窗/保存目标，#101仍未可用，M5继续，未进入M6。

2026-11-08 M5原导入UI组件检查点：原输入/内容树/拼音/选择/保存回调源代码迁入，19项定向、全前端531项、类型/209.95MiB包通过，追溯117/20/2。组件保存端口为mock验证，产品入口和原生保存实现仍未接；M5继续，未进入M6。

## 2026-11-08: Ali original metadata checkpoint

Original ApiFileInfo now feeds the unchanged property modal for web and Open accounts with account/window isolation, canonical IDs, public-field projection and recursive folder totals. Focused 25 tests passed; full 208 files/2009 passed before one additional test, covered by the final focused run. Final typecheck and arm64 debug app build passed (210.55 MiB). See [validation](m5-validation.md) and [evidence](evidence/m5-ali-metadata-adapter-2026-11-08.json). Recycle/root metadata, independent-header links and complete native UI remain pending. M5 active; real accounts deferred; M6 not started.

## 2026-11-08: Original Ali web path/statistics checkpoint

Original ApiFileGetPathString and ApiFileGetFolderSize now supply web properties; Open statistics remain on their isolated recursive adapter. Original recycle menus do not expose Properties, so that previously listed UI gap is excluded with source evidence. Focused 33 tests and full 208 files/2020 tests passed; typecheck/source checks and macOS debug app (210.55 MiB) passed. See [validation](m5-validation.md) and [evidence](evidence/m5-ali-path-size-2026-11-08.json). Root-detail special semantics and complete native UI remain unverified. M5 active; real accounts deferred; M6 not started.

## 2026-11-08: Ali virtual drive-root checkpoint

Virtual drive-root properties now verify current account drive-info without normal-file metadata requests; preserve canonical root identity, fresh name, original web statistics and Open recursive totals. Added 5 protocol and 2 mounted tests. Focused 40 and full 208 files/2027 tests passed; typecheck/source verification and macOS debug app build passed (210.55 MiB). Existing-instance directory/menu runtime subset is recorded separately and does not prove this new build. See [validation](m5-validation.md) and [evidence](evidence/m5-ali-root-properties-2026-11-08.json). Complete native UI and remaining capabilities pending; M5 active, accounts deferred, M6 not started.

## 2026-11-08: Original cloud list models / sorting checkpoint

Fixed discarded modification times and original icons/thumbnails for OneDrive, Dropbox, Box and Google by directly extracting Electron list mappers/helpers/builders and carrying their models into the original store. Four mounted tests cover six sorts, refresh persistence and metadata across layouts; focused 13 and full 209 files/2031 tests passed. Typecheck, source checks (178/20/2; library 35/14/4) and macOS debug app build passed (210.55 MiB). See [validation](m5-validation.md) and [evidence](evidence/m5-original-cloud-list-models-2026-11-08.json). Transfer entries, Ali memory text and full native UI remain pending. Electron main read-only/clean; M5 active; accounts deferred; M6 not started.

## 2026-11-08: Ali original ordinary-directory models

Web/Open ordinary lists now use the original getFileInfo mapper with native identity validation, retained dates/icons/colors/hash/media fields and existing native web-video artwork. Added 19 protocol/model and 4 mounted tests; focused 26 and full 211 files/2054 passed. Typecheck/source checks and macOS debug app build passed (210.55 MiB). See [validation](m5-validation.md) and [evidence](evidence/m5-ali-directory-models-2026-11-08.json). No new runtime acceptance; other adapters, transfers and full native UI remain pending. Electron main not written; unrelated concurrent dirty work preserved. M5 active, accounts deferred, stop before M6.

## 2026-11-08: Original 123 list/property checkpoint

123 now uses original list/detail models and thumbnail helper, retains timestamps/icons for six-sort behavior, and connects original detail reads to the unchanged property modal/Copy JSON. Added 20 list protocol, 16 property protocol and 4 mounted tests; focused 49 and full 214 files/2094 passed. Typecheck/source checks (179/20/2; library 35/14/4) and macOS debug app build passed (210.55 MiB). See [validation](m5-validation.md) and [evidence](evidence/m5-123-list-properties-2026-11-08.json). No new runtime/real-account acceptance. Transfer entries, Ali text and full native UI remain pending. Electron main not written; concurrent work preserved. M5 active; stop before M6.

## 2026-11-08: New-package runtime / narrow date fix

Restarted the explicit new debug bundle after confirming old instances exited. Local directory/range/invert/filter/three-layout runtime subsets passed. Narrow view exposed filename min-width pushing directory dates outside the row; native-only min-width:0 override rebuilt/restarted and visibly verified full calibration date. Window size/list/filter/selection restored. Build/typecheck and source checks passed; preceding 2094 functional tests remain a baseline, not a CSS rerun. See [validation](m5-validation.md) and [runtime evidence](evidence/m5-new-package-narrow-runtime-2026-11-08.json). Complete hover/nested/property/840px and cloud IPC acceptance still pending. M5 active, real accounts deferred, M6 not started.

## 2026-11-08: Original upload/download entries and execution boundary

Original handleUpload and DownloadModal confirmation now connect to read-only native pickers and a deferred execution port; absent M6 executor explicitly creates no tasks. Preserves file/folder shortcuts, original selection/destination, ZIP mode and lifecycle checks. Task-list presentation remains pending. Added 11 tests; focused30/full215 files2105 passed; native168 passed/10 ignored; typecheck/source checks and macOS debug bundle210.71MiB passed. Restarted explicit latest package and verified local 21-entry browser startup; cloud transfer-entry runtime not accepted. See [validation](m5-validation.md) and [evidence](evidence/m5-transfer-entries-2026-11-08.json). M5 active, real accounts deferred; no M6 engine.
