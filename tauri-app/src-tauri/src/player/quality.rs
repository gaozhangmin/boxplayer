use super::{Player, Snapshot};
use crate::{
    accounts::Account,
    commands::Backend,
    gateway::{Headers, HttpRequest, RefreshHook, ResolvedMedia},
    server_playback::{self, PlaybackContext},
    settings::AppError,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashSet, sync::Arc};
use tauri::{Manager, WebviewWindow};
use url::Url;

const ORIGINAL: &str = "original";
const ALI_PREVIEW: &str = "https://openapi.alipan.com/adrive/v1.0/openFile/getVideoPreviewPlayInfo";
const CLOUD123_PREVIEW: &str = "https://open-api.123pan.com/api/v1/video/transcode/list";
const SERVER_QUALITIES: &[(&str, &str)] = &[
    ("auto", "自动"),
    ("max", "最高（直接播放）"),
    ("120000000", "120 Mbps"),
    ("80000000", "80 Mbps"),
    ("60000000", "60 Mbps"),
    ("40000000", "40 Mbps"),
    ("20000000", "20 Mbps"),
    ("15000000", "15 Mbps"),
    ("10000000", "10 Mbps"),
    ("8000000", "8 Mbps"),
    ("6000000", "6 Mbps"),
    ("4000000", "4 Mbps"),
    ("3000000", "3 Mbps"),
    ("1500000", "1.5 Mbps"),
    ("720000", "720 Kbps"),
    ("420000", "420 Kbps"),
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AliFile {
    drive_id: String,
    file_id: String,
}

#[derive(Serialize)]
pub(crate) struct Quality {
    id: String,
    label: String,
}

impl Quality {
    fn new(id: &str, label: &str) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
        }
    }
}

struct Candidate {
    quality: Quality,
    order: u64,
    url: Url,
}

fn failure(message: &str) -> AppError {
    AppError::new("PLAYER_QUALITY", message, true)
}

pub(super) fn stale() -> AppError {
    AppError::new("SESSION_STALE", "播放条目已变化", true)
}

fn number(value: &Value) -> u64 {
    value
        .as_u64()
        .or_else(|| value.as_str()?.parse().ok())
        .unwrap_or_default()
}

fn candidates(provider: &str, response: &Value) -> Vec<Candidate> {
    let list = match provider {
        "aliyun" | "alipan-open" => {
            &response["video_preview_play_info"]["live_transcoding_task_list"]
        }
        "115" => &response["data"]["video_url"],
        "123" => &response["data"]["list"],
        _ => return vec![],
    };
    let mut rows: Vec<_> = list
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            let (id, label, order) = match provider {
                "115" => {
                    let value = row
                        .get("definition")
                        .filter(|value| !value.is_null())
                        .unwrap_or(&row["definition_n"]);
                    let definition = number(value);
                    let fallback = match definition {
                        1 => "标清".into(),
                        2 => "高清".into(),
                        3 => "超清".into(),
                        4 => "1080P".into(),
                        5 => "4K".into(),
                        0 | 100 => return None,
                        other => format!("清晰度 {other}"),
                    };
                    let label = row["title"]
                        .as_str()
                        .filter(|value| !value.trim().is_empty())
                        .map(str::to_owned)
                        .unwrap_or(fallback);
                    (definition.to_string(), label, definition)
                }
                "123" => {
                    let height = number(&row["height"]);
                    let label = row["resolution"]
                        .as_str()
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_owned)
                        .or_else(|| (height > 0).then(|| format!("{height}p")))?;
                    let order = if height > 0 {
                        height
                    } else {
                        label
                            .trim_end_matches(['p', 'P'])
                            .parse()
                            .unwrap_or_default()
                    };
                    (label.clone(), label, order)
                }
                _ => {
                    if row["status"].as_str() != Some("finished") {
                        return None;
                    }
                    let id = row["template_id"].as_str()?;
                    let height = number(&row["template_height"]);
                    let label = if height > 0 {
                        format!("{height}p")
                    } else {
                        id.into()
                    };
                    (id.into(), label, height)
                }
            };
            if id.trim().is_empty()
                || id == ORIGINAL
                || id.len() > 64
                || id.chars().any(char::is_control)
            {
                return None;
            }
            let url = Url::parse(row["url"].as_str()?).ok()?;
            if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
                return None;
            }
            Some(Candidate {
                quality: Quality {
                    id,
                    label: label.chars().take(96).collect(),
                },
                order,
                url,
            })
        })
        .collect();
    rows.sort_by_key(|row| std::cmp::Reverse(row.order));
    let mut seen = HashSet::new();
    rows.retain(|row| seen.insert(row.quality.id.clone()));
    rows
}

async fn provider_json(
    backend: &Backend,
    account: &Account,
    url: Url,
    body: Option<Value>,
    headers: Headers,
) -> Result<Value, AppError> {
    let response = backend
        .request(HttpRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            provider_id: account.provider_id.clone(),
            account_id: account.id.clone(),
            method: if body.is_some() { "POST" } else { "GET" }.into(),
            url: url.into(),
            headers,
            body: body.map(|body| body.to_string().into_bytes()),
            timeout_ms: Some(10000),
            proxy: None,
        })
        .await?;
    if !(200..300).contains(&response.status) {
        return Err(failure("暂时无法获取网盘画质"));
    }
    serde_json::from_slice(&response.body).map_err(|_| failure("网盘画质响应无效"))
}

async fn preview(
    backend: &Backend,
    account: &Account,
    media: &ResolvedMedia,
) -> Result<(Vec<Candidate>, Headers), AppError> {
    let (data, headers) = match account.provider_id.as_str() {
        "aliyun" | "alipan-open" => {
            let item: AliFile = serde_json::from_str(&media.file_id)
                .map_err(|_| failure("无法识别阿里云盘文件"))?;
            let data = provider_json(backend, account, Url::parse(ALI_PREVIEW).unwrap(), Some(json!({
                "drive_id": item.drive_id, "file_id": item.file_id, "category": "live_transcoding",
                "template_id": "", "url_expire_sec": 14400,
            })), Headers::from([("Content-Type".into(), "application/json".into())])).await?;
            (
                data,
                Headers::from([("Referer".into(), "https://www.aliyundrive.com/".into())]),
            )
        }
        "115" => crate::drive115::video_play(backend, &account.id, &media.file_id).await?,
        "123" => {
            let mut url = Url::parse(CLOUD123_PREVIEW).unwrap();
            url.query_pairs_mut().append_pair("fileId", &media.file_id);
            let data = provider_json(
                backend,
                account,
                url,
                None,
                Headers::from([("Platform".into(), "open_platform".into())]),
            )
            .await?;
            if data["code"].as_i64() != Some(0) {
                return Err(failure("123 云盘暂时无法获取转码画质"));
            }
            (data, Headers::new())
        }
        _ => return Ok((vec![], Headers::new())),
    };
    Ok((candidates(&account.provider_id, &data), headers))
}

fn drive115_stream_host(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        ["115.com", "115cdn.net", "115cdn.com"]
            .iter()
            .any(|domain| {
                host == *domain
                    || host
                        .strip_suffix(domain)
                        .is_some_and(|prefix| prefix.ends_with('.'))
            })
    })
}

async fn transcode(
    backend: &Backend,
    account: &Account,
    mut media: ResolvedMedia,
    quality: &str,
) -> Result<ResolvedMedia, AppError> {
    let (variants, mut headers) = preview(backend, account, &media).await?;
    let variant = variants
        .into_iter()
        .find(|row| row.quality.id == quality)
        .ok_or_else(|| failure("该画质暂不可用，请刷新后重试"))?;
    if account.provider_id == "115" && !drive115_stream_host(&variant.url) {
        headers.retain(|name, _| !name.eq_ignore_ascii_case("Authorization"));
    }
    media.url = variant.url.into();
    media.headers = headers;
    media.expires_at = None;
    Ok(media)
}

fn target(
    window: &WebviewWindow,
    player: &Player,
    session: &str,
    item: &str,
) -> Result<Snapshot, AppError> {
    if window.label() != "player" {
        return Err(failure("仅播放器窗口可调整画质"));
    }
    let snapshot = player.snapshot();
    if session.is_empty() || snapshot.session_id != session || snapshot.item_id != item {
        return Err(stale());
    }
    Ok(snapshot)
}

fn cloud_account(backend: &Backend, snapshot: &Snapshot) -> Result<Option<Account>, AppError> {
    Ok(backend.accounts.list()?.into_iter().find(|account| {
        account.id == snapshot.source_id
            && matches!(
                account.provider_id.as_str(),
                "aliyun" | "alipan-open" | "115" | "123"
            )
    }))
}

fn identity(snapshot: &Snapshot) -> ResolvedMedia {
    ResolvedMedia {
        schema_version: 1,
        source_id: snapshot.source_id.clone(),
        account_id: snapshot.source_id.clone(),
        file_id: snapshot.item_id.clone(),
        url: "boxplayer-queue:".into(),
        headers: Headers::new(),
        expires_at: None,
    }
}

#[tauri::command]
pub(crate) async fn player_cloud_qualities(
    window: WebviewWindow,
    session_id: String,
    item_id: String,
) -> Result<Vec<Quality>, AppError> {
    let backend = window.state::<Backend>();
    let snapshot = target(&window, &backend.player, &session_id, &item_id)?;
    if snapshot.server_selection.is_some() {
        return Ok(SERVER_QUALITIES
            .iter()
            .map(|(id, label)| Quality::new(id, label))
            .collect());
    }
    let Some(account) = cloud_account(&backend, &snapshot)? else {
        return Ok(vec![]);
    };
    let media = backend.gateway.canonical_media(&identity(&snapshot))?;
    let preview = preview(&backend, &account, &media).await;
    let current = target(&window, &backend.player, &session_id, &item_id)?;
    let playing_variant = current.cloud_quality.as_deref().unwrap_or(ORIGINAL) != ORIGINAL;
    let variants = match preview {
        Ok((variants, _)) => variants,
        Err(_) if playing_variant => return Ok(vec![Quality::new(ORIGINAL, "原画")]),
        Err(error) => return Err(error),
    };
    if variants.is_empty() && !playing_variant {
        return Ok(vec![]);
    }
    Ok(std::iter::once(Quality::new(ORIGINAL, "原画"))
        .chain(variants.into_iter().map(|row| row.quality))
        .collect())
}

async fn register_server(
    backend: &Backend,
    window: &WebviewWindow,
    media: ResolvedMedia,
    selection: Arc<server_playback::Selection>,
    quality: String,
) -> Result<(String, Option<PlaybackContext>), AppError> {
    if !SERVER_QUALITIES.iter().any(|(id, _)| *id == quality) {
        return Err(failure("无效的服务器画质"));
    }
    let (variant, context) = server_playback::quality_media(
        &backend.accounts,
        &backend.gateway,
        &media,
        &selection,
        &quality,
    )
    .await?;
    let app = window.app_handle().clone();
    let refresh: RefreshHook = Arc::new(move |media| {
        let (app, selection, quality) = (app.clone(), selection.clone(), quality.clone());
        Box::pin(async move {
            let backend = app.state::<Backend>();
            server_playback::quality_media(
                &backend.accounts,
                &backend.gateway,
                &media,
                &selection,
                &quality,
            )
            .await
            .map(|(media, _)| media)
        })
    });
    Ok((
        backend.gateway.register_variant(variant, refresh).await?,
        context,
    ))
}

#[tauri::command]
pub(crate) async fn player_set_cloud_quality(
    window: WebviewWindow,
    session_id: String,
    item_id: String,
    quality_id: String,
) -> Result<(), AppError> {
    let backend = window.state::<Backend>();
    let snapshot = target(&window, &backend.player, &session_id, &item_id)?;
    if snapshot.cloud_quality.as_deref().unwrap_or(ORIGINAL) == quality_id {
        return Ok(());
    }
    let media = backend.gateway.canonical_media(&identity(&snapshot))?;
    let (proxy, context) = if let Some(selection) = snapshot.server_selection {
        register_server(&backend, &window, media, selection, quality_id.clone()).await?
    } else {
        let account = cloud_account(&backend, &snapshot)?
            .ok_or_else(|| failure("当前来源没有可切换的画质"))?;
        if quality_id == ORIGINAL {
            (backend.gateway.register(media).await?, None)
        } else {
            let variant = transcode(&backend, &account, media, &quality_id).await?;
            let app = window.app_handle().clone();
            let quality = quality_id.clone();
            let refresh: RefreshHook = Arc::new(move |media| {
                let (app, account, quality) = (app.clone(), account.clone(), quality.clone());
                Box::pin(async move {
                    let backend = app.state::<Backend>();
                    transcode(&backend, &account, media, &quality).await
                })
            });
            (
                backend.gateway.register_variant(variant, refresh).await?,
                None,
            )
        }
    };
    let result = backend
        .player
        .switch_cloud_quality(session_id, item_id, quality_id, proxy.clone(), context)
        .await;
    if result.is_err() {
        backend.gateway.revoke(&proxy).await;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn providers_return_only_real_unique_streams() {
        let ali = json!({"video_preview_play_info":{"live_transcoding_task_list":[
            {"template_id":"LD","template_height":360,"status":"finished","url":"https://example.invalid/360.m3u8"},
            {"template_id":"HD","template_height":720,"status":"waiting","url":"https://example.invalid/hd.m3u8"},
            {"template_id":"HD","status":"finished","url":"file:///tmp/test"},
            {"template_id":"LD","template_height":360,"status":"finished","url":"https://example.invalid/duplicate.m3u8"}
        ]}});
        let rows = candidates("aliyun", &ali);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].quality.label, "360p");

        let drive115 = json!({"data":{"video_url":[
            {"definition_n":"4","url":"https://cdn.115cdn.net/1080.m3u8"},
            {"definition":100,"url":"https://cdn.115cdn.net/original.mp4"},
            {"definition":1,"title":"标清","url":"https://cdn.115cdn.net/sd.m3u8"}
        ]}});
        let rows = candidates("115", &drive115);
        assert_eq!(
            rows.iter()
                .map(|row| row.quality.id.as_str())
                .collect::<Vec<_>>(),
            ["4", "1"]
        );
        assert!(drive115_stream_host(&rows[0].url));
        assert!(!drive115_stream_host(
            &Url::parse("https://cdn.115cdn.net.example.invalid/video").unwrap()
        ));

        let cloud123 = json!({"data":{"list":[
            {"resolution":"1080p","height":1080,"url":"https://example.invalid/1080.m3u8"},
            {"height":"360","url":"https://example.invalid/360.m3u8"},
            {"resolution":"720p","url":""}
        ]}});
        let rows = candidates("123", &cloud123);
        assert_eq!(
            rows.iter()
                .map(|row| row.quality.label.as_str())
                .collect::<Vec<_>>(),
            ["1080p", "360p"]
        );
        assert!(candidates("quark", &cloud123).is_empty());
    }
}
