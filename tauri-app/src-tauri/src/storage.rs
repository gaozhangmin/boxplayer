use crate::settings::AppError;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

pub fn identity(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn db_error(_: rusqlite::Error) -> AppError {
    AppError::new(
        "DATABASE",
        "Unable to read or write the development library",
        true,
    )
}
#[derive(Clone)]
pub struct Library {
    pub path: PathBuf,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LocalSource {
    pub id: String,
    pub name: String,
    pub path: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Position {
    pub key: String,
    pub position: f64,
    pub duration: f64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEntry {
    pub id: String,
    pub name: String,
    pub relative_path: String,
    pub is_directory: bool,
    pub size: u64,
    pub modified: u64,
    pub playable: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalListing {
    pub source_id: String,
    pub relative_path: String,
    pub parent_path: Option<String>,
    pub entries: Vec<LocalEntry>,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationPayload {
    pub sources: Vec<LocalSource>,
    pub positions: Vec<Position>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MigrationBundle {
    pub schema_version: u32,
    pub source_version: String,
    pub source_count: usize,
    pub position_count: usize,
    pub sha256: String,
    pub payload: MigrationPayload,
}
impl Library {
    pub fn open(directory: &Path) -> Result<Self, AppError> {
        fs::create_dir_all(directory).map_err(AppError::io)?;
        let lib = Self {
            path: directory.join("library.sqlite3"),
        };
        lib.connect()?.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE); CREATE TABLE IF NOT EXISTS positions(key TEXT PRIMARY KEY, position REAL NOT NULL, duration REAL NOT NULL); CREATE TABLE IF NOT EXISTS imports(sha256 TEXT PRIMARY KEY);") .map_err(db_error)?;
        Ok(lib)
    }
    pub fn connect(&self) -> Result<Connection, AppError> {
        let db = Connection::open(&self.path).map_err(db_error)?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(db_error)?;
        Ok(db)
    }
    pub fn sources(&self) -> Result<Vec<LocalSource>, AppError> {
        let db = self.connect()?;
        let mut stmt = db
            .prepare("SELECT id,name,path FROM sources ORDER BY name,id")
            .map_err(db_error)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(LocalSource {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    path: r.get(2)?,
                })
            })
            .map_err(db_error)?;
        rows.collect::<Result<_, _>>().map_err(db_error)
    }
    pub fn add_source(&self, path: &Path) -> Result<LocalSource, AppError> { self.add_source_named(path,None) }
    pub fn add_source_named(&self, path: &Path, name:Option<&str>) -> Result<LocalSource, AppError> {
        let path = path.canonicalize().map_err(AppError::io)?;
        if !path.is_dir() {
            return Err(AppError::new("NOT_DIRECTORY", "Select a directory", false));
        }
        let source = LocalSource {
            id: identity(&path.to_string_lossy()),
            name: name.map(str::to_owned).unwrap_or_else(||path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.display().to_string())),
            path: path.to_string_lossy().into_owned(),
        };
        self.connect()?.execute("INSERT INTO sources(id,name,path) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,path=excluded.path",params![source.id,source.name,source.path]).map_err(db_error)?;
        Ok(source)
    }
    pub fn resolve(&self, source_id: &str, relative: &str) -> Result<PathBuf, AppError> {
        let source = self
            .sources()?
            .into_iter()
            .find(|s| s.id == source_id)
            .ok_or_else(|| AppError::new("SOURCE_MISSING", "Source is unavailable", false))?;
        let root = PathBuf::from(source.path)
            .canonicalize()
            .map_err(AppError::io)?;
        let selected = root.join(relative).canonicalize().map_err(AppError::io)?;
        if !selected.starts_with(&root) {
            return Err(AppError::new(
                "OUTSIDE_SOURCE",
                "Path is outside the selected source",
                false,
            ));
        }
        Ok(selected)
    }
    pub fn list(&self, source_id: &str, relative: &str) -> Result<LocalListing, AppError> {
        let root = self.resolve(source_id, "")?;
        let current = self.resolve(source_id, relative)?;
        if !current.is_dir() {
            return Err(AppError::new(
                "NOT_DIRECTORY",
                "Path is not a directory",
                false,
            ));
        }
        let normalized = current
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let mut entries = Vec::new();
        for entry in fs::read_dir(&current).map_err(AppError::io)? {
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            let Ok(canonical) = path.canonicalize() else {
                continue;
            };
            if !canonical.starts_with(&root) {
                continue;
            }
            let Ok(meta) = entry.metadata() else { continue };
            if !meta.is_file() && !meta.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            entries.push(LocalEntry {
                id: identity(&canonical.to_string_lossy()),
                name,
                relative_path: path
                    .strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                is_directory: meta.is_dir(),
                size: meta.len(),
                modified: meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|t| t.as_secs())
                    .unwrap_or(0),
                playable: is_video(&path),
            });
        }
        entries.sort_by(|a, b| {
            b.is_directory
                .cmp(&a.is_directory)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        let parent_path = if normalized.is_empty() {
            None
        } else {
            Some(
                current
                    .parent()
                    .unwrap()
                    .strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
            )
        };
        Ok(LocalListing {
            source_id: source_id.into(),
            relative_path: normalized,
            parent_path,
            entries,
        })
    }
    pub fn position(&self, key: &str) -> Result<Option<Position>, AppError> {
        let mut db=self.connect()?;
        let tx=db.transaction().map_err(db_error)?;
        let key=crate::remote_identity::resolve_position_key(&tx,key)?;
        let result=tx
            .query_row(
                "SELECT key,position,duration FROM positions WHERE key=?1",
                [&key],
                |r| {
                    Ok(Position {
                        key: r.get(0)?,
                        position: r.get(1)?,
                        duration: r.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(result)
    }
    pub fn save_position(&self, position: &Position) -> Result<(), AppError> {
        validate_position(position)?;
        let mut db=self.connect()?;
        let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(db_error)?;
        let key=crate::remote_identity::resolve_position_key(&tx,&position.key)?;
        tx.execute("INSERT INTO positions(key,position,duration) VALUES(?1,?2,?3) ON CONFLICT(key) DO UPDATE SET position=excluded.position,duration=excluded.duration",params![key,position.position,position.duration]).map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(())
    }
    pub fn export_bundle(&self) -> Result<MigrationBundle, AppError> {
        let db = self.connect()?;
        let mut stmt = db
            .prepare("SELECT key,position,duration FROM positions ORDER BY key")
            .map_err(db_error)?;
        let positions = stmt
            .query_map([], |r| {
                Ok(Position {
                    key: r.get(0)?,
                    position: r.get(1)?,
                    duration: r.get(2)?,
                })
            })
            .map_err(db_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(db_error)?;
        let payload = MigrationPayload {
            sources: self.sources()?,
            positions,
        };
        let sha256 = payload_digest(&payload)?;
        Ok(MigrationBundle {
            schema_version: 1,
            source_version: env!("CARGO_PKG_VERSION").into(),
            source_count: payload.sources.len(),
            position_count: payload.positions.len(),
            sha256,
            payload,
        })
    }
    pub fn import_bundle(&self, bundle: &MigrationBundle) -> Result<bool, AppError> {
        validate_bundle(bundle)?;
        let mut db = self.connect()?;
        let tx = db.transaction().map_err(db_error)?;
        if tx
            .query_row(
                "SELECT 1 FROM imports WHERE sha256=?1",
                [&bundle.sha256],
                |r| r.get::<_, u8>(0),
            )
            .optional()
            .map_err(db_error)?
            .is_some()
        {
            return Ok(false);
        }
        // Preserve target records on collision; importing old data must not overwrite newer progress.
        for source in &bundle.payload.sources {
            tx.execute(
                "INSERT OR IGNORE INTO sources(id,name,path) VALUES(?1,?2,?3)",
                params![source.id, source.name, source.path],
            )
            .map_err(db_error)?;
        }
        for p in &bundle.payload.positions {
            tx.execute(
                "INSERT OR IGNORE INTO positions(key,position,duration) VALUES(?1,?2,?3)",
                params![p.key, p.position, p.duration],
            )
            .map_err(db_error)?;
        }
        tx.execute("INSERT INTO imports(sha256) VALUES(?1)", [&bundle.sha256])
            .map_err(db_error)?;
        tx.commit().map_err(db_error)?;
        Ok(true)
    }
}
pub fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|v| v.to_str())
        .map(|v| {
            matches!(
                v.to_ascii_lowercase().as_str(),
                "mp4"
                    | "mkv"
                    | "mov"
                    | "avi"
                    | "webm"
                    | "m4v"
                    | "ts"
                    | "m2ts"
                    | "wmv"
                    | "flv"
                    | "mpg"
                    | "mpeg"
            )
        })
        .unwrap_or(false)
}
fn validate_position(p: &Position) -> Result<(), AppError> {
    if p.key.is_empty()
        || !p.position.is_finite()
        || !p.duration.is_finite()
        || p.position < 0.0
        || p.duration < 0.0
        || p.position > p.duration + 1.0
    {
        return Err(AppError::new(
            "POSITION_INVALID",
            "Invalid playback position",
            false,
        ));
    }
    Ok(())
}
fn payload_digest(payload: &MigrationPayload) -> Result<String, AppError> {
    let bytes = serde_json::to_vec(payload)
        .map_err(|_| AppError::new("MIGRATION_INVALID", "Invalid migration payload", false))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
pub fn validate_bundle(b: &MigrationBundle) -> Result<(), AppError> {
    let invalid = || {
        AppError::new(
            "MIGRATION_INVALID",
            "Migration version, counts or checksum are invalid",
            false,
        )
    };
    if b.schema_version != 1
        || b.source_count != b.payload.sources.len()
        || b.position_count != b.payload.positions.len()
        || b.sha256 != payload_digest(&b.payload)?
    {
        return Err(invalid());
    }
    let mut ids = std::collections::HashSet::new();
    let mut paths = std::collections::HashSet::new();
    for s in &b.payload.sources {
        if !Path::new(&s.path).is_absolute()
            || s.name.trim().is_empty()
            || s.id != identity(&s.path)
            || !ids.insert(&s.id)
            || !paths.insert(&s.path)
        {
            return Err(invalid());
        }
    }
    let mut keys = std::collections::HashSet::new();
    for p in &b.payload.positions {
        validate_position(p)?;
        if !keys.insert(&p.key) {
            return Err(invalid());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn named_folder_keeps_identity_and_survives_restart() {
        let dir=tempfile::tempdir().unwrap();let root=dir.path().join("videos");fs::create_dir(&root).unwrap();
        let data=dir.path().join("data");let library=Library::open(&data).unwrap();
        assert!(library.sources().unwrap().is_empty());
        let saved=library.add_source_named(&root,Some("My videos")).unwrap();
        assert_eq!(saved.name,"My videos");assert_eq!(library.sources().unwrap().len(),1);
        assert_eq!(Library::open(&data).unwrap().sources().unwrap()[0].name,"My videos");
        let renamed=library.add_source_named(&root,Some("Renamed")).unwrap();assert_eq!(saved.id,renamed.id);assert_eq!(library.sources().unwrap().len(),1);
    }
    #[test]
    fn browse_scope_and_restart() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("videos");
        fs::create_dir(&root).unwrap();
        fs::write(root.join("a.mp4"), b"video").unwrap();
        fs::create_dir(root.join("series")).unwrap();
        let lib = Library::open(&dir.path().join("data")).unwrap();
        let s = lib.add_source(&root).unwrap();
        assert_eq!(lib.list(&s.id, "").unwrap().entries[0].name, "series");
        assert!(lib.resolve(&s.id, "..").is_err());
        assert_eq!(
            Library::open(&dir.path().join("data"))
                .unwrap()
                .sources()
                .unwrap()
                .len(),
            1
        );
    }
    #[test]
    fn migration_roundtrip_is_idempotent_and_rejects_damage() {
        let d = tempfile::tempdir().unwrap();
        let a = Library::open(&d.path().join("a")).unwrap();
        a.add_source(d.path()).unwrap();
        a.save_position(&Position {
            key: "local:item".into(),
            position: 3.0,
            duration: 10.0,
        })
        .unwrap();
        let bundle = a.export_bundle().unwrap();
        let before = serde_json::to_vec(&a.export_bundle().unwrap()).unwrap();
        let b = Library::open(&d.path().join("b")).unwrap();
        assert!(b.import_bundle(&bundle).unwrap());
        assert!(!b.import_bundle(&bundle).unwrap());
        let exported = b.export_bundle().unwrap();
        assert_eq!(bundle.payload.sources, exported.payload.sources);
        assert_eq!(bundle.payload.positions, exported.payload.positions);
        let mut damaged = bundle;
        damaged.payload.positions[0].position = 8.0;
        assert!(b.import_bundle(&damaged).is_err());
        assert_eq!(b.position("local:item").unwrap().unwrap().position, 3.0);
        assert_eq!(
            before,
            serde_json::to_vec(&a.export_bundle().unwrap()).unwrap()
        );
    }
    #[test]
    fn failed_import_rolls_back_all_target_writes() {
        let d = tempfile::tempdir().unwrap();
        let source = Library::open(&d.path().join("source")).unwrap();
        source.add_source(d.path()).unwrap();
        source
            .save_position(&Position {
                key: "item".into(),
                position: 2.0,
                duration: 10.0,
            })
            .unwrap();
        let target = Library::open(&d.path().join("target")).unwrap();
        target.connect().unwrap().execute_batch("CREATE TRIGGER reject_position BEFORE INSERT ON positions BEGIN SELECT RAISE(ABORT, 'test write failure'); END;").unwrap();
        assert!(target
            .import_bundle(&source.export_bundle().unwrap())
            .is_err());
        assert!(target.sources().unwrap().is_empty());
        assert!(target.position("item").unwrap().is_none());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_outside_source() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("source");
        fs::create_dir(&root).unwrap();
        fs::write(d.path().join("outside.mp4"), b"sample").unwrap();
        std::os::unix::fs::symlink(d.path().join("outside.mp4"), root.join("escape.mp4")).unwrap();
        let library = Library::open(&d.path().join("data")).unwrap();
        let source = library.add_source(&root).unwrap();
        assert!(library.resolve(&source.id, "escape.mp4").is_err());
        assert!(library.list(&source.id, "").unwrap().entries.is_empty());
    }
    #[test]
    fn rejects_non_finite_positions() {
        let d = tempfile::tempdir().unwrap();
        let lib = Library::open(d.path()).unwrap();
        assert!(lib
            .save_position(&Position {
                key: "x".into(),
                position: f64::NAN,
                duration: 5.0
            })
            .is_err());
    }
}
