//! Durable local rename/move boundary. Reconciliation never repeats a filesystem move.
//! A completed database update remains pending until the UI persists file preferences.
use crate::{catalog::Catalog,file_manager as files,local_identity,settings::AppError,storage::Library};
#[cfg(test)]
use crate::catalog;
use rusqlite::{params,OptionalExtension};
use serde::{Deserialize,Serialize};
use std::{fs,path::Path};
fn error(message:&str)->AppError{AppError::new("LOCAL_JOURNAL",message,false)}
fn db_error(_:rusqlite::Error)->AppError{error("无法读写本地文件操作日志")}
#[derive(Clone,Serialize,Deserialize,Debug)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Entry{pub id:String,pub source_id:String,pub root:String,pub from:String,pub to:String,pub directory:bool,pub fingerprint:String,pub files:Vec<String>,pub applied:bool}
fn connect(library:&Library)->Result<rusqlite::Connection,AppError>{let db=library.connect()?;db.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS local_file_journal(id TEXT PRIMARY KEY,source_id TEXT NOT NULL UNIQUE,body TEXT NOT NULL);").map_err(db_error)?;Ok(db)}
fn fingerprint(path:&Path)->Result<String,AppError>{
 let meta=fs::symlink_metadata(path).map_err(AppError::io)?;if meta.file_type().is_symlink(){return Err(error("文件操作日志不跟随符号链接"))}
 #[cfg(unix)]{use std::os::unix::fs::MetadataExt;Ok(format!("{}:{}:{}",meta.dev(),meta.ino(),meta.is_dir()))}
 #[cfg(not(unix))]{let _=meta;Err(error("此平台本地文件身份恢复尚未实现"))}
}
#[cfg(test)]
fn snapshot(root:&Path,path:&Path,output:&mut Vec<String>)->Result<(),AppError>{
 let mut pending=vec![path.to_path_buf()];let mut directories=0;
 while let Some(path)=pending.pop(){
  if output.len()>=100000{return Err(error("文件操作超过快照上限"))}
  let meta=fs::symlink_metadata(&path).map_err(AppError::io)?;
  if meta.file_type().is_symlink(){return Err(error("本地移动目录包含符号链接"))}
  if meta.is_file(){output.push(files::as_relative(root,&path)?)}else if meta.is_dir(){directories+=1;if directories>10000{return Err(error("文件操作超过目录快照上限"))}for child in fs::read_dir(&path).map_err(AppError::io)?{pending.push(child.map_err(AppError::io)?.path())}}else{return Err(error("不支持移动此文件类型"))}
 }Ok(())
}

fn write(db:&rusqlite::Connection,entry:&Entry)->Result<(),AppError>{db.execute("INSERT INTO local_file_journal(id,source_id,body) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET body=excluded.body",params![entry.id,entry.source_id,serde_json::to_string(entry).map_err(|_|error("文件日志格式无效"))?]).map_err(db_error)?;Ok(())}
pub fn pending(library:&Library)->Result<Vec<Entry>,AppError>{
 let db=connect(library)?;let mut stmt=db.prepare("SELECT id,source_id,body FROM local_file_journal ORDER BY rowid").map_err(db_error)?;
 let rows=stmt.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?))).map_err(db_error)?;
 rows.map(|row|{let(id,source,body)=row.map_err(db_error)?;let entry:Entry=serde_json::from_str(&body).map_err(|_|error("本地文件操作日志损坏，未执行恢复"))?;if entry.id!=id||entry.source_id!=source||uuid::Uuid::parse_str(&entry.id).is_err(){return Err(error("本地操作日志标识不匹配，未执行恢复"))}Ok(entry)}).collect()
}

/// Called inside the catalog writer's SQLite transaction to prevent a scan or
/// source removal from overwriting path identities before preference recovery ack.
pub fn ensure_catalog_writable(db:&rusqlite::Connection)->Result<(),AppError>{
 crate::remote_identity::ensure_catalog_writable(db)?;
 let exists:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='local_file_journal')",[],|row|row.get(0)).map_err(db_error)?;
 if exists{let pending:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM local_file_journal)",[],|row|row.get(0)).map_err(db_error)?;if pending{return Err(error("有待确认的本地文件操作，请先完成恢复"))}}
 Ok(())
}
fn complete(library:&Library,entry:&mut Entry)->Result<(),AppError>{
 if entry.applied{return Ok(())}
 let root=library.resolve(&entry.source_id,"")?;if root.to_string_lossy()!=entry.root{return Err(error("本地来源根路径已改变，未恢复操作"))}
 let target=files::scoped(&root,&entry.to,false)?;if fingerprint(&target)?!=entry.fingerprint||!fs::symlink_metadata(root.join(&entry.from)).is_err_and(|err|err.kind()==std::io::ErrorKind::NotFound){return Err(error("本地操作身份不明确，未覆盖或重放"))}
 let mut db=connect(library)?;let tx=db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(db_error)?;
 let body:Option<String>=tx.query_row("SELECT body FROM video_catalog WHERE id=1",[],|row|row.get(0)).optional().map_err(db_error)?;
 let mut catalog:Catalog=match body{Some(body)=>serde_json::from_str(&body).map_err(|_|error("本地媒体库损坏，未恢复操作"))?,None=>Catalog::default()};
 local_identity::relocate(&mut catalog,&entry.source_id,&root,&entry.from,&entry.to,entry.directory)?;
 for path in &entry.files{
  let suffix=path.strip_prefix(&entry.from).ok_or_else(||error("文件快照路径超出操作范围"))?;
  if !suffix.is_empty()&&(!entry.directory||!suffix.starts_with('/')){return Err(error("文件快照路径超出操作范围"))}
  let destination=format!("{}{suffix}",entry.to);let (old,new)=local_identity::position_keys(&entry.source_id,&root,path,&destination)?;
  let position:Option<(f64,f64)>=tx.query_row("SELECT position,duration FROM positions WHERE key=?1",[&old],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(db_error)?;
  if let Some((position,duration))=position{let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM positions WHERE key=?1)",[&new],|row|row.get(0)).map_err(db_error)?;if exists{return Err(error("目标已有播放进度，未覆盖"))}tx.execute("INSERT INTO positions(key,position,duration) VALUES(?1,?2,?3)",params![new,position,duration]).map_err(db_error)?;tx.execute("DELETE FROM positions WHERE key=?1",[old]).map_err(db_error)?;}
 }
 catalog.revision=catalog.revision.checked_add(1).ok_or_else(||error("媒体库版本溢出"))?;let body=serde_json::to_string(&catalog).map_err(|_|error("媒体库格式无效"))?;
 tx.execute("INSERT INTO video_catalog(id,revision,body) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body",params![catalog.revision,body]).map_err(db_error)?;
 let mut applied=entry.clone();applied.applied=true;write(&tx,&applied)?;tx.commit().map_err(db_error)?;*entry=applied;Ok(())
}
/// Called only after persisted preferences acknowledge this exact applied transition.
pub fn acknowledge(library:&Library,id:&str,source:&str)->Result<(),AppError>{let db=connect(library)?;let entry=pending(library)?.into_iter().find(|row|row.id==id&&row.source_id==source).ok_or_else(||error("操作日志来源不匹配"))?;if !entry.applied{return Err(error("操作尚未同步媒体库"))}db.execute("DELETE FROM local_file_journal WHERE id=?1 AND source_id=?2",params![id,source]).map_err(db_error)?;Ok(())}
/// Recovery either cancels an unstarted intent or completes metadata for a proven
/// moved inode. Ambiguous states remain pending; it never moves/deletes user files.
pub fn recover(library:&Library)->Result<Vec<Entry>,AppError>{
 let _lock=files::MUTATION.lock().map_err(|_|error("文件操作忙"))?;
 for mut entry in pending(library)?{if entry.applied{continue}let root=library.resolve(&entry.source_id,"")?;if root.to_string_lossy()!=entry.root{return Err(error("操作日志来源根路径不匹配"))}
  let from=files::scoped(&root,&entry.from,false);let to=files::scoped(&root,&entry.to,false);
  if from.as_ref().is_ok_and(|path|fingerprint(path).ok().as_deref()==Some(&entry.fingerprint))&&fs::symlink_metadata(root.join(&entry.to)).is_err_and(|err|err.kind()==std::io::ErrorKind::NotFound){connect(library)?.execute("DELETE FROM local_file_journal WHERE id=?1",[entry.id]).map_err(db_error)?;continue}
  if to.is_err(){return Err(error("文件操作恢复缺少可核验目标"))}complete(library,&mut entry)?;
 }pending(library)
}
#[cfg(test)]
pub fn relocate(library:&Library,source:&str,from:&str,to:&str)->Result<Entry,AppError>{relocate_checkpoint(library,source,from,to,|_|{})}
#[cfg(test)]
fn relocate_checkpoint(library:&Library,source:&str,from:&str,to:&str,mut checkpoint:impl FnMut(&str))->Result<Entry,AppError>{
 let _lock=files::MUTATION.lock().map_err(|_|error("文件操作忙"))?;
 if pending(library)?.iter().any(|entry|entry.source_id==source){return Err(error("此来源有待恢复或待确认操作"))}
 let root=library.resolve(source,"")?;let original=files::scoped(&root,from,false)?;files::protect_registered_sources(library,&original)?;
 let target_path=Path::new(to);let parent=target_path.parent().ok_or_else(||error("目标路径无效"))?;let parent=files::scoped(&root,&parent.to_string_lossy(),true)?;
 let name=target_path.file_name().ok_or_else(||error("目标名称无效"))?;let target=parent.join(name);
 if target.starts_with(&original)||fs::symlink_metadata(&target).is_ok(){return Err(error("目标存在或位于来源内部"))}
 let mut catalog=catalog::load(library)?;let directory=original.is_dir();local_identity::relocate(&mut catalog,source,&root,from,to,directory)?;
 let mut captured=vec![];snapshot(&root,&original,&mut captured)?;
 // Reject already-known progress collisions before changing the filesystem.
 let db=library.connect()?;
 for path in &captured{let suffix=path.strip_prefix(from).ok_or_else(||error("快照范围无效"))?;let target=format!("{to}{suffix}");let(old,new)=local_identity::position_keys(source,&root,path,&target)?;let collision:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM positions WHERE key=?1) AND EXISTS(SELECT 1 FROM positions WHERE key=?2)",params![old,new],|row|row.get(0)).map_err(db_error)?;if collision{return Err(error("目标已有播放进度，未移动文件"))}}
 let mut entry=Entry{id:uuid::Uuid::new_v4().to_string(),source_id:source.into(),root:root.to_string_lossy().into(),from:from.into(),to:to.into(),directory,fingerprint:fingerprint(&original)?,files:captured,applied:false};
 write(&connect(library)?,&entry)?;checkpoint("prepared");
 if let Err(cause)=files::rename_no_replace(&original,&target){return Err(AppError::io(cause))}
 // Directory metadata durability is part of the intent's crash boundary.
 fs::File::open(original.parent().unwrap()).and_then(|file|file.sync_all()).map_err(AppError::io)?;
 fs::File::open(&parent).and_then(|file|file.sync_all()).map_err(AppError::io)?;
 checkpoint("renamed");complete(library,&mut entry)?;checkpoint("applied");Ok(entry)
}
#[cfg(test)]
mod tests{
 use super::*;use crate::storage::Position;use serde_json::json;
 fn setup()->(tempfile::TempDir,Library,String,std::path::PathBuf){let d=tempfile::tempdir().unwrap();let root=d.path().join("source");fs::create_dir(&root).unwrap();let root=root.canonicalize().unwrap();let library=Library::open(&d.path().join("data")).unwrap();let source=library.add_source(&root).unwrap().id;catalog::load(&library).unwrap();(d,library,source,root)}
 fn intent(_library:&Library,source:&str,root:&Path)->Entry{let mut files=vec![];snapshot(root,&root.join("old"),&mut files).unwrap();Entry{id:uuid::Uuid::new_v4().to_string(),source_id:source.into(),root:root.to_string_lossy().into(),from:"old".into(),to:"new".into(),directory:true,fingerprint:fingerprint(&root.join("old")).unwrap(),files,applied:false}}
 #[test]fn move_updates_catalog_and_even_unscanned_progress_then_waits_for_preference_ack(){
  let (_d,l,s,root)=setup();fs::create_dir(root.join("old")).unwrap();fs::write(root.join("old/a.mkv"),b"movie").unwrap();fs::write(root.join("old/unscanned.mkv"),b"movie").unwrap();let mut c=Catalog::default();c.items=vec![json!({"id":"media","sourceId":s,"local":true,"fileId":"old/a.mkv","fileName":"a.mkv","name":"Custom","metadataSource":"manual","type":"movie","progress":25})];c.playlists=json!({"Watch":["media"]});catalog::save(&l,0,c).unwrap();
  let (old,new)=local_identity::position_keys(&s,&root,"old/unscanned.mkv","new/unscanned.mkv").unwrap();l.save_position(&Position{key:old.clone(),position:25.0,duration:100.0}).unwrap();
  let receipt=relocate(&l,&s,"old","new").unwrap();assert!(receipt.applied);assert!(!root.join("old").exists());assert!(root.join("new/a.mkv").exists());assert!(l.position(&old).unwrap().is_none());assert_eq!(l.position(&new).unwrap().unwrap().position,25.0);let c=catalog::load(&l).unwrap();assert_eq!(c.revision,2);assert_eq!(c.items[0]["fileId"],"new/a.mkv");assert_eq!(c.items[0]["name"],"Custom");assert_eq!(c.playlists["Watch"][0],c.items[0]["id"]);
  assert!(relocate(&l,&s,"new","again").is_err());assert_eq!(recover(&l).unwrap().len(),1);assert_eq!(catalog::load(&l).unwrap().revision,2);assert!(acknowledge(&l,&receipt.id,"wrong").is_err());acknowledge(&l,&receipt.id,&s).unwrap();assert!(pending(&l).unwrap().is_empty());
 }
 #[test]fn restart_cancels_an_intent_that_never_moved_without_replaying_it(){let (_d,l,s,root)=setup();fs::create_dir(root.join("old")).unwrap();let entry=intent(&l,&s,&root);write(&connect(&l).unwrap(),&entry).unwrap();assert!(acknowledge(&l,&entry.id,&s).is_err());let reopened=Library{path:l.path.clone()};assert!(recover(&reopened).unwrap().is_empty());assert!(root.join("old").exists());assert!(!root.join("new").exists());}
 #[test]fn restart_finishes_a_proven_move_once_and_keeps_the_applied_receipt(){let (_d,l,s,root)=setup();fs::create_dir(root.join("old")).unwrap();fs::write(root.join("old/a.mkv"),b"movie").unwrap();let entry=intent(&l,&s,&root);write(&connect(&l).unwrap(),&entry).unwrap();files::rename_no_replace(&root.join("old"),&root.join("new")).unwrap();let reopened=Library{path:l.path.clone()};let result=recover(&reopened).unwrap();assert!(result[0].applied);assert_eq!(catalog::load(&l).unwrap().revision,1);recover(&reopened).unwrap();assert_eq!(catalog::load(&l).unwrap().revision,1);assert!(root.join("new/a.mkv").exists());}
 #[test]fn ambiguous_paths_do_not_delete_or_overwrite_anything(){let (_d,l,s,root)=setup();fs::create_dir(root.join("old")).unwrap();let entry=intent(&l,&s,&root);write(&connect(&l).unwrap(),&entry).unwrap();fs::create_dir(root.join("new")).unwrap();assert!(recover(&l).is_err());assert!(root.join("old").exists());assert!(root.join("new").exists());assert!(!pending(&l).unwrap()[0].applied);assert_eq!(catalog::load(&l).unwrap().revision,0);}
 #[test]fn a_different_target_inode_is_never_treated_as_the_completed_move(){let (_d,l,s,root)=setup();fs::create_dir(root.join("old")).unwrap();let entry=intent(&l,&s,&root);write(&connect(&l).unwrap(),&entry).unwrap();fs::rename(root.join("old"),root.join("unrelated")).unwrap();fs::create_dir(root.join("new")).unwrap();assert!(recover(&l).is_err());assert!(root.join("unrelated").exists());assert!(root.join("new").exists());assert_eq!(catalog::load(&l).unwrap().revision,0);}
 #[test]fn metadata_conflict_rolls_back_all_progress_updates_and_preserves_recovery_intent(){let (_d,l,s,root)=setup();fs::create_dir(root.join("old")).unwrap();fs::write(root.join("old/a.mkv"),b"movie").unwrap();let entry=intent(&l,&s,&root);let(old,new)=local_identity::position_keys(&s,&root,"old/a.mkv","new/a.mkv").unwrap();for key in [&old,&new]{l.save_position(&Position{key:key.clone(),position:1.0,duration:2.0}).unwrap()}write(&connect(&l).unwrap(),&entry).unwrap();fs::rename(root.join("old"),root.join("new")).unwrap();assert!(recover(&l).is_err());assert!(l.position(&old).unwrap().is_some());assert!(l.position(&new).unwrap().is_some());assert_eq!(catalog::load(&l).unwrap().revision,0);assert!(!pending(&l).unwrap()[0].applied);}
 #[test]fn known_progress_collision_is_rejected_before_moving_or_journaling(){let (_d,l,s,root)=setup();fs::write(root.join("old.mkv"),b"movie").unwrap();let(old,new)=local_identity::position_keys(&s,&root,"old.mkv","new.mkv").unwrap();for key in [old,new]{l.save_position(&Position{key,position:1.0,duration:2.0}).unwrap()}assert!(relocate(&l,&s,"old.mkv","new.mkv").is_err());assert!(root.join("old.mkv").exists());assert!(!root.join("new.mkv").exists());assert!(pending(&l).unwrap().is_empty());}
 #[test]fn file_rename_preserves_actual_file_and_records_only_its_source(){let (_d,l,s,root)=setup();fs::write(root.join("old.mkv"),b"movie").unwrap();let e=relocate(&l,&s,"old.mkv","new.mkv").unwrap();assert!(!e.directory);assert_eq!(e.files,vec!["old.mkv"]);assert_eq!(fs::read(root.join("new.mkv")).unwrap(),b"movie");assert_eq!(e.source_id,s);assert!(relocate(&l,"other","new.mkv","another.mkv").is_err());}
 #[cfg(unix)]#[test]fn nested_symlinks_and_registered_sources_are_rejected_without_an_intent(){let (_d,l,s,root)=setup();fs::create_dir(root.join("old")).unwrap();std::os::unix::fs::symlink(root.join("outside"),root.join("old/link")).unwrap();assert!(relocate(&l,&s,"old","new").is_err());assert!(pending(&l).unwrap().is_empty());fs::remove_file(root.join("old/link")).unwrap();l.add_source(&root.join("old")).unwrap();assert!(relocate(&l,&s,"old","new").is_err());assert!(root.join("old").exists());assert!(pending(&l).unwrap().is_empty());}

 #[test]fn mismatched_persisted_journal_identity_blocks_recovery_without_touching_files(){let (_d,l,s,root)=setup();fs::create_dir(root.join("old")).unwrap();let mut e=intent(&l,&s,&root);write(&connect(&l).unwrap(),&e).unwrap();e.source_id="other".into();connect(&l).unwrap().execute("UPDATE local_file_journal SET body=?1 WHERE id=?2",params![serde_json::to_string(&e).unwrap(),e.id]).unwrap();assert!(recover(&l).is_err());assert!(root.join("old").exists());assert!(!root.join("new").exists());}

 #[test]fn catalog_writes_and_source_removal_wait_until_the_path_transition_is_acknowledged(){let (_d,l,s,root)=setup();fs::write(root.join("old.mkv"),b"movie").unwrap();let entry=relocate(&l,&s,"old.mkv","new.mkv").unwrap();let c=catalog::load(&l).unwrap();assert!(catalog::save(&l,c.revision,c.clone()).is_err());assert!(catalog::remove_local_source(&l,&s).is_err());assert_eq!(l.sources().unwrap().len(),1);assert_eq!(catalog::load(&l).unwrap().revision,c.revision);acknowledge(&l,&entry.id,&s).unwrap();assert!(catalog::save(&l,c.revision,c).is_ok());}

 // This worker runs only when explicitly selected by the parent test. The normal
 // test suite invocation has no environment fixture and performs no work here.
 #[cfg(unix)]#[test]fn process_fault_worker(){
  let Ok(base)=std::env::var("BOXPLAYER_JOURNAL_TEST_DIRECTORY")else{return};let base=std::path::PathBuf::from(base);
  assert_eq!(fs::read_to_string(base.join("fault-test.marker")).unwrap(),"BoxPlayer temporary journal fixture");
  let stage=std::env::var("BOXPLAYER_JOURNAL_TEST_STAGE").unwrap();let library=Library::open(&base.join("data")).unwrap();let source=library.sources().unwrap()[0].id.clone();
  let result=relocate_checkpoint(&library,&source,"old","new",|current|if current==stage{unsafe{assert_eq!(libc::kill(libc::getpid(),libc::SIGKILL),0);loop{libc::pause();}}});
  panic!("fault checkpoint was not reached: {:?}",result);
 }
 #[cfg(unix)]#[test]fn killed_process_recovers_prepared_renamed_and_committed_checkpoints_exactly_once(){
  use std::os::unix::process::ExitStatusExt;
  for stage in ["prepared","renamed","applied"]{
   let (d,l,s,root)=setup();fs::write(d.path().join("fault-test.marker"),"BoxPlayer temporary journal fixture").unwrap();fs::create_dir(root.join("old")).unwrap();fs::write(root.join("old/a.mkv"),b"original movie bytes").unwrap();
   let mut catalog=Catalog::default();catalog.items=vec![json!({"id":"media","sourceId":s,"local":true,"fileId":"old/a.mkv","fileName":"a.mkv","name":"Custom title","metadataSource":"manual","type":"movie","favorite":true,"progress":25})];catalog.playlists=json!({"Watch":["media"]});catalog::save(&l,0,catalog).unwrap();
   let(old,new)=local_identity::position_keys(&s,&root,"old/a.mkv","new/a.mkv").unwrap();l.save_position(&Position{key:old.clone(),position:25.0,duration:100.0}).unwrap();
   let output=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","local_journal::tests::process_fault_worker","--nocapture"]).env("BOXPLAYER_JOURNAL_TEST_DIRECTORY",d.path()).env("BOXPLAYER_JOURNAL_TEST_STAGE",stage).output().unwrap();
   assert_eq!(output.status.signal(),Some(libc::SIGKILL),"worker did not reach {stage}: {}",String::from_utf8_lossy(&output.stderr));
   if stage=="prepared"{assert!(root.join("old/a.mkv").exists(),"prepared worker advanced beyond checkpoint");assert!(!root.join("new").exists(),"prepared worker moved files after kill request")}
   let reopened=Library::open(&d.path().join("data")).unwrap();let entries=recover(&reopened).unwrap();
   if stage=="prepared"{assert!(entries.is_empty());assert_eq!(fs::read(root.join("old/a.mkv")).unwrap(),b"original movie bytes");assert!(!root.join("new").exists());assert_eq!(catalog::load(&reopened).unwrap().revision,1);assert!(reopened.position(&old).unwrap().is_some());assert!(reopened.position(&new).unwrap().is_none());}
   else{assert_eq!(entries.len(),1);assert!(entries[0].applied);assert_eq!(fs::read(root.join("new/a.mkv")).unwrap(),b"original movie bytes");assert!(!root.join("old").exists());let catalog=catalog::load(&reopened).unwrap();assert_eq!(catalog.revision,2);assert_eq!(catalog.items[0]["fileId"],"new/a.mkv");assert_eq!(catalog.items[0]["name"],"Custom title");assert_eq!(catalog.items[0]["favorite"],true);assert_eq!(catalog.playlists["Watch"][0],catalog.items[0]["id"]);assert!(reopened.position(&old).unwrap().is_none());assert_eq!(reopened.position(&new).unwrap().unwrap().position,25.0);recover(&reopened).unwrap();assert_eq!(catalog::load(&reopened).unwrap().revision,2);acknowledge(&reopened,&entries[0].id,&s).unwrap();assert!(pending(&reopened).unwrap().is_empty());}
  }
 }

 #[test]fn moving_a_folder_under_another_parent_preserves_scan_roots_and_real_files(){let(_d,l,s,root)=setup();fs::create_dir(root.join("old")).unwrap();fs::create_dir(root.join("destination")).unwrap();fs::write(root.join("old/a.mkv"),b"movie").unwrap();let mut c=Catalog::default();c.items=vec![json!({"id":"media","sourceId":s,"local":true,"fileId":"old/a.mkv","fileName":"a.mkv","name":"a.mkv","type":"unmatched","catalogRoots":["old",""]})];catalog::save(&l,0,c).unwrap();let entry=relocate(&l,&s,"old","destination/old").unwrap();assert!(entry.applied);assert_eq!(fs::read(root.join("destination/old/a.mkv")).unwrap(),b"movie");let c=catalog::load(&l).unwrap();assert_eq!(c.items[0]["folderPath"],"destination/old");assert_eq!(c.items[0]["folderAncestors"],json!(["","destination","destination/old"]));assert_eq!(c.items[0]["catalogRoots"],json!(["destination/old",""]));}
 #[test]fn move_rejects_existing_destinations_and_descendant_targets_before_an_intent(){let(_d,l,s,root)=setup();fs::create_dir_all(root.join("old/child")).unwrap();fs::create_dir(root.join("destination")).unwrap();fs::create_dir(root.join("destination/old")).unwrap();assert!(relocate(&l,&s,"old","destination/old").is_err());assert!(relocate(&l,&s,"old","old/child/new").is_err());assert!(pending(&l).unwrap().is_empty());assert!(root.join("old/child").is_dir());assert!(root.join("destination/old").is_dir());}

}
