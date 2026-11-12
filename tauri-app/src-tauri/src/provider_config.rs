//! Application registration defaults only; no user-account import.
pub fn site_url() -> Result<String, crate::settings::AppError> {
    let values: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/provider-config.json"
    )))
    .unwrap_or_default();
    let url = values["BOXPLAYER_SITE_URL"]
        .as_str()
        .unwrap_or("")
        .trim_end_matches('/');
    let parsed = url::Url::parse(url).map_err(|_| {
        crate::settings::AppError::new("ACCOUNT_CONFIG", "此开发包缺少账号服务配置", false)
    })?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != "/"
    {
        return Err(crate::settings::AppError::new(
            "ACCOUNT_CONFIG",
            "账号服务配置无效",
            false,
        ));
    }
    Ok(url.into())
}
pub fn client(
    provider: &str,
    supplied_id: String,
    supplied_secret: Option<String>,
) -> (String, Option<String>) {
    if !supplied_id.trim().is_empty() {
        return (
            supplied_id.trim().into(),
            supplied_secret.filter(|s| !s.is_empty()),
        );
    }
    let keys = match provider {
        "trakt" => ("TRAKT_CLIENT_ID", ""),
        "alipan-open" => ("ALIYUN_APP_ID", "ALIYUN_APP_SECRET"),
        "baidu" => ("BAIDU_APP_ID", "BAIDU_APP_SECRET"),
        "123" => ("CLOUD123_APP_ID", "CLOUD123_APP_SECRET"),
        "115" => ("DRIVE115_APP_ID", "DRIVE115_APP_SECRET"),
        "onedrive" => ("ONEDRIVE_CLIENT_ID", ""),
        "google" => ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
        "dropbox" => ("DROPBOX_APP_KEY", "DROPBOX_APP_SECRET"),
        "box" => ("BOX_CLIENT_ID", "BOX_CLIENT_SECRET"),
        "guangya" => ("GUANGYA_CLIENT_ID", ""),
        "189" => ("CLOUD189_APP_ID", ""),
        "pikpak" => ("PIKPAK_CLIENT_ID", "PIKPAK_CLIENT_SECRET"),
        _ => ("", ""),
    };
    let values: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("OUT_DIR"),
        "/provider-config.json"
    )))
    .unwrap_or_default();
    (
        values[keys.0].as_str().unwrap_or("").into(),
        supplied_secret.filter(|s| !s.is_empty()).or_else(|| {
            values[keys.1]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        }),
    )
}
