# 网络共享接入记录（2026-11-09）

本次修改限定在 `boxplayer-tauri`；Electron main、Apple 和 Android 客户端未修改。M6 未启动。

## 图标

AList、WebDAV、SMB、NFS、FTP 直接复制 iOS Assets.xcassets 中实际使用的原始资源，不重新绘制。网络共享选择页和已保存来源复用同一 providerIcon 映射。文件及收藏夹内部图标保持现有规则。

源文件与 SHA-256 记录于 `tauri-app/public/source-icons/apple-network-assets.json`。

## 支持范围

- SMB2/3：域账号（`DOMAIN\username`）、指定端口、服务器共享枚举、子目录列表和定位读取。
- NFSv3：TCP、导出路径、RPC mount 端口自动发现或显式填写；AUTH_SYS 匿名 UID/GID 65534；目录分页、子目录和定位读取。不支持 NFSv4/Kerberos。
- FTP：指定端口、匿名/账号登录、被动模式、MLSD 与 LIST 回退、二进制读取和 REST 偏移续读。本次不包含 FTPS/SFTP。
- 三者接入现有文件浏览器、收藏/刮削和播放器解析端口；编辑连接可保留已有密码，修改前验证连接。连接弹窗关闭会取消待完成的连接验证。
- 本次协议操作为只读浏览、媒体读取，不提供新增协议的上传/重命名/删除实现。

不使用系统挂载、sudo 或系统密码授权；凭据沿用原生非交互 vault，仅保存在原生端，不放入 URL、命令参数或 WebView 元数据。HTTP 范围桥只绑定 loopback，随机授权句柄有期限，删除/更新来源会撤销句柄；播放数据按块读取。

文件 ID 使用 `network:/` 前缀，避免目录名与旧浏览器的 favorite/trash/root 等虚拟页名称冲突。

原生库：
- https://docs.rs/smb2/0.37.0/smb2/
- https://docs.rs/nfs3_client/0.9.1/nfs3_client/
- https://docs.rs/suppaftp/8.0.5/suppaftp/

## 验证

- 三种协议使用真实 loopback 协议服务，不访问用户账号：SMB（Impacket）、FTP（pyftpdlib）、NFS（nfs3_server MemFs）。中文文件、子目录、文件长度和偏移内容一致；SMB/FTP 错误密码失败。
- HTTP 桥覆盖 206 范围响应/内容、后缀范围、HEAD 无 body 和长度、416 无效范围。
- 5 项协议/路径/范围测试均通过（显式执行 SMB/FTP fixture 测试，没有将缺少 fixture 计为通过）。
- 最终原生回归：228 通过、12 忽略（其中 2 项是随后单独执行通过的 SMB/FTP fixture）。
- 前端来源表单、文件浏览器与菜单：74 项通过；类型检查通过。
- Electron 原文件来源校验：207 映射/23 原样模板/2 资源；媒体库校验：35 映射/14 原样模板/4 资源。

复现 fixture：在临时 venv 安装 `pyftpdlib impacket`，运行 `tauri-app/scripts/network-share-fixtures.py`。将输出端口分别设为 `BOXPLAYER_FIXTURE_FTP_PORT` 和 `BOXPLAYER_FIXTURE_SMB_PORT`，执行 `cargo test --lib network_share:: -- --include-ignored`。

未验收：用户真实 NAS 的权限和厂商兼容性、真实大视频长时间播放吞吐，以及 Windows/Linux 实机。不能将 loopback 协议测试当作真实 NAS 播放验收。

## 开发包实屏

已构建签名开发包并退出旧进程后从精确 bundle 路径重启。实屏确认五个网络协议图标正确显示，SMB/FTP 的名称、地址、账号、密码与路径字段可见；NFS 隐藏账号密码，显示路径和自动发现/可选 Mount 端口。返回选择页正常。未向用户配置中注入测试账号，停在新增共享选择页供真实连接验证。
