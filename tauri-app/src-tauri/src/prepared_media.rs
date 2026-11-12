//! One-use, short-lived handles keep provider-required playback credentials out of WebViews.
use crate::{gateway::ResolvedMedia, settings::AppError};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
const PREFIX: &str = "boxplayer-prepared:";
#[derive(Default)]
pub struct PreparedMedia(Mutex<HashMap<String, (Instant, ResolvedMedia)>>);
fn invalid() -> AppError {
    AppError::new("MEDIA_HANDLE", "播放凭据已失效，请重新打开文件", true)
}
impl PreparedMedia {
    pub fn insert(&self, media: ResolvedMedia) -> Result<ResolvedMedia, AppError> {
        let mut map = self.0.lock().map_err(|_| invalid())?;
        map.retain(|_, (time, _)| time.elapsed() < Duration::from_secs(120));
        if map.len() >= 128 {
            return Err(invalid());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let mut public = media.clone();
        public.url = format!("{}{}", PREFIX, id);
        public.headers.clear();
        map.insert(id, (Instant::now(), media));
        Ok(public)
    }
    pub fn revoke_account(&self, account_id: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.retain(|_, (_, media)| media.account_id != account_id);
        }
    }
    pub fn hydrate(&self, media: &mut ResolvedMedia) -> Result<(), AppError> {
        let Some(id) = media.url.strip_prefix(PREFIX) else {
            return Ok(());
        };
        let mut map = self.0.lock().map_err(|_| invalid())?;
        let (created, prepared) = map.get(id).ok_or_else(invalid)?;
        if created.elapsed() > Duration::from_secs(120)
            || prepared.source_id != media.source_id
            || prepared.account_id != media.account_id
            || prepared.file_id != media.file_id
        {
            return Err(invalid());
        }
        let (_, prepared) = map.remove(id).ok_or_else(invalid)?;
        *media = prepared;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::gateway::Headers;
    #[test]
    fn handles_do_not_disclose_headers_and_cannot_cross_accounts_or_replay() {
        let store = PreparedMedia::default();
        let media = ResolvedMedia {
            schema_version: 1,
            source_id: "source".into(),
            account_id: "account".into(),
            file_id: "file".into(),
            url: "https://cdn.test/file".into(),
            headers: Headers::from([("Authorization".into(), "test-only-token".into())]),
            expires_at: None,
        };
        let mut handle = store.insert(media).unwrap();
        assert!(handle.headers.is_empty());
        assert!(handle.url.starts_with(PREFIX));
        let mut wrong = handle.clone();
        wrong.account_id = "other".into();
        assert!(store.hydrate(&mut wrong).is_err());
        let mut replay = handle.clone();
        store.hydrate(&mut handle).unwrap();
        assert_eq!(handle.headers["Authorization"], "test-only-token");
        assert!(store.hydrate(&mut replay).is_err());
    }
}
