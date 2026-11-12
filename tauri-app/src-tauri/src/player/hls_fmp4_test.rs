use super::*;
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use std::sync::atomic::{AtomicUsize, Ordering};
#[derive(Clone)]
struct Files {
    directory: PathBuf,
    maps: Arc<AtomicUsize>,
    segments: Arc<AtomicUsize>,
}
async fn serve(
    State(files): State<Files>,
    Path(name): Path<String>,
    headers: HeaderMap,
) -> axum::response::Response {
    if headers.get("x-emby-token").and_then(|v| v.to_str().ok()) != Some("synthetic-fmp4") {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if name.contains('/')
        || name.contains("..")
        || !name
            .bytes()
            .all(|v| v.is_ascii_alphanumeric() || b".-_".contains(&v))
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(bytes) = std::fs::read(files.directory.join(&name)) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if name == "init.mp4" {
        files.maps.fetch_add(1, Ordering::SeqCst);
    } else if name.ends_with(".m4s") {
        files.segments.fetch_add(1, Ordering::SeqCst);
    }
    (
        [(
            "content-type",
            if name.ends_with(".m3u8") {
                "application/vnd.apple.mpegurl"
            } else {
                "video/mp4"
            },
        )],
        bytes,
    )
        .into_response()
}
#[tokio::test(flavor = "multi_thread")]
#[ignore = "Requires prepared libmpv and Frame Player ffmpeg for local fMP4 fixture generation"]
async fn authenticated_fmp4_initialization_segments_reload_and_resume() {
    configure_vulkan();
    let temporary = tempfile::tempdir().unwrap();
    let sample = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../e2e/assets/mpv-sample.mp4");
    let status =
        std::process::Command::new("/Applications/Frame Player.app/Contents/Resources/ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(sample)
            .args([
                "-c",
                "copy",
                "-f",
                "hls",
                "-hls_segment_type",
                "fmp4",
                "-hls_time",
                "2",
                "-hls_list_size",
                "0",
                "-hls_segment_filename",
            ])
            .arg(temporary.path().join("part-%03d.m4s"))
            .arg(temporary.path().join("master.m3u8"))
            .output()
            .unwrap();
    assert!(
        status.status.success(),
        "fMP4 fixture generation failed: {}",
        String::from_utf8_lossy(&status.stderr)
    );
    let maps = Arc::new(AtomicUsize::new(0));
    let segments = Arc::new(AtomicUsize::new(0));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new()
        .route("/{name}", get(serve))
        .with_state(Files {
            directory: temporary.path().into(),
            maps: maps.clone(),
            segments: segments.clone(),
        });
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let gateway = Gateway::new(Arc::new(|_| {
        Box::pin(async { Err(AppError::new("UNUSED", "unused", false)) })
    }))
    .unwrap();
    let mut media = crate::gateway::tests::media(&base, "/master.m3u8");
    media
        .headers
        .insert("X-Emby-Token".into(), "synthetic-fmp4".into());
    let local = gateway.register(media).await.unwrap();
    let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.local/runtime/macos");
    let mut mpv = ffi::Mpv::new(&runtime, None).unwrap();
    mpv.command(&["loadfile", &local]).unwrap();
    wait_loaded(&mut mpv).await;
    mpv.set("pause", "no").unwrap();
    tokio::time::sleep(Duration::from_millis(350)).await;
    let resume = mpv.number("time-pos").unwrap();
    assert!(resume > 0.0);
    mpv.set("sid", "no").unwrap();
    let tracks = RecoveryTracks::capture(&mpv);
    reload_hls_session(&mut mpv, &local).unwrap();
    wait_loaded(&mut mpv).await;
    tracks.restore(&mut mpv).unwrap();
    mpv.command(&["seek", &resume.to_string(), "absolute+exact"])
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(2);
    while Instant::now() < deadline {
        mpv.wait(0.02);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(mpv.flag("pause"), Some(true));
    assert_eq!(mpv.string("sid").as_deref(), Some("no"));
    let restored = mpv.number("time-pos").unwrap();
    assert!(
        (restored - resume).abs() < 0.25,
        "resume={resume}, restored={restored}"
    );
    assert!(maps.load(Ordering::SeqCst) >= 2);
    assert!(segments.load(Ordering::SeqCst) >= 2);
    drop(mpv);
    gateway.revoke(&local).await;
    server.abort();
}
async fn wait_loaded(mpv: &mut ffi::Mpv) {
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        let event = mpv.wait(0.02);
        if !event.is_null() && unsafe { (*event).id } == 8 {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("fMP4 HLS did not load");
}
