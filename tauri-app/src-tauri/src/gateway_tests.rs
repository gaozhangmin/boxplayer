use super::*;
use axum::{response::IntoResponse, Json};
use std::sync::atomic::{AtomicUsize, Ordering};
pub(crate) const SAMPLE: &[u8] = include_bytes!("../../../e2e/assets/mpv-sample.mp4");
pub(crate) struct Fixture {
    pub base: String,
    pub refreshes: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
pub(crate) async fn fixture() -> Fixture {
    let refreshes = Arc::new(AtomicUsize::new(0));
    let router = Router::new()
        .route(
            "/cookie-redirect",
            get(|| async {
                (
                    StatusCode::FOUND,
                    [
                        ("location", "/cookie-final"),
                        ("set-cookie", "auth=synthetic-cookie; Path=/; HttpOnly"),
                    ],
                )
            }),
        )
        .route(
            "/cookie-final",
            get(|| async {
                (
                    [("set-cookie", "updated=synthetic-update; Path=/; HttpOnly")],
                    "done",
                )
            }),
        )
        .route(
            "/headers",
            get(|headers: HeaderMap| async move {
                Json(
                    headers
                        .iter()
                        .filter_map(|(k, v)| {
                            v.to_str().ok().map(|v| (k.to_string(), v.to_string()))
                        })
                        .collect::<BTreeMap<_, _>>(),
                )
            }),
        )
        .route(
            "/slow",
            get(|| async {
                tokio::time::sleep(Duration::from_secs(2)).await;
                "late"
            }),
        )
        .route("/expired", get(|| async { StatusCode::FORBIDDEN }))
        .route("/unauthorized", get(|| async { StatusCode::UNAUTHORIZED }))
        .route(
            "/redirect",
            get(|| async { (StatusCode::FOUND, [("location", "/headers")]) }),
        )
        .route(
            "/media",
            get(|headers: HeaderMap| async move {
                if headers.get("authorization").and_then(|v| v.to_str().ok())
                    != Some("Bearer test-account")
                    || headers.get("user-agent").and_then(|v| v.to_str().ok())
                        != Some("BoxPlayer-M2")
                {
                    return StatusCode::FORBIDDEN.into_response();
                }
                let range = headers
                    .get("range")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.strip_prefix("bytes="))
                    .and_then(|v| v.split_once('-'));
                if let Some((start, end)) = range {
                    let start = start.parse::<usize>().unwrap_or(0);
                    let end = end
                        .parse::<usize>()
                        .unwrap_or(SAMPLE.len() - 1)
                        .min(SAMPLE.len() - 1);
                    if start > end {
                        return StatusCode::RANGE_NOT_SATISFIABLE.into_response();
                    }
                    return Response::builder()
                        .status(206)
                        .header("content-type", "video/mp4")
                        .header("accept-ranges", "bytes")
                        .header("content-length", end - start + 1)
                        .header(
                            "content-range",
                            format!("bytes {start}-{end}/{}", SAMPLE.len()),
                        )
                        .body(Body::from(SAMPLE[start..=end].to_vec()))
                        .unwrap();
                }
                Response::builder()
                    .header("content-type", "video/mp4")
                    .header("content-length", SAMPLE.len())
                    .header("accept-ranges", "bytes")
                    .body(Body::from(SAMPLE))
                    .unwrap()
            }),
        )
        .route(
            "/subtitle",
            get(|headers: HeaderMap| async move {
                if headers.get("authorization").and_then(|v| v.to_str().ok())
                    != Some("Bearer subtitle-account")
                {
                    return StatusCode::FORBIDDEN.into_response();
                }
                (
                    [("content-type", "application/x-subrip")],
                    "1\n00:00:00,000 --> 00:10:00,000\nM2 account-scoped subtitle\n",
                )
                    .into_response()
            }),
        );
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    Fixture {
        base,
        refreshes,
        task,
    }
}
pub(crate) fn media(base: &str, path: &str) -> ResolvedMedia {
    ResolvedMedia {
        schema_version: 1,
        source_id: "fixture-source".into(),
        account_id: "test-account".into(),
        file_id: "sample".into(),
        url: format!("{base}{path}"),
        headers: Headers::from([
            ("authorization".into(), "Bearer test-account".into()),
            ("user-agent".into(), "BoxPlayer-M2".into()),
        ]),
        expires_at: None,
    }
}
pub(crate) fn gateway(f: &Fixture) -> Arc<Gateway> {
    let base = f.base.clone();
    let count = f.refreshes.clone();
    Gateway::new(Arc::new(move |mut request| {
        let base = base.clone();
        let count = count.clone();
        Box::pin(async move {
            count.fetch_add(1, Ordering::SeqCst);
            request.url = format!("{base}/media");
            Ok(request)
        })
    }))
    .unwrap()
}
fn request(base: &str, path: &str) -> HttpRequest {
    HttpRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        provider_id: "fixture".into(),
        account_id: "account-a".into(),
        method: "GET".into(),
        url: format!("{base}{path}"),
        headers: Headers::new(),
        body: None,
        timeout_ms: Some(2000),
        proxy: None,
    }
}
#[tokio::test]
async fn preserves_forbidden_browser_headers_and_same_origin_redirects() {
    let f = fixture().await;
    let g = gateway(&f);
    let mut r = request(&f.base, "/redirect");
    r.headers = Headers::from([
        ("user-agent".into(), "M2-agent".into()),
        ("referer".into(), "https://example.invalid/".into()),
        ("origin".into(), "https://example.invalid".into()),
        ("date".into(), "Wed, 04 Nov 2026 00:00:00 GMT".into()),
        ("authorization".into(), "Bearer A".into()),
    ]);
    let expected = r.headers.clone();
    let response = g.request(r).await.unwrap();
    assert_eq!(response.status, 200);
    let actual: Headers = serde_json::from_slice(&response.body).unwrap();
    for (k, v) in expected {
        assert_eq!(actual.get(&k), Some(&v));
    }
}
#[tokio::test]
async fn strips_auth_and_cookie_on_cross_origin_redirect() {
    let target = fixture().await;
    let destination = format!("{}/headers", target.base);
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
    let task = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route(
                "/cross",
                get(move || {
                    let destination = destination.clone();
                    async move { (StatusCode::FOUND, [("location", destination)]) }
                }),
            ),
        )
        .await
        .unwrap()
    });
    let g = gateway(&target);
    let mut r = request(&base, "/cross");
    r.headers = Headers::from([
        ("Authorization".into(), "secret".into()),
        ("Cookie".into(), "session=secret".into()),
        ("X-Emby-Token".into(), "synthetic-emby".into()),
        ("X-Plex-Token".into(), "synthetic-plex".into()),
    ]);
    let response = g.request(r).await.unwrap();
    let actual: Headers = serde_json::from_slice(&response.body).unwrap();
    assert!(!actual.contains_key("authorization"));
    assert!(!actual.contains_key("cookie"));
    assert!(!actual.contains_key("x-emby-token"));
    assert!(!actual.contains_key("x-plex-token"));
    task.abort();
}
#[tokio::test]
async fn api_timeout_and_cancel_are_distinct() {
    let f = fixture().await;
    let g = gateway(&f);
    let mut r = request(&f.base, "/slow");
    r.timeout_ms = Some(15);
    assert_eq!(g.request(r).await.err().unwrap().code, "TIMEOUT");
    let r = request(&f.base, "/slow");
    let id = r.request_id.clone();
    let cloned = g.clone();
    let task = tokio::spawn(async move { cloned.request(r).await });
    while !g.requests.lock().unwrap().contains_key(&id) {
        tokio::task::yield_now().await;
    }
    assert!(g.cancel(&id));
    assert_eq!(task.await.unwrap().err().unwrap().code, "CANCELLED");
    assert!(!g.cancel(&id));
}
#[tokio::test]
async fn proxy_refreshes_expired_url_preserves_range_and_subtitle_identity() {
    let f = fixture().await;
    let g = gateway(&f);
    let stream = g.register(media(&f.base, "/expired")).await.unwrap();
    let client = Client::new();
    let response = client
        .get(&stream)
        .header("range", "bytes=10-29")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 206);
    assert_eq!(response.bytes().await.unwrap().as_ref(), &SAMPLE[10..30]);
    assert_eq!(f.refreshes.load(Ordering::SeqCst), 1);
    let mut subtitle = media(&f.base, "/subtitle");
    subtitle.file_id = "subtitle".into();
    subtitle
        .headers
        .insert("authorization".into(), "Bearer subtitle-account".into());
    let sub = g.register(subtitle).await.unwrap();
    assert!(client
        .get(&sub)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap()
        .contains("M2 account-scoped subtitle"));
    g.revoke(&stream).await;
    assert_eq!(client.get(&stream).send().await.unwrap().status(), 404);
}

#[tokio::test]
async fn logging_out_one_account_cancels_its_requests_and_revokes_only_its_media() {
    let f = fixture().await;
    let g = gateway(&f);
    let first = media(&f.base, "/media");
    let account_id = first.account_id.clone();
    let mut second = first.clone();
    second.account_id = "account-b".into();
    let first_url = g.register(first).await.unwrap();
    let second_url = g.register(second).await.unwrap();
    let mut slow = request(&f.base, "/slow");
    slow.account_id = account_id.clone();
    let id = slow.request_id.clone();
    let owner = g.clone();
    let task = tokio::spawn(async move { owner.request(slow).await });
    while !g.requests.lock().unwrap().contains_key(&id) {
        tokio::task::yield_now().await;
    }
    g.revoke_account(&account_id).await;
    assert_eq!(task.await.unwrap().err().unwrap().code, "CANCELLED");
    assert_eq!(
        Client::new().get(first_url).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
    assert_ne!(
        Client::new().get(second_url).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn cookie_jars_follow_redirect_updates_without_exposing_set_cookie_or_crossing_accounts() {
    let f = fixture().await;
    let g = gateway(&f);
    g.cookies.ensure("account-a", None).unwrap();
    g.cookies.ensure("account-b", None).unwrap();
    let response = g
        .request(request(&f.base, "/cookie-redirect"))
        .await
        .unwrap();
    assert_eq!(response.status, 200);
    assert!(!response.headers.contains_key("set-cookie"));
    let headers = g.request(request(&f.base, "/headers")).await.unwrap();
    let body: Headers = serde_json::from_slice(&headers.body).unwrap();
    assert!(body["cookie"].contains("auth=synthetic-cookie"));
    assert!(body["cookie"].contains("updated=synthetic-update"));
    let mut other = request(&f.base, "/headers");
    other.account_id = "account-b".into();
    let response = g.request(other).await.unwrap();
    let body: Headers = serde_json::from_slice(&response.body).unwrap();
    assert!(!body.contains_key("cookie"));
    let snapshot = g.cookies.snapshot("account-a").unwrap();
    g.cookies.remove("account-a");
    g.cookies.ensure("account-a", Some(&snapshot)).unwrap();
    assert!(g
        .cookies
        .headers("account-a", &f.base)
        .unwrap()
        .contains("auth=synthetic-cookie"));
}

#[tokio::test]
async fn proxy_refreshes_unauthorized_media_once_and_keeps_range() {
    let f = fixture().await;
    let g = gateway(&f);
    let url = g.register(media(&f.base, "/unauthorized")).await.unwrap();
    let response = Client::new()
        .get(url)
        .header("Range", "bytes=0-7")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.bytes().await.unwrap().as_ref(), &SAMPLE[..8]);
    assert_eq!(f.refreshes.load(Ordering::SeqCst), 1);
}

#[test]
fn ali_headers_follow_the_retained_desktop_protocol_without_cross_host_defaults() {
    for provider in ["aliyun", "alipan-open"] {
        let mut headers = Headers::new();
        provider_headers(
            provider,
            "https://openapi.alipan.com/adrive/v1.0/user/getDriveInfo",
            &mut headers,
        );
        assert_eq!(
            headers["x-canary"],
            "client=windows,app=adrive,version=v4.12.0"
        );
        assert_eq!(headers["origin"], "https://www.aliyundrive.com");
        let mut headers = Headers::from([("User-Agent".into(), "provider-specific-agent".into())]);
        provider_headers(provider, "https://api.aliyundrive.com/list", &mut headers);
        assert_eq!(headers.len(), 4);
        assert_eq!(headers["User-Agent"], "provider-specific-agent");
        assert!(!headers.contains_key("user-agent"));
        let mut headers = Headers::new();
        provider_headers(
            provider,
            "https://alipan.com.attacker.test/list",
            &mut headers,
        );
        assert!(headers.is_empty());
    }
}

#[tokio::test]
async fn hls_child_refreshes_headers_without_replacing_segment_with_root() {
    let f = hls_fixture().await;
    let count = Arc::new(AtomicUsize::new(0));
    let observed = count.clone();
    let g = Gateway::new(Arc::new(move |mut source| {
        observed.fetch_add(1, Ordering::SeqCst);
        Box::pin(async move {
            source
                .headers
                .insert("X-Emby-Token".into(), "synthetic-hls".into());
            Ok(source)
        })
    }))
    .unwrap();
    let source = media(&f.base, "/hls/master.m3u8");
    let local = g.register(source).await.unwrap();
    let token = local.rsplit('/').next().unwrap();
    let resource = g.resources.read().await.get(token).unwrap().clone();
    let upstream = Url::parse(&format!("{}/hls/master.m3u8", f.base)).unwrap();
    let child = resource.hls.wrap(&local, &upstream, "key.bin").unwrap();
    let response = Client::new().get(child).send().await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.bytes().await.unwrap().as_ref(), &[7u8; 16]);
    assert_eq!(count.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn changed_hls_session_invalidates_old_child_links() {
    let f = hls_fixture().await;
    let g = Gateway::new(Arc::new(move |mut source| {
        Box::pin(async move {
            source.url.push_str("?session=new");
            source
                .headers
                .insert("X-Emby-Token".into(), "synthetic-hls".into());
            Ok(source)
        })
    }))
    .unwrap();
    let local = g
        .register(media(&f.base, "/hls/master.m3u8"))
        .await
        .unwrap();
    let token = local.rsplit('/').next().unwrap();
    let resource = g.resources.read().await.get(token).unwrap().clone();
    let upstream = Url::parse(&format!("{}/hls/master.m3u8", f.base)).unwrap();
    let old = resource.hls.wrap(&local, &upstream, "key.bin").unwrap();
    let old_generation = resource.hls.generation();
    let old_target = resource.hls.open(old.rsplit('/').next().unwrap()).unwrap();
    let client = Client::new();
    let rejected = client.get(&old).send().await.unwrap();
    assert_eq!(rejected.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(rejected.text().await.unwrap(), "HLS_SESSION_CHANGED");
    assert!(g.take_hls_recovery(&local).await);
    assert!(!g.take_hls_recovery(&local).await);
    let stale = g
        .stream(
            resource.clone(),
            Method::GET,
            HeaderMap::new(),
            token,
            Some((old_target, old_generation)),
        )
        .await
        .err()
        .unwrap();
    assert_eq!(stale.code, "HLS_SESSION_CHANGED");
    assert_eq!(
        client.get(&old).send().await.unwrap().status(),
        StatusCode::NOT_FOUND
    );
    let master = client
        .get(&local)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let fresh = master
        .lines()
        .find(|line| line.starts_with("http:"))
        .unwrap();
    assert_eq!(
        client.get(fresh).send().await.unwrap().status(),
        StatusCode::OK
    );
}

pub(crate) async fn hls_fixture() -> Fixture {
    hls_fixture_with_segment(SAMPLE.to_vec()).await
}
pub(crate) async fn hls_fixture_with_segment(segment: Vec<u8>) -> Fixture {
    fn authorized(headers: &HeaderMap) -> bool {
        headers.get("x-emby-token").and_then(|v| v.to_str().ok()) == Some("synthetic-hls")
            && headers.get("authorization").and_then(|v| v.to_str().ok())
                == Some("Bearer test-account")
    }
    let foreign_listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let foreign = format!("http://{}", foreign_listener.local_addr().unwrap());
    let foreign_router = Router::new().route(
        "/foreign.bin",
        get(|headers: HeaderMap| async move {
            if [
                "authorization",
                "cookie",
                "x-emby-token",
                "x-plex-token",
                "sessionkey",
                "signature",
            ]
            .iter()
            .any(|key| headers.contains_key(*key))
            {
                return (StatusCode::BAD_REQUEST, "credential leak");
            }
            (StatusCode::OK, "foreign-ok")
        }),
    );
    let router=Router::new()
     .route("/hls/master.m3u8",get(|headers:HeaderMap|async move{if !authorized(&headers){return StatusCode::UNAUTHORIZED.into_response()}([("content-type","application/vnd.apple.mpegurl")],"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvariant.m3u8?api_key=synthetic-hls\n").into_response()}))
     .route("/hls/variant.m3u8",get(move|headers:HeaderMap|{let foreign=foreign.clone();async move{if !authorized(&headers){return StatusCode::UNAUTHORIZED.into_response()}([("content-type","application/vnd.apple.mpegurl")],format!("#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin?api_key=synthetic-hls\"\n#EXT-X-MAP:URI=\"segment.mp4\"\n#EXTINF:2,\nsegment.mp4?api_key=synthetic-hls\n#EXTINF:2,\n{foreign}/foreign.bin\n#EXT-X-ENDLIST\n")).into_response()}}))
     .route("/hls/key.bin",get(|headers:HeaderMap|async move{if !authorized(&headers){return StatusCode::UNAUTHORIZED.into_response()}vec![7u8;16].into_response()}))
     .route("/hls/segment.mp4",get(move |headers:HeaderMap|{let segment=segment.clone();async move{
       if !authorized(&headers){return StatusCode::UNAUTHORIZED.into_response()}
       if let Some(range)=headers.get("range").and_then(|v|v.to_str().ok()){if range=="bytes=0-7"{return(StatusCode::PARTIAL_CONTENT,[("content-type","video/mp4"),("content-range",&format!("bytes 0-7/{}",SAMPLE.len()))],SAMPLE[..8].to_vec()).into_response()}}
       ([("content-type","video/mp4"),("accept-ranges","bytes")],segment).into_response()
     }}))
     .route("/hls/direct-master.m3u8",get(|headers:HeaderMap|async move{if !authorized(&headers){return StatusCode::UNAUTHORIZED.into_response()}([("content-type","application/vnd.apple.mpegurl")],"#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nplay.m3u8?api_key=synthetic-hls\n").into_response()}))
     .route("/hls/play.m3u8",get(|headers:HeaderMap|async move{if !authorized(&headers){return StatusCode::UNAUTHORIZED.into_response()}([("content-type","application/vnd.apple.mpegurl")],"#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:3\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:2,\nsegment.mp4?api_key=synthetic-hls\n#EXT-X-ENDLIST\n").into_response()}));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        tokio::select! {_=axum::serve(listener,router)=>{},_=axum::serve(foreign_listener,foreign_router)=>{}}
    });
    Fixture {
        base,
        refreshes: Arc::new(AtomicUsize::new(0)),
        task,
    }
}
#[tokio::test]
async fn hls_nested_manifests_keys_maps_and_segments_keep_auth_and_range_but_not_cross_origin_secrets(
) {
    let fixture = hls_fixture().await;
    let gateway = gateway(&fixture);
    let mut source = media(&fixture.base, "/hls/master.m3u8");
    source
        .headers
        .insert("X-Emby-Token".into(), "synthetic-hls".into());
    let url = gateway.register(source).await.unwrap();
    let client = Client::new();
    let master = client.get(&url).send().await.unwrap().text().await.unwrap();
    assert!(master.starts_with("#EXTM3U"));
    assert!(!master.contains("synthetic-hls"));
    let variant = master
        .lines()
        .find(|line| line.starts_with("http:"))
        .unwrap();
    let text = client
        .get(variant)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(text.starts_with("#EXTM3U"));
    assert!(!text.contains("synthetic-hls"));
    let attributes = regex::Regex::new(r#"URI="([^"]+)""#).unwrap();
    let values: Vec<_> = attributes
        .captures_iter(&text)
        .map(|capture| capture[1].to_owned())
        .collect();
    assert_eq!(
        client
            .get(&values[0])
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap()
            .as_ref(),
        &[7u8; 16]
    );
    let segments: Vec<_> = text
        .lines()
        .filter(|line| line.starts_with("http:"))
        .collect();
    let response = client
        .get(segments[0])
        .header("range", "bytes=0-7")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 206);
    assert_eq!(response.bytes().await.unwrap().as_ref(), &SAMPLE[..8]);
    assert_eq!(
        client
            .get(segments[1])
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "foreign-ok"
    );
    let map = client.get(&values[1]).send().await.unwrap();
    assert_eq!(map.status(), 200);
    assert_eq!(map.bytes().await.unwrap().as_ref(), SAMPLE);
    gateway.revoke(&url).await;
    assert_eq!(client.get(segments[0]).send().await.unwrap().status(), 404);
}

#[tokio::test]
async fn cross_origin_307_cannot_forward_private_request_bodies() {
    use axum::routing::post;
    let calls = Arc::new(AtomicUsize::new(0));
    let observed = calls.clone();
    let destination = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}/receive", destination.local_addr().unwrap());
    let receiver = Router::new().route(
        "/receive",
        post(move || {
            let calls = observed.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                "unexpected"
            }
        }),
    );
    let source = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", source.local_addr().unwrap());
    let router = Router::new().route(
        "/redirect",
        post(move || {
            let target = target.clone();
            async move { (StatusCode::TEMPORARY_REDIRECT, [("location", target)]) }
        }),
    );
    let task = tokio::spawn(async move {
        tokio::select! {_=axum::serve(destination,receiver)=>{},_=axum::serve(source,router)=>{}}
    });
    let gateway = Gateway::new(Arc::new(|_| {
        Box::pin(async { Err(failure("UNUSED", "unused test refresh")) })
    }))
    .unwrap();
    let mut request = request(&base, "/redirect");
    request.method = "POST".into();
    request.body = Some(br#"{"password":"synthetic"}"#.to_vec());
    assert_eq!(
        gateway.request(request).await.err().unwrap().code,
        "REDIRECT_ORIGIN"
    );
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    task.abort();
}

#[tokio::test]
async fn lazy_queue_resolution_preserves_identity_and_rejects_cross_account_results() {
    let original = media("https://fixture.test", "/unused");
    let g = Gateway::new(Arc::new(|mut source| {
        Box::pin(async move {
            source.url = "https://fixture.test/fresh".into();
            Ok(source)
        })
    }))
    .unwrap();
    assert_eq!(
        g.resolve_queue_item(original.clone()).await.unwrap().url,
        "https://fixture.test/fresh"
    );
    let wrong = Gateway::new(Arc::new(|mut source| {
        Box::pin(async move {
            source.account_id = "another".into();
            source.url = "https://fixture.test/fresh".into();
            Ok(source)
        })
    }))
    .unwrap();
    assert_eq!(
        wrong.resolve_queue_item(original).await.unwrap_err().code,
        "REFRESH_IDENTITY"
    );
}

#[tokio::test]
async fn queue_resolver_uses_only_committed_identity_and_rejects_owner_changes(){
    let gateway=Gateway::with_identity(Arc::new(|mut media|Box::pin(async move{assert_eq!(media.file_id,"new");media.url="https://example.invalid/new".into();Ok(media)})),Arc::new(|media|{let mut next=media.clone();if next.file_id=="old"{next.file_id="new".into();next.url="boxplayer-queue:".into();next.headers.clear();}Ok(next)})).unwrap();
    let mut original=media("https://example.invalid","/old");original.file_id="old".into();
    let resolved=gateway.resolve_queue_item(original.clone()).await.unwrap();assert_eq!(resolved.file_id,"new");assert_eq!(resolved.url,"https://example.invalid/new");
    let bad=Gateway::with_identity(Arc::new(|media|Box::pin(async move{Ok(media)})),Arc::new(|media|{let mut next=media.clone();next.account_id="foreign".into();Ok(next)})).unwrap();
    assert_eq!(bad.resolve_queue_item(original).await.unwrap_err().code,"REFRESH_IDENTITY");
}
#[tokio::test]
async fn queue_resolver_rejects_identity_changed_while_refresh_was_in_flight(){
    let generation=Arc::new(AtomicUsize::new(0));let updated=generation.clone();
    let gateway=Gateway::with_identity(Arc::new(move |mut media|{updated.store(1,Ordering::SeqCst);Box::pin(async move{media.url="https://example.invalid/new".into();Ok(media)})}),Arc::new(move |media|{let mut next=media.clone();if generation.load(Ordering::SeqCst)==1{next.file_id="later".into();}Ok(next)})).unwrap();
    assert_eq!(gateway.resolve_queue_item(media("https://example.invalid","/old")).await.unwrap_err().code,"REFRESH_IDENTITY");
}

#[test]
fn pending_subtitles_follow_committed_root_alias_and_keep_account_scope(){
    let gateway=Gateway::with_identity(Arc::new(|media|Box::pin(async move{Ok(media)})),Arc::new(|media|{let mut next=media.clone();if next.account_id=="account"{next.file_id=match next.file_id.as_str(){"old"=>"new","subtitle"=>"new-subtitle",other=>other}.into();if next.file_id!=media.file_id{next.url="boxplayer-queue:".into();next.headers.clear();}}Ok(next)})).unwrap();
    let mut root=media("https://example.invalid","/root");root.account_id="account".into();root.source_id="account".into();root.file_id="old".into();
    let mut subtitle=root.clone();subtitle.file_id="subtitle".into();gateway.set_subtitles(&root,vec![crate::player::Subtitle{title:"Custom".into(),media:subtitle}]);
    let mut foreign=root.clone();foreign.account_id="foreign".into();foreign.source_id="foreign".into();assert!(gateway.take_subtitles(&foreign).is_empty());
    root.file_id="new".into();let rows=gateway.take_subtitles(&root);assert_eq!(rows.len(),1);assert_eq!(rows[0].media.file_id,"new-subtitle");assert_eq!(rows[0].title,"Custom");assert_eq!(rows[0].media.url,"boxplayer-queue:");assert!(gateway.take_subtitles(&root).is_empty());
}
