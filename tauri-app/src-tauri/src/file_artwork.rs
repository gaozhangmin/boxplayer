//! Account-bound Ali video snapshots for the unchanged Electron img bindings.
use crate::{artwork_cache::ArtworkCache,commands::Backend,gateway::HttpRequest,settings::AppError};
use tauri::Manager;
use url::Url;
static FETCHES:tokio::sync::Semaphore=tokio::sync::Semaphore::const_new(4);
fn invalid()->AppError{AppError::new("FILE_ARTWORK_SCOPE","文件缩略图请求无效",false)}
fn parse(uri:&str)->Result<(String,String,String),AppError>{
 let outer=Url::parse(uri).map_err(|_|invalid())?;
 let local=(outer.scheme()=="mscache"&&outer.host_str()==Some("localhost"))||(matches!(outer.scheme(),"http"|"https")&&outer.host_str()==Some("mscache.localhost"));
 if !local||!outer.username().is_empty()||outer.password().is_some()||outer.port().is_some(){return Err(invalid())}
 if outer.path()!="/file-thumbnail"||outer.fragment().is_some(){return Err(invalid())}
 let pairs:Vec<_>=outer.query_pairs().map(|(k,v)|(k.into_owned(),v.into_owned())).collect();
 if pairs.len()!=3||pairs.iter().any(|(key,_)|!matches!(key.as_str(),"account"|"url"|"revision")){return Err(invalid())}
 let field=|name:&str|->Result<String,AppError>{let values:Vec<_>=pairs.iter().filter(|(key,_)|key==name).collect();if values.len()!=1{return Err(invalid())}Ok(values[0].1.clone())};
 let account=field("account")?;let revision=field("revision")?;
 if account.is_empty()||account.len()>128||account.chars().any(|c|c.is_control()||c=='/'||c=='\\')||revision.len()>512||revision.chars().any(char::is_control){return Err(invalid())}
 let url=Url::parse(&field("url")?).map_err(|_|invalid())?;
 if url.origin().ascii_serialization()!="https://api.aliyundrive.com"||url.path()!="/v2/file/download"||!url.username().is_empty()||url.password().is_some()||url.fragment().is_some(){return Err(invalid())}
 let query:Vec<_>=url.query_pairs().map(|(k,v)|(k.into_owned(),v.into_owned())).collect();
 if query.len()!=4||query.iter().any(|(key,_)|!matches!(key.as_str(),"t"|"drive_id"|"file_id"|"video_thumbnail_process")){return Err(invalid())}
 let value=|key:&str|->Result<String,AppError>{let rows:Vec<_>=query.iter().filter(|(k,_)|k==key).collect();if rows.len()!=1{return Err(invalid())}Ok(rows[0].1.clone())};
 let drive=value("drive_id")?;let file=value("file_id")?;let time=value("t")?;
 if [drive.as_str(),file.as_str()].iter().any(|id|id.is_empty()||id.len()>4096||id.chars().any(|c|c.is_control()||c=='/'||c=='\\'))||time.is_empty()||time.len()>20||!time.bytes().all(|c|c.is_ascii_digit())||value("video_thumbnail_process")?!="video/snapshot,t_106000,f_jpg,ar_auto,m_fast"{return Err(invalid())}
 let identity=serde_json::json!([account,drive,file,"video/snapshot,t_106000,f_jpg,ar_auto,m_fast",revision]).to_string();
 Ok((account,url.into(),identity))
}
pub async fn image(app:&tauri::AppHandle,uri:&str)->Result<Vec<u8>,AppError>{
 let (account_id,url,identity)=parse(uri)?;
 let _permit=FETCHES.acquire().await.map_err(|_|invalid())?;
 let backend=app.state::<Backend>();
 let account=backend.accounts.list()?.into_iter().find(|a|a.id==account_id&&a.provider_id=="aliyun").ok_or_else(invalid)?;
 let current=||->Result<bool,AppError>{Ok(backend.accounts.list()?.iter().any(|a|a.id==account_id&&a.provider_id=="aliyun"&&a.user_id==account.user_id&&a.base_url==account.base_url))};
 let cache=app.state::<ArtworkCache>().account_cache(&account_id);
 let identity=serde_json::json!([account.base_url,account.user_id,identity]).to_string();
 let bytes=if let Some(bytes)=cache.read_private(&identity)?{bytes}else{
  let response=backend.request(HttpRequest{request_id:uuid::Uuid::new_v4().to_string(),provider_id:"aliyun".into(),account_id:account_id.clone(),method:"GET".into(),url,headers:Default::default(),body:None,timeout_ms:Some(30000),proxy:None}).await?;
  if response.status!=200||response.body.len()>8*1024*1024||crate::artwork_cache::mime(&response.body).is_none(){return Err(invalid())}
  if !current()?{return Err(invalid())}cache.store_private(&identity,&response.body)?;
  if !current()?{app.state::<ArtworkCache>().remove_account(&account_id);return Err(invalid())}response.body
 };
 if !current()?{return Err(invalid())}Ok(bytes)
}
#[cfg(test)]mod tests{
 use super::*;
 fn uri(url:&str)->String{let mut uri=Url::parse("mscache://localhost/file-thumbnail").unwrap();uri.query_pairs_mut().append_pair("account","fixture").append_pair("url",url).append_pair("revision","hash");uri.into()}
 fn target(time:&str)->String{format!("https://api.aliyundrive.com/v2/file/download?t={time}&drive_id=drive&file_id=file&video_thumbnail_process=video%2Fsnapshot%2Ct_106000%2Cf_jpg%2Car_auto%2Cm_fast")}
 #[test]fn snapshot_cache_identity_is_account_file_and_revision_bound_but_not_timestamp_bound(){let a=parse(&uri(&target("123"))).unwrap();let b=parse(&uri(&target("456"))).unwrap();assert_eq!(a.2,b.2);assert_ne!(a.1,b.1);let changed=uri(&target("123")).replace("revision=hash","revision=other");assert_ne!(a.2,parse(&changed).unwrap().2);assert_eq!(a.0,"fixture");let other=uri(&target("123")).replace("account=fixture","account=other");assert_ne!(a.2,parse(&other).unwrap().2);}
 #[test]fn rejects_other_hosts_credentials_full_file_downloads_and_changed_snapshot_processes(){for url in [target("123").replace("api.aliyundrive.com","api.aliyundrive.com.evil.test"),target("123").replace("https://","http://"),target("123").replace("https://","https://u:p@"),target("123")+"&access_token=secret",target("123").replace("t_106000","t_0"),"https://api.aliyundrive.com/v2/file/download?drive_id=drive&file_id=file".into(),target("123")+"&file_id=other"]{assert!(parse(&uri(&url)).is_err());}}
 #[test]fn rejects_missing_duplicate_and_extra_private_fields(){let valid=uri(&target("123"));for value in [valid.clone()+"&account=other",valid.clone()+"&secret=unexpected",valid.replace("account=fixture","account="),valid.replace("/file-thumbnail","/other")]{assert!(parse(&value).is_err());}}
}
