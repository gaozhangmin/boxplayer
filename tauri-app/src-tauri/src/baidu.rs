//! Baidu download protocol: token remains in the native query context.
use crate::{
    commands::Backend,
    gateway::{Headers, HttpRequest, ResolvedMedia},
    settings::AppError,
};
fn error(message: &str) -> AppError {
    AppError::new("BAIDU", message, false)
}
pub async fn resolve(
    state: &Backend,
    account_id: &str,
    file_id: &str,
) -> Result<ResolvedMedia, AppError> {
    let account = state
        .accounts
        .list()?
        .into_iter()
        .find(|a| a.id == account_id && a.provider_id == "baidu")
        .ok_or_else(|| error("百度账号不存在"))?;
    let fsid = file_id
        .parse::<u64>()
        .map_err(|_| error("百度文件标识无效"))?;
    let q = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs([
            ("method", "filemetas"),
            ("fsids", serde_json::to_string(&[fsid]).unwrap().as_str()),
            ("dlink", "1"),
            ("thumb", "0"),
            ("extra", "1"),
            ("needmedia", "1"),
            ("detail", "1"),
        ])
        .finish();
    let response = state
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "baidu".into(),
            account_id: account_id.into(),
            method: "GET".into(),
            url: format!("https://pan.baidu.com/rest/2.0/xpan/multimedia?{}", q),
            headers: Headers::new(),
            body: None,
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    if response.status != 200 {
        return Err(error("百度取链请求失败"));
    }
    let data: serde_json::Value =
        serde_json::from_slice(&response.body).map_err(|_| error("百度取链响应无效"))?;
    if data["errno"].as_i64() != Some(0) {
        return Err(error("百度取链返回错误，请重新登录或检查下载权限"));
    }
    let info = data["list"]
        .as_array()
        .and_then(|rows| {
            rows.iter().find(|item| {
                item["fs_id"]
                    .as_u64()
                    .or_else(|| item["fs_id"].as_str().and_then(|s| s.parse::<u64>().ok()))
                    == Some(fsid)
            })
        })
        .ok_or_else(|| error("百度未返回此文件详情"))?;
    let dlink = info["dlink"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("百度未返回下载地址，请检查下载权限"))?;
    let mut url = url::Url::parse(dlink).map_err(|_| error("百度下载地址无效"))?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(error("百度下载地址无效"));
    }
    let credentials = state.accounts.credentials(account_id)?;
    let token = credentials
        .query
        .get("access_token")
        .ok_or_else(|| error("百度账号缺少访问令牌"))?;
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .filter(|(k, _)| k != "access_token")
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    url.set_query(None);
    url.query_pairs_mut()
        .extend_pairs(pairs)
        .append_pair("access_token", token);
    state.prepared_media.insert(ResolvedMedia {
        schema_version: 1,
        source_id: account.id.clone(),
        account_id: account.id,
        file_id: file_id.into(),
        url: url.into(),
        headers: Headers::from([
            ("User-Agent".into(), "pan.baidu.com".into()),
            ("Referer".into(), "https://pan.baidu.com/".into()),
        ]),
        expires_at: None,
    })
}
