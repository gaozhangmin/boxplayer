//! M3 account boundary: public metadata in SQLite, credentials only in OS vault.
use crate::{
    gateway::{Headers, HttpRequest},
    settings::AppError,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};
use url::Url;

// Dropbox's original in-memory text API uses a separate official content host.
// Permit only that exact write endpoint; never extend arbitrary saved auth origins.
fn dropbox_text_origin(provider: &str, origins: &[String], request: &HttpRequest) -> bool {
    if provider != "dropbox" || request.method != "POST" || !origins.iter().any(|origin| origin == "https://api.dropboxapi.com") { return false; }
    let Ok(url) = Url::parse(&request.url) else { return false; };
    url.origin().ascii_serialization() == "https://content.dropboxapi.com"
        && url.username().is_empty() && url.password().is_none()
        && url.path() == "/2/files/upload" && url.query().is_none() && url.fragment().is_none()
}

fn quark_share_origin(provider: &str, origins: &[String], request: &HttpRequest) -> bool {
    if provider != "quark" || !origins.iter().any(|origin| origin == "https://drive-pc.quark.cn") { return false; }
    let Ok(url) = Url::parse(&request.url) else { return false; };
    url.origin().ascii_serialization() == "https://drive.quark.cn"
        && url.username().is_empty() && url.password().is_none() && url.fragment().is_none()
        && matches!((request.method.as_str(), url.path()),
            ("POST", "/1/clouddrive/share/sharepage/token")
            | ("GET", "/1/clouddrive/share/sharepage/detail")
            | ("POST", "/1/clouddrive/share/sharepage/save"))
}

// Original 123 clear-trash method uses its web host with the same provider account.
// Allow only the fixed original endpoint, not general web-origin authorization.
fn cloud123_clear_origin(provider: &str, origins: &[String], request: &HttpRequest) -> bool {
    if provider != "123" || request.method != "POST" || !origins.iter().any(|origin| origin == "https://open-api.123pan.com") { return false; }
    let Ok(url) = Url::parse(&request.url) else { return false; };
    let query: Vec<_> = url.query_pairs().collect();
    url.origin().ascii_serialization() == "https://www.123pan.com"
        && url.username().is_empty() && url.password().is_none() && url.fragment().is_none()
        && url.path() == "/api/v1/file/trash_delete_all"
        && query.len() == 1 && query[0].0 == "t" && !query[0].1.is_empty()
        && query[0].1.bytes().all(|byte| byte.is_ascii_digit())
}

fn box_text_origin(provider: &str, origins: &[String], request: &HttpRequest) -> bool {
    if provider != "box" || request.method != "POST" || !origins.iter().any(|origin| origin == "https://api.box.com") { return false; }
    let Ok(url) = Url::parse(&request.url) else { return false; };
    url.origin().ascii_serialization() == "https://upload.box.com"
        && url.username().is_empty() && url.password().is_none()
        && url.path() == "/api/2.0/files/content" && url.query().is_none() && url.fragment().is_none()
}

pub const PROVIDERS: &[&str] = &[
    "aliyun",
    "alipan-open",
    "baidu",
    "123",
    "115",
    "quark",
    "pikpak",
    "onedrive",
    "dropbox",
    "box",
    "google",
    "139",
    "189",
    "guangya",
    "smb",
    "nfs",
    "ftp",
    "webdav",
    "alist",
    "jellyfin",
    "emby",
    "plex",
    "boxplayer",
];
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub provider_id: String,
    pub name: String,
    pub base_url: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub device_id: String,
    /// Exact origins authorized to receive these credentials, never suffix matches.
    pub auth_origins: Vec<String>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OAuthSecret {
    pub client_id: String,
    pub client_secret: Option<String>,
    pub token_url: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Credentials {
    #[serde(default)]
    pub query: Headers,
    #[serde(default)]
    pub provider_data: serde_json::Value,
    #[serde(default)]
    pub cookie_store: Option<String>,
    #[serde(default)]
    pub oauth: Option<OAuthSecret>,
    pub headers: Headers,
    pub refresh_token: Option<String>,
    pub expires_at: Option<u64>,
}
pub trait Vault: Send + Sync {
    fn put(&self, id: &str, value: &str) -> Result<(), AppError>;
    fn get(&self, id: &str) -> Result<String, AppError>;
    fn remove(&self, id: &str) -> Result<(), AppError>;
}
use crate::vault::SystemVault;
pub struct Accounts {
    db: Mutex<Connection>,
    login_write: Mutex<()>,
    vault: Box<dyn Vault>,
}
fn invalid() -> AppError {
    AppError::new("ACCOUNT_INVALID", "账号配置无效", false)
}
fn database(_: rusqlite::Error) -> AppError {
    AppError::new("ACCOUNT_STORAGE", "无法读写账号配置", true)
}
fn origin(value: &str) -> Result<String, AppError> {
    let u = Url::parse(value).map_err(|_| invalid())?;
    if !matches!(u.scheme(), "http" | "https")
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return Err(invalid());
    }
    Ok(u.origin().ascii_serialization())
}
impl Accounts {
    pub fn open(dir: &Path) -> Result<Self, AppError> {
        Self::with_vault(dir, Box::new(crate::vault::SessionVault::new(Box::new(SystemVault::new(dir)?))))
    }
    pub(crate) fn with_vault(dir: &Path, vault: Box<dyn Vault>) -> Result<Self, AppError> {
        let db = Connection::open(dir.join("accounts.sqlite")).map_err(database)?;
        db.execute_batch(
            "PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, metadata TEXT NOT NULL); CREATE TABLE IF NOT EXISTS credential_slots(id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE, slot TEXT NOT NULL); CREATE TABLE IF NOT EXISTS pending_vault_deletions(slot TEXT PRIMARY KEY);",
        )
        .map_err(database)?;
        let store = Self {
            db: Mutex::new(db),
            login_write: Mutex::new(()),
            vault,
        };
        {
            let db = store.db.lock().map_err(|_| invalid())?;
            let _ = store.cleanup(&db);
        }
        Ok(store)
    }
    pub fn list(&self) -> Result<Vec<Account>, AppError> {
        let db = self.db.lock().map_err(|_| invalid())?;
        let mut stmt = db
            .prepare("SELECT metadata FROM accounts ORDER BY rowid")
            .map_err(database)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(database)?;
        rows.map(|r| serde_json::from_str(&r.map_err(database)?).map_err(|_| invalid()))
            .collect()
    }
    /// Keep metadata stable while committing a source-owned local transaction.
    pub fn with_current<T>(&self,expected:&Account,work:impl FnOnce()->Result<T,AppError>)->Result<T,AppError>{
        let db=self.db.lock().map_err(|_|invalid())?;
        let body:String=db.query_row("SELECT metadata FROM accounts WHERE id=?1",[&expected.id],|row|row.get(0)).map_err(|_|invalid())?;
        let current:Account=serde_json::from_str(&body).map_err(|_|invalid())?;
        if serde_json::to_value(&current).map_err(|_|invalid())?!=serde_json::to_value(expected).map_err(|_|invalid())? {return Err(invalid());}
        work()
    }
    pub fn save(
        &self,
        mut account: Account,
        credentials: Credentials,
    ) -> Result<Account, AppError> {
        if !PROVIDERS.contains(&account.provider_id.as_str())
            || account.name.trim().is_empty()
            || account.name.len() > 200
            || account.auth_origins.is_empty()
            || account.auth_origins.len() > 32
        {
            return Err(invalid());
        }
        // IDs are generated locally. An update must refer to an existing account of the same provider.
        let db = self.db.lock().map_err(|_| invalid())?;
        if account.id.is_empty() {
            account.id = uuid::Uuid::new_v4().to_string();
        } else {
            let stored: String = db
                .query_row(
                    "SELECT metadata FROM accounts WHERE id=?1",
                    [&account.id],
                    |r| r.get(0),
                )
                .map_err(|_| invalid())?;
            let previous: Account = serde_json::from_str(&stored).map_err(|_| invalid())?;
            if previous.provider_id != account.provider_id {
                return Err(invalid());
            }
        }
        if crate::network_share::supported(&account.provider_id) {
            let value=Url::parse(&account.base_url).map_err(|_|invalid())?;
            if value.scheme()!=account.provider_id||value.host_str().is_none()||!value.username().is_empty()||value.password().is_some()||!account.auth_origins.is_empty(){return Err(invalid())}
        } else { origin(&account.base_url)?; }
        let base = Url::parse(&account.base_url).map_err(|_| invalid())?;
        if base.query().is_some() || base.fragment().is_some() {
            return Err(invalid());
        }
        account.base_url = base.to_string().trim_end_matches('/').to_owned();
        account.auth_origins = account
            .auth_origins
            .iter()
            .map(|v| {
                let u = Url::parse(v).map_err(|_| invalid())?;
                if u.path() != "/" || u.query().is_some() || u.fragment().is_some() {
                    return Err(invalid());
                }
                origin(v)
            })
            .collect::<Result<Vec<_>, _>>()?;
        for (name, value) in &credentials.headers {
            if name.is_empty() || name.contains(['\r', '\n']) || value.contains(['\r', '\n']) {
                return Err(invalid());
            }
        }
        let secret = serde_json::to_string(&credentials).map_err(|_| invalid())?;
        let metadata = serde_json::to_string(&account).map_err(|_| invalid())?;
        // Versioned vault slot makes DB publication atomic; failed DB writes retain old slot.
        let slot = format!("{}:{}", account.id, uuid::Uuid::new_v4());
        self.vault.put(&slot, &secret)?;
        let old: Option<String> = db
            .query_row(
                "SELECT slot FROM credential_slots WHERE id=?1",
                [&account.id],
                |r| r.get(0),
            )
            .optional()
            .map_err(database)?;
        let result = (|| {
            db.execute_batch("BEGIN IMMEDIATE").map_err(database)?;
            db.execute(
                "INSERT INTO accounts VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata",
                params![account.id, metadata],
            )
            .map_err(database)?;
            db.execute(
                "INSERT OR REPLACE INTO credential_slots VALUES(?1,?2)",
                params![account.id, slot],
            )
            .map_err(database)?;
            if let Some(old) = old.as_ref() {
                db.execute(
                    "INSERT OR IGNORE INTO pending_vault_deletions VALUES(?1)",
                    [old],
                )
                .map_err(database)?;
            }
            db.execute_batch("COMMIT").map_err(database)?;
            Ok::<_, AppError>(())
        })();
        if let Err(e) = result {
            let _ = db.execute_batch("ROLLBACK");
            let _ = self.vault.remove(&slot);
            return Err(e);
        }
        let _ = self.cleanup(&db);
        Ok(account)
    }
    pub fn save_login(
        &self,
        mut account: Account,
        credentials: Credentials,
    ) -> Result<Account, AppError> {
        // Serialize identity lookup + publication so simultaneous logins cannot create duplicates.
        let _login = self.login_write.lock().map_err(|_| invalid())?;
        if !account.user_id.is_empty() {
            let base = Url::parse(&account.base_url)
                .map_err(|_| invalid())?
                .to_string()
                .trim_end_matches('/')
                .to_owned();
            if let Some(previous) = self.list()?.into_iter().find(|old| {
                old.provider_id == account.provider_id
                    && old.user_id == account.user_id
                    && old.base_url == base
            }) {
                account.id = previous.id;
            }
        }
        self.save(account, credentials)
    }
    pub fn remove(&self, id: &str) -> Result<(), AppError> {
        let db = self.db.lock().map_err(|_| invalid())?;
        let slot: Option<String> = db
            .query_row("SELECT slot FROM credential_slots WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()
            .map_err(database)?;
        db.execute_batch("BEGIN IMMEDIATE").map_err(database)?;
        let result = (|| {
            if let Some(slot) = slot {
                db.execute(
                    "INSERT OR IGNORE INTO pending_vault_deletions VALUES(?1)",
                    [slot],
                )
                .map_err(database)?;
            }
            db.execute("DELETE FROM credential_slots WHERE id=?1", [id])
                .map_err(database)?;
            db.execute("DELETE FROM accounts WHERE id=?1", [id])
                .map_err(database)?;
            db.execute_batch("COMMIT").map_err(database)?;
            Ok::<_, AppError>(())
        })();
        if let Err(e) = result {
            let _ = db.execute_batch("ROLLBACK");
            return Err(e);
        }
        self.cleanup(&db).map_err(|_| {
            AppError::new(
                "CREDENTIAL_CLEANUP",
                "账号已退出，系统凭据清理未完成，将在下次启动重试",
                true,
            )
        })
    }
    fn cleanup(&self, db: &Connection) -> Result<(), AppError> {
        let mut stmt = db
            .prepare("SELECT slot FROM pending_vault_deletions")
            .map_err(database)?;
        let slots = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(database)?;
        drop(stmt);
        for slot in slots {
            self.vault.remove(&slot)?;
            db.execute("DELETE FROM pending_vault_deletions WHERE slot=?1", [slot])
                .map_err(database)?;
        }
        Ok(())
    }
    pub fn credentials(&self, id: &str) -> Result<Credentials, AppError> {
        let db = self.db.lock().map_err(|_| invalid())?;
        let slot: String = db
            .query_row("SELECT slot FROM credential_slots WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .map_err(|_| invalid())?;
        serde_json::from_str(&self.vault.get(&slot)?).map_err(|_| invalid())
    }
    pub fn sign_date(&self, id: &str, today: &str, completed: bool) -> Result<bool, AppError> {
        let account = self
            .list()?
            .into_iter()
            .find(|a| a.id == id && a.provider_id == "aliyun")
            .ok_or_else(invalid)?;
        let mut credentials = self.credentials(id)?;
        let already = credentials.provider_data["autoSignDate"].as_str() == Some(today);
        if completed && !already {
            if !credentials.provider_data.is_object() {
                return Err(invalid());
            }
            credentials.provider_data["autoSignDate"] = serde_json::json!(today);
            self.save(account, credentials)?;
        }
        Ok(already)
    }
    pub fn media_headers(&self, media: &mut crate::gateway::ResolvedMedia) -> Result<(), AppError> {
        if media.account_id.is_empty() {
            return Ok(());
        }
        let account = self
            .list()?
            .into_iter()
            .find(|a| a.id == media.account_id)
            .ok_or_else(invalid)?;
        if account.auth_origins.contains(&origin(&media.url)?) {
            let mut request = HttpRequest {
                request_id: String::new(),
                provider_id: account.provider_id,
                account_id: account.id,
                method: "GET".into(),
                url: media.url.clone(),
                headers: media.headers.clone(),
                body: None,
                timeout_ms: None,
                proxy: None,
            };
            self.authorize(&mut request)?;
            media.headers = request.headers;
        }
        Ok(())
    }
    pub fn authorize(&self, request: &mut HttpRequest) -> Result<(), AppError> {
        if request.account_id.is_empty() {
            return Ok(());
        }
        let db = self.db.lock().map_err(|_| invalid())?;
        let (metadata,slot):(String,String)=db.query_row("SELECT a.metadata,s.slot FROM accounts a JOIN credential_slots s ON a.id=s.id WHERE a.id=?1",[&request.account_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_| AppError::new("ACCOUNT_MISSING","账号不存在或已退出",false))?;
        let account: Account = serde_json::from_str(&metadata).map_err(|_| invalid())?;
        if account.provider_id != request.provider_id
            || (!account.auth_origins.contains(&origin(&request.url)?)
                && !dropbox_text_origin(&account.provider_id, &account.auth_origins, request)
                && !box_text_origin(&account.provider_id, &account.auth_origins, request)
                && !cloud123_clear_origin(&account.provider_id, &account.auth_origins, request)
                && !quark_share_origin(&account.provider_id, &account.auth_origins, request))
        {
            return Err(AppError::new(
                "ACCOUNT_ORIGIN",
                "该账号未授权此请求目标",
                false,
            ));
        }
        let mut credentials: Credentials =
            serde_json::from_str(&self.vault.get(&slot)?).map_err(|_| invalid())?;
        if crate::alipan::paired_open_request(request){credentials=serde_json::from_value(credentials.provider_data["openApi"].clone()).map_err(|_|AppError::new("ALIYUN_OPEN_AUTH","请完成阿里云盘第二次扫码授权",false))?;}
        if credentials.expires_at.is_some_and(|expires| {
            expires
                <= std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs()
        }) {
            return Err(AppError::new(
                "AUTH_EXPIRED",
                "账号凭据已过期，请重新登录",
                false,
            ));
        }
        if !credentials.query.is_empty() {
            let mut url = Url::parse(&request.url).map_err(|_| invalid())?;
            let pairs: Vec<(String, String)> = url
                .query_pairs()
                .filter(|(key, _)| !credentials.query.contains_key(key.as_ref()))
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();
            url.set_query(None);
            url.query_pairs_mut()
                .extend_pairs(pairs)
                .extend_pairs(credentials.query);
            request.url = url.into();
        }
        for (name, value) in credentials.headers {
            let private = matches!(
                name.to_ascii_lowercase().as_str(),
                "authorization"
                    | "cookie"
                    | "x-api-key"
                    | "client-id"
                    | "x-device-id"
                    | "did"
                    | "dt"
                    | "x-signature"
                    | "x-emby-token"
                    | "x-plex-token"
                    | "x-emby-authorization"
            );
            if private {
                request
                    .headers
                    .retain(|key, _| !key.eq_ignore_ascii_case(&name));
                request.headers.insert(name, value);
            } else if !request
                .headers
                .keys()
                .any(|key| key.eq_ignore_ascii_case(&name))
            {
                request.headers.insert(name, value);
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    #[derive(Default)]
    struct MemoryVault(Mutex<HashMap<String, String>>);
    impl Vault for MemoryVault {
        fn put(&self, id: &str, value: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().insert(id.into(), value.into());
            Ok(())
        }
        fn get(&self, id: &str) -> Result<String, AppError> {
            self.0.lock().unwrap().get(id).cloned().ok_or_else(invalid)
        }
        fn remove(&self, id: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(id);
            Ok(())
        }
    }
    #[test]
    fn sign_dates_survive_reopen_and_remain_account_and_year_bound() {
        use std::sync::Arc;
        #[derive(Clone, Default)]
        struct Shared(Arc<Mutex<HashMap<String, String>>>);
        impl Vault for Shared {
            fn put(&self, id: &str, value: &str) -> Result<(), AppError> {
                self.0.lock().unwrap().insert(id.into(), value.into());
                Ok(())
            }
            fn get(&self, id: &str) -> Result<String, AppError> {
                self.0.lock().unwrap().get(id).cloned().ok_or_else(invalid)
            }
            fn remove(&self, id: &str) -> Result<(), AppError> {
                self.0.lock().unwrap().remove(id);
                Ok(())
            }
        }
        let dir = tempfile::tempdir().unwrap();
        let vault = Shared::default();
        let store = Accounts::with_vault(dir.path(), Box::new(vault.clone())).unwrap();
        let account = store
            .save(
                Account {
                    id: String::new(),
                    provider_id: "aliyun".into(),
                    name: "test".into(),
                    base_url: "https://api.aliyundrive.com".into(),
                    user_id: "test".into(),
                    device_id: String::new(),
                    auth_origins: vec!["https://api.aliyundrive.com".into()],
                },
                Credentials {
                    provider_data: serde_json::json!({"private_key":[1,2,3]}),
                    ..Default::default()
                },
            )
            .unwrap();
        assert!(!store.sign_date(&account.id, "2026-11-07", false).unwrap());
        assert!(!store.sign_date(&account.id, "2026-11-07", true).unwrap());
        drop(store);
        let store = Accounts::with_vault(dir.path(), Box::new(vault)).unwrap();
        assert!(store.sign_date(&account.id, "2026-11-07", false).unwrap());
        assert!(!store.sign_date(&account.id, "2027-11-07", false).unwrap());
        assert!(store.sign_date("missing", "2026-11-07", true).is_err());
        assert_eq!(
            store.credentials(&account.id).unwrap().provider_data["private_key"],
            serde_json::json!([1, 2, 3])
        );
    }
    #[test]
    fn credentials_are_account_and_origin_bound_and_not_in_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let store = Accounts::with_vault(dir.path(), Box::<MemoryVault>::default()).unwrap();
        let a = store
            .save(
                Account {
                    id: String::new(),
                    provider_id: "quark".into(),
                    name: "one".into(),
                    base_url: "https://drive.example/".into(),
                    user_id: String::new(),
                    device_id: String::new(),
                    auth_origins: vec!["https://drive.example".into()],
                },
                Credentials {
                    headers: Headers::from([("Cookie".into(), "test-only-secret".into())]),
                    ..Default::default()
                },
            )
            .unwrap();
        let public = serde_json::to_string(&store.list().unwrap()).unwrap();
        assert!(!public.contains("test-only-secret"));
        let raw = std::fs::read(dir.path().join("accounts.sqlite")).unwrap();
        assert!(!raw.windows(16).any(|s| s == b"test-only-secret"));
        let mut r = HttpRequest {
            request_id: "test".into(),
            provider_id: "quark".into(),
            account_id: a.id,
            method: "GET".into(),
            url: "https://drive.example/list".into(),
            headers: Headers::new(),
            body: None,
            timeout_ms: None,
            proxy: None,
        };
        store.authorize(&mut r).unwrap();
        assert_eq!(r.headers["Cookie"], "test-only-secret");
        r.url = "https://drive.example.evil/list".into();
        assert!(store.authorize(&mut r).is_err());
        r.url = "https://drive.example/list".into();
        r.provider_id = "115".into();
        assert!(store.authorize(&mut r).is_err());
        let original = store.list().unwrap().remove(0);
        store
            .save(
                original.clone(),
                Credentials {
                    headers: Headers::from([("Cookie".into(), "replacement-test".into())]),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(
            store.credentials(&original.id).unwrap().headers["Cookie"],
            "replacement-test"
        );
        store.remove(&original.id).unwrap();
        assert!(store.list().unwrap().is_empty());
        assert!(store.credentials(&original.id).is_err());
        store.remove(&original.id).unwrap();
    }
    #[test]
    fn relogin_preserves_source_identity_but_not_other_accounts() {
        let dir = tempfile::tempdir().unwrap();
        let store = Accounts::with_vault(dir.path(), Box::<MemoryVault>::default()).unwrap();
        let metadata = Account {
            id: String::new(),
            provider_id: "baidu".into(),
            name: "first".into(),
            base_url: "https://pan.baidu.com/".into(),
            user_id: "subject-a".into(),
            device_id: String::new(),
            auth_origins: vec!["https://pan.baidu.com".into()],
        };
        let creds = |token: &str| Credentials {
            query: Headers::from([("access_token".into(), token.into())]),
            ..Default::default()
        };
        let first = store.save_login(metadata.clone(), creds("old")).unwrap();
        let mut second = metadata.clone();
        second.name = "renamed".into();
        second.base_url = "https://pan.baidu.com".into();
        let second = store.save_login(second, creds("new")).unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(store.list().unwrap().len(), 1);
        assert_eq!(
            store.credentials(&first.id).unwrap().query["access_token"],
            "new"
        );
        let mut other = metadata;
        other.user_id = "subject-b".into();
        let other = store.save_login(other, creds("other")).unwrap();
        assert_ne!(first.id, other.id);
        let mut request = HttpRequest {
            request_id: "query-test".into(),
            provider_id: "baidu".into(),
            account_id: first.id,
            method: "GET".into(),
            url: "https://pan.baidu.com/list?access_token=caller&method=list&access_token=second"
                .into(),
            headers: Headers::new(),
            body: None,
            timeout_ms: None,
            proxy: None,
        };
        store.authorize(&mut request).unwrap();
        let url = Url::parse(&request.url).unwrap();
        let tokens: Vec<_> = url
            .query_pairs()
            .filter(|(k, _)| k == "access_token")
            .collect();
        assert_eq!(tokens.len(), 1);
        assert_eq!(tokens[0].1, "new");
        assert!(url.query_pairs().any(|(k, v)| k == "method" && v == "list"));
        request.url = "https://elsewhere.test/list".into();
        assert!(store.authorize(&mut request).is_err());
        assert!(!request.url.contains("new"));
    }
    #[test]
    fn stale_refresh_cannot_restore_a_logged_out_account_and_device_headers_are_bound() {
        let directory = tempfile::tempdir().unwrap();
        let store = Accounts::with_vault(directory.path(), Box::<MemoryVault>::default()).unwrap();
        let creds = || Credentials {
            headers: Headers::from([
                ("Authorization".into(), "Bearer native-account".into()),
                ("x-device-id".into(), "native-device".into()),
                ("x-signature".into(), "native-signature".into()),
            ]),
            ..Default::default()
        };
        let account = store
            .save(
                Account {
                    id: String::new(),
                    provider_id: "aliyun".into(),
                    name: "test".into(),
                    base_url: "https://api.aliyundrive.com".into(),
                    user_id: "test-subject".into(),
                    device_id: "native-device".into(),
                    auth_origins: vec!["https://api.aliyundrive.com".into()],
                },
                creds(),
            )
            .unwrap();
        let mut request = HttpRequest {
            request_id: "device-binding".into(),
            provider_id: "aliyun".into(),
            account_id: account.id.clone(),
            method: "POST".into(),
            url: "https://api.aliyundrive.com/list".into(),
            headers: Headers::from([
                ("AUTHORIZATION".into(), "Bearer other-account".into()),
                ("X-Signature".into(), "caller-signature".into()),
                ("X-Device-ID".into(), "caller-device".into()),
            ]),
            body: None,
            timeout_ms: None,
            proxy: None,
        };
        store.authorize(&mut request).unwrap();
        assert_eq!(request.headers.len(), 3);
        assert_eq!(request.headers["x-device-id"], "native-device");
        assert_eq!(request.headers["x-signature"], "native-signature");
        assert_eq!(request.headers["Authorization"], "Bearer native-account");
        store.remove(&account.id).unwrap();
        assert!(store.save(account, creds()).is_err());
        assert!(store.list().unwrap().is_empty());
    }
    #[test]
    fn dropbox_text_upload_uses_only_the_bound_accounts_vault_headers() {
        let dir = tempfile::tempdir().unwrap();
        let store = Accounts::with_vault(dir.path(), Box::<MemoryVault>::default()).unwrap();
        let account = store.save(Account { id: String::new(), provider_id: "dropbox".into(), name: "fixture".into(), base_url: "https://api.dropboxapi.com".into(), user_id: "owner".into(), device_id: String::new(), auth_origins: vec!["https://api.dropboxapi.com".into()] }, Credentials { headers: [("Authorization".into(), "Bearer synthetic-fixture".into())].into(), ..Default::default() }).unwrap();
        let mut request = HttpRequest { request_id: "fixture".into(), provider_id: "dropbox".into(), account_id: account.id, method: "POST".into(), url: "https://content.dropboxapi.com/2/files/upload".into(), headers: [("authorization".into(), "untrusted-renderer-header".into())].into(), body: None, timeout_ms: None, proxy: None };
        store.authorize(&mut request).unwrap();
        assert_eq!(request.headers.get("Authorization").unwrap(), "Bearer synthetic-fixture");
        assert!(!request.headers.contains_key("authorization"));
        request.url = "https://content.dropboxapi.com/2/files/upload_session/start".into();
        assert!(store.authorize(&mut request).is_err());
        request.url = "https://content.dropboxapi.com.evil.test/2/files/upload".into();
        assert!(store.authorize(&mut request).is_err());
        request.url = "https://content.dropboxapi.com/2/files/upload".into();
        request.provider_id = "google".into();
        assert!(store.authorize(&mut request).is_err());
    }
    #[test]
    fn box_text_upload_uses_only_the_bound_accounts_vault_headers() {
        let dir = tempfile::tempdir().unwrap();
        let store = Accounts::with_vault(dir.path(), Box::<MemoryVault>::default()).unwrap();
        let account = store.save(Account { id: String::new(), provider_id: "box".into(), name: "fixture".into(), base_url: "https://api.box.com".into(), user_id: "owner".into(), device_id: String::new(), auth_origins: vec!["https://api.box.com".into()] }, Credentials { headers: [("Authorization".into(), "Bearer synthetic-fixture".into())].into(), ..Default::default() }).unwrap();
        let mut request = HttpRequest { request_id: "fixture".into(), provider_id: "box".into(), account_id: account.id, method: "POST".into(), url: "https://upload.box.com/api/2.0/files/content".into(), headers: [("authorization".into(), "untrusted-renderer-header".into())].into(), body: None, timeout_ms: None, proxy: None };
        store.authorize(&mut request).unwrap();
        assert_eq!(request.headers.get("Authorization").unwrap(), "Bearer synthetic-fixture");
        assert!(!request.headers.contains_key("authorization"));
        request.url = "https://upload.box.com/api/2.0/files/upload_sessions".into();
        assert!(store.authorize(&mut request).is_err());
        request.url = "https://upload.box.com.evil.test/api/2.0/files/content".into();
        assert!(store.authorize(&mut request).is_err());
        request.url = "https://upload.box.com/api/2.0/files/content".into();
        request.provider_id = "google".into();
        assert!(store.authorize(&mut request).is_err());
    }
    #[test]
    #[ignore = "Writes and removes a unique synthetic entry in the platform credential store"]
    fn platform_vault_roundtrip() {
        let id = format!("test-only-{}", uuid::Uuid::new_v4());
        let directory = tempfile::tempdir().unwrap();
        let vault = SystemVault::new(directory.path()).unwrap();
        let payload = "synthetic-account-test".repeat(1000);
        vault.put(&id, &payload).unwrap();
        let read = vault.get(&id);
        let removed = vault.remove(&id);
        assert_eq!(read.unwrap(), payload);
        removed.unwrap();
        assert!(vault.get(&id).is_err());
    }
    #[test]
    fn source_transaction_requires_current_account_metadata_before_running(){
        let dir=tempfile::tempdir().unwrap();let store=Accounts::with_vault(dir.path(),Box::<MemoryVault>::default()).unwrap();
        let account=store.save(Account{id:String::new(),provider_id:"quark".into(),name:"Original".into(),base_url:"https://drive.example/".into(),user_id:String::new(),device_id:String::new(),auth_origins:vec!["https://drive.example".into()]},Credentials{headers:Headers::from([("Cookie".into(),"test-only".into())]),..Default::default()}).unwrap();
        assert_eq!(store.with_current(&account,||Ok(42)).unwrap(),42);
        let mut changed=account.clone();changed.name="Replacement".into();let called=std::cell::Cell::new(false);
        assert!(store.with_current(&changed,||{called.set(true);Ok(())}).is_err());assert!(!called.get());
        store.remove(&account.id).unwrap();assert!(store.with_current(&account,||{called.set(true);Ok(())}).is_err());assert!(!called.get());
    }
}

#[cfg(test)]
mod dropbox_text_boundary_tests {
    use super::*;
    fn request(url: &str, method: &str) -> HttpRequest {
        HttpRequest { request_id: "fixture".into(), provider_id: "dropbox".into(), account_id: "fixture".into(), method: method.into(), url: url.into(), headers: Default::default(), body: None, timeout_ms: None, proxy: None }
    }
    #[test]
    fn allows_only_the_original_content_upload_endpoint_for_authorized_dropbox_accounts() {
        let origins = vec!["https://api.dropboxapi.com".into()];
        let good = request("https://content.dropboxapi.com/2/files/upload", "POST");
        assert!(dropbox_text_origin("dropbox", &origins, &good));
        assert!(!dropbox_text_origin("google", &origins, &good));
        assert!(!dropbox_text_origin("dropbox", &[], &good));
        for (url, method) in [
            ("https://content.dropboxapi.com/2/files/upload", "GET"),
            ("https://content.dropboxapi.com/2/files/upload_session/start", "POST"),
            ("https://content.dropboxapi.com/2/files/upload?other=1", "POST"),
            ("https://content.dropboxapi.com/2/files/upload#fragment", "POST"),
            ("https://user@content.dropboxapi.com/2/files/upload", "POST"),
            ("http://content.dropboxapi.com/2/files/upload", "POST"),
            ("https://content.dropboxapi.com.evil.test/2/files/upload", "POST"),
        ] { assert!(!dropbox_text_origin("dropbox", &origins, &request(url, method))); }
    }
}

#[cfg(test)]
mod box_text_boundary_tests {
    use super::*;
    #[test]
    fn allows_only_the_original_box_content_endpoint() {
        let origins=vec!["https://api.box.com".into()];
        let mut request=HttpRequest {request_id:"fixture".into(),provider_id:"box".into(),account_id:"fixture".into(),method:"POST".into(),url:"https://upload.box.com/api/2.0/files/content".into(),headers:Default::default(),body:None,timeout_ms:None,proxy:None};
        assert!(box_text_origin("box", &origins, &request));
        assert!(!box_text_origin("dropbox", &origins, &request));
        assert!(!box_text_origin("box", &[], &request));
        for url in ["https://upload.box.com/api/2.0/files/upload_sessions","https://upload.box.com/api/2.0/files/content?extra=1","https://upload.box.com/api/2.0/files/content#fragment","https://user@upload.box.com/api/2.0/files/content","http://upload.box.com/api/2.0/files/content","https://upload.box.com.evil.test/api/2.0/files/content"] {request.url=url.into();assert!(!box_text_origin("box", &origins, &request));}
        request.url="https://upload.box.com/api/2.0/files/content".into();request.method="OPTIONS".into();assert!(!box_text_origin("box", &origins, &request));
    }
}

#[cfg(test)]
mod quark_share_boundary_tests {
    use super::*;
    #[test]
    fn admits_only_original_quark_share_endpoints_for_an_existing_quark_account() {
        let origins=vec!["https://drive-pc.quark.cn".into()];
        let mut request=HttpRequest {request_id:"fixture".into(),provider_id:"quark".into(),account_id:"fixture".into(),method:"POST".into(),url:"https://drive.quark.cn/1/clouddrive/share/sharepage/save?pr=ucpro".into(),headers:Default::default(),body:None,timeout_ms:None,proxy:None};
        assert!(quark_share_origin("quark", &origins, &request));
        assert!(!quark_share_origin("google", &origins, &request));
        assert!(!quark_share_origin("quark", &[], &request));
        for (method,path) in [("POST","token"),("GET","detail")] {
            request.method=method.into();request.url=format!("https://drive.quark.cn/1/clouddrive/share/sharepage/{path}");
            assert!(quark_share_origin("quark", &origins, &request));
        }
        request.method="POST".into();
        for url in ["https://drive.quark.cn/1/clouddrive/file/delete","https://drive.quark.cn/1/clouddrive/share/sharepage/detail","http://drive.quark.cn/1/clouddrive/share/sharepage/save","https://drive.quark.cn.evil.test/1/clouddrive/share/sharepage/save","https://user@drive.quark.cn/1/clouddrive/share/sharepage/save","https://drive.quark.cn/1/clouddrive/share/sharepage/save#fragment"] {
            request.url=url.into();assert!(!quark_share_origin("quark", &origins, &request));
        }
    }
}

#[cfg(test)]
mod cloud123_clear_boundary_tests {
    use super::*;
    #[test]
    fn admits_only_original_123_clear_for_an_existing_open_account() {
        let origins=vec!["https://open-api.123pan.com".into()];
        let mut request=HttpRequest {request_id:"fixture".into(),provider_id:"123".into(),account_id:"fixture".into(),method:"POST".into(),url:"https://www.123pan.com/api/v1/file/trash_delete_all?t=123".into(),headers:Default::default(),body:None,timeout_ms:None,proxy:None};
        assert!(cloud123_clear_origin("123",&origins,&request));
        assert!(!cloud123_clear_origin("google",&origins,&request));
        assert!(!cloud123_clear_origin("123",&[],&request));
        for url in ["http://www.123pan.com/api/v1/file/trash_delete_all?t=1","https://www.123pan.com.evil.test/api/v1/file/trash_delete_all?t=1","https://user@www.123pan.com/api/v1/file/trash_delete_all?t=1","https://www.123pan.com/api/v1/file/trash_delete_all?t=1#fragment","https://www.123pan.com/api/v1/file/trash_delete_all","https://www.123pan.com/api/v1/file/trash_delete_all?t=1&t=2","https://www.123pan.com/api/v1/file/trash_delete_all?t=1&other=2","https://www.123pan.com/api/v1/file/trash_delete_all?t=NaN","https://www.123pan.com/api/v1/file/trash_delete_all?t=","https://www.123pan.com/api/v1/file/delete?t=1"] {
            request.url=url.into();assert!(!cloud123_clear_origin("123",&origins,&request));
        }
        request.url="https://www.123pan.com/api/v1/file/trash_delete_all?t=1".into();request.method="GET".into();assert!(!cloud123_clear_origin("123",&origins,&request));
    }


}
