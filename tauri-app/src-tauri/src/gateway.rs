use crate::settings::AppError;
use axum::{
    body::Body,
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode},
    response::Response,
    routing::get,
    Router,
};
use futures_util::StreamExt;
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::sync::{Mutex as AsyncMutex, RwLock};
use tokio_util::sync::CancellationToken;
use url::Url;

pub type Headers = BTreeMap<String, String>;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResolvedMedia {
    pub schema_version: u32,
    pub source_id: String,
    pub account_id: String,
    pub file_id: String,
    pub url: String,
    #[serde(default)]
    pub headers: Headers,
    pub expires_at: Option<u64>,
}
impl ResolvedMedia {
    pub fn key(&self) -> String {
        crate::storage::identity(
            &serde_json::to_string(&(&self.source_id, &self.account_id, &self.file_id)).unwrap(),
        )
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HttpRequest {
    pub request_id: String,
    pub provider_id: String,
    pub account_id: String,
    pub method: String,
    pub url: String,
    #[serde(default)]
    pub headers: Headers,
    pub body: Option<Vec<u8>>,
    pub timeout_ms: Option<u64>,
    pub proxy: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Headers,
    pub body: Vec<u8>,
    pub final_url: String,
}
pub type RefreshFuture = Pin<Box<dyn Future<Output = Result<ResolvedMedia, AppError>> + Send>>;
pub type RefreshHook = Arc<dyn Fn(ResolvedMedia) -> RefreshFuture + Send + Sync>;
pub type IdentityHook = Arc<dyn Fn(&ResolvedMedia) -> Result<ResolvedMedia, AppError> + Send + Sync>;
struct Resource {
    recovery_pending: AtomicBool,
    refresh_allowed: bool,
    hls: crate::hls::HlsKey,
    media: AsyncMutex<ResolvedMedia>,
    refresh_lock: AsyncMutex<()>,
    cancel: CancellationToken,
}
struct RequestCancellation {
    account_id: String,
    cancel: CancellationToken,
}
pub struct Gateway {
    subtitles: Mutex<HashMap<String, (std::time::Instant, ResolvedMedia, Vec<crate::player::Subtitle>)>>,
    pub cookies: crate::cookie_sessions::CookieSessions,
    requests: Mutex<HashMap<String, RequestCancellation>>,
    resources: RwLock<HashMap<String, Arc<Resource>>>,
    refresh: RefreshHook,
    identity: IdentityHook,
    base: tokio::sync::OnceCell<String>,
}
fn failure(code: &'static str, message: &'static str) -> AppError {
    AppError::new(code, message, true)
}
fn parsed_url(value: &str) -> Result<Url, AppError> {
    let u = Url::parse(value).map_err(|_| failure("URL_INVALID", "Invalid HTTP URL"))?;
    if !matches!(u.scheme(), "http" | "https") || !u.username().is_empty() || u.password().is_some()
    {
        return Err(failure(
            "URL_INVALID",
            "Only HTTP(S) URLs without embedded credentials are supported",
        ));
    }
    Ok(u)
}
fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
}
fn strip_credentials(headers: &mut Headers) {
    headers.retain(|k, _| {
        !matches!(
            k.to_ascii_lowercase().as_str(),
            "authorization"
                | "cookie"
                | "proxy-authorization"
                | "x-api-key"
                | "x-emby-token"
                | "x-emby-authorization"
                | "x-plex-token"
                | "sessionkey"
                | "signature"
                | "x-signature"
                | "x-captcha-token"
                | "x-urlp"
                | "x-device-id"
                | "client-id"
                | "did"
                | "dt"
                | "mcloud-sign"
                | "x-plex-client-identifier"
        )
    });
}
impl Gateway {
    pub fn set_subtitles(&self, media: &ResolvedMedia, subtitles: Vec<crate::player::Subtitle>) {
        let mut pending = self.subtitles.lock().unwrap();
        pending.retain(|_, (time, _, _)| time.elapsed() < Duration::from_secs(120));
        if pending.len() >= 128 {
            pending.clear();
        }
        pending.insert(media.key(), (std::time::Instant::now(), media.clone(), subtitles));
    }
    pub fn take_subtitles(&self, media: &ResolvedMedia) -> Vec<crate::player::Subtitle> {
        let Ok(current)=self.canonical_media(media) else{return vec![]};
        let mut pending=self.subtitles.lock().unwrap();
        pending.retain(|_,(time,_,_)|time.elapsed()<Duration::from_secs(120));
        // Old cache keys are retained until consumption, but match only a proven
        // source/account/file alias and canonicalize each subtitle before use.
        let keys:Vec<_>=pending.iter().filter_map(|(key,(time,root,_))|self.canonical_media(root).ok().filter(|root|root.key()==current.key()).map(|_|(key.clone(),*time))).collect();
        let newest=keys.iter().max_by_key(|(_,time)|time).map(|(key,_)|key.clone());
        let selected=newest.and_then(|key|pending.remove(&key));
        for (key,_) in keys {pending.remove(&key);}
        selected.map(|(_,_,list)|list.into_iter().filter_map(|mut subtitle|{subtitle.media=self.canonical_media(&subtitle.media).ok()?;Some(subtitle)}).collect()).unwrap_or_default()
    }
    pub async fn resolve_queue_item(
        &self,
        original: ResolvedMedia,
    ) -> Result<ResolvedMedia, AppError> {
        let original=self.canonical_media(&original)?;
        let resolved =
            tokio::time::timeout(Duration::from_secs(15), (self.refresh)(original.clone()))
                .await
                .map_err(|_| failure("REFRESH_TIMEOUT", "Queue resolver timed out"))??;
        if resolved.account_id != original.account_id
            || resolved.source_id != original.source_id
            || resolved.file_id != original.file_id
        {
            return Err(failure("REFRESH_IDENTITY", "Queue item identity changed"));
        }
        parsed_url(&resolved.url)?;
        if self.canonical_media(&resolved)?.file_id != resolved.file_id {
            return Err(failure("REFRESH_IDENTITY", "File moved while resolving media; retry with current identity"));
        }
        Ok(resolved)
    }
    pub fn canonical_media(&self, media:&ResolvedMedia)->Result<ResolvedMedia,AppError>{
        let resolved=(self.identity)(media)?;
        if resolved.source_id!=media.source_id||resolved.account_id!=media.account_id {
            return Err(failure("REFRESH_IDENTITY","Identity resolver changed source or account"));
        }
        Ok(resolved)
    }
    pub fn new(refresh: RefreshHook) -> Result<Arc<Self>, AppError> {
        Self::with_identity(refresh,Arc::new(|media|Ok(media.clone())))
    }
    pub fn with_identity(refresh:RefreshHook,identity:IdentityHook)->Result<Arc<Self>,AppError>{
        crate::network_proxy::client()?;
        Ok(Arc::new(Self {
            subtitles: Default::default(),
            cookies: Default::default(),
            requests: Mutex::new(HashMap::new()),
            resources: RwLock::new(HashMap::new()),
            refresh,
            identity,
            base: tokio::sync::OnceCell::new(),
        }))
    }
    pub async fn start(self: &Arc<Self>) -> Result<String, AppError> {
        let base = self
            .base
            .get_or_try_init(|| async {
                let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                    .await
                    .map_err(AppError::io)?;
                let base = format!(
                    "http://127.0.0.1:{}",
                    listener.local_addr().map_err(AppError::io)?.port()
                );
                let app = Router::new()
                    .route("/media/{token}", get(proxy))
                    .route("/media/{token}/hls/{sealed}", get(proxy_hls))
                    .with_state(self.clone());
                tokio::spawn(async move {
                    if axum::serve(listener, app).await.is_err() {
                        log::error!("Local media proxy stopped");
                    }
                });
                Ok::<String, AppError>(base)
            })
            .await?;
        Ok(base.clone())
    }
    pub async fn register(self: &Arc<Self>, media: ResolvedMedia) -> Result<String, AppError> {
        self.register_mode(media, true).await
    }
    pub(crate) async fn register_test(
        self: &Arc<Self>,
        media: ResolvedMedia,
    ) -> Result<String, AppError> {
        self.register_mode(media, false).await
    }
    async fn register_mode(
        self: &Arc<Self>,
        media: ResolvedMedia,
        refresh_allowed: bool,
    ) -> Result<String, AppError> {
        let canonical=self.canonical_media(&media)?;
        let media=if canonical.file_id!=media.file_id||canonical.url=="boxplayer-queue:" {self.resolve_queue_item(canonical).await?}else{media};
        parsed_url(&media.url)?;
        if media.schema_version != 1
            || media.source_id.is_empty()
            || media.account_id.is_empty()
            || media.file_id.is_empty()
        {
            return Err(failure(
                "MEDIA_INVALID",
                "Missing media account or file identity",
            ));
        }
        let base = self.start().await?;
        let token = uuid::Uuid::new_v4().simple().to_string();
        let mut resources = self.resources.write().await;
        if resources.len() >= 64 {
            return Err(failure("MEDIA_LIMIT", "Too many active media resources"));
        }
        resources.insert(
            token.clone(),
            Arc::new(Resource {
                recovery_pending: AtomicBool::new(false),
                refresh_allowed,
                hls: crate::hls::HlsKey::new()?,
                media: AsyncMutex::new(media),
                refresh_lock: AsyncMutex::new(()),
                cancel: CancellationToken::new(),
            }),
        );
        Ok(format!("{base}/media/{token}"))
    }
    #[cfg(test)]
    pub(crate) async fn test_resource_count(&self) -> usize {
        self.resources.read().await.len()
    }
    pub async fn revoke(&self, url: &str) {
        if let Some(token) = url.rsplit('/').next() {
            if let Some(resource) = self.resources.write().await.remove(token) {
                resource.cancel.cancel();
            }
        }
    }
    pub async fn take_hls_recovery(&self, url: &str) -> bool {
        let Some(token) = url.rsplit('/').next() else {
            return false;
        };
        let resources = self.resources.read().await;
        resources.get(token).is_some_and(|resource| {
            !resource.cancel.is_cancelled()
                && resource.recovery_pending.swap(false, Ordering::SeqCst)
        })
    }
    pub async fn revoke_account(&self, account_id: &str) {
        self.subtitles.lock().unwrap().retain(|_, (_, root, list)| {
            if root.account_id==account_id{return false;}
            !list
                .iter()
                .any(|subtitle| subtitle.media.account_id == account_id)
        });
        self.cookies.remove(account_id);
        let requests: Vec<_> = self
            .requests
            .lock()
            .unwrap()
            .values()
            .filter(|r| r.account_id == account_id)
            .map(|r| r.cancel.clone())
            .collect();
        for cancel in requests {
            cancel.cancel();
        }
        let resources: Vec<_> = self
            .resources
            .read()
            .await
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        for (key, resource) in resources {
            let matches = resource.media.lock().await.account_id == account_id;
            if matches {
                resource.cancel.cancel();
                self.resources.write().await.remove(&key);
            }
        }
    }
    pub fn cancel(&self, id: &str) -> bool {
        if let Some(token) = self.requests.lock().unwrap().get(id) {
            token.cancel.cancel();
            true
        } else {
            false
        }
    }
    pub async fn request(self: &Arc<Self>, request: HttpRequest) -> Result<HttpResponse, AppError> {
        if request.request_id.is_empty() {
            return Err(failure("REQUEST_INVALID", "Request ID is required"));
        }
        let cancel = CancellationToken::new();
        {
            let mut requests = self.requests.lock().unwrap();
            if requests.contains_key(&request.request_id) {
                return Err(failure("REQUEST_DUPLICATE", "Request ID is already active"));
            }
            requests.insert(
                request.request_id.clone(),
                RequestCancellation {
                    account_id: request.account_id.clone(),
                    cancel: cancel.clone(),
                },
            );
        }
        struct Guard {
            owner: Arc<Gateway>,
            id: String,
        }
        impl Drop for Guard {
            fn drop(&mut self) {
                self.owner.requests.lock().unwrap().remove(&self.id);
            }
        }
        let _guard = Guard {
            owner: self.clone(),
            id: request.request_id.clone(),
        };
        let timeout = Duration::from_millis(request.timeout_ms.unwrap_or(30000).clamp(1, 120000));
        let future = async {
            let method = Method::from_bytes(request.method.as_bytes())
                .map_err(|_| failure("METHOD_INVALID", "Invalid HTTP method"))?;
            let mut headers = request.headers;
            provider_headers(&request.provider_id, &request.url, &mut headers);
            let client = if let Some(proxy) = request.proxy {
                let parsed = Url::parse(&proxy)
                    .map_err(|_| failure("PROXY_INVALID", "Invalid proxy URL"))?;
                if !matches!(parsed.scheme(), "http" | "https" | "socks5" | "socks5h") {
                    return Err(failure("PROXY_INVALID", "Unsupported proxy protocol"));
                }
                let mut builder = Client::builder().redirect(Policy::none());
                if let Some(jar) = self.cookies.jar(&request.account_id) {
                    builder = builder.cookie_provider(jar);
                }
                builder
                    .proxy(
                        reqwest::Proxy::all(&proxy)
                            .map_err(|_| failure("PROXY_INVALID", "Invalid proxy URL"))?,
                    )
                    .build()
                    .map_err(|_| failure("PROXY_INVALID", "Unable to initialize proxy"))?
            } else {
                self.cookies
                    .client(&request.account_id)
                    .unwrap_or(crate::network_proxy::client()?)
            };
            let response = self
                .send(&client, method, request.url, headers, request.body)
                .await?;
            let status = response.status().as_u16();
            let final_url = response.url().to_string();
            let headers = response
                .headers()
                .iter()
                .filter(|(k, _)| k.as_str() != "set-cookie")
                .filter_map(|(k, v)| v.to_str().ok().map(|v| (k.to_string(), v.into())))
                .collect();
            let mut body = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk =
                    chunk.map_err(|_| failure("HTTP_BODY", "Unable to read response body"))?;
                if body.len() + chunk.len() > 8 * 1024 * 1024 {
                    return Err(failure(
                        "BODY_LIMIT",
                        "Response exceeds the API response limit",
                    ));
                }
                body.extend_from_slice(&chunk)
            }
            Ok(HttpResponse {
                status,
                headers,
                body,
                final_url,
            })
        };
        tokio::select! {_=cancel.cancelled()=>Err(failure("CANCELLED","Request cancelled")), result=tokio::time::timeout(timeout,future)=>result.map_err(|_|failure("TIMEOUT","Request timed out"))?}
    }
    async fn send(
        &self,
        client: &Client,
        mut method: Method,
        url: String,
        mut headers: Headers,
        mut body: Option<Vec<u8>>,
    ) -> Result<reqwest::Response, AppError> {
        let mut url = parsed_url(&url)?;
        for hop in 0..=5 {
            let mut builder = client.request(method.clone(), url.clone());
            for (name, value) in &headers {
                let key = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                    .map_err(|_| failure("HEADER_INVALID", "Invalid header name"))?;
                let val = reqwest::header::HeaderValue::from_str(value)
                    .map_err(|_| failure("HEADER_INVALID", "Invalid header value"))?;
                if !matches!(
                    key.as_str(),
                    "host" | "connection" | "content-length" | "transfer-encoding"
                ) {
                    builder = builder.header(key, val)
                }
            }
            if let Some(body) = &body {
                builder = builder.body(body.clone());
            }
            let response = builder
                .send()
                .await
                .map_err(|error| failure("HTTP_NETWORK",if error.is_timeout(){"网络请求超时，请检查代理设置"}else if error.is_connect(){"无法连接服务器，请检查网络与代理设置"}else{"网络请求失败，请检查代理设置"}))?;
            if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
                return Ok(response);
            }
            if hop == 5 {
                return Err(failure("REDIRECT_LIMIT", "Too many HTTP redirects"));
            }
            let location = response
                .headers()
                .get("location")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| failure("REDIRECT_INVALID", "Missing redirect location"))?;
            let next = url
                .join(location)
                .map_err(|_| failure("REDIRECT_INVALID", "Invalid redirect location"))?;
            parsed_url(next.as_str())?;
            if !same_origin(&url, &next) {
                strip_credentials(&mut headers);
                if matches!(response.status().as_u16(), 307 | 308) && body.is_some() {
                    return Err(failure(
                        "REDIRECT_ORIGIN",
                        "Cannot redirect a private request body to another origin",
                    ));
                }
            }
            if response.status().as_u16() == 303
                || (matches!(response.status().as_u16(), 301 | 302) && method == Method::POST)
            {
                method = Method::GET;
                body = None;
                headers.retain(|k, _| {
                    !matches!(
                        k.to_ascii_lowercase().as_str(),
                        "content-type" | "content-length"
                    )
                });
            }
            url = next;
        }
        unreachable!()
    }
    async fn stream(
        &self,
        resource: Arc<Resource>,
        method: Method,
        incoming: HeaderMap,
        token: &str,
        target: Option<(String, u64)>,
    ) -> Result<Response, AppError> {
        let child = target.is_some();
        let (root_media, mut generation) = {
            let media = resource.media.lock().await;
            (media.clone(), resource.hls.generation())
        };
        let mut original = root_media.clone();
        if let Some((target, expected)) = target {
            if expected != generation {
                return Err(failure("HLS_SESSION_CHANGED", "HLS child session expired"));
            }
            let root = parsed_url(&original.url)?;
            let target = parsed_url(&target)?;
            if !same_origin(&root, &target) {
                strip_credentials(&mut original.headers);
            }
            original.url = target.into();
        }
        let mut headers = original.headers.clone();
        for name in ["range", "if-range"] {
            if parsed_url(&original.url)?.path().ends_with(".m3u8") {
                continue;
            }
            if let Some(value) = incoming.get(name).and_then(|v| v.to_str().ok()) {
                headers.insert(name.into(), value.into());
            }
        }
        let mut response = self
            .send(
                &crate::network_proxy::client()?,
                method.clone(),
                original.url.clone(),
                headers.clone(),
                None,
            )
            .await?;
        if resource.refresh_allowed
            && (!child || same_origin(&parsed_url(&root_media.url)?, &parsed_url(&original.url)?))
            && matches!(
                response.status(),
                StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED
            )
        {
            let _refresh = resource.refresh_lock.lock().await;
            let mut refreshed = resource.media.lock().await.clone();
            if refreshed.url == root_media.url && refreshed.headers == root_media.headers {
                refreshed = self.resolve_queue_item(root_media.clone()).await?;
                parsed_url(&refreshed.url)?;
                let mut current = resource.media.lock().await;
                if refreshed.url != root_media.url {
                    resource.hls.invalidate_session();
                }
                *current = refreshed.clone();
            }
            // Existing sealed child links belong to this exact HLS session. A new
            // root may use different segment timestamps/keys; never guess paths.
            if child && refreshed.url != root_media.url {
                resource.recovery_pending.store(true, Ordering::SeqCst);
                return Err(failure(
                    "HLS_SESSION_CHANGED",
                    "HLS session changed; reopen media",
                ));
            }
            let retry_url = if child {
                original.url.clone()
            } else {
                refreshed.url.clone()
            };
            generation = resource.hls.generation();
            headers = refreshed.headers;
            for name in ["range", "if-range"] {
                if let Some(value) = incoming.get(name).and_then(|v| v.to_str().ok()) {
                    headers.insert(name.into(), value.into());
                }
            }
            response = self
                .send(&crate::network_proxy::client()?, method.clone(), retry_url, headers, None)
                .await?;
        }
        let manifest = response.status().is_success()
            && method != Method::HEAD
            && (response.url().path().ends_with(".m3u8")
                || response
                    .headers()
                    .get("content-type")
                    .and_then(|v| v.to_str().ok())
                    .is_some_and(|v| v.to_ascii_lowercase().contains("mpegurl")));
        if manifest {
            let upstream = response.url().clone();
            let mut bytes = Vec::new();
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk =
                    chunk.map_err(|_| failure("HLS_BODY", "Unable to read HLS manifest"))?;
                if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                    return Err(failure("BODY_LIMIT", "HLS manifest exceeds limit"));
                }
                bytes.extend(chunk);
            }
            let base = format!(
                "{}/media/{token}",
                self.base
                    .get()
                    .ok_or_else(|| failure("PROXY_RESPONSE", "Media proxy unavailable"))?
            );
            let rewritten = resource
                .hls
                .rewrite_at(&bytes, &upstream, &base, generation)?;
            return Response::builder()
                .status(200)
                .header("content-type", "application/vnd.apple.mpegurl")
                .header("cache-control", "no-store")
                .body(Body::from(rewritten))
                .map_err(|_| failure("PROXY_RESPONSE", "Unable to build HLS response"));
        }
        let status = response.status();
        let mut builder = Response::builder().status(status);
        for name in [
            "content-type",
            "content-length",
            "content-range",
            "accept-ranges",
            "etag",
            "last-modified",
        ] {
            if let Some(value) = response.headers().get(name) {
                builder = builder.header(name, value);
            }
        }
        let cancel = resource.cancel.clone();
        let stream = response.bytes_stream().take_until(cancel.cancelled_owned());
        builder
            .body(Body::from_stream(stream))
            .map_err(|_| failure("PROXY_RESPONSE", "Unable to build media response"))
    }
}
async fn proxy(
    State(gateway): State<Arc<Gateway>>,
    Path(token): Path<String>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let resource = gateway.resources.read().await.get(&token).cloned();
    let Some(resource) = resource else {
        return Response::builder().status(404).body(Body::empty()).unwrap();
    };
    let cancelled = resource.cancel.clone();
    let result = tokio::select! {_=cancelled.cancelled()=>Err(failure("CANCELLED","Media cancelled")),result=tokio::time::timeout(Duration::from_secs(45),gateway.stream(resource,method,headers,&token,None))=>result.map_err(|_|failure("TIMEOUT","Media request timed out")).and_then(|r|r)};
    match result {
        Ok(response) => response,
        Err(error) => Response::builder()
            .status(if error.code == "CANCELLED" { 410 } else { 502 })
            .header("content-type", "text/plain")
            .body(Body::from(error.code))
            .unwrap(),
    }
}
async fn proxy_hls(
    State(gateway): State<Arc<Gateway>>,
    Path((token, sealed)): Path<(String, String)>,
    method: Method,
    headers: HeaderMap,
) -> Response {
    let resource = gateway.resources.read().await.get(&token).cloned();
    let Some(resource) = resource else {
        return Response::builder().status(404).body(Body::empty()).unwrap();
    };
    let generation = resource.hls.generation();
    let target = match resource.hls.open(&sealed) {
        Ok(value) => value,
        Err(_) => return Response::builder().status(404).body(Body::empty()).unwrap(),
    };
    let cancelled = resource.cancel.clone();
    let result = tokio::select! {_=cancelled.cancelled()=>Err(failure("CANCELLED","Media cancelled")),result=tokio::time::timeout(Duration::from_secs(45),gateway.stream(resource,method,headers,&token,Some((target,generation))))=>result.map_err(|_|failure("TIMEOUT","Media request timed out")).and_then(|value|value)};
    match result {
        Ok(response) => response,
        Err(error) => Response::builder()
            .status(502)
            .header("content-type", "text/plain")
            .body(Body::from(error.code))
            .unwrap(),
    }
}
pub fn provider_headers(provider: &str, url: &str, headers: &mut Headers) {
    // Auth remains account-scoped at the caller; never use a global selected-account token.
    let host = Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_default();
    let mut default_header = |name: &str, value: &str| {
        if !headers.keys().any(|key| key.eq_ignore_ascii_case(name)) {
            headers.insert(name.into(), value.into());
        }
    };
    if provider == "guangya" && host == "api.guangyapan.com" {
        let trace = uuid::Uuid::new_v4().simple().to_string();
        let span = uuid::Uuid::new_v4().simple().to_string();
        default_header("traceparent", &format!("00-{trace}-{}-01", &span[..16]));
    }
    if provider == "baidu" && (host.ends_with(".baidupcs.com") || host == "pan.baidu.com") {
        default_header("user-agent", "pan.baidu.com");
        default_header("referer", "https://pan.baidu.com/");
    }
    if matches!(provider, "aliyun" | "alipan-open")
        && (host.ends_with(".aliyundrive.com") || host.ends_with(".alipan.com"))
    {
        default_header("referer", "https://www.aliyundrive.com/");
        default_header("origin", "https://www.aliyundrive.com");
        default_header("x-canary", "client=windows,app=adrive,version=v4.12.0");
        default_header("user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0");
    }
}
#[cfg(test)]
#[path = "gateway_tests.rs"]
pub(crate) mod tests;
