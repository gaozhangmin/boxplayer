//! Native-only Trakt credentials. See features/trakt/INTEGRATION.md before binding.
use crate::{
    accounts::Vault,
    gateway::{Gateway, Headers, HttpRequest},
    settings::AppError,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::Mutex;
const PUBLIC_API: &str = "https://api.xbyvideohub.com";
const SLOT: &str = "trakt-account-v1";
fn err(code: &'static str) -> AppError {
    AppError::new(
        code,
        match code {
            "TRAKT_LOGIN" => "Trakt 登录已失效，请重新连接",
            "TRAKT_SECURE_STORAGE" => "无法安全读取或保存 Trakt 凭据",
            "TRAKT_EXPIRED" => "授权码已失效",
            "TRAKT_DENIED" => "授权被拒绝",
            "TRAKT_CONFIG" => "Trakt 服务尚未配置",
            "TRAKT_RATE_LIMIT" => "Trakt 请求过于频繁，请稍后重试",
            "TRAKT_CANCELLED" => "授权已取消",
            "TRAKT_METADATA" => "缺少准确的媒体标识",
            "TRAKT_RATING" => "个人评分必须是 1–10 的整数",
            "TRAKT_FORBIDDEN" => "Trakt 拒绝访问",
            _ => "Trakt 请求失败，请稍后重试",
        },
        true,
    )
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn failure(status: u16) -> AppError {
    err(match status {
        401 => "TRAKT_LOGIN",
        403 => "TRAKT_FORBIDDEN",
        420 => "TRAKT_LIMIT",
        429 => "TRAKT_RATE_LIMIT",
        _ => "TRAKT_REQUEST",
    })
}
#[derive(Clone, Serialize, Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: String,
    created_at: u64,
    expires_in: u64,
}
impl Tokens {
    fn validate(self) -> Result<Self, AppError> {
        if self.access_token.is_empty()
            || self.refresh_token.is_empty()
            || self.access_token.len() > 32768
            || self.refresh_token.len() > 32768
            || self.expires_in == 0
        {
            Err(err("TRAKT_RESPONSE"))
        } else {
            Ok(self)
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub enabled: bool,
    pub range: i32,
}
impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            range: -1,
        }
    }
}
#[derive(Default, Clone, Serialize, Deserialize)]
struct Stored {
    tokens: Option<Tokens>,
    #[serde(default)]
    settings: SyncSettings,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub configured: bool,
    pub connected: bool,
    pub settings: SyncSettings,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogin {
    pub user_code: String,
    pub verification_url: String,
    pub expires_at: u64,
    pub interval: u64,
}
struct Device {
    public: DeviceLogin,
    code: String,
    next: u64,
    generation: u64,
}
#[derive(Default)]
struct Inner {
    loaded: bool,
    stored: Stored,
    device: Option<Device>,
    web: Option<WebSession>,
}
pub struct Trakt {
    #[cfg(test)]
    requests: std::sync::Mutex<Vec<HttpRequest>>,
    #[cfg(test)]
    responses: std::sync::Mutex<std::collections::VecDeque<(u16, Value, Headers)>>,
    marker: PathBuf,
    #[cfg_attr(test, allow(dead_code))]
    gateway: Arc<Gateway>,
    vault: Box<dyn Vault>,
    client_id: String,
    generation: AtomicU64,
    inner: Mutex<Inner>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub username: String,
    pub name: String,
    pub avatar: Option<String>,
    pub vip: bool,
    pub episodes: u64,
    pub shows: u64,
    pub movies: u64,
}
#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub r#type: String,
    pub tmdb_id: Option<u64>,
    pub imdb_id: Option<String>,
}
#[derive(Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum Poll {
    Pending { interval: u64 },
    Connected { status: Status },
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackProgress {
    pub r#type: String,
    pub tmdb_id: u64,
    pub season: Option<u64>,
    pub episode: Option<u64>,
    pub progress: f64,
    pub paused_at: String,
}
fn verification_url(value: &str) -> Result<String, AppError> {
    let u = url::Url::parse(value).map_err(|_| err("TRAKT_RESPONSE"))?;
    if u.scheme() != "https"
        || !matches!(u.host_str(), Some("trakt.tv" | "auth.trakt.tv"))
        || u.port().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err(err("TRAKT_RESPONSE"));
    }
    Ok(u.into())
}
fn payload(id: &Identity, rating: Option<u8>) -> Result<Value, AppError> {
    let key = match id.r#type.as_str() {
        "movie" => "movies",
        "tv" => "shows",
        "episode" => "episodes",
        _ => return Err(err("TRAKT_METADATA")),
    };
    let mut ids = json!({});
    if let Some(v) = id.tmdb_id.filter(|v| *v > 0 && *v <= 9_007_199_254_740_991) {
        ids["tmdb"] = json!(v)
    }
    if let Some(v) = id.imdb_id.as_ref().filter(|v| {
        v.starts_with("tt")
            && v.len() > 2
            && v.len() < 40
            && v[2..].bytes().all(|c| c.is_ascii_digit())
    }) {
        ids["imdb"] = json!(v)
    }
    if ids.as_object().unwrap().is_empty() {
        return Err(err("TRAKT_METADATA"));
    }
    let mut item = json!({"ids":ids});
    if let Some(v) = rating {
        if !(1..=10).contains(&v) {
            return Err(err("TRAKT_RATING"));
        }
        item["rating"] = json!(v)
    }
    Ok(json!({key:[item]}))
}
impl Trakt {
    pub fn new(
        directory: &Path,
        gateway: Arc<Gateway>,
        client_id: String,
    ) -> Result<Self, AppError> {
        Ok(Self::with_vault(
            directory.join("trakt-vault-present"),
            gateway,
            client_id,
            Box::new(crate::vault::SystemVault::new(directory)?),
        ))
    }
    fn with_vault(
        marker: PathBuf,
        gateway: Arc<Gateway>,
        client_id: String,
        vault: Box<dyn Vault>,
    ) -> Self {
        Self {
            #[cfg(test)]
            responses: Default::default(),
            #[cfg(test)]
            requests: Default::default(),
            marker,
            gateway,
            vault,
            client_id,
            generation: AtomicU64::new(0),
            inner: Mutex::new(Inner::default()),
        }
    }
    fn configured(&self) -> Result<(), AppError> {
        if self.client_id.trim().is_empty() {
            Err(err("TRAKT_CONFIG"))
        } else {
            Ok(())
        }
    }
    fn load(&self, s: &mut Inner) -> Result<(), AppError> {
        if !s.loaded {
            match std::fs::metadata(&self.marker) {
                Ok(_) => {
                    s.stored = serde_json::from_str(
                        &self
                            .vault
                            .get(SLOT)
                            .map_err(|_| err("TRAKT_SECURE_STORAGE"))?,
                    )
                    .map_err(|_| err("TRAKT_SECURE_STORAGE"))?;
                    if let Some(t) = s.stored.tokens.take() {
                        s.stored.tokens = Some(t.validate()?)
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(_) => return Err(err("TRAKT_SECURE_STORAGE")),
            };
            s.loaded = true;
        }
        Ok(())
    }
    fn save(&self, value: &Stored) -> Result<(), AppError> {
        self.vault
            .put(
                SLOT,
                &serde_json::to_string(value).map_err(|_| err("TRAKT_SECURE_STORAGE"))?,
            )
            .map_err(|_| err("TRAKT_SECURE_STORAGE"))?;
        // Marker contains no credentials; vault errors are never treated as logout.
        std::fs::write(&self.marker, b"1").map_err(|_| err("TRAKT_SECURE_STORAGE"))
    }
    fn snapshot(&self, s: &Inner) -> Status {
        Status {
            configured: !self.client_id.is_empty(),
            connected: s.stored.tokens.is_some(),
            settings: s.stored.settings.clone(),
        }
    }
    pub async fn status(&self) -> Result<Status, AppError> {
        let mut s = self.inner.lock().await;
        self.load(&mut s)?;
        Ok(self.snapshot(&s))
    }
    async fn send(
        &self,
        path: &str,
        body: Option<Value>,
        token: Option<&str>,
    ) -> Result<(u16, Value, Headers), AppError> {
        self.configured()?;
        let mut headers = Headers::from([
            ("content-type".into(), "application/json".into()),
            ("trakt-api-key".into(), self.client_id.clone()),
            ("trakt-api-version".into(), "2".into()),
        ]);
        if let Some(t) = token {
            headers.insert("authorization".into(), format!("Bearer {t}"));
        }
        let expected = format!("{PUBLIC_API}/api/trakt{path}");
        let response = self
            .transport(HttpRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                provider_id: "trakt".into(),
                account_id: SLOT.into(),
                method: if body.is_some() { "POST" } else { "GET" }.into(),
                url: expected.clone(),
                headers,
                body: body.map(|v| v.to_string().into_bytes()),
                timeout_ms: Some(20000),
                proxy: None,
            })
            .await
            .map_err(|_| err("TRAKT_NETWORK"))?;
        if response.final_url != expected {
            return Err(err("TRAKT_RESPONSE"));
        }
        let data = if response.status == 204 {
            Value::Null
        } else {
            serde_json::from_slice(&response.body)
                .or_else(|_| {
                    if response.status >= 400 {
                        Ok(json!({}))
                    } else {
                        Err(())
                    }
                })
                .map_err(|_| err("TRAKT_RESPONSE"))?
        };
        if response.status == 200 && path == "/users/me/stats" && data.is_null() {
            return Err(err("TRAKT_STATS"));
        }
        Ok((response.status, data, response.headers))
    }
    #[cfg(not(test))]
    async fn transport(
        &self,
        request: HttpRequest,
    ) -> Result<crate::gateway::HttpResponse, AppError> {
        self.gateway.request(request).await
    }
    #[cfg(test)]
    async fn transport(
        &self,
        request: HttpRequest,
    ) -> Result<crate::gateway::HttpResponse, AppError> {
        self.requests.lock().unwrap().push(request.clone());
        let (status, data, headers) = self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .ok_or_else(|| err("TRAKT_TEST_NO_RESPONSE"))?;
        Ok(crate::gateway::HttpResponse {
            status,
            headers,
            body: if status == 204 {
                vec![]
            } else {
                data.to_string().into_bytes()
            },
            final_url: request.url,
        })
    }
    pub fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        // In-flight exchanges hold the mutex and observe the generation before committing.
        if let Ok(mut s) = self.inner.try_lock() {
            s.device = None;
            s.web = None;
        }
    }
    pub async fn connect_device_auth(&self) -> Result<DeviceLogin, AppError> {
        self.configured()?;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let mut s = self.inner.lock().await;
        self.load(&mut s)?;
        s.device = None;
        s.web = None;
        let (code, data, _) = self
            .send(
                "/oauth/device/code",
                Some(json!({"client_id":self.client_id})),
                None,
            )
            .await?;
        if generation != self.generation.load(Ordering::SeqCst) {
            return Err(err("TRAKT_CANCELLED"));
        }
        if !(200..300).contains(&code) {
            return Err(failure(code));
        }
        let seconds = data["expires_in"]
            .as_u64()
            .filter(|v| *v > 0 && *v <= 86400)
            .ok_or_else(|| err("TRAKT_RESPONSE"))?;
        let interval = data["interval"]
            .as_u64()
            .filter(|v| *v > 0 && *v <= 3600)
            .ok_or_else(|| err("TRAKT_RESPONSE"))?;
        let user_code = data["user_code"]
            .as_str()
            .filter(|v| !v.is_empty() && v.len() <= 128)
            .ok_or_else(|| err("TRAKT_RESPONSE"))?
            .to_string();
        let code = data["device_code"]
            .as_str()
            .filter(|v| !v.is_empty() && v.len() <= 32768)
            .ok_or_else(|| err("TRAKT_RESPONSE"))?
            .to_string();
        let public = DeviceLogin {
            user_code,
            verification_url: verification_url(data["verification_url"].as_str().unwrap_or(""))?,
            expires_at: (now() + seconds) * 1000,
            interval,
        };
        s.device = Some(Device {
            public: public.clone(),
            code,
            next: now() + interval,
            generation,
        });
        Ok(public)
    }
    pub async fn poll(&self) -> Result<Poll, AppError> {
        let mut s = self.inner.lock().await;
        if let Some(web) = s.web.as_ref() {
            if web.generation != self.generation.load(Ordering::SeqCst) {
                s.web = None;
                return Err(err("TRAKT_CANCELLED"));
            }
            if web.completed {
                let status = self.snapshot(&s);
                s.web = None;
                return Ok(Poll::Connected { status });
            }
            if web.expires_at <= now() {
                s.web = None;
                return Err(err("TRAKT_EXPIRED"));
            }
            if let Some(code) = web.error {
                return Err(err(code));
            }
            return Ok(Poll::Pending { interval: 1 });
        }
        let d = s.device.as_mut().ok_or_else(|| err("TRAKT_CANCELLED"))?;
        if d.generation != self.generation.load(Ordering::SeqCst) {
            s.device = None;
            return Err(err("TRAKT_CANCELLED"));
        }
        if now() * 1000 >= d.public.expires_at {
            s.device = None;
            return Err(err("TRAKT_EXPIRED"));
        }
        if now() < d.next {
            return Ok(Poll::Pending {
                interval: d.public.interval,
            });
        }
        let generation = d.generation;
        d.next = now() + d.public.interval;
        let (code, data, headers) = self
            .send(
                "/oauth/device/token",
                Some(json!({"client_id":self.client_id,"code":d.code})),
                None,
            )
            .await?;
        if generation != self.generation.load(Ordering::SeqCst) {
            s.device = None;
            return Err(err("TRAKT_CANCELLED"));
        }
        if code == 400 {
            return Ok(Poll::Pending {
                interval: d.public.interval,
            });
        }
        if code == 429 {
            d.public.interval = (d.public.interval + 5)
                .max(
                    headers
                        .iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case("retry-after"))
                        .and_then(|(_, v)| v.parse().ok())
                        .unwrap_or(0),
                )
                .min(3600);
            d.next = now() + d.public.interval;
            return Ok(Poll::Pending {
                interval: d.public.interval,
            });
        }
        if !(200..300).contains(&code) {
            s.device = None;
            return Err(err(match code {
                418 => "TRAKT_DENIED",
                404 | 409 | 410 => "TRAKT_EXPIRED",
                _ => "TRAKT_REQUEST",
            }));
        }
        let tokens: Tokens = serde_json::from_value(data).map_err(|_| err("TRAKT_RESPONSE"))?;
        let mut next = s.stored.clone();
        next.tokens = Some(tokens.validate()?);
        self.save(&next)?;
        if generation != self.generation.load(Ordering::SeqCst) {
            self.save(&s.stored)?;
            s.device = None;
            return Err(err("TRAKT_CANCELLED"));
        }
        s.stored = next;
        s.device = None;
        Ok(Poll::Connected {
            status: self.snapshot(&s),
        })
    }
    async fn refresh(&self, s: &mut Inner) -> Result<(), AppError> {
        let old = s.stored.tokens.as_ref().ok_or_else(|| err("TRAKT_LOGIN"))?;
        let(code,data,_)=self.send("/oauth/token",Some(json!({"client_id":self.client_id,"refresh_token":old.refresh_token,"grant_type":"refresh_token"})),None).await?;
        if code == 400 || code == 401 {
            s.stored.tokens = None;
            self.save(&s.stored)?;
            return Err(err("TRAKT_LOGIN"));
        }
        if !(200..300).contains(&code) {
            return Err(failure(code));
        }
        let t: Tokens = serde_json::from_value(data).map_err(|_| err("TRAKT_RESPONSE"))?;
        let mut next = s.stored.clone();
        next.tokens = Some(t.validate()?);
        self.save(&next)?;
        s.stored = next;
        Ok(())
    }
    async fn authenticated(
        &self,
        s: &mut Inner,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, AppError> {
        self.load(s)?;
        let generation = self.generation.load(Ordering::SeqCst);
        let t = s.stored.tokens.as_ref().ok_or_else(|| err("TRAKT_LOGIN"))?;
        if t.created_at.saturating_add(t.expires_in) <= now() + 60 {
            self.refresh(s).await?
        }
        let (mut code, mut data, _) = self
            .send(
                path,
                body.clone(),
                s.stored.tokens.as_ref().map(|t| t.access_token.as_str()),
            )
            .await?;
        if code == 401 {
            self.refresh(s).await?;
            let r = self
                .send(
                    path,
                    body,
                    s.stored.tokens.as_ref().map(|t| t.access_token.as_str()),
                )
                .await?;
            code = r.0;
            data = r.1;
        }
        if generation != self.generation.load(Ordering::SeqCst) {
            return Err(err("TRAKT_CANCELLED"));
        }
        if code == 401 {
            s.stored.tokens = None;
            self.save(&s.stored)?
        }
        if !(200..300).contains(&code) {
            return Err(failure(code));
        }
        Ok(data)
    }
    pub async fn account(&self) -> Result<Account, AppError> {
        let mut s = self.inner.lock().await;
        let settings = self.authenticated(&mut s, "/users/settings", None).await?;
        let profile = self
            .authenticated(&mut s, "/users/me?extended=full", None)
            .await?;
        let stats = self.authenticated(&mut s, "/users/me/stats", None).await?;
        let username = settings["user"]["username"]
            .as_str()
            .filter(|v| !v.is_empty())
            .ok_or_else(|| err("TRAKT_RESPONSE"))?
            .to_string();
        let count = |key: &str| {
            if stats.is_null() {
                Ok(0)
            } else {
                stats[key]["watched"]
                    .as_u64()
                    .ok_or_else(|| err("TRAKT_STATS"))
            }
        };
        let avatar = match profile["images"]["avatar"]["full"]
            .as_str()
            .and_then(|v| avatar_url(v).ok())
        {
            Some(url) => self.avatar(&url).await.ok(),
            None => None,
        };
        Ok(Account {
            name: profile["name"]
                .as_str()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or(&username)
                .into(),
            username,
            avatar,
            vip: profile["vip"].as_bool().unwrap_or(false),
            episodes: count("episodes")?,
            shows: count("shows")?,
            movies: count("movies")?,
        })
    }
    pub async fn settings(&self, settings: SyncSettings) -> Result<Status, AppError> {
        if ![-1, 7, 30, 180, 365].contains(&settings.range) {
            return Err(err("TRAKT_RANGE"));
        }
        let mut s = self.inner.lock().await;
        self.load(&mut s)?;
        let old = s.stored.settings.clone();
        s.stored.settings = settings;
        if let Err(e) = self.save(&s.stored) {
            s.stored.settings = old;
            return Err(e);
        }
        Ok(self.snapshot(&s))
    }
    pub async fn sync(
        &self,
        id: Identity,
        action: &str,
        rating: Option<u8>,
    ) -> Result<(), AppError> {
        let path = match action {
            "watchlist-add" => "/sync/watchlist",
            "watchlist-remove" => "/sync/watchlist/remove",
            "rating" => "/sync/ratings",
            "rating-remove" => "/sync/ratings/remove",
            _ => return Err(err("TRAKT_REQUEST")),
        };
        if action == "rating" && rating.is_none() {
            return Err(err("TRAKT_RATING"));
        }
        let body = payload(&id, if action == "rating" { rating } else { None })?;
        let mut s = self.inner.lock().await;
        self.load(&mut s)?;
        if !s.stored.settings.enabled {
            return Ok(());
        }
        let result = self.authenticated(&mut s, path, Some(body)).await?;
        if !result["not_found"].is_object() {
            return Err(err("TRAKT_RESPONSE"));
        }
        if result["not_found"]
            .as_object()
            .unwrap()
            .values()
            .any(|v| v.as_array().is_some_and(|v| !v.is_empty()))
        {
            return Err(err("TRAKT_NOT_FOUND"));
        }
        Ok(())
    }
    pub async fn playback_progress(&self) -> Result<Vec<PlaybackProgress>, AppError> {
        let mut s = self.inner.lock().await;
        self.load(&mut s)?;
        if !s.stored.settings.enabled {
            return Ok(vec![]);
        }
        let mut output = vec![];
        for kind in ["movies", "episodes"] {
            let data = self
                .authenticated(&mut s, &format!("/sync/playback/{kind}"), None)
                .await?;
            for row in data.as_array().ok_or_else(|| err("TRAKT_RESPONSE"))? {
                let movie = kind == "movies";
                let id = row[if movie { "movie" } else { "show" }]["ids"]["tmdb"]
                    .as_u64()
                    .unwrap_or(0);
                let progress = row["progress"].as_f64().unwrap_or(0.);
                let Some(paused) = row["paused_at"]
                    .as_str()
                    .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
                else {
                    continue;
                };
                if id == 0
                    || !progress.is_finite()
                    || progress <= 0.
                    || progress >= 100.
                    || s.stored.settings.range > 0
                        && paused.timestamp()
                            < now() as i64 - i64::from(s.stored.settings.range) * 86400
                {
                    continue;
                }
                let season = row["episode"]["season"].as_u64();
                let episode = row["episode"]["number"].as_u64();
                if !movie && (season.is_none() || episode.is_none()) {
                    continue;
                }
                output.push(PlaybackProgress {
                    r#type: if movie { "movie" } else { "episode" }.into(),
                    tmdb_id: id,
                    season,
                    episode,
                    progress,
                    paused_at: paused.to_rfc3339(),
                });
            }
        }
        Ok(output)
    }
    /// Local disconnect is authoritative. Revocation failure does not restore credentials.
    pub async fn disconnect(&self) -> Result<Status, AppError> {
        self.cancel();
        let mut s = self.inner.lock().await;
        self.load(&mut s)?;
        let token = s.stored.tokens.take();
        s.device = None;
        s.web = None;
        if let Err(e) = self.save(&s.stored) {
            s.stored.tokens = token;
            return Err(e);
        }
        let status = self.snapshot(&s);
        if let Some(t) = token {
            let _ = self
                .send(
                    "/oauth/revoke",
                    Some(json!({"client_id":self.client_id,"token":t.access_token})),
                    None,
                )
                .await;
        }
        Ok(status)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_untrusted_verification_urls() {
        for u in [
            "http://trakt.tv/activate",
            "https://trakt.tv.evil/",
            "https://user@trakt.tv/",
            "https://trakt.tv:444/",
        ] {
            assert!(verification_url(u).is_err())
        }
        assert!(verification_url("https://trakt.tv/activate").is_ok());
    }
    #[test]
    fn identity_and_rating_validation() {
        let mut id = Identity {
            r#type: "movie".into(),
            tmdb_id: None,
            imdb_id: Some("file-id".into()),
        };
        assert!(payload(&id, None).is_err());
        id.tmdb_id = Some(42);
        assert_eq!(payload(&id, Some(8)).unwrap()["movies"][0]["rating"], 8);
        assert!(payload(&id, Some(0)).is_err());
        assert!(payload(&id, Some(11)).is_err());
        id.r#type = "episode".into();
        assert!(payload(&id, None).unwrap()["episodes"].is_array());
    }
    #[test]
    fn credential_shape_never_serializes_to_status() {
        let s = Status {
            configured: true,
            connected: true,
            settings: SyncSettings::default(),
        };
        let v = serde_json::to_string(&s).unwrap();
        assert!(!v.contains("token"));
        assert!(!v.contains("code"));
    }
}

// Bind these command symbols with generate_handler!, and manage ONE Trakt instance.
fn main_window(window: &tauri::WebviewWindow) -> Result<(), AppError> {
    if window.label() != "main" {
        return Err(err("TRAKT_FORBIDDEN"));
    }
    Ok(())
}
#[tauri::command]
pub async fn trakt_status(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
) -> Result<Status, AppError> {
    main_window(&window)?;
    state.status().await
}
#[tauri::command]
pub async fn trakt_account(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
) -> Result<Account, AppError> {
    main_window(&window)?;
    state.account().await
}
#[tauri::command]
pub async fn trakt_connect_device_auth(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
) -> Result<DeviceLogin, AppError> {
    main_window(&window)?;
    state.connect_device_auth().await
}
#[tauri::command]
pub async fn trakt_poll(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
) -> Result<Poll, AppError> {
    main_window(&window)?;
    state.poll().await
}
#[tauri::command]
pub fn trakt_cancel(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
) -> Result<(), AppError> {
    main_window(&window)?;
    state.cancel();
    Ok(())
}
#[tauri::command]
pub async fn trakt_disconnect(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
) -> Result<Status, AppError> {
    main_window(&window)?;
    state.disconnect().await
}
#[tauri::command]
pub async fn trakt_settings(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
    settings: SyncSettings,
) -> Result<Status, AppError> {
    main_window(&window)?;
    state.settings(settings).await
}
#[tauri::command]
pub async fn trakt_sync(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
    identity: Identity,
    action: String,
    rating: Option<u8>,
) -> Result<(), AppError> {
    main_window(&window)?;
    state.sync(identity, &action, rating).await
}
#[tauri::command]
pub async fn trakt_playback_progress(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
) -> Result<Vec<PlaybackProgress>, AppError> {
    main_window(&window)?;
    state.playback_progress().await
}
#[tauri::command]
pub async fn trakt_open(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
    target: String,
) -> Result<(), AppError> {
    use tauri_plugin_opener::OpenerExt;
    main_window(&window)?;
    let url = match target.as_str() {
        "vip" => "https://app.trakt.tv/vip".into(),
        "verification" => {
            let s = state.inner.lock().await;
            if let Some(web) = s.web.as_ref() {
                if web.generation != state.generation.load(Ordering::SeqCst)
                    || web.expires_at <= now()
                    || web.completed
                    || web.error.is_some()
                {
                    return Err(err("TRAKT_EXPIRED"));
                }
                let target = authorize_url(web, &state.client_id);
                return window
                    .opener()
                    .open_url(target, None::<&str>)
                    .map_err(|_| err("TRAKT_NETWORK"));
            }
            let d = s.device.as_ref().ok_or_else(|| err("TRAKT_EXPIRED"))?;
            if d.generation != state.generation.load(Ordering::SeqCst)
                || d.public.expires_at <= now() * 1000
            {
                return Err(err("TRAKT_EXPIRED"));
            }
            verification_url(&d.public.verification_url)?
        }
        _ => return Err(err("TRAKT_REQUEST")),
    };
    window
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|_| err("TRAKT_NETWORK"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicRating {
    pub rating: f64,
    pub votes: u64,
    pub distribution: Value,
}
impl Trakt {
    /// Public community rating is distinct from the user's personal rating.
    pub async fn public_rating(&self, id: Identity) -> Result<PublicRating, AppError> {
        payload(&id, None)?;
        let kind = match id.r#type.as_str() {
            "movie" => "movie",
            "tv" => "show",
            "episode" => "episode",
            _ => return Err(err("TRAKT_METADATA")),
        };
        let lookup =
            if let Some(tmdb) = id.tmdb_id.filter(|v| *v > 0 && *v <= 9_007_199_254_740_991) {
                format!("/search/tmdb/{tmdb}?type={kind}")
            } else {
                format!(
                    "/search/imdb/{}?type={kind}",
                    id.imdb_id.as_deref().unwrap_or("")
                )
            };
        let (code, data, _) = self.send(&lookup, None, None).await?;
        if !(200..300).contains(&code) {
            return Err(failure(code));
        }
        let found = data
            .as_array()
            .ok_or_else(|| err("TRAKT_RESPONSE"))?
            .iter()
            .find(|row| row["type"].as_str() == Some(kind))
            .ok_or_else(|| err("TRAKT_NOT_FOUND"))?;
        let trakt_id = found[kind]["ids"]["trakt"]
            .as_u64()
            .filter(|v| *v > 0)
            .ok_or_else(|| err("TRAKT_NOT_FOUND"))?;
        let rating_path = if kind == "episode" {
            let show = found["show"]["ids"]["trakt"]
                .as_u64()
                .filter(|v| *v > 0)
                .ok_or_else(|| err("TRAKT_METADATA"))?;
            let season = found["episode"]["season"]
                .as_u64()
                .ok_or_else(|| err("TRAKT_METADATA"))?;
            let episode = found["episode"]["number"]
                .as_u64()
                .ok_or_else(|| err("TRAKT_METADATA"))?;
            format!("/shows/{show}/seasons/{season}/episodes/{episode}/ratings")
        } else {
            format!(
                "/{}/{trakt_id}/ratings",
                if kind == "movie" { "movies" } else { "shows" }
            )
        };
        let (code, data, _) = self.send(&rating_path, None, None).await?;
        if !(200..300).contains(&code) {
            return Err(failure(code));
        }
        let rating = data["rating"]
            .as_f64()
            .filter(|v| v.is_finite() && (0.0..=10.0).contains(v))
            .ok_or_else(|| err("TRAKT_RESPONSE"))?;
        let votes = data["votes"]
            .as_u64()
            .ok_or_else(|| err("TRAKT_RESPONSE"))?;
        if !data["distribution"].is_object() {
            return Err(err("TRAKT_RESPONSE"));
        }
        Ok(PublicRating {
            rating,
            votes,
            distribution: data["distribution"].clone(),
        })
    }
    pub async fn personal_ratings(&self, kind: &str, page: u32) -> Result<Value, AppError> {
        if !["movies", "shows", "episodes"].contains(&kind) || page == 0 || page > 10000 {
            return Err(err("TRAKT_REQUEST"));
        }
        let mut s = self.inner.lock().await;
        let data = self
            .authenticated(
                &mut s,
                &format!("/sync/ratings/{kind}?page={page}&limit=100"),
                None,
            )
            .await?;
        if !data.is_array() {
            return Err(err("TRAKT_RESPONSE"));
        }
        Ok(data)
    }
}
#[tauri::command]
pub async fn trakt_public_rating(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
    identity: Identity,
) -> Result<PublicRating, AppError> {
    main_window(&window)?;
    state.public_rating(identity).await
}
#[tauri::command]
pub async fn trakt_personal_ratings(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Trakt>,
    kind: String,
    page: u32,
) -> Result<Value, AppError> {
    main_window(&window)?;
    state.personal_ratings(&kind, page).await
}

#[cfg(test)]
mod state_tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex as StdMutex};
    #[derive(Default, Clone)]
    pub(super) struct MemoryVault(Arc<StdMutex<HashMap<String, String>>>);
    impl Vault for MemoryVault {
        fn get(&self, id: &str) -> Result<String, AppError> {
            self.0
                .lock()
                .unwrap()
                .get(id)
                .cloned()
                .ok_or_else(|| err("TRAKT_SECURE_STORAGE"))
        }
        fn put(&self, id: &str, value: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().insert(id.into(), value.into());
            Ok(())
        }
        fn remove(&self, id: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(id);
            Ok(())
        }
    }
    pub(super) fn client(dir: &Path, vault: MemoryVault) -> Trakt {
        let gateway = Gateway::new(Arc::new(|_| {
            Box::pin(async { Err(err("TRAKT_TEST_NO_NETWORK")) })
        }))
        .unwrap();
        Trakt::with_vault(
            dir.join("present"),
            gateway,
            "synthetic-client".into(),
            Box::new(vault),
        )
    }
    pub(super) fn queue(c: &Trakt, status: u16, value: Value) {
        c.responses
            .lock()
            .unwrap()
            .push_back((status, value, Headers::new()))
    }
    pub(super) fn device() -> Value {
        json!({"device_code":"synthetic-private-device","user_code":"ABCD","verification_url":"https://trakt.tv/activate","expires_in":600,"interval":5})
    }
    pub(super) fn tokens() -> Value {
        json!({"access_token":"synthetic-access","refresh_token":"synthetic-refresh","created_at":now(),"expires_in":3600})
    }
    pub(super) async fn ready_poll(c: &Trakt) {
        c.inner.lock().await.device.as_mut().unwrap().next = 0;
    }
    #[tokio::test]
    async fn first_use_and_settings_survive_restart_without_exposing_tokens() {
        let d = tempfile::tempdir().unwrap();
        let vault = MemoryVault::default();
        let c = client(d.path(), vault.clone());
        assert!(!c.status().await.unwrap().connected);
        c.settings(SyncSettings {
            enabled: false,
            range: 30,
        })
        .await
        .unwrap();
        let restarted = client(d.path(), vault);
        let status = restarted.status().await.unwrap();
        assert_eq!(status.settings.range, 30);
        assert!(!status.settings.enabled);
        assert!(restarted
            .settings(SyncSettings {
                enabled: true,
                range: 2
            })
            .await
            .is_err());
    }
    #[tokio::test]
    async fn unreadable_existing_vault_is_not_silently_logged_out() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("present"), "1").unwrap();
        let c = client(d.path(), MemoryVault::default());
        assert_eq!(c.status().await.err().unwrap().code, "TRAKT_SECURE_STORAGE");
    }
    #[tokio::test]
    async fn device_poll_throttle_pending_then_connected_persists_native_only() {
        let d = tempfile::tempdir().unwrap();
        let vault = MemoryVault::default();
        let c = client(d.path(), vault.clone());
        queue(&c, 200, device());
        let login = c.connect_device_auth().await.unwrap();
        assert!(!serde_json::to_string(&login)
            .unwrap()
            .contains("synthetic-private"));
        assert!(matches!(
            c.poll().await.unwrap(),
            Poll::Pending { interval: 5 }
        ));
        ready_poll(&c).await;
        queue(&c, 400, json!({}));
        assert!(matches!(c.poll().await.unwrap(), Poll::Pending { .. }));
        ready_poll(&c).await;
        queue(&c, 200, tokens());
        assert!(matches!(c.poll().await.unwrap(), Poll::Connected { .. }));
        assert!(client(d.path(), vault).status().await.unwrap().connected);
    }
    #[tokio::test]
    async fn slowdown_denial_and_cancel() {
        let d = tempfile::tempdir().unwrap();
        let c = client(d.path(), MemoryVault::default());
        queue(&c, 200, device());
        c.connect_device_auth().await.unwrap();
        ready_poll(&c).await;
        queue(&c, 429, json!({}));
        assert!(matches!(
            c.poll().await.unwrap(),
            Poll::Pending { interval: 10 }
        ));
        c.cancel();
        assert_eq!(c.poll().await.err().unwrap().code, "TRAKT_CANCELLED");
        queue(&c, 200, device());
        c.connect_device_auth().await.unwrap();
        ready_poll(&c).await;
        queue(&c, 418, json!({}));
        assert_eq!(c.poll().await.err().unwrap().code, "TRAKT_DENIED");
    }
    #[tokio::test]
    async fn expired_and_malformed_device_never_connect() {
        let d = tempfile::tempdir().unwrap();
        let c = client(d.path(), MemoryVault::default());
        let mut bad = device();
        bad["verification_url"] = json!("https://attacker.invalid/");
        queue(&c, 200, bad);
        assert!(c.connect_device_auth().await.is_err());
        queue(&c, 200, device());
        c.connect_device_auth().await.unwrap();
        c.inner
            .lock()
            .await
            .device
            .as_mut()
            .unwrap()
            .public
            .expires_at = 0;
        assert_eq!(c.poll().await.err().unwrap().code, "TRAKT_EXPIRED");
        assert!(!c.status().await.unwrap().connected);
    }
    #[tokio::test]
    async fn refresh_rotation_before_retry_and_offline_logout() {
        let d = tempfile::tempdir().unwrap();
        let c = client(d.path(), MemoryVault::default());
        queue(&c, 200, device());
        c.connect_device_auth().await.unwrap();
        ready_poll(&c).await;
        queue(&c, 200, tokens());
        c.poll().await.unwrap();
        queue(&c, 401, json!({}));
        let mut rotated = tokens();
        rotated["refresh_token"] = json!("synthetic-rotated");
        queue(&c, 200, rotated);
        queue(&c, 200, json!({"not_found":{}}));
        c.sync(
            Identity {
                r#type: "movie".into(),
                tmdb_id: Some(42),
                imdb_id: None,
            },
            "rating",
            Some(9),
        )
        .await
        .unwrap();
        assert_eq!(
            c.inner
                .lock()
                .await
                .stored
                .tokens
                .as_ref()
                .unwrap()
                .refresh_token,
            "synthetic-rotated"
        );
        assert!(!c.disconnect().await.unwrap().connected);
        assert!(!c.status().await.unwrap().connected);
    }
    #[tokio::test]
    async fn not_found_is_a_failed_sync() {
        let d = tempfile::tempdir().unwrap();
        let c = client(d.path(), MemoryVault::default());
        queue(&c, 200, device());
        c.connect_device_auth().await.unwrap();
        ready_poll(&c).await;
        queue(&c, 200, tokens());
        c.poll().await.unwrap();
        queue(
            &c,
            200,
            json!({"not_found":{"movies":[{"ids":{"tmdb":42}}]}}),
        );
        assert_eq!(
            c.sync(
                Identity {
                    r#type: "movie".into(),
                    tmdb_id: Some(42),
                    imdb_id: None
                },
                "watchlist-add",
                None
            )
            .await
            .err()
            .unwrap()
            .code,
            "TRAKT_NOT_FOUND"
        );
    }
}

#[cfg(test)]
mod protocol_tests {
    use super::state_tests::{client, device, queue, ready_poll, tokens, MemoryVault};
    use super::*;
    #[tokio::test]
    async fn fixed_proxy_preserves_electron_device_request_contract() {
        let d = tempfile::tempdir().unwrap();
        let c = client(d.path(), MemoryVault::default());
        queue(&c, 200, device());
        c.connect_device_auth().await.unwrap();
        let requests = c.requests.lock().unwrap();
        let r = &requests[0];
        assert_eq!(
            r.url,
            "https://api.xbyvideohub.com/api/trakt/oauth/device/code"
        );
        assert_eq!(r.method, "POST");
        assert_eq!(r.headers["trakt-api-key"], "synthetic-client");
        assert_eq!(r.headers["trakt-api-version"], "2");
        assert!(!r.headers.contains_key("authorization"));
        let body: Value = serde_json::from_slice(r.body.as_ref().unwrap()).unwrap();
        assert_eq!(body["client_id"], "synthetic-client");
        assert!(body.get("client_secret").is_none());
    }
    async fn connected(c: &Trakt) {
        queue(c, 200, device());
        c.connect_device_auth().await.unwrap();
        ready_poll(c).await;
        queue(c, 200, tokens());
        c.poll().await.unwrap();
    }
    #[tokio::test]
    async fn only_explicit_no_content_stats_mean_zero() {
        let d = tempfile::tempdir().unwrap();
        let c = client(d.path(), MemoryVault::default());
        connected(&c).await;
        queue(&c, 200, json!({"user":{"username":"synthetic"}}));
        queue(
            &c,
            200,
            json!({"name":"Example","vip":true,"images":{"avatar":{"full":"http://invalid.example"}}}),
        );
        queue(&c, 204, Value::Null);
        let profile = c.account().await.unwrap();
        assert_eq!(profile.movies, 0);
        assert!(profile.vip);
        assert!(profile.avatar.is_none());
        queue(&c, 200, json!({"user":{"username":"synthetic"}}));
        queue(&c, 200, json!({}));
        queue(&c, 200, Value::Null);
        assert_eq!(c.account().await.err().unwrap().code, "TRAKT_STATS");
    }
    #[tokio::test]
    async fn disabled_sync_never_posts_and_progress_filters_invalid_and_old_records() {
        let d = tempfile::tempdir().unwrap();
        let c = client(d.path(), MemoryVault::default());
        connected(&c).await;
        c.settings(SyncSettings {
            enabled: false,
            range: 7,
        })
        .await
        .unwrap();
        let before = c.requests.lock().unwrap().len();
        c.sync(
            Identity {
                r#type: "tv".into(),
                tmdb_id: Some(42),
                imdb_id: None,
            },
            "watchlist-add",
            None,
        )
        .await
        .unwrap();
        assert!(c.playback_progress().await.unwrap().is_empty());
        assert_eq!(c.requests.lock().unwrap().len(), before);
        c.settings(SyncSettings {
            enabled: true,
            range: 7,
        })
        .await
        .unwrap();
        queue(
            &c,
            200,
            json!([{"movie":{"ids":{"tmdb":42}},"progress":32,"paused_at":chrono::Utc::now().to_rfc3339()},{"movie":{"ids":{"tmdb":42}},"progress":100,"paused_at":chrono::Utc::now().to_rfc3339()},{"movie":{"ids":{"tmdb":42}},"progress":20,"paused_at":"2000-01-01T00:00:00Z"}]),
        );
        queue(&c, 200, json!([]));
        let progress = c.playback_progress().await.unwrap();
        assert_eq!(progress.len(), 1);
        assert_eq!(progress[0].progress, 32.0);
    }
    #[tokio::test]
    async fn public_rating_is_not_a_personal_rating_write() {
        let d = tempfile::tempdir().unwrap();
        let c = client(d.path(), MemoryVault::default());
        queue(
            &c,
            200,
            json!([{"type":"movie","movie":{"ids":{"trakt":123}}}]),
        );
        queue(
            &c,
            200,
            json!({"rating":8.5,"votes":20,"distribution":{"8":20}}),
        );
        let result = c
            .public_rating(Identity {
                r#type: "movie".into(),
                tmdb_id: Some(42),
                imdb_id: None,
            })
            .await
            .unwrap();
        assert_eq!(result.rating, 8.5);
        let requests = c.requests.lock().unwrap();
        assert!(requests
            .iter()
            .all(|r| r.method == "GET" && !r.headers.contains_key("authorization")));
        assert!(requests[1].url.ends_with("/movies/123/ratings"));
    }
}

/// Dev-only URI. Must be explicitly allowlisted for this Trakt application.
pub const WEB_REDIRECT_URI: &str = "boxplayer-migration-dev://trakt/callback";
struct WebSession {
    state: String,
    verifier: String,
    generation: u64,
    expires_at: u64,
    completed: bool,
    error: Option<&'static str>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebLogin {
    pub expires_at: u64,
    pub interval: u64,
}
fn nonce() -> Result<String, AppError> {
    use base64::Engine;
    use ring::rand::SecureRandom;
    let mut bytes = [0; 32];
    ring::rand::SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| err("TRAKT_REQUEST"))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}
fn authorize_url(web: &WebSession, client_id: &str) -> String {
    use base64::Engine;
    use sha2::Digest;
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(sha2::Sha256::digest(web.verifier.as_bytes()));
    let mut url = url::Url::parse("https://auth.trakt.tv/oauth/authorize").unwrap();
    url.query_pairs_mut().extend_pairs([
        ("client_id", client_id),
        ("response_type", "code"),
        ("redirect_uri", WEB_REDIRECT_URI),
        ("state", &web.state),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
    ]);
    url.into()
}
fn web_callback(target: &str, expected_state: &str) -> Result<Option<String>, AppError> {
    let u = match url::Url::parse(target) {
        Ok(u) => u,
        Err(_) => return Ok(None),
    };
    if u.scheme() != "boxplayer-migration-dev"
        || u.host_str() != Some("trakt")
        || u.path() != "/callback"
        || u.port().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
    {
        return Ok(None);
    }
    let pairs: Vec<_> = u.query_pairs().collect();
    let states: Vec<_> = pairs.iter().filter(|(k, _)| k == "state").collect();
    if states.len() != 1 || states[0].1 != expected_state {
        return Ok(None);
    }
    if pairs.iter().any(|(k, _)| k == "error") {
        return Err(err("TRAKT_DENIED"));
    }
    let codes: Vec<_> = pairs.iter().filter(|(k, _)| k == "code").collect();
    if codes.len() != 1 || codes[0].1.is_empty() || codes[0].1.len() > 8192 {
        return Err(err("TRAKT_DENIED"));
    }
    Ok(Some(codes[0].1.to_string()))
}
impl Trakt {
    async fn prepare_web(&self) -> Result<(String, WebLogin), AppError> {
        self.configured()?;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let mut s = self.inner.lock().await;
        self.load(&mut s)?;
        if generation != self.generation.load(Ordering::SeqCst) {
            return Err(err("TRAKT_CANCELLED"));
        }
        let web = WebSession {
            state: nonce()?,
            verifier: nonce()?,
            generation,
            expires_at: now() + 600,
            completed: false,
            error: None,
        };
        let authorization = authorize_url(&web, &self.client_id);
        let login = WebLogin {
            expires_at: web.expires_at * 1000,
            interval: 1,
        };
        s.device = None;
        s.web = Some(web);
        Ok((authorization, login))
    }
    pub async fn start_web(&self, app: &tauri::AppHandle) -> Result<WebLogin, AppError> {
        use tauri_plugin_opener::OpenerExt;
        let (url, login) = self.prepare_web().await?;
        if app.opener().open_url(url, None::<&str>).is_err() {
            self.cancel();
            return Err(err("TRAKT_NETWORK"));
        }
        Ok(login)
    }
    /// Call ONLY from the native accept_open/deep-link handler. Never pass callbacks through JS.
    /// false means it is unrelated or fails state/URI checks. Error messages contain no callback data.
    pub async fn callback(&self, target: &str) -> Result<bool, AppError> {
        let mut s = self.inner.lock().await;
        let Some(web) = s.web.as_ref() else {
            return Ok(false);
        };
        if web.completed || web.error.is_some() {
            return Ok(false);
        }
        if web.generation != self.generation.load(Ordering::SeqCst) {
            return Ok(false);
        }
        if web.expires_at <= now() {
            s.web = None;
            return Err(err("TRAKT_EXPIRED"));
        }
        let code = match web_callback(target, &web.state) {
            Ok(Some(code)) => code,
            Ok(None) => return Ok(false),
            Err(e) => {
                s.web.as_mut().unwrap().error = Some("TRAKT_DENIED");
                return Err(e);
            }
        };
        let generation = web.generation;
        let verifier = web.verifier.clone();
        let result=async {
  let(status,data,_)=self.send("/oauth/token",Some(json!({"client_id":self.client_id,"code":code,"code_verifier":verifier,"redirect_uri":WEB_REDIRECT_URI,"grant_type":"authorization_code"})),None).await?;
  if !(200..300).contains(&status){return Err(failure(status))}
  let tokens:Tokens=serde_json::from_value(data).map_err(|_|err("TRAKT_RESPONSE"))?;let tokens=tokens.validate()?;
  let(status,profile,_)=self.send("/users/settings",None,Some(&tokens.access_token)).await?;
  if !(200..300).contains(&status){return Err(failure(status))}if profile["user"]["username"].as_str().is_none_or(|v|v.is_empty()){return Err(err("TRAKT_RESPONSE"))}
  if generation!=self.generation.load(Ordering::SeqCst){return Err(err("TRAKT_CANCELLED"))}
  let mut next=s.stored.clone();next.tokens=Some(tokens);self.save(&next)?;
  // cancel() is lock-free; compensate if it raced a slow vault write.
  if generation!=self.generation.load(Ordering::SeqCst){self.save(&s.stored)?;return Err(err("TRAKT_CANCELLED"))}
  s.stored=next;Ok(())
 }.await;
        match result {
            Ok(()) => {
                s.web.as_mut().unwrap().completed = true;
                Ok(true)
            }
            Err(e) => {
                s.web.as_mut().unwrap().error = Some(e.code);
                Err(e)
            }
        }
    }
}
#[tauri::command]
pub async fn trakt_web_start(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    state: tauri::State<'_, Trakt>,
) -> Result<WebLogin, AppError> {
    main_window(&window)?;
    state.start_web(&app).await
}

#[cfg(test)]
mod web_tests {
    use super::state_tests::{client, queue, tokens, MemoryVault};
    use super::*;
    #[test]
    fn pkce_and_callback_are_dev_only_and_state_bound() {
        let web = WebSession {
            state: "synthetic-state".into(),
            verifier: "synthetic-verifier".into(),
            generation: 1,
            expires_at: now() + 600,
            completed: false,
            error: None,
        };
        let u = url::Url::parse(&authorize_url(&web, "synthetic-client")).unwrap();
        let q: std::collections::HashMap<_, _> = u.query_pairs().collect();
        assert_eq!(u.host_str(), Some("auth.trakt.tv"));
        assert_eq!(q["redirect_uri"], WEB_REDIRECT_URI);
        assert_eq!(q["code_challenge_method"], "S256");
        assert!(!u.as_str().contains("synthetic-verifier"));
        for target in ["boxplayer-traktoauth://callback?state=synthetic-state&code=abc","boxplayer-migration-dev://trakt/wrong?state=synthetic-state&code=abc","boxplayer-migration-dev://trakt/callback?state=wrong&code=abc","boxplayer-migration-dev://trakt/callback?state=synthetic-state&state=synthetic-state&code=abc","boxplayer-migration-dev://trakt/callback?state=synthetic-state&code=abc#fragment"]{assert!(web_callback(target,&web.state).unwrap().is_none())}
        assert_eq!(
            web_callback(
                "boxplayer-migration-dev://trakt/callback?state=synthetic-state&code=abc",
                &web.state
            )
            .unwrap(),
            Some("abc".into())
        );
        assert!(web_callback(
            "boxplayer-migration-dev://trakt/callback?state=synthetic-state&code=abc&code=def",
            &web.state
        )
        .is_err());
        assert!(web_callback(
            "boxplayer-migration-dev://trakt/callback?state=synthetic-state&error=access_denied",
            &web.state
        )
        .is_err());
    }
    #[tokio::test]
    async fn web_callback_persists_only_after_validated_exchange_and_profile() {
        let d = tempfile::tempdir().unwrap();
        let c = client(d.path(), MemoryVault::default());
        let (_, login) = c.prepare_web().await.unwrap();
        assert!(!serde_json::to_string(&login).unwrap().contains("state"));
        let state = c.inner.lock().await.web.as_ref().unwrap().state.clone();
        assert!(!c
            .callback("boxplayer-migration-dev://trakt/callback?state=wrong&code=abc")
            .await
            .unwrap());
        queue(&c, 200, tokens());
        queue(&c, 200, json!({"user":{"username":"synthetic"}}));
        assert!(c
            .callback(&format!(
                "{WEB_REDIRECT_URI}?state={state}&code=synthetic-code"
            ))
            .await
            .unwrap());
        assert!(matches!(c.poll().await.unwrap(), Poll::Connected { .. }));
        let requests = c.requests.lock().unwrap();
        let body: Value = serde_json::from_slice(requests[0].body.as_ref().unwrap()).unwrap();
        assert_eq!(body["redirect_uri"], WEB_REDIRECT_URI);
        assert_eq!(body["grant_type"], "authorization_code");
        assert!(body["code_verifier"].as_str().unwrap().len() >= 43);
        assert!(!body.as_object().unwrap().contains_key("client_secret"));
    }
    #[tokio::test]
    async fn cancellation_and_denied_callback_never_connect() {
        let d = tempfile::tempdir().unwrap();
        let c = client(d.path(), MemoryVault::default());
        c.prepare_web().await.unwrap();
        let state = c.inner.lock().await.web.as_ref().unwrap().state.clone();
        c.cancel();
        assert!(!c
            .callback(&format!("{WEB_REDIRECT_URI}?state={state}&code=abc"))
            .await
            .unwrap());
        assert_eq!(c.poll().await.err().unwrap().code, "TRAKT_CANCELLED");
        assert!(!c.status().await.unwrap().connected);
        c.prepare_web().await.unwrap();
        let state = c.inner.lock().await.web.as_ref().unwrap().state.clone();
        assert_eq!(
            c.callback(&format!(
                "{WEB_REDIRECT_URI}?state={state}&error=access_denied"
            ))
            .await
            .err()
            .unwrap()
            .code,
            "TRAKT_DENIED"
        );
        assert_eq!(c.poll().await.err().unwrap().code, "TRAKT_DENIED");
    }
}

const AVATAR_MAX: usize = 1024 * 1024;
fn avatar_url(value: &str) -> Result<String, AppError> {
    let u = url::Url::parse(value).map_err(|_| err("TRAKT_RESPONSE"))?;
    if u.scheme() != "https"
        || !u.username().is_empty()
        || u.password().is_some()
        || u.host_str().is_none()
        || u.fragment().is_some()
    {
        return Err(err("TRAKT_RESPONSE"));
    }
    Ok(u.into())
}
fn avatar_data(expected: &str, response: crate::gateway::HttpResponse) -> Result<String, AppError> {
    use base64::Engine;
    if response.status != 200
        || response.final_url != expected
        || response.body.is_empty()
        || response.body.len() > AVATAR_MAX
    {
        return Err(err("TRAKT_RESPONSE"));
    }
    let mime = response
        .headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| {
            v.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
        })
        .ok_or_else(|| err("TRAKT_RESPONSE"))?;
    let b = &response.body;
    let valid = match mime.as_str() {
        "image/png" => b.starts_with(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg" => b.starts_with(&[0xff, 0xd8, 0xff]),
        "image/gif" => b.starts_with(b"GIF87a") || b.starts_with(b"GIF89a"),
        "image/webp" => b.len() >= 12 && &b[..4] == b"RIFF" && &b[8..12] == b"WEBP",
        _ => false,
    };
    if !valid {
        return Err(err("TRAKT_RESPONSE"));
    }
    Ok(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(b)
    ))
}
impl Trakt {
    /// Only called with the avatar from the authenticated account response. No URL command exists.
    async fn avatar(&self, url: &str) -> Result<String, AppError> {
        use futures_util::StreamExt;
        let url = avatar_url(url)?;
        // Gateway follows redirects for source browsing; avatar media must reject
        // redirects before contacting another origin and stop reading at 1 MiB.
        // JSON Trakt API operations still exclusively use the shared Gateway.
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|_| err("TRAKT_NETWORK"))?;
        let response = client
            .get(&url)
            .header("accept", "image/png,image/jpeg,image/webp,image/gif")
            .send()
            .await
            .map_err(|_| err("TRAKT_NETWORK"))?;
        if response.status() != reqwest::StatusCode::OK
            || response.url().as_str() != url
            || response
                .content_length()
                .is_some_and(|v| v > AVATAR_MAX as u64)
        {
            return Err(err("TRAKT_RESPONSE"));
        }
        let mime = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| err("TRAKT_RESPONSE"))?
            .to_owned();
        if !matches!(
            mime.split(';')
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase()
                .as_str(),
            "image/png" | "image/jpeg" | "image/gif" | "image/webp"
        ) {
            return Err(err("TRAKT_RESPONSE"));
        }
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| err("TRAKT_NETWORK"))?;
            if bytes.len().saturating_add(chunk.len()) > AVATAR_MAX {
                return Err(err("TRAKT_RESPONSE"));
            }
            bytes.extend_from_slice(&chunk)
        }
        avatar_data(
            &url,
            crate::gateway::HttpResponse {
                status: 200,
                headers: Headers::from([("content-type".into(), mime)]),
                body: bytes,
                final_url: url.clone(),
            },
        )
    }
}
#[cfg(test)]
mod avatar_tests {
    use super::*;
    fn response(mime: &str, bytes: Vec<u8>, url: &str) -> crate::gateway::HttpResponse {
        crate::gateway::HttpResponse {
            status: 200,
            headers: Headers::from([("Content-Type".into(), mime.into())]),
            body: bytes,
            final_url: url.into(),
        }
    }
    #[test]
    fn avatar_is_csp_safe_bounded_and_not_an_external_url() {
        let url = "https://images.trakt.tv/avatar.png";
        let png = b"\x89PNG\r\n\x1a\nsynthetic".to_vec();
        let result =
            avatar_data(url, response("image/png; charset=binary", png.clone(), url)).unwrap();
        assert!(result.starts_with("data:image/png;base64,"));
        assert!(avatar_data(url, response("image/png", vec![0; AVATAR_MAX + 1], url)).is_err());
        assert!(avatar_data(url, response("image/svg+xml", b"<svg/>".to_vec(), url)).is_err());
        assert!(avatar_data(url, response("image/png", b"<html/>".to_vec(), url)).is_err());
        assert!(avatar_data(
            url,
            response("image/png", png, "https://other.invalid/avatar.png")
        )
        .is_err());
        for value in [
            "http://images.trakt.tv/avatar.png",
            "https://name:secret@images.trakt.tv/avatar.png",
            "data:image/png;base64,a",
        ] {
            assert!(avatar_url(value).is_err())
        }
    }
}
