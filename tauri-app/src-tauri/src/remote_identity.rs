//! Native reference transaction only. No provider writes and no IPC registration.
//! WebView preferences require an explicit persistence acknowledgement.
use crate::{
    catalog::{self, Catalog},
    settings::AppError,
    storage::{identity, Library},
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

fn error(message: &str) -> AppError {
    AppError::new("REMOTE_IDENTITY", message, false)
}
fn db_error(_: rusqlite::Error) -> AppError {
    error("无法保存远端身份同步记录")
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Move {
    pub from: String,
    pub to: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Commit {
    pub id: String,
    pub source_id: String,
    pub expected_revision: u64,
    pub catalog: Catalog,
    pub before_preferences: Value,
    pub after_preferences: Value,
    pub moves: Vec<Move>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Receipt {
    pub id: String,
    pub source_id: String,
    pub revision: u64,
    pub acknowledged: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pending {
    pub receipt: Receipt,
    pub before_preferences: Value,
    pub after_preferences: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Location {
    drive_id: String,
    file_id: String,
}
fn location(value: &str) -> Result<Location, AppError> {
    let parsed: Location = serde_json::from_str(value).map_err(|_| error("跨盘位置无效"))?;
    if parsed.drive_id.is_empty()
        || parsed.file_id.is_empty()
        || parsed.file_id == "root"
        || value.len() > 16384
        || serde_json::to_string(&parsed).ok().as_deref() != Some(value)
    {
        return Err(error("跨盘位置无效"));
    }
    Ok(parsed)
}
fn position_key(source: &str, file: &str) -> Result<String, AppError> {
    Ok(identity(
        &serde_json::to_string(&(source, source, file)).map_err(|_| error("续播位置无效"))?,
    ))
}
fn connect(library: &Library) -> Result<Connection, AppError> {
    let db = library.connect()?;
    db.execute_batch("PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS video_catalog(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_identity_receipts(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,fingerprint TEXT NOT NULL,body TEXT,revision INTEGER NOT NULL,acked INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS remote_position_aliases(old_key TEXT PRIMARY KEY,new_key TEXT NOT NULL,source_id TEXT NOT NULL);").map_err(db_error)?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS remote_file_aliases(source_id TEXT NOT NULL,old_file TEXT NOT NULL,new_file TEXT NOT NULL,PRIMARY KEY(source_id,old_file));").map_err(db_error)?;
    Ok(db)
}
pub fn ensure_catalog_writable(db: &Connection) -> Result<(), AppError> {
    let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='remote_identity_receipts')", [], |r| r.get(0)).map_err(db_error)?;
    if exists {
        let pending: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM remote_identity_receipts WHERE acked=0)",
                [],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if pending {
            return Err(error("远端移动收藏尚待持久保存，请先完成恢复"));
        }
    }
    Ok(())
}
/// Use inside the same transaction as a progress read/write to avoid a remap race.
pub fn resolve_position_key(db: &Connection, key: &str) -> Result<String, AppError> {
    let exists: bool = db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='remote_position_aliases')", [], |r| r.get(0)).map_err(db_error)?;
    if !exists {
        return Ok(key.to_owned());
    }
    let mut current = key.to_owned();
    let mut seen = HashSet::new();
    loop {
        if !seen.insert(current.clone()) || seen.len() > 128 {
            return Err(error("续播身份映射成环或过深"));
        }
        let next: Option<String> = db
            .query_row(
                "SELECT new_key FROM remote_position_aliases WHERE old_key=?1",
                [&current],
                |r| r.get(0),
            )
            .optional()
            .map_err(db_error)?;
        match next {
            None => return Ok(current),
            Some(next) => {
                if next.len() != 64
                    || !next
                        .bytes()
                        .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                {
                    return Err(error("续播身份映射损坏"));
                }
                current = next;
            }
        }
    }
}
/// Resolve only identities recorded in the same transaction as catalog/progress.
/// A stale URL must never be reused for a newly mapped file.
pub fn resolve_media(library: &Library, media: &crate::gateway::ResolvedMedia) -> Result<crate::gateway::ResolvedMedia, AppError> {
    if media.source_id != media.account_id { return Ok(media.clone()); }
    let db=library.connect()?;
    let exists:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='remote_file_aliases')",[],|r|r.get(0)).map_err(db_error)?;
    if !exists { return Ok(media.clone()); }
    let tx=db.unchecked_transaction().map_err(db_error)?;
    let mut current=media.file_id.clone();let mut seen=HashSet::new();
    loop {
        if !seen.insert(current.clone()) || seen.len()>128 { return Err(error("播放文件身份映射成环或过深")); }
        let next:Option<String>=tx.query_row("SELECT new_file FROM remote_file_aliases WHERE source_id=?1 AND old_file=?2",params![media.source_id,current],|r|r.get(0)).optional().map_err(db_error)?;
        match next { None=>break,Some(next)=>{location(&current)?;location(&next)?;current=next;} }
    }
    tx.commit().map_err(db_error)?;
    let mut result=media.clone();
    if current!=media.file_id {result.file_id=current;result.url="boxplayer-queue:".into();result.headers.clear();result.expires_at=None;}
    Ok(result)
}
pub fn commit(library: &Library, input: &Commit) -> Result<Receipt, AppError> {
    if uuid::Uuid::parse_str(&input.id).is_err()
        || input.source_id.is_empty()
        || input.source_id.len() > 4096
        || input.moves.is_empty()
        || input.moves.len() > 100000
        || !input.before_preferences.is_object()
        || !input.after_preferences.is_object()
        || input.before_preferences.to_string().len() > 1024 * 1024
        || input.after_preferences.to_string().len() > 1024 * 1024
    {
        return Err(error("远端身份提交格式无效"));
    }
    catalog::validate(&input.catalog)?;
    let body = serde_json::to_string(input).map_err(|_| error("远端身份提交格式无效"))?;
    if body.len() > 66 * 1024 * 1024 {
        return Err(error("远端身份提交数据过大"));
    }
    let fingerprint = identity(&body);
    let mut from = HashSet::new();
    let mut to = HashSet::new();
    let mut keys = Vec::new();
    for pair in &input.moves {
        if location(&pair.from)?.drive_id == location(&pair.to)?.drive_id
            || !from.insert(pair.from.clone())
            || !to.insert(pair.to.clone())
        {
            return Err(error("跨盘身份映射重复或不是跨盘操作"));
        }
        keys.push((
            position_key(&input.source_id, &pair.from)?,
            position_key(&input.source_id, &pair.to)?,
        ));
    }
    if from.iter().any(|key| to.contains(key)) {
        return Err(error("跨盘身份映射源目标重叠"));
    }
    let mut db = connect(library)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let existing: Option<(String, String, u64, bool)> = tx
        .query_row(
            "SELECT source_id,fingerprint,revision,acked FROM remote_identity_receipts WHERE id=?1",
            [&input.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .map_err(db_error)?;
    if let Some((source, digest, revision, acknowledged)) = existing {
        if source != input.source_id || digest != fingerprint {
            return Err(error("重试身份提交与已保存回执不匹配"));
        }
        return Ok(Receipt {
            id: input.id.clone(),
            source_id: source,
            revision,
            acknowledged,
        });
    }
    crate::local_journal::ensure_catalog_writable(&tx)?;
    let previous: Option<(u64, String)> = tx
        .query_row(
            "SELECT revision,body FROM video_catalog WHERE id=1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(db_error)?;
    let previous = match previous {
        Some((revision, body)) => {
            let value: Catalog =
                serde_json::from_str(&body).map_err(|_| error("原媒体库损坏，未覆盖"))?;
            catalog::validate(&value)?;
            if value.revision != revision {
                return Err(error("原媒体库版本损坏"));
            }
            value
        }
        None => Catalog::default(),
    };
    if previous.revision != input.expected_revision
        || input.catalog.revision != input.expected_revision
    {
        return Err(AppError::new("REMOTE_IDENTITY_REVISION","媒体库已更新，未提交身份同步",true));
    }
    let unaffected = |catalog: &Catalog| {
        catalog
            .items
            .iter()
            .filter(|row| row["sourceId"].as_str() != Some(input.source_id.as_str()))
            .cloned()
            .collect::<Vec<_>>()
    };
    if unaffected(&previous) != unaffected(&input.catalog) {
        return Err(error("身份同步不得覆盖其他来源媒体"));
    }
    for (old, new) in &keys {
        if resolve_position_key(&tx, old)? != *old || resolve_position_key(&tx, new)? != *new {
            return Err(error("源或目标续播身份已改变"));
        }
        let collision: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM positions WHERE key=?1)",
                [new],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if collision {
            return Err(error("目标已有播放进度，未合并覆盖"));
        }
        let position: Option<(f64, f64)> = tx
            .query_row(
                "SELECT position,duration FROM positions WHERE key=?1",
                [old],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(db_error)?;
        if let Some((position, duration)) = position {
            if !position.is_finite()
                || !duration.is_finite()
                || position < 0.0
                || duration < 0.0
                || position > duration + 1.0
            {
                return Err(error("原续播记录损坏"));
            }
            tx.execute(
                "INSERT INTO positions(key,position,duration) VALUES(?1,?2,?3)",
                params![new, position, duration],
            )
            .map_err(db_error)?;
            tx.execute("DELETE FROM positions WHERE key=?1", [old])
                .map_err(db_error)?;
        }
        tx.execute(
            "INSERT INTO remote_position_aliases(old_key,new_key,source_id) VALUES(?1,?2,?3)",
            params![old, new, input.source_id],
        )
        .map_err(db_error)?;
    }
    for pair in &input.moves {
        tx.execute("INSERT INTO remote_file_aliases(source_id,old_file,new_file) VALUES(?1,?2,?3)",params![input.source_id,pair.from,pair.to]).map_err(db_error)?;
    }
    let revision = input
        .expected_revision
        .checked_add(1)
        .ok_or_else(|| error("媒体库版本溢出"))?;
    let mut next = input.catalog.clone();
    next.revision = revision;
    tx.execute("INSERT INTO video_catalog(id,revision,body) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body",params![revision,serde_json::to_string(&next).map_err(|_|error("媒体库格式无效"))?]).map_err(db_error)?;
    tx.execute("INSERT INTO remote_identity_receipts(id,source_id,fingerprint,body,revision,acked) VALUES(?1,?2,?3,?4,?5,0)",params![input.id,input.source_id,fingerprint,body,revision]).map_err(db_error)?;
    tx.commit().map_err(db_error)?;
    Ok(Receipt {
        id: input.id.clone(),
        source_id: input.source_id.clone(),
        revision,
        acknowledged: false,
    })
}
pub fn pending(library: &Library) -> Result<Vec<Pending>, AppError> {
    let db = connect(library)?;
    let mut stmt=db.prepare("SELECT id,source_id,fingerprint,body,revision FROM remote_identity_receipts WHERE acked=0 ORDER BY id").map_err(db_error)?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, u64>(4)?,
            ))
        })
        .map_err(db_error)?;
    rows.map(|row| {
        let (id, source, digest, body, revision) = row.map_err(db_error)?;
        let value: Commit = serde_json::from_str(&body).map_err(|_| error("身份恢复记录损坏"))?;
        if value.id != id || value.source_id != source || identity(&body) != digest {
            return Err(error("身份恢复记录不匹配"));
        }
        Ok(Pending {
            receipt: Receipt {
                id,
                source_id: source,
                revision,
                acknowledged: false,
            },
            before_preferences: value.before_preferences,
            after_preferences: value.after_preferences,
        })
    })
    .collect()
}
pub fn acknowledge(
    library: &Library,
    id: &str,
    source: &str,
    persisted_preferences: &Value,
) -> Result<(), AppError> {
    let mut db = connect(library)?;
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let row:Option<(String,String,String,bool)>=tx.query_row("SELECT source_id,fingerprint,COALESCE(body,''),acked FROM remote_identity_receipts WHERE id=?1",[id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(db_error)?;
    let Some((owner, digest, body, acked)) = row else {
        return Err(error("身份确认记录不存在"));
    };
    if owner != source {
        return Err(error("身份确认来源不匹配"));
    }
    if acked {
        return Ok(());
    }
    let value: Commit = serde_json::from_str(&body).map_err(|_| error("身份恢复记录损坏"))?;
    if identity(&body) != digest
        || value.id != id
        || value.source_id != source
        || value.after_preferences != *persisted_preferences
    {
        return Err(error("收藏设置尚未匹配持久保存结果"));
    }
    tx.execute(
        "UPDATE remote_identity_receipts SET acked=1,body=NULL WHERE id=?1",
        [id],
    )
    .map_err(db_error)?;
    tx.commit().map_err(db_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Position;
    use serde_json::json;
    fn file(drive: &str, id: &str) -> String {
        serde_json::to_string(&Location {
            drive_id: drive.into(),
            file_id: id.into(),
        })
        .unwrap()
    }
    fn fixture() -> (tempfile::TempDir, Library, Commit) {
        let dir = tempfile::tempdir().unwrap();
        let library = Library::open(dir.path()).unwrap();
        let from = file("resource", "a");
        let to = file("backup", "b");
        let mut before = Catalog::default();
        before.items = vec![
            json!({"id":"old","sourceId":"account","fileId":from,"progress":42,"name":"Manual"}),
            json!({"id":"foreign","sourceId":"other","fileId":"foreign","name":"Keep"}),
        ];
        before.playlists = json!({"Mix":["old","foreign"]});
        let before = catalog::save(&library, 0, before).unwrap();
        let mut next = before.clone();
        next.items[0]["id"] = json!("new");
        next.items[0]["fileId"] = json!(to);
        next.playlists = json!({"Mix":["new","foreign"]});
        let value = Commit {
            id: uuid::Uuid::new_v4().to_string(),
            source_id: "account".into(),
            expected_revision: before.revision,
            catalog: next,
            before_preferences: json!({"favorites":["old"]}),
            after_preferences: json!({"favorites":["new"]}),
            moves: vec![Move { from, to }],
        };
        (dir, library, value)
    }
    fn save(library: &Library, key: String, position: f64) {
        library
            .save_position(&Position {
                key,
                position,
                duration: 100.,
            })
            .unwrap()
    }
    fn descriptor(file_id:String)->crate::gateway::ResolvedMedia {
        crate::gateway::ResolvedMedia {schema_version:1,source_id:"account".into(),account_id:"account".into(),file_id,url:"https://example.invalid/old".into(),headers:std::collections::BTreeMap::from([("Authorization".into(),"synthetic".into())]),expires_at:Some(1)}
    }
    #[test]
    fn durable_media_aliases_discard_stale_urls_and_are_source_scoped(){
        let (dir,library,value)=fixture();let media=descriptor(value.moves[0].from.clone());
        assert_eq!(resolve_media(&library,&media).unwrap().url,media.url);
        commit(&library,&value).unwrap();let reopened=Library::open(dir.path()).unwrap();
        let resolved=resolve_media(&reopened,&media).unwrap();
        assert_eq!(resolved.file_id,value.moves[0].to);assert_eq!(resolved.url,"boxplayer-queue:");assert!(resolved.headers.is_empty());assert_eq!(resolved.expires_at,None);
        let mut foreign=media.clone();foreign.source_id="other".into();foreign.account_id="other".into();assert_eq!(resolve_media(&reopened,&foreign).unwrap().file_id,media.file_id);
        foreign.source_id="account".into();assert_eq!(resolve_media(&reopened,&foreign).unwrap().file_id,media.file_id);
    }
    #[test]
    fn failed_transaction_does_not_install_playback_aliases(){
        let (_dir,library,value)=fixture();save(&library,position_key("account",&value.moves[0].to).unwrap(),50.);
        assert!(commit(&library,&value).is_err());let media=descriptor(value.moves[0].from.clone());assert_eq!(resolve_media(&library,&media).unwrap().url,media.url);
    }
    #[test]
    fn corrupt_file_aliases_reject_playback_resolution(){
        let (_dir,library,value)=fixture();commit(&library,&value).unwrap();let db=library.connect().unwrap();
        db.execute("INSERT INTO remote_file_aliases(source_id,old_file,new_file) VALUES('account',?1,?2)",params![value.moves[0].to,value.moves[0].from]).unwrap();
        assert!(resolve_media(&library,&descriptor(value.moves[0].from.clone())).is_err());
    }
    #[test]
    fn commits_catalog_positions_and_preference_recovery_record_together() {
        let (_dir, library, value) = fixture();
        let old = position_key("account", &value.moves[0].from).unwrap();
        let new = position_key("account", &value.moves[0].to).unwrap();
        save(&library, old.clone(), 42.);
        let receipt = commit(&library, &value).unwrap();
        assert_eq!(receipt.revision, 2);
        assert!(!receipt.acknowledged);
        assert_eq!(catalog::load(&library).unwrap().items[0]["id"], "new");
        assert_eq!(library.position(&new).unwrap().unwrap().position, 42.);
        let pending = pending(&library).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].after_preferences, value.after_preferences);
        assert_eq!(library.position(&old).unwrap().unwrap().key, new);
    }
    #[test]
    fn blocks_catalog_writers_until_matching_preference_ack_and_retries_idempotently() {
        let (_dir, library, value) = fixture();
        commit(&library, &value).unwrap();
        assert_eq!(commit(&library, &value).unwrap().revision, 2);
        assert!(catalog::save(&library, 2, catalog::load(&library).unwrap()).is_err());
        assert!(acknowledge(&library, &value.id, "wrong", &value.after_preferences).is_err());
        assert!(acknowledge(&library, &value.id, "account", &value.before_preferences).is_err());
        assert_eq!(pending(&library).unwrap().len(), 1);
        acknowledge(&library, &value.id, "account", &value.after_preferences).unwrap();
        assert!(pending(&library).unwrap().is_empty());
        assert!(commit(&library, &value).unwrap().acknowledged);
        assert_eq!(
            catalog::save(&library, 2, catalog::load(&library).unwrap())
                .unwrap()
                .revision,
            3
        );
    }
    #[test]
    fn target_progress_collision_rolls_back_catalog_and_all_previous_pairs() {
        let (_dir, library, mut value) = fixture();
        value.moves.push(Move {
            from: file("resource", "c"),
            to: file("backup", "d"),
        });
        let old = position_key("account", &value.moves[0].from).unwrap();
        let new = position_key("account", &value.moves[0].to).unwrap();
        let conflict = position_key("account", &value.moves[1].to).unwrap();
        save(&library, old.clone(), 42.);
        save(&library, conflict.clone(), 99.);
        assert!(commit(&library, &value).is_err());
        assert_eq!(catalog::load(&library).unwrap().revision, 1);
        assert_eq!(library.position(&old).unwrap().unwrap().position, 42.);
        assert!(library.position(&new).unwrap().is_none());
        assert_eq!(library.position(&conflict).unwrap().unwrap().position, 99.);
        assert!(pending(&library).unwrap().is_empty());
    }
    #[test]
    fn active_old_descriptor_progress_redirects_after_restart_and_multiple_moves() {
        let (dir, library, value) = fixture();
        let old = position_key("account", &value.moves[0].from).unwrap();
        commit(&library, &value).unwrap();
        acknowledge(&library, &value.id, "account", &value.after_preferences).unwrap();
        let reopened = Library::open(dir.path()).unwrap();
        save(&reopened, old.clone(), 55.);
        let middle = position_key("account", &value.moves[0].to).unwrap();
        assert_eq!(reopened.position(&middle).unwrap().unwrap().position, 55.);
        let target = file("third", "c");
        let mut next = value.clone();
        next.id = uuid::Uuid::new_v4().to_string();
        next.expected_revision = 2;
        next.catalog = catalog::load(&reopened).unwrap();
        next.catalog.items[0]["fileId"] = json!(target);
        next.moves = vec![Move {
            from: value.moves[0].to.clone(),
            to: target.clone(),
        }];
        commit(&reopened, &next).unwrap();
        save(&reopened, old, 70.);
        assert_eq!(resolve_media(&reopened,&descriptor(value.moves[0].from.clone())).unwrap().file_id,target);
        assert_eq!(
            reopened
                .position(&position_key("account", &target).unwrap())
                .unwrap()
                .unwrap()
                .position,
            70.
        );
    }
    #[test]
    fn stale_revision_foreign_metadata_and_changed_retry_payload_do_not_overwrite() {
        let (_dir, library, mut value) = fixture();
        value.expected_revision = 0;
        value.catalog.revision = 0;
        assert!(commit(&library, &value).is_err());
        value.expected_revision = 1;
        value.catalog.revision = 1;
        value.catalog.items[1]["name"] = json!("changed");
        assert!(commit(&library, &value).is_err());
        assert_eq!(catalog::load(&library).unwrap().revision, 1);
        value.catalog.items[1]["name"] = json!("Keep");
        commit(&library, &value).unwrap();
        value.after_preferences = json!({"different":true});
        assert!(commit(&library, &value).is_err());
        assert_eq!(
            pending(&library).unwrap()[0].after_preferences,
            json!({"favorites":["new"]})
        );
    }
    #[test]
    fn corrupt_alias_cycle_rejects_progress_without_writing() {
        let (_dir, library, value) = fixture();
        commit(&library, &value).unwrap();
        let old = position_key("account", &value.moves[0].from).unwrap();
        let new = position_key("account", &value.moves[0].to).unwrap();
        let db = library.connect().unwrap();
        db.execute("INSERT INTO remote_position_aliases(old_key,new_key,source_id) VALUES(?1,?2,'account')",params![new,old]).unwrap();
        assert!(library.position(&old).is_err());
        assert!(library
            .save_position(&Position {
                key: old,
                position: 1.,
                duration: 10.
            })
            .is_err());
        assert_eq!(
            db.query_row("SELECT count(*) FROM positions", [], |r| r.get::<_, u64>(0))
                .unwrap(),
            0
        );
    }
}
