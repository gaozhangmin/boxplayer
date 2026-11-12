//! PikPak protocol adapted from the retained Electron SDK; secrets stay native.
use crate::{
    accounts::{Account, Accounts, Credentials},
    commands::Backend,
    gateway::{Gateway, Headers, HttpRequest, HttpResponse, ResolvedMedia},
    settings::AppError,
};
use md5::{Digest, Md5};
use serde_json::{json, Value};
use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
const USER: &str = "https://user.mypikpak.com";
const API: &str = "https://api-drive.mypikpak.com";
const VERSION: &str = "1.47.1";
const PACKAGE: &str = "com.pikcloud.pikpak";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
// SDK salts are protocol constants, not application registration or account credentials.
const SALTS: &[&str] = &[
    "Gez0T9ijiI9WCeTsKSg3SMlx",
    "zQdbalsolyb1R/",
    "ftOjr52zt51JD68C3s",
    "yeOBMH0JkbQdEFNNwQ0RI9T3wU/v",
    "BRJrQZiTQ65WtMvwO",
    "je8fqxKPdQVJiy1DM6Bc9Nb1",
    "niV",
    "9hFCW2R1",
    "sHKHpe2i96",
    "p7c5E6AcXQ/IJUuAEC9W6",
    "",
    "aRv9hjc9P+Pbn+u3krN6",
    "BzStcgE8qVdqjEH16l4",
    "SqgeZvL5j9zoHP95xWHt",
    "zVof5yaJkPe3VFpadPof",
];
fn error(message: &str) -> AppError {
    AppError::new("PIKPAK", message, false)
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn client() -> Result<(String, String), AppError> {
    let (id, secret) = crate::provider_config::client("pikpak", String::new(), None);
    match secret {
        Some(secret) if !id.is_empty() => Ok((id, secret)),
        _ => Err(error("此开发包缺少 PikPak 登录配置，请更新应用")),
    }
}
fn signature(client: &str, device: &str, timestamp: &str) -> String {
    let mut sign = format!("{client}{VERSION}{PACKAGE}{device}{timestamp}");
    for salt in SALTS {
        sign = format!("{:x}", Md5::digest(format!("{sign}{salt}").as_bytes()))
    }
    format!("1.{sign}")
}
fn headers(device: &str) -> Headers {
    Headers::from([
        (
            "Content-Type".into(),
            "application/json; charset=utf-8".into(),
        ),
        ("User-Agent".into(), UA.into()),
        ("X-Device-Id".into(), device.into()),
    ])
}
fn parse(response: HttpResponse) -> Result<Value, AppError> {
    if response.status == 401 {
        return Err(AppError::new(
            "AUTH_EXPIRED",
            "PikPak 登录已过期，请重新登录",
            false,
        ));
    }
    let data: Value =
        serde_json::from_slice(&response.body).map_err(|_| error("PikPak 响应格式无效"))?;
    if data["error_code"].as_u64() == Some(4126) || data["error_description"] == "AccessProhibited"
    {
        return Err(error("PikPak 在当前地区不可用"));
    }
    if !(200..300).contains(&response.status)
        || data.get("error").is_some_and(|v| !v.is_null() && v != "")
    {
        return Err(error(if data["error"] == "invalid_account_or_password" {
            "PikPak 账号或密码错误"
        } else {
            "PikPak 请求失败，请检查账号或稍后重试"
        }));
    }
    Ok(data)
}
async fn request(
    gateway: &Arc<Gateway>,
    url: String,
    headers: Headers,
    body: Value,
) -> Result<Value, AppError> {
    parse(
        gateway
            .request(HttpRequest {
                request_id: uuid::Uuid::new_v4().to_string(),
                provider_id: "pikpak".into(),
                account_id: String::new(),
                method: "POST".into(),
                url,
                headers,
                body: Some(serde_json::to_vec(&body).unwrap()),
                timeout_ms: Some(30000),
                proxy: None,
            })
            .await?,
    )
}
fn subject(data: &Value) -> Option<&str> {
    data["sub"].as_str().filter(|s| !s.is_empty())
}
fn credentials(
    data: &Value,
    device: &str,
    previous: Option<String>,
) -> Result<Credentials, AppError> {
    let access = data["access_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("PikPak 未返回访问令牌"))?;
    let mut headers = headers(device);
    headers.insert("Authorization".into(), format!("Bearer {access}"));
    let expiry = data["expires_in"]
        .as_u64()
        .or_else(|| data["expires_in"].as_str().and_then(|s| s.parse().ok()))
        .filter(|n| *n > 0)
        .unwrap_or(7200);
    Ok(Credentials {
        headers,
        refresh_token: data["refresh_token"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .or(previous),
        expires_at: Some(now().saturating_add(expiry)),
        ..Default::default()
    })
}
pub async fn login(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    name: String,
    username: String,
    password: String,
) -> Result<Account, AppError> {
    if username.trim().is_empty() || password.is_empty() {
        return Err(error("请输入 PikPak 账号和密码"));
    }
    let (id, secret) = client()?;
    // A random device identifier avoids exposing a deterministic password hash as public metadata.
    let device = uuid::Uuid::new_v4().simple().to_string();
    let captcha=request(gateway,format!("{USER}/v1/shield/captcha/init"),headers(&device),json!({"client_id":id,"action":format!("POST:{USER}/v1/auth/signin"),"device_id":device,"meta":{"username":username}})).await?;
    let captcha = captcha["captcha_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("请先在 PikPak 官方客户端完成人机验证，再重试登录"))?;
    let mut signin = headers(&device);
    signin.insert(
        "Content-Type".into(),
        "application/x-www-form-urlencoded".into(),
    );
    signin.insert("X-Captcha-Token".into(), captcha.into());
    // The retained SDK sends JSON despite this endpoint's form content type.
    let data=request(gateway,format!("{USER}/v1/auth/signin"),signin,json!({"client_id":id,"client_secret":secret,"username":username,"password":password,"captcha_token":captcha})).await?;
    let user = subject(&data).ok_or_else(|| error("PikPak 缺少稳定账号标识，未保存账号"))?;
    let credentials = credentials(&data, &device, None)?;
    accounts.save_login(
        Account {
            id: String::new(),
            provider_id: "pikpak".into(),
            name: if name.trim().is_empty() {
                "PikPak".into()
            } else {
                name
            },
            base_url: API.into(),
            user_id: user.into(),
            device_id: device,
            auth_origins: vec![API.into(), USER.into()],
        },
        credentials,
    )
}
pub async fn refresh(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    id: &str,
) -> Result<(), AppError> {
    let account = accounts
        .list()?
        .into_iter()
        .find(|a| a.id == id && a.provider_id == "pikpak")
        .ok_or_else(|| error("PikPak 账号不存在"))?;
    let old = accounts.credentials(id)?;
    let previous = old
        .refresh_token
        .ok_or_else(|| error("请重新登录 PikPak"))?;
    let (client, _) = client()?;
    let data = request(
        gateway,
        format!("{USER}/v1/auth/token"),
        headers(&account.device_id),
        json!({"client_id":client,"refresh_token":previous,"grant_type":"refresh_token"}),
    )
    .await?;
    if subject(&data).is_some_and(|subject| subject != account.user_id) {
        return Err(error("PikPak 刷新返回不同账号，未保存令牌"));
    }
    let credentials = credentials(&data, &account.device_id, Some(previous))?;
    accounts.save(account, credentials)?;
    Ok(())
}
fn media_url(data: &Value) -> Result<String, AppError> {
    let stream = data["medias"].as_array().and_then(|rows| {
        rows.iter()
            .find_map(|row| row["link"]["url"].as_str().filter(|s| !s.is_empty()))
    });
    let value = stream
        .or_else(|| data["web_content_link"].as_str())
        .ok_or_else(|| error("PikPak 未返回播放链接"))?;
    let url = url::Url::parse(value).map_err(|_| error("PikPak 播放地址无效"))?;
    if !matches!(url.scheme(), "https" | "http")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(error("PikPak 播放地址无效"));
    }
    Ok(url.into())
}
// Original Electron apiPikPakDownloadInfo captcha/detail flow is shared by
// playback and the explicit Copy Download Link action. Credentials never leave Rust.
async fn download_detail(state:&Backend,account_id:&str,file_id:&str)->Result<(Account,Value),AppError>{
    if file_id.is_empty() || file_id.len() > 1024 || file_id.chars().any(char::is_control) {
        return Err(error("PikPak 文件标识无效"));
    }
    let account = state
        .accounts
        .list()?
        .into_iter()
        .find(|a| a.id == account_id && a.provider_id == "pikpak")
        .ok_or_else(|| error("PikPak 账号不存在"))?;
    let (client, _) = client()?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    let mut path = url::Url::parse(&format!("{API}/drive/v1/files/")).unwrap();
    path.path_segments_mut()
        .unwrap()
        .pop_if_empty()
        .push(file_id);
    let action = format!("GET:{}", path.path());
    let body = json!({"client_id":client,"action":action,"device_id":account.device_id,"meta":{"captcha_sign":signature(&client,&account.device_id,&timestamp),"client_version":VERSION,"package_name":PACKAGE,"user_id":account.user_id,"timestamp":timestamp}});
    let challenge = state
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "pikpak".into(),
            account_id: account_id.into(),
            method: "POST".into(),
            url: format!("{USER}/v1/shield/captcha/init"),
            headers: Headers::new(),
            body: Some(serde_json::to_vec(&body).unwrap()),
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    let challenge = parse(challenge)?;
    let captcha = challenge["captcha_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("PikPak 未返回取链验证信息"))?;
    path.query_pairs_mut()
        .append_pair("thumbnail_size", "SIZE_LARGE");
    let detail = state
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "pikpak".into(),
            account_id: account_id.into(),
            method: "GET".into(),
            url: path.into(),
            headers: Headers::from([("X-Captcha-Token".into(), captcha.into())]),
            body: None,
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    let detail = parse(detail)?;
    if detail["id"].as_str() != Some(file_id) {
        return Err(error("PikPak 返回的文件标识不匹配"));
    }
    Ok((account,detail))
}

pub async fn resolve(
    state: &Backend,
    account_id: &str,
    file_id: &str,
) -> Result<ResolvedMedia, AppError> {
    let (account,detail)=download_detail(state,account_id,file_id).await?;
    state.prepared_media.insert(ResolvedMedia {
        schema_version: 1,
        source_id: account.id.clone(),
        account_id: account.id,
        file_id: file_id.into(),
        url: media_url(&detail)?,
        headers: Headers::from([("User-Agent".into(), UA.into())]),
        expires_at: None,
    })
}
// This is an explicit user-requested shareable URL, not a prepared player token.
// Like Electron's getPikPakDownloadUrl, prefer stream URL then web_content_link.
fn independent_download(account:Account,file_id:&str,detail:&Value)->Result<ResolvedMedia,AppError>{
    if detail["id"].as_str()!=Some(file_id)||detail["kind"].as_str()!=Some("drive#file")||detail["trashed"].as_bool()==Some(true)||detail["phase"].as_str().is_some_and(|phase|phase!="PHASE_TYPE_COMPLETE"){
        return Err(error("PikPak 下载文件身份或状态无效"));
    }
    Ok(ResolvedMedia{schema_version:1,source_id:account.id.clone(),account_id:account.id,file_id:file_id.into(),url:media_url(detail)?,headers:Headers::new(),expires_at:None})
}
pub async fn download_url(state:&Backend,account_id:&str,file_id:&str)->Result<ResolvedMedia,AppError>{
    let (account,detail)=download_detail(state,account_id,file_id).await?;
    independent_download(account,file_id,&detail)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signature_matches_retained_sdk_vector() {
        assert_eq!(
            signature("synthetic-client", "device-a", "1700000000000"),
            "1.4bbf5dc8167ee096b04ff339e38c2534"
        );
        assert_ne!(
            signature("synthetic-client", "device-b", "1700000000000"),
            signature("synthetic-client", "device-a", "1700000000000")
        );
    }
    #[test]
    fn credential_refresh_preserves_refresh_and_device() {
        let creds = credentials(
            &json!({"access_token":"synthetic","expires_in":3600,"sub":"user"}),
            "device",
            Some("previous".into()),
        )
        .unwrap();
        assert_eq!(creds.headers["X-Device-Id"], "device");
        assert_eq!(creds.refresh_token.as_deref(), Some("previous"));
        assert!(credentials(&json!({}), "d", None).is_err());
    }
    fn fixture_account()->Account{Account{id:"fixture".into(),provider_id:"pikpak".into(),name:"Fixture".into(),base_url:API.into(),user_id:"owner".into(),device_id:"private-device".into(),auth_origins:vec![]}}
    #[test]
    fn independent_download_preserves_original_url_preference_and_only_public_fields(){
        let detail=json!({"id":"file","kind":"drive#file","phase":"PHASE_TYPE_COMPLETE","medias":[{"link":{"url":"https://cdn.test/stream"}}],"web_content_link":"https://cdn.test/download","access_token":"private-token","captcha_token":"private-captcha","headers":{"Authorization":"private-header"}});
        let result=independent_download(fixture_account(),"file",&detail).unwrap();
        assert_eq!(result.url,"https://cdn.test/stream");assert!(result.headers.is_empty());
        let value=serde_json::to_value(result).unwrap();assert_eq!(value["accountId"],"fixture");assert_eq!(value["fileId"],"file");assert!(!value.to_string().contains("private"));
        assert_eq!(independent_download(fixture_account(),"file",&json!({"id":"file","kind":"drive#file","web_content_link":"https://cdn.test/download"})).unwrap().url,"https://cdn.test/download");
    }
    #[test]
    fn independent_download_rejects_wrong_identity_folder_trash_pending_and_bad_urls(){
        for patch in [json!({"id":"other"}),json!({"kind":"drive#folder"}),json!({"trashed":true}),json!({"phase":"PHASE_TYPE_RUNNING"}),json!({"web_content_link":"file:///private"}),json!({"web_content_link":"https://user:password@cdn.test/file"})]{
            let mut detail=json!({"id":"file","kind":"drive#file","web_content_link":"https://cdn.test/download"});
            for (key,value) in patch.as_object().unwrap(){detail[key]=value.clone()}
            assert!(independent_download(fixture_account(),"file",&detail).is_err());
        }
    }
    #[test]
    fn stream_precedes_download_and_rejects_invalid_links() {
        assert_eq!(media_url(&json!({"medias":[{"link":{"url":"https://cdn.test/stream"}}],"web_content_link":"https://cdn.test/download"})).unwrap(),"https://cdn.test/stream");
        assert!(media_url(&json!({"web_content_link":"https://user:pass@cdn.test/file"})).is_err());
        assert!(media_url(&json!({"web_content_link":"javascript:alert(1)"})).is_err());
    }
}

/// Account-bound share captcha handshake. Challenge token never crosses IPC.
pub fn share_body(file_ids:&[String],need_password:bool,expiration_days:i64)->Result<Value,AppError>{
 if file_ids.is_empty()||file_ids.iter().any(|id|id.is_empty()||id.len()>4096)||file_ids.iter().collect::<std::collections::HashSet<_>>().len()!=file_ids.len(){return Err(error("PikPak 文件标识无效或重复"))}
 if expiration_days!=-1&&expiration_days<1{return Err(error("PikPak 分享有效期无效"))}
 Ok(json!({"file_ids":file_ids,"share_to":if need_password{"encryptedlink"}else{"publiclink"},"expiration_days":expiration_days,"pass_code_option":if need_password{"REQUIRED"}else{"NOT_REQUIRED"}}))
}
pub async fn create_share(state:&crate::commands::Backend,account_id:&str,file_ids:&[String],need_password:bool,expiration_days:i64)->Result<Value,AppError>{
 let share_body=share_body(file_ids,need_password,expiration_days)?;
 let account=state.accounts.list()?.into_iter().find(|account|account.id==account_id&&account.provider_id=="pikpak").ok_or_else(||error("PikPak 账号不存在"))?;
 let (client,_)=client()?;let timestamp=SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().to_string();
 let body=json!({"client_id":client,"action":"POST:/drive/v1/share","device_id":account.device_id,"meta":{"captcha_sign":signature(&client,&account.device_id,&timestamp),"client_version":VERSION,"package_name":PACKAGE,"user_id":account.user_id,"timestamp":timestamp}});
 let challenge=parse(state.request(HttpRequest{request_id:uuid::Uuid::new_v4().to_string(),provider_id:"pikpak".into(),account_id:account_id.into(),method:"POST".into(),url:format!("{USER}/v1/shield/captcha/init"),headers:Headers::new(),body:Some(serde_json::to_vec(&body).unwrap()),timeout_ms:Some(30000),proxy:None}).await?)?;
 let captcha=challenge["captcha_token"].as_str().filter(|value|!value.is_empty()).ok_or_else(||error("PikPak 未返回分享验证信息"))?;
 let response=state.request(HttpRequest{request_id:uuid::Uuid::new_v4().to_string(),provider_id:"pikpak".into(),account_id:account_id.into(),method:"POST".into(),url:format!("{API}/drive/v1/share"),headers:Headers::from([("X-Captcha-Token".into(),captcha.into())]),body:Some(serde_json::to_vec(&share_body).unwrap()),timeout_ms:Some(30000),proxy:None}).await?;
 let data=parse(response)?;
 Ok(public_share(&data))
}

fn public_share(data:&Value)->Value{json!({"share_id":data["share_id"],"id":data["id"],"share_url":data["share_url"],"share_link":data["share_link"],"pass_code":data["pass_code"],"passcode":data["passcode"]})}
#[cfg(test)]
mod share_boundary_tests {
 use super::*;
 #[test]
 fn share_body_keeps_combined_files_and_generated_password_mode(){
  assert_eq!(share_body(&["a".into(),"b".into()],true,7).unwrap(),json!({"file_ids":["a","b"],"share_to":"encryptedlink","expiration_days":7,"pass_code_option":"REQUIRED"}));
  assert_eq!(share_body(&["legacy".into()],false,-1).unwrap(),json!({"file_ids":["legacy"],"share_to":"publiclink","expiration_days":-1,"pass_code_option":"NOT_REQUIRED"}));
 }
 #[test]
 fn share_body_rejects_empty_duplicate_or_invalid_options_before_signing(){
  assert!(share_body(&[],false,-1).is_err());assert!(share_body(&["".into()],false,-1).is_err());
  assert!(share_body(&["a".into(),"a".into()],false,-1).is_err());assert!(share_body(&["a".repeat(4097)],false,-1).is_err());
  assert!(share_body(&["a".into()],true,0).is_err());assert!(share_body(&["a".into()],true,-2).is_err());
 }
 #[test]
 fn share_result_keeps_the_user_link_but_never_challenge_or_account_credentials(){
  let result=public_share(&json!({"share_id":"share","share_url":"https://mypikpak.com/s/public","pass_code":"1234","captcha_token":"private-challenge","access_token":"private-account","nested":{"headers":{"Authorization":"private"}}}));
  assert_eq!(result["share_url"],"https://mypikpak.com/s/public");assert_eq!(result["pass_code"],"1234");assert!(!result.to_string().contains("private"));assert!(result.get("captcha_token").is_none());assert!(result.get("access_token").is_none());
 }
}
