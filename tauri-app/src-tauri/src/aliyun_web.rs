//! Web-account credential boundary and secp256k1 device signing for the retained Aliyun TS protocol.
use crate::{
    accounts::{Account, Accounts, Credentials, OAuthSecret},
    gateway::{Gateway, Headers, HttpRequest, HttpResponse},
    settings::AppError,
};
use k256::ecdsa::{signature::hazmat::PrehashSigner, Signature, SigningKey};
use ring::rand::SecureRandom;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{WebviewUrl, WebviewWindowBuilder};
const API: &str = "https://api.aliyundrive.com";
const REFRESH: &str = "https://auth.aliyundrive.com/v2/account/token";
const CLIENT: &str = "25dzX3vbYqktVxyX";
fn error(message: &str) -> AppError {
    AppError::new("ALIYUN_WEB", message, false)
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn hex(value: &[u8]) -> String {
    value.iter().map(|b| format!("{b:02x}")).collect()
}
#[derive(Serialize, Deserialize)]
struct Device {
    private_key: Vec<u8>,
    session_expires: u64,
    #[serde(flatten)]
    extra: serde_json::Map<String, serde_json::Value>,
}
fn signing_key() -> Result<SigningKey, AppError> {
    loop {
        let mut key = [0u8; 32];
        ring::rand::SystemRandom::new()
            .fill(&mut key)
            .map_err(|_| error("无法生成设备签名密钥"))?;
        if let Ok(key) = SigningKey::from_slice(&key) {
            return Ok(key);
        }
    }
}
fn device_headers(
    key: &SigningKey,
    subject: &str,
    device: &str,
) -> Result<(String, String), AppError> {
    let digest = Sha256::digest(format!(":{device}:{subject}:0").as_bytes());
    let signature: Signature = key
        .sign_prehash(&digest)
        .map_err(|_| error("设备签名失败"))?;
    Ok((
        hex(key.verifying_key().to_encoded_point(false).as_bytes()),
        format!("{}01", hex(&signature.to_bytes())),
    ))
}
async fn post(
    gateway: &Arc<Gateway>,
    endpoint: &str,
    body: serde_json::Value,
    mut headers: Headers,
) -> Result<serde_json::Value, AppError> {
    headers.insert("Content-Type".into(), "application/json".into());
    let response = gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "aliyun".into(),
            account_id: String::new(),
            method: "POST".into(),
            url: endpoint.into(),
            headers,
            body: Some(serde_json::to_vec(&body).unwrap()),
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    parse_response(response)
}
fn parse_response(response: HttpResponse) -> Result<serde_json::Value, AppError> {
    if response.status == 401 {
        return Err(AppError::new("AUTH_EXPIRED", "阿里访问令牌已失效", false));
    }
    let value: serde_json::Value =
        serde_json::from_slice(&response.body).map_err(|_| error("阿里网页登录响应无效"))?;
    if matches!(
        value["code"].as_str(),
        Some("AccessTokenExpired" | "InvalidAccessToken" | "AccessTokenInvalid")
    ) {
        return Err(AppError::new("AUTH_EXPIRED", "阿里访问令牌已失效", false));
    }
    if response.status != 200 || value.get("code").is_some() || value.get("error").is_some() {
        return Err(error("阿里网页认证失败，请重新登录或稍后重试"));
    }
    Ok(value)
}

fn token_value<'a>(data: &'a serde_json::Value) -> &'a serde_json::Value {
    data.get("token_info")
        .or_else(|| data.get("tokenInfo"))
        .unwrap_or(data)
}
fn string(data: &serde_json::Value, snake: &str, camel: &str) -> Option<String> {
    data.get(snake)
        .or_else(|| data.get(camel))
        .and_then(|v| {
            v.as_str()
                .map(str::to_owned)
                .or_else(|| v.as_u64().map(|n| n.to_string()))
        })
        .filter(|s| !s.is_empty())
}
fn apply_token(creds: &mut Credentials, data: &serde_json::Value) -> Result<(), AppError> {
    let value = token_value(data);
    let access = string(value, "access_token", "accessToken")
        .ok_or_else(|| error("登录响应缺少访问令牌"))?;
    creds
        .headers
        .insert("Authorization".into(), format!("Bearer {access}"));
    creds.refresh_token =
        string(value, "refresh_token", "refreshToken").or(creds.refresh_token.take());
    let expires = value
        .get("expires_in")
        .or_else(|| value.get("expiresIn"))
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
        })
        .unwrap_or(7200);
    creds.expires_at = Some(now().saturating_add(expires.saturating_sub(60)));
    Ok(())
}
fn callback_code(url: &url::Url, state: &str) -> Option<Result<String, AppError>> {
    if url.origin().ascii_serialization() != "https://www.aliyundrive.com"
        || url.path() != "/sign/callback"
    {
        return None;
    }
    let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    let returned = query
        .get("state")
        .and_then(|v| serde_json::from_str::<serde_json::Value>(v).ok());
    if returned.as_ref().and_then(|v| v["boxplayerState"].as_str()) != Some(state) {
        return Some(Err(error("登录回调状态不匹配，请重试")));
    }
    Some(
        query
            .get("code")
            .filter(|s| !s.is_empty())
            .cloned()
            .ok_or_else(|| error("登录回调缺少授权码")),
    )
}
pub async fn login(app:&tauri::AppHandle,accounts:&Accounts,gateway:&Arc<Gateway>,name:String)->Result<Account,AppError>{let(account,credentials)=prepare_login(app,gateway,name).await?;accounts.save_login(account,credentials)}
pub(crate) async fn prepare_login(app:&tauri::AppHandle,gateway:&Arc<Gateway>,name:String)->Result<(Account,Credentials),AppError>{
    let state = uuid::Uuid::new_v4().to_string();
    let mut login = url::Url::parse("https://auth.aliyundrive.com/v2/oauth/authorize").unwrap();
    login.query_pairs_mut().extend_pairs([
        ("login_type", "custom"),
        ("response_type", "code"),
        ("redirect_uri", "https://www.aliyundrive.com/sign/callback"),
        ("client_id", CLIENT),
        (
            "state",
            &serde_json::json!({"origin":"https://www.aliyundrive.com/","boxplayerState":state})
                .to_string(),
        ),
    ]);
    let (send, receive) = tokio::sync::oneshot::channel();
    let send = Arc::new(Mutex::new(Some(send)));
    let navigation = send.clone();
    let label = format!("ali-login-{}", uuid::Uuid::new_v4());
    // This remote, incognito label is not matched by any local-window capability.
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(login))
        .title("阿里云盘登录")
        .inner_size(520., 700.)
        .incognito(true)
        .on_navigation(move |url| {
            if let Some(result) = callback_code(url, &state) {
                if let Some(send) = navigation.lock().unwrap().take() {
                    let _ = send.send(result);
                }
                return false;
            }
            matches!(url.scheme(), "https" | "about")
        })
        .build()
        .map_err(|_| error("无法打开阿里登录窗口"))?;
    struct Guard(tauri::WebviewWindow);
    impl Drop for Guard {
        fn drop(&mut self) {
            let _ = self.0.destroy();
        }
    }
    let _guard = Guard(window.clone());
    let closed = send.clone();
    let window_closed = tokio_util::sync::CancellationToken::new();
    let close_signal = window_closed.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            close_signal.cancel();
            if let Some(send) = closed.lock().unwrap().take() {
                let _ = send.send(Err(error("登录窗口已关闭")));
            }
        }
    });
    let code = tokio::time::timeout(Duration::from_secs(300), receive)
        .await
        .map_err(|_| error("登录超时，请重试"))?
        .map_err(|_| error("登录已取消"))??;
    let endpoint = format!("{API}/token/get");
    let exchange = post(
        gateway,
        &endpoint,
        serde_json::json!({"code":code}),
        Headers::new(),
    );
    let data = tokio::select! { result=exchange=>result?, _=window_closed.cancelled()=>return Err(error("登录窗口已关闭")) };
    let value = token_value(&data);
    let subject =
        string(value, "user_id", "userId").ok_or_else(|| error("阿里网页登录缺少稳定账号标识"))?;
    let key = signing_key()?;
    let device_id = uuid::Uuid::new_v4().to_string();
    let (_, signature) = device_headers(&key, &subject, &device_id)?;
    let mut creds = Credentials {
        headers: Headers::from([
            ("x-device-id".into(), device_id.clone()),
            ("x-signature".into(), signature),
        ]),
        oauth: Some(OAuthSecret {
            client_id: CLIENT.into(),
            client_secret: None,
            token_url: REFRESH.into(),
        }),
        provider_data: serde_json::to_value(Device {
            private_key: key.to_bytes().to_vec(),
            session_expires: 0,
            extra: Default::default(),
        })
        .unwrap(),
        ..Default::default()
    };
    apply_token(&mut creds, &data)?;
    if window_closed.is_cancelled() {
        return Err(error("登录窗口已关闭"));
    }
    let account = Account {
            id: String::new(),
            provider_id: "aliyun".into(),
            name: if name.is_empty() {
                string(value, "user_name", "userName").unwrap_or("阿里云盘".into())
            } else {
                name
            },
            base_url: API.into(),
            user_id: subject,
            device_id,
            auth_origins: vec![
                API.into(),
                "https://user.aliyundrive.com".into(),
                "https://member.aliyundrive.com".into(),
            ],
        };
    // Two-step login keeps this credential pair native and unpublished until OpenAPI confirms.
    Ok((account,creds))
}
pub async fn refresh(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    account_id: &str,
) -> Result<(), AppError> {
    let account = accounts
        .list()?
        .into_iter()
        .find(|a| a.id == account_id && a.provider_id == "aliyun")
        .ok_or_else(|| error("阿里网页账号不存在"))?;
    let mut creds = accounts.credentials(account_id)?;
    let token = creds
        .refresh_token
        .as_deref()
        .ok_or_else(|| error("请重新登录阿里云盘"))?;
    let data = post(
        gateway,
        REFRESH,
        serde_json::json!({"grant_type":"refresh_token","refresh_token":token}),
        Headers::new(),
    )
    .await?;
    if let Some(subject) = string(token_value(&data), "user_id", "userId") {
        if subject != account.user_id {
            return Err(error("刷新响应账号不匹配"));
        }
    }
    apply_token(&mut creds, &data)?;
    if let Ok(mut device) = serde_json::from_value::<Device>(creds.provider_data.clone()) {
        device.session_expires = 0;
        creds.provider_data = serde_json::to_value(device).unwrap();
    }

    accounts.save(account, creds)?;
    Ok(())
}
pub async fn ensure_session(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    account_id: &str,
    force: bool,
) -> Result<(), AppError> {
    let account = accounts
        .list()?
        .into_iter()
        .find(|a| a.id == account_id && a.provider_id == "aliyun")
        .ok_or_else(|| error("阿里网页账号不存在"))?;
    let mut creds = accounts.credentials(account_id)?;
    if creds.expires_at.is_some_and(|n| n <= now()) {
        refresh(accounts, gateway, account_id).await?;
        creds = accounts.credentials(account_id)?;
    }
    let mut device: Device = serde_json::from_value(creds.provider_data.clone())
        .map_err(|_| error("设备签名配置缺失，请重新登录"))?;
    if !force && device.session_expires > now() {
        return Ok(());
    }
    let key = SigningKey::from_slice(&device.private_key)
        .map_err(|_| error("设备密钥无效，请重新登录"))?;
    let (public, signature) = device_headers(&key, &account.user_id, &account.device_id)?;
    creds.headers.insert("x-signature".into(), signature);
    creds
        .headers
        .insert("x-device-id".into(), account.device_id.clone());
    let endpoint = format!("{API}/users/v1/users/device/create_session");
    let payload = serde_json::json!({"deviceName":"BoxPlayer Desktop","modelName":"桌面网页版","pubKey":public});
    let created = post(gateway, &endpoint, payload.clone(), creds.headers.clone()).await;
    match created {
        Err(ref failure) if failure.code == "AUTH_EXPIRED" => {
            refresh(accounts, gateway, account_id).await?;
            creds = accounts.credentials(account_id)?;
            post(gateway, &endpoint, payload, creds.headers.clone()).await?;
        }
        other => {
            other?;
        }
    }
    device.session_expires = now() + 29 * 60;
    creds.provider_data = serde_json::to_value(device).unwrap();
    accounts.save(account, creds)?;
    Ok(())
}
pub fn needs_session(response: &HttpResponse) -> bool {
    serde_json::from_slice::<serde_json::Value>(&response.body)
        .ok()
        .is_some_and(|v| {
            matches!(
                v["code"].as_str(),
                Some(
                    "UserDeviceIllegality" | "UserDeviceOffline" | "DeviceSessionSignatureInvalid"
                )
            )
        })
}
#[cfg(test)]
mod tests {
    use super::*;
    use k256::ecdsa::signature::hazmat::PrehashVerifier;
    #[test]
    fn device_signature_is_bound_to_subject_and_device() {
        let key = signing_key().unwrap();
        let (public, signature) = device_headers(&key, "subject-a", "device-a").unwrap();
        assert_eq!(public.len(), 130);
        assert_eq!(&public[..2], "04");
        assert_eq!(signature.len(), 130);
        let (_, other) = device_headers(&key, "subject-b", "device-a").unwrap();
        assert_ne!(signature, other);
        let signature: Signature = key
            .sign_prehash(&Sha256::digest(b":device-a:subject-a:0"))
            .unwrap();
        assert!(key
            .verifying_key()
            .verify_prehash(&Sha256::digest(b":device-a:subject-a:0"), &signature)
            .is_ok());
        assert!(key
            .verifying_key()
            .verify_prehash(&Sha256::digest(b":device-b:subject-a:0"), &signature)
            .is_err());
    }
    #[test]
    fn signing_matches_the_retained_secp256k1_sdk_vector() {
        let mut device: Device=serde_json::from_value(serde_json::json!({"private_key":[1,2,3],"session_expires":42,"autoSignDate":"2026-11-07"})).unwrap();
        device.session_expires = 0;
        let saved = serde_json::to_value(device).unwrap();
        assert_eq!(saved["autoSignDate"], "2026-11-07");
        assert_eq!(saved["session_expires"], 0);
        let key = SigningKey::from_slice(&[1u8; 32]).unwrap();
        let (public, signature) = device_headers(&key, "subject-a", "device-a").unwrap();
        assert_eq!(public,"041b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f70beaf8f588b541507fed6a642c5ab42dfdf8120a7f639de5122d47a69a8e8d1");
        assert_eq!(signature,"0e7ee17e1f5779ba1e3a5d4c89a7a6e1cc273ac0d3a023c3acbc890ff5f5d12066209162bf67efa00df6c9dff65955465b4192bcfa956949d4124906dfb530d401");
    }
    #[test]
    fn remote_login_window_is_outside_local_ipc_capabilities() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/desktop.json")).unwrap();
        let labels: Vec<_> = capability["windows"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();
        assert_eq!(labels, vec!["main", "settings", "player"]);
        assert!(capability.get("remote").is_none());
    }
    #[test]
    fn web_token_shapes_keep_refresh_and_private_device_state() {
        let mut credentials = Credentials {
            refresh_token: Some("retained-refresh".into()),
            provider_data: serde_json::json!({"private_key":[1,2,3],"session_expires":123}),
            ..Default::default()
        };
        apply_token(&mut credentials,&serde_json::json!({"tokenInfo":{"accessToken":"synthetic-new","expiresIn":"3600","userId":"subject"}})).unwrap();
        assert_eq!(credentials.headers["Authorization"], "Bearer synthetic-new");
        assert_eq!(
            credentials.refresh_token.as_deref(),
            Some("retained-refresh")
        );
        assert_eq!(credentials.provider_data["session_expires"], 123);
        assert!(credentials.expires_at.unwrap() > now() + 3500);
        assert_eq!(
            string(
                token_value(&serde_json::json!({"token_info":{"user_id":123}})),
                "user_id",
                "userId"
            )
            .as_deref(),
            Some("123")
        );
    }
    #[test]
    fn token_expiration_is_distinct_from_device_session_expiration() {
        let response = |status, body: &str| HttpResponse {
            status,
            headers: Headers::new(),
            body: body.as_bytes().to_vec(),
            final_url: String::new(),
        };
        assert_eq!(
            parse_response(response(401, "not-json")).unwrap_err().code,
            "AUTH_EXPIRED"
        );
        assert_eq!(
            parse_response(response(400, r#"{"code":"AccessTokenExpired"}"#))
                .unwrap_err()
                .code,
            "AUTH_EXPIRED"
        );
        assert!(needs_session(&response(
            400,
            r#"{"code":"UserDeviceOffline"}"#
        )));
        assert!(!needs_session(&response(
            401,
            r#"{"code":"AccessTokenExpired"}"#
        )));
    }
    #[test]
    fn callback_rejects_origin_or_state_mismatch() {
        assert!(callback_code(
            &url::Url::parse("https://evil.test/sign/callback?code=test").unwrap(),
            "expected"
        )
        .is_none());
        assert!(callback_code(
            &url::Url::parse("https://www.aliyundrive.com/sign/callback?state=bad&code=test")
                .unwrap(),
            "expected"
        )
        .unwrap()
        .is_err());
        let mut url = url::Url::parse("https://www.aliyundrive.com/sign/callback").unwrap();
        url.query_pairs_mut()
            .append_pair(
                "state",
                &serde_json::json!({"boxplayerState":"expected"}).to_string(),
            )
            .append_pair("code", "synthetic");
        assert_eq!(
            callback_code(&url, "expected").unwrap().unwrap(),
            "synthetic"
        );
    }
}
