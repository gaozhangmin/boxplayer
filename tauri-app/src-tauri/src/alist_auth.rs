//! AList password/OTP login. The resulting token never returns to the WebView.
use crate::{
    accounts::{Account, Accounts, Credentials},
    gateway::{Gateway, Headers, HttpRequest},
    settings::AppError,
};
use std::sync::Arc;
fn error(message: &str) -> AppError {
    AppError::new("ALIST_LOGIN", message, false)
}
fn endpoint(base: &url::Url, path: &str) -> String {
    format!("{}/{}", base.as_str().trim_end_matches('/'), path)
}
fn body(username: &str, password: &str, otp: Option<&str>) -> Vec<u8> {
    let mut data = serde_json::json!({"username":username,"password":password});
    if let Some(otp) = otp.filter(|s| !s.is_empty()) {
        data["otp_code"] = otp.into();
    }
    serde_json::to_vec(&data).unwrap()
}
pub async fn login(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    base_url: String,
    name: String,
    username: String,
    password: String,
    otp: Option<String>,
) -> Result<Account, AppError> {
    let base = url::Url::parse(&base_url).map_err(|_| error("AList 地址无效"))?;
    if !matches!(base.scheme(), "http" | "https")
        || base.host_str().is_none()
        || !base.username().is_empty()
        || base.password().is_some()
        || base.query().is_some()
        || base.fragment().is_some()
    {
        return Err(error("AList 地址不能包含凭据或查询参数"));
    }
    let device = uuid::Uuid::new_v4().to_string();
    let headers = Headers::from([
        ("Content-Type".into(), "application/json".into()),
        ("Client-Id".into(), device.clone()),
    ]);
    let response = gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "alist".into(),
            account_id: String::new(),
            method: "POST".into(),
            url: endpoint(&base, "api/auth/login"),
            headers: headers.clone(),
            body: Some(body(&username, &password, otp.as_deref())),
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    let data: serde_json::Value =
        serde_json::from_slice(&response.body).map_err(|_| error("AList 登录响应无效"))?;
    if response.status != 200 || data["code"].as_i64() != Some(200) {
        return Err(error("AList 登录失败，请检查账号、密码及二步验证码"));
    }
    let token = data["data"]["token"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("AList 未返回访问令牌"))?;
    let mut headers = headers;
    headers.insert("Authorization".into(), token.into());
    let response = gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "alist".into(),
            account_id: String::new(),
            method: "GET".into(),
            url: endpoint(&base, "api/me"),
            headers: headers.clone(),
            body: None,
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    let profile: serde_json::Value =
        serde_json::from_slice(&response.body).map_err(|_| error("AList 用户信息无效"))?;
    if response.status != 200 || profile["code"].as_i64() != Some(200) {
        return Err(error("AList 无法验证登录账号"));
    }
    let subject = &profile["data"]["id"];
    let subject = subject
        .as_str()
        .map(str::to_owned)
        .or_else(|| subject.as_u64().map(|v| v.to_string()))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("AList 缺少账号标识"))?;
    accounts.save_login(
        Account {
            id: String::new(),
            provider_id: "alist".into(),
            name,
            base_url: base.to_string(),
            user_id: subject,
            device_id: device,
            auth_origins: vec![base.origin().ascii_serialization()],
        },
        Credentials {
            headers,
            ..Default::default()
        },
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn optional_otp_and_base_path_are_preserved() {
        let data: serde_json::Value =
            serde_json::from_slice(&body("test-user", "synthetic-password", Some("123456")))
                .unwrap();
        assert_eq!(data["otp_code"], "123456");
        assert_eq!(data["password"], "synthetic-password");
        let data: serde_json::Value =
            serde_json::from_slice(&body("test-user", "synthetic-password", None)).unwrap();
        assert!(data.get("otp_code").is_none());
        assert_eq!(
            endpoint(
                &url::Url::parse("https://nas.test/alist/").unwrap(),
                "api/me"
            ),
            "https://nas.test/alist/api/me"
        );
    }
    #[derive(Default)]
    struct MemoryVault(std::sync::Mutex<std::collections::HashMap<String, String>>);
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
    #[tokio::test]
    async fn login_verifies_identity_and_retains_token_only_in_vault() {
        use axum::{
            routing::{get, post},
            Json, Router,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let app = Router::new()
            .route(
                "/prefix/api/auth/login",
                post(|Json(body): Json<serde_json::Value>| async move {
                    assert_eq!(body["username"], "test-user");
                    assert_eq!(body["password"], "synthetic-password");
                    assert_eq!(body["otp_code"], "123456");
                    Json(serde_json::json!({"code":200,"data":{"token":"synthetic-native-token"}}))
                }),
            )
            .route(
                "/prefix/api/me",
                get(|headers: axum::http::HeaderMap| async move {
                    assert_eq!(headers["authorization"], "synthetic-native-token");
                    assert!(headers.contains_key("client-id"));
                    Json(serde_json::json!({"code":200,"data":{"id":17,"username":"test-user"}}))
                }),
            );
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let dir = tempfile::tempdir().unwrap();
        let accounts = Accounts::with_vault(dir.path(), Box::<MemoryVault>::default()).unwrap();
        let gateway = Gateway::new(Arc::new(|_| {
            Box::pin(async { Err(error("test refresh unused")) })
        }))
        .unwrap();
        let base = format!("http://{}/prefix/", address);
        let account = login(
            &accounts,
            &gateway,
            base.clone(),
            "NAS".into(),
            "test-user".into(),
            "synthetic-password".into(),
            Some("123456".into()),
        )
        .await
        .unwrap();
        assert_eq!(account.user_id, "17");
        assert!(!serde_json::to_string(&account)
            .unwrap()
            .contains("synthetic-native-token"));
        assert_eq!(
            accounts.credentials(&account.id).unwrap().headers["Authorization"],
            "synthetic-native-token"
        );
        let again = login(
            &accounts,
            &gateway,
            base,
            "NAS".into(),
            "test-user".into(),
            "synthetic-password".into(),
            Some("123456".into()),
        )
        .await
        .unwrap();
        assert_eq!(account.id, again.id);
        assert_eq!(accounts.list().unwrap().len(), 1);
        server.abort();
    }
}
