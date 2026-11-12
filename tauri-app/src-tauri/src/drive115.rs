//! 115 device authorization protocol adapted from Electron utils/drive115.ts.
use crate::{
    accounts::{Account, Credentials, OAuthSecret},
    commands::Backend,
    gateway::{Headers, HttpRequest, ResolvedMedia},
    settings::AppError,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
const API: &str = "https://proapi.115.com";
const REFRESH: &str = "https://passportapi.115.com/open/refreshToken";
pub const DOWN_AGENT:&str="Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) aDrive/4.12.0 Chrome/108.0.5359.215 Electron/22.3.24 Safari/537.36";
fn error(message: &str) -> AppError {
    AppError::new("DRIVE115", message, false)
}
struct Session {
    created: Instant,
    uid: String,
    time: String,
    sign: String,
    verifier: String,
    client_id: String,
    client_secret: Option<String>,
    name: String,
    poll: tokio::sync::Mutex<()>,
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
#[serde(rename_all = "camelCase")]
pub struct QrStatus {
    status: &'static str,
    account: Option<Account>,
}
fn scalar(v: &serde_json::Value) -> String {
    v.as_str().map(str::to_owned).unwrap_or_else(|| {
        if v.is_number() {
            v.to_string()
        } else {
            String::new()
        }
    })
}
fn profile_identity(data: &serde_json::Value) -> Result<(String, String), AppError> {
    if data["code"].as_i64() != Some(0) || data["state"].as_bool() == Some(false) {
        return Err(error("115 身份查询失败"));
    }
    let info = &data["data"];
    let subject = scalar(&info["user_id"]);
    if subject.is_empty()
        || subject.len() > 128
        || !subject.bytes().all(|c| c.is_ascii_digit())
        || subject == "0"
    {
        return Err(error("115 未返回稳定账号身份，请重新登录"));
    }
    Ok((
        subject,
        info["user_name"]
            .as_str()
            .unwrap_or("115")
            .chars()
            .take(200)
            .collect(),
    ))
}
pub async fn verified_identity(
    gateway: &Arc<crate::gateway::Gateway>,
    credentials: &Credentials,
) -> Result<(String, String), AppError> {
    let response = gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "115".into(),
            account_id: String::new(),
            method: "GET".into(),
            url: format!("{API}/open/user/info"),
            headers: credentials.headers.clone(),
            body: None,
            timeout_ms: Some(15000),
            proxy: None,
        })
        .await?;
    if response.status != 200
        || url::Url::parse(&response.final_url)
            .ok()
            .map(|u| u.origin().ascii_serialization())
            != Some(API.into())
    {
        return Err(error("115 身份查询失败"));
    }
    let data = serde_json::from_slice(&response.body).map_err(|_| error("115 身份响应无效"))?;
    profile_identity(&data)
}
async fn api(
    state: &Backend,
    method: &str,
    url: String,
    account_id: &str,
    body: Option<String>,
) -> Result<serde_json::Value, AppError> {
    let mut headers = Headers::new();
    if body.is_some() {
        headers.insert(
            "Content-Type".into(),
            "application/x-www-form-urlencoded".into(),
        );
    }
    let response = state
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "115".into(),
            account_id: account_id.into(),
            method: method.into(),
            url,
            headers,
            body: body.map(String::into_bytes),
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    if response.status != 200 {
        return Err(error("115 接口请求失败，请稍后重试"));
    }
    let data: serde_json::Value =
        serde_json::from_slice(&response.body).map_err(|_| error("115 响应格式无效"))?;
    if data["error"].as_bool() == Some(true)
        || data["errno"].as_i64().is_some_and(|c| c != 0)
        || data["code"].as_i64().is_some_and(|c| c != 0)
    {
        return Err(error("115 接口返回错误，请重新登录或稍后重试"));
    }
    Ok(data)
}
impl Sessions {
    pub async fn begin(
        &self,
        state: &Backend,
        client_id: String,
        client_secret: Option<String>,
        name: String,
    ) -> Result<QrCode, AppError> {
        let (client_id, client_secret) =
            crate::provider_config::client("115", client_id, client_secret);
        if client_id.trim().is_empty() {
            return Err(error("此开发包缺少 115 登录配置，请更新应用或联系开发者"));
        }
        {
            let mut sessions = self.0.lock().unwrap();
            sessions.retain(|_, s| s.created.elapsed() < Duration::from_secs(300));
            if sessions.len() >= 8 {
                return Err(error("请先关闭其他扫码登录"));
            }
        }
        let verifier = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let form = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs([
                ("client_id", client_id.trim()),
                ("code_challenge", challenge.as_str()),
                ("code_challenge_method", "sha256"),
            ])
            .finish();
        let data = api(
            state,
            "POST",
            "https://passportapi.115.com/open/authDeviceCode".into(),
            "",
            Some(form),
        )
        .await?;
        let uid = scalar(&data["data"]["uid"]);
        let content = scalar(&data["data"]["qrcode"]);
        if uid.is_empty() || content.is_empty() {
            return Err(error("115 未返回扫码信息"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let session = Session {
            created: Instant::now(),
            uid,
            time: scalar(&data["data"]["time"]),
            sign: scalar(&data["data"]["sign"]),
            verifier,
            client_id: client_id.trim().into(),
            client_secret,
            name,
            poll: tokio::sync::Mutex::new(()),
        };
        self.0.lock().unwrap().insert(id.clone(), Arc::new(session));
        Ok(QrCode {
            session_id: id,
            content,
        })
    }
    pub fn cancel(&self, id: &str) -> bool {
        self.0.lock().unwrap().remove(id).is_some()
    }
    pub async fn poll(&self, state: &Backend, id: &str) -> Result<QrStatus, AppError> {
        let session = self
            .0
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| error("二维码已关闭或失效"))?;
        let _poll = session.poll.lock().await;
        if session.created.elapsed() > Duration::from_secs(300) {
            self.cancel(id);
            return Ok(QrStatus {
                status: "expired",
                account: None,
            });
        }
        let q = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs([
                ("uid", session.uid.as_str()),
                ("time", session.time.as_str()),
                ("sign", session.sign.as_str()),
            ])
            .finish();
        let data = api(
            state,
            "GET",
            format!("https://qrcodeapi.115.com/get/status/?{}", q),
            "",
            None,
        )
        .await?;
        let status = data["data"]["status"].as_i64().unwrap_or(0);
        if matches!(status, -1 | -2) {
            self.cancel(id);
            return Ok(QrStatus {
                status: "expired",
                account: None,
            });
        }
        if status != 2 {
            return Ok(QrStatus {
                status: if status == 1 { "scanned" } else { "waiting" },
                account: None,
            });
        }
        let form = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs([
                ("uid", session.uid.as_str()),
                ("code_verifier", session.verifier.as_str()),
            ])
            .finish();
        let data = api(
            state,
            "POST",
            "https://passportapi.115.com/open/deviceCodeToToken".into(),
            "",
            Some(form),
        )
        .await?;
        let payload = data.get("data").unwrap_or(&data);
        let token = payload["access_token"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("115 未返回访问令牌"))?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let credentials = Credentials {
            provider_data: Default::default(),
            query: Default::default(),
            cookie_store: None,
            headers: Headers::from([("Authorization".into(), format!("Bearer {}", token))]),
            refresh_token: payload["refresh_token"].as_str().map(str::to_owned),
            expires_at: payload["expires_in"]
                .as_u64()
                .map(|s| now + s.saturating_sub(60)),
            oauth: Some(OAuthSecret {
                client_id: session.client_id.clone(),
                client_secret: session.client_secret.clone(),
                token_url: REFRESH.into(),
            }),
        };
        let (subject, display) = verified_identity(&state.gateway, &credentials).await?;
        let claimed = scalar(&payload["user_id"]);
        if !claimed.is_empty() && claimed != subject {
            return Err(error("115 令牌与账号身份不一致"));
        }
        let mut sessions = self.0.lock().unwrap();
        if !sessions.contains_key(id) || session.created.elapsed() > Duration::from_secs(300) {
            return Err(error("扫码登录已取消"));
        }
        let account = state.accounts.save_login(
            Account {
                id: String::new(),
                provider_id: "115".into(),
                name: if session.name.is_empty() {
                    display
                } else {
                    session.name.clone()
                },
                base_url: API.into(),
                user_id: subject,
                device_id: String::new(),
                auth_origins: vec![API.into()],
            },
            credentials,
        )?;
        sessions.remove(id);
        Ok(QrStatus {
            status: "confirmed",
            account: Some(account),
        })
    }
}
pub async fn resolve(
    state: &Backend,
    account_id: &str,
    file_id: &str,
) -> Result<ResolvedMedia, AppError> {
    let account = state
        .accounts
        .list()?
        .into_iter()
        .find(|a| a.id == account_id && a.provider_id == "115")
        .ok_or_else(|| error("115 账号不存在"))?;
    let query = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("file_id", file_id)
        .finish();
    let detail = api(
        state,
        "GET",
        format!("{}/open/folder/get_info?{}", API, query),
        account_id,
        None,
    )
    .await?;
    let pick = detail["data"]["pick_code"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("115 文件缺少提取码"))?;
    let body = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("pick_code", pick)
        .finish();
    let mut request = HttpRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        provider_id: "115".into(),
        account_id: account_id.into(),
        method: "POST".into(),
        url: format!("{}/open/ufile/downurl", API),
        headers: Headers::from([
            (
                "Content-Type".into(),
                "application/x-www-form-urlencoded".into(),
            ),
            ("User-Agent".into(), DOWN_AGENT.into()),
        ]),
        body: Some(body.into_bytes()),
        timeout_ms: Some(30000),
        proxy: None,
    };
    let response = state.request(request.clone()).await?;
    if response.status != 200 {
        return Err(error("115 取链失败"));
    }
    let data: serde_json::Value =
        serde_json::from_slice(&response.body).map_err(|_| error("115 取链响应无效"))?;
    if data["code"].as_i64() != Some(0) {
        return Err(error("115 取链返回错误"));
    }
    let info = data["data"]
        .as_object()
        .and_then(|m| m.values().next())
        .ok_or_else(|| error("115 未返回下载信息"))?;
    let url = info["url"]["url"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("115 未返回下载地址"))?;
    let parsed = url::Url::parse(url).map_err(|_| error("115 下载地址无效"))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err(error("115 下载地址无效"));
    }
    // Retrieve current auth after any token refresh performed while obtaining the link.
    state.accounts.authorize(&mut request)?;
    let headers = request
        .headers
        .into_iter()
        .filter(|(name, _)| {
            name.eq_ignore_ascii_case("authorization") || name.eq_ignore_ascii_case("user-agent")
        })
        .collect();
    state.prepared_media.insert(ResolvedMedia {
        schema_version: 1,
        source_id: account.id.clone(),
        account_id: account.id,
        file_id: file_id.into(),
        url: parsed.into(),
        headers,
        expires_at: None,
    })
}

#[cfg(test)]
mod identity_tests {
    use super::*;
    #[test]
    fn profile_requires_server_identity_and_preserves_large_numeric_ids() {
        let profile = serde_json::json!({"code":0,"data":{"user_id":18446744073709551614u64,"user_name":"测试"}});
        assert_eq!(
            profile_identity(&profile).unwrap(),
            ("18446744073709551614".into(), "测试".into())
        );
        for data in [
            serde_json::json!({"code":0,"data":{"user_name":"name only"}}),
            serde_json::json!({"code":401,"data":{"user_id":"123"}}),
            serde_json::json!({"code":0,"data":{"user_id":"0"}}),
            serde_json::json!({"code":0,"data":{"user_id":"token-hash"}}),
        ] {
            assert!(profile_identity(&data).is_err());
        }
    }
}
