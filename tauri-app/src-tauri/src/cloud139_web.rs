//! Interactive login through the provider's own isolated web page.
use crate::{accounts::{Account, Accounts}, gateway::Gateway, settings::AppError};
use std::sync::{Arc, Mutex};
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn error(message: &str) -> AppError {
    AppError::new("CLOUD139_WEB_LOGIN", message, false)
}

fn provider_navigation(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            ["139.com", "10086.cn", "cmpassport.com", "cytxl.com.cn"]
                .iter()
                .any(|domain| host == *domain || host.strip_suffix(domain).is_some_and(|prefix| prefix.ends_with('.')))
        })
}

struct LoginWindow(tauri::WebviewWindow);
impl Drop for LoginWindow {
    fn drop(&mut self) {
        let _ = self.0.destroy();
    }
}

pub async fn login(
    app: &tauri::AppHandle,
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    name: String,
) -> Result<Account, AppError> {
    let id = uuid::Uuid::new_v4();
    let callback = format!("https://yun.139.com/boxplayer-login/{id}");
    let script = include_str!("cloud139_web.js").replace(
        "__BOXPLAYER_CALLBACK__",
        &serde_json::to_string(&callback).expect("string serialization"),
    );
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let pending = Arc::new(Mutex::new(Some(sender)));
    let navigation = pending.clone();
    let url = url::Url::parse("https://yun.139.com/w/").expect("fixed provider URL");
    let window = WebviewWindowBuilder::new(app, format!("cloud139-login-{id}"), WebviewUrl::External(url))
        .title("中国移动云盘登录")
        .inner_size(1020., 720.)
        .incognito(true)
        .initialization_script(script)
        .on_navigation(move |url| {
            if url.as_str().split_once('#').is_some_and(|(base, _)| base == callback) {
                let token = url.fragment().and_then(|fragment| {
                    url::form_urlencoded::parse(fragment.as_bytes()).next()
                        .filter(|(_, value)| value.is_empty())
                        .map(|(value, _)| value.into_owned())
                });
                if let Some(token) = token {
                    if let Some(sender) = navigation.lock().unwrap().take() {
                        let _ = sender.send(token);
                    }
                }
                return false;
            }
            provider_navigation(url)
        })
        .build()
        .map_err(|_| error("无法打开中国移动云盘登录窗口"))?;
    let _guard = LoginWindow(window.clone());
    let _ = window.set_zoom(0.8);
    let closed = tokio_util::sync::CancellationToken::new();
    let close_signal = closed.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            close_signal.cancel();
            pending.lock().unwrap().take();
        }
    });
    let token = tokio::time::timeout(std::time::Duration::from_secs(300), receiver)
        .await
        .map_err(|_| error("登录超时，请重试"))?
        .map_err(|_| error("登录窗口已关闭"))?;
    tokio::select! {
        biased;
        _ = closed.cancelled() => Err(error("登录窗口已关闭")),
        result = crate::cloud139::login(accounts, gateway, name, token) => result,
    }
}
