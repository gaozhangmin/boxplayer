//! Existing website device-session protocol. Device codes and bearer tokens stay native.
use crate::{
    accounts::{Account, Accounts, Credentials},
    gateway::{Gateway, Headers, HttpRequest},
    settings::AppError,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;
fn error(message: &str) -> AppError {
    AppError::new("BOXPLAYER_ACCOUNT", message, false)
}
struct Session {
    code: String,
    site: String,
    verification: String,
    created: Instant,
    expires: Duration,
    interval: Duration,
    last: Mutex<Option<Instant>>,
    poll: tokio::sync::Mutex<()>,
    cancel: CancellationToken,
}
#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Arc<Session>>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogin {
    pub session_id: String,
    pub content: String,
    pub user_code: String,
    pub expires_in: u64,
    pub interval: u64,
}
#[derive(Serialize)]
pub struct LoginStatus {
    pub pending: bool,
    pub account: Option<Account>,
}
async fn api(
    gateway: &Arc<Gateway>,
    site: &str,
    path: &str,
    body: Option<Value>,
    bearer: Option<String>,
) -> Result<(u16, Value), AppError> {
    let mut headers = Headers::from([("content-type".into(), "application/json".into())]);
    if let Some(token) = bearer {
        headers.insert("Authorization".into(), format!("Bearer {token}"));
    }
    let response = gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "boxplayer".into(),
            account_id: String::new(),
            method: if body.is_some() { "POST" } else { "GET" }.into(),
            url: format!("{site}{path}"),
            headers,
            body: body.map(|v| v.to_string().into_bytes()),
            timeout_ms: Some(15000),
            proxy: None,
        })
        .await?;
    // The native gateway strips cross-origin headers on redirects. Do not accept
    // a redirected login exchange as an authoritative account response.
    if url::Url::parse(&response.final_url)
        .ok()
        .map(|u| u.origin())
        != url::Url::parse(site).ok().map(|u| u.origin())
    {
        return Err(error("账号服务重定向无效"));
    }
    let data = serde_json::from_slice(&response.body).map_err(|_| error("账号服务响应无效"))?;
    Ok((response.status, data))
}
fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}
fn identity(site: &str, value: &Value) -> Result<(Account, Credentials), AppError> {
    let email = text(value, "email").trim();
    let token = text(value, "accessToken");
    if email.is_empty()
        || email.len() > 200
        || !email.contains('@')
        || token.is_empty()
        || token.len() > 32768
    {
        return Err(error("账号交换未返回有效身份"));
    }
    let origin = url::Url::parse(site)
        .map_err(|_| error("账号服务配置无效"))?
        .origin()
        .ascii_serialization();
    Ok((
        Account {
            id: String::new(),
            provider_id: "boxplayer".into(),
            name: email.into(),
            base_url: site.into(),
            user_id: email.to_lowercase(),
            device_id: String::new(),
            auth_origins: vec![origin],
        },
        Credentials {
            headers: Headers::from([("Authorization".into(), format!("Bearer {token}"))]),
            refresh_token: value["refreshToken"]
                .as_str()
                .filter(|v| !v.is_empty())
                .map(str::to_owned),
            provider_data: json!({"expiresAt":value["expiresAt"],"refreshExpiresAt":value["refreshExpiresAt"]}),
            ..Default::default()
        },
    ))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    account_id: String,
    is_pro: bool,
    plan: String,
    product_id: String,
    entitlement_scope: String,
    current_period_end: Option<String>,
}
pub async fn subscription(
    gateway: &Arc<Gateway>,
    accounts: &Accounts,
    id: &str,
) -> Result<Subscription, AppError> {
    subscription_at(gateway, accounts, id, &crate::provider_config::site_url()?).await
}
async fn subscription_at(
    gateway: &Arc<Gateway>,
    accounts: &Accounts,
    id: &str,
    site: &str,
) -> Result<Subscription, AppError> {
    let account = accounts
        .list()?
        .into_iter()
        .find(|a| a.id == id && a.provider_id == "boxplayer" && a.base_url == site)
        .ok_or_else(|| error("请先登录 BoxPlayer 账号"))?;
    let mut credentials = accounts.credentials(id)?;
    let bearer = |credentials: &Credentials| {
        credentials
            .headers
            .iter()
            .find(|(key, _)| key.eq_ignore_ascii_case("authorization"))
            .and_then(|(_, v)| v.strip_prefix("Bearer "))
            .map(str::to_owned)
    };
    let (mut status, mut data) = api(
        gateway,
        site,
        "/api/me/subscription",
        None,
        bearer(&credentials),
    )
    .await?;
    if status == 401 {
        let refresh = credentials
            .refresh_token
            .as_ref()
            .ok_or_else(|| error("登录已失效，请重新登录"))?;
        let (refresh_status, mut refreshed) = api(
            gateway,
            site,
            "/api/app/auth/refresh",
            Some(json!({"refreshToken":refresh})),
            None,
        )
        .await?;
        if refresh_status != 200 {
            return Err(error("登录已失效，请重新登录"));
        }
        if text(&refreshed, "email").is_empty() {
            refreshed["email"] = json!(account.name)
        }
        let (identity, mut secret) = identity(site, &refreshed)?;
        if identity.user_id != account.user_id {
            return Err(error("刷新返回了其他账号，请重新登录"));
        }
        if secret.refresh_token.is_none() {
            secret.refresh_token = credentials.refresh_token.take()
        }
        // save(existing) refuses a removed account: refresh cannot resurrect logout.
        accounts.save(account, secret)?;
        credentials = accounts.credentials(id)?;
        (status, data) = api(
            gateway,
            site,
            "/api/me/subscription",
            None,
            bearer(&credentials),
        )
        .await?;
    }
    if status != 200 {
        return Err(error(if status == 401 {
            "登录已失效，请重新登录"
        } else {
            "无法读取会员状态，请稍后重试"
        }));
    }
    // Never expose raw subscription responses (order/session fields are unnecessary).
    let is_pro = data["isPro"]
        .as_bool()
        .ok_or_else(|| error("会员状态响应无效"))?;
    let bounded = |key: &str| text(&data, key).chars().take(200).collect::<String>();
    Ok(Subscription {
        account_id: id.into(),
        is_pro,
        plan: bounded("plan"),
        product_id: bounded("productId"),
        entitlement_scope: bounded("entitlementScope"),
        current_period_end: data["currentPeriodEnd"]
            .as_str()
            .map(|v| v.chars().take(100).collect()),
    })
}
impl Sessions {
    pub fn browser_url(&self, id: &str) -> Result<String, AppError> {
        let sessions = self.0.lock().unwrap();
        let session = sessions.get(id).ok_or_else(|| error("登录会话已关闭"))?;
        if session.cancel.is_cancelled() || session.created.elapsed() >= session.expires {
            return Err(error("登录会话已过期"));
        }
        Ok(session.verification.clone())
    }
    pub fn cancel(&self, id: &str) -> bool {
        if let Some(session) = self.0.lock().unwrap().remove(id) {
            session.cancel.cancel();
            true
        } else {
            false
        }
    }
    pub async fn begin(
        &self,
        gateway: &Arc<Gateway>,
        cancel: CancellationToken,
    ) -> Result<DeviceLogin, AppError> {
        let site = crate::provider_config::site_url()?;
        self.begin_at(gateway, cancel, site).await
    }
    async fn begin_at(
        &self,
        gateway: &Arc<Gateway>,
        cancel: CancellationToken,
        site: String,
    ) -> Result<DeviceLogin, AppError> {
        let result = tokio::select! {_=cancel.cancelled()=>return Err(error("登录已取消")),result=api(gateway,&site,"/api/app/device/start",Some(json!({"platform":"desktop","sessionVersion":"2"})),None)=>result?};
        if result.0 != 200 {
            return Err(error("无法创建账号二维码，请稍后重试"));
        }
        let data = result.1;
        let code = text(&data, "deviceCode");
        let verification = url::Url::parse(text(&data, "verificationURIComplete"))
            .map_err(|_| error("账号二维码地址无效"))?;
        if code.is_empty()
            || code.len() > 4096
            || verification.origin() != url::Url::parse(&site).unwrap().origin()
            || !verification.username().is_empty()
            || verification.password().is_some()
        {
            return Err(error("账号二维码响应无效"));
        }
        let expires = data["expiresIn"].as_u64().unwrap_or(600).clamp(1, 600);
        let interval = data["interval"].as_u64().unwrap_or(5).clamp(2, 30);
        let id = uuid::Uuid::new_v4().to_string();
        let mut sessions = self.0.lock().unwrap();
        sessions.retain(|_, s| {
            let keep = s.created.elapsed() < s.expires && !s.cancel.is_cancelled();
            if !keep {
                s.cancel.cancel()
            }
            keep
        });
        if cancel.is_cancelled() {
            return Err(error("登录已取消"));
        }
        if sessions.len() >= 8 {
            return Err(error("已有过多待确认的登录"));
        }
        sessions.insert(
            id.clone(),
            Arc::new(Session {
                code: code.into(),
                site,
                verification: verification.to_string(),
                created: Instant::now(),
                expires: Duration::from_secs(expires),
                interval: Duration::from_secs(interval),
                last: Mutex::new(None),
                poll: tokio::sync::Mutex::new(()),
                cancel,
            }),
        );
        Ok(DeviceLogin {
            session_id: id,
            content: verification.into(),
            user_code: text(&data, "userCode").into(),
            expires_in: expires,
            interval,
        })
    }
    pub async fn poll(
        &self,
        gateway: &Arc<Gateway>,
        accounts: &Accounts,
        id: &str,
    ) -> Result<LoginStatus, AppError> {
        let session = self
            .0
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| error("二维码已关闭，请重新登录"))?;
        let _poll = session.poll.lock().await;
        if session.cancel.is_cancelled() || session.created.elapsed() >= session.expires {
            self.cancel(id);
            return Err(error("二维码已过期"));
        }
        {
            let mut last = session.last.lock().unwrap();
            if last.is_some_and(|time| time.elapsed() < session.interval) {
                return Ok(LoginStatus {
                    pending: true,
                    account: None,
                });
            }
            *last = Some(Instant::now());
        }
        let (status, data) = tokio::select! {_=session.cancel.cancelled()=>return Err(error("登录已取消")),result=api(gateway,&session.site,"/api/app/device/exchange",Some(json!({"deviceCode":session.code})),None)=>result?};
        if status == 428
            && matches!(
                text(&data, "error"),
                "authorization_pending" | "authorization_scanned"
            )
        {
            return Ok(LoginStatus {
                pending: true,
                account: None,
            });
        }
        if status != 200 {
            self.cancel(id);
            return Err(error("账号确认失败，请重新登录"));
        }
        let (account, credentials) = identity(&session.site, &data)?;
        // Serialize final publication with cancel; closing must not publish a late login.
        let mut sessions = self.0.lock().unwrap();
        if !sessions.contains_key(id)
            || session.cancel.is_cancelled()
            || session.created.elapsed() >= session.expires
        {
            return Err(error("登录已取消或过期"));
        }
        let account = accounts.save_login(account, credentials)?;
        sessions.remove(id);
        session.cancel.cancel();
        Ok(LoginStatus {
            pending: false,
            account: Some(account),
        })
    }
}
impl Drop for Sessions {
    fn drop(&mut self) {
        if let Ok(sessions) = self.0.lock() {
            for session in sessions.values() {
                session.cancel.cancel()
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn website_session_maps_identity_and_keeps_tokens_private() {
        let (account,secret)=identity("https://site.test",&json!({"email":"User@example.test","accessToken":"synthetic-bearer","refreshToken":"synthetic-refresh","expiresAt":"2030-01-01T00:00:00Z"})).unwrap();
        assert_eq!(account.user_id, "user@example.test");
        let public = serde_json::to_string(&account).unwrap();
        assert!(!public.contains("synthetic"));
        assert_eq!(secret.refresh_token.as_deref(), Some("synthetic-refresh"));
        assert!(identity(
            "https://site.test",
            &json!({"accessToken":"synthetic-bearer"})
        )
        .is_err());
    }
    #[tokio::test]
    async fn device_exchange_keeps_private_codes_native_and_cancellation_prevents_publication() {
        use crate::accounts::Vault;
        use axum::{routing::post, Json, Router};
        #[derive(Default)]
        struct MemoryVault(Mutex<HashMap<String, String>>);
        impl Vault for MemoryVault {
            fn put(&self, id: &str, value: &str) -> Result<(), AppError> {
                self.0.lock().unwrap().insert(id.into(), value.into());
                Ok(())
            }
            fn get(&self, id: &str) -> Result<String, AppError> {
                self.0
                    .lock()
                    .unwrap()
                    .get(id)
                    .cloned()
                    .ok_or_else(|| error("missing"))
            }
            fn remove(&self, id: &str) -> Result<(), AppError> {
                self.0.lock().unwrap().remove(id);
                Ok(())
            }
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let site = format!("http://{}", listener.local_addr().unwrap());
        let verification = format!("{site}/account/?code=PUBLIC");
        let app=Router::new().route("/api/app/device/start",post(move || {let verification=verification.clone();async move {Json(json!({"deviceCode":"synthetic-private-device","userCode":"PUBLIC","verificationURIComplete":verification,"interval":2,"expiresIn":600}))}}))
   .route("/api/app/device/exchange",post(|Json(body):Json<Value>|async move{assert_eq!(body["deviceCode"],"synthetic-private-device");Json(json!({"email":"person@example.test","accessToken":"synthetic-private-bearer","refreshToken":"synthetic-private-refresh"}))}))
   .route("/api/app/auth/refresh",post(|Json(body):Json<Value>|async move{assert_eq!(body["refreshToken"],"synthetic-private-refresh");Json(json!({"email":"person@example.test","accessToken":"synthetic-renewed","refreshToken":"synthetic-rotated"}))}))
   .route("/api/me/subscription",axum::routing::get(|headers:axum::http::HeaderMap|async move {
       let valid=headers.get("authorization").and_then(|v|v.to_str().ok())==Some("Bearer synthetic-renewed");
       (if valid{axum::http::StatusCode::OK}else{axum::http::StatusCode::UNAUTHORIZED},Json(if valid{json!({"isPro":true,"plan":"android_lifetime","entitlementScope":"android","accessToken":"synthetic-do-not-expose","orderId":"synthetic-private-order"})}else{json!({"error":"invalid_auth_token"})}))
   }));
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let gateway = Gateway::new(Arc::new(|_| Box::pin(async { Err(error("unused")) }))).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let accounts = Accounts::with_vault(dir.path(), Box::<MemoryVault>::default()).unwrap();
        let sessions = Sessions::default();
        let qr = sessions
            .begin_at(&gateway, CancellationToken::new(), site.clone())
            .await
            .unwrap();
        assert!(!serde_json::to_string(&qr)
            .unwrap()
            .contains("synthetic-private"));
        assert_eq!(sessions.browser_url(&qr.session_id).unwrap(), qr.content);
        let status = sessions
            .poll(&gateway, &accounts, &qr.session_id)
            .await
            .unwrap();
        assert!(!status.pending);
        let account = status.account.as_ref().unwrap();
        assert!(!serde_json::to_string(&status)
            .unwrap()
            .contains("synthetic-private"));
        assert_eq!(
            accounts
                .credentials(&account.id)
                .unwrap()
                .refresh_token
                .as_deref(),
            Some("synthetic-private-refresh")
        );
        let subscription = subscription_at(&gateway, &accounts, &account.id, &site)
            .await
            .unwrap();
        assert!(subscription.is_pro);
        assert_eq!(subscription.entitlement_scope, "android");
        assert!(!serde_json::to_string(&subscription)
            .unwrap()
            .contains("synthetic"));
        assert_eq!(
            accounts
                .credentials(&account.id)
                .unwrap()
                .refresh_token
                .as_deref(),
            Some("synthetic-rotated")
        );
        assert!(sessions
            .poll(&gateway, &accounts, &qr.session_id)
            .await
            .is_err());
        let cancelled = sessions
            .begin_at(&gateway, CancellationToken::new(), site.clone())
            .await
            .unwrap();
        assert!(sessions.cancel(&cancelled.session_id));
        assert!(sessions.browser_url(&cancelled.session_id).is_err());
        assert!(sessions
            .poll(&gateway, &accounts, &cancelled.session_id)
            .await
            .is_err());
        assert_eq!(accounts.list().unwrap().len(), 1);
        let token = CancellationToken::new();
        token.cancel();
        assert!(sessions.begin_at(&gateway, token, site).await.is_err());
        task.abort();
    }
}
