//! Fallback thumbnails. Callers authorize local paths or register account-scoped gateway URLs.
//! No cache or poster selection here: scraped posters take priority in the caller.
use super::ffi::Mpv;
use crate::settings::AppError;
use std::{
    io::Read,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};
const TIMEOUT: Duration = Duration::from_secs(12);
const MAX_BYTES: u64 = 1_000_000;
// Bound stuck native operations as well as normal concurrent requests. A timed-out
// worker retains this slot until libmpv actually returns; no unbounded thread leak.
static BUSY: AtomicBool = AtomicBool::new(false);
fn error(code: &'static str) -> AppError {
    AppError::new(code, "Local video thumbnail unavailable", true)
}
struct Slot;
impl Drop for Slot {
    fn drop(&mut self) {
        BUSY.store(false, Ordering::Release);
    }
}
/// Returns a real PNG (both dimensions <=320, strictly less than 1 MB).
/// Blocking API: call from a command's spawn_blocking, never the UI thread.
/// The caller returns after 12s even if a native call stalls. Rust cannot safely
/// kill native threads; a stalled worker keeps the single admission slot occupied.
pub fn extract(runtime: &Path, video: &Path) -> Result<Vec<u8>, AppError> {
    if !video.is_absolute() || !video.is_file() {
        return Err(error("THUMBNAIL_LOCAL_FILE"));
    }
    let source = video.to_str().ok_or_else(|| error("THUMBNAIL_PATH"))?;
    dispatch(runtime, source.to_owned(), false)
}

/// Only accepts an account-authorized gateway proxy; caller owns registration/revocation.
pub fn extract_remote(runtime: &Path, proxy: &str) -> Result<Vec<u8>, AppError> {
    validate_proxy(proxy)?;
    dispatch(runtime, proxy.to_owned(), true)
}

fn validate_proxy(proxy: &str) -> Result<(), AppError> {
    let url = url::Url::parse(proxy).map_err(|_| error("THUMBNAIL_PROXY"))?;
    // Check raw authority too: URL parsers normalize shorthand/hex IPv4 and empty userinfo.
    let authority = proxy
        .strip_prefix("http://")
        .and_then(|s| s.split(['/', '?', '#']).next())
        .ok_or_else(|| error("THUMBNAIL_PROXY"))?;
    let port = authority
        .strip_prefix("127.0.0.1:")
        .filter(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
        .and_then(|p| p.parse::<u16>().ok())
        .filter(|p| *p != 0);
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || port.is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || proxy.chars().any(|c| c.is_control() || c == '\\')
    {
        return Err(error("THUMBNAIL_PROXY"));
    }
    Ok(())
}

fn dispatch(runtime: &Path, source: String, remote: bool) -> Result<Vec<u8>, AppError> {
    if BUSY
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(error("THUMBNAIL_BUSY"));
    }
    let slot = Slot;
    let runtime = runtime.to_owned();
    let (send, receive) = mpsc::sync_channel(1);
    let deadline = Instant::now() + TIMEOUT;
    std::thread::Builder::new()
        .name("local-thumbnail".into())
        .spawn(move || {
            let _slot = slot;
            let result = run(&runtime, &source, remote, deadline);
            drop(_slot);
            let _ = send.send(result);
        })
        .map_err(|_| error("THUMBNAIL_THREAD"))?;
    receive
        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        .map_err(|_| error("THUMBNAIL_TIMEOUT"))?
}
fn run(runtime: &Path, source: &str, remote: bool, deadline: Instant) -> Result<Vec<u8>, AppError> {
    let directory = tempfile::tempdir().map_err(|_| error("THUMBNAIL_IO"))?;
    let output = directory.path().join("frame.png");
    let target = output.to_str().ok_or_else(|| error("THUMBNAIL_PATH"))?;
    let mut mpv = if remote {
        Mpv::thumbnail_gateway(runtime)?
    } else {
        Mpv::thumbnail(runtime)?
    };
    // Source is an authorized absolute path or a strictly validated gateway URL.
    mpv.command(&["loadfile", source, "replace"])?;
    let mut loaded = false;
    while Instant::now() < deadline {
        let event = mpv.wait(0.05);
        if !event.is_null() {
            // Pointer valid until next wait() on this private client.
            match unsafe { (*event).id } {
                8 => loaded = true,
                1 | 7 => return Err(error("THUMBNAIL_DECODE")),
                _ => {}
            }
        }
        // A paused first frame avoids waiting for a fixed seek on very short clips.
        if loaded && mpv.number("video-out-params/w").is_some() {
            if mpv
                .command(&["screenshot-to-file", target, "video"])
                .is_ok()
            {
                let file = std::fs::File::open(&output).map_err(|_| error("THUMBNAIL_IO"))?;
                let mut bytes = Vec::new();
                file.take(MAX_BYTES)
                    .read_to_end(&mut bytes)
                    .map_err(|_| error("THUMBNAIL_IO"))?;
                validate_png(&bytes)?;
                return Ok(bytes);
            }
        }
    }
    Err(error("THUMBNAIL_TIMEOUT"))
}
fn validate_png(bytes: &[u8]) -> Result<(), AppError> {
    if bytes.len() < 45
        || bytes.len() as u64 >= MAX_BYTES
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || &bytes[12..16] != b"IHDR"
        || !bytes.ends_with(b"\0\0\0\0IEND\xaeB`\x82")
    {
        return Err(error("THUMBNAIL_IMAGE"));
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let h = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if w == 0 || h == 0 || w > 320 || h > 320 {
        return Err(error("THUMBNAIL_SIZE"));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    static REAL_TEST: std::sync::Mutex<()> = std::sync::Mutex::new(());
    #[test]
    fn rejects_fake_png_and_nonlocal_input() {
        assert!(validate_png(b"not a PNG").is_err());
        assert!(extract(Path::new("."), Path::new("https://example.com/a.mp4")).is_err());
    }
    #[test]
    fn rejects_non_gateway_urls() {
        for proxy in [
            "http://example.com:1234/video",
            "https://127.0.0.1:1234/video",
            "http://localhost:1234/video",
            "http://127.0.0.1/video",
            "http://127.0.0.1:0/video",
            "http://127.0.0.1:65536/video",
            "http://user:password@127.0.0.1:1234/video",
            "http://@127.0.0.1:1234/video",
            "http://127.1:1234/video",
            "http://2130706433:1234/video",
            "http://127.0.0.1.example.com:1234/video",
            "file:///tmp/video.mp4",
            "http://127.0.0.1:1234/video#fragment",
        ] {
            assert!(
                extract_remote(Path::new("."), proxy).is_err(),
                "invalid gateway accepted"
            );
        }
        assert!(validate_proxy("http://127.0.0.1:1234/native/fixture?key=fixture").is_ok());
    }
    #[test]
    #[ignore = "requires thumbnail runtime/video env; serves only a local fixture, no credentials"]
    fn real_gateway_video() {
        let _guard = REAL_TEST.lock().unwrap();
        use std::{
            io::{Seek, SeekFrom, Write},
            net::TcpListener,
        };
        let runtime = std::env::var_os("BOXPLAYER_THUMBNAIL_RUNTIME").expect("runtime");
        let video = std::env::var_os("BOXPLAYER_THUMBNAIL_VIDEO").expect("local fixture");
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let done = stop.clone();
        let server = std::thread::spawn(move || {
            let until = Instant::now() + Duration::from_secs(15);
            while !done.load(Ordering::Acquire) && Instant::now() < until {
                let (mut socket, _) = match listener.accept() {
                    Ok(pair) => pair,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(e) => panic!("fixture accept: {e}"),
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                socket
                    .set_write_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0];
                while request.len() < 16384 && !request.ends_with(b"\r\n\r\n") {
                    if socket.read(&mut byte).unwrap_or(0) == 0 {
                        break;
                    }
                    request.push(byte[0]);
                }
                let mut file = std::fs::File::open(&video).unwrap();
                let size = file.metadata().unwrap().len();
                let request = String::from_utf8_lossy(&request).to_ascii_lowercase();
                let start = request
                    .lines()
                    .find_map(|line| line.strip_prefix("range: bytes="))
                    .and_then(|s| s.split('-').next())
                    .and_then(|s| s.parse::<u64>().ok())
                    .unwrap_or(0);
                if start >= size {
                    continue;
                }
                let header = format!("HTTP/1.1 206 Partial Content\r\nContent-Type: video/mp4\r\nAccept-Ranges: bytes\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n", size-start, start, size-1, size);
                if socket.write_all(header.as_bytes()).is_ok() {
                    file.seek(SeekFrom::Start(start)).unwrap();
                    let _ = std::io::copy(&mut file, &mut socket);
                }
            }
        });
        let result = extract_remote(
            Path::new(&runtime),
            &format!("http://{address}/fixture.mp4"),
        );
        stop.store(true, Ordering::Release);
        server.join().unwrap();
        let bytes = result.expect("real loopback HTTP extraction");
        validate_png(&bytes).unwrap();
        assert!(bytes.len() > 1000);
        eprintln!("gateway PNG: {} bytes", bytes.len());
    }
    #[test]
    #[ignore = "requires BOXPLAYER_THUMBNAIL_RUNTIME and BOXPLAYER_THUMBNAIL_VIDEO; offline real libmpv"]
    fn real_local_video() {
        let _guard = REAL_TEST.lock().unwrap();
        let runtime = std::env::var_os("BOXPLAYER_THUMBNAIL_RUNTIME").expect("runtime directory");
        let video = std::env::var_os("BOXPLAYER_THUMBNAIL_VIDEO").expect("authorized local video");
        let bytes =
            extract(Path::new(&runtime), Path::new(&video)).expect("real libmpv extraction");
        validate_png(&bytes).unwrap();
        assert!(bytes.len() > 1000, "real frame should contain image data");
        eprintln!(
            "real PNG: {} bytes, {}x{}",
            bytes.len(),
            u32::from_be_bytes(bytes[16..20].try_into().unwrap()),
            u32::from_be_bytes(bytes[20..24].try_into().unwrap())
        );
        if let Some(output) = std::env::var_os("BOXPLAYER_THUMBNAIL_OUTPUT") {
            std::fs::write(output, bytes).unwrap();
        }
    }
}
