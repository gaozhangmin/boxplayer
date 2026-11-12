use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenRequest {
    pub kind: &'static str,
    pub value: String,
}

#[derive(Default)]
pub struct OpenInbox {
    pub pending: Vec<OpenRequest>,
    recent: Vec<(String, Instant)>,
}
impl OpenInbox {
    pub fn push(
        &mut self,
        values: impl IntoIterator<Item = String>,
        now: Instant,
    ) -> Vec<OpenRequest> {
        self.recent
            .retain(|(_, time)| now.saturating_duration_since(*time) < Duration::from_secs(2));
        let mut incoming = Vec::new();
        for value in values {
            // macOS delivers URLs via both RunEvent::Opened and the deep-link plugin.
            if self.recent.iter().any(|(seen, _)| seen == &value) {
                continue;
            }
            let kind = if value.starts_with("boxplayer-migration-dev://") {
                Some("deepLink")
            } else if !value.contains("://")
                && !value.starts_with('-')
                && std::path::Path::new(&value).is_file()
            {
                Some("file")
            } else {
                None
            };
            if let Some(kind) = kind {
                self.recent.push((value.clone(), now));
                incoming.push(OpenRequest { kind, value });
            }
        }
        self.pending.extend(incoming.iter().cloned());
        if self.pending.len() > 20 {
            self.pending.drain(..self.pending.len() - 20);
        }
        if self.recent.len() > 20 {
            self.recent.drain(..self.recent.len() - 20);
        }
        incoming
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deduplicates_double_os_delivery_but_allows_a_later_user_request() {
        let mut inbox = OpenInbox::default();
        let now = Instant::now();
        let url = "boxplayer-migration-dev://test".to_string();
        assert_eq!(inbox.push([url.clone()], now).len(), 1);
        assert!(inbox
            .push([url.clone()], now + Duration::from_millis(20))
            .is_empty());
        assert_eq!(inbox.push([url], now + Duration::from_secs(3)).len(), 1);
    }
    #[test]
    fn rejects_production_protocols_and_bounds_pending_requests() {
        let mut inbox = OpenInbox::default();
        let now = Instant::now();
        assert!(inbox
            .push(
                ["boxplayer-auth://secret".into(), "--autostart".into()],
                now
            )
            .is_empty());
        inbox.push(
            (0..30).map(|i| format!("boxplayer-migration-dev://test/{i}")),
            now,
        );
        assert_eq!(inbox.pending.len(), 20);
        assert_eq!(inbox.pending[0].value, "boxplayer-migration-dev://test/10");
    }
}
