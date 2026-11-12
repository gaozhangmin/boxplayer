//! QR and download protocol adapted from Electron src/quark/{auth,dirfilelist}.ts.
use crate::{
    accounts::{Account, Credentials},
    commands::Backend,
    gateway::{Headers, HttpRequest, ResolvedMedia},
    settings::AppError,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
const DRIVE: &str = "https://drive-pc.quark.cn";
const PAN: &str = "https://pan.quark.cn";
const API_AGENT:&str="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DOWN_AGENT:&str="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.56 Chrome/100.0.4896.160 Electron/18.3.5.12-a038f7b798 Safari/537.36 Channel/pckk_other_ch";
fn error(message: &str) -> AppError {
    AppError::new("QUARK", message, false)
}
fn headers(agent: &str) -> Headers {
    Headers::from([
        ("Accept".into(), "application/json, text/plain, */*".into()),
        ("Content-Type".into(), "application/json".into()),
        ("Origin".into(), PAN.into()),
        ("Referer".into(), format!("{}/", PAN)),
        ("User-Agent".into(), agent.into()),
    ])
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
async fn login_api(
    state: &Backend,
    jar_id: &str,
    url: String,
) -> Result<serde_json::Value, AppError> {
    let response = state
        .gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "quark".into(),
            account_id: jar_id.into(),
            method: "GET".into(),
            url,
            headers: headers(API_AGENT),
            body: None,
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    if response.status != 200 {
        return Err(error("夸克登录请求失败，请稍后重试"));
    }
    serde_json::from_slice(&response.body).map_err(|_| error("夸克登录响应格式无效"))
}
struct Session {
    created: Instant,
    token: String,
    jar_id: String,
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
fn valid_cookie(cookies: &str) -> bool {
    let has = |key: &str| {
        cookies.split(';').any(|p| {
            p.trim()
                .split_once('=')
                .is_some_and(|(k, v)| k == key && !v.is_empty())
        })
    };
    has("__pus") && (has("__uid") || has("__kps"))
}
fn profile(data: &serde_json::Value, cookies: &str) -> Result<(String, String), AppError> {
    if !valid_cookie(cookies) {
        return Err(error("未取得完整夸克登录 Cookie，请重新扫码"));
    }
    let data = data.get("data").unwrap_or(data);
    let info = [
        "member",
        "user_info",
        "userInfo",
        "member_info",
        "memberInfo",
    ]
    .into_iter()
    .find_map(|k| data.get(k))
    .unwrap_or(data);
    let id = ["uid", "user_id", "id", "member_id"]
        .into_iter()
        .map(|k| scalar(&info[k]))
        .find(|s| !s.is_empty())
        .or_else(|| {
            cookies
                .split(';')
                .find_map(|p| p.trim().strip_prefix("__uid=").map(str::to_owned))
        })
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("夸克未返回账号标识"))?;
    let name = [
        "nickname",
        "nick_name",
        "nickName",
        "username",
        "user_name",
        "display_name",
    ]
    .into_iter()
    .filter_map(|k| info[k].as_str())
    .find(|s| !s.is_empty())
    .unwrap_or("夸克")
    .to_owned();
    Ok((id, name))
}
impl Sessions {
    pub async fn begin(&self, state: &Backend, name: String) -> Result<QrCode, AppError> {
        {
            let mut sessions = self.0.lock().unwrap();
            sessions.retain(|_, s| {
                let live = s.created.elapsed() < Duration::from_secs(300);
                if !live {
                    state.gateway.cookies.remove(&s.jar_id)
                }
                live
            });
            if sessions.len() >= 8 {
                return Err(error("请先关闭其他扫码登录"));
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let jar_id = format!("quark-login:{}", id);
        state.gateway.cookies.ensure(&jar_id, None)?;
        struct JarGuard<'a> {
            cookies: &'a crate::cookie_sessions::CookieSessions,
            id: String,
            keep: bool,
        }
        impl Drop for JarGuard<'_> {
            fn drop(&mut self) {
                if !self.keep {
                    self.cookies.remove(&self.id);
                }
            }
        }
        let mut jar_guard = JarGuard {
            cookies: &state.gateway.cookies,
            id: jar_id.clone(),
            keep: false,
        };
        let q = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs([
                ("client_id", "532"),
                ("v", "1.2"),
                ("request_id", id.as_str()),
            ])
            .finish();
        let result = login_api(
            state,
            &jar_id,
            format!("https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin?{}", q),
        )
        .await;
        let data = match result {
            Ok(data) => data,
            Err(e) => {
                state.gateway.cookies.remove(&jar_id);
                return Err(e);
            }
        };
        let token = data["data"]["members"]["token"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("夸克未返回二维码 token"))?;
        if data["status"].as_i64() != Some(2000000) {
            state.gateway.cookies.remove(&jar_id);
            return Err(error("夸克二维码申请失败"));
        }
        let q = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs([
                ("token", token),
                ("client_id", "532"),
                ("ssb", "weblogin"),
                ("uc_param_str", ""),
                (
                    "uc_biz_str",
                    "S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0",
                ),
            ])
            .finish();
        let content = format!("https://su.quark.cn/4_eMHBJ?{}", q);
        self.0.lock().unwrap().insert(
            id.clone(),
            Arc::new(Session {
                created: Instant::now(),
                token: token.into(),
                jar_id,
                name,
                poll: tokio::sync::Mutex::new(()),
            }),
        );
        jar_guard.keep = true;
        Ok(QrCode {
            session_id: id,
            content,
        })
    }
    pub fn cancel(&self, state: &Backend, id: &str) -> bool {
        if let Some(session) = self.0.lock().unwrap().remove(id) {
            state.gateway.cookies.remove(&session.jar_id);
            true
        } else {
            false
        }
    }
    pub async fn poll(&self, state: &Backend, id: &str) -> Result<QrStatus, AppError> {
        let session = self
            .0
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| error("夸克二维码已关闭或失效"))?;
        let _poll = session.poll.lock().await;
        if session.created.elapsed() > Duration::from_secs(300) {
            self.cancel(state, id);
            return Ok(QrStatus {
                status: "expired",
                account: None,
            });
        }
        let q = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs([
                ("client_id", "532"),
                ("v", "1.2"),
                ("token", session.token.as_str()),
                ("request_id", uuid::Uuid::new_v4().to_string().as_str()),
            ])
            .finish();
        let data = login_api(
            state,
            &session.jar_id,
            format!(
                "https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken?{}",
                q
            ),
        )
        .await?;
        if matches!(
            data["status"].as_i64(),
            Some(50004002 | 50004003 | 50004004)
        ) {
            self.cancel(state, id);
            return Ok(QrStatus {
                status: "expired",
                account: None,
            });
        }
        let Some(ticket) = data["data"]["members"]["service_ticket"]
            .as_str()
            .filter(|s| !s.is_empty())
        else {
            return Ok(QrStatus {
                status: "waiting",
                account: None,
            });
        };
        let q = url::form_urlencoded::Serializer::new(String::new())
            .extend_pairs([("st", ticket), ("lw", "scan")])
            .finish();
        let data = login_api(
            state,
            &session.jar_id,
            format!("{}/account/info?{}", PAN, q),
        )
        .await?;
        if data["status"].as_str() == Some("error") || data["code"].as_i64().is_some_and(|c| c != 0)
        {
            return Err(error("夸克账号验证失败"));
        }
        let cookies = state
            .gateway
            .cookies
            .headers(&session.jar_id, &format!("{}/", DRIVE))?;
        let (user_id, display_name) = profile(&data, &cookies)?;
        let mut sessions = self.0.lock().unwrap();
        if !sessions.contains_key(id) {
            return Err(error("夸克扫码登录已取消"));
        }
        let account = state.accounts.save_login(
            Account {
                id: String::new(),
                provider_id: "quark".into(),
                name: if session.name.is_empty() {
                    display_name
                } else {
                    session.name.clone()
                },
                base_url: DRIVE.into(),
                user_id,
                device_id: String::new(),
                auth_origins: vec![DRIVE.into(), PAN.into()],
            },
            Credentials {
                headers: headers(API_AGENT),
                cookie_store: Some(state.gateway.cookies.snapshot(&session.jar_id)?),
                ..Default::default()
            },
        )?;
        state
            .gateway
            .cookies
            .move_session(&session.jar_id, &account.id)?;
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
        .find(|a| a.id == account_id && a.provider_id == "quark")
        .ok_or_else(|| error("夸克账号不存在"))?;
    let q = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs([
            ("pr", "ucpro"),
            ("fr", "pc"),
            ("sys", "win32"),
            ("ve", "2.5.56"),
            ("ut", ""),
            ("guid", ""),
        ])
        .finish();
    let response = state
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "quark".into(),
            account_id: account_id.into(),
            method: "POST".into(),
            url: format!("{}/1/clouddrive/file/download?{}", DRIVE, q),
            headers: Headers::from([("User-Agent".into(), DOWN_AGENT.into())]),
            body: Some(serde_json::to_vec(&serde_json::json!({"fids":[file_id]})).unwrap()),
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    if response.status != 200 {
        return Err(error("夸克取链失败"));
    }
    let data: serde_json::Value =
        serde_json::from_slice(&response.body).map_err(|_| error("夸克取链响应无效"))?;
    if data["status"].as_str() == Some("error") || data["code"].as_i64().is_some_and(|c| c != 0) {
        return Err(error("夸克取链返回错误"));
    }
    let url = data["data"][0]["download_url"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("夸克未返回下载地址"))?;
    let url = url::Url::parse(url).map_err(|_| error("夸克下载地址无效"))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(error("夸克下载地址无效"));
    }
    let cookies = state
        .gateway
        .cookies
        .headers(account_id, &format!("{}/", DRIVE))?;
    if !valid_cookie(&cookies) {
        return Err(error("夸克登录 Cookie 已失效，请重新登录"));
    }
    let mut download = headers(DOWN_AGENT);
    download.remove("Content-Type");
    download.insert("Cookie".into(), cookies);
    download.insert("x-urlp".into(), url.path().into());
    state.prepared_media.insert(ResolvedMedia {
        schema_version: 1,
        source_id: account.id.clone(),
        account_id: account.id,
        file_id: file_id.into(),
        url: url.into(),
        headers: download,
        expires_at: None,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incomplete_cookie_or_profile_is_not_accepted() {
        assert!(!valid_cookie("__uid=one"));
        assert!(!valid_cookie("__pus="));
        assert!(profile(
            &serde_json::json!({"data":{"member":{"uid":"one","nickname":"test"}}}),
            "__pus=synthetic; __uid=one"
        )
        .is_ok());
        assert!(profile(&serde_json::json!({}), "__pus=synthetic; __kps=value").is_err());
    }
}
