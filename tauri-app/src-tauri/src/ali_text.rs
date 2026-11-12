//! One-editor-document Aliyun web mutation. No general upload tasks or renderer credentials.
use crate::{accounts::{Account,Accounts,Credentials},ali_text_protocol::{self as protocol,TextIo,TextTarget},commands::Backend,gateway::{HttpRequest,HttpResponse},settings::AppError};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::HashMap,sync::{Arc,Mutex,OnceLock,atomic::Ordering},time::{Duration,Instant}};
use tokio_util::sync::CancellationToken;
fn error(message:&str)->AppError{AppError::new("ALI_TEXT",message,false)}
struct Job{account:String,cancel:CancellationToken,created:Instant,active:bool}
static JOBS:OnceLock<Mutex<HashMap<String,Arc<Job>>>>=OnceLock::new();
fn jobs()->&'static Mutex<HashMap<String,Arc<Job>>>{JOBS.get_or_init(Default::default)}
struct Guard{id:String,job:Arc<Job>}
impl Drop for Guard{fn drop(&mut self){if let Ok(mut jobs)=jobs().lock(){if jobs.get(&self.id).is_some_and(|job|Arc::ptr_eq(job,&self.job)){jobs.remove(&self.id);}}}}
fn validate_id(id:&str)->Result<(),AppError>{uuid::Uuid::parse_str(id).map(|_|()).map_err(|_|error("文本请求标识无效"))}
fn start(id:&str,account:&str)->Result<Guard,AppError>{
 validate_id(id)?;let mut jobs=jobs().lock().map_err(|_|error("文本操作状态不可用"))?;
 jobs.retain(|_,job|job.active||job.created.elapsed()<Duration::from_secs(60));
 if let Some(job)=jobs.get(id){if job.account==account&&job.cancel.is_cancelled(){return Err(error("文本创建已取消"))}return Err(error("文本请求标识已占用"))}
 if jobs.len()>=64||jobs.values().any(|job|job.active&&job.account==account){return Err(error("此账号已有文本操作，请等待结果"))}
 let job=Arc::new(Job{account:account.into(),cancel:CancellationToken::new(),created:Instant::now(),active:true});jobs.insert(id.into(),job.clone());Ok(Guard{id:id.into(),job})
}
fn cancel(id:&str,account:&str)->Result<bool,AppError>{
 validate_id(id)?;let mut jobs=jobs().lock().map_err(|_|error("文本操作状态不可用"))?;
 jobs.retain(|_,job|job.active||job.created.elapsed()<Duration::from_secs(60));
 if let Some(job)=jobs.get(id){if job.account!=account{return Ok(false)}job.cancel.cancel();return Ok(true)}
 if jobs.len()>=64{return Ok(false)}
 let token=CancellationToken::new();token.cancel();jobs.insert(id.into(),Arc::new(Job{account:account.into(),cancel:token,created:Instant::now(),active:false}));Ok(true)
}
fn account(accounts:&Accounts,id:&str)->Result<Account,AppError>{accounts.list()?.into_iter().find(|row|row.id==id&&row.provider_id=="aliyun").ok_or_else(||error("阿里网页账号不存在或已切换"))}
fn same_account(left:&Account,right:&Account)->bool{serde_json::to_value(left).ok()==serde_json::to_value(right).ok()}
fn fingerprint(value:&Credentials)->Result<String,AppError>{
 let bytes=serde_json::to_vec(&json!({"headers":value.headers,"query":value.query,"refresh":value.refresh_token,"oauth":value.oauth})).map_err(|_|error("账号身份无法确认"))?;
 Ok(Sha256::digest(bytes).iter().map(|byte|format!("{byte:02x}")).collect())
}
fn api_request(accounts:&Accounts,owner:&Account,url:&str)->Result<HttpRequest,AppError>{
 let mut request=HttpRequest{request_id:uuid::Uuid::new_v4().to_string(),provider_id:"aliyun".into(),account_id:owner.id.clone(),method:"POST".into(),url:url.into(),headers:[("Content-Type".into(),"application/json".into())].into(),body:None,timeout_ms:Some(30000),proxy:None};
 accounts.authorize(&mut request)?;Ok(request)
}
fn part_request(url:&str,bytes:&[u8])->Result<HttpRequest,AppError>{
 if !protocol::upload_destination(url){return Err(error("文本上传目标地址无效"))}
 Ok(HttpRequest{request_id:uuid::Uuid::new_v4().to_string(),provider_id:"aliyun".into(),account_id:String::new(),method:"PUT".into(),url:url.into(),headers:[("Content-Type".into(),String::new())].into(),body:Some(bytes.to_vec()),timeout_ms:Some(30000),proxy:None})
}
fn response_json(response:HttpResponse)->Result<Value,AppError>{
 let value:Value=serde_json::from_slice(&response.body).map_err(|_|error("阿里文本响应无效，请刷新目标确认"))?;
 if !(200..300).contains(&response.status)||!value.is_object()||value.get("code").is_some()||value.get("error").is_some(){
  return Err(error(match value["code"].as_str(){Some("AlreadyExists")=>"网盘中已存在同名文件",Some("QuotaExhausted.Drive")=>"网盘空间已满",Some("AccessTokenExpired"|"InvalidAccessToken"|"AccessTokenInvalid")=>"阿里账号已过期，请重新登录",_=>"阿里文本操作失败，请刷新目标确认"}))
 }Ok(value)
}
struct NativeText<'a>{state:&'a Backend,owner:Account,binding:String,cancel:CancellationToken}
impl NativeText<'_>{
 async fn send(&self,request:HttpRequest)->Result<HttpResponse,AppError>{self.check()?;let response=self.state.gateway.request(request).await?;self.check()?;Ok(response)}
 async fn post(&self,path:&str,body:Value)->Result<Value,AppError>{
  self.check()?;let url=if path=="account-info"{"https://user.aliyundrive.com/v2/user/get".into()}else{format!("https://api.aliyundrive.com/{path}")};
  let mut request=api_request(&self.state.accounts,&self.owner,&url)?;request.body=Some(serde_json::to_vec(&body).map_err(|_|error("文本请求参数无效"))?);self.check()?;
  let mut response=self.send(request.clone()).await?;
  if path=="v2/file/complete"&&matches!(response.status,400|429){response=self.send(request).await?}
  response_json(response)
 }
}
impl TextIo for NativeText<'_>{
 fn check(&self)->Result<(),AppError>{
  if self.cancel.is_cancelled()||self.state.exiting.load(Ordering::Acquire){return Err(error("文本创建已取消，已发出的创建结果请刷新目标确认"))}
  if !same_account(&account(&self.state.accounts,&self.owner.id)?,&self.owner)||fingerprint(&self.state.accounts.credentials(&self.owner.id)?)?!=self.binding{return Err(error("文本创建账号或凭据已变化，请刷新目标确认"))}Ok(())
 }
 async fn drive_info(&mut self)->Result<Value,AppError>{self.post("account-info",json!({})).await}
 async fn file_info(&mut self,drive:&str,file:&str)->Result<Value,AppError>{self.post("v2/file/get",json!({"drive_id":drive,"file_id":file})).await}
 async fn create_file(&mut self,target:&TextTarget<'_>,bytes:&[u8])->Result<(Value,String),AppError>{
  self.check()?;let mut request=api_request(&self.state.accounts,&self.owner,"https://api.aliyundrive.com/adrive/v2/file/createWithFolders")?;
  let authorization=request.headers.iter().find(|(key,_)|key.eq_ignore_ascii_case("authorization")).map(|(_,value)|value.as_str()).ok_or_else(||error("阿里访问令牌缺失"))?;
  let token=authorization.strip_prefix("Bearer ").filter(|value|!value.is_empty()).ok_or_else(||error("阿里访问令牌格式无效"))?;
  let (hash,proof)=protocol::hash_proof(token,bytes)?;request.body=Some(serde_json::to_vec(&protocol::create_body(target,bytes.len() as u64,&hash,&proof)?).map_err(|_|error("文本创建参数无效"))?);
  self.check()?;let result=response_json(self.send(request).await?)?;Ok((result,hash))
 }
 async fn put(&mut self,url:&str,bytes:&[u8])->Result<(),AppError>{let response=self.send(part_request(url,bytes)?).await?;if !(200..300).contains(&response.status){return Err(error("文本上传未完成，未执行合并，请刷新目标确认"))}Ok(())}
 async fn complete(&mut self,body:Value)->Result<(),AppError>{self.post("v2/file/complete",body).await?;Ok(())}
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct CreateTextRequest{request_id:String,account:Account,drive_id:String,parent_id:String,name:String,content:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct TextCreated{schema_version:u32,account_id:String,drive_id:String,parent_id:String,file_id:String,name:String,size:u64}
#[tauri::command]
pub async fn ali_text_create(window:tauri::Window,state:tauri::State<'_,Backend>,request:CreateTextRequest)->Result<TextCreated,AppError>{
 if window.label()!="main"{return Err(error("只能从主窗口创建文本"))}
 let target=TextTarget{drive:&request.drive_id,parent:&request.parent_id,name:&request.name};target.validate()?;
 let owner=account(&state.accounts,&request.account.id)?;if !same_account(&owner,&request.account){return Err(error("文本创建账号已变化"))}
 let guard=start(&request.request_id,&owner.id)?;let cancel=guard.job.cancel.clone();
 let work=async{
  {let _lock=state.token_refresh.lock().await;crate::aliyun_web::ensure_session(&state.accounts,&state.gateway,&owner.id,false).await?;}
  if !same_account(&account(&state.accounts,&owner.id)?,&owner){return Err(error("文本创建账号已变化"))}
  let binding=fingerprint(&state.accounts.credentials(&owner.id)?)?;let mut io=NativeText{state:&state,owner:owner.clone(),binding,cancel:cancel.clone()};
  let file_id=protocol::create_text(&mut io,&target,request.content.as_bytes()).await?;
  Ok(TextCreated{schema_version:1,account_id:owner.id,drive_id:request.drive_id.clone(),parent_id:request.parent_id.clone(),file_id,name:request.name.clone(),size:request.content.len() as u64})
 };
 tokio::select!{result=work=>result,_=cancel.cancelled()=>Err(error("文本创建已取消，已发出的创建结果请刷新目标确认"))}
}
#[tauri::command]
pub fn ali_text_cancel(window:tauri::Window,request_id:String,account_id:String)->Result<bool,AppError>{if window.label()!="main"{return Err(error("只能从主窗口取消文本创建"))}cancel(&request_id,&account_id)}

#[cfg(test)]
mod tests{
 use super::*;
 use crate::accounts::Vault;
 #[derive(Default)]struct MemoryVault(Mutex<HashMap<String,String>>);
 impl Vault for MemoryVault{
  fn put(&self,key:&str,value:&str)->Result<(),AppError>{self.0.lock().unwrap().insert(key.into(),value.into());Ok(())}
  fn get(&self,key:&str)->Result<String,AppError>{self.0.lock().unwrap().get(key).cloned().ok_or_else(||error("missing fixture"))}
  fn remove(&self,key:&str)->Result<(),AppError>{self.0.lock().unwrap().remove(key);Ok(())}
 }
 fn owner(id:&str)->Account{Account{id:id.into(),provider_id:"aliyun".into(),name:"Fixture".into(),base_url:"https://api.aliyundrive.com".into(),user_id:format!("subject-{id}"),device_id:"fixture-device".into(),auth_origins:vec!["https://api.aliyundrive.com".into(),"https://user.aliyundrive.com".into()]}}
 fn creds(token:&str)->Credentials{Credentials{headers:[("Authorization".into(),format!("Bearer {token}"))].into(),..Default::default()}}
 #[test]fn early_cancel_is_not_lost_before_command_registration(){let id=uuid::Uuid::new_v4().to_string();let account=uuid::Uuid::new_v4().to_string();assert!(cancel(&id,&account).unwrap());assert!(start(&id,&account).is_err());jobs().lock().unwrap().remove(&id);}
 #[test]fn cannot_cancel_another_accounts_request(){let id=uuid::Uuid::new_v4().to_string();let account=uuid::Uuid::new_v4().to_string();let guard=start(&id,&account).unwrap();assert!(!cancel(&id,"other").unwrap());assert!(!guard.job.cancel.is_cancelled());assert!(cancel(&id,&account).unwrap());assert!(guard.job.cancel.is_cancelled());}
 #[test]fn rejects_duplicate_and_concurrent_same_account_jobs(){let id=uuid::Uuid::new_v4().to_string();let other=uuid::Uuid::new_v4().to_string();let account=uuid::Uuid::new_v4().to_string();let guard=start(&id,&account).unwrap();assert!(start(&id,&account).is_err());assert!(start(&other,&account).is_err());drop(guard);assert!(start(&other,&account).is_ok());}
 #[test]fn invalid_job_ids_are_rejected(){assert!(start("bad","fixture").is_err());assert!(cancel("bad","fixture").is_err());}
 #[test]fn vault_token_is_bound_to_the_requested_account_and_authorized_origin(){let dir=tempfile::tempdir().unwrap();let store=Accounts::with_vault(dir.path(),Box::<MemoryVault>::default()).unwrap();let first=store.save(owner(""),creds("token-a")).unwrap();let _second=store.save(owner(""),creds("token-b")).unwrap();let request=api_request(&store,&first,"https://api.aliyundrive.com/adrive/v2/file/createWithFolders").unwrap();assert_eq!(request.headers["Authorization"],"Bearer token-a");assert!(api_request(&store,&first,"https://evil.test/file").is_err());assert!(account(&store,"absent").is_err());}
 #[test]fn credential_replacement_changes_binding_but_unrelated_provider_metadata_does_not(){let mut first=creds("token-a");let before=fingerprint(&first).unwrap();first.provider_data=json!({"autoSignDate":"fixture"});assert_eq!(fingerprint(&first).unwrap(),before);first.headers.insert("Authorization".into(),"Bearer token-b".into());assert_ne!(fingerprint(&first).unwrap(),before);}
 #[test]fn public_account_identity_includes_provider_subject_device_and_origins(){let first=owner("a");let mut second=owner("a");assert!(same_account(&first,&second));second.user_id="other".into();assert!(!same_account(&first,&second));second=owner("a");second.device_id="other-device".into();assert!(!same_account(&first,&second));}
 #[test]fn signed_put_has_no_account_token_cookie_or_authorization(){let request=part_request("https://storage.aliyuncs.com/path?fixture-signature=1",b"fixture").unwrap();assert!(request.account_id.is_empty());assert_eq!(request.method,"PUT");assert_eq!(request.body,Some(b"fixture".to_vec()));assert!(!request.headers.keys().any(|key|matches!(key.to_lowercase().as_str(),"authorization"|"cookie")));assert!(part_request("https://evil.test/path",b"fixture").is_err());}
 #[test]fn failures_do_not_expose_response_bodies_or_signed_urls(){let response=HttpResponse{status:500,headers:Default::default(),body:br#"{"code":"fixture-secret-signed-url"}"#.to_vec(),final_url:"https://storage.aliyuncs.com/private?fixture-signature=1".into()};let error=response_json(response).unwrap_err();assert!(!error.message.contains("fixture-secret"));assert!(!error.message.contains("signature"));}
}
