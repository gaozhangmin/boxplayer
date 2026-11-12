//! Native desktop OAuth: loopback callback, state + PKCE, Rust-only tokens.
use crate::{
    accounts::{Account, Accounts, Credentials, OAuthSecret},
    gateway::{Gateway, HttpRequest},
    settings::AppError,
};
use axum::{
    extract::{Query, State},
    routing::get,
    Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap,HashMap},
    sync::{Arc, Mutex,OnceLock},
    time::Duration,
};
use tauri_plugin_opener::OpenerExt;
use tauri::Manager;
struct Provider {
    auth: &'static str,
    token: &'static str,
    api: &'static str,
    scope: &'static str,
}
fn provider(id: &str) -> Result<Provider, AppError> {
    Ok(match id {
        "alipan-open" => Provider {
            auth: "https://openapi.alipan.com/oauth/authorize/qrcode",
            token: crate::alipan::TOKEN,
            api: "https://openapi.alipan.com",
            scope: "",
        },
        "baidu" => Provider {
            auth: "https://openapi.baidu.com/oauth/2.0/authorize",
            token: "https://openapi.baidu.com/oauth/2.0/token",
            api: "https://pan.baidu.com",
            scope: "basic,netdisk",
        },
        "123" => Provider {
            auth: "https://yun.123pan.com/auth",
            token: "https://open-api.123pan.com/api/v1/oauth2/access_token",
            api: "https://open-api.123pan.com",
            scope: "user:base,file:all:read,file:all:write",
        },
        "115" => Provider {
            auth: "https://passportapi.115.com/open/authDeviceCode",
            token: "https://passportapi.115.com/open/refreshToken",
            api: "https://proapi.115.com",
            scope: "",
        },
        "onedrive" => Provider {
            auth: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
            token: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            api: "https://graph.microsoft.com",
            scope: "offline_access Files.ReadWrite User.Read",
        },
        "google" => Provider {
            auth: "https://accounts.google.com/o/oauth2/v2/auth",
            token: "https://oauth2.googleapis.com/token",
            api: "https://www.googleapis.com",
            scope: "https://www.googleapis.com/auth/drive",
        },
        "dropbox" => Provider {
            auth: "https://www.dropbox.com/oauth2/authorize",
            token: "https://api.dropboxapi.com/oauth2/token",
            api: "https://api.dropboxapi.com",
            scope: "",
        },
        "box" => Provider {
            auth: "https://account.box.com/api/oauth2/authorize",
            token: "https://api.box.com/oauth2/token",
            api: "https://api.box.com",
            scope: "",
        },
        _ => return Err(error("OAUTH_PROVIDER", "此提供商不支持此 OAuth 流程")),
    })
}
fn error(code: &'static str, message: &str) -> AppError {
    AppError::new(code, message, false)
}
#[derive(Deserialize)]
struct Callback {
    state: Option<String>,
    code: Option<String>,
    error: Option<String>,
}
type CallbackSender = Arc<Mutex<Option<tokio::sync::oneshot::Sender<Result<String, AppError>>>>>;
#[derive(Clone)]
struct CallbackState {
    expected: String,
    send: CallbackSender,
}
async fn callback(State(state):State<CallbackState>,Query(query):Query<Callback>)->(axum::http::StatusCode,&'static str){complete_callback(&state,query)}
fn complete_callback(state:&CallbackState,query:Callback)->(axum::http::StatusCode,&'static str){
    if query.state.as_deref() != Some(state.expected.as_str()) {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            "Invalid authorization state",
        );
    }
    let result = if query.error.is_some() {
        Err(error("OAUTH_DENIED", "登录授权被取消或拒绝"))
    } else {
        query
            .code
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("OAUTH_CODE", "授权响应缺少 code"))
    };
    if let Some(send) = state.send.lock().unwrap().take() {
        let _ = send.send(result);
    }
    (
        axum::http::StatusCode::OK,
        "Authorization received. Return to BoxPlayer.",
    )
}
fn registered_redirect(provider:&str)->Option<&'static str>{match provider{"dropbox"|"box"=>Some("xbyboxplayer-oauth://callback"),"onedrive"=>Some("boxplayer-onedriveoauth://callback"),_=>None}}
static CUSTOM_CALLBACKS:OnceLock<Mutex<HashMap<String,(String,CallbackState)>>>=OnceLock::new();
fn custom_callbacks()->&'static Mutex<HashMap<String,(String,CallbackState)>>{CUSTOM_CALLBACKS.get_or_init(Default::default)}
struct CustomCallbackGuard{state:String,_route:crate::oauth_route::Route}
impl CustomCallbackGuard{
 fn new(app:&tauri::AppHandle,redirect:&str,state:CallbackState)->Result<Self,AppError>{
  let mut pending=custom_callbacks().lock().map_err(|_|error("OAUTH_STATE","登录状态不可用"))?;
  if !pending.is_empty(){return Err(error("OAUTH_BUSY","已有浏览器登录正在进行，请先完成或取消"))}
  let url=url::Url::parse(redirect).map_err(|_|error("OAUTH_CONFIG","登录回调无效"))?;
  let route=crate::oauth_route::Route::new(app,url.scheme())?;let key=state.expected.clone();pending.insert(key.clone(),(url.scheme().to_owned(),state));Ok(Self{state:key,_route:route})
 }
}
impl Drop for CustomCallbackGuard{fn drop(&mut self){if let Ok(mut pending)=custom_callbacks().lock(){pending.remove(&self.state);}}}
/// Consume every recognized OAuth URL natively, including malformed/stale callbacks.
/// Nothing containing an authorization code may reach shell:open or renderer state.
pub(crate) fn accept_custom_callback(value:&str)->bool{
 let Ok(url)=url::Url::parse(value)else{return false};
 if !["xbyboxplayer-oauth","boxplayer-onedriveoauth"].contains(&url.scheme()){return false}
 if url.host_str()!=Some("callback")||!matches!(url.path(),""|"/")||url.username()!=""||url.password().is_some()||url.fragment().is_some(){return true}
 let pairs=url.query_pairs().collect::<Vec<_>>();
 if ["state","code","error"].iter().any(|key|pairs.iter().filter(|(name,_)|name==key).count()>1){return true}
 let get=|key:&str|pairs.iter().find(|(name,_)|name==key).map(|(_,value)|value.to_string());
 let Some(key)=get("state")else{return true};
 let state=custom_callbacks().lock().ok().and_then(|pending|pending.get(&key).filter(|(scheme,_)|scheme==url.scheme()).map(|(_,state)|state.clone()));
 if let Some(state)=state{let _=complete_callback(&state,Callback{state:Some(key),code:get("code"),error:get("error")});}true
}
fn verifier() -> String {
    format!(
        "{}{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
fn token_request(provider_id: &str, endpoint: &str, form: String) -> Result<HttpRequest, AppError> {
    let mut url = url::Url::parse(endpoint).map_err(|_| error("OAUTH_CONFIG", "令牌端点无效"))?;
    let baidu = provider_id == "baidu";
    let alipan = provider_id == "alipan-open";
    if baidu {
        url.set_query(Some(&form));
    }
    Ok(HttpRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        provider_id: provider_id.into(),
        account_id: String::new(),
        method: if baidu { "GET" } else { "POST" }.into(),
        url: url.into(),
        headers: if baidu {
            BTreeMap::new()
        } else {
            BTreeMap::from([(
                "Content-Type".into(),
                if alipan {
                    "application/json"
                } else {
                    "application/x-www-form-urlencoded"
                }
                .into(),
            )])
        },
        body: if baidu {
            None
        } else if alipan {
            Some(
                serde_json::to_vec(
                    &url::form_urlencoded::parse(form.as_bytes())
                        .into_owned()
                        .collect::<BTreeMap<String, String>>(),
                )
                .unwrap(),
            )
        } else {
            Some(form.into_bytes())
        },
        timeout_ms: Some(30000),
        proxy: None,
    })
}
async fn token(
    gateway: &Arc<Gateway>,
    provider_id: &str,
    url: &str,
    form: String,
) -> Result<serde_json::Value, AppError> {
    let response = gateway
        .request(token_request(provider_id, url, form)?)
        .await?;
    if response.status != 200 {
        return Err(error("OAUTH_TOKEN", "授权码或刷新令牌交换失败，请重新登录"));
    }
    let data: serde_json::Value =
        serde_json::from_slice(&response.body).map_err(|_| error("OAUTH_TOKEN", "令牌响应无效"))?;
    if provider_id == "115" {
        if data["code"].as_i64().is_some_and(|v| v != 0)
            || data["errno"].as_i64().is_some_and(|v| v != 0)
        {
            return Err(error("OAUTH_TOKEN", "115 刷新令牌失败"));
        }
        return Ok(data.get("data").cloned().unwrap_or(data));
    }
    Ok(data)
}
pub(crate) fn credentials(
    provider_id: &str,
    data: &serde_json::Value,
    oauth: OAuthSecret,
    previous_refresh: Option<String>,
) -> Result<Credentials, AppError> {
    let access = data["access_token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("OAUTH_TOKEN", "响应缺少访问令牌"))?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let expires = data["expires_in"]
        .as_u64()
        .map(|s| now.saturating_add(s.saturating_sub(60)));
    let mut query = BTreeMap::new();
    let mut headers = if provider_id == "baidu" {
        query.insert("access_token".into(), access.into());
        BTreeMap::from([
            ("User-Agent".into(), "pan.baidu.com".into()),
            ("Referer".into(), "https://pan.baidu.com/".into()),
        ])
    } else {
        BTreeMap::from([("Authorization".into(), format!("Bearer {}", access))])
    };
    if provider_id == "123" {
        headers.insert("Platform".into(), "open_platform".into());
    }
    Ok(Credentials {
        provider_data: Default::default(),
        query,
        cookie_store: None,
        oauth: Some(oauth),
        headers,
        refresh_token: data["refresh_token"]
            .as_str()
            .map(str::to_owned)
            .or(previous_refresh),
        expires_at: expires,
    })
}
pub async fn login(
    app: &tauri::AppHandle,
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    provider_id: String,
    client_id: String,
    client_secret: Option<String>,
    name: String,
    callback_port: u16,
) -> Result<Account, AppError> {
    let (client_id, client_secret) =
        crate::provider_config::client(&provider_id, client_id, client_secret);
    let p = provider(&provider_id)?;
    if matches!(provider_id.as_str(), "115" | "alipan-open") {
        return Err(error("OAUTH_PROVIDER", "115 请使用扫码登录"));
    }
    if client_id.trim().is_empty() {
        return Err(error(
            "OAUTH_CONFIG",
            "此开发包缺少网盘登录配置，请更新应用或联系开发者",
        ));
    }
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, if registered_redirect(&provider_id).is_some(){0}else{callback_port}))
        .await
        .map_err(|_| error("OAUTH_LISTENER", "无法监听本机 OAuth 回调端口"))?;
    let port = listener.local_addr().map_err(AppError::io)?.port();
    let host = if provider_id == "onedrive" {
        "localhost"
    } else {
        "127.0.0.1"
    };
    let redirect = registered_redirect(&provider_id).map(str::to_owned).unwrap_or_else(||format!("http://{}:{}/oauth/callback", host, port));
    let state = uuid::Uuid::new_v4().to_string();
    let verifier = verifier();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let (send, receive) = tokio::sync::oneshot::channel();
    let callback_state=CallbackState{expected:state.clone(),send:Arc::new(Mutex::new(Some(send)))};
    let _custom_guard=if registered_redirect(&provider_id).is_some(){Some(CustomCallbackGuard::new(app,&redirect,callback_state.clone())?)}else{None};
    let router=Router::new().route("/oauth/callback",get(callback)).with_state(callback_state);
    let shutdown = tokio_util::sync::CancellationToken::new();
    let cancel = shutdown.clone();
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(cancel.cancelled_owned())
            .await;
    });
    struct Guard(
        tokio_util::sync::CancellationToken,
        tokio::task::JoinHandle<()>,
    );
    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.cancel();
            self.1.abort();
        }
    }
    let _guard = Guard(shutdown, server);
    let mut auth = url::Url::parse(p.auth).unwrap();
    {
        let mut q = auth.query_pairs_mut();
        q.extend_pairs([
            ("response_type", "code"),
            ("client_id", client_id.trim()),
            ("redirect_uri", redirect.as_str()),
            ("state", state.as_str()),
        ]);
        if !matches!(provider_id.as_str(), "baidu" | "123") {
            q.append_pair("code_challenge", challenge.as_str())
                .append_pair("code_challenge_method", "S256");
        }
        if !p.scope.is_empty() {
            q.append_pair("scope", p.scope);
        }
        if provider_id == "google" {
            q.append_pair("access_type", "offline")
                .append_pair("prompt", "consent");
        }
        if provider_id == "dropbox" {
            q.append_pair("token_access_type", "offline");
        }
    }
    app.opener()
        .open_url(auth.as_str(), None::<&str>)
        .map_err(|_| error("OAUTH_BROWSER", "无法打开系统浏览器"))?;
    let code = tokio::time::timeout(Duration::from_secs(300), receive)
        .await
        .map_err(|_| error("OAUTH_TIMEOUT", "登录超时，请重试"))?
        .map_err(|_| error("OAUTH_CANCELLED", "登录回调已关闭"))??;
    if let Some(window)=app.get_webview_window("main") {
        let _=window.show();let _=window.unminimize();let _=window.set_focus();
    }
    let form = {
        let mut form = url::form_urlencoded::Serializer::new(String::new());
        form.extend_pairs([
            ("grant_type", "authorization_code"),
            ("client_id", client_id.trim()),
            ("code", code.as_str()),
            ("redirect_uri", redirect.as_str()),
        ]);
        if !matches!(provider_id.as_str(), "baidu" | "123") {
            form.append_pair("code_verifier", verifier.as_str());
        }
        if provider_id != "onedrive" {
            if let Some(secret) = client_secret.as_deref().filter(|s| !s.is_empty()) {
                form.append_pair("client_secret", secret);
            }
        }
        form.finish()
    };
    let data = token(gateway, &provider_id, p.token, form).await?;
    let oauth = OAuthSecret {
        client_id: client_id.trim().into(),
        client_secret: if provider_id == "onedrive" {
            None
        } else {
            client_secret
        },
        token_url: p.token.into(),
    };
    let creds = credentials(&provider_id, &data, oauth, None)?;
    let (user_id, display_name) = profile(gateway, &provider_id, &creds).await?;
    accounts.save_login(
        Account {
            id: String::new(),
            provider_id,
            name: if name.is_empty() { display_name } else { name },
            base_url: p.api.into(),
            user_id,
            device_id: String::new(),
            auth_origins: vec![p.api.into()],
        },
        creds,
    )
}
pub async fn refresh(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    account_id: &str,
) -> Result<(), AppError> {
    let account = accounts
        .list()?
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| error("ACCOUNT_MISSING", "账号不存在"))?;
    if account.provider_id == "189" {
        return crate::cloud189::refresh(accounts, gateway, account_id).await;
    }
    if account.provider_id == "pikpak" {
        return crate::pikpak::refresh(accounts, gateway, account_id).await;
    }
    if account.provider_id == "guangya" {
        return crate::guangya::refresh(accounts, gateway, account_id).await;
    }
    if account.provider_id == "aliyun" {
        return crate::aliyun_web::refresh(accounts, gateway, account_id).await;
    }
    let mut old = accounts.credentials(account_id)?;
    let oauth = old
        .oauth
        .take()
        .ok_or_else(|| error("AUTH_EXPIRED", "请重新登录此来源"))?;
    let p = provider(&account.provider_id)?;
    if oauth.token_url != p.token {
        return Err(error("OAUTH_CONFIG", "令牌端点不匹配"));
    }
    let refresh = old
        .refresh_token
        .clone()
        .ok_or_else(|| error("AUTH_EXPIRED", "此账号没有刷新令牌，请重新登录"))?;
    let form = {
        let mut form = url::form_urlencoded::Serializer::new(String::new());
        form.extend_pairs([
            ("refresh_token", refresh.as_str()),
            ("client_id", oauth.client_id.as_str()),
        ]);
        if account.provider_id != "115" {
            form.append_pair("grant_type", "refresh_token");
        }
        if account.provider_id != "onedrive" {
            if let Some(secret) = oauth.client_secret.as_deref() {
                form.append_pair("client_secret", secret);
            }
        }
        form.finish()
    };
    let data = token(gateway, &account.provider_id, p.token, form).await?;
    let creds = credentials(&account.provider_id, &data, oauth, old.refresh_token)?;
    let (subject, _) = if account.provider_id == "115" {
        crate::drive115::verified_identity(gateway, &creds).await?
    } else {
        profile(gateway, &account.provider_id, &creds).await?
    };
    verify_refresh_identity(&account.user_id, &subject)?;
    accounts.save(account, creds)?;
    Ok(())
}
fn verify_refresh_identity(expected: &str, actual: &str) -> Result<(), AppError> {
    if expected.is_empty() || actual.is_empty() || expected != actual {
        return Err(error(
            "REFRESH_IDENTITY",
            "刷新返回的账号身份不匹配，请重新登录",
        ));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    #[test]
    fn registered_provider_redirects_match_electron() {
        assert_eq!(registered_redirect("dropbox"), Some("xbyboxplayer-oauth://callback"));
        assert_eq!(registered_redirect("box"), Some("xbyboxplayer-oauth://callback"));
        assert_eq!(registered_redirect("onedrive"), Some("boxplayer-onedriveoauth://callback"));
        assert_eq!(registered_redirect("google"), None);
    }
    #[test]
    fn custom_callback_validates_route_state_and_delivers_once() {
        let key=uuid::Uuid::new_v4().to_string();
        let (tx,mut rx)=tokio::sync::oneshot::channel();
        custom_callbacks().lock().unwrap().insert(key.clone(),("xbyboxplayer-oauth".into(),CallbackState{expected:key.clone(),send:Arc::new(Mutex::new(Some(tx)))}));
        for suffix in [format!("boxplayer-onedriveoauth://callback?state={key}&code=test"),format!("xbyboxplayer-oauth://wrong?state={key}&code=test"),format!("xbyboxplayer-oauth://callback/wrong?state={key}&code=test"),format!("xbyboxplayer-oauth://callback?state={key}&code=a&code=b"),"xbyboxplayer-oauth://callback?state=wrong&code=test".into()] {
            assert!(accept_custom_callback(&suffix));
            assert!(matches!(rx.try_recv(),Err(tokio::sync::oneshot::error::TryRecvError::Empty)));
        }
        assert!(accept_custom_callback(&format!("xbyboxplayer-oauth://callback?state={key}&code=synthetic")));
        assert_eq!(rx.try_recv().unwrap().unwrap(),"synthetic");
        assert!(accept_custom_callback(&format!("xbyboxplayer-oauth://callback?state={key}&code=replay")));
        custom_callbacks().lock().unwrap().remove(&key);
        assert!(!accept_custom_callback("https://example.com"));
    }

    use super::*;
    #[test]
    fn baidu_uses_get_query_but_123_retains_form_post() {
        let form = "grant_type=refresh_token&refresh_token=synthetic%2Brefresh&client_id=test";
        let request =
            token_request("baidu", provider("baidu").unwrap().token, form.into()).unwrap();
        assert_eq!(request.method, "GET");
        assert!(request.body.is_none());
        assert_eq!(
            url::Url::parse(&request.url)
                .unwrap()
                .query_pairs()
                .find(|(k, _)| k == "refresh_token")
                .unwrap()
                .1,
            "synthetic+refresh"
        );
        let request = token_request("123", provider("123").unwrap().token, form.into()).unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(request.body.unwrap(), form.as_bytes());
    }
    #[test]
    fn alipan_refresh_sends_json_and_preserves_refresh_token_characters() {
        let request=token_request("alipan-open",crate::alipan::TOKEN,"grant_type=refresh_token&refresh_token=synthetic%2Brefresh&client_id=test&client_secret=secret".into()).unwrap();
        assert_eq!(request.headers["Content-Type"], "application/json");
        assert_eq!(request.method, "POST");
        let body: serde_json::Value = serde_json::from_slice(&request.body.unwrap()).unwrap();
        assert_eq!(body["refresh_token"], "synthetic+refresh");
        assert_eq!(body["grant_type"], "refresh_token");
    }
    #[test]
    fn credential_refresh_keeps_native_query_and_previous_refresh() {
        let secret = OAuthSecret {
            client_id: "test".into(),
            client_secret: None,
            token_url: provider("baidu").unwrap().token.into(),
        };
        let creds = credentials(
            "baidu",
            &serde_json::json!({"access_token":"replacement","expires_in":3600}),
            secret,
            Some("retained".into()),
        )
        .unwrap();
        assert_eq!(creds.query["access_token"], "replacement");
        assert!(!creds
            .headers
            .keys()
            .any(|h| h.eq_ignore_ascii_case("authorization")));
        assert_eq!(creds.refresh_token.as_deref(), Some("retained"));
    }
    #[test]
    fn business_expiration_codes_are_provider_specific() {
        let response = |value: serde_json::Value| crate::gateway::HttpResponse {
            status: 200,
            headers: Default::default(),
            body: serde_json::to_vec(&value).unwrap(),
            final_url: String::new(),
        };
        assert!(needs_refresh(
            "baidu",
            &response(serde_json::json!({"errno":111}))
        ));
        assert!(!needs_refresh(
            "baidu",
            &response(serde_json::json!({"errno":-9}))
        ));
        assert!(needs_refresh(
            "guangya",
            &response(serde_json::json!({"message":"accessToken 已过期"}))
        ));
        assert!(!needs_refresh(
            "guangya",
            &response(serde_json::json!({"message":"permission denied"}))
        ));
        assert!(needs_refresh(
            "123",
            &response(serde_json::json!({"code":401}))
        ));
        assert!(!needs_refresh(
            "google",
            &response(serde_json::json!({"code":401}))
        ));
        assert!(needs_refresh(
            "aliyun",
            &response(serde_json::json!({"code":"AccessTokenExpired"}))
        ));
    }
    #[test]
    fn pkce_verifier_is_random_and_valid_length() {
        let a = verifier();
        let b = verifier();
        assert_ne!(a, b);
        assert!((43..=128).contains(&a.len()));
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(a.as_bytes())).len(),
            43
        );
    }
    #[test]
    fn refreshed_identity_must_match_existing_subject() {
        assert!(verify_refresh_identity("stable-a", "stable-a").is_ok());
        for (expected, actual) in [("stable-a", "stable-b"), ("", "stable-a"), ("stable-a", "")] {
            assert_eq!(
                verify_refresh_identity(expected, actual).unwrap_err().code,
                "REFRESH_IDENTITY"
            );
        }
    }
    #[tokio::test]
    async fn state_mismatch_does_not_consume_callback() {
        let (send, mut receive) = tokio::sync::oneshot::channel();
        let state = CallbackState {
            expected: "expected".into(),
            send: Arc::new(Mutex::new(Some(send))),
        };
        let result = callback(
            State(state.clone()),
            Query(Callback {
                state: Some("wrong".into()),
                code: Some("code".into()),
                error: None,
            }),
        )
        .await;
        assert_eq!(result.0, axum::http::StatusCode::BAD_REQUEST);
        assert!(receive.try_recv().is_err());
        callback(
            State(state),
            Query(Callback {
                state: Some("expected".into()),
                code: Some("ok".into()),
                error: None,
            }),
        )
        .await;
        assert_eq!(receive.await.unwrap().unwrap(), "ok");
    }
}

async fn profile(
    gateway: &Arc<Gateway>,
    provider: &str,
    credentials: &Credentials,
) -> Result<(String, String), AppError> {
    let (method, url, id_path, name_path) = match provider {
        "alipan-open" => (
            "POST",
            "https://openapi.alipan.com/adrive/v1.0/user/getDriveInfo",
            "/user_id",
            "/name",
        ),
        "onedrive" => (
            "GET",
            "https://graph.microsoft.com/v1.0/me",
            "/id",
            "/displayName",
        ),
        "google" => (
            "GET",
            "https://www.googleapis.com/drive/v3/about?fields=user(permissionId,displayName)",
            "/user/permissionId",
            "/user/displayName",
        ),
        "dropbox" => (
            "POST",
            "https://api.dropboxapi.com/2/users/get_current_account",
            "/account_id",
            "/name/display_name",
        ),
        "box" => ("GET", "https://api.box.com/2.0/users/me", "/id", "/name"),
        "baidu" => (
            "GET",
            "https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo&vip_version=v2",
            "/uk",
            "/netdisk_name",
        ),
        "123" => (
            "GET",
            "https://open-api.123pan.com/api/v1/user/info",
            "/data/uid",
            "/data/nickname",
        ),
        _ => return Err(error("OAUTH_PROVIDER", "此来源尚未接入账号信息验证")),
    };
    let mut url = url::Url::parse(url).unwrap();
    url.query_pairs_mut().extend_pairs(&credentials.query);
    let mut headers = credentials.headers.clone();
    headers.insert("Content-Type".into(), "application/json".into());
    let response = gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: provider.into(),
            account_id: String::new(),
            method: method.into(),
            url: url.into(),
            headers,
            body: if method == "POST" {
                Some(if provider == "alipan-open" {
                    b"{}".to_vec()
                } else {
                    b"null".to_vec()
                })
            } else {
                None
            },
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    if response.status != 200 {
        return Err(error("ACCOUNT_PROFILE", "获取账号信息失败，请重新登录"));
    }
    let data: serde_json::Value = serde_json::from_slice(&response.body)
        .map_err(|_| error("ACCOUNT_PROFILE", "账号信息响应无效"))?;
    if data["errno"].as_i64().is_some_and(|v| v != 0)
        || data["code"].as_i64().is_some_and(|v| v != 0)
    {
        return Err(error("ACCOUNT_PROFILE", "账号信息验证失败"));
    }
    let value = data
        .pointer(id_path)
        .or_else(|| {
            if provider == "123" {
                data.pointer("/data/userId")
            } else {
                None
            }
        })
        .ok_or_else(|| error("ACCOUNT_PROFILE", "账号信息缺少稳定标识"))?;
    let id = value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_u64().map(|n| n.to_string()))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("ACCOUNT_PROFILE", "账号标识无效"))?;
    Ok((
        id,
        data.pointer(name_path)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(provider)
            .into(),
    ))
}
pub fn needs_refresh(provider: &str, response: &crate::gateway::HttpResponse) -> bool {
    if response.status == 401 {
        return true;
    }
    let Ok(data) = serde_json::from_slice::<serde_json::Value>(&response.body) else {
        return false;
    };
    match provider {
        "189" => ["errorCode", "code", "res_code"]
            .iter()
            .any(|key| data[*key].as_str() == Some("InvalidSessionKey")),
        "baidu" => matches!(data["errno"].as_i64(), Some(110 | 111)),
        "guangya" => {
            let message = data["message"]
                .as_str()
                .or_else(|| data["msg"].as_str())
                .or_else(|| data["error"].as_str())
                .unwrap_or("")
                .to_lowercase();
            data["code"].as_i64() == Some(401)
                || data["code"].as_str() == Some("401")
                || ((message.contains("access token") || message.contains("accesstoken"))
                    && ["invalid", "expired", "无效", "过期"]
                        .iter()
                        .any(|part| message.contains(part)))
        }
        "123" | "115" => data["code"].as_i64() == Some(401) || data["code"].as_str() == Some("401"),
        "aliyun" | "alipan-open" => matches!(
            data["code"].as_str(),
            Some("AccessTokenExpired" | "InvalidAccessToken" | "AccessTokenInvalid")
        ),
        _ => false,
    }
}
