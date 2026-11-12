use crate::{
    accounts::{Account, Credentials},
    commands::Backend,
    gateway::{Headers, HttpRequest},
    settings::AppError,
};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri_plugin_opener::OpenerExt;
#[derive(Default)]
pub struct Sessions(Mutex<HashMap<String, Pending>>);
#[derive(Clone)]
struct Pending {
    created: Instant,
    user_id: String,
    device_id: String,
    resources: Vec<serde_json::Value>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Discovery {
    session_id: String,
    resources: Vec<Resource>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    id: String,
    name: String,
    connections: usize,
}
fn resource_id(row: &serde_json::Value) -> String {
    row["clientIdentifier"].as_str().unwrap_or("").to_owned()
}
fn connections(row: &serde_json::Value) -> Vec<(String, String)> {
    let mut remote = 0;
    let mut result = Vec::new();
    for value in row["connections"].as_array().into_iter().flatten() {
        let Some(uri) = value["uri"].as_str().and_then(|v| url::Url::parse(v).ok()) else {
            continue;
        };
        if !matches!(uri.scheme(), "http" | "https")
            || uri.host_str().is_none()
            || !uri.username().is_empty()
            || uri.password().is_some()
            || uri.query().is_some()
            || uri.fragment().is_some()
        {
            continue;
        }
        let key = if value["local"].as_bool() == Some(true) {
            "Local".into()
        } else if value["relay"].as_bool() == Some(true) {
            "Relay".into()
        } else {
            remote += 1;
            if remote == 1 {
                "Remote".into()
            } else {
                format!("Remote_{}", remote)
            }
        };
        result.push((key, uri.to_string().trim_end_matches('/').to_owned()));
    }
    result
}
fn preferred(rows: &[(String, String)]) -> Option<&String> {
    rows.iter()
        .rev()
        .find(|(key, _)| key == "Local")
        .or_else(|| rows.iter().find(|(key, _)| key == "Remote"))
        .or_else(|| rows.iter().rev().find(|(key, _)| key == "Relay"))
        .map(|(_, uri)| uri)
}
pub fn cancel(state: &Backend, id: &str) {
    state.plex_sessions.0.lock().unwrap().remove(id);
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedResources {
    accounts: Vec<Account>,
    failed: usize,
}
pub async fn save(
    state: &Backend,
    id: String,
    selected: Vec<String>,
    name: String,
) -> Result<SavedResources, AppError> {
    let pending = {
        let mut sessions = state.plex_sessions.0.lock().unwrap();
        sessions.retain(|_, v| v.created.elapsed() < Duration::from_secs(300));
        sessions
            .get(&id)
            .cloned()
            .ok_or_else(|| error("Plex 资源选择已失效，请重新连接"))?
    };
    let mut selected = selected;
    selected.sort();
    selected.dedup();
    let rows: Vec<_> = pending
        .resources
        .iter()
        .filter(|r| selected.contains(&resource_id(r)))
        .collect();
    if rows.is_empty() || rows.len() != selected.len() || rows.len() > 32 {
        return Err(error("请选择有效的 Plex 服务器"));
    }
    let mut saved = Vec::new();
    let mut failed = 0;
    for row in rows {
        let lines = connections(row);
        let base_url = preferred(&lines)
            .ok_or_else(|| error("Plex 无可用连接"))?
            .clone();
        let token = row["accessToken"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("Plex 未返回服务器令牌"))?;
        let headers = Headers::from([
            ("Accept".into(), "application/json".into()),
            ("X-Plex-Product".into(), "BoxPlayer".into()),
            ("X-Plex-Client-Identifier".into(), pending.device_id.clone()),
            ("X-Plex-Token".into(), token.into()),
        ]);
        let verified = verify_connection(&state.gateway, &base_url, headers.clone()).await;
        let Some(display) = verified else {
            failed += 1;
            continue;
        };
        let mut origins: Vec<_> = lines
            .iter()
            .filter_map(|(_, uri)| {
                url::Url::parse(uri)
                    .ok()
                    .map(|u| u.origin().ascii_serialization())
            })
            .collect();
        origins.sort();
        origins.dedup();
        if origins.len() > 32 {
            failed += 1;
            continue;
        }
        if !state.plex_sessions.0.lock().unwrap().contains_key(&id) {
            return Err(error("Plex 资源选择已取消"));
        }
        match state.accounts.save_login(Account{id:String::new(),provider_id:"plex".into(),name:if name.trim().is_empty(){display}else{name.trim().to_owned()},base_url,user_id:pending.user_id.clone(),device_id:pending.device_id.clone(),auth_origins:origins},Credentials{headers,provider_data:serde_json::json!({"plexResourceId":resource_id(row),"backupAddresses":lines.into_iter().collect::<std::collections::BTreeMap<_,_>>() }),..Default::default()}){Ok(account)=>saved.push(account),Err(_)=>failed+=1}
    }
    if saved.is_empty() {
        return Err(error("所选 Plex 服务器均无法连接或保存，请检查连接后重试"));
    }
    state.plex_sessions.0.lock().unwrap().remove(&id);
    Ok(SavedResources {
        accounts: saved,
        failed,
    })
}

fn error(message: &str) -> AppError {
    AppError::new("PLEX_LOGIN", message, false)
}
fn subject(profile: &serde_json::Value) -> Result<String, AppError> {
    let id = profile["id"].as_u64().map(|n| n.to_string()).or_else(|| {
        profile["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    });
    id.filter(|id| id.len() <= 128 && id != "0")
        .ok_or_else(|| error("Plex 未返回稳定账号身份"))
}
async fn api(
    gateway: &std::sync::Arc<crate::gateway::Gateway>,
    method: &str,
    url: String,
    headers: Headers,
) -> Result<serde_json::Value, AppError> {
    let result = gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "plex".into(),
            account_id: String::new(),
            method: method.into(),
            url,
            headers,
            body: None,
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    if result.status != 200 && result.status != 201 {
        return Err(error("Plex 登录请求失败"));
    }
    serde_json::from_slice(&result.body).map_err(|_| error("Plex 登录响应无效"))
}
async fn verify_connection(
    gateway: &std::sync::Arc<crate::gateway::Gateway>,
    base_url: &str,
    headers: Headers,
) -> Option<String> {
    for path in ["identity", ""] {
        if let Ok(result) = api(
            gateway,
            "GET",
            format!("{}/{}", base_url, path),
            headers.clone(),
        )
        .await
        {
            let container = result.get("MediaContainer").unwrap_or(&result);
            if let Some(display) = container["friendlyName"]
                .as_str()
                .or_else(|| container["machineIdentifier"].as_str())
                .or_else(|| container["identifier"].as_str())
                .or_else(|| container["name"].as_str())
            {
                return Some(display.to_owned());
            }
        }
    }
    None
}
pub async fn login(app: &tauri::AppHandle, state: &Backend) -> Result<Discovery, AppError> {
    let device_id = uuid::Uuid::new_v4().to_string();
    let mut headers = Headers::from([
        ("Accept".into(), "application/json".into()),
        ("X-Plex-Product".into(), "BoxPlayer".into()),
        ("X-Plex-Client-Identifier".into(), device_id.clone()),
    ]);
    let pin = api(
        &state.gateway,
        "POST",
        "https://plex.tv/api/v2/pins?strong=true".into(),
        headers.clone(),
    )
    .await?;
    let id = pin["id"]
        .as_u64()
        .ok_or_else(|| error("Plex 未返回 PIN ID"))?;
    let code = pin["code"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("Plex 未返回 PIN"))?;
    let query = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs([
            ("clientID", device_id.as_str()),
            ("code", code),
            ("context[device][product]", "BoxPlayer"),
        ])
        .finish();
    app.opener()
        .open_url(
            format!("https://app.plex.tv/auth/#?{}", query),
            None::<&str>,
        )
        .map_err(|_| error("无法打开 Plex 登录页"))?;
    let token = tokio::time::timeout(std::time::Duration::from_secs(180), async {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            let q = url::form_urlencoded::Serializer::new(String::new())
                .append_pair("code", code)
                .finish();
            let result = api(
                &state.gateway,
                "GET",
                format!("https://plex.tv/api/v2/pins/{}?{}", id, q),
                headers.clone(),
            )
            .await?;
            if let Some(token) = result["authToken"].as_str().filter(|s| !s.is_empty()) {
                break Ok::<_, AppError>(token.to_owned());
            }
        }
    })
    .await
    .map_err(|_| error("Plex 登录超时"))??;
    headers.insert("X-Plex-Token".into(), token);
    let profile = api(
        &state.gateway,
        "GET",
        "https://plex.tv/api/v2/user".into(),
        headers.clone(),
    )
    .await?;
    let user_id = subject(&profile)?;
    let resources = api(
        &state.gateway,
        "GET",
        "https://plex.tv/api/v2/resources?includeRelay=1&includeHttps=1".into(),
        headers.clone(),
    )
    .await?;
    let resources: Vec<_> = resources
        .as_array()
        .into_iter()
        .flatten()
        .filter(|r| {
            let provides = r["provides"].as_str().unwrap_or("").to_ascii_lowercase();
            (provides.split(',').any(|s| s.trim() == "server")
                || r["product"]
                    .as_str()
                    .unwrap_or("")
                    .to_ascii_lowercase()
                    .contains("plex media server"))
                && r["accessToken"].as_str().is_some_and(|s| !s.is_empty())
                && !resource_id(r).is_empty()
                && !connections(r).is_empty()
        })
        .cloned()
        .collect();
    let public = resources
        .iter()
        .map(|r| Resource {
            id: resource_id(r),
            name: r["name"].as_str().unwrap_or("Plex").to_owned(),
            connections: connections(r).len(),
        })
        .collect();
    let session_id = uuid::Uuid::new_v4().to_string();
    let mut sessions = state.plex_sessions.0.lock().unwrap();
    sessions.retain(|_, value| value.created.elapsed() < Duration::from_secs(300));
    sessions.insert(
        session_id.clone(),
        Pending {
            created: Instant::now(),
            user_id,
            device_id,
            resources,
        },
    );
    Ok(Discovery {
        session_id,
        resources: public,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn verifies_selected_server_with_native_headers_before_saving_and_falls_back_to_root() {
        use axum::{routing::get, Json, Router};
        use std::sync::Arc;
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener,Router::new().route("/identity",get(||async{axum::http::StatusCode::NOT_FOUND})).route("/",get(|headers:axum::http::HeaderMap|async move{assert_eq!(headers["x-plex-token"],"synthetic-only");Json(serde_json::json!({"MediaContainer":{"friendlyName":"Verified server"}}))}))).await.unwrap()
        });
        let gateway = crate::gateway::Gateway::new(Arc::new(|_| {
            Box::pin(async { Err(error("unused test refresh")) })
        }))
        .unwrap();
        assert_eq!(
            verify_connection(
                &gateway,
                &base,
                Headers::from([("X-Plex-Token".into(), "synthetic-only".into())])
            )
            .await
            .as_deref(),
            Some("Verified server")
        );
        task.abort();
    }
    #[test]
    fn discovered_connections_prefer_local_and_public_metadata_never_includes_tokens() {
        let row = serde_json::json!({"clientIdentifier":"server","name":"Test","accessToken":"synthetic-private","connections":[{"uri":"https://remote.test:32400"},{"uri":"https://relay.test","relay":true},{"uri":"http://localhost:32400","local":true},{"uri":"https://user:secret@bad.test"},{"uri":"https://bad.test?token=x"}]});
        let lines = connections(&row);
        assert_eq!(lines.len(), 3);
        assert_eq!(preferred(&lines).unwrap(), "http://localhost:32400");
        let public = Discovery {
            session_id: "session".into(),
            resources: vec![Resource {
                id: resource_id(&row),
                name: "Test".into(),
                connections: lines.len(),
            }],
        };
        let json = serde_json::to_string(&public).unwrap();
        assert!(!json.contains("synthetic-private"));
        assert!(!json.contains("accessToken"));
    }
    #[test]
    fn plex_subject_is_server_confirmed_not_a_token_or_device_id() {
        assert_eq!(
            subject(&serde_json::json!({"id":12345,"username":"person"})).unwrap(),
            "12345"
        );
        assert_eq!(
            subject(&serde_json::json!({"id":"stable-user"})).unwrap(),
            "stable-user"
        );
        assert!(
            subject(&serde_json::json!({"username":"name-only","authToken":"synthetic"})).is_err()
        );
        assert!(subject(&serde_json::json!({"id":0})).is_err());
    }
}
