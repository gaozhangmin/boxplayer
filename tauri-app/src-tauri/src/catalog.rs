//! Isolated Tauri video catalog; never opens Electron databases.
use crate::{settings::AppError, storage::Library};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Catalog {
    pub schema_version: u32,
    pub revision: u64,
    pub items: Vec<Value>,
    pub playlists: Value,
    pub series: Value,
}
impl Default for Catalog {
    fn default() -> Self {
        Self {
            schema_version: 1,
            revision: 0,
            items: vec![],
            playlists: serde_json::json!({}),
            series: serde_json::json!({}),
        }
    }
}
fn error(code: &'static str, message: &str) -> AppError {
    AppError::new(code, message, false)
}
fn connect(library: &Library) -> Result<rusqlite::Connection, AppError> {
    let db = library.connect()?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS video_catalog(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL);").map_err(|_|error("CATALOG_STORAGE","无法打开媒体库"))?;
    Ok(db)
}
pub fn load(library: &Library) -> Result<Catalog, AppError> {
    let db = connect(library)?;
    let body: Option<String> = db
        .query_row("SELECT body FROM video_catalog WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|_| error("CATALOG_STORAGE", "无法读取媒体库"))?;
    body.map(|body| {
        serde_json::from_str(&body)
            .map_err(|_| error("CATALOG_CORRUPT", "媒体库数据损坏，未覆盖原数据"))
    })
    .unwrap_or_else(|| Ok(Catalog::default()))
}
pub fn validate(catalog: &Catalog) -> Result<(), AppError> {
    if catalog.schema_version != 1
        || catalog.items.len() > 100000
        || !catalog.playlists.is_object()
        || !catalog.series.is_object()
    {
        return Err(error("CATALOG_INVALID", "媒体库格式无效"));
    }
    let mut ids = std::collections::HashSet::new();
    for item in &catalog.items {
        let id = item["id"]
            .as_str()
            .filter(|s| !s.is_empty())
            .ok_or_else(|| error("CATALOG_INVALID", "媒体条目缺少标识"))?;
        if !ids.insert(id) {
            return Err(error("CATALOG_INVALID", "媒体标识重复"));
        }
    }
    for groups in [&catalog.playlists, &catalog.series] {
        for members in groups.as_object().unwrap().values() {
            let members=members.as_array().ok_or_else(||error("CATALOG_INVALID","集合成员格式无效"))?;
            let mut unique=std::collections::HashSet::new();
            for member in members { let id=member.as_str().ok_or_else(||error("CATALOG_INVALID","集合标识无效"))?; if !ids.contains(id)||!unique.insert(id) {return Err(error("CATALOG_INVALID","集合引用缺失或重复"));} }
        }
    }
    Ok(())
}
pub fn save(library: &Library, expected: u64, mut catalog: Catalog) -> Result<Catalog, AppError> {
    validate(&catalog)?;
    catalog.revision = expected
        .checked_add(1)
        .ok_or_else(|| error("CATALOG_INVALID", "媒体库版本无效"))?;
    let body =
        serde_json::to_string(&catalog).map_err(|_| error("CATALOG_INVALID", "媒体库格式无效"))?;
    if body.len() > 64 * 1024 * 1024 {
        return Err(error("CATALOG_LIMIT", "媒体库数据过大"));
    }
    let mut db = connect(library)?;
    let tx = db
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|_| error("CATALOG_STORAGE", "无法保存媒体库"))?;
    let revision: u64 = tx
        .query_row("SELECT revision FROM video_catalog WHERE id=1", [], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|_| error("CATALOG_STORAGE", "无法读取媒体库版本"))?
        .unwrap_or(0);
    if revision != expected {
        return Err(error("CATALOG_CONFLICT", "媒体库已更新，请刷新后重试"));
    }
    crate::local_journal::ensure_catalog_writable(&tx)?;
    // A matching revision alone must never authorize overwriting corrupt data.
    let previous: Option<String> = tx.query_row("SELECT body FROM video_catalog WHERE id=1", [], |row| row.get(0)).optional().map_err(|_| error("CATALOG_STORAGE", "无法读取媒体库"))?;
    if let Some(body) = previous {
        serde_json::from_str::<Catalog>(&body).map_err(|_| error("CATALOG_CORRUPT", "媒体库数据损坏，未覆盖原数据"))?;
    }
    tx.execute("INSERT INTO video_catalog(id,revision,body) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body",params![catalog.revision,body]).map_err(|_|error("CATALOG_STORAGE","无法保存媒体库"))?;
    tx.commit()
        .map_err(|_| error("CATALOG_STORAGE", "无法提交媒体库"))?;
    Ok(catalog)
}

pub fn remove_source(library:&Library,source:&str)->Result<Catalog,AppError>{remove_source_transaction(library,source,false)}
pub fn remove_local_source(library:&Library,source:&str)->Result<Catalog,AppError>{remove_source_transaction(library,source,true)}
fn remove_source_transaction(library:&Library,source:&str,local:bool)->Result<Catalog,AppError>{
 let mut db=connect(library)?;let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_|error("CATALOG_STORAGE","无法清理来源"))?;
 crate::local_journal::ensure_catalog_writable(&tx)?;
 let body:Option<String>=tx.query_row("SELECT body FROM video_catalog WHERE id=1",[],|row|row.get(0)).optional().map_err(|_|error("CATALOG_STORAGE","无法读取来源关联"))?;
 let mut catalog=match body{Some(body)=>serde_json::from_str::<Catalog>(&body).map_err(|_|error("CATALOG_CORRUPT","媒体库损坏，未移除来源"))?,None=>Catalog::default()};validate(&catalog)?;
 let removed:std::collections::HashSet<String>=catalog.items.iter().filter(|item|item["sourceId"].as_str()==Some(source)).filter_map(|item|item["id"].as_str().map(str::to_owned)).collect();
 catalog.items.retain(|item|item["sourceId"].as_str()!=Some(source));
 for groups in [&mut catalog.playlists,&mut catalog.series]{for members in groups.as_object_mut().unwrap().values_mut(){members.as_array_mut().unwrap().retain(|id|!id.as_str().is_some_and(|id|removed.contains(id)));}}
 // Advance even for an empty source: an in-flight scan must lose its old revision.
 catalog.revision=catalog.revision.checked_add(1).ok_or_else(||error("CATALOG_INVALID","媒体库版本溢出"))?;
 if local{tx.execute("DELETE FROM sources WHERE id=?1",[source]).map_err(|_|error("CATALOG_STORAGE","无法移除本地来源"))?;}
 let body=serde_json::to_string(&catalog).map_err(|_|error("CATALOG_INVALID","媒体库格式无效"))?;
 tx.execute("INSERT INTO video_catalog(id,revision,body) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body",params![catalog.revision,body]).map_err(|_|error("CATALOG_STORAGE","无法保存来源清理"))?;
 tx.commit().map_err(|_|error("CATALOG_STORAGE","无法提交来源清理"))?;Ok(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_removal_cleans_only_its_items_and_memberships() {
        let directory = tempfile::tempdir().unwrap();
        let library = Library::open(directory.path()).unwrap();
        let mut catalog = Catalog::default();
        catalog.items = vec![serde_json::json!({"id":"a", "sourceId":"one"}), serde_json::json!({"id":"b", "sourceId":"two"})];
        catalog.playlists = serde_json::json!({"mixed":["a","b"]});
        save(&library,0,catalog).unwrap();
        let saved = remove_source(&library,"one").unwrap();
        assert_eq!(saved.items.len(),1);
        assert_eq!(saved.items[0]["id"],"b");
        assert_eq!(saved.playlists["mixed"],serde_json::json!(["b"]));
    }
    #[test]
    fn reopen_preserves_catalog_and_rejects_stale_writer() {
        let directory = tempfile::tempdir().unwrap();
        let library = Library::open(directory.path()).unwrap();
        let mut catalog = load(&library).unwrap();
        catalog.items.push(serde_json::json!({"id":"video-1","watched":true}));
        catalog.playlists = serde_json::json!({"列表":["video-1"]});
        let saved = save(&library, 0, catalog).unwrap();
        let reopened = Library::open(directory.path()).unwrap();
        assert_eq!(load(&reopened).unwrap().items[0]["watched"], true);
        assert_eq!(load(&reopened).unwrap().playlists["列表"][0], "video-1");
        assert!(save(&reopened, 0, Catalog::default()).is_err());
        assert_eq!(load(&reopened).unwrap().revision, saved.revision);
    }
    #[test]
    fn invalid_and_corrupt_catalogs_cannot_overwrite_saved_data() {
        let directory = tempfile::tempdir().unwrap();
        let library = Library::open(directory.path()).unwrap();
        save(&library, 0, Catalog::default()).unwrap();
        let mut invalid = Catalog::default();
        invalid.items = vec![serde_json::json!({"id":"same"}), serde_json::json!({"id":"same"})];
        assert!(save(&library, 1, invalid).is_err());
        let db = connect(&library).unwrap();
        db.execute("UPDATE video_catalog SET body='broken'", []).unwrap();
        assert!(load(&library).is_err());
        assert!(save(&library, 1, Catalog::default()).is_err());
        let body: String = db.query_row("SELECT body FROM video_catalog", [], |row| row.get(0)).unwrap();
        assert_eq!(body, "broken");
    }
}
#[cfg(test)]mod cleanup_tests{use super::*;#[test]fn empty_source_removal_invalidates_inflight_scans_and_local_deletion_is_atomic(){let dir=tempfile::tempdir().unwrap();let library=Library::open(dir.path()).unwrap();library.connect().unwrap().execute("INSERT INTO sources VALUES('s','Synthetic','/synthetic')",[]).unwrap();let old=load(&library).unwrap();remove_local_source(&library,"s").unwrap();assert!(library.sources().unwrap().is_empty());assert!(save(&library,old.revision,old).is_err());let db=library.connect().unwrap();db.execute("INSERT INTO sources VALUES('x','Synthetic','/synthetic')",[]).unwrap();db.execute_batch("CREATE TRIGGER fail_catalog BEFORE UPDATE ON video_catalog BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();assert!(remove_local_source(&library,"x").is_err());assert_eq!(library.sources().unwrap().len(),1);}}
