// HDR output routing adapted from FengZeng/soia baec808 mpv/hdr_output.rs (GPL-3.0-only).
// Direct libmpv properties only: no soia_utils or private brightness APIs.
use super::ffi::Mpv;
#[derive(Default)]
pub(super) struct HdrOutput {
    enabled: bool,
    previous: Vec<(&'static str, String)>,
}
#[cfg(target_os = "macos")]
const OPTIONS: &[(&str, &str)] = &[
    ("target-colorspace-hint", "yes"),
    ("target-prim", "display-p3"),
    ("target-trc", "pq"),
    ("tone-mapping", "auto"),
    ("hdr-compute-peak", "yes"),
    ("gamut-mapping-mode", "perceptual"),
    ("cocoa-cb-output-csp", "display-p3-pq"),
];
#[cfg(not(target_os = "macos"))]
const OPTIONS: &[(&str, &str)] = &[]; // Target-platform HDR routing is not validated yet.
fn is_hdr(transfer: &str) -> bool {
    matches!(transfer.to_ascii_lowercase().as_str(), "pq" | "hlg")
}
impl HdrOutput {
    pub fn enabled(&self) -> bool {
        self.enabled
    }
    pub fn update(&mut self, mpv: &mut Mpv) -> Result<(), crate::settings::AppError> {
        let Some(params) = mpv.json("video-params") else {
            return Ok(());
        };
        let Some(transfer) = params.get("gamma").and_then(|v| v.as_str()) else {
            return Ok(());
        };
        let desired = is_hdr(transfer);
        if self.enabled == desired || OPTIONS.is_empty() {
            return Ok(());
        }
        if desired {
            let before = OPTIONS
                .iter()
                .map(|(name, _)| mpv.string(name).map(|value| (*name, value)))
                .collect::<Option<Vec<_>>>()
                .ok_or_else(|| {
                    crate::settings::AppError::new(
                        "HDR_OPTIONS",
                        "HDR output options unavailable",
                        false,
                    )
                })?;
            for (name, value) in OPTIONS {
                if let Err(error) = mpv.set(name, value) {
                    for (name, value) in &before {
                        let _ = mpv.set(name, value);
                    }
                    return Err(error);
                }
            }
            self.previous = before;
        } else {
            for (name, value) in &self.previous {
                mpv.set(name, value)?;
            }
            self.previous.clear();
        }
        self.enabled = desired;
        log::info!(
            "HDR output option routing: {}",
            if desired {
                "enabled"
            } else {
                "restored SDR defaults"
            }
        );
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hdr_is_detected_by_transfer_not_pixel_depth_or_filename() {
        assert!(is_hdr("pq"));
        assert!(is_hdr("hlg"));
        assert!(is_hdr("PQ"));
        for value in ["bt.1886", "gamma2.2", "srgb", "unknown", "p010", "10bit"] {
            assert!(!is_hdr(value));
        }
    }
}
