//! Local path identity projection for journaled rename/move operations.
//! The caller must hold the file-operation lock and commit this with the journal.
use crate::{catalog::Catalog,settings::AppError,storage::identity};
use serde_json::Value;
use std::{collections::HashMap,path::{Component,Path}};
fn error(message:&str)->AppError{AppError::new("LOCAL_IDENTITY",message,false)}
fn valid(path:&str,root:bool)->bool{(root&&path.is_empty())||(!path.is_empty()&&!path.contains(['\\','\0'])&&Path::new(path).components().all(|part|matches!(part,Component::Normal(_)))&&path.split('/').all(|part|!part.is_empty()&&!part.chars().any(char::is_control)))}
fn replace(path:&str,from:&str,to:&str,directory:bool)->Option<String>{
 if path==from{Some(to.into())}else if directory{path.strip_prefix(&format!("{from}/")).map(|suffix|format!("{to}/{suffix}"))}else{None}
}
fn ancestors(path:&str)->Vec<String>{let mut result=vec![String::new()];let mut prefix=String::new();for part in path.split('/').filter(|part|!part.is_empty()){if !prefix.is_empty(){prefix.push('/')}prefix.push_str(part);result.push(prefix.clone())}result}
/// Preserve user metadata while changing the path-derived identity used by the
/// existing scanner and the raw file hash used by the native player.
/// Does not touch the filesystem, preferences, database, or revision itself.
pub fn relocate(catalog:&mut Catalog,source:&str,root:&Path,from:&str,to:&str,directory:bool)->Result<HashMap<String,String>,AppError>{
 if !root.is_absolute()||!valid(from,false)||!valid(to,false)||from==to||directory&&to.starts_with(&format!("{from}/")){return Err(error("本地路径变更范围无效"))}
 crate::catalog::validate(catalog)?;
 let mut draft=catalog.clone();let mut ids=HashMap::new();
 fn visit(item:&mut Value,source:&str,root:&Path,from:&str,to:&str,directory:bool,ids:&mut HashMap<String,String>)->Result<(),AppError>{
  if item["sourceId"].as_str()==Some(source)&&item["local"].as_bool()==Some(true){
   let path=item["fileId"].as_str().ok_or_else(||error("本地媒体缺少相对路径"))?;
   if !valid(path,false){return Err(error("本地媒体路径无效"))}
   if let Some(new_path)=replace(path,from,to,directory){
    let old_id=item["id"].as_str().ok_or_else(||error("本地媒体缺少标识"))?.to_owned();
    let hash=identity(&root.join(&new_path).to_string_lossy());let new_id=serde_json::to_string(&[source,&hash]).map_err(|_|error("本地媒体标识无效"))?;
    if let Some(previous)=ids.insert(old_id,new_id.clone()){if previous!=new_id{return Err(error("本地媒体标识映射冲突"))}}
    let parent=new_path.rsplit_once('/').map(|value|value.0).unwrap_or("");let name=new_path.rsplit('/').next().unwrap();
    let previous=item["fileName"].as_str().unwrap_or("");let rename_title=item["type"].as_str()==Some("unmatched")&&item["metadataSource"].as_str()!=Some("manual")&&item["name"].as_str()==Some(previous);
    item["id"]=Value::String(new_id);item["fileId"]=Value::String(new_path.clone());item["fileName"]=Value::String(name.into());item["folderPath"]=Value::String(parent.into());item["folderAncestors"]=serde_json::json!(ancestors(parent));
    if rename_title{item["name"]=Value::String(name.into())}
    if let Some(roots)=item.get_mut("catalogRoots"){
     let roots=roots.as_array_mut().ok_or_else(||error("本地扫描归属格式无效"))?;
     for value in roots{let old=value.as_str().ok_or_else(||error("本地扫描归属路径无效"))?;if !valid(old,true){return Err(error("本地扫描归属路径无效"))}if let Some(path)=replace(old,from,to,directory){*value=Value::String(path)}}
    }
   }
  }
  if let Some(children)=item.get_mut("collectionMovies"){for child in children.as_array_mut().ok_or_else(||error("本地合集格式无效"))?{visit(child,source,root,from,to,directory,ids)?}}
  Ok(())
 }
 for item in &mut draft.items{visit(item,source,root,from,to,directory,&mut ids)?}
 let mut seen=std::collections::HashSet::new();for item in &draft.items{let id=item["id"].as_str().ok_or_else(||error("媒体标识无效"))?;if !seen.insert(id){return Err(error("目标路径已有媒体记录，未覆盖"))}}
 for groups in [&mut draft.playlists,&mut draft.series]{for members in groups.as_object_mut().ok_or_else(||error("媒体集合格式无效"))?.values_mut(){for member in members.as_array_mut().ok_or_else(||error("媒体集合成员格式无效"))?{if let Some(id)=member.as_str().and_then(|id|ids.get(id)){*member=Value::String(id.clone())}}}}
 crate::catalog::validate(&draft)?;
 *catalog=draft;Ok(ids)
}
/// Matches local_media() -> ResolvedMedia::key(), including the local account tag.
/// Call for every regular file in the pre-operation snapshot, even unscanned files.
pub fn position_keys(source:&str,root:&Path,from:&str,to:&str)->Result<(String,String),AppError>{
 if !root.is_absolute()||!valid(from,false)||!valid(to,false){return Err(error("本地进度路径无效"))}
 let key=|path:&str|{let hash=identity(&root.join(path).to_string_lossy());identity(&serde_json::to_string(&(source,"local",hash)).unwrap())};
 Ok((key(from),key(to)))
}
/// Project the existing tauri.filePreferences document without changing custom
/// names/covers or unrelated roots. The journal host must persist this before ack.
pub fn relocate_preferences(preferences:&mut Value,source:&str,from:&str,to:&str,directory:bool)->Result<(),AppError>{
 if !valid(from,false)||!valid(to,false)||from==to||directory&&to.starts_with(&format!("{from}/")){return Err(error("本地收藏路径变更范围无效"))}
 let mut draft=preferences.clone();if !draft.is_object(){return Err(error("文件偏好格式无效"))}
 let id_for=|path:&str|serde_json::to_string(&[source,path]).unwrap();
 let map_id=|id:&str|->Result<String,AppError>{
  if let Ok(values)=serde_json::from_str::<Vec<String>>(id){if values.len()==2&&values[0]==source{if !valid(&values[1],true){return Err(error("文件偏好路径无效"))}if let Some(path)=replace(&values[1],from,to,directory){return Ok(id_for(&path))}}}
  Ok(id.into())
 };
 if let Some(favorites)=draft.get_mut("favorites"){
  let mut seen=std::collections::HashSet::new();
  for row in favorites.as_array_mut().ok_or_else(||error("文件收藏格式无效"))?{
   if row["sourceId"].as_str()==Some(source)&&row["local"].as_bool()==Some(true){
    let path=row["path"].as_str().ok_or_else(||error("本地收藏缺少路径"))?;
    if !valid(path,true){return Err(error("本地收藏路径无效"))}
    if let Some(path)=replace(path,from,to,directory){row["id"]=Value::String(id_for(&path));row["path"]=Value::String(path)}
   }
   let id=row["id"].as_str().ok_or_else(||error("文件收藏缺少标识"))?;if !seen.insert(id.to_owned()){return Err(error("目标已有收藏，未覆盖"))}
  }
 }
 for field in ["names","covers","hiddenOnHome"]{
  if let Some(value)=draft.get_mut(field){let mut mapped=serde_json::Map::new();for (key,value) in value.as_object().ok_or_else(||error("文件偏好映射格式无效"))?{if mapped.insert(map_id(key)?,value.clone()).is_some(){return Err(error("目标已有文件偏好，未覆盖"))}}*value=Value::Object(mapped)}
 }
 if let Some(order)=draft.get_mut("order"){for value in order.as_array_mut().ok_or_else(||error("文件来源排序格式无效"))?{let id=value.as_str().ok_or_else(||error("文件来源排序标识无效"))?;*value=Value::String(map_id(id)?);}}
 *preferences=draft;Ok(())
}
#[cfg(test)]
mod tests{
 use super::*;use serde_json::json;
 fn item(id:&str,path:&str)->Value{json!({"id":id,"sourceId":"source","local":true,"fileId":path,"fileName":"a.mkv","name":"a.mkv","type":"unmatched","folderPath":"old","folderAncestors":["","old"],"catalogRoots":["old",""],"favorite":true,"progress":45,"personalRating":9})}
 #[test]fn folder_move_rekeys_scanner_identity_and_collection_references_preserving_metadata(){let mut c=Catalog::default();c.items=vec![item("a","old/a.mkv"),item("b","older/a.mkv"),json!({"id":"remote","sourceId":"other","fileId":"old/a.mkv","local":false})];c.playlists=json!({"Watch":["a","b","remote"]});c.series=json!({"Group":["a"]});let untouched=c.items[1..].to_vec();let mapping=relocate(&mut c,"source",Path::new("/fixture"),"old","new/target",true).unwrap();assert_eq!(c.items[0]["fileId"],"new/target/a.mkv");assert_eq!(c.items[0]["folderAncestors"],json!(["","new","new/target"]));assert_eq!(c.items[0]["catalogRoots"],json!(["new/target",""]));assert_eq!(c.items[0]["progress"],45);assert_eq!(c.items[0]["personalRating"],9);assert_eq!(c.items[0]["favorite"],true);assert_eq!(&c.items[1..],&untouched);assert_eq!(c.playlists["Watch"][0],mapping["a"]);assert_eq!(c.series["Group"][0],mapping["a"]);assert_eq!(c.revision,0)}
 #[test]fn single_file_rename_keeps_scraped_or_manual_titles_and_nested_media(){for (kind,metadata,title) in [("unmatched","filename","a.mkv"),("movie","tmdb","Movie"),("unmatched","manual","My title")]{let mut c=Catalog::default();let mut row=item("a","old/a.mkv");row["type"]=json!(kind);row["metadataSource"]=json!(metadata);row["name"]=json!(title);c.items=vec![row.clone(),json!({"id":"collection","collectionMovies":[row]})];relocate(&mut c,"source",Path::new("/fixture"),"old/a.mkv","old/b.mkv",false).unwrap();assert_eq!(c.items[0]["name"],if metadata=="filename"{"b.mkv"}else{title});assert_eq!(c.items[0]["fileName"],"b.mkv");assert_eq!(c.items[1]["collectionMovies"][0]["fileId"],"old/b.mkv")}}
 #[test]fn invalid_paths_and_colliding_target_records_leave_original_catalog_untouched(){let mut c=Catalog::default();c.items=vec![item("a","old/a.mkv")];let original=serde_json::to_value(&c).unwrap();for (from,to) in [("old","old/child"),("../old","new"),("old","/absolute"),("old","new\\bad"),("old","new//bad"),("old","new/"),("old","old")]{assert!(relocate(&mut c,"source",Path::new("/fixture"),from,to,true).is_err());assert_eq!(serde_json::to_value(&c).unwrap(),original)}let id=serde_json::to_string(&["source",&identity("/fixture/new/a.mkv")]).unwrap();c.items.push(item(&id,"new/a.mkv"));let original=serde_json::to_value(&c).unwrap();assert!(relocate(&mut c,"source",Path::new("/fixture"),"old","new",true).is_err());assert_eq!(serde_json::to_value(&c).unwrap(),original)}
 #[test]fn position_keys_match_the_live_player_contract_without_crossing_sources(){
  use crate::gateway::{ResolvedMedia,Headers};
  let (old,new)=position_keys("source",Path::new("/fixture"),"old/a.mkv","new/a.mkv").unwrap();
  let media=ResolvedMedia{schema_version:1,source_id:"source".into(),account_id:"local".into(),file_id:identity("/fixture/old/a.mkv"),url:"file:///fixture/old/a.mkv".into(),headers:Headers::new(),expires_at:None};
  assert_eq!(old,media.key());assert_ne!(old,new);assert_ne!(new,position_keys("other",Path::new("/fixture"),"old/a.mkv","new/a.mkv").unwrap().1);
  assert!(position_keys("source",Path::new("/fixture"),"../escape","new/a.mkv").is_err());
 }
 #[test]fn corrupt_collections_are_rejected_without_partial_identity_changes(){let mut c=Catalog::default();c.items=vec![item("a","old/a.mkv")];c.playlists=json!({"Broken":["missing"]});let original=serde_json::to_value(&c).unwrap();assert!(relocate(&mut c,"source",Path::new("/fixture"),"old","new",true).is_err());assert_eq!(serde_json::to_value(&c).unwrap(),original)}

 #[test]fn bookmark_paths_and_associated_preferences_move_together_with_custom_names_preserved(){
  let old=serde_json::to_string(&["source","old/sub"]).unwrap();let new=serde_json::to_string(&["source","new/sub"]).unwrap();
  let mut p=json!({"favorites":[{"id":old,"sourceId":"source","path":"old/sub","name":"Custom name","local":true},{"id":"remote","sourceId":"other","path":"old/sub","name":"Remote","local":false}],"names":{(old.clone()):"Override"},"covers":{(old.clone()):"https://fixture.test/cover"},"hiddenOnHome":{(old.clone()):true},"order":[old,"source"],"hiddenLocalRoots":{"source":true},"grid":true});
  relocate_preferences(&mut p,"source","old","new",true).unwrap();assert_eq!(p["favorites"][0]["id"],new);assert_eq!(p["favorites"][0]["path"],"new/sub");assert_eq!(p["favorites"][0]["name"],"Custom name");assert_eq!(p["favorites"][1]["path"],"old/sub");assert_eq!(p["names"][&new],"Override");assert_eq!(p["covers"][&new],"https://fixture.test/cover");assert_eq!(p["hiddenOnHome"][&new],true);assert_eq!(p["order"][0],new);assert_eq!(p["hiddenLocalRoots"]["source"],true);
 }
 #[test]fn bookmark_projection_rejects_target_collisions_without_mutating_the_original(){let id=|path:&str|serde_json::to_string(&["source",path]).unwrap();let mut p=json!({"favorites":[],"names":{(id("old")):"Old",(id("new")):"New"}});let original=p.clone();assert!(relocate_preferences(&mut p,"source","old","new",true).is_err());assert_eq!(p,original)}

}
