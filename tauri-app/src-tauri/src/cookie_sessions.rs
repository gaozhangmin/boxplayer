//! Account-scoped HTTP cookie jars; serialization is returned only to the Rust vault.
use crate::settings::AppError;
use reqwest::{cookie::CookieStore as ReqwestCookieStore, Client};
use reqwest_cookie_store::CookieStoreMutex;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
#[derive(Clone)]
struct Session {
    jar: Arc<CookieStoreMutex>,
    client: Client,
    proxy_revision:u64,
}
#[derive(Default)]
pub struct CookieSessions(Mutex<HashMap<String, Session>>);
fn error() -> AppError {
    AppError::new("COOKIE_SESSION", "登录 Cookie 会话不可用", true)
}
impl CookieSessions {
    pub fn ensure(&self, id: &str, snapshot: Option<&str>) -> Result<(), AppError> {
        let mut sessions = self.0.lock().map_err(|_| error())?;
        if sessions.contains_key(id) {
            return Ok(());
        }
        if id.is_empty() || sessions.len() >= 64 {
            return Err(error());
        }
        let store = match snapshot {
            Some(value) => {
                cookie_store::serde::json::load(value.as_bytes()).map_err(|_| error())?
            }
            None => cookie_store::CookieStore::default(),
        };
        let jar = Arc::new(CookieStoreMutex::new(store));
        let proxy_revision=crate::network_proxy::revision();
        let client = crate::network_proxy::builder()
            .cookie_provider(jar.clone())
            .build()
            .map_err(|_| error())?;
        sessions.insert(id.into(), Session { jar, client, proxy_revision });
        Ok(())
    }
    pub fn client(&self, id: &str) -> Option<Client> {
        let mut sessions=self.0.lock().ok()?;let session=sessions.get_mut(id)?;let revision=crate::network_proxy::revision();if session.proxy_revision!=revision{session.client=crate::network_proxy::builder().cookie_provider(session.jar.clone()).build().ok()?;session.proxy_revision=revision;}Some(session.client.clone())
    }
    pub fn jar(&self, id: &str) -> Option<Arc<CookieStoreMutex>> {
        self.0.lock().ok()?.get(id).map(|s| s.jar.clone())
    }
    pub fn snapshot(&self, id: &str) -> Result<String, AppError> {
        let jar = self.jar(id).ok_or_else(error)?;
        let store = jar.lock().map_err(|_| error())?;
        let mut bytes = Vec::new();
        cookie_store::serde::json::save_incl_expired_and_nonpersistent(&store, &mut bytes)
            .map_err(|_| error())?;
        String::from_utf8(bytes).map_err(|_| error())
    }
    pub fn headers(&self, id: &str, url: &str) -> Result<String, AppError> {
        let jar = self.jar(id).ok_or_else(error)?;
        let url = url::Url::parse(url).map_err(|_| error())?;
        Ok(jar
            .cookies(&url)
            .and_then(|h| h.to_str().ok().map(str::to_owned))
            .unwrap_or_default())
    }
    pub fn remove(&self, id: &str) {
        if let Ok(mut sessions) = self.0.lock() {
            sessions.remove(id);
        }
    }
    pub fn move_session(&self, from: &str, to: &str) -> Result<(), AppError> {
        let mut sessions = self.0.lock().map_err(|_| error())?;
        let session = sessions.remove(from).ok_or_else(error)?;
        sessions.insert(to.into(), session);
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cookies_keep_domain_path_secure_and_account_boundaries_after_restore() {
        let sessions = CookieSessions::default();
        sessions.ensure("a", None).unwrap();
        sessions.ensure("b", None).unwrap();
        let jar = sessions.jar("a").unwrap();
        let origin = url::Url::parse("https://drive.example.test/private/").unwrap();
        jar.lock()
            .unwrap()
            .parse(
                "auth=synthetic; Domain=example.test; Path=/private; Secure; HttpOnly",
                &origin,
            )
            .unwrap();
        assert!(sessions
            .headers("a", "https://drive.example.test/private/file")
            .unwrap()
            .contains("auth=synthetic"));
        assert_eq!(
            sessions
                .headers("a", "http://drive.example.test/private/file")
                .unwrap(),
            ""
        );
        assert_eq!(
            sessions
                .headers("a", "https://drive.example.test/public")
                .unwrap(),
            ""
        );
        assert_eq!(
            sessions
                .headers("a", "https://example.test.evil/private/file")
                .unwrap(),
            ""
        );
        assert_eq!(
            sessions
                .headers("b", "https://drive.example.test/private/file")
                .unwrap(),
            ""
        );
        let snapshot = sessions.snapshot("a").unwrap();
        sessions.remove("a");
        sessions.ensure("a", Some(&snapshot)).unwrap();
        assert!(sessions
            .headers("a", "https://drive.example.test/private/file")
            .unwrap()
            .contains("auth=synthetic"));
    }
}
