//! Alipan OpenAPI QR authorization. Client credentials and exchanged tokens stay native.
use crate::{
    accounts::{Account, Credentials, OAuthSecret},
    commands::Backend,
    gateway::{Gateway, Headers, HttpRequest},
    settings::AppError,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
const API: &str = "https://openapi.alipan.com";
pub(crate) const TOKEN: &str = "https://openapi.alipan.com/oauth/access_token";
fn error(message: &str) -> AppError {
    AppError::new("ALIPAN", message, false)
}
struct Session {
    created: Instant,
    url: String,
    oauth: OAuthSecret,
    name: String,
    web: Option<(Account,Credentials)>,
    poll: tokio::sync::Mutex<()>,
}
#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Arc<Session>>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrCode {
    session_id: String,
    image_data_url: String,
}
#[derive(Serialize)]
pub struct QrStatus {
    status: &'static str,
    account: Option<Account>,
}
fn qr_url(value: &str) -> Result<url::Url, AppError> {
    let u = url::Url::parse(value).map_err(|_| error("二维码地址无效"))?;
    if u.scheme() != "https"
        || !matches!(
            u.host_str(),
            Some("openapi.alipan.com" | "openapi.aliyundrive.com")
        )
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || !u.path().starts_with("/oauth/qrcode/")
        || u.path()
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .is_none_or(|id| id.is_empty() || id == "qrcode")
    {
        return Err(error("二维码地址不属于官方授权服务"));
    }
    Ok(u)
}
async fn json(
    gateway: &Arc<Gateway>,
    url: String,
    body: Option<serde_json::Value>,
    headers: Headers,
) -> Result<serde_json::Value, AppError> {
    let mut headers = headers;
    if body.is_some() {
        headers.insert("Content-Type".into(), "application/json".into());
    }
    let r = gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "alipan-open".into(),
            account_id: String::new(),
            method: if body.is_some() { "POST" } else { "GET" }.into(),
            url,
            headers,
            body: body.map(|v| serde_json::to_vec(&v).unwrap()),
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    if r.status != 200 {
        return Err(error("阿里云盘授权服务请求失败"));
    }
    let value: serde_json::Value =
        serde_json::from_slice(&r.body).map_err(|_| error("阿里云盘响应格式无效"))?;
    if value.get("code").is_some() || value.get("error").is_some() {
        return Err(error("阿里云盘授权失败，请重新登录"));
    }
    Ok(value)
}
impl Sessions {
    pub fn cancel(&self, id: &str) -> bool {
        self.0.lock().unwrap().remove(id).is_some()
    }
    pub async fn begin(&self,gateway:&Arc<Gateway>,name:String)->Result<QrCode,AppError>{self.begin_inner(gateway,name,None).await}
    pub(crate) async fn begin_with_web(&self,gateway:&Arc<Gateway>,web:(Account,Credentials))->Result<QrCode,AppError>{let name=web.0.name.clone();self.begin_inner(gateway,name,Some(web)).await}
    pub async fn renew(&self,gateway:&Arc<Gateway>,id:&str)->Result<QrCode,AppError>{let old=self.0.lock().unwrap().remove(id).ok_or_else(||error("授权会话已关闭，请重新登录"))?;self.begin_inner(gateway,old.name.clone(),old.web.clone()).await}
    async fn begin_inner(&self, gateway: &Arc<Gateway>, name: String, web:Option<(Account,Credentials)>) -> Result<QrCode, AppError> {
        let (client_id, client_secret) =
            crate::provider_config::client("alipan-open", String::new(), None);
        if client_id.is_empty() || client_secret.is_none() {
            return Err(error(
                "此开发包缺少阿里云盘登录配置，请更新应用或联系开发者",
            ));
        }
        {
            let mut sessions = self.0.lock().unwrap();
            sessions.retain(|_, s| s.created.elapsed() < Duration::from_secs(if s.web.is_some(){900}else{300}));
            if sessions.len() >= 8 {
                return Err(error("登录会话过多，请关闭旧二维码后重试"));
            }
        }
        let result=json(gateway,format!("{API}/oauth/authorize/qrcode"),Some(serde_json::json!({"client_id":client_id,"client_secret":client_secret,"scopes":["user:base","file:all:read","file:all:write"],"width":240,"height":240})),Headers::new()).await?;
        let u = qr_url(
            result["qrCodeUrl"]
                .as_str()
                .ok_or_else(|| error("服务未返回二维码"))?,
        )?;
        let image = gateway
            .request(HttpRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                provider_id: "alipan-open".into(),
                account_id: String::new(),
                method: "GET".into(),
                url: u.to_string(),
                headers: Headers::new(),
                body: None,
                timeout_ms: Some(30000),
                proxy: None,
            })
            .await?;
        let mime = if image.body.starts_with(b"\x89PNG\r\n\x1a\n") {
            Some("image/png")
        } else if image.body.starts_with(b"\xff\xd8\xff") {
            Some("image/jpeg")
        } else if image.body.starts_with(b"GIF87a") || image.body.starts_with(b"GIF89a") {
            Some("image/gif")
        } else {
            None
        };
        if image.status != 200 || image.body.len() > 1024 * 1024 || mime.is_none() {
            return Err(error(&format!(
                "官方二维码图片无效（HTTP {}，类型 {}，{} 字节）",
                image.status,
                image
                    .headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
                    .map(|(_, v)| v.as_str())
                    .unwrap_or("unknown"),
                image.body.len()
            )));
        }
        let mime = mime.unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let mut sessions = self.0.lock().unwrap();
        if sessions.len() >= 8 {
            return Err(error("登录会话过多，请重试"));
        }
        sessions.insert(
            id.clone(),
            Arc::new(Session {
                created: Instant::now(),
                url: u.to_string().trim_end_matches('/').into(),
                oauth: OAuthSecret {
                    client_id,
                    client_secret,
                    token_url: TOKEN.into(),
                },
                name,
                web,
                poll: tokio::sync::Mutex::new(()),
            }),
        );
        Ok(QrCode {
            session_id: id,
            image_data_url: format!("data:{};base64,{}", mime, STANDARD.encode(image.body)),
        })
    }
    pub async fn poll(&self, state: &Backend, id: &str) -> Result<QrStatus, AppError> {
        let session = self
            .0
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| error("登录会话已关闭"))?;
        let _poll = session.poll.lock().await;
        if session.created.elapsed() >= Duration::from_secs(300) {
            if session.web.is_none(){self.cancel(id);}
            return Ok(QrStatus {
                status: "expired",
                account: None,
            });
        }
        let result = json(
            &state.gateway,
            format!("{}/status", session.url),
            None,
            Headers::new(),
        )
        .await?;
        let status = match result["status"].as_str() {
            Some("WaitLogin") => "waiting",
            Some("ScanSuccess") => "scanned",
            Some("LoginSuccess") => "confirmed",
            Some("QRCodeExpired") => "expired",
            _ => return Err(error("二维码状态无效，请重新生成")),
        };
        if status == "expired" && session.web.is_none() {
            self.cancel(id);
        }
        if status != "confirmed" {
            return Ok(QrStatus {
                status,
                account: None,
            });
        }
        let code = result["authCode"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("授权响应缺少确认码"))?;
        let data=json(&state.gateway,TOKEN.into(),Some(serde_json::json!({"code":code,"grant_type":"authorization_code","client_id":session.oauth.client_id,"client_secret":session.oauth.client_secret})),Headers::new()).await?;
        let creds = crate::oauth::credentials("alipan-open", &data, session.oauth.clone(), None)?;
        let profile = json(
            &state.gateway,
            format!("{API}/adrive/v1.0/user/getDriveInfo"),
            Some(serde_json::json!({})),
            creds.headers.clone(),
        )
        .await?;
        let user_id = profile["user_id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("阿里云盘未返回稳定账号标识"))?;
        // Cancellation must win if the UI closed while token/profile requests were in flight.
        let mut sessions = self.0.lock().unwrap();
        if sessions.remove(id).is_none() {
            return Err(error("登录已取消"));
        }
        let account=if let Some((web,web_credentials))=&session.web {
            let (account,credentials)=join_authorizations(web.clone(),web_credentials.clone(),user_id,creds)?;
            state.accounts.save_login(account,credentials)?
        } else {
        let account = state.accounts.save_login(
            Account {
                id: String::new(),
                provider_id: "alipan-open".into(),
                name: if session.name.is_empty() {
                    profile["name"].as_str().unwrap_or("阿里云盘").into()
                } else {
                    session.name.clone()
                },
                base_url: API.into(),
                user_id: user_id.into(),
                device_id: String::new(),
                auth_origins: vec![API.into()],
            },
            creds,
        )?;
            account
        };
        Ok(QrStatus {
            status: "confirmed",
            account: Some(account),
        })
    }
}
pub(crate) fn paired_open_request(request:&HttpRequest)->bool{request.provider_id=="aliyun"&&url::Url::parse(&request.url).is_ok_and(|u|u.origin().ascii_serialization()==API)}
fn join_authorizations(mut account:Account,mut web:Credentials,subject:&str,open:Credentials)->Result<(Account,Credentials),AppError>{
 if account.provider_id!="aliyun"||account.user_id!=subject{return Err(error("两次扫码不是同一个阿里云盘账号，请重新登录"))}
 web.provider_data.as_object_mut().ok_or_else(||error("网页授权状态无效"))?.insert("openApi".into(),serde_json::to_value(open).map_err(|_|error("授权凭据无效"))?);
 if !account.auth_origins.iter().any(|s|s==API){account.auth_origins.push(API.into());}Ok((account,web))
}
pub(crate) async fn refresh_paired(accounts:&crate::accounts::Accounts,gateway:&Arc<Gateway>,id:&str)->Result<(),AppError>{
 let account=accounts.list()?.into_iter().find(|a|a.id==id&&a.provider_id=="aliyun").ok_or_else(||error("阿里云盘账号不存在"))?;let mut web=accounts.credentials(id)?;
 let old:Credentials=serde_json::from_value(web.provider_data["openApi"].clone()).map_err(|_|error("请重新完成第二次扫码"))?;let oauth=old.oauth.ok_or_else(||error("开放平台授权无效"))?;if oauth.token_url!=TOKEN{return Err(error("开放平台令牌端点无效"))}
 let data=json(gateway,TOKEN.into(),Some(serde_json::json!({"grant_type":"refresh_token","refresh_token":old.refresh_token,"client_id":oauth.client_id,"client_secret":oauth.client_secret})),Headers::new()).await?;
 let open=crate::oauth::credentials("alipan-open",&data,oauth,old.refresh_token)?;let profile=json(gateway,format!("{API}/adrive/v1.0/user/getDriveInfo"),Some(serde_json::json!({})),open.headers.clone()).await?;
 if profile["user_id"].as_str()!=Some(account.user_id.as_str()){return Err(error("开放平台刷新账号不匹配"))}
 // Refreshing OpenAPI must retain any web-token/session updates made while HTTP was pending.
 web=accounts.credentials(id)?;let(account,credentials)=join_authorizations(account,web,profile["user_id"].as_str().unwrap(),open)?;accounts.save(account,credentials)?;Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn paired_authorization_preserves_web_identity_and_rejects_other_users() {
        let account=Account{id:"stable".into(),provider_id:"aliyun".into(),name:"Drive".into(),base_url:"https://api.aliyundrive.com".into(),user_id:"user-a".into(),device_id:"device".into(),auth_origins:vec!["https://api.aliyundrive.com".into()]};
        let mut web=Credentials::default();web.headers.insert("Authorization".into(),"web-token".into());web.provider_data=serde_json::json!({"deviceId":"device"});
        let mut open=Credentials::default();open.headers.insert("Authorization".into(),"open-token".into());
        assert!(join_authorizations(account.clone(),web.clone(),"other-user",open.clone()).is_err());
        let (paired,credentials)=join_authorizations(account,web,"user-a",open).unwrap();
        assert_eq!(paired.id,"stable");assert_eq!(paired.device_id,"device");assert!(paired.auth_origins.contains(&API.to_string()));
        assert_eq!(credentials.headers["Authorization"],"web-token");assert_eq!(credentials.provider_data["deviceId"],"device");
        let nested:Credentials=serde_json::from_value(credentials.provider_data["openApi"].clone()).unwrap();assert_eq!(nested.headers["Authorization"],"open-token");
    }
    #[test]
    fn only_official_qr_endpoints_are_accepted() {
        assert!(qr_url("https://openapi.alipan.com/oauth/qrcode/synthetic-id").is_ok());
        for value in [
            "https://evil.test/oauth/qrcode/id",
            "https://openapi.alipan.com.evil.test/oauth/qrcode/id",
            "https://openapi.alipan.com/oauth/qrcode/",
            "https://openapi.alipan.com/oauth/qrcode/id?token=secret",
            "https://user@openapi.alipan.com/oauth/qrcode/id",
        ] {
            assert!(qr_url(value).is_err());
        }
    }
    #[tokio::test]
    #[ignore = "Contacts the official anonymous QR endpoint using built-in app registration, without user login"]
    async fn official_anonymous_qr_can_be_created_and_cancelled() {
        let gateway = Gateway::new(Arc::new(|_| {
            Box::pin(async { Err(error("unused refresh")) })
        }))
        .unwrap();
        let sessions = Sessions::default();
        let qr = sessions.begin(&gateway, String::new()).await.unwrap();
        assert!(qr.image_data_url.starts_with("data:image/"));
        assert!(sessions.cancel(&qr.session_id));
        assert!(sessions.0.lock().unwrap().is_empty());
    }
}
