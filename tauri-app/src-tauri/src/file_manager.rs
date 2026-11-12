//! Account-independent local file port for the migrated Electron file commands.
//! Every path is relative to a registered source. Trash is reversible and source-scoped.
use crate::settings::AppError;
#[cfg(test)]
use crate::storage::Library;
#[cfg(test)]
use serde::{Deserialize, Serialize};
#[cfg(test)]
use std::io::Write;
use std::{fs, path::{Component, Path, PathBuf}, sync::Mutex};
pub(crate) static MUTATION: Mutex<()> = Mutex::new(());
fn invalid(message: &str) -> AppError { AppError::new("FILE_OPERATION", message, false) }
#[cfg(test)]
fn db_error(_: rusqlite::Error) -> AppError { invalid("Unable to read file operation journal") }
// Local write prototypes are retained but not registered in the M5 application.
// Plan 3.5 limits local sources to browse/preview/library; download belongs to M6.
#[cfg(test)]
#[derive(Deserialize)]
#[serde(tag="kind",rename_all="camelCase",deny_unknown_fields)]
pub enum CreateOperation {
    Folder { parent: String, name: String },
    Text { parent: String, name: String, content: String },
}
#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct CreateReceipt {pub schema_version:u32,pub source_id:String,pub path:String}
#[cfg(test)]
pub fn create(library:&Library,source:&str,operation:CreateOperation)->Result<CreateReceipt,AppError>{
 let receipt=execute(library,source,match operation {
  CreateOperation::Folder{parent,name}=>Operation::CreateFolder{parent,name},
  CreateOperation::Text{parent,name,content}=>Operation::CreateText{parent,name,content},
 })?;
 Ok(CreateReceipt{schema_version:1,source_id:source.into(),path:receipt.path})
}
#[cfg(test)]
#[derive(Deserialize)]
#[serde(tag="kind",rename_all="camelCase",deny_unknown_fields)]
pub enum Operation {
    CreateFolder { parent: String, name: String },
    CreateText { parent: String, name: String, content: String },
    Rename { path: String, name: String },
    Move { path: String, parent: String },
    Trash { path: String },
    Restore { id: String },
}
#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Receipt { pub path: String, pub trash_id: Option<String> }
#[cfg(test)]
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct TrashEntry { pub id: String, pub path: String, pub name: String, pub deleted_at: i64 }
#[cfg(test)]
fn init(library: &Library) -> Result<rusqlite::Connection,AppError> {
 let db=library.connect()?;
 db.execute_batch("CREATE TABLE IF NOT EXISTS file_trash(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,path TEXT NOT NULL,deleted_at INTEGER NOT NULL)").map_err(db_error)?;
 Ok(db)
}
fn relative(value: &str, allow_root: bool) -> Result<&Path,AppError> {
 let path=Path::new(value);
 if (!allow_root && value.is_empty()) || value.contains('\\') || value.contains('\0') || path.components().any(|part| !matches!(part,Component::Normal(_))) {
  return Err(invalid("Select a relative path inside this source"))
 }
 Ok(path)
}
#[cfg(test)]
pub(crate) fn name(value: &str) -> Result<&str,AppError> {
 if value.trim().is_empty() || value=="." || value==".." || value.contains(['/', '\\', '\0']) || value.chars().any(char::is_control) {
  return Err(invalid("Invalid file name"))
 }
 Ok(value)
}
pub(crate) fn scoped(root: &Path, value: &str, allow_root: bool) -> Result<PathBuf,AppError> {
 let relative=relative(value,allow_root)?;
 let mut path=root.to_owned();
 for part in relative.components() {
  path.push(part);
  let metadata=fs::symlink_metadata(&path).map_err(AppError::io)?;
  if metadata.file_type().is_symlink() { return Err(invalid("File mutations do not follow symbolic links")) }
 }
 if !path.canonicalize().map_err(AppError::io)?.starts_with(root) { return Err(invalid("Path is outside this source")) }
 Ok(path)
}
#[cfg(test)]
fn destination(root:&Path,parent:&str,new_name:&str)->Result<PathBuf,AppError>{
 let parent=scoped(root,parent,true)?;
 if !parent.is_dir(){return Err(invalid("Destination is not a directory"))}
 let dest=parent.join(name(new_name)?);
 if fs::symlink_metadata(&dest).is_ok(){return Err(invalid("A file with this name already exists"))}
 Ok(dest)
}
#[cfg(test)]
pub(crate) fn protect_registered_sources(library:&Library,path:&Path)->Result<(),AppError>{
 if library.sources()?.iter().any(|source|Path::new(&source.path).starts_with(path)){
  return Err(invalid("Remove registered sources through source management"))
 }
 Ok(())
}
#[cfg(test)]
pub(crate) fn as_relative(root:&Path,path:&Path)->Result<String,AppError>{
 path.strip_prefix(root).map(|p|p.to_string_lossy().replace('\\',"/")).map_err(|_|invalid("Path is outside this source"))
}
// An existence check alone can race another process creating the target.
#[cfg(test)]
pub(crate) fn rename_no_replace(from:&Path,to:&Path)->std::io::Result<()> {
 #[cfg(any(target_os="macos",target_os="linux"))] {
  use std::{ffi::CString,os::unix::ffi::OsStrExt};
  let from=CString::new(from.as_os_str().as_bytes()).map_err(|_|std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
  let to=CString::new(to.as_os_str().as_bytes()).map_err(|_|std::io::Error::from(std::io::ErrorKind::InvalidInput))?;
  #[cfg(target_os="macos")]
  let result=unsafe{libc::renamex_np(from.as_ptr(),to.as_ptr(),libc::RENAME_EXCL)};
  #[cfg(target_os="linux")]
  let result=unsafe{libc::renameat2(libc::AT_FDCWD,from.as_ptr(),libc::AT_FDCWD,to.as_ptr(),libc::RENAME_NOREPLACE)};
  if result==0{Ok(())}else{Err(std::io::Error::last_os_error())}
 }
 #[cfg(target_os="windows")] {
  use std::os::windows::ffi::OsStrExt;
  #[link(name="kernel32")] extern "system" { fn MoveFileW(existing:*const u16,new:*const u16)->i32; }
  let from:Vec<u16>=from.as_os_str().encode_wide().chain(Some(0)).collect();
  let to:Vec<u16>=to.as_os_str().encode_wide().chain(Some(0)).collect();
  if unsafe{MoveFileW(from.as_ptr(),to.as_ptr())}!=0{Ok(())}else{Err(std::io::Error::last_os_error())}
 }
 #[cfg(not(any(target_os="macos",target_os="linux",target_os="windows")))]
 { let _=(from,to);Err(std::io::Error::from(std::io::ErrorKind::Unsupported)) }
}
#[cfg(test)]
fn trash_directory(library:&Library)->Result<PathBuf,AppError>{
 let path=library.path.parent().ok_or_else(||invalid("Missing application directory"))?.join("file-trash");
 if let Ok(meta)=fs::symlink_metadata(&path){if meta.file_type().is_symlink()||!meta.is_dir(){return Err(invalid("Invalid trash directory"))}}
 fs::create_dir_all(&path).map_err(AppError::io)?;
 #[cfg(unix)] { use std::os::unix::fs::PermissionsExt;fs::set_permissions(&path,fs::Permissions::from_mode(0o700)).map_err(AppError::io)?; }
 Ok(path)
}
#[cfg(test)]
pub fn trash_list(library:&Library,source:&str)->Result<Vec<TrashEntry>,AppError>{
 library.resolve(source,"")?;
 let db=init(library)?;
 let mut statement=db.prepare("SELECT id,path,deleted_at FROM file_trash WHERE source_id=?1 ORDER BY deleted_at DESC,id").map_err(db_error)?;
 let values=statement.query_map([source],|row|{let path:String=row.get(1)?;Ok(TrashEntry{id:row.get(0)?,name:Path::new(&path).file_name().unwrap_or_default().to_string_lossy().into(),path,deleted_at:row.get(2)?})}).map_err(db_error)?;
 values.collect::<Result<Vec<_>,_>>().map_err(db_error)
}
#[cfg(test)]
pub fn execute(library:&Library,source:&str,operation:Operation)->Result<Receipt,AppError>{
 let _lock=MUTATION.lock().map_err(|_|invalid("File manager is busy"))?;
 let root=library.resolve(source,"")?;
 let done=|path:PathBuf,trash_id|Ok(Receipt{path:as_relative(&root,&path)?,trash_id});
 match operation {
  Operation::CreateFolder{parent,name}=>{let target=destination(&root,&parent,&name)?;fs::create_dir(&target).map_err(AppError::io)?;done(target,None)}
  Operation::CreateText{parent,name,content}=>{
   let target=destination(&root,&parent,&name)?;
   let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(AppError::io)?;
   if let Err(error)=file.write_all(content.as_bytes()).and_then(|_|file.sync_all()){let _=fs::remove_file(&target);return Err(AppError::io(error))}
   done(target,None)
  }
  Operation::Rename{path,name}=>{
   let from=scoped(&root,&path,false)?;protect_registered_sources(library,&from)?;let parent=as_relative(&root,from.parent().ok_or_else(||invalid("Source has no parent"))?)?;
   if from.file_name().is_some_and(|value|value==name.as_str()){return done(from,None)}
   let target=destination(&root,&parent,&name)?;rename_no_replace(&from,&target).map_err(AppError::io)?;done(target,None)
  }
  Operation::Move{path,parent}=>{
   let from=scoped(&root,&path,false)?;protect_registered_sources(library,&from)?;let target=destination(&root,&parent,from.file_name().ok_or_else(||invalid("Missing file name"))?.to_str().ok_or_else(||invalid("Invalid file name"))?)?;
   if target.starts_with(&from){return Err(invalid("Cannot move a folder into itself"))}
   rename_no_replace(&from,&target).map_err(AppError::io)?;done(target,None)
  }
  Operation::Trash{path}=>{
   let from=scoped(&root,&path,false)?;
   // A nested registered source is independently owned; never move its root as an item.
   protect_registered_sources(library,&from)?;
   let db=init(library)?;
   let id=uuid::Uuid::new_v4().to_string();let target=trash_directory(library)?.join(&id);
   db.execute("INSERT INTO file_trash(id,source_id,path,deleted_at) VALUES(?1,?2,?3,?4)",rusqlite::params![id,source,path,chrono::Utc::now().timestamp()]).map_err(db_error)?;
   // rename deliberately refuses cross-device trash; never silently falls back to deleting.
   if let Err(error)=rename_no_replace(&from,&target){
    let _=db.execute("DELETE FROM file_trash WHERE id=?1",[&id]);
    return Err(AppError::io(error))
   }
   done(from,Some(id))
  }
  Operation::Restore{id}=>{
   if uuid::Uuid::parse_str(&id).is_err(){return Err(invalid("Invalid trash entry"))}
   let db=init(library)?;
   let path:String=db.query_row("SELECT path FROM file_trash WHERE id=?1 AND source_id=?2",rusqlite::params![id,source],|row|row.get(0)).map_err(db_error)?;
   let old=relative(&path,false)?;let parent=old.parent().unwrap_or(Path::new(""));
   let target=destination(&root,&parent.to_string_lossy(),old.file_name().ok_or_else(||invalid("Missing file name"))?.to_str().ok_or_else(||invalid("Invalid file name"))?)?;
   let stored=trash_directory(library)?.join(&id);
   if fs::symlink_metadata(&stored).map_err(AppError::io)?.file_type().is_symlink(){return Err(invalid("Invalid trash entry"))}
   rename_no_replace(&stored,&target).map_err(AppError::io)?;
   if let Err(error)=db.execute("DELETE FROM file_trash WHERE id=?1 AND source_id=?2",rusqlite::params![id,source]){
    let _=rename_no_replace(&target,&stored);return Err(db_error(error))
   }
   done(target,None)
  }
 }
}

#[cfg(test)]
mod tests {
 use super::*;
 fn setup()->(tempfile::TempDir,Library,String,PathBuf){let dir=tempfile::tempdir().unwrap();let root=dir.path().join("source");fs::create_dir(&root).unwrap();let library=Library::open(&dir.path().join("data")).unwrap();let id=library.add_source(&root).unwrap().id;(dir,library,id,root)}
 #[test] fn public_creation_contract_cannot_request_mutation_or_cross_source_write(){
  let (_dir,library,id,root)=setup();
  assert!(serde_json::from_value::<CreateOperation>(serde_json::json!({"kind":"rename","path":"a","name":"b"})).is_err());
  assert!(serde_json::from_value::<CreateOperation>(serde_json::json!({"kind":"folder","parent":"","name":"a","extra":"ignored"})).is_err());
  let receipt=create(&library,&id,CreateOperation::Folder{parent:"".into(),name:"子目录".into()}).unwrap();
  assert_eq!(receipt.schema_version,1);assert_eq!(receipt.source_id,id);assert_eq!(receipt.path,"子目录");
  let body="内容".repeat(600000);
  create(&library,&id,CreateOperation::Text{parent:"子目录".into(),name:"text.txt".into(),content:body.clone()}).unwrap();
  assert_eq!(fs::read_to_string(root.join("子目录/text.txt")).unwrap(),body);
  assert!(create(&library,"missing-source",CreateOperation::Folder{parent:"".into(),name:"bad".into()}).is_err());
  assert!(!root.join("bad").exists());
 }
 #[test] fn create_rename_move_and_restore(){
  let (_dir,library,id,root)=setup();
  execute(&library,&id,Operation::CreateFolder{parent:"".into(),name:"folder".into()}).unwrap();
  execute(&library,&id,Operation::CreateText{parent:"".into(),name:"a.txt".into(),content:"hello".into()}).unwrap();
  execute(&library,&id,Operation::Rename{path:"a.txt".into(),name:"b.txt".into()}).unwrap();
  execute(&library,&id,Operation::Move{path:"b.txt".into(),parent:"folder".into()}).unwrap();
  let receipt=execute(&library,&id,Operation::Trash{path:"folder".into()}).unwrap();
  assert!(!root.join("folder").exists());assert_eq!(trash_list(&library,&id).unwrap().len(),1);
  execute(&library,&id,Operation::Restore{id:receipt.trash_id.unwrap()}).unwrap();
  assert_eq!(fs::read_to_string(root.join("folder/b.txt")).unwrap(),"hello");assert!(trash_list(&library,&id).unwrap().is_empty());
 }
 #[test] fn rejects_escape_root_and_collisions(){
  let (_dir,library,id,root)=setup();fs::write(root.join("a"),"original").unwrap();
  for path in ["","../source","/tmp","a/..","a\\.."]{assert!(execute(&library,&id,Operation::Trash{path:path.into()}).is_err())}
  assert!(execute(&library,&id,Operation::CreateText{parent:"".into(),name:"a".into(),content:"new".into()}).is_err());
  assert!(execute(&library,&id,Operation::Rename{path:"a".into(),name:"../b".into()}).is_err());
  assert_eq!(fs::read_to_string(root.join("a")).unwrap(),"original");
 }
 #[test] fn restore_is_account_scoped_and_does_not_overwrite(){
  let (dir,library,id,root)=setup();fs::write(root.join("a"),"original").unwrap();
  let receipt=execute(&library,&id,Operation::Trash{path:"a".into()}).unwrap();
  let second=dir.path().join("second");fs::create_dir(&second).unwrap();let other=library.add_source(&second).unwrap().id;
  let trash_id=receipt.trash_id.unwrap();assert!(execute(&library,&other,Operation::Restore{id:trash_id.clone()}).is_err());
  fs::write(root.join("a"),"replacement").unwrap();assert!(execute(&library,&id,Operation::Restore{id:trash_id.clone()}).is_err());
  assert_eq!(fs::read_to_string(root.join("a")).unwrap(),"replacement");assert_eq!(trash_list(&library,&id).unwrap()[0].id,trash_id);
 }
 #[test] fn refuses_registered_nested_sources_and_recursive_move(){
  let (_dir,library,id,root)=setup();fs::create_dir_all(root.join("nested/child")).unwrap();library.add_source(&root.join("nested")).unwrap();
  assert!(execute(&library,&id,Operation::Trash{path:"nested".into()}).is_err());
  assert!(execute(&library,&id,Operation::Rename{path:"nested".into(),name:"renamed".into()}).is_err());
  assert!(execute(&library,&id,Operation::Move{path:"nested".into(),parent:"nested/child".into()}).is_err());
 }
 #[test] fn native_rename_never_replaces_an_existing_target(){
  let (_dir,_library,_id,root)=setup();fs::write(root.join("a"),"a").unwrap();fs::write(root.join("b"),"b").unwrap();
  assert!(rename_no_replace(&root.join("a"),&root.join("b")).is_err());
  assert_eq!(fs::read_to_string(root.join("a")).unwrap(),"a");assert_eq!(fs::read_to_string(root.join("b")).unwrap(),"b");
 }
 #[cfg(unix)]
 #[test] fn refuses_symlink_components(){
  use std::os::unix::fs::symlink;let (dir,library,id,root)=setup();let outside=dir.path().join("outside");fs::create_dir(&outside).unwrap();symlink(&outside,root.join("link")).unwrap();
  assert!(execute(&library,&id,Operation::CreateFolder{parent:"link".into(),name:"bad".into()}).is_err());
  assert!(execute(&library,&id,Operation::Trash{path:"link".into()}).is_err());assert!(!outside.join("bad").exists());
 }
}
