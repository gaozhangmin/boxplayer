use super::*;
use crate::gateway::tests::{fixture, gateway, media};
#[tokio::test(flavor = "multi_thread")]
#[ignore = "Requires prepared libmpv runtime; run explicitly for M2 media acceptance"]
async fn libmpv_decodes_header_authenticated_http_after_403_and_loads_separate_subtitle() {
    configure_vulkan();
    let fixture = fixture().await;
    let gateway = gateway(&fixture);
    let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.local/runtime/macos");
    let url = gateway
        .register(media(&fixture.base, "/expired"))
        .await
        .unwrap();
    let mut subtitle = media(&fixture.base, "/subtitle");
    subtitle.file_id = "subtitle".into();
    subtitle
        .headers
        .insert("authorization".into(), "Bearer subtitle-account".into());
    let sub_url = gateway.register(subtitle).await.unwrap();
    let mut mpv = ffi::Mpv::new(&runtime, None).unwrap();
    mpv.command(&["loadfile", &url]).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut loaded = false;
    while Instant::now() < deadline {
        let event = mpv.wait(0.02);
        if !event.is_null() && unsafe { (*event).id } == 8 {
            loaded = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(loaded, "libmpv did not load the real HTTP media");
    assert!(mpv.number("duration").unwrap_or(0.0) > 0.0);
    mpv.command(&["sub-add", &sub_url, "select", "M2 subtitle"])
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut found = false;
    while Instant::now() < deadline {
        mpv.wait(0.02);
        if tracks(&mpv).iter().any(|t| t.kind == "sub" && t.selected) {
            found = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(found, "Authenticated subtitle did not load");
    assert_eq!(
        fixture.refreshes.load(std::sync::atomic::Ordering::SeqCst),
        1
    );
    mpv.command(&["seek", "1", "absolute+exact"]).unwrap();
    mpv.set("pause", "no").unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(mpv.number("time-pos").unwrap_or(0.0) >= 1.0);
    drop(mpv);
    gateway.revoke(&url).await;
    gateway.revoke(&sub_url).await;
}

#[test]
#[ignore = "Requires prepared libmpv runtime and local HDR sample directory"]
fn libmpv_reads_hdr10_and_dolby_vision_sample_metadata() {
    let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.local/runtime/macos");
    let samples = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../testVideo");
    for name in [
        "Test Jellyfin 1080p AV1 HDR10 3M.mp4",
        "Test Jellyfin 1080p DV P5.mp4",
        "Test Jellyfin 1080p DV P8.1.mp4",
    ] {
        let path = samples.join(name);
        assert!(path.is_file(), "HDR fixture is unavailable");
        let mut mpv = ffi::Mpv::new(&runtime, None).unwrap();
        mpv.command(&["loadfile", &path.to_string_lossy()]).unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        let mut loaded = false;
        while Instant::now() < deadline {
            let event = mpv.wait(0.03);
            if !event.is_null() && unsafe { (*event).id } == 8 {
                loaded = true;
                break;
            }
        }
        assert!(loaded, "HDR sample did not load");
        assert!(mpv.number("width").unwrap_or(0.0) >= 1920.0);
        assert!(mpv.number("duration").unwrap_or(0.0) > 0.0);
        println!(
            "{}: {}x{}, video-params={}",
            name,
            mpv.number("width").unwrap_or(0.0),
            mpv.number("height").unwrap_or(0.0),
            mpv.json("video-params").unwrap_or_default()
        );
    }
}

#[test]
#[ignore = "Requires prepared libmpv runtime and testVideo fixtures"]
fn libmpv_hdr_options_restore_when_switching_back_to_sdr() {
    let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.local/runtime/macos");
    let samples = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../testVideo");
    let mut mpv = ffi::Mpv::new(&runtime, None).unwrap();
    let baseline_hint = mpv.string("target-colorspace-hint").unwrap();
    let baseline_trc = mpv.string("target-trc").unwrap();
    let mut hdr = hdr::HdrOutput::default();
    for (name, transfer) in [
        ("Test Jellyfin 1080p AV1 HDR10 3M.mp4", "pq"),
        ("Test Jellyfin 1080p HEVC 10bit 3M.mp4", "bt.1886"),
        ("Test Jellyfin 1080p DV P5.mp4", "pq"),
        ("Test Jellyfin 1080p AVC 3M.mp4", "bt.1886"),
    ] {
        mpv.command(&["loadfile", &samples.join(name).to_string_lossy()])
            .unwrap();
        mpv.set("pause", "no").unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut loaded = false;
        let mut found = false;
        while Instant::now() < deadline {
            let event = mpv.wait(0.02);
            if !event.is_null() && unsafe { (*event).id } == 8 {
                loaded = true;
            }
            if loaded
                && mpv
                    .json("video-params")
                    .and_then(|v| v.get("gamma").and_then(|v| v.as_str()).map(String::from))
                    .as_deref()
                    == Some(transfer)
            {
                found = true;
                break;
            }
        }
        assert!(
            found,
            "Expected source transfer was not detected for {name}"
        );
        hdr.update(&mut mpv).unwrap();
        if transfer == "pq" {
            assert_eq!(mpv.string("target-trc").as_deref(), Some("pq"));
        } else {
            assert_eq!(mpv.string("target-trc"), Some(baseline_trc.clone()));
            assert_eq!(
                mpv.string("target-colorspace-hint"),
                Some(baseline_hint.clone())
            );
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
#[ignore = "Requires prepared libmpv runtime; exercises authenticated nested HLS proxy playback"]
async fn libmpv_decodes_authenticated_nested_hls_without_exposing_segment_credentials() {
    configure_vulkan();
    let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.local/runtime/macos");
    let temporary = tempfile::tempdir().unwrap();
    let segment = temporary.path().join("segment.ts");
    let sample = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../e2e/assets/mpv-sample.mp4");
    let mut recorder = ffi::Mpv::new(&runtime, None).unwrap();
    recorder
        .set("stream-record", segment.to_str().unwrap())
        .unwrap();
    recorder
        .command(&["loadfile", sample.to_str().unwrap()])
        .unwrap();
    recorder.set("pause", "no").unwrap();
    recorder.set("speed", "10").unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline && recorder.flag("eof-reached") != Some(true) {
        recorder.wait(0.02);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(recorder.flag("eof-reached"), Some(true));
    drop(recorder);
    let bytes = std::fs::read(segment).unwrap();
    assert_eq!(
        bytes.first(),
        Some(&0x47),
        "fixture must contain MPEG-TS packets"
    );
    let fixture = crate::gateway::tests::hls_fixture_with_segment(bytes).await;
    let gateway = gateway(&fixture);
    let mut source = media(&fixture.base, "/hls/direct-master.m3u8");
    source
        .headers
        .insert("X-Emby-Token".into(), "synthetic-hls".into());
    let url = gateway.register(source).await.unwrap();
    let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.local/runtime/macos");
    let mut mpv = ffi::Mpv::new(&runtime, None).unwrap();
    mpv.command(&["loadfile", &url]).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut loaded = false;
    while Instant::now() < deadline {
        let event = mpv.wait(0.02);
        if !event.is_null() && unsafe { (*event).id } == 8 {
            loaded = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(loaded, "libmpv did not load authenticated HLS");
    assert!(mpv.number("duration").unwrap_or(0.0) > 0.0);
    mpv.set("pause", "no").unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(mpv.number("time-pos").unwrap_or(0.0) > 0.0);
    let resume = mpv.number("time-pos").unwrap();
    mpv.set("sid", "no").unwrap();
    let selection = RecoveryTracks::capture(&mpv);
    reload_hls_session(&mut mpv, &url).unwrap();
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut reloaded = false;
    while Instant::now() < deadline {
        let event = mpv.wait(0.02);
        if !event.is_null() && unsafe { (*event).id } == 8 {
            reloaded = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(reloaded, "libmpv did not reload HLS session");
    selection.restore(&mut mpv).unwrap();
    assert_eq!(mpv.string("sid").as_deref(), Some("no"));
    mpv.command(&["seek", &resume.to_string(), "absolute+exact"])
        .unwrap();
    let settle = Instant::now() + Duration::from_secs(2);
    while Instant::now() < settle {
        mpv.wait(0.02);
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(mpv.flag("pause"), Some(true));
    let restored = mpv.number("time-pos").unwrap_or(0.0);
    assert!(
        (restored - resume).abs() < 0.25,
        "resume={resume}, restored={restored}"
    );
    drop(mpv);
    gateway.revoke(&url).await;
}
