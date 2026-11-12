#[cfg(debug_assertions)]
mod audit;
#[cfg(all(debug_assertions, target_os = "macos"))]
mod audit_macos;
pub(crate) mod ffi;
mod hdr;
pub(crate) mod thumbnail;
#[cfg(target_os = "macos")]
mod native_output_macos;
use crate::{
    gateway::{Gateway, ResolvedMedia},
    settings::AppError,
    storage::{Library, Position},
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{mpsc, Arc, Mutex},
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtitle {
    pub title: String,
    pub media: ResolvedMedia,
}
#[derive(Clone)]
pub struct PlayItem {
    pub media: ResolvedMedia,
    pub title: String,
    pub subtitles: Vec<Subtitle>,
}
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub language: String,
    pub selected: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub item_id: String,
    pub title: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema_version: u32,
    pub session_id: String,
    pub item_id: String,
    pub source_id: String,
    pub title: String,
    pub display_path: String,
    pub state: String,
    pub position: f64,
    pub duration: f64,
    pub buffered_position: f64,
    pub volume: f64,
    pub speed: f64,
    pub tracks: Vec<Track>,
    pub video_width: u32,
    pub video_height: u32,
    pub queue_index: usize,
    pub queue_length: usize,
    pub queue: Vec<QueueEntry>,
    pub error: Option<String>,
    pub runtime: String,
    pub engine_version: String,
    pub embedded: bool,
    pub sequence: u64,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            schema_version: 1,
            session_id: String::new(),
            item_id: String::new(),
            source_id: String::new(),
            title: String::new(),
            display_path: String::new(),
            state: "idle".into(),
            position: 0.0,
            duration: 0.0,
            buffered_position: 0.0,
            volume: 70.0,
            speed: 1.0,
            tracks: Vec::new(),
            video_width: 0,
            video_height: 0,
            queue_index: 0,
            queue_length: 0,
            queue: vec![],
            error: None,
            runtime: String::new(),
            engine_version: String::new(),
            embedded: false,
            sequence: 0,
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Control {
    pub session_id: String,
    pub action: String,
    pub value: Option<f64>,
    pub track_id: Option<i64>,
}
enum Message {
    Control(Control),
    Reconcile(mpsc::Sender<Result<(), AppError>>),
    Stop,
}
struct Worker {
    sender: mpsc::Sender<Message>,
    thread: JoinHandle<()>,
}
pub struct Player {
    snapshot: Mutex<Snapshot>,
    worker: Mutex<Option<Worker>>,
}
impl Player {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            snapshot: Mutex::new(Snapshot::default()),
            worker: Mutex::new(None),
        })
    }
    pub fn snapshot(&self) -> Snapshot {
        self.snapshot.lock().unwrap().clone()
    }
    fn publish(&self, app: &tauri::AppHandle, mut snapshot: Snapshot) {
        let mut current = self.snapshot.lock().unwrap();
        snapshot.sequence = current.sequence + 1;
        *current = snapshot.clone();
        drop(current);
        let _ = app.emit("player:state", snapshot);
    }
    pub fn stop(&self) {
        if let Some(worker) = self.worker.lock().unwrap().take() {
            let _ = worker.sender.send(Message::Stop);
            if worker.thread.join().is_err() {
                log::error!("Player thread terminated unexpectedly");
            }
        }
    }
    /// Called under the backend playback transition lock after a durable identity commit.
    pub fn reconcile_identities(&self)->Result<(),AppError>{
        let worker=self.worker.lock().unwrap();
        let Some(worker)=worker.as_ref() else{return Ok(())};
        let (send,receive)=mpsc::channel();
        worker.sender.send(Message::Reconcile(send)).map_err(|_|AppError::new("PLAYER_IDENTITY","播放器身份同步通道已关闭",true))?;
        receive.recv_timeout(Duration::from_secs(5)).map_err(|_|AppError::new("PLAYER_IDENTITY","播放器身份同步尚未确认，请重试同步",true))?
    }
    pub fn control(&self, control: Control) -> Result<(), AppError> {
        let current = self.snapshot();
        if current.session_id != control.session_id {
            return Err(AppError::new(
                "SESSION_STALE",
                "Player session changed",
                true,
            ));
        }
        match control.action.as_str() {
            "pause" | "seek" | "volume" | "speed" | "zoom" | "aspect" | "audioDelay"
            | "subDelay" | "brightness" | "contrast" | "saturation" | "gamma" | "hue" | "loop"
            | "queue" | "queueLoop" => {
                if !control.value.is_some_and(|v| v.is_finite()) {
                    return Err(AppError::new(
                        "CONTROL_INVALID",
                        "Player control requires a finite value",
                        false,
                    ));
                }
            }
            "audio" | "subtitle" => {
                let id = control.track_id.ok_or_else(|| {
                    AppError::new("CONTROL_INVALID", "Track ID is required", false)
                })?;
                let kind = if control.action == "audio" {
                    "audio"
                } else {
                    "sub"
                };
                if id != -1 && !current.tracks.iter().any(|t| t.id == id && t.kind == kind) {
                    return Err(AppError::new(
                        "TRACK_INVALID",
                        "Track is unavailable",
                        false,
                    ));
                }
            }
            "next" | "previous" => {}
            _ => {
                return Err(AppError::new(
                    "CONTROL_INVALID",
                    "Unknown player action",
                    false,
                ))
            }
        }
        let guard = self.worker.lock().unwrap();
        let worker = guard
            .as_ref()
            .ok_or_else(|| AppError::new("PLAYER_IDLE", "Player is not running", false))?;
        worker
            .sender
            .send(Message::Control(control))
            .map_err(|_| AppError::new("PLAYER_CLOSED", "Player has closed", true))
    }
    pub fn start(
        self: &Arc<Self>,
        app: tauri::AppHandle,
        host: usize,
        runtime: PathBuf,
        library: Library,
        gateway: Arc<Gateway>,
        queue: Vec<PlayItem>,
        index: usize,
    ) -> Result<(), AppError> {
        if queue.is_empty() || index >= queue.len() {
            return Err(AppError::new(
                "QUEUE_INVALID",
                "Playback queue is empty",
                false,
            ));
        }
        let mut worker = self.worker.lock().unwrap();
        if let Some(old) = worker.take() {
            let _ = old.sender.send(Message::Stop);
            let _ = old.thread.join();
        }
        let mut initial = Snapshot::default();
        initial.state = "loading".into();
        initial.session_id = uuid::Uuid::new_v4().to_string();
        initial.item_id = queue[index].media.file_id.clone();
        initial.source_id = queue[index].media.source_id.clone();
        initial.title = queue[index].title.clone();
        initial.queue_length = queue.len();
        initial.queue = queue
            .iter()
            .map(|item| QueueEntry {
                item_id: item.media.file_id.clone(),
                title: item.title.clone(),
            })
            .collect();
        initial.queue_index = index;
        initial.runtime = runtime.to_string_lossy().into_owned();
        initial.embedded = true;
        self.publish(&app, initial.clone());
        let (sender, receiver) = mpsc::channel();
        let owner = self.clone();
        let thread = std::thread::Builder::new()
            .name("boxplayer-mpv".into())
            .spawn(move || {
                let result = run_worker(
                    &owner,
                    &app,
                    host,
                    &runtime,
                    &library,
                    &gateway,
                    queue,
                    index,
                    initial.clone(),
                    receiver,
                );
                if let Err(error) = result {
                    let mut current = owner.snapshot();
                    current.state = "error".into();
                    current.error = Some(error.message);
                    owner.publish(&app, current);
                }
            })
            .map_err(AppError::io)?;
        *worker = Some(Worker { sender, thread });
        Ok(())
    }
}
fn save(library: &Library, item: &PlayItem, snapshot: &Snapshot) {
    if snapshot.duration > 0.0 {
        if library
            .save_position(&Position {
                key: item.media.key(),
                position: snapshot.position.max(0.0).min(snapshot.duration),
                duration: snapshot.duration,
            })
            .is_err()
        {
            log::error!("Unable to persist playback progress");
        }
    }
}
fn load(
    mpv: &mut ffi::Mpv,
    item: &PlayItem,
    gateway: &Arc<Gateway>,
    library: &Library,
    proxies: &mut Vec<String>,
    snapshot: &mut Snapshot,
) -> Result<(), AppError> {
    let mut current=item.clone();
    current.media=gateway.canonical_media(&current.media)?;
    for subtitle in &mut current.subtitles {subtitle.media=gateway.canonical_media(&subtitle.media)?;}
    let item=&current;
    for url in proxies.drain(..) {
        tauri::async_runtime::block_on(gateway.revoke(&url));
    }
    let url = if item.media.url.starts_with("file://") {
        url::Url::parse(&item.media.url)
            .ok()
            .and_then(|u| u.to_file_path().ok())
            .ok_or_else(|| AppError::new("LOCAL_URL", "Invalid local playback URL", false))?
            .to_string_lossy()
            .into_owned()
    } else {
        let media = if item.media.url == "boxplayer-queue:" {
            tauri::async_runtime::block_on(gateway.resolve_queue_item(item.media.clone()))?
        } else {
            item.media.clone()
        };
        let url = tauri::async_runtime::block_on(gateway.register(media))?;
        proxies.push(url.clone());
        url
    };
    snapshot.display_path = if item.media.url.starts_with("file://") {
        url.clone()
    } else {
        item.title.clone()
    };
    let resume = library
        .position(&item.media.key())?
        .filter(|p| p.duration > 0.0 && p.position < p.duration * 0.95)
        .map(|p| p.position)
        .unwrap_or(0.0);
    snapshot.item_id = item.media.file_id.clone();
    snapshot.source_id = item.media.source_id.clone();
    snapshot.title = item.title.clone();
    snapshot.position = resume;
    if resume > 0.0 {
        log::info!("Resuming playback at {:.3} seconds", resume);
    }
    snapshot.duration = 0.0;
    snapshot.buffered_position = 0.0;
    snapshot.tracks.clear();
    snapshot.state = "loading".into();
    snapshot.error = None;
    mpv.set("pause", "yes")?;
    mpv.set("start", &resume.to_string())?;
    mpv.command(&["loadfile", &url, "replace"])?;
    Ok(())
}
fn tracks(mpv: &ffi::Mpv) -> Vec<Track> {
    mpv.json("track-list")
        .and_then(|v| v.as_array().cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| {
            Some(Track {
                id: v.get("id")?.as_i64()?,
                kind: v.get("type")?.as_str()?.into(),
                title: v.get("title").and_then(|v| v.as_str()).unwrap_or("").into(),
                language: v.get("lang").and_then(|v| v.as_str()).unwrap_or("").into(),
                selected: v.get("selected").and_then(|v| v.as_bool()).unwrap_or(false),
            })
        })
        .collect()
}
struct ProxyLease {
    gateway: Arc<Gateway>,
    urls: Vec<String>,
}
fn reload_hls_session(mpv: &mut ffi::Mpv, url: &str) -> Result<(), AppError> {
    mpv.set("pause", "yes")?;
    // HLS demuxer start offsets may skip the containing segment. Seek exactly
    // after FILE_LOADED instead, while decoding remains paused.
    mpv.set("start", "none")?;
    mpv.command(&["loadfile", url, "replace"])
}
#[derive(Default, Clone)]
struct RecoveryTracks {
    audio: Option<String>,
    subtitle: Option<String>,
}
impl RecoveryTracks {
    fn capture(mpv: &ffi::Mpv) -> Self {
        Self {
            audio: mpv.string("aid"),
            subtitle: mpv.string("sid"),
        }
    }
    fn restore(self, mpv: &mut ffi::Mpv) -> Result<(), AppError> {
        let available = tracks(mpv);
        for (property, kind, value) in [("aid", "audio", self.audio), ("sid", "sub", self.subtitle)]
        {
            if let Some(value) = value {
                if value == "no"
                    || value == "auto"
                    || value.parse::<i64>().ok().is_some_and(|id| {
                        available
                            .iter()
                            .any(|track| track.id == id && track.kind == kind)
                    })
                {
                    mpv.set(property, &value)?
                }
            }
        }
        Ok(())
    }
}
impl Drop for ProxyLease {
    fn drop(&mut self) {
        for url in self.urls.drain(..) {
            tauri::async_runtime::block_on(self.gateway.revoke(&url));
        }
    }
}
fn reconcile_queue(queue:&mut Vec<PlayItem>,remote_subtitles:&mut Vec<Subtitle>,state:&mut Snapshot,resolve:impl Fn(&ResolvedMedia)->Result<ResolvedMedia,AppError>)->Result<(),AppError>{
    let mut next=queue.clone();let mut subtitles=remote_subtitles.clone();
    for item in &mut next {
        item.media=resolve(&item.media)?;
        for subtitle in &mut item.subtitles {subtitle.media=resolve(&subtitle.media)?;}
    }
    for subtitle in &mut subtitles {subtitle.media=resolve(&subtitle.media)?;}
    let current=next.get(state.queue_index).ok_or_else(||AppError::new("PLAYER_IDENTITY","播放队列位置无效",false))?;
    state.item_id=current.media.file_id.clone();state.source_id=current.media.source_id.clone();
    state.queue=next.iter().map(|item|QueueEntry{item_id:item.media.file_id.clone(),title:item.title.clone()}).collect();
    state.queue_length=next.len();*queue=next;*remote_subtitles=subtitles;Ok(())
}
fn run_worker(
    owner: &Player,
    app: &tauri::AppHandle,
    host: usize,
    runtime: &std::path::Path,
    library: &Library,
    gateway: &Arc<Gateway>,
    mut queue: Vec<PlayItem>,
    mut index: usize,
    mut state: Snapshot,
    receiver: mpsc::Receiver<Message>,
) -> Result<(), AppError> {
    let mut proxies = ProxyLease {
        gateway: gateway.clone(),
        urls: Vec::new(),
    };
    let mut mpv = ffi::Mpv::new(runtime, Some(host))?;
    let mut hdr = hdr::HdrOutput::default();
    #[cfg(target_os = "macos")]
    let sdr_cleanup_done = Arc::new(std::sync::atomic::AtomicBool::new(true));
    #[cfg(debug_assertions)]
    let mut audit = audit::Audit::new();
    state.engine_version = mpv.string("mpv-version").unwrap_or_default();
    log::info!("Player engine: {}", state.engine_version);
    load(
        &mut mpv,
        &queue[index],
        gateway,
        library,
        &mut proxies.urls,
        &mut state,
    )?;
    let mut published = Instant::now();
    let mut persisted = Instant::now();
    let mut loaded = false;
    let mut want_paused = false;
    let mut stopping = false;
    let mut queue_loop = false;
    let mut hls_recoveries = 0usize;
    let mut recovery_position: Option<f64> = None;
    let mut remote_subtitles: Vec<Subtitle> = Vec::new();
    let mut recovery_tracks: Option<RecoveryTracks> = None;
    let mut last_tracks: Option<RecoveryTracks> = None;
    while !stopping {
        while let Ok(message) = receiver.try_recv() {
            match message {
                Message::Reconcile(reply)=>{
                    let result=reconcile_queue(&mut queue,&mut remote_subtitles,&mut state,|media|gateway.canonical_media(media));
                    if result.is_ok(){owner.publish(app,state.clone());}
                    let _=reply.send(result);
                }
                Message::Stop => {
                    stopping = true;
                    break;
                }
                Message::Control(control) => {
                    if control.session_id != state.session_id {
                        continue;
                    }
                    let value = control.value.unwrap_or(0.0);
                    let result = match control.action.as_str() {
                        "pause" => {
                            want_paused = value != 0.0;
                            mpv.set("pause", if want_paused { "yes" } else { "no" })
                        }
                        "seek" => mpv.command(&[
                            "seek",
                            &value.clamp(0.0, state.duration.max(0.0)).to_string(),
                            "absolute+exact",
                        ]),
                        "volume" => mpv.set("volume", &value.clamp(0.0, 100.0).to_string()),
                        "speed" => mpv.set("speed", &value.clamp(0.25, 4.0).to_string()),
                        "zoom" => mpv.set("video-zoom", &value.clamp(-4.0, 2.0).to_string()),
                        "aspect" => mpv.set(
                            "video-aspect-override",
                            if value < 0.0 {
                                "no".into()
                            } else {
                                value.clamp(0.1, 10.0).to_string()
                            }
                            .as_str(),
                        ),
                        "audioDelay" => {
                            mpv.set("audio-delay", &value.clamp(-30.0, 30.0).to_string())
                        }
                        "subDelay" => mpv.set("sub-delay", &value.clamp(-120.0, 120.0).to_string()),
                        "brightness" | "contrast" | "saturation" | "gamma" | "hue" => {
                            mpv.set(&control.action, &value.clamp(-100.0, 100.0).to_string())
                        }
                        "queueLoop" => { queue_loop = value != 0.0; Ok(()) },
                        "loop" => mpv.set("loop-file", if value != 0.0 { "inf" } else { "no" }),
                        "audio" => mpv.set("aid", &control.track_id.unwrap_or(-1).to_string()),
                        "subtitle" => {
                            let id = if control.track_id == Some(-1) {
                                "no".to_string()
                            } else {
                                control.track_id.unwrap_or(-1).to_string()
                            };
                            mpv.set("sid", &id)
                        }
                        "next" | "previous" | "queue" => {
                            let next = if control.action == "queue" {
                                (value.max(0.0) as usize).min(queue.len() - 1)
                            } else if control.action == "next" {
                                index.saturating_add(1).min(queue.len() - 1)
                            } else {
                                index.saturating_sub(1)
                            };
                            if next != index {
                                hls_recoveries = 0;
                                recovery_position = None;
                                remote_subtitles.clear();
                                recovery_tracks = None;
                                last_tracks = None;
                                save(library, &queue[index], &state);
                                index = next;
                                state.queue_index = index;
                                state.session_id = uuid::Uuid::new_v4().to_string();
                                loaded = false;
                                load(
                                    &mut mpv,
                                    &queue[index],
                                    gateway,
                                    library,
                                    &mut proxies.urls,
                                    &mut state,
                                )?;
                            }
                            Ok(())
                        }
                        _ => Ok(()),
                    };
                    if result.is_err() {
                        state.error = Some("Player control failed".into());
                    }
                }
            }
        }
        if stopping {
            break;
        }
        let event = mpv.wait(0.04);
        if !event.is_null() {
            unsafe {
                match (*event).id {
                    8 => {
                        loaded = true;
                        if let Some(position) = recovery_position.take() {
                            mpv.command(&["seek", &position.to_string(), "absolute+exact"])?;
                        }
                        let fresh = gateway.take_subtitles(&queue[index].media);
                        if !fresh.is_empty() {
                            remote_subtitles = fresh
                        }
                        for (subtitle_index, subtitle) in queue[index]
                            .subtitles
                            .iter()
                            .chain(remote_subtitles.iter())
                            .enumerate()
                        {
                            let url = if subtitle.media.url.starts_with("file://") {
                                url::Url::parse(&subtitle.media.url)
                                    .ok()
                                    .and_then(|u| u.to_file_path().ok())
                                    .map(|p| p.to_string_lossy().into_owned())
                                    .ok_or_else(|| {
                                        AppError::new("SUBTITLE_URL", "Invalid subtitle URL", false)
                                    })?
                            } else {
                                let url = tauri::async_runtime::block_on(
                                    gateway.register(subtitle.media.clone()),
                                )?;
                                proxies.urls.push(url.clone());
                                url
                            };
                            mpv.command(&[
                                "sub-add",
                                &url,
                                if subtitle_index == 0 {
                                    "select"
                                } else {
                                    "auto"
                                },
                                &subtitle.title,
                            ])?;
                        }
                        if let Some(selection) = recovery_tracks.take() {
                            selection.restore(&mut mpv)?
                        }
                        mpv.set("pause", if want_paused { "yes" } else { "no" })?;
                        state.state = "playing".into();
                        log::info!("Player file loaded into native view");
                    }
                    7 => {
                        if !(*event).data.is_null() {
                            let end = &*((*event).data as *const ffi::EndFile);
                            if end.error < 0 {
                                let recovery = proxies
                                    .urls
                                    .first()
                                    .filter(|_| hls_recoveries < 2)
                                    .filter(|url| {
                                        tauri::async_runtime::block_on(
                                            gateway.take_hls_recovery(url),
                                        )
                                    })
                                    .cloned();
                                if let Some(url) = recovery {
                                    hls_recoveries += 1;
                                    // Reuse the native resource holding the renewed session;
                                    // registering the queue's original URL would revive the expired session.
                                    let position = state.position.max(0.0);
                                    recovery_position = Some(position);
                                    recovery_tracks = Some(
                                        last_tracks
                                            .clone()
                                            .unwrap_or_else(|| RecoveryTracks::capture(&mpv)),
                                    );
                                    loaded = false;
                                    reload_hls_session(&mut mpv, &url)?;
                                    state.state = "loading".into();
                                    state.error = None;
                                } else {
                                    state.state = "error".into();
                                    state.error =
                                        Some(format!("mpv playback failed ({})", end.error));
                                }
                            } else if end.reason == 0 {
                                state.state = "ended".into();
                            }
                        }
                    }
                    1 => stopping = true,
                    _ => {}
                }
            }
        }
        if loaded && published.elapsed() >= Duration::from_millis(250) {
            if let Some(v) = mpv.number("time-pos") {
                state.position = v.max(0.0)
            }
            if let Some(v) = mpv.number("duration") {
                state.duration = v.max(0.0)
            }
            state.buffered_position = mpv
                .number("demuxer-cache-time")
                .filter(|v| v.is_finite())
                .unwrap_or(state.position)
                .max(state.position)
                .min(state.duration.max(0.0));
            state.volume = mpv.number("volume").unwrap_or(state.volume);
            state.speed = mpv.number("speed").unwrap_or(state.speed);
            state.video_width = mpv.number("width").unwrap_or(0.0) as u32;
            state.video_height = mpv.number("height").unwrap_or(0.0) as u32;
            state.tracks = tracks(&mpv);
            if state.state != "error" {
                last_tracks = Some(RecoveryTracks::capture(&mpv));
            }
            if state.state != "error" {
                state.state = if mpv.flag("eof-reached") == Some(true) {
                    "ended"
                } else if mpv.flag("pause") == Some(true) {
                    "paused"
                } else {
                    "playing"
                }
                .into();
            }
            #[cfg(target_os = "macos")]
            let was_hdr = hdr.enabled();
            if loaded {
                if let Err(error) = hdr.update(&mut mpv) {
                    state.error = Some(format!("HDR output routing failed: {}", error.message));
                }
            }
            #[cfg(target_os = "macos")]
            {
                if loaded && was_hdr && !hdr.enabled() {
                    sdr_cleanup_done.store(false, std::sync::atomic::Ordering::Release);
                }
                if !hdr.enabled() && !sdr_cleanup_done.load(std::sync::atomic::Ordering::Acquire) {
                    native_output_macos::clear_sdr_metadata(app, sdr_cleanup_done.clone());
                }
            }
            #[cfg(debug_assertions)]
            audit.tick(&mpv, &state, app);
            owner.publish(app, state.clone());
            published = Instant::now();
            if let Some(next) = (state.state == "ended").then(|| next_queue_index(index,queue.len(),queue_loop)).flatten() {
                save(library, &queue[index], &state);
                index = next;
                state.queue_index = index;
                state.session_id = uuid::Uuid::new_v4().to_string();
                loaded = false;
                want_paused = false;
                hls_recoveries = 0;
                recovery_position = None;
                remote_subtitles.clear();
                recovery_tracks = None;
                last_tracks = None;
                load(
                    &mut mpv,
                    &queue[index],
                    gateway,
                    library,
                    &mut proxies.urls,
                    &mut state,
                )?;
                // Publish loading under the new identity before any new progress.
                owner.publish(app, state.clone());
            }
        }
        if persisted.elapsed() >= Duration::from_secs(2) {
            save(library, &queue[index], &state);
            persisted = Instant::now();
        }
    }
    if let Some(position) = mpv.number("time-pos") {
        state.position = position
    }
    if let Some(duration) = mpv.number("duration") {
        state.duration = duration
    }
    save(library, &queue[index], &state);
    // Destroy mpv before its host window; native render callbacks can synchronously touch AppKit.
    drop(mpv);
    drop(proxies);
    state.state = "idle".into();
    owner.publish(app, state);
    Ok(())
}
fn next_queue_index(index:usize,length:usize,repeat:bool)->Option<usize>{
    if length==0||index>=length{return None}
    if index+1<length{Some(index+1)}else if repeat{Some(0)}else{None}
}
#[cfg(test)]
mod queue_mode_tests {
    use super::next_queue_index;
    #[test]
    fn looping_a_category_advances_then_wraps_instead_of_repeating_the_first_file(){
        assert_eq!(next_queue_index(0,3,true),Some(1));
        assert_eq!(next_queue_index(1,3,true),Some(2));
        assert_eq!(next_queue_index(2,3,true),Some(0));
        assert_eq!(next_queue_index(2,3,false),None);
        assert_eq!(next_queue_index(0,1,true),Some(0));
        assert_eq!(next_queue_index(0,0,true),None);
    }
}
pub fn runtime_directory(app: &tauri::AppHandle) -> PathBuf {
    if let Some(path) = std::env::var_os("BOXPLAYER_MPV_RUNTIME") {
        return path.into();
    }
    let bundled = app
        .path()
        .resource_dir()
        .unwrap_or_default()
        .join("runtime");
    if bundled.join("libmpv.dylib").exists() {
        return bundled;
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.local/runtime/macos")
}
pub fn configure_vulkan() {
    #[cfg(target_os = "macos")]
    {
        let mut candidates = Vec::new();
        if let Some(path) = std::env::var_os("BOXPLAYER_MPV_RUNTIME") {
            candidates.push(PathBuf::from(path));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(parent) = exe.parent() {
                candidates.push(parent.join("../Resources/runtime"));
            }
        }
        candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.local/runtime/macos"));
        if let Some(icd) = candidates
            .into_iter()
            .map(|p| p.join("MoltenVK_icd.json"))
            .find(|p| p.exists())
        {
            std::env::set_var("VK_DRIVER_FILES", &icd);
            std::env::set_var("VK_ICD_FILENAMES", &icd);
        }
    }
}
pub async fn render_host(window: tauri::WebviewWindow) -> Result<usize, AppError> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        let cloned = window.clone();
        window
            .run_on_main_thread(move || {
                use objc2_app_kit::NSWindow;
                let result = cloned
                    .ns_window()
                    .ok()
                    .and_then(|ptr| unsafe { (&*(ptr as *const NSWindow)).contentView() })
                    .map(|view| (&*view as *const objc2_app_kit::NSView) as usize)
                    .ok_or_else(|| {
                        AppError::new("RENDER_HOST", "Unable to get the native video host", true)
                    });
                let _ = send.send(result);
            })
            .map_err(|_| {
                AppError::new(
                    "RENDER_HOST",
                    "Unable to initialize native video host",
                    true,
                )
            })?;
        receive
            .await
            .map_err(|_| AppError::new("RENDER_HOST", "Native window closed", true))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Err(AppError::new(
            "RENDER_PLATFORM",
            "Native embedding on this platform is pending target-platform validation",
            false,
        ))
    }
}
#[cfg(test)]
mod hls_fmp4_test;
#[cfg(test)]
#[path = "integration_tests.rs"]
mod integration_tests;

#[cfg(test)]
mod identity_tests {
    use super::*;
    fn media(source:&str,id:&str)->ResolvedMedia {ResolvedMedia{schema_version:1,source_id:source.into(),account_id:source.into(),file_id:id.into(),url:"https://example.invalid/old".into(),headers:Default::default(),expires_at:Some(1)}}
    fn item(source:&str,id:&str)->PlayItem {PlayItem{media:media(source,id),title:format!("Title {id}"),subtitles:vec![Subtitle{title:"Custom subtitle".into(),media:media(source,"sub")}]}}
    fn resolve(value:&ResolvedMedia)->Result<ResolvedMedia,AppError>{let mut next=value.clone();if next.source_id=="ali" {next.file_id=format!("mapped-{}",next.file_id);next.url="boxplayer-queue:".into();next.headers.clear();next.expires_at=None;}Ok(next)}
    #[test]
    fn remaps_active_queue_and_subtitles_without_restarting_or_losing_controls(){
        let mut queue=vec![item("ali","first"),item("other","foreign"),item("ali","last")];let mut subtitles=vec![Subtitle{title:"Loaded subtitle".into(),media:media("ali","external")}];
        let mut state=Snapshot::default();state.queue_index=2;state.session_id="session".into();state.state="paused".into();state.position=42.;state.volume=31.;state.speed=1.5;state.item_id="last".into();
        reconcile_queue(&mut queue,&mut subtitles,&mut state,resolve).unwrap();
        assert_eq!(state.item_id,"mapped-last");assert_eq!(state.source_id,"ali");assert_eq!(state.queue[0].item_id,"mapped-first");assert_eq!(state.queue[1].item_id,"foreign");assert_eq!(state.queue[2].title,"Title last");assert_eq!(state.session_id,"session");assert_eq!(state.state,"paused");assert_eq!(state.position,42.);assert_eq!(state.volume,31.);assert_eq!(state.speed,1.5);
        assert_eq!(queue[0].subtitles[0].media.file_id,"mapped-sub");assert_eq!(subtitles[0].media.file_id,"mapped-external");assert_eq!(queue[1].media.url,"https://example.invalid/old");
    }
    #[test]
    fn failed_projection_keeps_every_live_reference_unchanged(){
        let mut queue=vec![item("ali","first"),item("ali","last")];let mut subtitles=vec![];let mut state=Snapshot::default();state.item_id="first".into();
        let result=reconcile_queue(&mut queue,&mut subtitles,&mut state,|media|{if media.file_id=="last"{Err(AppError::new("TEST","Fail",false))}else{resolve(media)}});
        assert!(result.is_err());assert_eq!(queue[0].media.file_id,"first");assert_eq!(queue[0].subtitles[0].media.file_id,"sub");assert_eq!(state.item_id,"first");assert!(state.queue.is_empty());
    }
    #[test]
    fn invalid_queue_position_does_not_publish_partial_identity(){
        let mut queue=vec![item("ali","first")];let mut subtitles=vec![];let mut state=Snapshot::default();state.queue_index=4;
        assert!(reconcile_queue(&mut queue,&mut subtitles,&mut state,resolve).is_err());assert_eq!(queue[0].media.file_id,"first");assert!(state.item_id.is_empty());
    }
    #[test]
    fn coordinator_waits_for_worker_ack_and_idle_player_is_noop(){
        let player=Player::new();player.reconcile_identities().unwrap();let(send,receive)=mpsc::channel();
        let thread=std::thread::spawn(move||match receive.recv().unwrap(){Message::Reconcile(reply)=>reply.send(Ok(())).unwrap(),_=>panic!("wrong message")});
        *player.worker.lock().unwrap()=Some(Worker{sender:send,thread});player.reconcile_identities().unwrap();player.stop();
    }
}
