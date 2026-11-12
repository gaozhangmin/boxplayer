use crate::{
    gateway::{Gateway, HttpRequest, HttpResponse, ResolvedMedia},
    player::{self, PlayItem, Player, Snapshot, Subtitle},
    settings::AppError,
    storage::{self, Library, LocalListing, LocalSource, MigrationBundle},
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Arc, Mutex},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
type RefreshSender = tokio::sync::oneshot::Sender<Result<ResolvedMedia, AppError>>;
pub struct Backend {
    pub library: Library,
    pending_local: Mutex<Option<(String, PathBuf)>>,
    pub accounts: crate::accounts::Accounts,
    pub gateway: Arc<Gateway>,
    pub player: Arc<Player>,
    refresh: Arc<Mutex<HashMap<String, RefreshSender>>>,
    pub exiting: AtomicBool,
    pub playback_transition: tokio::sync::Mutex<()>,
    pub token_refresh: tokio::sync::Mutex<()>,
    pub auth_jobs: Mutex<HashMap<String, tokio_util::sync::CancellationToken>>,
    pub network_shares: crate::network_share::Shares,
    pub prepared_media: crate::prepared_media::PreparedMedia,
    pub speed_tests: crate::speed_test::SpeedTests,
    pub drive115_sessions: crate::drive115::Sessions,
    pub alipan_sessions: crate::alipan::Sessions,
    pub quark_sessions: crate::quark::Sessions,
    pub guangya_sessions: crate::guangya::Sessions,
    pub cloud189_sessions: crate::cloud189::Sessions,
    pub plex_sessions: crate::plex_auth::Sessions,
    pub boxplayer_sessions: crate::boxplayer_account::Sessions,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RefreshRequest {
    request_id: String,
    source_id: String,
    account_id: String,
    file_id: String,
}
impl Backend {
    pub fn new(app: tauri::AppHandle, dir: &Path) -> Result<Self, AppError> {
        let refresh: Arc<Mutex<HashMap<String, RefreshSender>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let pending = refresh.clone();
        let library=Library::open(dir)?;
        let identity_library=library.clone();
        let gateway = Gateway::with_identity(Arc::new(move |media| {
            let app = app.clone();
            let pending = pending.clone();
            Box::pin(async move {
                let request_id = uuid::Uuid::new_v4().to_string();
                struct PendingGuard {
                    pending: Arc<Mutex<HashMap<String, RefreshSender>>>,
                    id: String,
                }
                impl Drop for PendingGuard {
                    fn drop(&mut self) {
                        self.pending.lock().unwrap().remove(&self.id);
                    }
                }
                let _guard = PendingGuard {
                    pending: pending.clone(),
                    id: request_id.clone(),
                };
                let (send, receive) = tokio::sync::oneshot::channel();
                pending.lock().unwrap().insert(request_id.clone(), send);
                let request = RefreshRequest {
                    request_id: request_id.clone(),
                    source_id: media.source_id,
                    account_id: media.account_id,
                    file_id: media.file_id,
                };
                let result = if app
                    .emit_to("main", "media:refresh-request", request)
                    .is_err()
                {
                    Err(AppError::new(
                        "REFRESH_UNAVAILABLE",
                        "Source resolver is unavailable",
                        true,
                    ))
                } else {
                    match tokio::time::timeout(std::time::Duration::from_secs(12), receive).await {
                        Ok(Ok(result)) => result,
                        _ => Err(AppError::new(
                            "REFRESH_TIMEOUT",
                            "Source resolver did not respond",
                            true,
                        )),
                    }
                };
                pending.lock().unwrap().remove(&request_id);
                result
            })
        }),Arc::new(move |media|crate::remote_identity::resolve_media(&identity_library,media)))?;
        Ok(Self {
            library,
            accounts: crate::accounts::Accounts::open(dir)?,
            gateway,
            player: Player::new(),
            refresh,
            exiting: AtomicBool::new(false),
            playback_transition: tokio::sync::Mutex::new(()),
            token_refresh: tokio::sync::Mutex::new(()),
            auth_jobs: Mutex::new(HashMap::new()),
            pending_local: Mutex::new(None),
            network_shares: Default::default(),
            prepared_media: Default::default(),
            speed_tests: Default::default(),
            drive115_sessions: Default::default(),
            alipan_sessions: Default::default(),
            quark_sessions: Default::default(),
            guangya_sessions: Default::default(),
            cloud189_sessions: Default::default(),
            plex_sessions: Default::default(),
            boxplayer_sessions: Default::default(),
        })
    }
}
#[tauri::command]
pub fn local_sources(state: State<'_, Backend>) -> Result<Vec<LocalSource>, AppError> {
    state.library.sources()
}
#[tauri::command]
pub fn local_remove_source(app: tauri::AppHandle, state: State<'_,Backend>, source_id:String) -> Result<(),AppError> {
    let catalog=crate::catalog::remove_local_source(&state.library,&source_id)?;
    let _=app.emit("catalog:changed",catalog.revision);let _=app.emit("library:changed",());Ok(())
}
#[tauri::command]
pub fn local_rename_source(app: tauri::AppHandle,state:State<'_,Backend>,source_id:String,name:String)->Result<(),AppError>{
    let name=name.trim();if name.is_empty()||name.len()>512{return Err(AppError::new("SOURCE_NAME","来源名称无效",false))}
    let changed=state.library.connect()?.execute("UPDATE sources SET name=?1 WHERE id=?2",rusqlite::params![name,source_id]).map_err(|_|AppError::new("SOURCE_STORAGE","无法重命名来源",false))?;
    if changed==0{return Err(AppError::new("SOURCE_MISSING","来源已移除",false))}let _=app.emit("library:changed",());Ok(())
}
#[derive(Serialize)]
pub struct ChosenFolder { id: String, path: String, name: String }
#[tauri::command]
pub async fn local_choose_folder(app:tauri::AppHandle)->Result<Option<ChosenFolder>,AppError>{
    let cloned=app.clone();
    let choice=tauri::async_runtime::spawn_blocking(move||cloned.dialog().file().blocking_pick_folder()).await.map_err(|_|AppError::new("DIALOG","Folder selection failed",true))?;
    let Some(choice)=choice else{return Ok(None)};
    let path=choice.into_path().map_err(|_|AppError::new("LOCAL_PATH","Select a local directory",false))?.canonicalize().map_err(AppError::io)?;
    if !path.is_dir(){return Err(AppError::new("NOT_DIRECTORY","Select a directory",false))}
    let id=uuid::Uuid::new_v4().to_string();
    let name=path.file_name().map(|v|v.to_string_lossy().into_owned()).unwrap_or_else(||path.display().to_string());
    let result=ChosenFolder{id:id.clone(),path:path.display().to_string(),name};
    *app.state::<Backend>().pending_local.lock().map_err(|_|AppError::new("LOCAL_SELECTION","Folder selection unavailable",true))?=Some((id,path));
    Ok(Some(result))
}
#[tauri::command]
pub fn local_cancel_folder(state:State<'_,Backend>,selection_id:String)->Result<(),AppError>{
    let mut selected=state.pending_local.lock().map_err(|_|AppError::new("LOCAL_SELECTION","Folder selection unavailable",true))?;
    if selected.as_ref().is_some_and(|(id,_)|id==&selection_id){*selected=None}Ok(())
}
#[tauri::command]
pub fn local_save_chosen_source(app:tauri::AppHandle,state:State<'_,Backend>,selection_id:String,name:String)->Result<LocalSource,AppError>{
    let name=name.trim();if name.len()>512{return Err(AppError::new("SOURCE_NAME","来源名称无效",false))}
    let mut selected=state.pending_local.lock().map_err(|_|AppError::new("LOCAL_SELECTION","Folder selection unavailable",true))?;
    let Some((id,path))=selected.as_ref() else{return Err(AppError::new("LOCAL_SELECTION","请重新选择文件夹",false))};
    if id!=&selection_id{return Err(AppError::new("LOCAL_SELECTION","文件夹选择已过期",false))}
    let source=state.library.add_source_named(path,if name.is_empty(){None}else{Some(name)})?;
    *selected=None;let _=app.emit("library:changed",());Ok(source)
}
#[tauri::command]
pub async fn local_add_source(app: tauri::AppHandle) -> Result<Option<LocalSource>, AppError> {
    let cloned = app.clone();
    let path =
        tauri::async_runtime::spawn_blocking(move || cloned.dialog().file().blocking_pick_folder())
            .await
            .map_err(|_| AppError::new("DIALOG", "Folder selection failed", true))?;
    let Some(path) = path else { return Ok(None) };
    let path = path
        .into_path()
        .map_err(|_| AppError::new("LOCAL_PATH", "Select a local directory", false))?;
    let source = app.state::<Backend>().library.add_source(&path)?;
    let _ = app.emit("library:changed", ());
    Ok(Some(source))
}
#[tauri::command]
pub async fn local_list(
    state: State<'_, Backend>,
    source_id: String,
    relative_path: String,
) -> Result<LocalListing, AppError> {
    // Directory enumeration and canonicalization may block on mounted volumes.
    // Keep the complete scoped lookup off the webview/AppKit dispatch thread.
    let library = state.library.clone();
    tauri::async_runtime::spawn_blocking(move || library.list(&source_id, &relative_path))
        .await
        .map_err(|_| AppError::new("LOCAL_LIST", "Unable to read local directory", true))?
}
#[cfg(test)]
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct LocalRenameRequest{path:String,name:String,preferences:serde_json::Value}
#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct LocalRenameReceipt{schema_version:u32,source_id:String,from:String,to:String,directory:bool,operation_id:Option<String>}
#[cfg(test)]
#[tauri::command]
pub async fn local_file_rename(state:State<'_,Backend>,source_id:String,operation:LocalRenameRequest)->Result<LocalRenameReceipt,AppError>{
 let _transition=state.playback_transition.lock().await;
 if !state.player.snapshot().session_id.is_empty(){return Err(AppError::new("LOCAL_RENAME_PLAYING","请先关闭播放器，再重命名本地文件",false))}
 let library=state.library.clone();
 tauri::async_runtime::spawn_blocking(move||{
  crate::file_manager::name(&operation.name)?;
  let root=library.resolve(&source_id,"")?;let original=crate::file_manager::scoped(&root,&operation.path,false)?;
  crate::file_manager::protect_registered_sources(&library,&original)?;
  let from=crate::file_manager::as_relative(&root,&original)?;
  let target=original.with_file_name(&operation.name);let to=crate::file_manager::as_relative(&root,&target)?;
  if from==to{return Ok(LocalRenameReceipt{schema_version:1,source_id,from,to,directory:original.is_dir(),operation_id:None})}
  let mut preferences=operation.preferences;crate::local_identity::relocate_preferences(&mut preferences,&source_id,&from,&to,original.is_dir())?;
  let entry=crate::local_journal::relocate(&library,&source_id,&from,&to)?;
  Ok(LocalRenameReceipt{schema_version:1,source_id,from:entry.from,to:entry.to,directory:entry.directory,operation_id:Some(entry.id)})
 }).await.map_err(|_|AppError::new("LOCAL_RENAME","本地重命名线程失败",true))?
}
#[cfg(test)]
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct LocalMoveRequest{path:String,parent:String,preferences:serde_json::Value}
#[cfg(test)]
#[tauri::command]
pub async fn local_file_move(state:State<'_,Backend>,source_id:String,operation:LocalMoveRequest)->Result<LocalRenameReceipt,AppError>{
 let _transition=state.playback_transition.lock().await;
 if !state.player.snapshot().session_id.is_empty(){return Err(AppError::new("LOCAL_MOVE_PLAYING","请先关闭播放器，再移动本地文件",false))}
 let library=state.library.clone();
 tauri::async_runtime::spawn_blocking(move||{
  let root=library.resolve(&source_id,"")?;let original=crate::file_manager::scoped(&root,&operation.path,false)?;
  crate::file_manager::protect_registered_sources(&library,&original)?;
  let parent=crate::file_manager::scoped(&root,&operation.parent,true)?;if !parent.is_dir(){return Err(AppError::new("LOCAL_MOVE","目标不是文件夹",false))}
  let from=crate::file_manager::as_relative(&root,&original)?;let target=parent.join(original.file_name().ok_or_else(||AppError::new("LOCAL_MOVE","来源没有文件名",false))?);let to=crate::file_manager::as_relative(&root,&target)?;
  let mut preferences=operation.preferences;crate::local_identity::relocate_preferences(&mut preferences,&source_id,&from,&to,original.is_dir())?;
  let entry=crate::local_journal::relocate(&library,&source_id,&from,&to)?;
  Ok(LocalRenameReceipt{schema_version:1,source_id,from:entry.from,to:entry.to,directory:entry.directory,operation_id:Some(entry.id)})
 }).await.map_err(|_|AppError::new("LOCAL_MOVE","本地移动线程失败",true))?
}
#[tauri::command]
pub async fn remote_identity_commit(app:tauri::AppHandle,account:crate::accounts::Account,operation:crate::remote_identity::Commit)->Result<crate::remote_identity::Receipt,AppError>{
 let backend=app.state::<Backend>();let _transition=backend.playback_transition.lock().await;
 if account.provider_id!="aliyun"||account.id!=operation.source_id{return Err(AppError::new("REMOTE_IDENTITY","跨盘移动账号不匹配",false));}
 let worker_app=app.clone();
 let receipt=tauri::async_runtime::spawn_blocking(move||{
  let backend=worker_app.state::<Backend>();
  backend.accounts.with_current(&account,||crate::remote_identity::commit(&backend.library,&operation))
 }).await.map_err(|_|AppError::new("REMOTE_IDENTITY","跨盘移动身份提交线程失败",true))??;
 let _=app.emit("catalog:changed",receipt.revision);
 Ok(receipt)
}
#[tauri::command]
pub async fn remote_operations_pending(state:State<'_,Backend>)->Result<Vec<crate::remote_identity::Pending>,AppError>{
 let library=state.library.clone();
 tauri::async_runtime::spawn_blocking(move||crate::remote_identity::pending(&library)).await.map_err(|_|AppError::new("REMOTE_IDENTITY","远端身份恢复线程失败",true))?
}
#[tauri::command]
pub async fn remote_operation_ack(state:State<'_,Backend>,id:String,source_id:String,persisted_preferences:serde_json::Value)->Result<(),AppError>{
 let _transition=state.playback_transition.lock().await;
 let library=state.library.clone();let player=state.player.clone();
 tauri::async_runtime::spawn_blocking(move||{
  player.reconcile_identities()?;
  crate::remote_identity::acknowledge(&library,&id,&source_id,&persisted_preferences)
 }).await.map_err(|_|AppError::new("REMOTE_IDENTITY","远端身份确认线程失败",true))?
}
#[tauri::command]
pub async fn local_operations_recover(state:State<'_,Backend>)->Result<Vec<crate::local_journal::Entry>,AppError>{
 let _transition=state.playback_transition.lock().await;
 let library=state.library.clone();let playing=!state.player.snapshot().session_id.is_empty();
 tauri::async_runtime::spawn_blocking(move||{
  if playing&&!crate::local_journal::pending(&library)?.is_empty(){return Err(AppError::new("LOCAL_RECOVERY_PLAYING","请先关闭播放器，再恢复本地文件操作",false))}
  crate::local_journal::recover(&library)
 }).await.map_err(|_|AppError::new("LOCAL_RECOVERY","本地文件恢复线程失败",true))?
}
#[tauri::command]
pub async fn local_operation_preferences(state:State<'_,Backend>,id:String,source_id:String,mut preferences:serde_json::Value)->Result<serde_json::Value,AppError>{
 let library=state.library.clone();
 tauri::async_runtime::spawn_blocking(move||{
  let entry=crate::local_journal::pending(&library)?.into_iter().find(|entry|entry.id==id&&entry.source_id==source_id&&entry.applied).ok_or_else(||AppError::new("LOCAL_RECOVERY","待确认操作来源不匹配",false))?;
  crate::local_identity::relocate_preferences(&mut preferences,&source_id,&entry.from,&entry.to,entry.directory)?;
  Ok(serde_json::json!({"id":id,"sourceId":source_id,"preferences":preferences}))
 }).await.map_err(|_|AppError::new("LOCAL_RECOVERY","收藏恢复线程失败",true))?
}
#[tauri::command]
pub async fn local_operation_ack(state:State<'_,Backend>,id:String,source_id:String)->Result<(),AppError>{
 let library=state.library.clone();tauri::async_runtime::spawn_blocking(move||crate::local_journal::acknowledge(&library,&id,&source_id)).await.map_err(|_|AppError::new("LOCAL_RECOVERY","操作确认线程失败",true))?
}
#[cfg(test)]
#[tauri::command]
pub async fn local_file_create(
    state: State<'_, Backend>,
    source_id: String,
    operation: crate::file_manager::CreateOperation,
) -> Result<crate::file_manager::CreateReceipt, AppError> {
    let library=state.library.clone();
    tauri::async_runtime::spawn_blocking(move || crate::file_manager::create(&library,&source_id,operation))
        .await.map_err(|_|AppError::new("FILE_TASK","Unable to complete file creation",true))?
}
fn local_item(path: &Path, source_id: &str) -> Result<PlayItem, AppError> {
    let path = path.canonicalize().map_err(AppError::io)?;
    if !path.is_file() || !storage::is_video(&path) {
        return Err(AppError::new(
            "VIDEO_UNSUPPORTED",
            "Select a supported video file",
            false,
        ));
    }
    let url = url::Url::from_file_path(&path)
        .map_err(|_| AppError::new("LOCAL_PATH", "Invalid local media path", false))?
        .to_string();
    let media = ResolvedMedia {
        schema_version: 1,
        source_id: source_id.into(),
        account_id: "local".into(),
        file_id: storage::identity(&path.to_string_lossy()),
        url,
        headers: Default::default(),
        expires_at: None,
    };
    let mut subtitles = Vec::new();
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if let Some(parent) = path.parent() {
        for extension in ["srt", "ass", "vtt"] {
            let sub = parent.join(format!("{stem}.{extension}"));
            if sub.is_file() {
                let canonical = sub.canonicalize().map_err(AppError::io)?;
                if canonical.parent() != Some(parent) {
                    continue;
                }
                let mut sub_media = media.clone();
                sub_media.file_id = storage::identity(&canonical.to_string_lossy());
                sub_media.url = url::Url::from_file_path(&canonical)
                    .map_err(|_| AppError::new("LOCAL_PATH", "Invalid subtitle path", false))?
                    .into();
                subtitles.push(Subtitle {
                    title: extension.into(),
                    media: sub_media,
                });
            }
        }
    }
    Ok(PlayItem {
        media,
        title: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        subtitles,
    })
}
async fn start(app: tauri::AppHandle, queue: Vec<PlayItem>, index: usize) -> Result<(), AppError> {
    let backend = app.state::<Backend>();
    let _transition = backend.playback_transition.lock().await;
    if backend.exiting.load(std::sync::atomic::Ordering::SeqCst) {
        return Err(AppError::new(
            "APP_CLOSING",
            "Application is closing",
            false,
        ));
    }
    crate::window_open(app.clone(), "player".into())?;
    let window = app
        .get_webview_window("player")
        .ok_or_else(|| AppError::new("WINDOW", "Player window is unavailable", true))?;
    let host = player::render_host(window).await?;
    let state = app.state::<Backend>();
    let player = state.player.clone();
    let library = state.library.clone();
    let gateway = state.gateway.clone();
    let runtime = player::runtime_directory(&app);
    drop(state);
    let playback_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        player.start(playback_app, host, runtime, library, gateway, queue, index)
    })
    .await
    .map_err(|_| AppError::new("PLAYER_START", "Unable to start player", true))?
}
#[tauri::command]
pub async fn player_open_local(
    app: tauri::AppHandle,
    source_id: String,
    relative_path: String,
) -> Result<(), AppError> {
    let lib = app.state::<Backend>().library.clone();
    let path = lib.resolve(&source_id, &relative_path)?;
    let parent = Path::new(&relative_path)
        .parent()
        .unwrap_or(Path::new(""))
        .to_string_lossy()
        .into_owned();
    let listing = lib.list(&source_id, &parent)?;
    let mut queue = Vec::new();
    let mut index = None;
    for entry in listing
        .entries
        .into_iter()
        .filter(|e| e.playable && !e.is_directory)
    {
        let item = local_item(&lib.resolve(&source_id, &entry.relative_path)?, &source_id)?;
        if item.media.file_id == storage::identity(&path.to_string_lossy()) {
            index = Some(queue.len())
        }
        queue.push(item);
    }
    start(
        app,
        queue,
        index.ok_or_else(|| {
            AppError::new("VIDEO_MISSING", "Video is no longer in this folder", true)
        })?,
    )
    .await
}
#[tauri::command]
pub async fn player_open_file(app: tauri::AppHandle, path: String) -> Result<(), AppError> {
    let path = PathBuf::from(path).canonicalize().map_err(AppError::io)?;
    let source = storage::identity(&path.parent().unwrap_or(Path::new("/")).to_string_lossy());
    let item = local_item(&path, &source)?;
    start(app, vec![item], 0).await
}
#[tauri::command]
pub async fn player_open_remote(
    app: tauri::AppHandle,
    mut media: ResolvedMedia,
    title: String,
    mut subtitles: Vec<Subtitle>,
) -> Result<(), AppError> {
    if subtitles.len() > 128 || title.len() > 2048 {
        return Err(AppError::new("REMOTE_MEDIA", "远程播放条目超出限制", false));
    }
    app.state::<Backend>().prepared_media.hydrate(&mut media)?;
    if !media.url.starts_with("https://") && !media.url.starts_with("http://") {
        return Err(AppError::new(
            "REMOTE_URL",
            "Only HTTP(S) remote media is supported",
            false,
        ));
    }
    app.state::<Backend>().accounts.media_headers(&mut media)?;
    for subtitle in &mut subtitles {
        validate_subtitle_identity(&media, &subtitle.media)?;
        app.state::<Backend>()
            .prepared_media
            .hydrate(&mut subtitle.media)?;
        let url = url::Url::parse(&subtitle.media.url)
            .map_err(|_| AppError::new("SUBTITLE_URL", "字幕地址无效", false))?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err(AppError::new(
                "SUBTITLE_URL",
                "远程字幕仅支持HTTP(S)地址",
                false,
            ));
        }
        app.state::<Backend>()
            .accounts
            .media_headers(&mut subtitle.media)?;
    }
    start(
        app,
        vec![PlayItem {
            media,
            title,
            subtitles,
        }],
        0,
    )
    .await
}
fn validate_subtitle_identity(
    media: &ResolvedMedia,
    subtitle: &ResolvedMedia,
) -> Result<(), AppError> {
    if subtitle.account_id != media.account_id || subtitle.source_id != media.source_id {
        return Err(AppError::new(
            "SUBTITLE_IDENTITY",
            "字幕与播放来源账号不匹配",
            false,
        ));
    }
    Ok(())
}
#[tauri::command]
pub fn player_show_main(app: tauri::AppHandle) {
    crate::show_main(&app);
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RemoteQueueEntry {
    file_id: String,
    title: String,
}
#[tauri::command]
pub async fn player_open_source_queue(
    app: tauri::AppHandle,
    account_id: String,
    entries: Vec<RemoteQueueEntry>,
    index: usize,
) -> Result<(), AppError> {
    if entries.is_empty() || entries.len() > 1000 || index >= entries.len() {
        return Err(AppError::new(
            "QUEUE_INVALID",
            "播放列表无效或超过1000项",
            false,
        ));
    }
    let backend = app.state::<Backend>();
    if !backend
        .accounts
        .list()?
        .iter()
        .any(|a| a.id == account_id && a.provider_id != "boxplayer")
    {
        return Err(AppError::new("ACCOUNT_MISSING", "来源账号不存在", false));
    }
    let mut queue = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.file_id.is_empty() || entry.file_id.len() > 4096 || entry.title.len() > 2048 {
            return Err(AppError::new("QUEUE_INVALID", "播放列表条目无效", false));
        }
        queue.push(PlayItem {
            media: ResolvedMedia {
                schema_version: 1,
                source_id: account_id.clone(),
                account_id: account_id.clone(),
                file_id: entry.file_id,
                url: "boxplayer-queue:".into(),
                headers: Default::default(),
                expires_at: None,
            },
            title: entry.title,
            subtitles: vec![],
        });
    }
    drop(backend);
    start(app, queue, index).await
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogQueueEntry { source_id: String, file_id: String, title: String, local: bool }
#[tauri::command]
pub async fn player_open_catalog_queue(app: tauri::AppHandle, entries: Vec<CatalogQueueEntry>, index: usize, loop_playback: bool) -> Result<(), AppError> {
    if entries.is_empty() || entries.len() > 1000 || index >= entries.len() { return Err(AppError::new("QUEUE_INVALID", "播放列表无效或超过1000项", false)); }
    let backend = app.state::<Backend>();
    let accounts = backend.accounts.list()?;
    let mut queue = Vec::with_capacity(entries.len());
    for entry in entries {
        if entry.file_id.is_empty() || entry.file_id.len()>4096 || entry.title.len()>2048 { return Err(AppError::new("QUEUE_INVALID", "播放列表条目无效", false)); }
        let mut item = if entry.local {
            local_item(&backend.library.resolve(&entry.source_id,&entry.file_id)?,&entry.source_id)?
        } else {
            if !accounts.iter().any(|account| account.id==entry.source_id && account.provider_id!="boxplayer") { return Err(AppError::new("ACCOUNT_MISSING", "来源账号不存在", false)); }
            PlayItem { media: ResolvedMedia { schema_version:1,source_id:entry.source_id.clone(),account_id:entry.source_id,file_id:entry.file_id,url:"boxplayer-queue:".into(),headers:Default::default(),expires_at:None },title:String::new(),subtitles:vec![] }
        };
        item.title=entry.title;queue.push(item);
    }
    drop(backend);
    start(app.clone(),queue,index).await?;
    if loop_playback { let backend=app.state::<Backend>();let snapshot=backend.player.snapshot();backend.player.control(player::Control { session_id:snapshot.session_id,action:"queueLoop".into(),value:Some(1.0),track_id:None })?; }
    Ok(())
}
#[tauri::command]
pub fn player_state(state: State<'_, Backend>) -> Snapshot {
    state.player.snapshot()
}
#[tauri::command]
pub fn player_control(state: State<'_, Backend>, control: player::Control) -> Result<(), AppError> {
    state.player.control(control)
}
#[tauri::command]
pub async fn player_close(app: tauri::AppHandle) -> Result<(), AppError> {
    let backend = app.state::<Backend>();
    let _transition = backend.playback_transition.lock().await;
    let player = app.state::<Backend>().player.clone();
    tauri::async_runtime::spawn_blocking(move || player.stop())
        .await
        .map_err(|_| AppError::new("PLAYER_CLOSE", "Unable to close player", true))?;
    if let Some(window) = app.get_webview_window("player") {
        window
            .destroy()
            .map_err(|_| AppError::new("PLAYER_CLOSE", "Unable to destroy player window", true))?;
    }
    Ok(())
}
fn preserve_baidu_file_ids(body: &mut Vec<u8>) {
    fn visit(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Array(values) => {
                for value in values {
                    visit(value);
                }
            }
            serde_json::Value::Object(values) => {
                for (key, value) in values {
                    if key == "fs_id" && value.is_number() {
                        *value = value.to_string().into();
                    } else {
                        visit(value);
                    }
                }
            }
            _ => {}
        }
    }
    if let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(body) {
        visit(&mut value);
        if let Ok(encoded) = serde_json::to_vec(&value) {
            *body = encoded;
        }
    }
}
fn preserve_cloud189_file_ids(body: &mut Vec<u8>) {
    fn visit(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Array(values) => {
                for value in values {
                    visit(value);
                }
            }
            serde_json::Value::Object(values) => {
                for (key, value) in values {
                    if [
                        "id",
                        "fileId",
                        "folderId",
                        "familyId",
                        "parentId",
                        "parentFolderId",
                    ]
                    .contains(&key.as_str())
                        && value.is_number()
                    {
                        *value = value.to_string().into();
                    } else {
                        visit(value);
                    }
                }
            }
            _ => {}
        }
    }
    if let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(body) {
        visit(&mut value);
        if let Ok(encoded) = serde_json::to_vec(&value) {
            *body = encoded;
        }
    }
}
fn public_response_url(value: &str) -> String {
    if let Ok(mut url) = url::Url::parse(value) {
        let pairs: Vec<(String, String)> = url
            .query_pairs()
            .filter(|(key, _)| {
                !matches!(
                    key.to_ascii_lowercase().as_str(),
                    "access_token"
                        | "api_key"
                        | "token"
                        | "st"
                        | "code"
                        | "client_secret"
                        | "refresh_token"
                )
            })
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        url.set_query(None);
        if !pairs.is_empty() {
            url.query_pairs_mut().extend_pairs(pairs);
        }
        return url.into();
    }
    String::new()
}
#[cfg(test)]
mod response_url_tests {
    use super::*;
    #[test]
    fn remote_subtitles_cannot_be_loaded_from_another_account_or_source() {
        let media = ResolvedMedia {
            schema_version: 1,
            account_id: "account-a".into(),
            source_id: "source-a".into(),
            file_id: "video".into(),
            url: "https://server.test/video".into(),
            headers: Default::default(),
            expires_at: None,
        };
        let mut subtitle = media.clone();
        subtitle.file_id = "subtitle".into();
        assert!(validate_subtitle_identity(&media, &subtitle).is_ok());
        subtitle.account_id = "account-b".into();
        assert!(validate_subtitle_identity(&media, &subtitle).is_err());
        subtitle.account_id = media.account_id.clone();
        subtitle.source_id = "source-b".into();
        assert!(validate_subtitle_identity(&media, &subtitle).is_err());
    }
    #[test]
    fn tianyi_space_and_file_ids_reach_javascript_without_precision_loss() {
        let mut body=br#"{"fileListAO":{"fileList":[{"id":9007199254740997,"size":42,"familyId":9007199254740999}]}}"#.to_vec();
        preserve_cloud189_file_ids(&mut body);
        let data: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(data["fileListAO"]["fileList"][0]["id"], "9007199254740997");
        assert_eq!(
            data["fileListAO"]["fileList"][0]["familyId"],
            "9007199254740999"
        );
        assert_eq!(data["fileListAO"]["fileList"][0]["size"], 42);
    }
    #[test]
    fn baidu_large_identifiers_reach_javascript_as_lossless_strings() {
        let mut body=br#"{"errno":0,"list":[{"fs_id":9007199254740997,"size":42},{"fs_id":"9007199254740999"}]}"#.to_vec();
        preserve_baidu_file_ids(&mut body);
        let data: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(data["list"][0]["fs_id"], "9007199254740997");
        assert_eq!(data["list"][0]["size"], 42);
        assert_eq!(data["list"][1]["fs_id"], "9007199254740999");
    }
    #[test]
    fn removes_native_credentials_without_dropping_list_parameters() {
        let url=public_response_url("https://pan.baidu.com/list?Access_Token=synthetic&method=list&access%5Ftoken=duplicate&Client_Secret=hidden&dir=%2FMovie");
        let url = url::Url::parse(&url).unwrap();
        let pairs: std::collections::BTreeMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(pairs.len(), 2);
        assert_eq!(pairs["method"], "list");
        assert_eq!(pairs["dir"], "/Movie");
        assert_eq!(public_response_url("invalid-url"), "");
    }
}
#[tauri::command]
pub async fn http_request(
    state: State<'_, Backend>,
    request: HttpRequest,
) -> Result<HttpResponse, AppError> {
    let baidu = request.provider_id == "baidu";
    let cloud189 = request.provider_id == "189";
    let mut response = state.request(request).await?;
    if baidu {
        preserve_baidu_file_ids(&mut response.body);
    }
    if cloud189 {
        preserve_cloud189_file_ids(&mut response.body);
    }
    response.final_url = public_response_url(&response.final_url);
    Ok(response)
}
#[tauri::command]
pub fn http_cancel(state: State<'_, Backend>, request_id: String) -> bool {
    state.gateway.cancel(&request_id)
}
#[tauri::command]
pub fn media_refresh_complete(
    state: State<'_, Backend>,
    request_id: String,
    media: Option<ResolvedMedia>,
) -> Result<(), AppError> {
    let send = state
        .refresh
        .lock()
        .unwrap()
        .remove(&request_id)
        .ok_or_else(|| {
            AppError::new(
                "REFRESH_STALE",
                "Refresh request is no longer active",
                false,
            )
        })?;
    let resolved = media
        .map(|mut media| {
            state.prepared_media.hydrate(&mut media)?;
            state.accounts.media_headers(&mut media)?;
            Ok(media)
        })
        .transpose();
    let _ = send.send(resolved.and_then(|media| {
        media.ok_or_else(|| {
            AppError::new(
                "PROVIDER_PENDING",
                "The source provider could not refresh this media",
                false,
            )
        })
    }));
    Ok(())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub applied: bool,
    pub source_count: usize,
    pub position_count: usize,
    pub media_count: usize,
    pub backup_id: Option<String>,
    pub preferences: std::collections::BTreeMap<String,String>,
}
#[tauri::command]
pub async fn migration_export(app: tauri::AppHandle, preferences: Option<std::collections::BTreeMap<String,String>>) -> Result<bool, AppError> {
    let snapshot = crate::catalog_migration::export(&app.state::<Backend>().library)?;
    let mut payload=snapshot.payload;payload.preferences=preferences.unwrap_or_default();
    let bundle=crate::catalog_migration::encode(snapshot.source_version,payload)?;
    let cloned = app.clone();
    let file = tauri::async_runtime::spawn_blocking(move || {
        cloned
            .dialog()
            .file()
            .set_file_name("boxplayer-migration.json")
            .add_filter("JSON", &["json"])
            .blocking_save_file()
    })
    .await
    .map_err(|_| AppError::new("DIALOG", "Export dialog failed", true))?;
    let Some(file) = file else { return Ok(false) };
    let path = file
        .into_path()
        .map_err(|_| AppError::new("LOCAL_PATH", "Invalid export path", false))?;
    let bytes = serde_json::to_vec_pretty(&bundle).map_err(|_| {
        AppError::new(
            "MIGRATION_INVALID",
            "Unable to encode migration data",
            false,
        )
    })?;
    use std::io::Write;
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap_or(Path::new(".")))
        .map_err(AppError::io)?;
    temp.write_all(&bytes).map_err(AppError::io)?;
    temp.as_file().sync_all().map_err(AppError::io)?;
    temp.persist(path).map_err(|e| AppError::io(e.error))?;
    Ok(true)
}
#[tauri::command]
pub async fn migration_inspect(app:tauri::AppHandle)->Result<Option<serde_json::Value>,AppError>{
    let cloned=app.clone();let file=tauri::async_runtime::spawn_blocking(move||cloned.dialog().file().add_filter("JSON",&["json"]).blocking_pick_file()).await.map_err(|_|AppError::new("DIALOG","无法选择迁移文件",true))?;
    let Some(file)=file else{return Ok(None)};let path=file.into_path().map_err(|_|AppError::new("LOCAL_PATH","迁移文件路径无效",false))?;
    if std::fs::metadata(&path).map_err(AppError::io)?.len()>64*1024*1024{return Err(AppError::new("MIGRATION_LIMIT","迁移文件过大",false))}
    let value:serde_json::Value=serde_json::from_slice(&std::fs::read(path).map_err(AppError::io)?).map_err(|_|AppError::new("MIGRATION_INVALID","迁移文件格式无效",false))?;
    if value["schemaVersion"]==2{let bundle:crate::catalog_migration::Bundle=serde_json::from_value(value).map_err(|_|AppError::new("MIGRATION_INVALID","迁移文件格式无效",false))?;crate::catalog_migration::validate(&bundle)?;Ok(Some(serde_json::json!({"schemaVersion":2,"sourceVersion":bundle.source_version,"tables":bundle.tables,"sha256":bundle.sha256})))}
    else{let bundle:MigrationBundle=serde_json::from_value(value).map_err(|_|AppError::new("MIGRATION_INVALID","迁移文件格式无效",false))?;storage::validate_bundle(&bundle)?;Ok(Some(serde_json::json!({"schemaVersion":1,"sourceVersion":bundle.source_version,"tables":{"sources":bundle.source_count,"positions":bundle.position_count},"sha256":bundle.sha256})))}
}

#[tauri::command]
pub async fn migration_import(app: tauri::AppHandle) -> Result<Option<MigrationReport>, AppError> {
    let cloned = app.clone();
    let file = tauri::async_runtime::spawn_blocking(move || {
        cloned
            .dialog()
            .file()
            .add_filter("JSON", &["json"])
            .blocking_pick_file()
    })
    .await
    .map_err(|_| AppError::new("DIALOG", "Import dialog failed", true))?;
    let Some(file) = file else { return Ok(None) };
    let path = file
        .into_path()
        .map_err(|_| AppError::new("LOCAL_PATH", "Invalid import path", false))?;
    if std::fs::metadata(&path).map_err(AppError::io)?.len() > 64 * 1024 * 1024 {
        return Err(AppError::new(
            "MIGRATION_LIMIT",
            "Migration file is too large",
            false,
        ));
    }
    let bytes=std::fs::read(&path).map_err(AppError::io)?;
    let value:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|AppError::new("MIGRATION_INVALID","迁移文件格式无效",false))?;
    let report=if value["schemaVersion"]==2 {
        let bundle:crate::catalog_migration::Bundle=serde_json::from_value(value).map_err(|_|AppError::new("MIGRATION_INVALID","媒体库迁移文件格式无效",false))?;
        let result=crate::catalog_migration::import(&app.state::<Backend>().library,&bundle)?;
        MigrationReport{applied:result.applied,source_count:result.source_count,position_count:result.position_count,media_count:result.media_count,backup_id:result.backup_id,preferences:result.preferences}
    }else{
        let bundle:MigrationBundle=serde_json::from_value(value).map_err(|_|AppError::new("MIGRATION_INVALID","迁移文件格式无效",false))?;
        let applied=app.state::<Backend>().library.import_bundle(&bundle)?;
        MigrationReport{applied,source_count:bundle.source_count,position_count:bundle.position_count,media_count:0,backup_id:None,preferences:Default::default()}
    };
    let _ = app.emit("library:changed", ());
    let _ = app.emit("catalog:changed", ());
    Ok(Some(report))
}

#[tauri::command]
pub fn accounts_list(state: State<'_, Backend>) -> Result<Vec<crate::accounts::Account>, AppError> {
    state.accounts.list()
}
#[tauri::command]
pub fn account_save(
    state: State<'_, Backend>,
    account: crate::accounts::Account,
    credentials: crate::accounts::Credentials,
) -> Result<crate::accounts::Account, AppError> {
    state.accounts.save(account, credentials)
}

async fn server_login_inner(
    state: &Backend,
    provider_id: String,
    base_url: String,
    name: String,
    username: String,
    password: String,
    otp_code: Option<String>,
    existing_account_id: Option<String>,
) -> Result<crate::accounts::Account, AppError> {
    if provider_id == "alist" {
        return crate::alist_auth::login(
            &state.accounts,
            &state.gateway,
            base_url,
            name,
            username,
            password,
            otp_code,
        )
        .await;
    }
    if !matches!(provider_id.as_str(), "jellyfin" | "emby") {
        return Err(AppError::new("PROVIDER_INVALID", "不支持此登录方式", false));
    }
    let base = url::Url::parse(&base_url)
        .map_err(|_| AppError::new("URL_INVALID", "服务器地址无效", false))?;
    if !matches!(base.scheme(), "http" | "https")
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err(AppError::new(
            "URL_INVALID",
            "服务器地址不能包含凭据或查询参数",
            false,
        ));
    }
    let device_id = uuid::Uuid::new_v4().to_string();
    let authorization = format!(
        "MediaBrowser Client=\"BoxPlayer\", Device=\"Desktop\", DeviceId=\"{}\", Version=\"0.1.0\"",
        device_id
    );
    let auth_name = if provider_id == "emby" {
        "X-Emby-Authorization"
    } else {
        "Authorization"
    };
    let response = state
        .gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: provider_id.clone(),
            account_id: String::new(),
            method: "POST".into(),
            url: format!(
                "{}/Users/AuthenticateByName",
                base_url.trim_end_matches('/')
            ),
            headers: std::collections::BTreeMap::from([
                ("Content-Type".into(), "application/json".into()),
                (auth_name.into(), authorization),
            ]),
            body: Some(
                serde_json::to_vec(&serde_json::json!({"Username":username,"Pw":password}))
                    .unwrap(),
            ),
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    if response.status != 200 {
        return Err(AppError::new(
            "LOGIN_FAILED",
            format!("服务器登录失败（{}）", response.status),
            false,
        ));
    }
    let data: serde_json::Value = serde_json::from_slice(&response.body)
        .map_err(|_| AppError::new("LOGIN_FAILED", "服务器登录响应无效", false))?;
    let token = data["AccessToken"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::new("LOGIN_FAILED", "服务器未返回访问令牌", false))?;
    let user_id = data["User"]["Id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::new("LOGIN_FAILED", "服务器未返回用户标识", false))?
        .to_owned();
    let account=crate::accounts::Account{id:existing_account_id.clone().unwrap_or_default(),provider_id,name,base_url,user_id,device_id:device_id.clone(),auth_origins:vec![base.origin().ascii_serialization()]};
    let credentials=crate::accounts::Credentials{provider_data:serde_json::json!({"username":username}),headers:std::collections::BTreeMap::from([("X-Emby-Token".into(),token.into()),("X-Emby-Authorization".into(),format!("MediaBrowser Client=\"BoxPlayer\", Device=\"Desktop\", DeviceId=\"{}\", Version=\"0.1.0\"",device_id))]),..Default::default()};
    if existing_account_id.is_some(){state.accounts.save(account,credentials)}else{state.accounts.save_login(account,credentials)}

}

pub(crate) struct AuthJob<'a> {
    backend: &'a Backend,
    id: String,
    pub(crate) cancel: tokio_util::sync::CancellationToken,
}
impl<'a> AuthJob<'a> {
    pub(crate) fn start(backend: &'a Backend, id: String) -> Result<Self, AppError> {
        let mut jobs = backend.auth_jobs.lock().unwrap();
        if id.len() > 100 || id.is_empty() || jobs.len() >= 8 || jobs.contains_key(&id) {
            return Err(AppError::new(
                "LOGIN_BUSY",
                "登录请求无效或已有过多登录任务",
                false,
            ));
        }
        let cancel = tokio_util::sync::CancellationToken::new();
        jobs.insert(id.clone(), cancel.clone());
        Ok(Self {
            backend,
            id,
            cancel,
        })
    }
}
impl Drop for AuthJob<'_> {
    fn drop(&mut self) {
        self.backend.auth_jobs.lock().unwrap().remove(&self.id);
    }
}
#[tauri::command]
pub fn auth_cancel(state: State<'_, Backend>, request_id: String) -> bool {
    if let Some(cancel) = state.auth_jobs.lock().unwrap().get(&request_id) {
        cancel.cancel();
        true
    } else {
        false
    }
}
#[tauri::command]
pub async fn oauth_login(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    request_id: String,
    provider_id: String,
    client_id: String,
    client_secret: Option<String>,
    name: String,
    callback_port: u16,
) -> Result<crate::accounts::Account, AppError> {
    let job = AuthJob::start(&state, request_id)?;
    tokio::select! {result=crate::oauth::login(&app,&state.accounts,&state.gateway,provider_id,client_id,client_secret,name,callback_port)=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
}
#[tauri::command]
pub async fn plex_login(app:tauri::AppHandle,state:State<'_,Backend>,request_id:String)->Result<crate::plex_auth::Discovery,AppError>{
 let job=AuthJob::start(&state,request_id)?;
 tokio::select!{result=crate::plex_auth::login(&app,&state)=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
}
#[tauri::command]
pub async fn plex_save_resources(state:State<'_,Backend>,session_id:String,selected:Vec<String>,name:String)->Result<crate::plex_auth::SavedResources,AppError>{crate::plex_auth::save(&state,session_id,selected,name).await}
#[tauri::command]
pub fn plex_cancel_resources(state:State<'_,Backend>,session_id:String){crate::plex_auth::cancel(&state,&session_id)}

#[tauri::command]
pub async fn server_login(
    state: State<'_, Backend>,
    request_id: String,
    provider_id: String,
    base_url: String,
    name: String,
    username: String,
    password: String,
    otp_code: Option<String>,
) -> Result<crate::accounts::Account, AppError> {
    let job = AuthJob::start(&state, request_id)?;
    tokio::select! {result=server_login_inner(&state,provider_id,base_url,name,username,password,otp_code,None)=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
}

impl Backend {
    pub async fn request(&self, mut request: HttpRequest) -> Result<HttpResponse, AppError> {
        if request.provider_id == "aliyun" && !request.account_id.is_empty() && !crate::alipan::paired_open_request(&request) {
            let _lock = self.token_refresh.lock().await;
            crate::aliyun_web::ensure_session(
                &self.accounts,
                &self.gateway,
                &request.account_id,
                false,
            )
            .await?;
        }
        if let Err(error) = self.accounts.authorize(&mut request) {
            if error.code != "AUTH_EXPIRED" {
                return Err(error);
            }
            let _lock = self.token_refresh.lock().await;
            // Another concurrent request may already have refreshed this account.
            if self.accounts.authorize(&mut request).is_err() {
                if crate::alipan::paired_open_request(&request){crate::alipan::refresh_paired(&self.accounts,&self.gateway,&request.account_id).await?;}else{crate::oauth::refresh(&self.accounts, &self.gateway, &request.account_id).await?;}
                self.accounts.authorize(&mut request)?;
            }
        }
        if request.provider_id == "quark" && !request.account_id.is_empty() {
            let credentials = self.accounts.credentials(&request.account_id)?;
            self.gateway
                .cookies
                .ensure(&request.account_id, credentials.cookie_store.as_deref())?;
        }
        crate::cloud139::sign_request(&mut request)?;
        if let Err(error) = crate::cloud189::sign_request(&self.accounts, &mut request) {
            if error.code != "AUTH_EXPIRED" {
                return Err(error);
            }
            let _lock = self.token_refresh.lock().await;
            if crate::cloud189::sign_request(&self.accounts, &mut request).is_err() {
                if crate::alipan::paired_open_request(&request){crate::alipan::refresh_paired(&self.accounts,&self.gateway,&request.account_id).await?;}else{crate::oauth::refresh(&self.accounts, &self.gateway, &request.account_id).await?;}
                self.accounts.authorize(&mut request)?;
                crate::cloud189::sign_request(&self.accounts, &mut request)?;
            }
        }
        let mut response = self.gateway.request(request.clone()).await?;
        if request.provider_id == "aliyun"
            && !request.account_id.is_empty()
            && !crate::alipan::paired_open_request(&request)
            && crate::aliyun_web::needs_session(&response)
        {
            let _lock = self.token_refresh.lock().await;
            crate::aliyun_web::ensure_session(
                &self.accounts,
                &self.gateway,
                &request.account_id,
                true,
            )
            .await?;
            self.accounts.authorize(&mut request)?;
            response = self.gateway.request(request.clone()).await?;
        }
        if request.provider_id == "quark" && !request.account_id.is_empty() {
            let _lock = self.token_refresh.lock().await;
            if let Some(account) = self
                .accounts
                .list()?
                .into_iter()
                .find(|a| a.id == request.account_id)
            {
                let mut credentials = self.accounts.credentials(&account.id)?;
                let snapshot = self.gateway.cookies.snapshot(&account.id)?;
                if credentials.cookie_store.as_deref() != Some(snapshot.as_str()) {
                    credentials.cookie_store = Some(snapshot);
                    self.accounts.save(account, credentials)?;
                }
            }
        }
        if !crate::oauth::needs_refresh(&request.provider_id, &response)
            || request.account_id.is_empty()
            || {
                let credentials = self.accounts.credentials(&request.account_id)?;
                credentials.oauth.is_none()
                    && !(matches!(request.provider_id.as_str(), "guangya" | "pikpak" | "189")
                        && credentials.refresh_token.is_some())
            }
        {
            return Ok(response);
        }
        let _lock = self.token_refresh.lock().await;
        let mut latest = request.clone();
        let must_refresh = match self.accounts.authorize(&mut latest) {
            Ok(()) => {
                if request.provider_id == "189" {
                    crate::cloud189::same_session(&self.accounts, &request)?
                } else {
                    latest.headers == request.headers && latest.url == request.url
                }
            }
            Err(error) if error.code == "AUTH_EXPIRED" => true,
            Err(error) => return Err(error),
        };
        if must_refresh {
            if crate::alipan::paired_open_request(&request){crate::alipan::refresh_paired(&self.accounts,&self.gateway,&request.account_id).await?;}else{crate::oauth::refresh(&self.accounts, &self.gateway, &request.account_id).await?;}
            if request.provider_id == "aliyun" && !crate::alipan::paired_open_request(&request) {
                crate::aliyun_web::ensure_session(
                    &self.accounts,
                    &self.gateway,
                    &request.account_id,
                    false,
                )
                .await?;
            }

            self.accounts.authorize(&mut latest)?;
        }
        // Retry once only; all calls retain the original provider/account/request identity.
        crate::cloud189::sign_request(&self.accounts, &mut latest)?;
        self.gateway.request(latest).await
    }
}

#[tauri::command]
pub async fn drive115_begin(
    state: State<'_, Backend>,
    client_id: String,
    client_secret: Option<String>,
    name: String,
) -> Result<crate::drive115::QrCode, AppError> {
    state
        .drive115_sessions
        .begin(&state, client_id, client_secret, name)
        .await
}
#[tauri::command]
pub async fn drive115_poll(
    state: State<'_, Backend>,
    session_id: String,
) -> Result<crate::drive115::QrStatus, AppError> {
    state.drive115_sessions.poll(&state, &session_id).await
}
#[tauri::command]
pub fn drive115_cancel(state: State<'_, Backend>, session_id: String) -> bool {
    state.drive115_sessions.cancel(&session_id)
}
#[tauri::command]
pub async fn pikpak_download_url(state:State<'_,Backend>,account_id:String,file_id:String)->Result<ResolvedMedia,AppError>{
    crate::pikpak::download_url(&state,&account_id,&file_id).await
}

#[tauri::command]
pub async fn resolve_protected_media(
    state: State<'_, Backend>,
    account_id: String,
    file_id: String,
) -> Result<ResolvedMedia, AppError> {
    let provider = state
        .accounts
        .list()?
        .into_iter()
        .find(|a| a.id == account_id)
        .map(|a| a.provider_id)
        .ok_or_else(|| AppError::new("ACCOUNT_MISSING", "账号不存在", false))?;
    match provider.as_str() {
        "115" => crate::drive115::resolve(&state, &account_id, &file_id).await,
        "quark" => crate::quark::resolve(&state, &account_id, &file_id).await,
        "baidu" => crate::baidu::resolve(&state, &account_id, &file_id).await,
        "pikpak" => crate::pikpak::resolve(&state, &account_id, &file_id).await,
        _ => Err(AppError::new(
            "PROVIDER_INVALID",
            "不支持此来源取链方式",
            false,
        )),
    }
}

#[tauri::command]
pub async fn account_remove(app: tauri::AppHandle, account_id: String) -> Result<(), AppError> {
    let backend = app.state::<Backend>();
    if backend.player.snapshot().source_id == account_id {
        player_close(app.clone()).await?;
    }
    backend.speed_tests.cancel_account(&account_id);
    backend.network_shares.revoke(&account_id);
    backend.prepared_media.revoke_account(&account_id);
    backend.gateway.revoke_account(&account_id).await;
    backend.accounts.remove(&account_id)?;
    app.state::<crate::artwork_cache::ArtworkCache>().remove_account(&account_id);
    let catalog = crate::catalog::remove_source(&backend.library, &account_id)?;
    let _ = app.emit("catalog:changed", catalog.revision);
    let _ = app.emit("library:changed", ());
    Ok(())
}

#[tauri::command]
pub async fn quark_begin(
    state: State<'_, Backend>,
    name: String,
) -> Result<crate::quark::QrCode, AppError> {
    state.quark_sessions.begin(&state, name).await
}
#[tauri::command]
pub async fn quark_poll(
    state: State<'_, Backend>,
    session_id: String,
) -> Result<crate::quark::QrStatus, AppError> {
    state.quark_sessions.poll(&state, &session_id).await
}
#[tauri::command]
pub fn quark_cancel(state: State<'_, Backend>, session_id: String) -> bool {
    state.quark_sessions.cancel(&state, &session_id)
}

#[tauri::command]
pub async fn alipan_begin(
    state: State<'_, Backend>,
    name: String,
) -> Result<crate::alipan::QrCode, AppError> {
    state.alipan_sessions.begin(&state.gateway, name).await
}
#[tauri::command]
pub async fn aliyun_begin(app:tauri::AppHandle,state:State<'_,Backend>,request_id:String,name:String)->Result<crate::alipan::QrCode,AppError>{
 let job=AuthJob::start(&state,request_id)?;
 tokio::select!{result=async{let web=crate::aliyun_web::prepare_login(&app,&state.gateway,name).await?;state.alipan_sessions.begin_with_web(&state.gateway,web).await}=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
}
#[tauri::command]
pub async fn alipan_renew(state:State<'_,Backend>,session_id:String)->Result<crate::alipan::QrCode,AppError>{state.alipan_sessions.renew(&state.gateway,&session_id).await}
#[tauri::command]
pub async fn alipan_poll(
    state: State<'_, Backend>,
    session_id: String,
) -> Result<crate::alipan::QrStatus, AppError> {
    state.alipan_sessions.poll(&state, &session_id).await
}
#[tauri::command]
pub fn alipan_cancel(state: State<'_, Backend>, session_id: String) -> bool {
    state.alipan_sessions.cancel(&session_id)
}

#[tauri::command]
pub async fn aliyun_login(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    request_id: String,
    name: String,
) -> Result<crate::accounts::Account, AppError> {
    let job = AuthJob::start(&state, request_id)?;
    tokio::select! {result=crate::aliyun_web::login(&app,&state.accounts,&state.gateway,name)=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
}

#[tauri::command]
pub async fn guangya_sms(
    state: State<'_, Backend>,
    request_id: String,
    phone_number: String,
    name: String,
) -> Result<crate::guangya::Sms, AppError> {
    let job = AuthJob::start(&state, request_id)?;
    tokio::select! {result=state.guangya_sessions.begin(&state.gateway,phone_number,name)=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
}
#[tauri::command]
pub async fn guangya_login(
    state: State<'_, Backend>,
    request_id: String,
    session_id: String,
    code: String,
) -> Result<crate::accounts::Account, AppError> {
    let job = AuthJob::start(&state, request_id)?;
    tokio::select! {result=state.guangya_sessions.submit(&state.accounts,&state.gateway,&session_id,code)=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
}
#[tauri::command]
pub fn guangya_cancel(state: State<'_, Backend>, session_id: String) -> bool {
    state.guangya_sessions.cancel(&session_id)
}

#[tauri::command]
pub async fn pikpak_login(
    state: State<'_, Backend>,
    request_id: String,
    name: String,
    username: String,
    password: String,
) -> Result<crate::accounts::Account, AppError> {
    let job = AuthJob::start(&state, request_id)?;
    tokio::select! {result=crate::pikpak::login(&state.accounts,&state.gateway,name,username,password)=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
}

#[tauri::command]
pub async fn cloud139_login(
    state: State<'_, Backend>,
    request_id: String,
    name: String,
    authorization: String,
) -> Result<crate::accounts::Account, AppError> {
    let job = AuthJob::start(&state, request_id)?;
    tokio::select! {result=crate::cloud139::login(&state.accounts,&state.gateway,name,authorization)=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
}

#[tauri::command]
pub async fn cloud189_begin(
    state: State<'_, Backend>,
    request_id: String,
    name: String,
) -> Result<crate::cloud189::QrCode, AppError> {
    let job = AuthJob::start(&state, request_id)?;
    tokio::select! {result=state.cloud189_sessions.begin(&state.gateway,name)=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
}
#[tauri::command]
pub async fn cloud189_poll(
    state: State<'_, Backend>,
    session_id: String,
) -> Result<crate::cloud189::QrStatus, AppError> {
    state.cloud189_sessions.poll(&state, &session_id).await
}
#[tauri::command]
pub fn cloud189_cancel(state: State<'_, Backend>, session_id: String) -> bool {
    state.cloud189_sessions.cancel(&session_id)
}

#[tauri::command]
pub async fn server_resolve(
    state: State<'_, Backend>,
    account_id: String,
    item_id: String,
    profile: serde_json::Value,
    max_bitrate: Option<u64>,
    direct_only: bool,
    auto_bitrate: bool,
    preferred_source_id: Option<String>,
) -> Result<crate::server_playback::Resolution, AppError> {
    crate::server_playback::resolve_selected(
        &state.accounts,
        &state.gateway,
        &state.prepared_media,
        &account_id,
        &item_id,
        profile,
        max_bitrate,
        direct_only,
        auto_bitrate,
        preferred_source_id.as_deref(),
    )
    .await
}
#[tauri::command]
pub async fn server_bitrate_test(
    state: State<'_, Backend>,
    account_id: String,
    request_id: String,
) -> Result<crate::server_playback::BitrateResult, AppError> {
    let job = AuthJob::start(&state, request_id.clone())?;
    tokio::select! {result=crate::server_playback::bitrate(&state.accounts,&state.gateway,&account_id,request_id)=>result,_=job.cancel.cancelled()=>Err(AppError::new("CANCELLED","测试已停止",false))}
}

#[tauri::command]
pub async fn server_speed_start(
    state: State<'_, Backend>,
    request_id: String,
    account_id: String,
    item_id: String,
) -> Result<crate::speed_test::Snapshot, AppError> {
    let job = AuthJob::start(&state, request_id)?;
    let start = async {
        let mut media = crate::server_playback::file_media(
            &state.accounts,
            &state.gateway,
            &state.prepared_media,
            &account_id,
            &item_id,
        )
        .await?;
        let _transition = state.playback_transition.lock().await;
        state.accounts.media_headers(&mut media)?;
        state
            .speed_tests
            .start(state.gateway.clone(), media, job.cancel.clone())
            .await
    };
    tokio::select! {result=start=>result,_=job.cancel.cancelled()=>Err(AppError::new("CANCELLED","测试已停止",false))}
}
#[tauri::command]
pub fn server_speed_state(
    state: State<'_, Backend>,
    test_id: String,
) -> Result<crate::speed_test::Snapshot, AppError> {
    state.speed_tests.state(&test_id)
}
#[tauri::command]
pub fn server_speed_cancel(
    state: State<'_, Backend>,
    test_id: String,
) -> Result<crate::speed_test::Snapshot, AppError> {
    state.speed_tests.cancel(&test_id)
}

#[tauri::command]
pub async fn boxplayer_begin(
    state: State<'_, Backend>,
    request_id: String,
) -> Result<crate::boxplayer_account::DeviceLogin, AppError> {
    let job = AuthJob::start(&state, request_id)?;
    state
        .boxplayer_sessions
        .begin(&state.gateway, job.cancel.clone())
        .await
}
#[tauri::command]
pub async fn boxplayer_poll(
    state: State<'_, Backend>,
    session_id: String,
) -> Result<crate::boxplayer_account::LoginStatus, AppError> {
    state
        .boxplayer_sessions
        .poll(&state.gateway, &state.accounts, &session_id)
        .await
}
#[tauri::command]
pub fn boxplayer_cancel(state: State<'_, Backend>, session_id: String) -> bool {
    state.boxplayer_sessions.cancel(&session_id)
}
#[tauri::command]
pub fn boxplayer_browser(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    session_id: String,
) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;
    let url = state.boxplayer_sessions.browser_url(&session_id)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| AppError::new("LOGIN_BROWSER", "无法打开账号登录网页", true))
}
#[tauri::command]
pub async fn boxplayer_subscription(
    state: State<'_, Backend>,
    account_id: String,
) -> Result<crate::boxplayer_account::Subscription, AppError> {
    let _refresh = state.token_refresh.lock().await;
    crate::boxplayer_account::subscription(&state.gateway, &state.accounts, &account_id).await
}

#[tauri::command]
pub async fn auto_sign_date(
    state: State<'_, Backend>,
    account_id: String,
    completed: bool,
) -> Result<bool, AppError> {
    let _lock = state.token_refresh.lock().await;
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    state.accounts.sign_date(&account_id, &today, completed)
}

#[tauri::command]
pub fn catalog_load(state: State<'_, Backend>) -> Result<crate::catalog::Catalog, AppError> {
    crate::catalog::load(&state.library)
}
#[tauri::command]
pub fn catalog_save(
    app: tauri::AppHandle,
    state: State<'_, Backend>,
    expected_revision: u64,
    catalog: crate::catalog::Catalog,
) -> Result<crate::catalog::Catalog, AppError> {
    let previous=crate::catalog::load(&state.library)?;
    let previous_ids:std::collections::HashSet<&str>=previous.items.iter().filter_map(|item|item["id"].as_str()).collect();
    let source_ids:std::collections::HashSet<String>=state.library.sources()?.into_iter().map(|source|source.id).chain(state.accounts.list()?.into_iter().map(|account|account.id)).collect();
    for item in &catalog.items{if !previous_ids.contains(item["id"].as_str().unwrap_or(""))&&!item["sourceId"].as_str().is_some_and(|source|source_ids.contains(source)){return Err(AppError::new("CATALOG_SOURCE_REMOVED","扫描来源已移除，未写入失效结果",false));}}
    let saved = crate::catalog::save(&state.library, expected_revision, catalog)?;
    let _ = app.emit("catalog:changed", saved.revision);
    Ok(saved)
}

#[tauri::command]
pub async fn catalog_metadata(state:State<'_,Backend>,kind:String,query:String,year:Option<String>,tmdb_id:Option<String>,page:Option<u16>,season:Option<u16>)->Result<serde_json::Value,AppError>{
 let path=match kind.as_str(){"movie"=>"movie","tv" if season.is_some() && tmdb_id.is_some()=>"tv/id","tv"=>"tv","search"=>"search","daily-movies"=>"proxy/trending/movie/day","daily-tv"=>"proxy/trending/tv/day",_=>return Err(AppError::new("METADATA_QUERY","不支持的元数据查询",false))};
 if season.is_some_and(|v|v>500)||page.is_some_and(|v| !(1..=5).contains(&v))||query.len()>1024||year.as_ref().is_some_and(|v|v.len()>4)||tmdb_id.as_ref().is_some_and(|v|v.len()>20||!v.bytes().all(|c|c.is_ascii_digit())){return Err(AppError::new("METADATA_QUERY","元数据参数无效",false))}
 let mut url=url::Url::parse(&format!("https://api.xbyvideohub.com/api/tmdb/{path}")).unwrap();
 {let mut params=url.query_pairs_mut();params.append_pair("language","zh-CN");if let Some(page)=page{params.append_pair("page",&page.to_string());}if let Some(id)=tmdb_id{params.append_pair(if season.is_some() && kind=="tv"{"id"}else{"tmdbId"},&id);if let Some(season)=season{params.append_pair("season",&season.to_string());}}else if !query.is_empty(){params.append_pair(if kind=="search"{"query"}else{"title"},&query);}if let Some(year)=year{params.append_pair("year",&year);}if kind=="movie"{params.append_pair("append_to_response","release_dates");}if kind=="tv"{params.append_pair("append_to_response","content_ratings");}}
 let response=state.gateway.request(HttpRequest{request_id:uuid::Uuid::new_v4().to_string(),provider_id:"catalog".into(),account_id:String::new(),method:"GET".into(),url:url.into(),headers:Default::default(),body:None,timeout_ms:Some(45000),proxy:None}).await?;
 if response.status!=200{return Err(AppError::new("METADATA_HTTP","元数据服务暂不可用，请稍后重试",true))}serde_json::from_slice(&response.body).map_err(|_|AppError::new("METADATA_RESPONSE","元数据响应无效",false))
}

#[tauri::command]
pub async fn source_download(app:tauri::AppHandle,account_id:String,file_id:String,name:String,preferred_source_id:Option<String>)->Result<bool,AppError>{
 if file_id.is_empty()||file_id.len()>4096||name.len()>2048{return Err(AppError::new("DOWNLOAD_INVALID","下载参数无效",false))}
 let safe_name=Path::new(&name).file_name().and_then(|name|name.to_str()).filter(|name|!name.is_empty()).unwrap_or("video.mp4").to_string();
 let cloned=app.clone();let file=tauri::async_runtime::spawn_blocking(move||cloned.dialog().file().set_file_name(safe_name).blocking_save_file()).await.map_err(|_|AppError::new("DIALOG","无法打开下载保存窗口",true))?;
 let Some(file)=file else{return Ok(false)};let path=file.into_path().map_err(|_|AppError::new("LOCAL_PATH","保存路径无效",false))?;
 let backend=app.state::<Backend>();if !backend.accounts.list()?.iter().any(|account|account.id==account_id&&account.provider_id!="boxplayer"){return Err(AppError::new("ACCOUNT_MISSING","来源账号不存在",false))}
 let account=backend.accounts.list()?.into_iter().find(|a|a.id==account_id).ok_or_else(||AppError::new("ACCOUNT_MISSING","来源账号不存在",false))?;
 let media=if matches!(account.provider_id.as_str(),"plex"|"jellyfin"|"emby"){crate::server_playback::file_media_selected(&backend.accounts,&backend.gateway,&backend.prepared_media,&account_id,&file_id,preferred_source_id.as_deref()).await?}else{backend.gateway.resolve_queue_item(ResolvedMedia{schema_version:1,source_id:account_id.clone(),account_id,file_id,url:"boxplayer-queue:".into(),headers:Default::default(),expires_at:None}).await?};
 download_media_to(&backend,media,&path).await?;Ok(true)
}
async fn download_media_to(backend:&Backend,media:ResolvedMedia,path:&Path)->Result<(),AppError>{
 let proxy=backend.gateway.register(media).await?;
 let result=async{
  let client=reqwest::Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none()).build().map_err(|_|AppError::new("DOWNLOAD_CLIENT","无法创建下载连接",true))?;
  let mut response=client.get(&proxy).send().await.map_err(|_|AppError::new("DOWNLOAD_HTTP","下载连接失败",true))?;
  if !response.status().is_success(){return Err(AppError::new("DOWNLOAD_HTTP","下载请求失败",true))}
  let content_type=response.headers().get("content-type").and_then(|value|value.to_str().ok()).unwrap_or("");
  if content_type.contains("mpegurl"){return Err(AppError::new("DOWNLOAD_HLS","此来源只提供分段播放流，无法作为单文件下载",false))}
  let mut temp=tempfile::NamedTempFile::new_in(path.parent().unwrap_or(Path::new("."))).map_err(AppError::io)?;
  use std::io::Write;
  while let Some(chunk)=response.chunk().await.map_err(|_|AppError::new("DOWNLOAD_HTTP","下载中断，未替换目标文件",true))?{temp.write_all(&chunk).map_err(AppError::io)?;}
  temp.as_file().sync_all().map_err(AppError::io)?;temp.persist(&path).map_err(|error|AppError::io(error.error))?;Ok(())
 }.await;
 backend.gateway.revoke(&proxy).await;result
}

#[tauri::command]
pub async fn account_update_metadata(app:tauri::AppHandle,state:State<'_,Backend>,account_id:String,name:String,base_url:Option<String>)->Result<crate::accounts::Account,AppError>{
 let mut account=state.accounts.list()?.into_iter().find(|account|account.id==account_id).ok_or_else(||AppError::new("ACCOUNT_MISSING","来源账号不存在",false))?;
 let name=name.trim();if name.is_empty()||name.len()>512{return Err(AppError::new("SOURCE_NAME","来源名称无效",false))}account.name=name.to_owned();let previous_base=account.base_url.clone();
 if let Some(base)=base_url{let url=url::Url::parse(&base).map_err(|_|AppError::new("SOURCE_ENDPOINT","线路地址无效",false))?;
  if !matches!(url.scheme(),"http"|"https")||!url.username().is_empty()||url.password().is_some()||url.query().is_some()||url.fragment().is_some()||!account.auth_origins.contains(&url.origin().ascii_serialization()){return Err(AppError::new("SOURCE_ENDPOINT","新线路需先登录授权该服务器地址",false))}
  account.base_url=base.trim_end_matches('/').to_owned();
 }
 let credentials=state.accounts.credentials(&account_id)?;let saved=state.accounts.save(account,credentials)?;
 if saved.base_url!=previous_base{state.gateway.revoke_account(&account_id).await;}let _=app.emit("library:changed",());Ok(saved)
}

#[tauri::command]
pub async fn server_artwork(app:tauri::AppHandle,account_id:String,path:String)->Result<String,AppError>{
 if path.len()>4096||path.contains('\\')||path.contains('\r')||path.contains('\n')||path.starts_with("//")||url::Url::parse(&path).is_ok(){return Err(AppError::new("ARTWORK_PATH","服务器封面路径无效",false))}
 let backend=app.state::<Backend>();let account=backend.accounts.list()?.into_iter().find(|a|a.id==account_id&&matches!(a.provider_id.as_str(),"plex"|"emby"|"jellyfin")).ok_or_else(||AppError::new("ACCOUNT_MISSING","服务器账号不存在",false))?;
 let url=format!("{}/{}",account.base_url.trim_end_matches('/'),path.trim_start_matches('/'));let parsed=url::Url::parse(&url).map_err(|_|AppError::new("ARTWORK_PATH","服务器封面路径无效",false))?;
 if parsed.query_pairs().any(|(key,_)|matches!(key.to_lowercase().as_str(),"token"|"api_key"|"access_token"|"x-plex-token"|"authorization")){return Err(AppError::new("ARTWORK_PATH","封面路径不能携带账号凭据",false))}
 let identity=format!("{}|{}|{}",account.base_url,account.user_id,url);let cache=app.state::<crate::artwork_cache::ArtworkCache>().account_cache(&account_id);
 let bytes=if let Some(bytes)=cache.read_private(&identity)?{bytes}else{
  let response=backend.request(HttpRequest{request_id:uuid::Uuid::new_v4().to_string(),provider_id:account.provider_id,account_id:account_id.clone(),method:"GET".into(),url,headers:Default::default(),body:None,timeout_ms:Some(30000),proxy:None}).await?;
  if response.status!=200||response.body.len()>8*1024*1024||crate::artwork_cache::mime(&response.body).is_none(){return Err(AppError::new("ARTWORK_FORMAT","服务器封面格式无效或过大",false))}
  // A logout while HTTP is pending must not repopulate that account's cache.
  if !backend.accounts.list()?.iter().any(|a|a.id==account_id){return Err(AppError::new("ACCOUNT_MISSING","服务器账号已退出",false))}
  cache.store_private(&identity,&response.body)?;if !backend.accounts.list()?.iter().any(|a|a.id==account_id){app.state::<crate::artwork_cache::ArtworkCache>().remove_account(&account_id);return Err(AppError::new("ACCOUNT_MISSING","服务器账号已退出",false))}response.body
 };
 use base64::Engine;Ok(format!("data:{};base64,{}",crate::artwork_cache::mime(&bytes).unwrap_or("image/jpeg"),base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
pub async fn local_thumbnail(app:tauri::AppHandle,state:State<'_,Backend>,source_id:String,relative_path:String)->Result<String,AppError>{
 let path=state.library.resolve(&source_id,&relative_path)?;
 if !path.is_file()||!storage::is_video(&path){return Err(AppError::new("VIDEO_UNSUPPORTED","请选择支持的视频文件",false))}
 let runtime=player::runtime_directory(&app);
 let bytes=tauri::async_runtime::spawn_blocking(move||player::thumbnail::extract(&runtime,&path)).await.map_err(|_|AppError::new("THUMBNAIL_THREAD","缩略图处理失败",true))??;
 use base64::Engine;Ok(format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
pub async fn source_thumbnail(app:tauri::AppHandle,state:State<'_,Backend>,source_id:String,file_id:String)->Result<String,AppError>{
 if file_id.is_empty()||file_id.len()>4096{return Err(AppError::new("THUMBNAIL_INPUT","视频标识无效",false))}
 if !state.accounts.list()?.iter().any(|account|account.id==source_id&&account.provider_id!="boxplayer"){return Err(AppError::new("ACCOUNT_MISSING","来源账号不存在",false))}
 let media=state.gateway.resolve_queue_item(ResolvedMedia{schema_version:1,source_id:source_id.clone(),account_id:source_id,file_id,url:"boxplayer-queue:".into(),headers:Default::default(),expires_at:None}).await?;
 let proxy=state.gateway.register(media).await?;let runtime=player::runtime_directory(&app);let target=proxy.clone();
 let result=tauri::async_runtime::spawn_blocking(move||player::thumbnail::extract_remote(&runtime,&target)).await.map_err(|_|AppError::new("THUMBNAIL_THREAD","视频预览失败",true)).and_then(|value|value);
 state.gateway.revoke(&proxy).await;let bytes=result?;use base64::Engine;Ok(format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
pub async fn choose_cover_image(app:tauri::AppHandle)->Result<Option<String>,AppError>{
 let file=tauri::async_runtime::spawn_blocking(move||app.dialog().file().add_filter("封面图片",&["png","jpg","jpeg","webp"]).blocking_pick_file()).await.map_err(|_|AppError::new("DIALOG","无法打开封面选择窗口",true))?;
 let Some(file)=file else{return Ok(None)};let path=file.into_path().map_err(|_|AppError::new("COVER_PATH","封面路径无效",false))?;
 let size=std::fs::metadata(&path).map_err(AppError::io)?.len();if size==0||size>8*1024*1024{return Err(AppError::new("COVER_SIZE","封面图片需小于8MB",false))}
 let bytes=std::fs::read(path).map_err(AppError::io)?;
 let mime=if bytes.starts_with(b"\x89PNG\r\n\x1a\n"){"image/png"}else if bytes.starts_with(&[255,216,255]){"image/jpeg"}else if bytes.starts_with(b"RIFF")&&bytes.get(8..12)==Some(b"WEBP"){"image/webp"}else{return Err(AppError::new("COVER_FORMAT","请选择PNG、JPEG或WebP图片",false))};
 use base64::Engine;Ok(Some(format!("data:{mime};base64,{}",base64::engine::general_purpose::STANDARD.encode(bytes))))
}

#[tauri::command]
pub async fn pikpak_create_share(state:State<'_,Backend>,account_id:String,file_id:Option<String>,file_ids:Option<Vec<String>>,need_password:Option<bool>,expiration_days:Option<i64>)->Result<serde_json::Value,AppError>{
 if file_id.is_some()&&file_ids.is_some(){return Err(AppError::new("validation","PikPak 分享文件参数重复",false))}
 let ids=file_ids.unwrap_or_else(||file_id.into_iter().collect());crate::pikpak::create_share(&state,&account_id,&ids,need_password.unwrap_or(false),expiration_days.unwrap_or(-1)).await
}

#[tauri::command]
pub async fn server_endpoints(app:tauri::AppHandle,state:State<'_,Backend>,account_id:String,action:String,name:Option<String>,old_name:Option<String>,url:Option<String>)->Result<crate::server_endpoints::ResultState,AppError>{let result=crate::server_endpoints::update(&state,account_id,action.clone(),name,old_name,url).await?;if action!="get"{let _=app.emit("library:changed",());}Ok(result)}

#[tauri::command]
pub fn server_connection_info(state:State<'_,Backend>,account_id:String)->Result<serde_json::Value,AppError>{
 let account=state.accounts.list()?.into_iter().find(|a|a.id==account_id&&matches!(a.provider_id.as_str(),"jellyfin"|"emby"|"plex")).ok_or_else(||AppError::new("ACCOUNT_MISSING","服务器来源不存在",false))?;
 let credentials=state.accounts.credentials(&account.id)?;
 Ok(serde_json::json!({"username":credentials.provider_data["username"].as_str().unwrap_or("")}))
}
#[tauri::command]
pub async fn server_update_connection(app:tauri::AppHandle,state:State<'_,Backend>,request_id:String,account_id:String,name:String,username:String,password:Option<String>)->Result<crate::accounts::Account,AppError>{
 let job=AuthJob::start(&state,request_id)?;
 let mut account=state.accounts.list()?.into_iter().find(|a|a.id==account_id&&matches!(a.provider_id.as_str(),"jellyfin"|"emby"|"plex")).ok_or_else(||AppError::new("ACCOUNT_MISSING","服务器来源不存在",false))?;
 if name.trim().is_empty()||name.len()>512{return Err(AppError::new("SOURCE_NAME","来源名称无效",false))}
 let credentials=state.accounts.credentials(&account_id)?;
 let result=if let Some(password)=password.filter(|value|!value.is_empty()){
  if account.provider_id=="plex"{return Err(AppError::new("SOURCE_CONNECTION","Plex 账号请使用浏览器重新授权",false))}
  tokio::select!{result=server_login_inner(&state,account.provider_id.clone(),account.base_url.clone(),name.trim().into(),username,password,None,Some(account_id.clone()))=>result,_=job.cancel.cancelled()=>Err(AppError::new("LOGIN_CANCELLED","登录已取消",false))}
 }else{let previous=credentials.provider_data["username"].as_str().unwrap_or("");if !username.is_empty()&&username!=previous{return Err(AppError::new("SOURCE_CONNECTION","修改用户名时请输入密码",false))}account.name=name.trim().into();state.accounts.save(account,credentials)}?;
 state.gateway.revoke_account(&account_id).await;let _=app.emit("library:changed",());Ok(result)
}

#[tauri::command]
pub fn webdav_connection_info(state:State<'_,Backend>,account_id:String)->Result<serde_json::Value,AppError>{
 use base64::Engine;
 let account=state.accounts.list()?.into_iter().find(|a|a.id==account_id&&a.provider_id=="webdav").ok_or_else(||AppError::new("SOURCE_CONNECTION","WebDAV 来源不存在",false))?;
 let credentials=state.accounts.credentials(&account_id)?;
 let username=credentials.headers.iter().find(|(key,_)|key.eq_ignore_ascii_case("Authorization")).and_then(|(_,value)|value.strip_prefix("Basic ")).and_then(|value|base64::engine::general_purpose::STANDARD.decode(value).ok()).and_then(|bytes|String::from_utf8(bytes).ok()).and_then(|value|value.split_once(':').map(|(name,_)|name.to_owned())).unwrap_or_default();
 Ok(serde_json::json!({"username":username,"rootPath":credentials.provider_data["webdavRootPath"].as_str().unwrap_or(""),"url":credentials.provider_data["webdavConnectionUrl"].as_str().unwrap_or(&account.base_url)}))
}
#[tauri::command]
pub async fn webdav_update_connection(app:tauri::AppHandle,state:State<'_,Backend>,account_id:String,name:String,url:String,username:String,password:Option<String>,root_path:String)->Result<crate::accounts::Account,AppError>{
 use base64::Engine;
 let mut account=state.accounts.list()?.into_iter().find(|a|a.id==account_id&&a.provider_id=="webdav").ok_or_else(||AppError::new("SOURCE_CONNECTION","WebDAV 来源不存在",false))?;
 let fail=||AppError::new("SOURCE_CONNECTION","请输入无账号、查询参数和片段的 HTTP(S) 地址",false);
 let mut base=url::Url::parse(url.trim()).map_err(|_|fail())?;
 if !matches!(base.scheme(),"http"|"https")||base.host_str().is_none()||!base.username().is_empty()||base.password().is_some()||base.query().is_some()||base.fragment().is_some()||name.trim().is_empty(){return Err(fail())}
 if root_path.contains('?')||root_path.contains('#')||root_path.contains('\\'){return Err(fail())}
 let connection_url=base.to_string().trim_end_matches('/').to_owned();
 if !root_path.trim().is_empty(){base.set_path(&format!("{}/{}",base.path().trim_end_matches('/'),root_path.trim().trim_start_matches('/')))}
 let mut credentials=state.accounts.credentials(&account_id)?;
 let previous=credentials.headers.iter().find(|(key,_)|key.eq_ignore_ascii_case("Authorization")).and_then(|(_,value)|value.strip_prefix("Basic ")).and_then(|value|base64::engine::general_purpose::STANDARD.decode(value).ok()).and_then(|bytes|String::from_utf8(bytes).ok()).and_then(|value|value.split_once(':').map(|(_,password)|password.to_owned())).unwrap_or_default();
 let password=password.unwrap_or(previous);
 credentials.headers.retain(|key,_|!key.eq_ignore_ascii_case("Authorization"));
 credentials.headers.insert("Authorization".into(),format!("Basic {}",base64::engine::general_purpose::STANDARD.encode(format!("{}:{}",username,password))));
 if !credentials.provider_data.is_object(){credentials.provider_data=serde_json::json!({})}credentials.provider_data["webdavRootPath"]=root_path.into();credentials.provider_data["webdavConnectionUrl"]=connection_url.into();
 account.name=name.trim().into();account.base_url=base.to_string().trim_end_matches('/').to_owned();let origin=base.origin().ascii_serialization();if !account.auth_origins.contains(&origin){account.auth_origins.push(origin)}
 let saved=state.accounts.save(account,credentials)?;state.gateway.revoke_account(&account_id).await;let _=app.emit("library:changed",());Ok(saved)
}

#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ServerDownloadFile{file_id:String,name:String}
#[tauri::command]
pub async fn server_download_collection(app:tauri::AppHandle,account_id:String,files:Vec<ServerDownloadFile>)->Result<usize,AppError>{
 if files.is_empty()||files.len()>10000{return Err(AppError::new("DOWNLOAD_INVALID","下载列表无效",false))}
 let cloned=app.clone();let folder=tauri::async_runtime::spawn_blocking(move||cloned.dialog().file().blocking_pick_folder()).await.map_err(|_|AppError::new("DIALOG","无法选择下载文件夹",false))?;let Some(folder)=folder else{return Ok(0)};let folder=folder.into_path().map_err(|_|AppError::new("LOCAL_PATH","下载路径无效",false))?;
 let state=app.state::<Backend>();let mut count=0;
 for file in files{let name=Path::new(&file.name).file_name().and_then(|n|n.to_str()).filter(|n|!n.is_empty()&&*n!="."&&*n!="..").unwrap_or("video.mp4");let mut path=folder.join(name);let mut suffix=1;while path.exists(){path=folder.join(format!("{} ({})",name,suffix));suffix+=1}
 let media=crate::server_playback::file_media(&state.accounts,&state.gateway,&state.prepared_media,&account_id,&file.file_id).await?;download_media_to(&state,media,&path).await?;count+=1;let _=app.emit("server:download-progress",serde_json::json!({"accountId":account_id,"completed":count}));
 }Ok(count)
}

#[tauri::command]
pub fn open_media_link(app:tauri::AppHandle,url:String)->Result<(),AppError>{use tauri_plugin_opener::OpenerExt;let parsed=url::Url::parse(&url).map_err(|_|AppError::new("LINK_INVALID","链接无效",false))?;if !matches!(parsed.scheme(),"http"|"https")||!parsed.username().is_empty()||parsed.password().is_some(){return Err(AppError::new("LINK_INVALID","仅支持 HTTP 或 HTTPS 媒体链接",false))}app.opener().open_url(parsed.as_str(),None::<&str>).map_err(|_|AppError::new("LINK_OPEN","无法打开链接",true))}
