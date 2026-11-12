//! Guangya SMS exchange; challenge state and tokens remain native.
use crate::{
    accounts::{Account, Accounts, Credentials},
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
const ACCOUNT: &str = "https://account.guangyapan.com";
const API: &str = "https://api.guangyapan.com";
const WEB: &str = "https://www.guangyapan.com";
const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
fn error(message: &str) -> AppError {
    AppError::new("GUANGYA_LOGIN", message, false)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn client() -> Result<String, AppError> {
    let (id, _) = crate::provider_config::client("guangya", String::new(), None);
    if id.is_empty() {
        return Err(error("此开发包缺少光鸭登录配置，请更新应用"));
    }
    Ok(id)
}
fn phone(value: &str) -> Result<String, AppError> {
    let compact: String = value
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect();
    let digits = compact
        .strip_prefix("+86")
        .or_else(|| compact.strip_prefix("0086"))
        .unwrap_or(&compact);
    if digits.len() != 11 || !digits.starts_with('1') || !digits.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(error("请输入有效的中国大陆手机号"));
    }
    Ok(format!("+86 {digits}"))
}
fn account_headers(device: &str, id: &str) -> Headers {
    Headers::from(
        [
            ("accept", "*/*"),
            ("content-type", "application/json"),
            ("origin", WEB),
            ("referer", "https://www.guangyapan.com/"),
            ("user-agent", UA),
            ("x-client-id", id),
            ("x-client-version", "0.0.1"),
            ("x-device-id", device),
            ("x-device-model", "chrome%2F147.0.0.0"),
            ("x-device-name", "PC-Chrome"),
            ("x-net-work-type", "NONE"),
            ("x-os-version", "MacIntel"),
            ("x-platform-version", "1"),
            ("x-protocol-version", "301"),
            ("x-provider-name", "NONE"),
            ("x-sdk-version", "9.0.2"),
        ]
        .map(|(k, v)| (k.into(), v.into())),
    )
    .into_iter()
    .chain([(
        "x-device-sign".into(),
        format!("wdi10.{device}{}", uuid::Uuid::new_v4().simple()),
    )])
    .collect()
}
fn parse(response: HttpResponse) -> Result<Value, AppError> {
    if response.status == 401 {
        return Err(AppError::new(
            "AUTH_EXPIRED",
            "光鸭登录已过期，请重新登录",
            false,
        ));
    }
    let value: Value =
        serde_json::from_slice(&response.body).map_err(|_| error("光鸭响应格式无效"))?;
    if value["code"].as_i64() == Some(401) || value["code"].as_str() == Some("401") {
        return Err(AppError::new(
            "AUTH_EXPIRED",
            "光鸭登录已过期，请重新登录",
            false,
        ));
    }
    if !(200..300).contains(&response.status)
        || value.get("code").is_some_and(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                .is_some_and(|c| c != 0)
        })
        || value["success"] == false
        || value.get("error").is_some_and(|v| !v.is_null() && v != "")
    {
        return Err(error("光鸭请求失败，请检查账号或稍后重试"));
    }
    Ok(value)
}
async fn post(
    gateway: &Arc<Gateway>,
    path: &str,
    headers: Headers,
    body: Option<Value>,
) -> Result<Value, AppError> {
    parse(
        gateway
            .request(HttpRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                provider_id: "guangya".into(),
                account_id: String::new(),
                method: "POST".into(),
                url: format!("{ACCOUNT}{path}"),
                headers,
                body: body.map(|v| serde_json::to_vec(&v).unwrap()),
                timeout_ms: Some(30000),
                proxy: None,
            })
            .await?,
    )
}
fn raw(value: &Value) -> &Value {
    value.get("data").filter(|v| v.is_object()).unwrap_or(value)
}
fn string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| {
        value[*k]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .or_else(|| value[*k].as_u64().map(|n| n.to_string()))
    })
}
fn subject(value: &Value) -> Option<String> {
    string(raw(value), &["user_id", "uid", "id"])
}
fn credentials(
    value: &Value,
    device: &str,
    previous: Option<String>,
) -> Result<Credentials, AppError> {
    let data = raw(value);
    let access = string(data, &["access_token", "accessToken"])
        .ok_or_else(|| error("光鸭未返回访问令牌"))?;
    let expiry = string(data, &["expires_in", "expiresIn"])
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .map(|v| now().saturating_add(v));
    Ok(Credentials {
        headers: Headers::from([
            ("Authorization".into(), format!("Bearer {access}")),
            ("did".into(), device.into()),
            ("dt".into(), "4".into()),
            ("Origin".into(), WEB.into()),
            ("Referer".into(), format!("{WEB}/")),
            ("User-Agent".into(), UA.into()),
        ]),
        refresh_token: string(data, &["refresh_token", "refreshToken"]).or(previous),
        expires_at: expiry,
        ..Default::default()
    })
}
struct Session {
    created: Instant,
    phone: String,
    device: String,
    captcha: String,
    verification: String,
    name: String,
}
#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Session>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sms {
    session_id: String,
}
impl Sessions {
    pub fn cancel(&self, id: &str) -> bool {
        self.0.lock().unwrap().remove(id).is_some()
    }
    pub async fn begin(
        &self,
        gateway: &Arc<Gateway>,
        phone_number: String,
        name: String,
    ) -> Result<Sms, AppError> {
        let phone = phone(&phone_number)?;
        let id = client()?;
        let device = uuid::Uuid::new_v4().simple().to_string();
        {
            let mut sessions = self.0.lock().unwrap();
            sessions.retain(|_, s| s.created.elapsed() < Duration::from_secs(300));
            if sessions.len() >= 8 {
                return Err(error("登录会话过多，请关闭旧窗口"));
            }
        }
        let init=post(gateway,"/v1/shield/captcha/init",account_headers(&device,&id),Some(json!({"client_id":id,"action":"POST:/v1/auth/verification","device_id":device,"meta":{"phone_number":phone}}))).await?;
        let captcha = string(raw(&init), &["captcha_token", "captchaToken"])
            .ok_or_else(|| error("需要先在光鸭官方客户端完成人机验证，再重试登录"))?;
        let mut headers = account_headers(&device, &id);
        headers.insert("x-captcha-token".into(), captcha.clone());
        let sent = post(
            gateway,
            "/v1/auth/verification",
            headers,
            Some(json!({"phone_number":phone,"target":"ANY","client_id":id})),
        )
        .await?;
        let verification = string(raw(&sent), &["verification_id", "verificationId"])
            .ok_or_else(|| error("光鸭未返回短信验证 ID"))?;
        let mut sessions = self.0.lock().unwrap();
        if sessions.len() >= 8 {
            return Err(error("登录会话过多，请关闭旧窗口"));
        }
        let session_id = uuid::Uuid::new_v4().to_string();
        sessions.insert(
            session_id.clone(),
            Session {
                created: Instant::now(),
                phone,
                device,
                captcha,
                verification,
                name,
            },
        );
        Ok(Sms { session_id })
    }
    pub async fn submit(
        &self,
        accounts: &Accounts,
        gateway: &Arc<Gateway>,
        id: &str,
        code: String,
    ) -> Result<Account, AppError> {
        if !(4..=8).contains(&code.len()) || !code.bytes().all(|b| b.is_ascii_digit()) {
            return Err(error("请输入有效短信验证码"));
        }
        // Consume once: parallel submissions and failed attempts cannot replay a challenge.
        let session = self
            .0
            .lock()
            .unwrap()
            .remove(id)
            .ok_or_else(|| error("短信会话已取消或失效，请重新获取"))?;
        if session.created.elapsed() >= Duration::from_secs(300) {
            return Err(error("短信会话已过期，请重新获取"));
        }
        let client = client()?;
        let verified=post(gateway,"/v1/auth/verification/verify",account_headers(&session.device,&client),Some(json!({"verification_id":session.verification,"verification_code":code,"client_id":client}))).await?;
        let verification_token =
            string(raw(&verified), &["verification_token", "verificationToken"])
                .ok_or_else(|| error("短信验证码校验失败，请重新获取"))?;
        let mut headers = account_headers(&session.device, &client);
        headers.insert("x-captcha-token".into(), session.captcha);
        let token=post(gateway,"/v1/auth/signin",headers,Some(json!({"verification_code":code,"verification_token":verification_token,"username":session.phone,"client_id":client}))).await?;
        let credentials = credentials(&token, &session.device, None)?;
        let mut headers = account_headers(&session.device, &client);
        headers.insert(
            "Authorization".into(),
            credentials.headers["Authorization"].clone(),
        );
        let profile = post(gateway, "/v1/user/me", headers, None).await?;
        let user_id = subject(&profile)
            .or_else(|| subject(&token))
            .ok_or_else(|| error("光鸭缺少稳定账号标识，未保存账号"))?;
        let name = if session.name.trim().is_empty() {
            "光鸭云盘".into()
        } else {
            session.name
        };
        accounts.save_login(
            Account {
                id: String::new(),
                provider_id: "guangya".into(),
                name,
                base_url: API.into(),
                user_id,
                device_id: session.device,
                auth_origins: vec![API.into()],
            },
            credentials,
        )
    }
}
pub async fn refresh(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    id: &str,
) -> Result<(), AppError> {
    let account = accounts
        .list()?
        .into_iter()
        .find(|a| a.id == id && a.provider_id == "guangya")
        .ok_or_else(|| error("光鸭账号不存在"))?;
    let old = accounts.credentials(id)?;
    let refresh = old
        .refresh_token
        .ok_or_else(|| error("请重新登录光鸭云盘"))?;
    let client = client()?;
    let mut headers = account_headers(&account.device_id, &client);
    headers.insert("x-action".into(), "401".into());
    let token = post(
        gateway,
        "/v1/auth/token",
        headers,
        Some(json!({"client_id":client,"grant_type":"refresh_token","refresh_token":refresh})),
    )
    .await?;
    if subject(&token).is_some_and(|user| user != account.user_id) {
        return Err(error("光鸭刷新返回了不同账号，未保存令牌"));
    }
    let credentials = credentials(&token, &account.device_id, Some(refresh))?;
    accounts.save(account, credentials)?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn phone_and_token_keep_identity_and_secrets_native() {
        for phone_number in ["13812345678", "+86 13812345678", "0086-13812345678"] {
            assert_eq!(phone(phone_number).unwrap(), "+86 13812345678")
        }
        assert!(phone("bad").is_err());
        let c = credentials(
            &json!({"data":{"accessToken":"synthetic","expiresIn":"3600","uid":42}}),
            "device-a",
            Some("retained".into()),
        )
        .unwrap();
        assert_eq!(c.headers["did"], "device-a");
        assert_eq!(c.headers["Authorization"], "Bearer synthetic");
        assert_eq!(c.refresh_token.as_deref(), Some("retained"));
        assert!(c.expires_at.unwrap() > now());
        assert_eq!(subject(&json!({"data":{"uid":42}})).as_deref(), Some("42"));
        assert!(credentials(&json!({}), "d", None).is_err());
    }
    #[test]
    fn cancel_removes_sms_challenge() {
        let sessions = Sessions::default();
        sessions.0.lock().unwrap().insert(
            "s".into(),
            Session {
                created: Instant::now(),
                phone: "synthetic".into(),
                device: "d".into(),
                captcha: "secret".into(),
                verification: "secret".into(),
                name: String::new(),
            },
        );
        assert!(sessions.cancel("s"));
        assert!(!sessions.cancel("s"));
    }
}
