use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub schema_version: u32,
    pub revision: u64,
    pub theme: Theme,
    pub language: Language,
    pub sidebar_collapsed: bool,
    pub close_to_tray: bool,
    pub launch_at_login: bool,
    pub start_hidden: bool,
    #[serde(default)]
    pub auto_sign: bool,
    #[serde(default)]
    pub library_scan_minutes: u32,
    #[serde(default)]
    pub server_playback: ServerPlaybackSettings,
    #[serde(default)]
    pub proxy: crate::network_proxy::ProxySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerPlaybackSettings {
    pub quality: String,
    pub compatibility: String,
    pub custom_profile: serde_json::Value,
}
impl Default for ServerPlaybackSettings {
    fn default() -> Self {
        Self {
            quality: "max".into(),
            compatibility: "auto".into(),
            custom_profile: serde_json::json!({"Action":"add","DirectPlayProfiles":[],"TranscodingProfiles":[]}),
        }
    }
}
impl ServerPlaybackSettings {
    pub fn validate(&self) -> Result<(), AppError> {
        let invalid = || AppError::new("PLAYBACK_PROFILE", "媒体服务器设备配置无效", false);
        if ![
            "auto",
            "max",
            "120000000",
            "80000000",
            "60000000",
            "40000000",
            "20000000",
            "15000000",
            "10000000",
            "8000000",
            "6000000",
            "4000000",
            "3000000",
            "1500000",
            "720000",
            "420000",
        ]
        .contains(&self.quality.as_str())
            || !["auto", "mostCompatible", "directPlay", "custom"]
                .contains(&self.compatibility.as_str())
        {
            return Err(invalid());
        }
        if serde_json::to_vec(&self.custom_profile)
            .map_err(|_| invalid())?
            .len()
            > 65536
        {
            return Err(invalid());
        }
        let object = self.custom_profile.as_object().ok_or_else(invalid)?;
        for (key, value) in object {
            match key.as_str() {
                "Action" => {
                    if !matches!(value.as_str(), Some("add" | "replace")) {
                        return Err(invalid());
                    }
                }
                "MaxStreamingBitrate" | "MaxStaticBitrate" | "MusicStreamingTranscodingBitrate" => {
                    if value.as_u64().is_none_or(|v| v == 0 || v > 360000000) {
                        return Err(invalid());
                    }
                }
                "DirectPlayProfiles" | "TranscodingProfiles" => {
                    let rows = value.as_array().ok_or_else(invalid)?;
                    if rows.len() > 64 {
                        return Err(invalid());
                    }
                    for row in rows {
                        let item = row.as_object().ok_or_else(invalid)?;
                        if item.get("Type").and_then(|v| v.as_str()) != Some("Video") {
                            return Err(invalid());
                        }
                        for (field, value) in item {
                            match field.as_str() {
                                "Type" => {}
                                "Container" | "VideoCodec" | "AudioCodec" | "Protocol"
                                | "Context" | "MaxAudioChannels" | "MinSegments" => {
                                    if value.as_str().is_none_or(|v| v.len() > 512) {
                                        return Err(invalid());
                                    }
                                }
                                "BreakOnNonKeyFrames" => {
                                    if !value.is_boolean() {
                                        return Err(invalid());
                                    }
                                }
                                _ => return Err(invalid()),
                            }
                        }
                    }
                }
                _ => return Err(invalid()),
            }
        }
        if !object.contains_key("DirectPlayProfiles") || !object.contains_key("TranscodingProfiles")
        {
            return Err(invalid());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    System,
    Light,
    Dark,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum Language {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en")]
    En,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            theme: Theme::System,
            language: Language::ZhCn,
            sidebar_collapsed: false,
            close_to_tray: true,
            launch_at_login: false,
            start_hidden: false,
            auto_sign: false,
            library_scan_minutes: 0,
            server_playback: ServerPlaybackSettings::default(),
            proxy: Default::default(),
        }
    }
}
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingsPatch {
    pub theme: Option<Theme>,
    pub language: Option<Language>,
    pub sidebar_collapsed: Option<bool>,
    pub close_to_tray: Option<bool>,
    pub launch_at_login: Option<bool>,
    pub start_hidden: Option<bool>,
    pub auto_sign: Option<bool>,
    pub library_scan_minutes: Option<u32>,
    pub server_playback: Option<ServerPlaybackSettings>,
    pub proxy: Option<crate::network_proxy::ProxySettings>,
}
#[derive(Debug, Clone, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}
impl AppError {
    pub fn new(code: &'static str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }
    pub fn io(_: std::io::Error) -> Self {
        Self::new(
            "STORAGE_IO",
            "Unable to read or write the development settings directory",
            true,
        )
    }
}
pub struct SettingsStore {
    pub current: Settings,
    path: PathBuf,
}
impl SettingsStore {
    pub fn open(directory: &Path) -> Result<Self, AppError> {
        fs::create_dir_all(directory).map_err(AppError::io)?;
        let path = directory.join("settings.json");
        let current = match fs::read(&path) {
            Ok(bytes) => {
                let settings: Settings = serde_json::from_slice(&bytes).map_err(|_| {
                    AppError::new(
                        "SETTINGS_INVALID",
                        "Settings are corrupt or incompatible; the file has been preserved",
                        false,
                    )
                })?;
                if settings.schema_version != 1 {
                    return Err(AppError::new(
                        "SCHEMA_UNSUPPORTED",
                        "Unsupported settings schema; the file has been preserved",
                        false,
                    ));
                }
                settings.server_playback.validate()?;
                settings.proxy.validate()?;
                settings
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Settings::default(),
            Err(e) => return Err(AppError::io(e)),
        };
        Ok(Self { current, path })
    }
    pub fn prepare(
        &self,
        expected_revision: u64,
        patch: SettingsPatch,
    ) -> Result<Settings, AppError> {
        if expected_revision != self.current.revision {
            return Err(AppError::new(
                "REVISION_CONFLICT",
                "Settings changed in another window; reload and try again",
                true,
            ));
        }
        let mut next = self.current.clone();
        if let Some(v) = patch.theme {
            next.theme = v;
        }
        if let Some(v) = patch.language {
            next.language = v;
        }
        if let Some(v) = patch.sidebar_collapsed {
            next.sidebar_collapsed = v;
        }
        if let Some(v) = patch.close_to_tray {
            next.close_to_tray = v;
        }
        if let Some(v) = patch.launch_at_login {
            next.launch_at_login = v;
        }
        if let Some(v) = patch.start_hidden {
            next.start_hidden = v;
        }
        if let Some(v) = patch.auto_sign {
            next.auto_sign = v;
        }
        if let Some(value)=patch.library_scan_minutes {
            if value!=0 && !(15..=10080).contains(&value) {return Err(AppError::new("SCAN_INTERVAL","扫描间隔须为15分钟至7天，或关闭",false));}
            next.library_scan_minutes=value;
        }
        if let Some(value) = patch.server_playback {
            value.validate()?;
            next.server_playback = value;
        }
        if let Some(proxy)=patch.proxy{proxy.validate()?;next.proxy=proxy;}
        next.revision = next.revision.checked_add(1).ok_or_else(|| {
            AppError::new("REVISION_OVERFLOW", "Settings revision overflow", false)
        })?;
        Ok(next)
    }
    pub fn commit(&mut self, next: Settings) -> Result<Settings, AppError> {
        let directory = self.path.parent().expect("settings path has a parent");
        let mut temp = tempfile::NamedTempFile::new_in(directory).map_err(AppError::io)?;
        let bytes = serde_json::to_vec_pretty(&next)
            .map_err(|_| AppError::new("SERIALIZATION", "Unable to encode settings", false))?;
        temp.write_all(&bytes).map_err(AppError::io)?;
        temp.as_file().sync_all().map_err(AppError::io)?;
        temp.persist(&self.path)
            .map_err(|e| AppError::io(e.error))?;
        self.current = next;
        Ok(self.current.clone())
    }
}

pub fn resolve_data_dir(
    default: &Path,
    override_dir: Option<PathBuf>,
) -> Result<PathBuf, AppError> {
    let selected = if let Some(path) = override_dir {
        path
    } else {
        let config = default.join("userdir.config");
        match fs::read_to_string(&config) {
            Ok(value) => PathBuf::from(value.trim()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => default.to_path_buf(),
            Err(e) => return Err(AppError::io(e)),
        }
    };
    if !selected.is_absolute() {
        return Err(AppError::new(
            "DATA_DIR_INVALID",
            "Development data directory must be absolute",
            false,
        ));
    }
    fs::create_dir_all(&selected).map_err(AppError::io)?;
    selected.canonicalize().map_err(AppError::io)
}

#[cfg(test)]
mod tests {
    #[test]
    fn proxy_policy_roundtrip_old_settings_default_and_invalid_patch(){
        let temp=tempfile::tempdir().unwrap();let mut store=SettingsStore::open(temp.path()).unwrap();
        assert_eq!(store.current.proxy.mode,"system");
        let next=store.prepare(0,SettingsPatch{proxy:Some(crate::network_proxy::ProxySettings{mode:"custom".into(),url:"http://127.0.0.1:7890".into()}),..Default::default()}).unwrap();store.commit(next).unwrap();assert_eq!(SettingsStore::open(temp.path()).unwrap().current.proxy.mode,"custom");
        assert!(store.prepare(1,SettingsPatch{proxy:Some(crate::network_proxy::ProxySettings{mode:"custom".into(),url:"http://user:secret@localhost:7890".into()}),..Default::default()}).is_err());
        let mut old=serde_json::to_value(Settings::default()).unwrap();old.as_object_mut().unwrap().remove("proxy");std::fs::write(temp.path().join("settings.json"),serde_json::to_vec(&old).unwrap()).unwrap();assert_eq!(SettingsStore::open(temp.path()).unwrap().current.proxy.mode,"system");
    }

    use super::*;
    #[test]
    fn persists_after_reopen_and_rejects_stale_writers() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = SettingsStore::open(dir.path()).unwrap();
        let next = store
            .prepare(
                0,
                SettingsPatch {
                    theme: Some(Theme::Dark),
                    language: Some(Language::En),
                    ..Default::default()
                },
            )
            .unwrap();
        store.commit(next).unwrap();
        let reopened = SettingsStore::open(dir.path()).unwrap();
        assert_eq!(reopened.current.theme, Theme::Dark);
        assert_eq!(reopened.current.language, Language::En);
        assert_eq!(reopened.current.revision, 1);
        assert_eq!(
            reopened
                .prepare(0, SettingsPatch::default())
                .unwrap_err()
                .code,
            "REVISION_CONFLICT"
        );
    }
    #[test]
    fn failed_save_does_not_change_memory() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = SettingsStore::open(dir.path()).unwrap();
        fs::create_dir(dir.path().join("settings.json")).unwrap();
        let next = store
            .prepare(
                0,
                SettingsPatch {
                    theme: Some(Theme::Dark),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(store.commit(next).is_err());
        assert_eq!(store.current, Settings::default());
    }
    #[test]
    fn corrupt_and_future_schema_are_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("settings.json");
        fs::write(&file, "broken").unwrap();
        assert!(SettingsStore::open(dir.path()).is_err());
        assert_eq!(fs::read_to_string(&file).unwrap(), "broken");
        let future = Settings {
            schema_version: 2,
            ..Settings::default()
        };
        fs::write(&file, serde_json::to_vec(&future).unwrap()).unwrap();
        assert_eq!(
            SettingsStore::open(dir.path()).err().unwrap().code,
            "SCHEMA_UNSUPPORTED"
        );
    }
    #[test]
    fn custom_directory_resolved_before_storage() {
        let dir = tempfile::tempdir().unwrap();
        let custom = dir.path().join("custom");
        fs::write(
            dir.path().join("userdir.config"),
            custom.to_string_lossy().as_bytes(),
        )
        .unwrap();
        assert_eq!(
            resolve_data_dir(dir.path(), None).unwrap(),
            custom.canonicalize().unwrap()
        );
        assert!(resolve_data_dir(dir.path(), Some(PathBuf::from("relative"))).is_err());
    }
}

#[cfg(test)]
mod playback_settings_tests {
    use super::*;
    #[test]
    fn old_settings_default_and_custom_profiles_persist_without_bypassing_revision_checks() {
        let directory = tempfile::tempdir().unwrap();
        let mut legacy = serde_json::to_value(Settings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("serverPlayback");
        std::fs::write(
            directory.path().join("settings.json"),
            serde_json::to_vec(&legacy).unwrap(),
        )
        .unwrap();
        let mut store = SettingsStore::open(directory.path()).unwrap();
        assert_eq!(
            store.current.server_playback,
            ServerPlaybackSettings::default()
        );
        let playback = ServerPlaybackSettings {
            quality: "20000000".into(),
            compatibility: "custom".into(),
            custom_profile: serde_json::json!({"Action":"replace","DirectPlayProfiles":[{"Type":"Video","Container":"mp4","VideoCodec":"h264","AudioCodec":"aac"}],"TranscodingProfiles":[]}),
        };
        let next = store
            .prepare(
                0,
                SettingsPatch {
                    server_playback: Some(playback.clone()),
                    ..Default::default()
                },
            )
            .unwrap();
        store.commit(next).unwrap();
        assert_eq!(
            SettingsStore::open(directory.path())
                .unwrap()
                .current
                .server_playback,
            playback
        );
        assert_eq!(
            store.prepare(0, SettingsPatch::default()).unwrap_err().code,
            "REVISION_CONFLICT"
        );
    }
    #[test]
    fn invalid_profiles_do_not_change_memory_or_disk() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::open(directory.path()).unwrap();
        for profile in [
            serde_json::json!({"DirectPlayProfiles":[],"TranscodingProfiles":[],"ApiKey":"not-allowed"}),
            serde_json::json!({"DirectPlayProfiles":[{"Type":"Video","MaxAudioChannels":8}],"TranscodingProfiles":[]}),
            serde_json::json!({"DirectPlayProfiles":[],"TranscodingProfiles":[],"MaxStreamingBitrate":0}),
        ] {
            assert!(store
                .prepare(
                    0,
                    SettingsPatch {
                        server_playback: Some(ServerPlaybackSettings {
                            custom_profile: profile,
                            ..Default::default()
                        }),
                        ..Default::default()
                    }
                )
                .is_err());
        }
        assert_eq!(store.current.revision, 0);
        assert!(!directory.path().join("settings.json").exists());
    }
}
