//! Stateless, account-resource-bound HLS links; upstream credential URLs stay native.
use crate::settings::AppError;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{
    aead,
    rand::{SecureRandom, SystemRandom},
};
use std::sync::atomic::{AtomicU64, Ordering};
use url::Url;
pub struct HlsKey([u8; 32], AtomicU64);
fn error() -> AppError {
    AppError::new("HLS_MANIFEST", "HLS 清单或子资源地址无效", false)
}
impl HlsKey {
    pub fn new() -> Result<Self, AppError> {
        let mut key = [0u8; 32];
        SystemRandom::new().fill(&mut key).map_err(|_| error())?;
        Ok(Self(key, AtomicU64::new(0)))
    }
    pub fn invalidate_session(&self) {
        self.1.fetch_add(1, Ordering::SeqCst);
    }
    pub fn generation(&self) -> u64 {
        self.1.load(Ordering::SeqCst)
    }
    fn key(&self) -> Result<aead::LessSafeKey, AppError> {
        Ok(aead::LessSafeKey::new(
            aead::UnboundKey::new(&aead::AES_256_GCM, &self.0).map_err(|_| error())?,
        ))
    }
    #[cfg(test)]
    pub fn wrap(&self, base: &str, upstream: &Url, value: &str) -> Result<String, AppError> {
        self.wrap_at(base, upstream, value, self.generation())
    }
    fn wrap_at(
        &self,
        base: &str,
        upstream: &Url,
        value: &str,
        generation: u64,
    ) -> Result<String, AppError> {
        if value.starts_with("data:") {
            return Ok(value.into());
        }
        let url = upstream.join(value).map_err(|_| error())?;
        if !matches!(url.scheme(), "http" | "https")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.as_str().len() > 16384
        {
            return Err(error());
        }
        let mut nonce = [0u8; 12];
        SystemRandom::new().fill(&mut nonce).map_err(|_| error())?;
        let mut data = generation.to_be_bytes().to_vec();
        data.extend_from_slice(url.as_str().as_bytes());
        self.key()?
            .seal_in_place_append_tag(
                aead::Nonce::assume_unique_for_key(nonce),
                aead::Aad::from(b"boxplayer-hls-v1"),
                &mut data,
            )
            .map_err(|_| error())?;
        let mut encoded = nonce.to_vec();
        encoded.extend(data);
        Ok(format!("{base}/hls/{}", URL_SAFE_NO_PAD.encode(encoded)))
    }
    pub fn open(&self, value: &str) -> Result<String, AppError> {
        if value.len() > 24000 {
            return Err(error());
        }
        let mut data = URL_SAFE_NO_PAD.decode(value).map_err(|_| error())?;
        if data.len() < 28 {
            return Err(error());
        }
        let nonce: [u8; 12] = data[..12].try_into().map_err(|_| error())?;
        let text = self
            .key()?
            .open_in_place(
                aead::Nonce::assume_unique_for_key(nonce),
                aead::Aad::from(b"boxplayer-hls-v1"),
                &mut data[12..],
            )
            .map_err(|_| error())?;
        if text.len() < 8 || text[..8] != self.1.load(Ordering::SeqCst).to_be_bytes() {
            return Err(error());
        }
        String::from_utf8(text[8..].to_vec()).map_err(|_| error())
    }
    #[cfg(test)]
    pub fn rewrite(&self, body: &[u8], upstream: &Url, base: &str) -> Result<String, AppError> {
        self.rewrite_at(body, upstream, base, self.generation())
    }
    pub fn rewrite_at(
        &self,
        body: &[u8],
        upstream: &Url,
        base: &str,
        generation: u64,
    ) -> Result<String, AppError> {
        if self.generation() != generation {
            return Err(error());
        }
        let text = std::str::from_utf8(body)
            .map_err(|_| error())?
            .trim_start_matches('\u{feff}');
        if !text.starts_with("#EXTM3U") {
            return Err(error());
        }
        let uri = regex::Regex::new(r#"URI="([^"]+)""#).map_err(|_| error())?;
        let mut result = String::new();
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('#') {
                let mut end = 0;
                for captures in uri.captures_iter(line) {
                    let value = captures.get(1).ok_or_else(error)?;
                    result.push_str(&line[end..value.start()]);
                    result.push_str(&self.wrap_at(base, upstream, value.as_str(), generation)?);
                    end = value.end();
                }
                result.push_str(&line[end..]);
            } else if !trimmed.is_empty() {
                result.push_str(&self.wrap_at(base, upstream, trimmed, generation)?)
            }
            result.push('\n');
            if result.len() > 16 * 1024 * 1024 {
                return Err(error());
            }
        }
        if self.generation() != generation {
            return Err(error());
        }
        Ok(result)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manifests_cover_segments_keys_maps_and_nested_lists_without_disclosing_queries() {
        let key = HlsKey::new().unwrap();
        let upstream =
            Url::parse("https://server.test/prefix/master.m3u8?api_key=synthetic").unwrap();
        let output=key.rewrite(b"#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin?api_key=synthetic\"\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:2,\nchild/list.m3u8?api_key=synthetic\n",&upstream,"http://127.0.0.1/media/parent").unwrap();
        assert!(!output.contains("synthetic"));
        assert!(!output.contains("server.test"));
        let line = output
            .lines()
            .find(|line| line.starts_with("http:"))
            .unwrap();
        let token = line.rsplit('/').next().unwrap();
        assert_eq!(
            key.open(token).unwrap(),
            "https://server.test/prefix/child/list.m3u8?api_key=synthetic"
        );
        assert!(HlsKey::new().unwrap().open(token).is_err());
        let mut damaged = token.as_bytes().to_vec();
        damaged[20] = if damaged[20] == b'A' { b'B' } else { b'A' };
        assert!(key.open(std::str::from_utf8(&damaged).unwrap()).is_err());
        let generation = key.generation();
        key.invalidate_session();
        assert!(key
            .rewrite_at(
                b"#EXTM3U\nold.ts\n",
                &upstream,
                "http://127.0.0.1/media/parent",
                generation
            )
            .is_err());
        assert!(key.open(token).is_err());
        let fresh = key
            .wrap("http://127.0.0.1/media/parent", &upstream, "new.m3u8")
            .unwrap();
        assert!(key
            .open(fresh.rsplit('/').next().unwrap())
            .unwrap()
            .ends_with("new.m3u8"));
    }
}
