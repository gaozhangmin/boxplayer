//! Tianyi QR exchange and session signatures. Session secrets never enter WebViews.
use crate::{
    accounts::{Account, Accounts, Credentials},
    commands::Backend,
    gateway::{Gateway, Headers, HttpRequest, HttpResponse},
    settings::AppError,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
const API: &str = "https://api.cloud.189.cn";
const AUTH: &str = "https://open.e.189.cn";
const WEB: &str = "https://cloud.189.cn";
const RETURN: &str = "https://m.cloud.189.cn/zhuanti/2020/loginErrorPc/index.html";
const UA:&str="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
fn error(message: &str) -> AppError {
    AppError::new("CLOUD189", message, false)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string()
}
fn client() -> Result<String, AppError> {
    let (id, _) = crate::provider_config::client("189", String::new(), None);
    if id.is_empty() {
        Err(error("此开发包缺少天翼登录配置，请更新应用"))
    } else {
        Ok(id)
    }
}
fn headers() -> Headers {
    Headers::from([
        ("User-Agent".into(), UA.into()),
        ("Accept".into(), "application/json;charset=UTF-8".into()),
        ("Referer".into(), WEB.into()),
    ])
}
fn form(values: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(values.iter().copied())
        .finish()
}
fn query(values: &[(&str, &str)]) -> String {
    let random = uuid::Uuid::new_v4().as_u128();
    let random = format!(
        "{}_{}",
        random % 100000,
        (random / 100000) % 10000000000u128
    );
    let mut params = url::form_urlencoded::Serializer::new(String::new());
    params.extend_pairs([
        ("clientType", "TELEPC"),
        ("version", "6.2"),
        ("channelId", "web_cloud.189.cn"),
        ("rand", random.as_str()),
    ]);
    params.extend_pairs(values.iter().copied());
    params.finish()
}
async fn request(
    gateway: &Arc<Gateway>,
    cookie_id: &str,
    method: &str,
    url: String,
    mut headers: Headers,
    body: Option<String>,
) -> Result<HttpResponse, AppError> {
    if body.is_some() {
        headers.insert(
            "Content-Type".into(),
            "application/x-www-form-urlencoded".into(),
        );
    }
    gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "189".into(),
            account_id: cookie_id.into(),
            method: method.into(),
            url,
            headers,
            body: body.map(String::into_bytes),
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await
}
fn parse(response: HttpResponse) -> Result<Value, AppError> {
    if response.status == 401 {
        return Err(AppError::new(
            "AUTH_EXPIRED",
            "天翼会话已失效，请重新登录",
            false,
        ));
    }
    let data: Value =
        serde_json::from_slice(&response.body).map_err(|_| error("天翼响应格式无效"))?;
    if response.status != 200 {
        return Err(error("天翼服务请求失败"));
    }
    Ok(data)
}
fn string(data: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        data[*key]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .or_else(|| data[*key].as_u64().map(|n| n.to_string()))
    })
}
fn identity(data: &Value) -> Option<String> {
    string(data, &["userId", "loginName"])
}
fn credentials(data: &Value, previous: Option<String>) -> Result<Credentials, AppError> {
    let key = string(data, &["sessionKey"]).ok_or_else(|| error("天翼未返回会话密钥"))?;
    let secret = string(data, &["sessionSecret"]).ok_or_else(|| error("天翼未返回会话签名信息"))?;
    if data["res_code"]
        .as_i64()
        .or_else(|| data["res_code"].as_str().and_then(|s| s.parse().ok()))
        .is_some_and(|n| n != 0)
    {
        return Err(error("天翼会话交换失败"));
    }
    let expires = string(data, &["expiresIn", "expires_in"])
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|n| *n > 0)
        .map(|n| now().saturating_add(n));
    Ok(Credentials {
        headers: headers(),
        refresh_token: string(data, &["refreshToken"]).or(previous),
        expires_at: expires,
        provider_data: json!({"sessionKey":key,"sessionSecret":secret,"familySessionKey":string(data,&["familySessionKey"]),"familySessionSecret":string(data,&["familySessionSecret"]),"identityField":if string(data,&["userId"]).is_some(){"userId"}else{"loginName"}}),
        ..Default::default()
    })
}
fn signature(key: &str, secret: &str, method: &str, path: &str, date: &str) -> String {
    let message = format!(
        "SessionKey={key}&Operate={}&RequestURI={path}&Date={date}",
        method.to_uppercase()
    );
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY, secret.as_bytes());
    ring::hmac::sign(&key, message.as_bytes())
        .as_ref()
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect()
}
// Electron signs family batch creation with the family session, while checking
// the same task always uses the personal session. No session selector comes
// from renderer headers; derive it from the fixed endpoint and form payload.
fn family_request(request: &HttpRequest, url: &url::Url) -> Result<bool, AppError> {
    if url.path().starts_with("/family/") { return Ok(true); }
    if url.path() != "/batch/createBatchTask.action" { return Ok(false); }
    if !request.method.eq_ignore_ascii_case("POST") { return Err(error("天翼批任务必须使用POST")); }
    let content_type = request.headers.iter().find(|(name, _)| name.eq_ignore_ascii_case("content-type")).map(|(_, value)| value.split(';').next().unwrap_or("").trim());
    if content_type != Some("application/x-www-form-urlencoded") { return Err(error("天翼批任务表单类型无效")); }
    let body = request.body.as_deref().ok_or_else(|| error("天翼批任务缺少表单"))?;
    let body = std::str::from_utf8(body).map_err(|_| error("天翼批任务表单编码无效"))?;
    let families: Vec<_> = url::form_urlencoded::parse(body.as_bytes()).filter(|(key, _)| key == "familyId").map(|(_, value)| value.into_owned()).collect();
    match families.as_slice() {
        [] => Ok(false),
        [id] if !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()) => Ok(true),
        _ => Err(error("天翼批任务家庭标识无效"))
    }
}
pub fn sign_request(accounts: &Accounts, request: &mut HttpRequest) -> Result<(), AppError> {
    if request.provider_id != "189" || request.account_id.is_empty() {
        return Ok(());
    }
    let mut url = url::Url::parse(&request.url).map_err(|_| error("天翼请求地址无效"))?;
    if url.origin().ascii_serialization() != API {
        return Err(error("天翼会话只能用于官方 API"));
    }
    let existing: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(key, _)| !["clientType", "version", "channelId", "rand"].contains(&key.as_ref()))
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    url.set_query(None);
    url.query_pairs_mut()
        .extend_pairs(existing)
        .extend_pairs(url::form_urlencoded::parse(query(&[]).as_bytes()));
    let credentials = accounts.credentials(&request.account_id)?;
    let family = family_request(request, &url)?;
    let key = credentials.provider_data[if family {
        "familySessionKey"
    } else {
        "sessionKey"
    }]
    .as_str()
    .filter(|s| !s.is_empty());
    let secret = credentials.provider_data[if family {
        "familySessionSecret"
    } else {
        "sessionSecret"
    }]
    .as_str()
    .filter(|s| !s.is_empty());
    let (Some(key), Some(secret)) = (key, secret) else {
        return Err(AppError::new(
            "AUTH_EXPIRED",
            "天翼空间会话不可用，请重新登录",
            false,
        ));
    };
    let date = chrono::Utc::now()
        .format("%a, %d %b %Y %H:%M:%S GMT")
        .to_string();
    let headers = Headers::from([
        ("Date".into(), date.clone()),
        ("SessionKey".into(), key.into()),
        ("X-Request-ID".into(), uuid::Uuid::new_v4().to_string()),
        (
            "Signature".into(),
            signature(key, secret, &request.method, url.path(), &date),
        ),
    ]);
    request.url = url.into();
    for (name, value) in headers {
        request
            .headers
            .retain(|key, _| !key.eq_ignore_ascii_case(&name));
        request.headers.insert(name, value);
    }
    Ok(())
}
pub fn same_session(accounts: &Accounts, request: &HttpRequest) -> Result<bool, AppError> {
    let credentials = accounts.credentials(&request.account_id)?;
    let url = url::Url::parse(&request.url).map_err(|_| error("天翼请求地址无效"))?;
    let family = family_request(request, &url)?;
    let key = credentials.provider_data[if family {
        "familySessionKey"
    } else {
        "sessionKey"
    }]
    .as_str()
    .unwrap_or("");
    let secret = credentials.provider_data[if family {
        "familySessionSecret"
    } else {
        "sessionSecret"
    }]
    .as_str()
    .unwrap_or("");
    let date = request
        .headers
        .get("Date")
        .map(String::as_str)
        .unwrap_or("");
    Ok(!key.is_empty()
        && !secret.is_empty()
        && request
            .headers
            .get("SessionKey")
            .is_some_and(|value| value == key)
        && request.headers.get("Signature").is_some_and(|value| {
            *value == signature(key, secret, &request.method, url.path(), date)
        }))
}
pub async fn refresh(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    id: &str,
) -> Result<(), AppError> {
    let account = accounts
        .list()?
        .into_iter()
        .find(|a| a.id == id && a.provider_id == "189")
        .ok_or_else(|| error("天翼账号不存在"))?;
    let old = accounts.credentials(id)?;
    let identity_field = old.provider_data["identityField"]
        .as_str()
        .unwrap_or("userId")
        .to_owned();
    let previous = old
        .refresh_token
        .ok_or_else(|| error("天翼缺少刷新令牌，请重新登录"))?;
    let client = client()?;
    let response = request(
        gateway,
        "",
        "POST",
        format!("{AUTH}/api/oauth2/refreshToken.do"),
        headers(),
        Some(form(&[
            ("clientId", &client),
            ("refreshToken", &previous),
            ("grantType", "refresh_token"),
            ("format", "json"),
        ])),
    )
    .await?;
    let token = parse(response)?;
    let access =
        string(&token, &["accessToken"]).ok_or_else(|| error("天翼刷新失败，请重新登录"))?;
    let params = query(&[("appId", client.as_str()), ("accessToken", access.as_str())]);
    let session = parse(
        request(
            gateway,
            "",
            "GET",
            format!("{API}/getSessionForPC.action?{}", params),
            headers(),
            None,
        )
        .await?,
    )?;
    if string(&session, &[identity_field.as_str()])
        .is_some_and(|subject| subject != account.user_id)
        || string(&token, &[identity_field.as_str()])
            .is_some_and(|subject| subject != account.user_id)
    {
        return Err(error("天翼刷新返回不同账号，未保存会话"));
    }
    let mut merged = token;
    let object = merged
        .as_object_mut()
        .ok_or_else(|| error("天翼刷新响应无效"))?;
    if let Some(session) = session.as_object() {
        object.extend(session.clone())
    }
    let mut creds = credentials(&merged, Some(previous))?;
    creds.provider_data["identityField"] = identity_field.into();
    accounts.save(account, creds)?;
    Ok(())
}
fn extract(html: &str, pattern: &str) -> Result<String, AppError> {
    let re = regex::Regex::new(pattern).map_err(|_| error("天翼参数表达式无效"))?;
    let text = re
        .captures(html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str())
        .filter(|v| !v.is_empty() && v.len() <= 4096 && v.is_ascii())
        .ok_or_else(|| error("无法解析天翼登录参数，请稍后重试"))?;
    Ok(text.into())
}
fn redirect(value: &str) -> Result<(), AppError> {
    let url = url::Url::parse(value).map_err(|_| error("天翼确认地址无效"))?;
    if url.scheme() != "https"
        || !matches!(
            url.host_str(),
            Some("open.e.189.cn" | "cloud.189.cn" | "m.cloud.189.cn")
        )
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(error("天翼确认地址不属于官方服务"));
    }
    Ok(())
}
struct Cookies {
    gateway: Arc<Gateway>,
    id: String,
}
impl Drop for Cookies {
    fn drop(&mut self) {
        self.gateway.cookies.remove(&self.id)
    }
}
struct Session {
    created: Instant,
    cookies: Cookies,
    lt: String,
    req_id: String,
    param_id: String,
    uuid: String,
    encrypted: String,
    name: String,
    poll: tokio::sync::Mutex<()>,
    cancel: tokio_util::sync::CancellationToken,
}
#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Arc<Session>>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrCode {
    session_id: String,
    content: String,
}
#[derive(Serialize)]
pub struct QrStatus {
    status: &'static str,
    account: Option<Account>,
}
impl Sessions {
    pub fn cancel(&self, id: &str) -> bool {
        let session = self.0.lock().unwrap().remove(id);
        if let Some(session) = session {
            session.cancel.cancel();
            true
        } else {
            false
        }
    }
    pub async fn begin(&self, gateway: &Arc<Gateway>, name: String) -> Result<QrCode, AppError> {
        let client = client()?;
        {
            let mut map = self.0.lock().unwrap();
            map.retain(|_, session| {
                let keep = session.created.elapsed() < Duration::from_secs(300);
                if !keep {
                    session.cancel.cancel();
                }
                keep
            });
            if map.len() >= 8 {
                return Err(error("登录会话过多，请关闭旧二维码"));
            }
        }
        let cookie_id = format!("189-login-{}", uuid::Uuid::new_v4());
        gateway.cookies.ensure(&cookie_id, None)?;
        let cookies = Cookies {
            gateway: gateway.clone(),
            id: cookie_id,
        };
        let params = form(&[
            ("appId", &client),
            ("clientType", "10020"),
            ("returnURL", RETURN),
            ("timeStamp", &millis()),
        ]);
        let response = request(
            gateway,
            &cookies.id,
            "GET",
            format!("{WEB}/api/portal/unifyLoginForPC.action?{params}"),
            headers(),
            None,
        )
        .await?;
        if response.status != 200 {
            return Err(error("初始化天翼登录失败"));
        }
        let html = String::from_utf8(response.body).map_err(|_| error("天翼登录页面格式无效"))?;
        let _captcha = extract(&html, r#"'captchaToken'\s+value='(.+?)'"#)?;
        let lt = extract(&html, r#"\blt\s*=\s*"(.+?)""#)?;
        let req_id = extract(&html, r#"\breqId\s*=\s*"(.+?)""#)?;
        let param_id = extract(&html, r#"\bparamId\s*=\s*"(.+?)""#)?;
        let data = parse(
            request(
                gateway,
                &cookies.id,
                "POST",
                format!("{AUTH}/api/logbox/oauth2/getUUID.do"),
                headers(),
                Some(form(&[("appId", &client)])),
            )
            .await?,
        )?;
        let uuid = string(&data, &["uuid"])
            .filter(|s| s.len() <= 4096)
            .ok_or_else(|| error("天翼未返回二维码"))?;
        let encrypted =
            string(&data, &["encryuuid"]).ok_or_else(|| error("天翼未返回二维码状态标识"))?;
        let session_id = uuid::Uuid::new_v4().to_string();
        let mut map = self.0.lock().unwrap();
        if map.len() >= 8 {
            return Err(error("登录会话过多，请关闭旧二维码"));
        }
        map.insert(
            session_id.clone(),
            Arc::new(Session {
                created: Instant::now(),
                cookies,
                lt,
                req_id,
                param_id,
                uuid: uuid.clone(),
                encrypted,
                name,
                poll: tokio::sync::Mutex::new(()),
                cancel: tokio_util::sync::CancellationToken::new(),
            }),
        );
        Ok(QrCode {
            session_id,
            content: uuid,
        })
    }
    pub async fn poll(&self, state: &Backend, id: &str) -> Result<QrStatus, AppError> {
        let session = self
            .0
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| error("二维码已取消或失效"))?;
        tokio::select! {biased; _=session.cancel.cancelled()=>Err(error("登录已取消")), result=self.poll_inner(state,id,session.clone())=>result}
    }
    async fn poll_inner(
        &self,
        state: &Backend,
        id: &str,
        session: Arc<Session>,
    ) -> Result<QrStatus, AppError> {
        let _poll = session.poll.lock().await;
        if session.created.elapsed() >= Duration::from_secs(300) {
            self.cancel(id);
            return Ok(QrStatus {
                status: "expired",
                account: None,
            });
        }
        if !self.0.lock().unwrap().contains_key(id) {
            return Err(error("登录已取消"));
        }
        let client = client()?;
        let date = chrono::Local::now()
            .format("%Y-%m-%d%H:%M:%S%.3f")
            .to_string();
        let params = form(&[
            ("appId", &client),
            ("clientType", "10020"),
            ("returnUrl", RETURN),
            ("paramId", &session.param_id),
            ("uuid", &session.uuid),
            ("encryuuid", &session.encrypted),
            ("date", &date),
            ("timeStamp", &millis()),
            ("cb_SaveName", "0"),
            ("isOauth2", "true"),
            ("state", ""),
        ]);
        let mut h = headers();
        h.insert("Referer".into(), AUTH.into());
        h.insert("Reqid".into(), session.req_id.clone());
        h.insert("lt".into(), session.lt.clone());
        let data = parse(
            request(
                &state.gateway,
                &session.cookies.id,
                "POST",
                format!("{AUTH}/api/logbox/oauth2/qrcodeLoginState.do"),
                h,
                Some(params),
            )
            .await?,
        )?;
        let status = data["status"]
            .as_i64()
            .or_else(|| data["status"].as_str().and_then(|s| s.parse().ok()))
            .ok_or_else(|| error("天翼扫码状态无效"))?;
        if matches!(status, -106 | -11002) {
            return Ok(QrStatus {
                status: "waiting",
                account: None,
            });
        }
        if status == -11001 {
            self.cancel(id);
            return Ok(QrStatus {
                status: "expired",
                account: None,
            });
        }
        if status != 0 {
            return Err(error("天翼扫码失败，请重新生成二维码"));
        }
        let confirmed =
            string(&data, &["redirectUrl"]).ok_or_else(|| error("天翼扫码缺少确认地址"))?;
        redirect(&confirmed)?;
        let params = query(&[("redirectURL", &confirmed)]);
        let data = parse(
            request(
                &state.gateway,
                &session.cookies.id,
                "POST",
                format!("{API}/getSessionForPC.action?{}", params),
                headers(),
                None,
            )
            .await?,
        )?;
        let user = identity(&data).ok_or_else(|| error("天翼缺少稳定账号标识，未保存账号"))?;
        let creds = credentials(&data, None)?;
        if creds.refresh_token.is_none() {
            return Err(error("天翼未返回刷新令牌"));
        }
        let mut map = self.0.lock().unwrap();
        if map.remove(id).is_none() {
            return Err(error("登录已取消"));
        }
        let account = state.accounts.save_login(
            Account {
                id: String::new(),
                provider_id: "189".into(),
                name: if session.name.trim().is_empty() {
                    "天翼云盘".into()
                } else {
                    session.name.clone()
                },
                base_url: API.into(),
                user_id: user,
                device_id: String::new(),
                auth_origins: vec![API.into()],
            },
            creds,
        )?;
        Ok(QrStatus {
            status: "confirmed",
            account: Some(account),
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signature_matches_retained_hmac_sha1_vector() {
        assert_eq!(
            signature(
                "synthetic-key",
                "synthetic-secret",
                "get",
                "/listFiles.action",
                "Fri, 06 Nov 2026 12:34:56 GMT"
            ),
            "87E680C4D56280A1D001B80AE06E85A61EAC388D"
        );
    }
    #[test]
    fn html_and_redirect_boundaries() {
        assert_eq!(
            extract(r#"lt = "synthetic";"#, r#"\blt\s*=\s*"(.+?)""#).unwrap(),
            "synthetic"
        );
        assert!(extract("missing", r#"lt="(.+?)""#).is_err());
        assert!(redirect("https://open.e.189.cn/confirmed?code=synthetic").is_ok());
        assert!(redirect("https://open.e.189.cn.evil.test/confirmed").is_err());
        assert!(redirect("http://cloud.189.cn/confirmed").is_err());
    }
    #[test]
    fn credentials_retain_both_spaces_and_refresh_without_public_secrets() {
        let creds=credentials(&json!({"sessionKey":"personal-key","sessionSecret":"personal-secret","familySessionKey":"family-key","familySessionSecret":"family-secret","expiresIn":3600}),Some("previous".into())).unwrap();
        assert_eq!(creds.provider_data["familySessionKey"], "family-key");
        assert_eq!(creds.refresh_token.as_deref(), Some("previous"));
        assert!(!creds.headers.values().any(|v| v.contains("secret")));
        assert!(credentials(&json!({"sessionKey":"incomplete"}), None).is_err());
    }
}

#[cfg(test)]
mod account_tests {
    use super::*;
    #[derive(Default)]
    struct MemoryVault(Mutex<HashMap<String, String>>);
    impl crate::accounts::Vault for MemoryVault {
        fn put(&self, key: &str, value: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().insert(key.into(), value.into());
            Ok(())
        }
        fn get(&self, key: &str) -> Result<String, AppError> {
            self.0
                .lock()
                .unwrap()
                .get(key)
                .cloned()
                .ok_or_else(|| error("test entry missing"))
        }
        fn remove(&self, key: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }
    #[test]
    fn private_space_signatures_override_callers_without_exposing_session_keys() {
        let dir = tempfile::tempdir().unwrap();
        let accounts = Accounts::with_vault(dir.path(), Box::<MemoryVault>::default()).unwrap();
        let creds=credentials(&json!({"userId":42,"sessionKey":"personal-key","sessionSecret":"personal-secret","familySessionKey":"family-key","familySessionSecret":"family-secret","refreshToken":"synthetic-refresh"}),None).unwrap();
        let account = accounts
            .save_login(
                Account {
                    id: String::new(),
                    provider_id: "189".into(),
                    name: "test".into(),
                    base_url: API.into(),
                    user_id: "42".into(),
                    device_id: String::new(),
                    auth_origins: vec![API.into()],
                },
                creds,
            )
            .unwrap();
        assert!(!serde_json::to_string(&account).unwrap().contains("secret"));
        for (path, key, secret) in [
            ("/listFiles.action", "personal-key", "personal-secret"),
            (
                "/family/file/listFiles.action",
                "family-key",
                "family-secret",
            ),
        ] {
            let mut request = HttpRequest {
                request_id: "synthetic".into(),
                provider_id: "189".into(),
                account_id: account.id.clone(),
                method: "GET".into(),
                url: format!("{API}{path}?folderId=9007199254740997"),
                headers: Headers::from([
                    ("SESSIONKEY".into(), "caller-key".into()),
                    ("SIGNATURE".into(), "caller-signature".into()),
                ]),
                body: None,
                timeout_ms: None,
                proxy: None,
            };
            accounts.authorize(&mut request).unwrap();
            sign_request(&accounts, &mut request).unwrap();
            assert_eq!(request.headers["SessionKey"], key);
            assert_eq!(
                request.headers["Signature"],
                signature(key, secret, "GET", path, &request.headers["Date"])
            );
            assert!(!request.headers.contains_key("SESSIONKEY"));
            assert!(same_session(&accounts, &request).unwrap());
            let mut updated = accounts.credentials(&account.id).unwrap();
            updated.provider_data[if path.starts_with("/family/") {
                "familySessionSecret"
            } else {
                "sessionSecret"
            }] = "rotated-secret".into();
            accounts.save(account.clone(), updated).unwrap();
            assert!(!same_session(&accounts, &request).unwrap());
            let url = url::Url::parse(&request.url).unwrap();
            let params: HashMap<_, _> = url.query_pairs().into_owned().collect();
            assert_eq!(params["folderId"], "9007199254740997");
            assert_eq!(params["clientType"], "TELEPC");
            assert!(regex::Regex::new(r"^\d+_\d+$")
                .unwrap()
                .is_match(&params["rand"]));
        }
    }
    #[test]
    fn family_batch_creation_and_personal_polling_use_correct_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let accounts = Accounts::with_vault(dir.path(), Box::<MemoryVault>::default()).unwrap();
        let creds=credentials(&json!({"sessionKey":"personal-key","sessionSecret":"personal-secret","familySessionKey":"family-key","familySessionSecret":"family-secret"}),None).unwrap();
        let account=accounts.save_login(Account { id:String::new(),provider_id:"189".into(),name:"batch".into(),base_url:API.into(),user_id:"42".into(),device_id:String::new(),auth_origins:vec![API.into()] },creds).unwrap();
        for (path, body, expected) in [
            ("/batch/createBatchTask.action", "type=MOVE&familyId=9007199254740999", "family-key"),
            ("/batch/createBatchTask.action", "type=MOVE", "personal-key"),
            ("/batch/checkBatchTask.action", "type=MOVE&taskId=9007199254740997", "personal-key"),
        ] {
            let mut request=HttpRequest { request_id:"batch-fixture".into(),provider_id:"189".into(),account_id:account.id.clone(),method:"POST".into(),url:format!("{API}{path}"),headers:Headers::from([("Content-Type".into(),"application/x-www-form-urlencoded".into())]),body:Some(body.as_bytes().to_vec()),timeout_ms:None,proxy:None };
            accounts.authorize(&mut request).unwrap();
            sign_request(&accounts,&mut request).unwrap();
            assert_eq!(request.headers["SessionKey"],expected);
            assert!(same_session(&accounts,&request).unwrap());
            let mut changed=request.clone();
            changed.body=Some(b"type=MOVE&familyId=123".to_vec());
            if path.ends_with("createBatchTask.action") && expected=="personal-key" { assert!(!same_session(&accounts,&changed).unwrap()); }
        }
        let url=url::Url::parse(&format!("{API}/batch/createBatchTask.action")).unwrap();
        for body in ["familyId=", "familyId=1&familyId=2", "familyId=abc"] {
            let request=HttpRequest { request_id:"invalid".into(),provider_id:"189".into(),account_id:account.id.clone(),method:"POST".into(),url:url.to_string(),headers:Headers::from([("Content-Type".into(),"application/x-www-form-urlencoded".into())]),body:Some(body.as_bytes().to_vec()),timeout_ms:None,proxy:None };
            assert!(family_request(&request,&url).is_err());
        }
    }
    #[tokio::test]
    async fn cancelling_qr_removes_its_cookie_jar() {
        let gateway = Gateway::new(Arc::new(|_| {
            Box::pin(async { Err(error("unused test refresh")) })
        }))
        .unwrap();
        gateway.cookies.ensure("qr-test", None).unwrap();
        let sessions = Sessions::default();
        sessions.0.lock().unwrap().insert(
            "id".into(),
            Arc::new(Session {
                created: Instant::now(),
                cookies: Cookies {
                    gateway: gateway.clone(),
                    id: "qr-test".into(),
                },
                lt: String::new(),
                req_id: String::new(),
                param_id: String::new(),
                uuid: String::new(),
                encrypted: String::new(),
                name: String::new(),
                poll: tokio::sync::Mutex::new(()),
                cancel: tokio_util::sync::CancellationToken::new(),
            }),
        );
        assert!(sessions.cancel("id"));
        assert!(gateway.cookies.client("qr-test").is_none());
    }
    #[tokio::test]
    #[ignore = "Contacts official anonymous Tianyi QR endpoints; no real account login"]
    async fn official_anonymous_qr_can_be_created_and_cancelled() {
        let gateway = Gateway::new(Arc::new(|_| {
            Box::pin(async { Err(error("unused test refresh")) })
        }))
        .unwrap();
        let sessions = Sessions::default();
        let qr = sessions
            .begin(&gateway, "anonymous check".into())
            .await
            .unwrap();
        assert!(!qr.content.is_empty());
        assert!(sessions.cancel(&qr.session_id));
    }
}
