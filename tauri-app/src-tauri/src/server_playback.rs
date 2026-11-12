//! Native media-server playback negotiation keeps server-supplied credential URLs private.
use crate::{
    accounts::{Account, Accounts},
    gateway::{Gateway, Headers, HttpRequest, HttpResponse, ResolvedMedia},
    prepared_media::PreparedMedia,
    settings::{AppError, ServerPlaybackSettings},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{sync::Arc, time::Instant};
fn error(message: &str) -> AppError {
    AppError::new("SERVER_PLAYBACK", message, false)
}
fn owner(accounts: &Accounts, id: &str) -> Result<Account, AppError> {
    accounts
        .list()?
        .into_iter()
        .find(|a| a.id == id && matches!(a.provider_id.as_str(), "jellyfin" | "emby" | "plex"))
        .ok_or_else(|| error("媒体服务器账号不存在"))
}
fn endpoint(account: &Account, path: &str) -> String {
    format!(
        "{}/{}",
        account.base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}
async fn api(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    account: &Account,
    request_id: String,
    method: &str,
    url: String,
    body: Option<Value>,
) -> Result<HttpResponse, AppError> {
    let mut request = HttpRequest {
        request_id,
        provider_id: account.provider_id.clone(),
        account_id: account.id.clone(),
        method: method.into(),
        url,
        headers: if body.is_some() {
            Headers::from([
                ("Content-Type".into(), "application/json".into()),
                ("Accept".into(), "application/json".into()),
            ])
        } else {
            Headers::from([("Accept".into(), "application/json".into())])
        },
        body: body.map(|value| serde_json::to_vec(&value).unwrap()),
        timeout_ms: Some(30000),
        proxy: None,
    };
    accounts.authorize(&mut request)?;
    let response = gateway.request(request).await?;
    if !(200..300).contains(&response.status) {
        return Err(error(if matches!(response.status, 401 | 403) {
            "服务器拒绝访问，请检查账号与播放权限"
        } else {
            "服务器播放请求失败"
        }));
    }
    Ok(response)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BitrateResult {
    bytes: u64,
    duration_ms: f64,
    bitrate: u64,
    max_streaming_bitrate: u64,
}
pub async fn bitrate(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    account_id: &str,
    request_id: String,
) -> Result<BitrateResult, AppError> {
    let account = owner(accounts, account_id)?;
    if account.provider_id == "plex" {
        return Err(error("Plex 需通过实际媒体文件测试吞吐量"));
    }
    let started = Instant::now();
    let response = api(
        accounts,
        gateway,
        &account,
        request_id,
        "GET",
        endpoint(&account, "Playback/BitrateTest?size=5000000"),
        None,
    )
    .await?;
    let bytes = response.body.len() as u64;
    if bytes != 5000000 {
        return Err(error("服务器没有返回完整的测速数据"));
    }
    let duration_ms = started.elapsed().as_secs_f64().max(0.001) * 1000.0;
    Ok(BitrateResult {
        bytes,
        duration_ms,
        bitrate: ((bytes as f64 * 8000.0 / duration_ms) as u64).max(1),
        max_streaming_bitrate: ((bytes as f64 * 8000.0 / duration_ms) as u64)
            .min(360000000)
            .max(1),
    })
}
fn absolute(account: &Account, value: &str) -> Result<String, AppError> {
    let base = url::Url::parse(&format!("{}/", account.base_url.trim_end_matches('/')))
        .map_err(|_| error("服务器地址无效"))?;
    let url = if let Ok(url) = url::Url::parse(value) {
        url
    } else if value.starts_with('/') {
        let path = base.path().trim_end_matches('/');
        if path.is_empty() || value == path || value.starts_with(&format!("{path}/")) {
            base.join(value).map_err(|_| error("播放地址无效"))?
        } else {
            url::Url::parse(&format!(
                "{}{path}{value}",
                base.origin().ascii_serialization()
            ))
            .map_err(|_| error("播放地址无效"))?
        }
    } else {
        base.join(value).map_err(|_| error("播放地址无效"))?
    };
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(error("播放地址无效"));
    }
    Ok(url.into())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackContext {
    media_source_id: String,
    play_session_id: String,
    play_method: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    media: ResolvedMedia,
    context: Option<PlaybackContext>,
}
fn external_subtitles(
    account: &Account,
    item_id: &str,
    source_id: &str,
    streams: &Value,
    plex: bool,
) -> Result<Vec<crate::player::Subtitle>, AppError> {
    let mut result = Vec::new();
    for stream in streams.as_array().into_iter().flatten().take(128) {
        let external = if plex {
            stream["streamType"].as_u64() == Some(3) && stream["key"].as_str().is_some()
        } else {
            stream["Type"].as_str() == Some("Subtitle")
                && stream["IsExternal"].as_bool() == Some(true)
        };
        if !external {
            continue;
        }
        let index = if plex {
            stream["id"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| stream["id"].as_u64().map(|n| n.to_string()))
        } else {
            stream["Index"].as_u64().map(|n| n.to_string())
        }
        .ok_or_else(|| error("字幕轨道缺少标识"))?;
        let url = if let Some(delivery) = stream[if plex { "key" } else { "DeliveryUrl" }].as_str()
        {
            absolute(account, delivery)?
        } else {
            let codec = stream["Codec"].as_str().unwrap_or("srt");
            if !["srt", "ass", "ssa", "vtt", "sub"].contains(&codec) {
                continue;
            }
            let mut url = url::Url::parse(&endpoint(account, "Videos/")).unwrap();
            url.path_segments_mut()
                .unwrap()
                .pop_if_empty()
                .push(item_id)
                .push(source_id)
                .push("Subtitles")
                .push(&index)
                .push("0")
                .push(&format!("Stream.{codec}"));
            url.into()
        };
        if url::Url::parse(&url).unwrap().origin()
            != url::Url::parse(&account.base_url).unwrap().origin()
        {
            continue;
        }
        let title = stream[if plex { "displayTitle" } else { "DisplayTitle" }]
            .as_str()
            .or_else(|| stream[if plex { "language" } else { "Language" }].as_str())
            .unwrap_or("字幕")
            .chars()
            .take(200)
            .collect();
        result.push(crate::player::Subtitle {
            title,
            media: ResolvedMedia {
                schema_version: 1,
                source_id: account.id.clone(),
                account_id: account.id.clone(),
                file_id: format!("{item_id}:subtitle:{index}"),
                url,
                headers: Headers::new(),
                expires_at: None,
            },
        });
    }
    Ok(result)
}
fn select<'a>(
    sources: &'a [Value],
    direct_only: bool,
    max: Option<u64>,
) -> Option<(&'a Value, &'static str)> {
    for source in sources {
        let over = max
            .zip(
                source["Bitrate"]
                    .as_u64()
                    .or_else(|| source["BitRate"].as_u64()),
            )
            .is_some_and(|(limit, value)| value > limit);
        if source["SupportsDirectPlay"] == true && (!over || direct_only) {
            return Some((source, "DirectPlay"));
        }
    }
    for source in sources {
        let over = max
            .zip(
                source["Bitrate"]
                    .as_u64()
                    .or_else(|| source["BitRate"].as_u64()),
            )
            .is_some_and(|(limit, value)| value > limit);
        if source["SupportsDirectStream"] == true
            && (!over || direct_only)
            && source["DirectStreamUrl"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
        {
            return Some((source, "DirectStream"));
        }
    }
    if !direct_only {
        for source in sources {
            if source["TranscodingUrl"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
            {
                return Some((source, "Transcode"));
            }
        }
    }
    None
}
pub async fn resolve_selected(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    prepared: &PreparedMedia,
    account_id: &str,
    item_id: &str,
    profile: Value,
    max_bitrate: Option<u64>,
    direct_only: bool,
    auto_bitrate: bool,
    selected_source: Option<&str>,
) -> Result<Resolution, AppError> {
    if item_id.trim().is_empty() || item_id.len() > 1024 {
        return Err(error("媒体标识无效"));
    }
    let account = owner(accounts, account_id)?;
    let encoded: url::Url =
        url::Url::parse(&endpoint(&account, "Items/")).map_err(|_| error("服务器地址无效"))?;
    let mut encoded = encoded;
    encoded
        .path_segments_mut()
        .map_err(|_| error("服务器地址无效"))?
        .pop_if_empty()
        .push(item_id);
    let item_path = encoded.path().to_owned();
    if account.provider_id == "plex" {
        let mut url = url::Url::parse(&endpoint(&account, "library/metadata/"))
            .map_err(|_| error("服务器地址无效"))?;
        url.path_segments_mut()
            .unwrap()
            .pop_if_empty()
            .push(item_id);
        let response = api(
            accounts,
            gateway,
            &account,
            uuid::Uuid::new_v4().to_string(),
            "GET",
            url.into(),
            None,
        )
        .await?;
        let data: Value =
            serde_json::from_slice(&response.body).map_err(|_| error("Plex 播放响应无效"))?;
        let item = data
            .pointer("/MediaContainer/Metadata")
            .and_then(Value::as_array)
            .and_then(|rows| {
                rows.iter()
                    .find(|item| item["ratingKey"].as_str() == Some(item_id))
            })
            .ok_or_else(|| error("Plex 未返回所选媒体"))?;
        let media_rows=item["Media"].as_array().ok_or_else(||error("Plex 未返回媒体文件"))?;
        let chosen=if let Some(id)=selected_source{media_rows.iter().find(|row|row["id"].as_str().map(str::to_owned).or_else(||row["id"].as_u64().map(|n|n.to_string())).as_deref()==Some(id)).ok_or_else(||error("所选 Plex 视频版本已失效"))?}else{media_rows.first().ok_or_else(||error("Plex 未返回媒体文件"))?};
        let part=chosen.pointer("/Part/0/key").and_then(Value::as_str).filter(|s|!s.is_empty()).ok_or_else(||error("Plex 未返回媒体文件"))?;
        let url = absolute(&account, part)?;
        if url::Url::parse(&url).unwrap().origin()
            != url::Url::parse(&account.base_url).unwrap().origin()
        {
            return Err(error("Plex 媒体超出服务器范围"));
        }
        let media = prepared.insert(ResolvedMedia {
            schema_version: 1,
            source_id: account.id.clone(),
            account_id: account.id.clone(),
            file_id: item_id.into(),
            url,
            headers: Headers::new(),
            expires_at: None,
        })?;
        let mut subtitles = external_subtitles(
            &account,
            item_id,
            "",
            &chosen
                .pointer("/Part/0/Stream")
                .cloned()
                .unwrap_or(Value::Null),
            true,
        )?;
        for subtitle in &mut subtitles {
            accounts.media_headers(&mut subtitle.media)?
        }
        gateway.set_subtitles(&media, subtitles);
        return Ok(Resolution {
            media,
            context: None,
        });
    }
    ServerPlaybackSettings {
        quality: "max".into(),
        compatibility: "custom".into(),
        custom_profile: profile.clone(),
    }
    .validate()?;
    if max_bitrate.is_some_and(|v| v == 0 || v > 360000000) {
        return Err(error("播放码率无效"));
    }
    let user = account.user_id.as_str();
    if user.is_empty() {
        return Err(error("服务器账号缺少用户标识"));
    }
    let limit = if auto_bitrate {
        Some(
            bitrate(
                accounts,
                gateway,
                account_id,
                uuid::Uuid::new_v4().to_string(),
            )
            .await?
            .max_streaming_bitrate,
        )
    } else {
        max_bitrate
    };
    let query = {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        query.extend_pairs([
            ("UserId", user),
            ("IsPlayback", "true"),
            ("StartTimeTicks", "0"),
            ("AutoOpenLiveStream", "false"),
        ]);
        if let Some(limit) = limit {
            query.append_pair("MaxStreamingBitrate", &limit.to_string());
        }
        if direct_only {
            query.extend_pairs([
                ("EnableDirectPlay", "true"),
                ("EnableDirectStream", "true"),
                ("EnableTranscoding", "false"),
            ]);
        }
        query.finish()
    };
    let query=if let Some(source)=selected_source{format!("{}&{}",query,url::form_urlencoded::Serializer::new(String::new()).append_pair("MediaSourceId",source).finish())}else{query};
    let mut profile = profile;
    if let Some(limit) = limit {
        profile["MaxStreamingBitrate"] = limit.into();
        profile["MaxStaticBitrate"] = limit.into();
        profile["MusicStreamingTranscodingBitrate"] = limit.into();
    }
    profile["Name"] = "BoxPlayer mpv".into();
    let response = api(
        accounts,
        gateway,
        &account,
        uuid::Uuid::new_v4().to_string(),
        "POST",
        format!(
            "{}{}?{}",
            url::Url::parse(&account.base_url)
                .unwrap()
                .origin()
                .ascii_serialization(),
            format!("{item_path}/PlaybackInfo"),
            query
        ),
        Some(json!({"DeviceProfile":profile})),
    )
    .await?;
    let data: Value =
        serde_json::from_slice(&response.body).map_err(|_| error("服务器播放响应无效"))?;
    let sources = data["MediaSources"]
        .as_array()
        .ok_or_else(|| error("服务器未返回媒体源"))?;
    let filtered:Vec<Value>=sources.iter().filter(|source|selected_source.is_none_or(|id|source["Id"].as_str()==Some(id))).cloned().collect();
    let (source, method) = select(&filtered, direct_only, limit)
        .ok_or_else(|| error("服务器没有符合当前设备配置的播放源"))?;
    let source_id = source["Id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("服务器媒体源缺少标识"))?;
    let url = if method == "DirectPlay" {
        let mut stream = url::Url::parse(&endpoint(&account, "Videos/")).unwrap();
        stream
            .path_segments_mut()
            .unwrap()
            .pop_if_empty()
            .push(item_id)
            .push("stream");
        stream.query_pairs_mut().extend_pairs([
            ("Static", "true"),
            ("MediaSourceId", source_id),
            ("DeviceId", account.device_id.as_str()),
        ]);
        stream.into()
    } else {
        absolute(
            &account,
            source[if method == "DirectStream" {
                "DirectStreamUrl"
            } else {
                "TranscodingUrl"
            }]
            .as_str()
            .unwrap(),
        )?
    };
    let context = PlaybackContext {
        media_source_id: source_id.into(),
        play_session_id: data["PlaySessionId"].as_str().unwrap_or("").into(),
        play_method: method,
    };
    let media = prepared.insert(ResolvedMedia {
        schema_version: 1,
        source_id: account.id.clone(),
        account_id: account.id.clone(),
        file_id: item_id.into(),
        url,
        headers: Headers::new(),
        expires_at: None,
    })?;
    let mut subtitles =
        external_subtitles(&account, item_id, source_id, &source["MediaStreams"], false)?;
    for subtitle in &mut subtitles {
        accounts.media_headers(&mut subtitle.media)?
    }
    gateway.set_subtitles(&media, subtitles);
    Ok(Resolution {
        media,
        context: Some(context),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profile_limits_choose_transcode_and_direct_mode_refuses_it() {
        let sources = vec![
            json!({"Id":"source","SupportsDirectPlay":true,"Bitrate":80000000,"TranscodingUrl":"/video?api_key=synthetic"}),
        ];
        assert_eq!(
            select(&sources, false, Some(20000000)).unwrap().1,
            "Transcode"
        );
        assert_eq!(
            select(&sources, true, Some(20000000)).unwrap().1,
            "DirectPlay"
        );
        assert!(select(&[json!({"TranscodingUrl":"/video"})], true, None).is_none());
    }
    #[test]
    fn reverse_proxy_paths_are_preserved() {
        let account = Account {
            id: "a".into(),
            provider_id: "emby".into(),
            name: "test".into(),
            base_url: "https://server.test/emby".into(),
            user_id: "u".into(),
            device_id: String::new(),
            auth_origins: vec!["https://server.test".into()],
        };
        assert_eq!(
            absolute(&account, "/Videos/id/stream?api_key=synthetic").unwrap(),
            "https://server.test/emby/Videos/id/stream?api_key=synthetic"
        );
        assert_eq!(
            absolute(&account, "/emby/Videos/id/stream").unwrap(),
            "https://server.test/emby/Videos/id/stream"
        );
        assert!(absolute(&account, "javascript:alert(1)").is_err());
        let streams = json!([
            {"Type":"Subtitle","Index":2,"IsExternal":true,"Codec":"srt","Language":"zh"},
            {"Type":"Subtitle","Index":3,"IsExternal":true,"DeliveryUrl":"https://foreign.test/sub?token=synthetic"},
            {"Type":"Subtitle","Index":4,"IsExternal":false}
        ]);
        let subtitles = external_subtitles(&account, "video", "source", &streams, false).unwrap();
        assert_eq!(subtitles.len(), 1);
        assert_eq!(
            subtitles[0].media.url,
            "https://server.test/emby/Videos/video/source/Subtitles/2/0/Stream.srt"
        );
        assert_eq!(subtitles[0].media.account_id, "a");
        let plex=external_subtitles(&account,"video","",&json!([{"streamType":3,"id":"8","key":"/library/streams/8?X-Plex-Token=synthetic","displayTitle":"English"}]),true).unwrap();
        assert_eq!(plex[0].title, "English");
        assert!(plex[0].media.url.contains("/emby/library/streams/8"));
    }
}

#[cfg(test)]
mod protocol_tests {
    use super::*;
    use std::{collections::HashMap, sync::Mutex};
    #[derive(Default)]
    struct MemoryVault(Mutex<HashMap<String, String>>);
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
                .ok_or_else(|| error("missing test entry"))
        }
        fn remove(&self, key: &str) -> Result<(), AppError> {
            self.0.lock().unwrap().remove(key);
            Ok(())
        }
    }
    #[tokio::test]
    async fn negotiated_transcode_and_plex_urls_stay_native_and_bitrate_counts_actual_bytes() {
        use axum::{
            routing::{get, post},
            Json, Router,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let router=Router::new().route("/prefix/Items/video/PlaybackInfo",post(|headers:axum::http::HeaderMap,axum::extract::Query(query):axum::extract::Query<HashMap<String,String>>,Json(body):Json<Value>|async move{
   assert_eq!(headers["x-emby-token"],"synthetic-token");assert_eq!(query["MaxStreamingBitrate"],"20000000");assert_eq!(query["MediaSourceId"],"source");assert_eq!(body["DeviceProfile"]["DirectPlayProfiles"][0]["VideoCodec"],"h264");
   Json(json!({"MediaSources":[{"Id":"source","SupportsDirectPlay":false,"MediaStreams":[{"Type":"Subtitle","IsExternal":true,"Index":2,"DeliveryUrl":"/subtitles/test.srt?api_key=synthetic-token","Language":"zh"}],"TranscodingUrl":"/Videos/video/master.m3u8?api_key=synthetic-token"}],"PlaySessionId":"session"}))
  })).route("/prefix/library/metadata/video",get(|headers:axum::http::HeaderMap|async move{assert_eq!(headers["x-plex-token"],"synthetic-token");Json(json!({"MediaContainer":{"Metadata":[{"ratingKey":"video","Media":[{"Part":[{"key":"/prefix/library/parts/file?X-Plex-Token=synthetic-token","Stream":[{"streamType":3,"id":"2","key":"/subtitles/test.srt?X-Plex-Token=synthetic-token","language":"zh"}]}]}]}]}}))}))
   .route("/prefix/subtitles/test.srt",get(|headers:axum::http::HeaderMap|async move{assert!(headers.get("x-emby-token").or_else(||headers.get("x-plex-token")).is_some());"1\n00:00:00,000 --> 00:00:01,000\nSubtitle fixture\n"}))
   .route("/prefix/Items/video/Download",get(|headers:axum::http::HeaderMap|async move{assert_eq!(headers["x-emby-token"],"synthetic-token");vec![1u8;4096]}))
   .route("/prefix/library/parts/file",get(|headers:axum::http::HeaderMap|async move{assert_eq!(headers["x-plex-token"],"synthetic-token");vec![1u8;4096]}))
   .route("/prefix/Playback/BitrateTest",get(|headers:axum::http::HeaderMap|async move{assert_eq!(headers["x-emby-token"],"synthetic-token");vec![0u8;5000000]}));
        let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        let directory = tempfile::tempdir().unwrap();
        let accounts =
            Accounts::with_vault(directory.path(), Box::<MemoryVault>::default()).unwrap();
        let gateway = Gateway::new(Arc::new(|_| {
            Box::pin(async { Err(error("unused test refresh")) })
        }))
        .unwrap();
        let prepared = PreparedMedia::default();
        for provider in ["jellyfin", "emby", "plex"] {
            let account = accounts
                .save_login(
                    Account {
                        id: String::new(),
                        provider_id: provider.into(),
                        name: provider.into(),
                        base_url: format!("{base}/prefix"),
                        user_id: "user".into(),
                        device_id: "device".into(),
                        auth_origins: vec![base.clone()],
                    },
                    crate::accounts::Credentials {
                        headers: Headers::from([(
                            if provider == "plex" {
                                "X-Plex-Token"
                            } else {
                                "X-Emby-Token"
                            }
                            .into(),
                            "synthetic-token".into(),
                        )]),
                        ..Default::default()
                    },
                )
                .unwrap();
            let result=resolve_selected(&accounts,&gateway,&prepared,&account.id,"video",json!({"Action":"replace","DirectPlayProfiles":[{"Type":"Video","VideoCodec":"h264"}],"TranscodingProfiles":[]}),Some(20000000),false,false,if provider=="plex"{None}else{Some("source")}).await.unwrap();
            let public = serde_json::to_string(&result).unwrap();
            assert!(!public.contains("synthetic-token"));
            assert!(result.media.url.starts_with("boxplayer-prepared:"));
            let mut media = result.media;
            prepared.hydrate(&mut media).unwrap();
            assert!(media.url.contains("synthetic-token"));
            assert!(media.url.starts_with(&format!("{base}/prefix/")));
            let subtitles = gateway.take_subtitles(&media);
            assert_eq!(subtitles.len(), 1);
            assert_eq!(subtitles[0].media.account_id, account.id);
            assert!(gateway.take_subtitles(&media).is_empty());
            let subtitle_url = gateway.register(subtitles[0].media.clone()).await.unwrap();
            assert!(!subtitle_url.contains("synthetic-token"));
            let subtitle_body = reqwest::Client::new()
                .get(&subtitle_url)
                .send()
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(subtitle_body.contains("Subtitle fixture"));
            gateway.revoke(&subtitle_url).await;
            gateway.set_subtitles(&media, subtitles);
            gateway.revoke_account(&account.id).await;
            assert!(gateway.take_subtitles(&media).is_empty());
            let file = file_media(&accounts, &gateway, &prepared, &account.id, "video")
                .await
                .unwrap();
            assert_eq!(file.account_id, account.id);
            assert_eq!(file.source_id, account.id);
            let speeds = crate::speed_test::SpeedTests::default();
            let started = speeds
                .start(
                    gateway.clone(),
                    file,
                    tokio_util::sync::CancellationToken::new(),
                )
                .await
                .unwrap();
            let started = serde_json::to_value(started).unwrap();
            let id = started["id"].as_str().unwrap();
            let deadline = Instant::now() + std::time::Duration::from_secs(2);
            loop {
                let snapshot = serde_json::to_value(speeds.state(id).unwrap()).unwrap();
                if snapshot["status"] != "running" {
                    assert_eq!(snapshot["status"], "complete");
                    assert_eq!(snapshot["bytes"], 4096);
                    assert!(!snapshot.to_string().contains("synthetic-token"));
                    break;
                }
                assert!(Instant::now() < deadline, "file test did not complete");
                tokio::time::sleep(std::time::Duration::from_millis(5)).await;
            }
            if provider != "plex" {
                assert_eq!(result.context.unwrap().play_method, "Transcode");
                let result = bitrate(
                    &accounts,
                    &gateway,
                    &account.id,
                    uuid::Uuid::new_v4().to_string(),
                )
                .await
                .unwrap();
                assert_eq!(result.bytes, 5000000);
                assert!(result.bitrate > 0);
                assert!(
                    result.max_streaming_bitrate > 0 && result.max_streaming_bitrate <= 360000000
                );
            }
        }
        task.abort();
    }
}

pub async fn file_media(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    prepared: &PreparedMedia,
    account_id: &str,
    item_id: &str,
) -> Result<ResolvedMedia, AppError> {
    file_media_selected(accounts,gateway,prepared,account_id,item_id,None).await
}
pub async fn file_media_selected(
    accounts: &Accounts,
    gateway: &Arc<Gateway>,
    prepared: &PreparedMedia,
    account_id: &str,
    item_id: &str,
    selected_source:Option<&str>,
) -> Result<ResolvedMedia, AppError> {
    if item_id.trim().is_empty() || item_id.len() > 1024 {
        return Err(error("媒体标识无效"));
    }
    let account = owner(accounts, account_id)?;
    let mut media = if account.provider_id == "plex" {
        let mut result = resolve_selected(
            accounts,
            gateway,
            prepared,
            account_id,
            item_id,
            json!({"DirectPlayProfiles":[],"TranscodingProfiles":[]}),
            None,
            true,
            false,
            selected_source,
        )
        .await?
        .media;
        prepared.hydrate(&mut result)?;
        result
    } else {
        let mut url =
            url::Url::parse(&endpoint(&account, if selected_source.is_some(){"Videos/"}else{"Items/"})).map_err(|_| error("服务器地址无效"))?;
        url.path_segments_mut()
            .map_err(|_| error("服务器地址无效"))?
            .pop_if_empty()
            .push(item_id)
            .push(if selected_source.is_some(){"stream"}else{"Download"});
        if let Some(source)=selected_source{url.query_pairs_mut().extend_pairs([("static","true"),("mediaSourceId",source)]);}
        ResolvedMedia {
            schema_version: 1,
            source_id: account.id.clone(),
            account_id: account.id,
            file_id: item_id.into(),
            url: url.into(),
            headers: Headers::new(),
            expires_at: None,
        }
    };
    accounts.media_headers(&mut media)?;
    Ok(media)
}
