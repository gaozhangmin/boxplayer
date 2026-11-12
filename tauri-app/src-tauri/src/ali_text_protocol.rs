//! Protocol kernel ported from Electron aliapi/uploadmem.ts, uploadhashpool.ts and upload.ts.
//! No credentials, signed URLs or text bytes are exposed through a renderer command here.
use crate::settings::AppError;
use base64::{engine::general_purpose::STANDARD, Engine};
use md5::{Digest, Md5};
use serde_json::{json, Value};

fn invalid(message:&str)->AppError{AppError::new("ALI_TEXT",message,false)}
fn identity(value:&str)->bool{!value.is_empty()&&value.len()<=4096&&!value.chars().any(|c|c.is_control()||matches!(c,'/'|'\\'))}

pub struct TextTarget<'a>{pub drive:&'a str,pub parent:&'a str,pub name:&'a str}
impl TextTarget<'_>{
 pub fn validate(&self)->Result<(),AppError>{
  if !identity(self.drive)||!identity(self.parent)||self.name.trim().is_empty()||self.name.encode_utf16().count()>100||matches!(self.name,"."|"..")||self.name.chars().any(|c|c.is_control()||matches!(c,'/'|'\\')){return Err(invalid("文本目标、名称或目录无效"))}Ok(())
 }
}
/// Matches GetBuffHashProof, including its UTF-8 -> Latin-1 string -> UTF-8 token conversion.
/// The caller must obtain this token from the native account vault, never from renderer input.
pub fn hash_proof(token:&str,bytes:&[u8])->Result<(String,String),AppError>{
 if token.is_empty(){return Err(invalid("账号失效，操作取消"))}
 let hash=ring::digest::digest(&ring::digest::SHA1_FOR_LEGACY_USE_ONLY,bytes).as_ref().iter().map(|b|format!("{b:02X}")).collect::<String>();
 if bytes.is_empty(){return Ok((hash,String::new()))}
 let original_token_bytes: String=token.as_bytes().iter().map(|b|char::from(*b)).collect();
 let md5=Md5::digest(original_token_bytes.as_bytes());
 let offset=(u64::from_be_bytes(md5[..8].try_into().unwrap())%(bytes.len() as u64)) as usize;
 let end=offset.saturating_add(8).min(bytes.len());
 Ok((hash,STANDARD.encode(&bytes[offset..end])))
}
/// Original createWithFolders part-size progression; at most 8000 parts.
pub fn part_plan(size:u64)->Result<Vec<u64>,AppError>{
 if size==0{return Ok(Vec::new())}
 const UNIT:u64=10_485_760;
 let units=size.div_ceil(UNIT.checked_mul(8000).unwrap()).max(1);
 let part=units.checked_mul(UNIT).ok_or_else(||invalid("文本长度超出分片范围"))?;
 let count=size.div_ceil(part);
 Ok((0..count).map(|index|part.min(size-index*part)).collect())
}
pub fn create_body(target:&TextTarget<'_>,size:u64,hash:&str,proof:&str)->Result<Value,AppError>{
 target.validate()?;
 if hash.len()!=40||!hash.bytes().all(|b|b.is_ascii_hexdigit()){return Err(invalid("文本SHA1无效"))}
 let parts=part_plan(size)?.into_iter().enumerate().map(|(index,size)|json!({"part_number":index+1,"part_size":size})).collect::<Vec<_>>();
 Ok(json!({"drive_id":target.drive,"parent_file_id":target.parent,"name":target.name,"type":"file","check_name_mode":"refuse","size":size,"part_info_list":parts,"description":"","content_hash":hash.to_uppercase(),"content_hash_name":"sha1","proof_version":"v1","proof_code":proof}))
}
/// These URLs are private protocol state. This type deliberately has no Serialize or Debug.
pub struct CreatedText {pub file_id:String,pub upload_id:Option<String>,pub rapid:bool,pub upload_urls:Vec<String>}
pub(crate) fn upload_destination(value:&str)->bool{
 let Ok(url)=url::Url::parse(value) else{return false};
 let Some(host)=url.host_str() else{return false};
 url.scheme()=="https"&&url.username().is_empty()&&url.password().is_none()&&url.fragment().is_none()&&url.port_or_known_default()==Some(443)
  &&(host.ends_with(".aliyuncs.com")||host.ends_with(".aliyundrive.net"))
}
pub fn created(target:&TextTarget<'_>,size:u64,response:&Value)->Result<CreatedText,AppError>{
 target.validate()?;
 if !response.is_object()||response.get("code").is_some()||response.get("error").is_some(){return Err(invalid("阿里未确认文本创建，请刷新目标确认"))}
 if response.get("exist").is_some_and(|v|v!=false){return Err(invalid("网盘中已存在同名文件"))}
 let id=response["file_id"].as_str().filter(|id|identity(id)&&*id!=target.parent).ok_or_else(||invalid("文本创建回执缺少有效文件标识"))?;
 for (key,expected) in [("drive_id",target.drive),("parent_file_id",target.parent),("name",target.name),("type","file")]{if response.get(key).is_some_and(|v|v.as_str()!=Some(expected)){return Err(invalid("文本创建回执目标不匹配"))}}
 let rapid=match response.get("rapid_upload"){None=>false,Some(Value::Bool(value))=>*value,_=>return Err(invalid("文本秒传状态无效"))};
 let mut result=CreatedText{file_id:id.into(),upload_id:None,rapid,upload_urls:Vec::new()};
 if rapid{return Ok(result)}
 result.upload_id=Some(response["upload_id"].as_str().filter(|id|identity(id)).ok_or_else(||invalid("文本上传会话缺失"))?.into());
 let parts=part_plan(size)?;
 let urls=response["part_info_list"].as_array().ok_or_else(||invalid("文本上传分片回执缺失"))?;
 if urls.len()!=parts.len(){return Err(invalid("文本上传分片数量不匹配"))}
 for (index,part) in urls.iter().enumerate(){
  if part["part_number"].as_u64()!=Some(index as u64+1){return Err(invalid("文本上传分片顺序无效"))}
  let value=part["upload_url"].as_str().filter(|value|upload_destination(value)).ok_or_else(||invalid("文本上传目标地址无效"))?;
  result.upload_urls.push(value.into());
 }
 Ok(result)
}
pub fn complete_body(target:&TextTarget<'_>,created:&CreatedText)->Result<Value,AppError>{
 target.validate()?;
 if created.rapid{return Err(invalid("秒传文件不需要合并"))}
 let session=created.upload_id.as_deref().filter(|id|identity(id)).ok_or_else(||invalid("文本上传会话缺失"))?;
 Ok(json!({"drive_id":target.drive,"file_id":created.file_id,"upload_id":session}))
}
pub fn verify_file(target:&TextTarget<'_>,id:&str,size:u64,hash:&str,response:&Value)->Result<(),AppError>{
 target.validate()?;
 if hash.len()!=40||!hash.bytes().all(|b|b.is_ascii_hexdigit()){return Err(invalid("文本SHA1无效"))}
 if response.get("code").is_some()||response.get("error").is_some()||response["file_id"].as_str()!=Some(id)||response["drive_id"].as_str()!=Some(target.drive)||response["parent_file_id"].as_str()!=Some(target.parent)||response["name"].as_str()!=Some(target.name)||response["type"].as_str()!=Some("file")||response.get("trashed").is_some_and(|v|v!=false){return Err(invalid("文本文件的标识、名称或目标尚未确认，请刷新目标确认"))}
 if response["size"].as_u64()!=Some(size)||response["content_hash"].as_str().is_none_or(|value|!value.eq_ignore_ascii_case(hash)){return Err(invalid("文本文件长度或SHA1尚未确认，请刷新目标确认"))}
 Ok(())
}


/// Account-bound native I/O. Implementations own session renewal, vault tokens and HTTP status checks.
/// No implementation or command is installed until the UI cancellation/account boundary is integrated.
pub trait TextIo {
 fn check(&self)->Result<(),AppError>;
 async fn drive_info(&mut self)->Result<Value,AppError>;
 async fn file_info(&mut self,drive:&str,file:&str)->Result<Value,AppError>;
 async fn create_file(&mut self,target:&TextTarget<'_>,bytes:&[u8])->Result<(Value,String),AppError>;
 async fn put(&mut self,url:&str,bytes:&[u8])->Result<(),AppError>;
 async fn complete(&mut self,body:Value)->Result<(),AppError>;
}
/// Bounded to one editor document; no task queue, persistence, workers or general transfer engine.
/// A failed PUT is propagated before complete; no automatic deletion or blind create retry.
pub async fn create_text(io:&mut impl TextIo,target:&TextTarget<'_>,bytes:&[u8])->Result<String,AppError>{
 target.validate()?;io.check()?;
 let drives=io.drive_info().await?;io.check()?;
 if drives.get("code").is_some()||drives.get("error").is_some()||!["resource_drive_id","backup_drive_id","default_drive_id"].iter().any(|key|drives[*key].as_str()==Some(target.drive)){return Err(invalid("文本目标盘不属于当前账号"))}
 if target.parent!="root"{
  let parent=io.file_info(target.drive,target.parent).await?;io.check()?;
  if parent.get("code").is_some()||parent.get("error").is_some()||parent["file_id"].as_str()!=Some(target.parent)||parent["drive_id"].as_str()!=Some(target.drive)||parent["type"].as_str()!=Some("folder")||parent.get("trashed").is_some_and(|v|v!=false){return Err(invalid("文本目标尚未确认为当前盘的文件夹"))}
 }
 io.check()?;let (response,hash)=io.create_file(target,bytes).await?;io.check()?;
 let created=created(target,bytes.len() as u64,&response)?;
 if !created.rapid {
  let plan=part_plan(bytes.len() as u64)?;let mut offset=0;
  for (size,url) in plan.iter().zip(&created.upload_urls){
   io.check()?;let end=offset+usize::try_from(*size).map_err(|_|invalid("文本分片长度无效"))?;
   io.put(url,&bytes[offset..end]).await?;io.check()?;offset=end;
  }
  io.check()?;io.complete(complete_body(target,&created)?).await?;io.check()?;
 }
 let detail=io.file_info(target.drive,&created.file_id).await?;io.check()?;
 verify_file(target,&created.file_id,bytes.len() as u64,&hash,&detail)?;
 Ok(created.file_id)
}

#[cfg(test)]
mod tests{
 use super::*;
 fn target()->TextTarget<'static>{TextTarget{drive:"drive",parent:"folder",name:"你好.txt"}}
 #[test]fn empty_hash_matches_original(){assert_eq!(hash_proof("fixture",b"").unwrap(),("DA39A3EE5E6B4B0D3255BFEF95601890AFD80709".into(),String::new()))}
 #[test]fn ascii_proof_matches_electron_oracle(){assert_eq!(hash_proof("fixture-token",b"Hello BoxPlayer").unwrap(),("72A496B8951C9F67AE9DEBAB900CC8D3A3C3D6E2".into(),"ZXI=".into()))}
 #[test]fn unicode_proof_matches_electron_oracle(){assert_eq!(hash_proof("令牌-fixture","你好，BoxPlayer 🌿".as_bytes()).unwrap(),("4A3315D81C3008BBAFCEE83EEE9C855B7D05E1B3".into(),"ve+8jEJveFA=".into()))}
 #[test]fn utf8_size_and_original_body(){let bytes="你好".as_bytes();let (hash,proof)=hash_proof("fixture",bytes).unwrap();let body=create_body(&target(),bytes.len() as u64,&hash,&proof).unwrap();assert_eq!(body["size"],6);assert_eq!(body["part_info_list"],json!([{"part_number":1,"part_size":6}]));assert_eq!(body["check_name_mode"],"refuse");assert_eq!(body["description"],"")}
 #[test]fn parts_match_original_boundaries(){assert!(part_plan(0).unwrap().is_empty());assert_eq!(part_plan(10_485_760).unwrap(),vec![10_485_760]);assert_eq!(part_plan(10_485_761).unwrap(),vec![10_485_760,1]);let size=10_485_760*8000+1;let parts=part_plan(size).unwrap();assert!(parts.len()<=8000);assert_eq!(parts[0],20_971_520);assert_eq!(parts.iter().sum::<u64>(),size)}
 #[test]fn root_identity_is_not_substring_rewritten(){let target=TextTarget{drive:"drive",parent:"folder-root-name",name:"note.txt"};let body=create_body(&target,0,"DA39A3EE5E6B4B0D3255BFEF95601890AFD80709","").unwrap();assert_eq!(body["parent_file_id"],"folder-root-name")}
 #[test]fn conflict_never_becomes_success(){assert!(created(&target(),1,&json!({"file_id":"old","exist":true,"rapid_upload":true})).is_err())}
 #[test]fn validates_signed_destinations(){for url in ["https://storage.aliyuncs.com/path?signature=fixture","https://cn-beijing-data.aliyundrive.net/path?signature=fixture"]{assert!(upload_destination(url))}for url in ["http://storage.aliyuncs.com/path","https://storage.aliyuncs.com.evil.test/path","https://evil.test/path","https://user@storage.aliyuncs.com/path","https://storage.aliyuncs.com:444/path"]{assert!(!upload_destination(url))}}
 #[test]fn checks_receipt_order_and_target(){let value=json!({"file_id":"new","upload_id":"session","part_info_list":[{"part_number":1,"upload_url":"https://storage.aliyuncs.com/fixture"}]});assert!(created(&target(),1,&value).is_ok());let mut wrong=value.clone();wrong["part_info_list"][0]["part_number"]=json!(2);assert!(created(&target(),1,&wrong).is_err());wrong=value;wrong["parent_file_id"]=json!("other");assert!(created(&target(),1,&wrong).is_err())}
 #[test]fn rapid_still_requires_actual_file_verification(){let value=json!({"file_id":"new","rapid_upload":true});let created=created(&target(),1,&value).unwrap();assert!(created.rapid);assert!(complete_body(&target(),&created).is_err());assert!(verify_file(&target(),"new",1,"0123456789ABCDEF0123456789ABCDEF01234567",&value).is_err())}
 #[test]fn exact_metadata_required(){let mut file=json!({"file_id":"new","drive_id":"drive","parent_file_id":"folder","name":"你好.txt","type":"file","size":6,"content_hash":"0123456789ABCDEF0123456789ABCDEF01234567"});assert!(verify_file(&target(),"new",6,"0123456789abcdef0123456789abcdef01234567",&file).is_ok());for (key,value) in [("size",json!(5)),("content_hash",json!("wrong")),("name",json!("other")),("type",json!("folder")),("drive_id",json!("other"))]{let mut wrong=file.clone();wrong[key]=value;assert!(verify_file(&target(),"new",6,"0123456789abcdef0123456789abcdef01234567",&wrong).is_err())}file["trashed"]=json!(true);assert!(verify_file(&target(),"new",6,"0123456789abcdef0123456789abcdef01234567",&file).is_err())}
 #[test]fn rejects_invalid_names_and_missing_token(){for name in ["", " ","../file","a/b","a\\b",".",".."]{assert!(TextTarget{drive:"drive",parent:"root",name}.validate().is_err())}assert!(hash_proof("",b"text").is_err())}
 struct MockIo{calls:Vec<String>,fail_put:bool,conflict:bool,rapid:bool,cancelled:bool,cancel_after_create:bool,wrong_drive:bool,bytes:Vec<u8>,name:String,hash:String}
 impl Default for MockIo{fn default()->Self{Self{calls:vec![],fail_put:false,conflict:false,rapid:false,cancelled:false,cancel_after_create:false,wrong_drive:false,bytes:vec![],name:String::new(),hash:String::new()}}}
 impl TextIo for MockIo{
  fn check(&self)->Result<(),AppError>{if self.cancelled{Err(invalid("cancelled"))}else{Ok(())}}
  async fn drive_info(&mut self)->Result<Value,AppError>{self.calls.push("drives".into());Ok(json!({"resource_drive_id":if self.wrong_drive{"other"}else{"drive"}}))}
  async fn file_info(&mut self,drive:&str,file:&str)->Result<Value,AppError>{self.calls.push(format!("get:{file}"));if file=="folder"{return Ok(json!({"drive_id":drive,"file_id":file,"type":"folder"}))}Ok(json!({"drive_id":drive,"file_id":file,"parent_file_id":"folder","name":self.name,"type":"file","size":self.bytes.len(),"content_hash":self.hash}))}
  async fn create_file(&mut self,target:&TextTarget<'_>,bytes:&[u8])->Result<(Value,String),AppError>{self.calls.push("create".into());self.bytes=bytes.into();self.name=target.name.into();let (hash,proof)=hash_proof("fixture-native-vault-token",bytes)?;self.hash=hash.clone();let body=create_body(target,bytes.len() as u64,&hash,&proof)?;assert_eq!(body["size"],bytes.len());self.cancelled=self.cancel_after_create;Ok((json!({"file_id":"new","upload_id":"session","exist":self.conflict,"rapid_upload":self.rapid,"part_info_list":part_plan(bytes.len() as u64)?.iter().enumerate().map(|(index,_)|json!({"part_number":index+1,"upload_url":format!("https://storage.aliyuncs.com/part{}",index+1)})).collect::<Vec<_>>()}),hash))}
  async fn put(&mut self,_url:&str,bytes:&[u8])->Result<(),AppError>{self.calls.push(format!("put:{}",bytes.len()));if self.fail_put{Err(invalid("upload failed"))}else{Ok(())}}
  async fn complete(&mut self,_body:Value)->Result<(),AppError>{self.calls.push("complete".into());Ok(())}
 }
 #[tokio::test]async fn upload_failure_never_runs_complete(){let mut io=MockIo{fail_put:true,..Default::default()};assert!(create_text(&mut io,&target(),b"text").await.is_err());assert_eq!(io.calls,vec!["drives","get:folder","create","put:4"])}
 #[tokio::test]async fn full_text_flow_verifies_metadata_after_complete(){let mut io=MockIo::default();assert_eq!(create_text(&mut io,&target(),"你好".as_bytes()).await.unwrap(),"new");assert_eq!(io.calls,vec!["drives","get:folder","create","put:6","complete","get:new"])}
 #[tokio::test]async fn rapid_upload_still_reads_and_verifies_file(){let mut io=MockIo{rapid:true,..Default::default()};assert_eq!(create_text(&mut io,&target(),b"text").await.unwrap(),"new");assert_eq!(io.calls,vec!["drives","get:folder","create","get:new"])}
 #[tokio::test]async fn conflict_and_cancel_do_not_upload_or_complete(){for (conflict,cancel) in [(true,false),(false,true)]{let mut io=MockIo{conflict,cancel_after_create:cancel,..Default::default()};assert!(create_text(&mut io,&target(),b"text").await.is_err());assert_eq!(io.calls,vec!["drives","get:folder","create"])}}
 #[tokio::test]async fn rejects_other_accounts_drive_before_creation(){let mut io=MockIo{wrong_drive:true,..Default::default()};assert!(create_text(&mut io,&target(),b"text").await.is_err());assert_eq!(io.calls,vec!["drives"])}
 #[tokio::test]async fn empty_file_does_not_index_a_nonexistent_first_part(){let mut io=MockIo::default();assert_eq!(create_text(&mut io,&target(),b"").await.unwrap(),"new");assert_eq!(io.calls,vec!["drives","get:folder","create","complete","get:new"])}
 #[tokio::test]async fn large_editor_document_uploads_all_original_parts(){let mut io=MockIo::default();let bytes=vec![b'x';10_485_761];assert_eq!(create_text(&mut io,&target(),&bytes).await.unwrap(),"new");assert_eq!(io.calls,vec!["drives","get:folder","create","put:10485760","put:1","complete","get:new"])}

}
