//! Opt-in debug playback probes. No URLs, headers, account IDs or arbitrary properties.
use super::{ffi::Mpv, Snapshot};
use serde::Deserialize;
use std::{
    collections::HashSet,
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
    time::{Duration, Instant},
};
#[derive(Deserialize)]
struct Config {
    output: PathBuf,
    titles: HashSet<String>,
}
pub(super) struct Audit {
    config: Option<Config>,
    last: Instant,
}
impl Audit {
    pub fn new() -> Self {
        let config = std::fs::read(std::env::temp_dir().join("boxplayer-playback-audit.json"))
            .ok()
            .and_then(|v| serde_json::from_slice::<Config>(&v).ok())
            .filter(|v| v.output.is_absolute());
        Self {
            config,
            last: Instant::now() - Duration::from_secs(2),
        }
    }
    pub fn tick(&mut self, mpv: &Mpv, state: &Snapshot, _app: &tauri::AppHandle) {
        let Some(config) = &self.config else { return };
        if self.last.elapsed() < Duration::from_secs(1) || !config.titles.contains(&state.title) {
            return;
        }
        self.last = Instant::now();
        #[cfg(target_os = "macos")]
        super::audit_macos::capture(
            _app,
            config.output.with_extension("surface.jsonl"),
            state.title.clone(),
            state.session_id.clone(),
        );
        let mut properties = serde_json::Map::new();
        for name in [
            "video-params",
            "video-out-params",
            "video-target-params",
            "hwdec-current",
            "current-vo",
            "current-gpu-context",
            "video-codec",
            "video-format",
            "container-fps",
            "estimated-vf-fps",
            "estimated-frame-number",
            "frame-drop-count",
            "decoder-frame-drop-count",
            "mistimed-frame-count",
            "vo-delayed-frame-count",
            "avsync",
            "video-pts",
            "audio-pts",
            "display-fps",
            "target-colorspace-hint",
            "target-prim",
            "target-trc",
            "tone-mapping",
            "cocoa-cb-output-csp",
        ] {
            properties.insert(
                name.into(),
                mpv.json(name).unwrap_or(serde_json::Value::Null),
            );
        }
        let row = serde_json::json!({"unixMs":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(), "title":state.title,"state":state.state,"position":state.position,"duration":state.duration,"width":state.video_width,"height":state.video_height,"error":state.error,"engine":state.engine_version,"properties":properties});
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&config.output)
        {
            let _ = writeln!(file, "{}", row);
        }
    }
}
