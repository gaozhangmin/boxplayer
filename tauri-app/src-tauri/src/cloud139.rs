//! Native token validation and request signing for the retained 139 protocol.
use crate::{
    accounts::{Account, Accounts, Credentials},
    gateway::{Gateway, Headers, HttpRequest},
    settings::AppError,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use md5::{Digest, Md5};
use serde_json::{json, Value};
use std::sync::Arc;
const ROUTE: &str = "https://user-njs.yun.139.com/user/route/qryRoutePolicy";
const UA:&str="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
fn error(message: &str) -> AppError {
    AppError::new("CLOUD139", message, false)
}
fn encode(value: &str) -> String {
    let mut encoded = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char)
        } else {
            encoded.push_str(&format!("%{byte:02X}"))
        }
    }
    encoded
}
fn signature(body: &str, date: &str, random: &str) -> String {
    let mut encoded = encode(body).into_bytes();
    encoded.sort_unstable();
    let body = STANDARD.encode(encoded);
    let first = format!("{:x}", Md5::digest(body.as_bytes()));
    let second = format!("{:x}", Md5::digest(format!("{date}:{random}").as_bytes()));
    format!("{:X}", Md5::digest(format!("{first}{second}").as_bytes()))
}
fn signed_headers(authorization: &str, body: &str, route: bool) -> Headers {
    let date = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let random = uuid::Uuid::new_v4().simple().to_string()[..16].to_owned();
    let sign = signature(body, &date, &random);
    let mut headers = Headers::from(
        [
            ("Accept", "application/json, text/plain, */*"),
            ("CMS-DEVICE", "default"),
            ("Content-Type", "application/json;charset=UTF-8"),
            ("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8"),
            ("User-Agent", UA),
            ("Origin", "https://yun.139.com"),
            ("Referer", "https://yun.139.com/w/"),
            (
                "x-DeviceInfo",
                "||9|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||",
            ),
            ("x-huawei-channelSrc", "10000034"),
            ("x-inner-ntwk", "2"),
            ("x-m4c-caller", "PC"),
            ("x-m4c-src", "10002"),
            ("Inner-Hcy-Router-Https", "1"),
            ("x-SvcType", "1"),
            ("mcloud-channel", "1000101"),
            ("mcloud-client", "10701"),
            ("mcloud-version", "7.14.0"),
        ]
        .map(|(k, v)| (k.into(), v.into())),
    );
    headers.insert("Authorization".into(), format!("Basic {authorization}"));
    headers.insert("mcloud-sign".into(), format!("{date},{random},{sign}"));
    if !route {
        headers.extend(
            [
                ("Caller", "web"),
                ("mcloud-route", "001"),
                ("x-yun-api-version", "v1"),
                ("x-yun-app-channel", "10000034"),
                ("x-yun-channel-source", "10000034"),
                (
                    "x-yun-client-info",
                    "||9|7.14.0|chrome|120.0.0.0|||windows 10||zh-CN|||dW5kZWZpbmVk||",
                ),
                ("x-yun-module-type", "100"),
                ("x-yun-svc-type", "1"),
            ]
            .map(|(k, v)| (k.into(), v.into())),
        )
    }
    headers
}
fn parse_authorization(input: &str) -> Result<(String, String, Option<u64>), AppError> {
    if input.len() > 16384 {
        return Err(error("移动云盘令牌过长"));
    }
    let input = input.trim();
    let input = if input
        .get(..6)
        .is_some_and(|v| v.eq_ignore_ascii_case("Basic "))
    {
        input[6..].trim()
    } else {
        input
    };
    let decoded = STANDARD
        .decode(input)
        .map_err(|_| error("移动云盘 Authorization 格式无效"))?;
    let decoded =
        String::from_utf8(decoded).map_err(|_| error("移动云盘 Authorization 格式无效"))?;
    let mut parts = decoded.splitn(3, ':');
    let _prefix = parts.next();
    let account = parts
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("移动云盘令牌缺少账号"))?;
    let token = parts
        .next()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("移动云盘令牌不完整"))?;
    let expires = token
        .split('|')
        .nth(3)
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|v| *v > 0)
        .map(|ms| ms / 1000);
    Ok((input.into(), account.into(), expires))
}
fn routed_url(value: &str) -> Result<url::Url, AppError> {
    let url = url::Url::parse(value).map_err(|_| error("移动云盘路由地址无效"))?;
    let host = url.host_str().unwrap_or("");
    if url.scheme() != "https"
        || !(host == "yun.139.com"
            || host.ends_with(".yun.139.com")
            || host == "ose.caiyun.feixin.10086.cn")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.port().is_some()
    {
        return Err(error("移动云盘路由不属于支持的官方服务"));
    }
    Ok(url)
}
pub fn sign_request(request: &mut HttpRequest) -> Result<(), AppError> {
    if request.provider_id != "139" || request.account_id.is_empty() {
        return Ok(());
    }
    let authorization = request
        .headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("authorization"))
        .map(|(_, v)| v.clone())
        .ok_or_else(|| error("移动云盘缺少账号凭据"))?;
    let (token, _, _) = parse_authorization(&authorization)?;
    let body = std::str::from_utf8(request.body.as_deref().unwrap_or(b"{}"))
        .map_err(|_| error("移动云盘请求正文无效"))?;
    let url = url::Url::parse(&request.url).map_err(|_| error("移动云盘请求地址无效"))?;
    let headers = signed_headers(&token, body, url.as_str() == ROUTE);
    for (name, value) in headers {
        request
            .headers
            .retain(|key, _| !key.eq_ignore_ascii_case(&name));
        request.headers.insert(name, value);
    }
    Ok(())
}
pub async fn login(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    name: String,
    authorization: String,
) -> Result<Account, AppError> {
    let (token, user, expires_at) = parse_authorization(&authorization)?;
    let body = serde_json::to_string(
        &json!({"userInfo":{"userType":1,"accountType":1,"accountName":user},"modAddrType":1}),
    )
    .unwrap();
    let response = gateway
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: "139".into(),
            account_id: String::new(),
            method: "POST".into(),
            url: ROUTE.into(),
            headers: signed_headers(&token, &body, true),
            body: Some(body.into_bytes()),
            timeout_ms: Some(30000),
            proxy: None,
        })
        .await?;
    let data: Value =
        serde_json::from_slice(&response.body).map_err(|_| error("移动云盘路由响应无效"))?;
    if response.status != 200
        || data["success"] == false
        || ["9000", "9008", "9100"].contains(&data["code"].as_str().unwrap_or(""))
    {
        return Err(error("移动云盘认证失败，请重新获取登录令牌"));
    }
    let routes = data
        .pointer("/data/routePolicyList")
        .or_else(|| data.get("routePolicyList"))
        .and_then(Value::as_array)
        .ok_or_else(|| error("移动云盘未返回路由"))?;
    let route = routes
        .iter()
        .find(|item| item["modName"] == "personal")
        .or_else(|| routes.first())
        .ok_or_else(|| error("移动云盘未返回个人空间路由"))?;
    let url = routed_url(
        route["httpsUrl"]
            .as_str()
            .filter(|s| !s.is_empty())
            .or_else(|| route["httpUrl"].as_str())
            .ok_or_else(|| error("移动云盘未返回个人空间地址"))?,
    )?;
    let origin = url.origin().ascii_serialization();
    let mut origins = vec![origin, "https://yun.139.com".into()];
    origins.sort();
    origins.dedup();
    accounts.save_login(
        Account {
            id: String::new(),
            provider_id: "139".into(),
            name: if name.trim().is_empty() {
                "移动云盘".into()
            } else {
                name
            },
            base_url: url.into(),
            user_id: user,
            device_id: String::new(),
            auth_origins: origins,
        },
        Credentials {
            headers: Headers::from([("Authorization".into(), format!("Basic {token}"))]),
            expires_at,
            ..Default::default()
        },
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signature_matches_javascript_unicode_and_uri_encoding() {
        assert_eq!(
            signature(
                r#"{"name":"电影 !测试","value":"~'()*"}"#,
                "2026-11-06 12:34:56",
                "abcdefghijklmnop"
            ),
            "4A28593BAF7858AAB6C5B4DEC7F353E7"
        );
    }
    #[test]
    fn token_has_stable_subject_and_expiry() {
        let token = STANDARD.encode("prefix:synthetic-account:opaque|a|b|1700000000000");
        let (normalized, subject, expires) =
            parse_authorization(&format!("Basic {token}")).unwrap();
        assert_eq!(normalized, token);
        assert_eq!(subject, "synthetic-account");
        assert_eq!(expires, Some(1700000000));
        assert!(parse_authorization("invalid!").is_err());
        assert!(parse_authorization(&STANDARD.encode("prefix::secret")).is_err());
    }
    #[test]
    fn official_route_boundaries() {
        for url in [
            "https://personal-kd-njs.yun.139.com/hcy",
            "https://ose.caiyun.feixin.10086.cn/orchestration",
        ] {
            assert!(routed_url(url).is_ok())
        }
        for url in [
            "https://yun.139.com.evil.test",
            "https://evil.test",
            "http://yun.139.com",
            "https://user:pass@yun.139.com",
            "https://yun.139.com/?token=x",
        ] {
            assert!(routed_url(url).is_err())
        }
    }
}
