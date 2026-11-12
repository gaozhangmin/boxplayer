use crate::{accounts::Account, commands::Backend, settings::AppError};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Endpoints {
    pub primary: String,
    pub backup_addresses: BTreeMap<String, String>,
    pub selected_line_name: String,
}
fn invalid(message: &str) -> AppError {
    AppError::new("SERVER_ENDPOINT", message, false)
}
fn address(value: &str) -> Result<String, AppError> {
    let parsed =
        url::Url::parse(value.trim()).map_err(|_| invalid("请输入有效的 HTTP 或 HTTPS 地址"))?;
    if !matches!(parsed.scheme(), "http" | "https")
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(invalid(
            "端点需为 HTTP 或 HTTPS 地址，且不能包含账号、查询参数或片段",
        ));
    }
    Ok(parsed.to_string().trim_end_matches('/').to_owned())
}
impl Endpoints {
    fn edit(&mut self, old: Option<&str>, name: &str, url: &str) -> Result<(), AppError> {
        let url = address(url)?;
        let key = if name.trim().is_empty() {
            url::Url::parse(&url)
                .unwrap()
                .host_str()
                .unwrap()
                .to_owned()
        } else {
            name.trim().to_owned()
        };
        if ["__primary__", "__proto__", "constructor", "prototype"].contains(&key.as_str())
            || key.len() > 120
        {
            return Err(invalid("请使用其他端点名称"));
        }
        if self
            .backup_addresses
            .keys()
            .any(|k| Some(k.as_str()) != old && k.to_lowercase() == key.to_lowercase())
        {
            return Err(invalid("已存在同名端点"));
        }
        if self.backup_addresses.len() >= 24
            && !old.is_some_and(|o| self.backup_addresses.contains_key(o))
        {
            return Err(invalid("备用端点数量已达上限"));
        }
        if let Some(old) = old {
            self.backup_addresses.remove(old);
            if self.selected_line_name == old {
                self.selected_line_name = key.clone()
            }
        }
        self.backup_addresses.insert(key, url);
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultState {
    pub account: Account,
    pub endpoints: Endpoints,
}
pub async fn update(
    state: &Backend,
    account_id: String,
    action: String,
    name: Option<String>,
    old_name: Option<String>,
    url: Option<String>,
) -> Result<ResultState, AppError> {
    let mut account = state
        .accounts
        .list()?
        .into_iter()
        .find(|a| {
            a.id == account_id && matches!(a.provider_id.as_str(), "plex" | "jellyfin" | "emby")
        })
        .ok_or_else(|| invalid("服务器账号不存在"))?;
    let mut secret = state.accounts.credentials(&account_id)?;
    let mut endpoints: Endpoints =
        serde_json::from_value(secret.provider_data["endpoints"].clone()).unwrap_or_else(|_| {
            Endpoints {
                primary: account.base_url.clone(),
                backup_addresses: serde_json::from_value(
                    secret.provider_data["backupAddresses"].clone(),
                )
                .unwrap_or_default(),
                selected_line_name: String::new(),
            }
        });
    let mut changed = true;
    match action.as_str() {
        "get" => changed = false,
        "save" => endpoints.edit(
            old_name.as_deref(),
            name.as_deref().unwrap_or(""),
            url.as_deref().unwrap_or(""),
        )?,
        "remove" => {
            let key = name.as_deref().unwrap_or("");
            endpoints.backup_addresses.remove(key);
            if endpoints.selected_line_name == key {
                endpoints.selected_line_name.clear()
            }
        }
        "select" => {
            let key = name.unwrap_or_default();
            if !key.is_empty() && !endpoints.backup_addresses.contains_key(&key) {
                return Err(invalid("端点不存在"));
            }
            endpoints.selected_line_name = key
        }
        _ => return Err(invalid("端点操作无效")),
    };
    if changed {
        let target = if endpoints.selected_line_name.is_empty() {
            endpoints.primary.clone()
        } else {
            endpoints
                .backup_addresses
                .get(&endpoints.selected_line_name)
                .ok_or_else(|| invalid("端点不存在"))?
                .clone()
        };
        // Only this explicit endpoint-management command may authorize a user-entered server origin.
        let origin = url::Url::parse(&target)
            .map_err(|_| invalid("端点无效"))?
            .origin()
            .ascii_serialization();
        if !account.auth_origins.contains(&origin) {
            if account.auth_origins.len() >= 32 {
                return Err(invalid("授权端点数量已达上限"));
            }
            account.auth_origins.push(origin)
        }
        let previous = account.base_url.clone();
        account.base_url = target;
        if !secret.provider_data.is_object() {
            secret.provider_data = serde_json::json!({})
        }
        secret.provider_data["endpoints"] = serde_json::to_value(&endpoints).unwrap();
        account = state.accounts.save(account, secret)?;
        if previous != account.base_url {
            state.gateway.revoke_account(&account_id).await;
        }
    }
    Ok(ResultState { account, endpoints })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rename_preserves_selected_and_rejects_duplicate_or_credential_url() {
        let mut e = Endpoints::default();
        e.edit(None, "LAN", "http://localhost:8096").unwrap();
        e.selected_line_name = "LAN".into();
        e.edit(Some("LAN"), "Home", "https://example.org/emby/")
            .unwrap();
        assert_eq!(e.selected_line_name, "Home");
        assert!(!e.backup_addresses.contains_key("LAN"));
        assert!(e.edit(None, "home", "http://localhost").is_err());
        assert!(e.edit(None, "Other", "https://a:b@example.org").is_err());
        assert!(e
            .edit(None, "Other", "https://example.org?token=x")
            .is_err());
    }
}
