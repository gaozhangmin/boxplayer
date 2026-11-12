//! Native network-share transport. Credentials never enter URLs, logs or the WebView.
use crate::{
    accounts::{Account, Accounts, Credentials},
    commands::Backend,
    gateway::ResolvedMedia,
    settings::AppError,
};
use axum::{
    body::{Body, Bytes},
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use nfs3_client::{
    nfs3_types::nfs3 as n,
    nfs3_types::xdr_codec::Opaque,
    tokio::{TokioConnector, TokioIo},
    Nfs3Connection, Nfs3ConnectionBuilder,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::io::AsyncReadExt;
const TIMEOUT: Duration = Duration::from_secs(30);
fn fail() -> AppError {
    AppError::new(
        "NETWORK_SHARE",
        "无法访问网络共享，请检查地址、共享路径和登录信息",
        true,
    )
}
fn invalid() -> AppError {
    AppError::new("NETWORK_PATH", "网络共享路径无效", false)
}
pub fn supported(value: &str) -> bool {
    matches!(value, "smb" | "nfs" | "ftp")
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    provider: String,
    host: String,
    port: u16,
    root: String,
    username: String,
    password: String,
    #[serde(default)]
    mount_port: Option<u16>,
}
fn path(value: &str) -> Result<String, AppError> {
    if value.len() > 8192
        || value.chars().any(|c| c.is_control() || c == '\\')
        || value.split('/').any(|p| matches!(p, "." | ".."))
    {
        return Err(invalid());
    }
    Ok(value.trim_matches('/').to_owned())
}
impl Config {
    fn parse(
        provider: &str,
        address: &str,
        username: String,
        password: String,
        root_path: &str,
    ) -> Result<Self, AppError> {
        if !supported(provider) {
            return Err(invalid());
        }
        let value = if address.contains("://") {
            address.to_owned()
        } else {
            format!("{provider}://{address}")
        };
        let url = url::Url::parse(&value).map_err(|_| invalid())?;
        if url.scheme() != provider
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err(invalid());
        }
        let decoded = urlencoding_path(url.path())?;
        let root = if root_path.trim_matches('/').is_empty() {
            path(&decoded)?
        } else {
            path(&format!(
                "{}/{}",
                decoded.trim_matches('/'),
                root_path.trim_matches('/')
            ))?
        };
        if username
            .chars()
            .chain(password.chars())
            .any(|c| c.is_control())
        {
            return Err(invalid());
        }
        Ok(Self {
            provider: provider.into(),
            host: url
                .host_str()
                .ok_or_else(invalid)?
                .trim_matches(['[', ']'])
                .into(),
            port: url.port().unwrap_or(match provider {
                "smb" => 445,
                "nfs" => 2049,
                _ => 21,
            }),
            root,
            username,
            password,
            mount_port: None,
        })
    }
    fn endpoint(&self) -> String {
        let mut url = url::Url::parse(&format!("{}://localhost", self.provider)).unwrap();
        url.set_host(Some(&if self.host.contains(':') {
            format!("[{}]", self.host)
        } else {
            self.host.clone()
        }))
        .unwrap();
        url.set_port(Some(self.port)).unwrap();
        url.set_path(&self.root);
        url.into()
    }
    fn full(&self, relative: &str) -> Result<String, AppError> {
        let relative = path(relative)?;
        Ok([self.root.as_str(), &relative]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("/"))
    }
    fn addr(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}
fn urlencoding_path(value: &str) -> Result<String, AppError> {
    // URL path segments must be decoded exactly once, with no encoded separators.
    let mut result = Vec::new();
    let bytes = value.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err(invalid());
            }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|_| invalid())?;
            let b = u8::from_str_radix(hex, 16).map_err(|_| invalid())?;
            if matches!(b, b'/' | b'\\') {
                return Err(invalid());
            }
            result.push(b);
            i += 3
        } else {
            result.push(bytes[i]);
            i += 1
        }
    }
    String::from_utf8(result).map_err(|_| invalid())
}
fn config(accounts: &Accounts, id: &str) -> Result<Config, AppError> {
    let account = accounts
        .list()?
        .into_iter()
        .find(|a| a.id == id && supported(&a.provider_id))
        .ok_or_else(invalid)?;
    let config: Config =
        serde_json::from_value(accounts.credentials(id)?.provider_data).map_err(|_| invalid())?;
    if config.provider != account.provider_id
        || config.endpoint().trim_end_matches('/') != account.base_url
    {
        return Err(invalid());
    }
    Ok(config)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: String,
    name: String,
    is_directory: bool,
    size: u64,
    modified: u64,
    playable: bool,
}
fn entry(
    parent: &str,
    name: String,
    is_directory: bool,
    size: u64,
) -> Result<Option<Entry>, AppError> {
    if matches!(name.as_str(), "." | "..") {
        return Ok(None);
    }
    if name.is_empty() || name.contains('/') || path(&name)? != name {
        return Err(invalid());
    }
    let id = format!(
        "network:/{}",
        if parent.is_empty() {
            name.clone()
        } else {
            format!("{parent}/{name}")
        }
    );
    let playable = !is_directory
        && [
            "mp4", "mkv", "mov", "avi", "m4v", "webm", "ts", "m2ts", "mpg", "mpeg", "wmv", "flv",
        ]
        .contains(
            &name
                .rsplit('.')
                .next()
                .unwrap_or("")
                .to_ascii_lowercase()
                .as_str(),
        );
    Ok(Some(Entry {
        id,
        name,
        is_directory,
        size,
        modified: 0,
        playable,
    }))
}
async fn smb(c: &Config) -> Result<smb2::SmbClient, AppError> {
    let (domain, username) = c.username.split_once('\\').unwrap_or(("", &c.username));
    smb2::SmbClient::connect(smb2::ClientConfig {
        addr: c.addr(),
        username: username.into(),
        password: c.password.clone(),
        domain: domain.into(),
        timeout: TIMEOUT,
        ..Default::default()
    })
    .await
    .map_err(|_| fail())
}
async fn ftp(c: &Config) -> Result<suppaftp::tokio::AsyncFtpStream, AppError> {
    let mut client = suppaftp::tokio::AsyncFtpStream::connect(c.addr())
        .await
        .map_err(|_| fail())?;
    client
        .login(
            if c.username.is_empty() {
                "anonymous"
            } else {
                &c.username
            },
            &c.password,
        )
        .await
        .map_err(|_| fail())?;
    client
        .transfer_type(suppaftp::types::FileType::Binary)
        .await
        .map_err(|_| fail())?;
    Ok(client)
}
type Nfs = Nfs3Connection<TokioIo<tokio::net::TcpStream>>;
fn nfs_ok<T, E>(value: n::Nfs3Result<T, E>) -> Result<T, AppError> {
    match value {
        n::Nfs3Result::Ok(v) => Ok(v),
        _ => Err(fail()),
    }
}
async fn nfs(c: &Config, relative: &str) -> Result<(Nfs, n::nfs_fh3), AppError> {
    let mut builder = Nfs3ConnectionBuilder::new(TokioConnector, &c.host, format!("/{}", c.root))
        .connect_from_privileged_port(false)
        .nfs3_port(c.port)
        .credential(nfs3_client::nfs3_types::rpc::opaque_auth::auth_unix(
            &nfs3_client::nfs3_types::rpc::auth_unix {
                uid: 65534,
                gid: 65534,
                ..Default::default()
            },
        ));
    if let Some(port) = c.mount_port {
        builder = builder.mount_port(port)
    }
    let mut client = builder.mount().await.map_err(|_| fail())?;
    let mut fh = client.root_nfs_fh3();
    for name in path(relative)?.split('/').filter(|s| !s.is_empty()) {
        let value = nfs_ok(
            client
                .lookup(&n::LOOKUP3args {
                    what: n::diropargs3 {
                        dir: fh,
                        name: n::filename3(Opaque::borrowed(name.as_bytes())),
                    },
                })
                .await
                .map_err(|_| fail())?,
        )?;
        fh = value.object;
        let attr = nfs_ok(
            client
                .getattr(&n::GETATTR3args { object: fh.clone() })
                .await
                .map_err(|_| fail())?,
        )?
        .obj_attributes;
        if attr.type_ == n::ftype3::NF3LNK {
            return Err(invalid());
        }
    }
    Ok((client, fh))
}
async fn list(c: &Config, parent: &str) -> Result<Vec<Entry>, AppError> {
    let parent = path(parent)?;
    let mut result = Vec::new();
    match c.provider.as_str() {
        "smb" => {
            let mut client = smb(c).await?;
            let full = c.full(&parent)?;
            if full.is_empty() {
                for share in client.list_shares().await.map_err(|_| fail())? {
                    if share.share_type & 0xffff == 0 {
                        if let Some(e) = entry(&parent, share.name, true, 0)? {
                            result.push(e)
                        }
                    }
                }
            } else {
                let (share, rest) = full.split_once('/').unwrap_or((&full, ""));
                let mut tree = client.connect_share(share).await.map_err(|_| fail())?;
                for file in client
                    .list_directory(&mut tree, rest)
                    .await
                    .map_err(|_| fail())?
                {
                    if let Some(mut e) = entry(&parent, file.name, file.is_directory, file.size)? {
                        e.modified=file.modified.to_system_time().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|t|t.as_secs()).unwrap_or(0);result.push(e)
                    }
                }
            }
        }
        "ftp" => {
            let mut client = ftp(c).await?;
            let full = format!("/{}", c.full(&parent)?);
            let (rows, mlsd) = match client.mlsd(Some(&full)).await {
                Ok(rows) => (rows, true),
                Err(_) => (client.list(Some(&full)).await.map_err(|_| fail())?, false),
            };
            for row in rows {
                let file = if mlsd {
                    suppaftp::list::ListParser::parse_mlsd(&row)
                } else {
                    suppaftp::list::ListParser::parse_posix(&row)
                        .or_else(|_| suppaftp::list::ListParser::parse_dos(&row))
                }
                .map_err(|_| fail())?;
                if let Some(mut e) = entry(
                    &parent,
                    file.name().into(),
                    file.is_directory(),
                    file.size() as u64,
                )? {
                    e.modified=file.modified().duration_since(std::time::UNIX_EPOCH).map(|t|t.as_secs()).unwrap_or(0);result.push(e)
                }
            }
            let _ = client.quit().await;
        }
        "nfs" => {
            let (mut client, fh) = nfs(c, &parent).await?;
            let mut cookie = 0;
            let mut verf = n::cookieverf3::default();
            loop {
                let page = nfs_ok(
                    client
                        .readdirplus(&n::READDIRPLUS3args {
                            dir: fh.clone(),
                            cookie,
                            cookieverf: verf,
                            dircount: 32768,
                            maxcount: 262144,
                        })
                        .await
                        .map_err(|_| fail())?,
                )?;
                let previous = cookie;
                verf = page.cookieverf;
                for file in page.reply.entries.0 {
                    cookie = file.cookie;
                    let name =
                        String::from_utf8(file.name.0.as_ref().to_vec()).map_err(|_| invalid())?;
                    if matches!(name.as_str(), "." | "..") {
                        continue;
                    }
                    let attr = match file.name_attributes {
                        n::Nfs3Option::Some(attr) => attr,
                        _ => {
                            let value = nfs_ok(
                                client
                                    .lookup(&n::LOOKUP3args {
                                        what: n::diropargs3 {
                                            dir: fh.clone(),
                                            name: n::filename3(Opaque::borrowed(name.as_bytes())),
                                        },
                                    })
                                    .await
                                    .map_err(|_| fail())?,
                            )?;
                            nfs_ok(
                                client
                                    .getattr(&n::GETATTR3args {
                                        object: value.object,
                                    })
                                    .await
                                    .map_err(|_| fail())?,
                            )?
                            .obj_attributes
                        }
                    };
                    if attr.type_ == n::ftype3::NF3LNK {
                        continue;
                    }
                    if let Some(mut e) =
                        entry(&parent, name, attr.type_ == n::ftype3::NF3DIR, attr.size)?
                    {
                        e.modified=attr.mtime.seconds as u64;result.push(e)
                    }
                }
                if page.reply.eof {
                    break;
                }
                if cookie == previous || result.len() > 100000 {
                    return Err(fail());
                }
            }
            let _ = client.unmount().await;
        }
        _ => return Err(invalid()),
    }
    if result.len() > 100000 {
        return Err(fail());
    }
    Ok(result)
}
#[tauri::command]
pub async fn network_share_connect(
    state: tauri::State<'_, Backend>,
    request_id: String,
    provider: String,
    name: String,
    address: String,
    username: String,
    password: String,
    root_path: String,
    mount_port: Option<u16>,
) -> Result<Account, AppError> {
    let mut c = Config::parse(&provider, &address, username, password, &root_path)?;
    if mount_port == Some(0) {
        return Err(invalid());
    }
    c.mount_port = mount_port;
    let job=crate::commands::AuthJob::start(&state,request_id)?;
    tokio::select!{result=tokio::time::timeout(TIMEOUT,list(&c,""))=>{result.map_err(|_|fail())??;},_=job.cancel.cancelled()=>return Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))};
    if job.cancel.is_cancelled(){return Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
    state.accounts.save(
        Account {
            id: String::new(),
            provider_id: provider,
            name,
            base_url: c.endpoint(),
            user_id: String::new(),
            device_id: String::new(),
            auth_origins: vec![],
        },
        Credentials {
            provider_data: serde_json::to_value(c).map_err(|_| invalid())?,
            ..Default::default()
        },
    )
}
#[tauri::command]
pub async fn network_share_list(
    state: tauri::State<'_, Backend>,
    account_id: String,
    parent: String,
) -> Result<serde_json::Value, AppError> {
    let c = config(&state.accounts, &account_id)?;
    let relative = if parent.is_empty() {
        ""
    } else {
        parent.strip_prefix("network:/").ok_or_else(invalid)?
    };
    let entries = tokio::time::timeout(TIMEOUT, list(&c, relative))
        .await
        .map_err(|_| fail())??;
    Ok(serde_json::json!({"entries":entries}))
}

#[tauri::command]
pub fn network_share_connection_info(
    state: tauri::State<'_, Backend>,
    account_id: String,
) -> Result<serde_json::Value, AppError> {
    let c = config(&state.accounts, &account_id)?;
    let mut url = url::Url::parse(&c.endpoint()).map_err(|_| invalid())?;
    url.set_path("");
    Ok(
        serde_json::json!({"username":c.username,"rootPath":format!("/{}",c.root),"url":url.to_string()}),
    )
}
#[tauri::command]
pub async fn network_share_update_connection(
    state: tauri::State<'_, Backend>,
    account_id: String,
    name: String,
    url: String,
    username: String,
    password: Option<String>,
    root_path: String,
) -> Result<Account, AppError> {
    let old = config(&state.accounts, &account_id)?;
    let mut c = Config::parse(
        &old.provider,
        &url,
        username,
        password.unwrap_or(old.password),
        &root_path,
    )?;
    c.mount_port = old.mount_port;
    tokio::time::timeout(TIMEOUT, list(&c, ""))
        .await
        .map_err(|_| fail())??;
    let mut account = state
        .accounts
        .list()?
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or_else(invalid)?;
    account.name = name;
    account.base_url = c.endpoint();
    let mut credentials = state.accounts.credentials(&account_id)?;
    credentials.provider_data = serde_json::to_value(c).map_err(|_| invalid())?;
    state.network_shares.revoke(&account_id);
    state.prepared_media.revoke_account(&account_id);
    state.accounts.save(account, credentials)
}

// Loopback range bridge: no system mounts, root permissions, command-line secrets or full-file buffering.
#[derive(Default)]
pub struct Shares {
    addr: tokio::sync::OnceCell<std::net::SocketAddr>,
    grants: Mutex<HashMap<String, Grant>>,
}
impl Shares {
    pub fn revoke(&self, account: &str) {
        if let Ok(mut grants) = self.grants.lock() {
            grants.retain(|_, g| g.account != account);
        }
    }
}
#[derive(Clone)]
struct Grant {
    account: String,
    file: String,
    created: Instant,
}
#[tauri::command]
pub async fn network_share_resolve(
    app: tauri::AppHandle,
    state: tauri::State<'_, Backend>,
    account_id: String,
    file_id: String,
) -> Result<ResolvedMedia, AppError> {
    let c = config(&state.accounts, &account_id)?;
    let file = path(file_id.strip_prefix("network:/").ok_or_else(invalid)?)?;
    if file.is_empty() {
        return Err(invalid());
    }
    c.full(&file)?;
    let addr = state
        .network_shares
        .addr
        .get_or_try_init(|| async {
            let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .map_err(|_| fail())?;
            let addr = listener.local_addr().map_err(|_| fail())?;
            let router = Router::new()
                .route("/share/{token}", get(serve))
                .with_state(app.clone());
            tokio::spawn(async move {
                let _ = axum::serve(listener, router).await;
            });
            Ok::<_, AppError>(addr)
        })
        .await?;
    let key = uuid::Uuid::new_v4().to_string();
    let mut grants = state.network_shares.grants.lock().map_err(|_| fail())?;
    grants.retain(|_, g| g.created.elapsed() < Duration::from_secs(4 * 3600));
    if grants.len() >= 128 {
        return Err(fail());
    }
    grants.insert(
        key.clone(),
        Grant {
            account: account_id.clone(),
            file: file.clone(),
            created: Instant::now(),
        },
    );
    drop(grants);
    state.prepared_media.insert(ResolvedMedia {
        schema_version: 1,
        source_id: account_id.clone(),
        account_id,
        file_id,
        url: format!("http://{addr}/share/{key}"),
        headers: Default::default(),
        expires_at: None,
    })
}
enum Reader {
    Smb(smb2::FileReader),
    Nfs(Nfs, n::nfs_fh3),
    Ftp(
        suppaftp::tokio::AsyncFtpStream,
        suppaftp::tokio::AsyncDataStream<suppaftp::tokio::AsyncNoTlsStream>,
    ),
}
impl Reader {
    async fn open(c: &Config, file: &str, start: u64) -> Result<(Self, u64), AppError> {
        match c.provider.as_str() {
            "smb" => {
                let mut client = smb(c).await?;
                let full = c.full(file)?;
                let (share, rest) = full.split_once('/').ok_or_else(invalid)?;
                let tree = client.connect_share(share).await.map_err(|_| fail())?;
                let reader = client
                    .open_file_reader(&tree, rest)
                    .await
                    .map_err(|_| fail())?;
                let size = reader.size();
                Ok((Self::Smb(reader), size))
            }
            "nfs" => {
                let (mut client, fh) = nfs(c, file).await?;
                let attr = nfs_ok(
                    client
                        .getattr(&n::GETATTR3args { object: fh.clone() })
                        .await
                        .map_err(|_| fail())?,
                )?
                .obj_attributes;
                if attr.type_ != n::ftype3::NF3REG {
                    return Err(invalid());
                }
                Ok((Self::Nfs(client, fh), attr.size))
            }
            "ftp" => {
                let mut client = ftp(c).await?;
                let full = format!("/{}", c.full(file)?);
                let size = client.size(&full).await.map_err(|_| fail())? as u64;
                if start > 0 {
                    client
                        .resume_transfer(usize::try_from(start).map_err(|_| invalid())?)
                        .await
                        .map_err(|_| fail())?
                }
                let stream = client.retr_as_stream(&full).await.map_err(|_| fail())?;
                Ok((Self::Ftp(client, stream), size))
            }
            _ => Err(invalid()),
        }
    }
    async fn read(&mut self, offset: u64, len: u32) -> Result<Vec<u8>, AppError> {
        match self {
            Self::Smb(r) => r.read_at(offset, len as u64).await.map_err(|_| fail()),
            Self::Nfs(c, fh) => Ok(nfs_ok(
                c.read(&n::READ3args {
                    file: fh.clone(),
                    offset,
                    count: len,
                })
                .await
                .map_err(|_| fail())?,
            )?
            .data
            .as_ref()
            .to_vec()),
            Self::Ftp(_, r) => {
                let mut bytes = vec![0; len as usize];
                let count = r.read(&mut bytes).await.map_err(|_| fail())?;
                bytes.truncate(count);
                Ok(bytes)
            }
        }
    }
    async fn close(self) {
        match self {
            Self::Smb(r) => {
                let _ = r.close().await;
            }
            Self::Nfs(c, _) => {
                let _ = c.unmount().await;
            }
            Self::Ftp(mut c, r) => {
                drop(r);
                let _ = c.quit().await;
            }
        }
    }
}
fn range(value: Option<&str>, size: u64) -> Result<(u64, u64, bool), ()> {
    let Some(value) = value else {
        return Ok((0, size, false));
    };
    let value = value.strip_prefix("bytes=").ok_or(())?;
    let (a, b) = value.split_once('-').ok_or(())?;
    if value.contains(',') || size == 0 {
        return Err(());
    }
    if a.is_empty() {
        let count = b.parse::<u64>().map_err(|_| ())?;
        if count == 0 {
            return Err(());
        }
        return Ok((size.saturating_sub(count), size, true));
    }
    let start = a.parse::<u64>().map_err(|_| ())?;
    let end = if b.is_empty() {
        size
    } else {
        b.parse::<u64>()
            .map_err(|_| ())?
            .saturating_add(1)
            .min(size)
    };
    if start >= end {
        return Err(());
    }
    Ok((start, end, true))
}
async fn serve(
    State(app): State<tauri::AppHandle>,
    Path(token): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let backend = app.state::<Backend>();
    let grant = backend
        .network_shares
        .grants
        .lock()
        .ok()
        .and_then(|g| g.get(&token).cloned())
        .filter(|g| g.created.elapsed() < Duration::from_secs(4 * 3600));
    let Some(grant) = grant else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Ok(c) = config(&backend.accounts, &grant.account) else {
        return StatusCode::FORBIDDEN.into_response();
    };
    serve_file(c, &grant.file, method, headers).await
}
async fn serve_file(c: Config, file: &str, method: Method, headers: HeaderMap) -> Response {
    // Probe size, then reopen FTP at the requested offset (SMB/NFS use positioned reads).
    let Ok(Ok((mut reader, size))) = tokio::time::timeout(TIMEOUT, Reader::open(&c, file, 0)).await
    else {
        return StatusCode::BAD_GATEWAY.into_response();
    };
    let Ok((start, end, partial)) = range(headers.get("range").and_then(|v| v.to_str().ok()), size)
    else {
        reader.close().await;
        return (
            StatusCode::RANGE_NOT_SATISFIABLE,
            [("Content-Range", format!("bytes */{size}"))],
        )
            .into_response();
    };
    if c.provider == "ftp" && start > 0 && method != Method::HEAD {
        reader.close().await;
        let Ok(Ok((r, _))) = tokio::time::timeout(TIMEOUT, Reader::open(&c, file, start)).await
        else {
            return StatusCode::BAD_GATEWAY.into_response();
        };
        reader = r;
    }
    let body = if method == Method::HEAD {
        reader.close().await;
        Body::empty()
    } else {
        Body::from_stream(futures_util::stream::try_unfold(
            (Some(reader), start),
            move |(reader, offset)| async move {
                let Some(mut reader) = reader else {
                    return Ok::<_, std::io::Error>(None);
                };
                if offset >= end {
                    reader.close().await;
                    return Ok(None);
                }
                let length = (end - offset).min(256 * 1024) as u32;
                let bytes = tokio::time::timeout(TIMEOUT, reader.read(offset, length))
                    .await
                    .map_err(|_| std::io::Error::other("Network read timed out"))?
                    .map_err(|_| std::io::Error::other("Network read failed"))?;
                if bytes.is_empty() {
                    reader.close().await;
                    return Err(std::io::Error::other("Unexpected network EOF"));
                }
                let next = offset + bytes.len() as u64;
                Ok(Some((Bytes::from(bytes), (Some(reader), next))))
            },
        ))
    };
    let mut response = Response::builder()
        .status(if partial { 206 } else { 200 })
        .header("Accept-Ranges", "bytes")
        .header("Content-Type", "application/octet-stream")
        .header("Content-Length", end - start)
        .header("Cache-Control", "no-store");
    if partial {
        response = response.header(
            "Content-Range",
            format!("bytes {}-{}/{size}", start, end - 1),
        )
    }
    response.body(body).unwrap()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paths_and_credentials_are_scoped() {
        for p in ["../secret", "a/../secret", "a\\b", "a\n"] {
            assert!(path(p).is_err())
        }
        assert!(Config::parse(
            "smb",
            "smb://user:pass@nas/share",
            "".into(),
            "".into(),
            "/"
        )
        .is_err());
        assert!(Config::parse("nfs", "nfs://nas", "".into(), "".into(), "/").is_ok());
        let c = Config::parse(
            "smb",
            "smb://nas/share",
            "user".into(),
            "secret".into(),
            "sub",
        )
        .unwrap();
        assert_eq!(c.full("film.mkv").unwrap(), "share/sub/film.mkv");
        assert!(!c.endpoint().contains("secret"));
        assert!(urlencoding_path("/a%2fb").is_err());
    }
    #[test]
    fn range_seek_and_suffix() {
        assert_eq!(range(Some("bytes=10-19"), 100), Ok((10, 20, true)));
        assert_eq!(range(Some("bytes=-12"), 100), Ok((88, 100, true)));
        assert_eq!(range(Some("bytes=90-"), 100), Ok((90, 100, true)));
        for s in ["bytes=100-", "bytes=8-2", "bytes=0-1,4-5", "bytes=-0"] {
            assert!(range(Some(s), 100).is_err())
        }
    }
}

#[cfg(test)]
mod protocol_tests {
    use super::*;
    #[tokio::test]
    async fn nfs_protocol_lists_children_and_reads_at_offsets() {
        use nfs3_server::{
            memfs::{MemFs, MemFsConfig},
            tcp::{NFSTcp, NFSTcpListener},
        };
        let mut fs = MemFsConfig::default();
        fs.add_dir("/movies");
        fs.add_file("/movies/演示.mp4", b"0123456789abcdef".to_vec());
        fs.add_file("/readme.txt", b"fixture".to_vec());
        let server = NFSTcpListener::bind_ro("127.0.0.1:0", MemFs::new(fs).unwrap())
            .await
            .unwrap();
        let port = server.get_listen_port();
        let job = tokio::spawn(async move { server.handle_forever().await });
        let mut c = Config::parse(
            "nfs",
            &format!("nfs://127.0.0.1:{port}"),
            "".into(),
            "".into(),
            "/",
        )
        .unwrap();
        c.mount_port = Some(port);
        let rows = list(&c, "").await.unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().any(|e| e.name == "movies" && e.is_directory));
        let rows = list(&c, "movies").await.unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].playable);
        assert_eq!(rows[0].id, "network:/movies/演示.mp4");
        let (mut r, size) = Reader::open(&c, "movies/演示.mp4", 0).await.unwrap();
        assert_eq!(size, 16);
        assert_eq!(r.read(5, 4).await.unwrap(), b"5678");
        assert_eq!(r.read(0, 3).await.unwrap(), b"012");
        r.close().await;
        let response = serve_file(
            c.clone(),
            "movies/演示.mp4",
            Method::GET,
            HeaderMap::from_iter([(axum::http::header::RANGE, "bytes=5-8".parse().unwrap())]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()["Content-Range"], "bytes 5-8/16");
        assert_eq!(
            axum::body::to_bytes(response.into_body(), 100)
                .await
                .unwrap()
                .as_ref(),
            b"5678"
        );
        let response = serve_file(c, "movies/演示.mp4", Method::HEAD, HeaderMap::new()).await;
        assert_eq!(response.headers()["Content-Length"], "16");
        assert!(axum::body::to_bytes(response.into_body(), 100)
            .await
            .unwrap()
            .is_empty());
        job.abort();
    }
    #[tokio::test]
    #[ignore = "requires scripts/network-share-fixtures.py"]
    async fn ftp_fixture_listing_and_range() {
        let port =
            std::env::var("BOXPLAYER_FIXTURE_FTP_PORT").expect("start network-share fixtures");
        let c = Config::parse(
            "ftp",
            &format!("ftp://127.0.0.1:{port}"),
            "fixture".into(),
            "fixture-only".into(),
            "/",
        )
        .unwrap();
        let rows = list(&c, "").await.unwrap();
        assert!(rows.iter().any(|e| e.name == "movies" && e.is_directory));
        let rows = list(&c, "movies").await.unwrap();
        assert!(rows.iter().any(|e| e.name == "演示.mp4" && e.playable));
        let (mut r, size) = Reader::open(&c, "movies/演示.mp4", 5).await.unwrap();
        assert_eq!(size, 16);
        assert_eq!(r.read(5, 4).await.unwrap(), b"5678");
        r.close().await;
        let response = serve_file(
            c.clone(),
            "movies/演示.mp4",
            Method::GET,
            HeaderMap::from_iter([(axum::http::header::RANGE, "bytes=-4".parse().unwrap())]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            axum::body::to_bytes(response.into_body(), 100)
                .await
                .unwrap()
                .as_ref(),
            b"cdef"
        );
        let response = serve_file(
            c.clone(),
            "movies/演示.mp4",
            Method::GET,
            HeaderMap::from_iter([(axum::http::header::RANGE, "bytes=16-".parse().unwrap())]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        let mut bad = c.clone();
        bad.password = "incorrect".into();
        assert!(list(&bad, "").await.is_err());
    }
    #[tokio::test]
    #[ignore = "requires scripts/network-share-fixtures.py"]
    async fn smb_fixture_listing_and_range() {
        let port =
            std::env::var("BOXPLAYER_FIXTURE_SMB_PORT").expect("start network-share fixtures");
        let c = Config::parse(
            "smb",
            &format!("smb://127.0.0.1:{port}/media"),
            "fixture".into(),
            "fixture-only".into(),
            "/",
        )
        .unwrap();
        let rows = list(&c, "").await.unwrap();
        assert!(rows.iter().any(|e| e.name == "movies" && e.is_directory));
        let rows = list(&c, "movies").await.unwrap();
        assert!(rows.iter().any(|e| e.name == "演示.mp4" && e.playable));
        let (mut r, size) = Reader::open(&c, "movies/演示.mp4", 0).await.unwrap();
        assert_eq!(size, 16);
        assert_eq!(r.read(5, 4).await.unwrap(), b"5678");
        assert_eq!(r.read(0, 3).await.unwrap(), b"012");
        r.close().await;
        let response = serve_file(
            c.clone(),
            "movies/演示.mp4",
            Method::GET,
            HeaderMap::from_iter([(axum::http::header::RANGE, "bytes=-4".parse().unwrap())]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            axum::body::to_bytes(response.into_body(), 100)
                .await
                .unwrap()
                .as_ref(),
            b"cdef"
        );
        let response = serve_file(
            c.clone(),
            "movies/演示.mp4",
            Method::GET,
            HeaderMap::from_iter([(axum::http::header::RANGE, "bytes=16-".parse().unwrap())]),
        )
        .await;
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        let mut bad = c.clone();
        bad.password = "incorrect".into();
        assert!(list(&bad, "").await.is_err());
    }
}
