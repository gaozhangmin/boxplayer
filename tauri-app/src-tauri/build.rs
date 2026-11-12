// Copy only application registration keys into ignored build output. Never read user accounts.
fn main() {
    let source = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join("../../src/secrets.generated.ts");
    println!("cargo:rerun-if-changed={}", source.display());
    // Direct cargo builds are useful for tests. App builds go through tauri.mjs,
    // which requires a complete registration and injects only these application keys.
    let text = std::fs::read_to_string(&source).unwrap_or_default();
    let mut config = serde_json::Map::new();
    for key in [
        "ALIYUN_APP_ID",
        "ALIYUN_APP_SECRET",
        "BAIDU_APP_ID",
        "BAIDU_APP_SECRET",
        "CLOUD123_APP_ID",
        "CLOUD123_APP_SECRET",
        "DRIVE115_APP_ID",
        "DRIVE115_APP_SECRET",
        "ONEDRIVE_CLIENT_ID",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "DROPBOX_APP_KEY",
        "DROPBOX_APP_SECRET",
        "BOX_CLIENT_ID",
        "BOX_CLIENT_SECRET",
        "GUANGYA_CLIENT_ID",
        "CLOUD189_APP_ID",
        "PIKPAK_CLIENT_ID",
        "PIKPAK_CLIENT_SECRET",
        "BOXPLAYER_SITE_URL",
        "TRAKT_CLIENT_ID",
    ] {
        let env_key = format!("BOXPLAYER_{}", key);
        println!("cargo:rerun-if-env-changed={}", env_key);
        let value = std::env::var(&env_key)
            .ok()
            .or_else(|| {
                let prefix = format!("export const {} =", key);
                text.lines().find_map(|line| {
                    line.trim().strip_prefix(&prefix).and_then(|rest| {
                        serde_json::from_str::<String>(rest.trim().trim_end_matches(';')).ok()
                    })
                })
            })
            .unwrap_or_default();
        config.insert(key.into(), value.into());
    }
    let output =
        std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("provider-config.json");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    options
        .open(output)
        .expect("Unable to create private provider build config")
        .write_all(&serde_json::to_vec(&config).unwrap())
        .expect("Unable to write provider build config");
    tauri_build::build()
}
