//! Portable video-library bundles; import touches only the isolated Tauri DB.
use crate::{catalog::{self,Catalog},storage::{Library,LocalSource,Position},settings::AppError};
use serde::{Serialize,Deserialize};
use serde_json::json;
use rusqlite::{params,OptionalExtension};
use sha2::{Digest,Sha256};
use std::collections::{BTreeMap,HashSet};
#[derive(Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Payload {pub sources:Vec<LocalSource>,pub positions:Vec<Position>,pub catalog:Catalog,#[serde(default)]pub preferences:BTreeMap<String,String>}
#[derive(Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Bundle {pub schema_version:u32,pub source_version:String,pub tables:BTreeMap<String,usize>,pub sha256:String,pub payload:Payload}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Report {pub applied:bool,pub source_count:usize,pub position_count:usize,pub media_count:usize,pub playlist_count:usize,pub series_count:usize,pub backup_id:Option<String>,pub preferences:BTreeMap<String,String>}
pub fn preference_key(key:&str)->bool{matches!(key,"unified-library-category-placement-v2"|"unified-media-home-preferences"|"unified-library-category-bookmarks-v1"|"unified-library-favorite-card-order-v1"|"tauri.filePreferences")||key.starts_with("series.")||key.starts_with("general.")}
fn invalid()->AppError{AppError::new("MIGRATION_INVALID","媒体库迁移包格式、计数或校验无效",false)}
fn db(_:rusqlite::Error)->AppError{AppError::new("MIGRATION_STORAGE","无法事务导入媒体库，原数据未覆盖",true)}
fn tables(p:&Payload)->BTreeMap<String,usize>{BTreeMap::from([("sources".into(),p.sources.len()),("positions".into(),p.positions.len()),("media".into(),p.catalog.items.len()),("playlists".into(),p.catalog.playlists.as_object().map_or(0,|v|v.len())),("series".into(),p.catalog.series.as_object().map_or(0,|v|v.len())),("preferences".into(),p.preferences.len())])}
// JSON objects use sorted keys (serde_json without preserve_order); JS exporter
// uses the same recursive key sorting and UTF-8 bytes, avoiding field-order drift.
fn normalize_numbers(value:&mut serde_json::Value){match value{serde_json::Value::Number(number)=>{if let Some(float)=number.as_f64(){if float.fract()==0.0&&float.abs()<=9007199254740991.0{*value=if float>=0.0{json!(float as u64)}else{json!(float as i64)}}}},serde_json::Value::Array(values)=>values.iter_mut().for_each(normalize_numbers),serde_json::Value::Object(values)=>values.values_mut().for_each(normalize_numbers),_=>{}}}
fn canonical(value:&serde_json::Value)->Result<String,AppError>{Ok(match value{
 serde_json::Value::Array(rows)=>format!("[{}]",rows.iter().map(canonical).collect::<Result<Vec<_>,_>>()?.join(",")),
 serde_json::Value::Object(rows)=>format!("{{{}}}",rows.iter().map(|(key,value)|Ok(format!("{}:{}",serde_json::to_string(key).map_err(|_|invalid())?,canonical(value)?))).collect::<Result<Vec<_>,AppError>>()?.join(",")),
 serde_json::Value::Number(number)=>{let text=number.to_string();if let Some((mantissa,exponent))=text.split_once('e'){
  let exponent:i32=exponent.parse().map_err(|_|invalid())?;let float=number.as_f64().ok_or_else(invalid)?;
  if float.abs()>=0.000001&&float.abs()<1e21{let sign=if mantissa.starts_with('-'){"-"}else{""};let mantissa=mantissa.trim_start_matches('-');let point=mantissa.find('.').unwrap_or(mantissa.len())as i32+exponent;let digits=mantissa.replace('.',"");if point<=0{format!("{}0.{}{}",sign,"0".repeat((-point)as usize),digits)}else if point as usize>=digits.len(){format!("{}{}{}",sign,digits,"0".repeat(point as usize-digits.len()))}else{format!("{}{}.{}",sign,&digits[..point as usize],&digits[point as usize..])}}
  else{format!("{}e{}{}",mantissa,if exponent>=0{"+"}else{""},exponent)}
 }else{text}},
 _=>serde_json::to_string(value).map_err(|_|invalid())?
})}
fn digest(p:&Payload)->Result<String,AppError>{let mut value=serde_json::to_value(p).map_err(|_|invalid())?;normalize_numbers(&mut value);Ok(format!("{:x}",Sha256::digest(canonical(&value)?.into_bytes())))}
pub fn encode(source_version:String,payload:Payload)->Result<Bundle,AppError>{let result=Bundle{schema_version:2,source_version,tables:tables(&payload),sha256:digest(&payload)?,payload};validate(&result)?;Ok(result)}
pub fn validate(b:&Bundle)->Result<(),AppError>{
 if b.schema_version!=2||b.source_version.is_empty()||b.source_version.len()>128||b.tables!=tables(&b.payload)||b.sha256!=digest(&b.payload)? {return Err(invalid())}
 for(key,value)in &b.payload.preferences{if !preference_key(key)||value.len()>1024*1024||serde_json::from_str::<serde_json::Value>(value).is_err(){return Err(invalid())}}
 catalog::validate(&b.payload.catalog)?;
 if b.payload.sources.len()>10000||b.payload.positions.len()>100000{return Err(invalid())}
 let mut ids=HashSet::new();let mut paths=HashSet::new();
 for s in &b.payload.sources{if s.id.is_empty()||s.name.trim().is_empty()||!std::path::Path::new(&s.path).is_absolute()||!ids.insert(&s.id)||!paths.insert(&s.path){return Err(invalid())}}
 let mut positions=HashSet::new();for p in &b.payload.positions{if p.key.is_empty()||!positions.insert(&p.key)||!p.position.is_finite()||!p.duration.is_finite()||p.position<0.0||p.duration<0.0||p.position>p.duration{return Err(invalid())}}
 for item in &b.payload.catalog.items{
  if item["sourceId"].as_str().filter(|v|!v.is_empty()).is_none()||item["fileId"].as_str().filter(|v|!v.is_empty()).is_none(){return Err(invalid())}
  if item["local"]==true&&!ids.contains(&item["sourceId"].as_str().unwrap().to_string()){return Err(invalid())}
  if let Some(v)=item.get("progress"){if !v.is_null()&&v.as_f64().is_none_or(|n|!n.is_finite()||!(0.0..=100.0).contains(&n)){return Err(invalid())}}
 }
 Ok(())
}
pub fn export(library:&Library)->Result<Bundle,AppError>{let old=library.export_bundle()?;encode(env!("CARGO_PKG_VERSION").into(),Payload{sources:old.payload.sources,positions:old.payload.positions,catalog:catalog::load(library)?,preferences:BTreeMap::new()})}
fn normalize_local(mut payload:Payload)->Result<Payload,AppError>{
 let mut source_map=BTreeMap::new();let mut roots=BTreeMap::new();let mut media_map=BTreeMap::new();
 for source in &mut payload.sources{let path=std::fs::canonicalize(&source.path).unwrap_or_else(|_|std::path::PathBuf::from(&source.path));let normalized=crate::storage::identity(&path.to_string_lossy());source_map.insert(source.id.clone(),normalized.clone());source.path=path.to_string_lossy().into_owned();roots.insert(normalized.clone(),path);source.id=normalized;}
 for item in &mut payload.catalog.items{if item["local"]!=true{continue}let old_source=item["sourceId"].as_str().ok_or_else(invalid)?.to_owned();let source=source_map.get(&old_source).ok_or_else(invalid)?;let relative=std::path::Path::new(item["fileId"].as_str().ok_or_else(invalid)?);if relative.is_absolute()||relative.components().any(|part|!matches!(part,std::path::Component::Normal(_))){return Err(invalid())}let absolute=roots[source].join(relative);let canonical=std::fs::canonicalize(&absolute).unwrap_or(absolute);if !canonical.starts_with(&roots[source]){return Err(invalid())}let old_id=item["id"].as_str().ok_or_else(invalid)?.to_owned();let id=serde_json::to_string(&(source,crate::storage::identity(&canonical.to_string_lossy()))).map_err(|_|invalid())?;media_map.insert(old_id,id.clone());item["sourceId"]=json!(source);item["id"]=json!(id);
  if let(Some(progress),Some(duration))=(item["progress"].as_f64(),item["duration"].as_f64()){if duration.is_finite()&&duration>0.0{payload.positions.push(Position{key:crate::storage::identity(&serde_json::to_string(&(source,"local",crate::storage::identity(&canonical.to_string_lossy()))).map_err(|_|invalid())?),position:duration*progress/100.0,duration});}}
 }
 for groups in [&mut payload.catalog.playlists,&mut payload.catalog.series]{for members in groups.as_object_mut().ok_or_else(invalid)?.values_mut(){for member in members.as_array_mut().ok_or_else(invalid)?{if let Some(id)=member.as_str().and_then(|id|media_map.get(id)){*member=json!(id)}}}}
 for text in payload.preferences.values_mut(){let mut value:serde_json::Value=serde_json::from_str(text).map_err(|_|invalid())?;fn remap(value:&mut serde_json::Value,sources:&BTreeMap<String,String>,media:&BTreeMap<String,String>){match value{serde_json::Value::String(id)=>{if let Some(next)=sources.get(id).or_else(||media.get(id)){*id=next.clone()}},serde_json::Value::Array(rows)=>for row in rows{remap(row,sources,media)},serde_json::Value::Object(rows)=>for row in rows.values_mut(){remap(row,sources,media)},_=>{}}}remap(&mut value,&source_map,&media_map);*text=value.to_string();}
 Ok(payload)
}
pub fn import(library:&Library,b:&Bundle)->Result<Report,AppError>{
 validate(b)?;let incoming=normalize_local(b.payload.clone())?;let mut connection=library.connect()?;
 connection.execute_batch("CREATE TABLE IF NOT EXISTS video_catalog(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,body TEXT NOT NULL);CREATE TABLE IF NOT EXISTS catalog_imports(digest TEXT PRIMARY KEY,backup TEXT NOT NULL);").map_err(db)?;
 let tx=connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(db)?;
 let report=|applied,backup_id|Report{applied,backup_id,preferences:incoming.preferences.clone(),source_count:incoming.sources.len(),position_count:incoming.positions.len(),media_count:incoming.catalog.items.len(),playlist_count:incoming.catalog.playlists.as_object().unwrap().len(),series_count:incoming.catalog.series.as_object().unwrap().len()};
 if tx.query_row("SELECT 1 FROM catalog_imports WHERE digest=?1",[&b.sha256],|r|r.get::<_,u8>(0)).optional().map_err(db)?.is_some(){return Ok(report(false,None))}
 let previous:Option<String>=tx.query_row("SELECT body FROM video_catalog WHERE id=1",[],|r|r.get(0)).optional().map_err(db)?;
 let mut target=match &previous{Some(raw)=>serde_json::from_str::<Catalog>(raw).map_err(|_|invalid())?,None=>Catalog::default()};catalog::validate(&target)?;
 let mut source_backup=Vec::new();let mut position_backup=Vec::new();
 {let mut stmt=tx.prepare("SELECT id,name,path FROM sources").map_err(db)?;for row in stmt.query_map([],|r|Ok(json!({"id":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"path":r.get::<_,String>(2)?}))).map_err(db)?{source_backup.push(row.map_err(db)?);}}
 {let mut stmt=tx.prepare("SELECT key,position,duration FROM positions").map_err(db)?;for row in stmt.query_map([],|r|Ok(json!({"key":r.get::<_,String>(0)?,"position":r.get::<_,f64>(1)?,"duration":r.get::<_,f64>(2)?}))).map_err(db)?{position_backup.push(row.map_err(db)?);}}
 let backup=json!({"catalog":previous,"sources":source_backup,"positions":position_backup}).to_string();
 for s in &incoming.sources{
  let conflict:Option<String>=tx.query_row("SELECT id FROM sources WHERE (id=?1 AND path<>?2) OR (path=?2 AND id<>?1)",params![s.id,s.path],|r|r.get(0)).optional().map_err(db)?;
  if conflict.is_some(){return Err(AppError::new("MIGRATION_SOURCE_CONFLICT","本地来源标识或路径冲突，请先调整导出副本",false))}
  tx.execute("INSERT OR IGNORE INTO sources(id,name,path) VALUES(?1,?2,?3)",params![s.id,s.name,s.path]).map_err(db)?;
 }
 for p in &incoming.positions{tx.execute("INSERT OR IGNORE INTO positions(key,position,duration) VALUES(?1,?2,?3)",params![p.key,p.position,p.duration]).map_err(db)?;}
 let mut known:HashSet<String>=target.items.iter().filter_map(|i|i["id"].as_str().map(str::to_owned)).collect();
 for item in &incoming.catalog.items{let id=item["id"].as_str().unwrap();if let Some(previous)=target.items.iter().find(|row|row["id"].as_str()==Some(id)){if previous["sourceId"]!=item["sourceId"]||previous["fileId"]!=item["fileId"]{return Err(AppError::new("MIGRATION_IDENTITY_CONFLICT","媒体身份冲突，未覆盖目标记录",false))}}if known.insert(id.into()){target.items.push(item.clone());}}
 for (existing,incoming) in [(&mut target.playlists,&incoming.catalog.playlists),(&mut target.series,&incoming.catalog.series)]{
  for (name,members) in incoming.as_object().unwrap(){let dest=existing.as_object_mut().unwrap().entry(name.clone()).or_insert(json!([]));let dest=dest.as_array_mut().ok_or_else(invalid)?;for member in members.as_array().unwrap(){if !dest.contains(member){dest.push(member.clone());}}}
 }
 catalog::validate(&target)?;target.revision=target.revision.checked_add(1).ok_or_else(invalid)?;
 let body=serde_json::to_string(&target).map_err(|_|invalid())?;
 tx.execute("INSERT INTO video_catalog(id,revision,body) VALUES(1,?1,?2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body",params![target.revision,body]).map_err(db)?;
 tx.execute("INSERT INTO catalog_imports(digest,backup) VALUES(?1,?2)",params![b.sha256,backup]).map_err(db)?;
 tx.commit().map_err(db)?;Ok(report(true,Some(b.sha256.clone())))
}
#[cfg(test)]
mod tests{
 use super::*;
 fn fixture()->Bundle{let mut catalog=Catalog::default();catalog.items=vec![json!({"id":"video-a","sourceId":"local-a","fileId":"movie.mkv","local":true,"watched":true,"progress":42,"personalRating":8,"originalMetadata":{"credits":{"cast":[{"name":"Actor"}]}}})];catalog.playlists=json!({"Mix":["video-a"]});catalog.series=json!({"Series":["video-a"]});encode("electron-fixture".into(),Payload{sources:vec![LocalSource{id:"local-a".into(),name:"Movies".into(),path:std::env::temp_dir().join("synthetic-movies").to_string_lossy().into()}],positions:vec![Position{key:"local-a/movie.mkv".into(),position:42.,duration:100.}],catalog,preferences:BTreeMap::new()}).unwrap()}
 #[test]fn original_exporter_fixture_matches_native_digest_and_imports(){let fixture=include_str!("../../tests/fixtures/electron-video-v2.json");let bundle:Bundle=serde_json::from_str(fixture).unwrap();validate(&bundle).unwrap();let dir=tempfile::tempdir().unwrap();let library=Library::open(dir.path()).unwrap();assert!(import(&library,&bundle).unwrap().applied);assert!(!import(&library,&bundle).unwrap().applied);let saved=catalog::load(&library).unwrap();assert_eq!(saved.items[0]["progress"],42);assert_eq!(saved.items[0]["favorite"],true);assert_eq!(saved.playlists["Mix"][0],saved.items[0]["id"]);}
 #[test]fn portable_roundtrip_keeps_associations_progress_and_is_idempotent(){let dir=tempfile::tempdir().unwrap();let lib=Library::open(dir.path()).unwrap();let b=fixture();let wire=serde_json::to_vec(&b).unwrap();let copy:Bundle=serde_json::from_slice(&wire).unwrap();assert!(import(&lib,&copy).unwrap().applied);assert!(!import(&lib,&copy).unwrap().applied);let saved=catalog::load(&lib).unwrap();assert_eq!(saved.items.len(),1);assert_eq!(saved.items[0]["progress"],42);assert_eq!(saved.playlists["Mix"][0],saved.items[0]["id"]);assert_eq!(saved.series["Series"][0],saved.items[0]["id"]);assert_eq!(export(&lib).unwrap().payload.positions.len(),1);assert_eq!(saved.items[0]["originalMetadata"]["credits"]["cast"][0]["name"],"Actor");}
 #[test]fn preserves_newer_target_records_and_merges_memberships(){let dir=tempfile::tempdir().unwrap();let lib=Library::open(dir.path()).unwrap();let b=fixture();let mut target=normalize_local(b.payload.clone()).unwrap().catalog;target.items[0]["progress"]=json!(90);catalog::save(&lib,0,target).unwrap();import(&lib,&b).unwrap();assert_eq!(catalog::load(&lib).unwrap().items[0]["progress"],90);}
 #[test]fn rejects_checksum_counts_and_dangling_references_without_writes(){let dir=tempfile::tempdir().unwrap();let lib=Library::open(dir.path()).unwrap();let mut b=fixture();b.tables.insert("media".into(),99);assert!(import(&lib,&b).is_err());b=fixture();b.payload.catalog.items[0]["progress"]=json!(200);assert!(import(&lib,&b).is_err());b=fixture();b.payload.catalog.playlists=json!({"bad":["missing"]});assert!(encode("x".into(),b.payload).is_err());assert!(lib.sources().unwrap().is_empty());assert!(catalog::load(&lib).unwrap().items.is_empty());}
 #[test]fn sql_failure_rolls_back_sources_catalog_positions_and_import_marker(){let dir=tempfile::tempdir().unwrap();let lib=Library::open(dir.path()).unwrap();let b=fixture();let db=lib.connect().unwrap();db.execute_batch("CREATE TRIGGER reject_position BEFORE INSERT ON positions BEGIN SELECT RAISE(ABORT,'fixture'); END;").unwrap();assert!(import(&lib,&b).is_err());assert!(lib.sources().unwrap().is_empty());assert!(catalog::load(&lib).unwrap().items.is_empty());db.execute_batch("DROP TRIGGER reject_position;").unwrap();assert!(import(&lib,&b).unwrap().applied);}
 #[test]fn local_source_collision_fails_without_overwriting_target(){let dir=tempfile::tempdir().unwrap();let lib=Library::open(dir.path()).unwrap();let b=fixture();lib.connect().unwrap().execute("INSERT INTO sources VALUES(?1,'Existing','/different')",[crate::storage::identity(&b.payload.sources[0].path)]).unwrap();assert!(import(&lib,&b).is_err());assert_eq!(lib.sources().unwrap()[0].name,"Existing");assert!(catalog::load(&lib).unwrap().items.is_empty());}
}
#[cfg(test)]mod canonical_tests{use super::*;#[test]fn numbers_match_ecmascript_decimal_and_exponent_boundaries(){for(number,expected)in [(0.000001,"0.000001"),(0.0000001,"1e-7"),(1e21,"1e+21"),(0.42,"0.42")]{assert_eq!(canonical(&json!(number)).unwrap(),expected)}}}
#[cfg(test)]mod identity_tests{use super::*;#[test]fn local_import_matches_native_listing_and_resume_identity(){let dir=tempfile::tempdir().unwrap();let movies=dir.path().join("movies");std::fs::create_dir(&movies).unwrap();std::fs::write(movies.join("movie.mkv"),b"synthetic").unwrap();let mut payload=Payload{sources:vec![LocalSource{id:"old-local".into(),name:"Movies".into(),path:movies.to_string_lossy().into()}],positions:vec![],catalog:Catalog::default(),preferences:BTreeMap::new()};payload.catalog.items.push(json!({"id":"old-file","sourceId":"old-local","fileId":"movie.mkv","local":true,"progress":42,"duration":100}));payload.catalog.playlists=json!({"Mix":["old-file"]});let bundle=encode("old-copy".into(),payload).unwrap();let target=tempfile::tempdir().unwrap();let library=Library::open(target.path()).unwrap();import(&library,&bundle).unwrap();let source=library.sources().unwrap().remove(0);let entries=library.list(&source.id,"").unwrap();let expected=serde_json::to_string(&(&source.id,&entries.entries[0].id)).unwrap();let catalog=catalog::load(&library).unwrap();assert_eq!(catalog.items[0]["id"],expected);assert_eq!(catalog.playlists["Mix"][0],expected);let resume=crate::storage::identity(&serde_json::to_string(&(&source.id,"local",&entries.entries[0].id)).unwrap());assert_eq!(library.position(&resume).unwrap().unwrap().position,42.);}}
