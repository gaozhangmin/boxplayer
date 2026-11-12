//! Native IO for the original Electron in-memory text-upload algorithm. No transfer queue.
use crate::{accounts::Account,commands::Backend,gateway::{HttpRequest,HttpResponse},settings::AppError};
use base64::{engine::general_purpose::STANDARD,Engine};
use md5::{Digest,Md5};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use std::{collections::HashMap,sync::{Arc,Mutex,OnceLock},time::{Duration,Instant}};
use tokio_util::sync::CancellationToken;
fn error(message:&str)->AppError{AppError::new("GUANGYA_TEXT",message,false)}
struct Upload{owner:Account,binding:String,name:String,parent:String,bytes:Vec<u8>,token:Option<Value>,token_started:bool,put_started:bool}
struct Job{data:tokio::sync::Mutex<Upload>,cancel:CancellationToken,created:Instant,account:String}
static JOBS:OnceLock<Mutex<HashMap<String,Arc<Job>>>>=OnceLock::new();
fn jobs()->&'static Mutex<HashMap<String,Arc<Job>>>{JOBS.get_or_init(Default::default)}
fn binding(state:&Backend,id:&str)->Result<String,AppError>{let bytes=serde_json::to_vec(&state.accounts.credentials(id)?).map_err(|_|error("账号凭据无法确认"))?;Ok(format!("{:x}",sha2::Sha256::digest(bytes)))}
fn check(state:&Backend,upload:&Upload)->Result<(),AppError>{
 let current=state.accounts.list()?.into_iter().find(|row|row.id==upload.owner.id&&row.provider_id=="guangya").ok_or_else(||error("光鸭账号不存在或已切换"))?;
 if serde_json::to_value(current).ok()!=serde_json::to_value(&upload.owner).ok()||binding(state,&upload.owner.id)?!=upload.binding{return Err(error("文本创建账号或凭据已变化"))}Ok(())
}
fn id(value:&str,root:bool)->bool{(root||!value.is_empty())&&value.len()<=4096&&!value.chars().any(|c|c.is_control()||c=='/'||c=='\\')}
fn response(response:HttpResponse,pending_allowed:bool)->Result<Value,AppError>{
 let data:Value=serde_json::from_slice(&response.body).map_err(|_|error("光鸭文本响应无效，请刷新目录确认"))?;
 let code=data.get("code").and_then(|v|v.as_i64().or_else(||v.as_str().and_then(|s|s.parse().ok())));
 if !(200..300).contains(&response.status)||!data.is_object()||code.is_some_and(|code|code!=0)||data["success"]==false{
  // Original apiGuangyaUploadInfo catches the service's file-uploading error as pending.
  let msg=string(&data,&["message","msg","error"]);
  if pending_allowed&&msg.contains("文件上传中"){return Ok(json!({"data":{"status":"uploading"}}))}
  return Err(error("光鸭文本操作未确认成功，请刷新目录确认"))
 }Ok(data)
}
async fn post(state:&Backend,upload:&Upload,path:&str,body:Value)->Result<Value,AppError>{
 check(state,upload)?;
 let request=HttpRequest{request_id:uuid::Uuid::new_v4().to_string(),provider_id:"guangya".into(),account_id:upload.owner.id.clone(),method:"POST".into(),url:format!("https://api.guangyapan.com{path}"),headers:[("Content-Type".into(),"application/json".into())].into(),body:Some(serde_json::to_vec(&body).map_err(|_|error("文本请求参数无效"))?),timeout_ms:Some(30000),proxy:None};
 let result=response(state.request(request).await?,path.ends_with("/get_info_by_task_id"))?;check(state,upload)?;Ok(result)
}
fn body(value:&Value)->&Value{value.get("data").unwrap_or(value)}
fn string<'a>(value:&'a Value,keys:&[&str])->&'a str{keys.iter().find_map(|key|value[*key].as_str().filter(|s|!s.is_empty())).unwrap_or("")}
fn upload_info(result:&Value)->Result<Value,AppError>{
 let data=body(result);
 let file=["fileId","id","file_id","resId"].iter().find_map(|key|{let value=&data[*key];value.as_str().filter(|s|!s.is_empty()).map(str::to_owned).or_else(||value.as_u64().filter(|v|*v!=0).map(|v|v.to_string()))}).unwrap_or_default();
 let status=data.get("status").or_else(||data.get("uploadStatus")).or_else(||data.get("state")).map(|v|v.as_str().map(str::to_owned).unwrap_or_else(||v.to_string())).unwrap_or_default().to_lowercase();
 let msg=string(result,&["msg","message"]);let msg=if msg.is_empty(){string(data,&["msg","message"])}else{msg};
 let uploading=["0","1","uploading","processing","pending"].contains(&status.as_str())||["上传中","处理中","uploading","processing","pending"].iter().any(|v|msg.to_lowercase().contains(v));
 if !file.is_empty()&&!id(&file,false){return Err(error("光鸭文件标识无效"))}
 Ok(json!({"fileId":file,"uploading":uploading,"error":if !file.is_empty()||uploading{""}else{"光鸭云盘未返回上传文件 ID"}}))
}
fn signed_put(token:&Value,bytes:&[u8],date:&str)->Result<HttpRequest,AppError>{
 let endpoint=string(token,&["fullEndPoint"]);let endpoint=if endpoint.starts_with("http"){endpoint.to_owned()}else{format!("https://{endpoint}")};
 let parsed=url::Url::parse(&endpoint).map_err(|_|error("光鸭上传地址无效"))?;
 let host=parsed.host_str().unwrap_or("");
 if parsed.scheme()!="https"||!host.ends_with(".aliyuncs.com")||!parsed.username().is_empty()||parsed.password().is_some()||parsed.query().is_some()||parsed.fragment().is_some()||parsed.port().is_some()||parsed.path()!="/"{return Err(error("光鸭上传地址无效"))}
 let bucket=string(token,&["bucketName"]);let object=string(token,&["objectPath"]);let creds=&token["creds"];
 let access=string(creds,&["accessKeyID","accessKeyId"]);let secret=string(creds,&["secretAccessKey","accessKeySecret"]);let session=string(creds,&["sessionToken","securityToken"]);
 if bucket.is_empty()||object.is_empty()||access.is_empty()||secret.is_empty()||[bucket,object,access,secret,session].iter().any(|s|s.chars().any(char::is_control))||object.starts_with('/')||object.contains('?')||object.contains('#')||object.split('/').any(|s|s==".."||s=="."){return Err(error("光鸭上传凭证不完整或路径无效"))}
 let md5=STANDARD.encode(Md5::digest(bytes));let content="application/octet-stream";
 let oss_headers=format!("x-oss-date:{date}\n{}",if session.is_empty(){String::new()}else{format!("x-oss-security-token:{}\n",session.trim())});
 let canonical=format!("PUT\n{md5}\n{content}\n{date}\n{oss_headers}/{bucket}/{object}");
 let key=ring::hmac::Key::new(ring::hmac::HMAC_SHA1_FOR_LEGACY_USE_ONLY,secret.as_bytes());let signature=STANDARD.encode(ring::hmac::sign(&key,canonical.as_bytes()).as_ref());
 let mut headers=std::collections::BTreeMap::from([("Content-MD5".into(),md5),("Content-Type".into(),content.into()),("x-oss-date".into(),date.into()),("Authorization".into(),format!("OSS {access}:{signature}"))]);if !session.is_empty(){headers.insert("x-oss-security-token".into(),session.into());}
 Ok(HttpRequest{request_id:uuid::Uuid::new_v4().to_string(),provider_id:"guangya".into(),account_id:String::new(),method:"PUT".into(),url:format!("{}/{object}",endpoint.trim_end_matches('/')),headers,body:Some(bytes.to_vec()),timeout_ms:Some(30000),proxy:None})
}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct Begin{account:Account,parent:String,name:String,content:String}
#[derive(Serialize)]#[serde(rename_all="camelCase")]
pub struct Begun{handle:String,md5:String}
#[tauri::command]
pub fn guangya_text_begin(window:tauri::Window,state:tauri::State<'_,Backend>,request:Begin)->Result<Begun,AppError>{
 if window.label()!="main"||request.account.provider_id!="guangya"||!id(&request.parent,true)||request.name.trim().is_empty()||request.name.len()>400||!id(&request.name,false)||matches!(request.name.as_str(),"."|".."){return Err(error("文本创建参数无效"))}
 let upload=Upload{binding:binding(&state,&request.account.id)?,owner:request.account,name:request.name,parent:request.parent,bytes:request.content.into_bytes(),token:None,token_started:false,put_started:false};check(&state,&upload)?;
 let mut jobs=jobs().lock().map_err(|_|error("文本创建状态不可用"))?;jobs.retain(|_,job|{let valid=job.created.elapsed()<Duration::from_secs(180);if !valid{job.cancel.cancel()}valid});
 if jobs.len()>=64||jobs.values().any(|job|job.account==upload.owner.id){return Err(error("此账号已有文本创建正在进行"))}
 let handle=uuid::Uuid::new_v4().to_string();let md5=STANDARD.encode(Md5::digest(&upload.bytes));let account=upload.owner.id.clone();jobs.insert(handle.clone(),Arc::new(Job{data:tokio::sync::Mutex::new(upload),cancel:CancellationToken::new(),created:Instant::now(),account}));Ok(Begun{handle,md5})
}
#[tauri::command]
pub async fn guangya_text_step(window:tauri::Window,state:tauri::State<'_,Backend>,handle:String,action:String)->Result<Value,AppError>{
 if window.label()!="main"{return Err(error("只能从主窗口创建文本"))}
 let job=jobs().lock().map_err(|_|error("文本创建状态不可用"))?.get(&handle).cloned().ok_or_else(||error("文本创建已结束"))?;
 if job.created.elapsed()>Duration::from_secs(180){job.cancel.cancel()}
 let work=async{let mut upload=job.data.lock().await;check(&state,&upload)?;
 let result=match action.as_str(){
 "token"=>{if upload.token_started{return Err(error("创建已提交，请刷新目标确认；不会重复创建"))}upload.token_started=true;
 let result=post(&state,&upload,"/nd.bizuserres.s/v1/get_res_center_token",json!({"capacity":2,"name":upload.name,"parentId":upload.parent,"res":{"fileSize":upload.bytes.len(),"md5":STANDARD.encode(Md5::digest(&upload.bytes))}})).await?;
 let token=body(&result).clone();let task=string(&token,&["taskId"]).to_owned();if !id(&task,false){return Err(error("光鸭未返回有效上传任务"))}upload.token=Some(token);json!({"data":{"taskId":task},"error":""})},
 "info"=>{let token=upload.token.as_ref().ok_or_else(||error("文本上传任务不存在"))?;let result=post(&state,&upload,"/nd.bizuserres.s/v1/file/get_info_by_task_id",json!({"taskId":token["taskId"]})).await?;upload_info(&result)?},
 "put"=>{if upload.put_started{return Err(error("内容已提交，请刷新目标确认；不会重复上传"))}let token=upload.token.as_ref().ok_or_else(||error("文本上传任务不存在"))?;let request=signed_put(token,&upload.bytes,&chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string())?;upload.put_started=true;let response=state.gateway.request(request).await.map_err(|_|error("光鸭上传结果未确认，请刷新目录确认"))?;if !(200..300).contains(&response.status){return Err(error("光鸭文本内容上传失败，请刷新目标确认"))}json!("")},
 _=>return Err(error("文本操作无效"))};check(&state,&upload)?;Ok(result)};
 tokio::select!{result=work=>result,_=job.cancel.cancelled()=>Err(error("文本创建已取消，已提交结果请刷新目标确认"))}
}
#[tauri::command]
pub fn guangya_text_close(window:tauri::Window,handle:String)->Result<(),AppError>{if window.label()!="main"{return Err(error("只能从主窗口结束文本创建"))}if let Some(job)=jobs().lock().map_err(|_|error("文本创建状态不可用"))?.remove(&handle){job.cancel.cancel()}Ok(())}
#[cfg(test)]mod tests{
 use super::*;
 fn token()->Value{json!({"fullEndPoint":"https://bucket.oss-cn-hangzhou.aliyuncs.com","bucketName":"bucket","objectPath":"text/a.txt","creds":{"accessKeyID":"fixture-key","accessKeySecret":"fixture-secret","securityToken":"fixture-session"}})}
 #[test]fn original_oss_signature_and_utf8_body(){let req=signed_put(&token(),"中文🎬".as_bytes(),"20261109T000000Z").unwrap();assert!(req.account_id.is_empty());assert_eq!(req.body.unwrap(),"中文🎬".as_bytes());assert_eq!(req.headers["Content-MD5"],STANDARD.encode(Md5::digest("中文🎬".as_bytes())));assert_eq!(req.headers["Authorization"],"OSS fixture-key:QZVil5B87mO40bLT0ndV13DfIrQ=");assert!(!req.headers.contains_key("Cookie"));assert_eq!(req.headers["x-oss-security-token"],"fixture-session");}
 #[test]fn refuses_untrusted_destination_or_incomplete_credentials(){for endpoint in ["http://bucket.oss-cn-hangzhou.aliyuncs.com","https://evil.test","https://aliyuncs.com.evil.test","https://user@bucket.oss-cn-hangzhou.aliyuncs.com","https://bucket.oss-cn-hangzhou.aliyuncs.com/path"]{let mut value=token();value["fullEndPoint"]=json!(endpoint);assert!(signed_put(&value,b"text","date").is_err());}let mut value=token();value["creds"]=json!({});assert!(signed_put(&value,b"text","date").is_err());}
 #[test]fn task_status_preserves_numeric_ids_and_pending_variants(){
  assert_eq!(upload_info(&json!({"data":{"fileId":18446744073709551615u64}})).unwrap()["fileId"],"18446744073709551615");
  for value in [json!({"data":{"state":0}}),json!({"data":{"uploadStatus":"processing"}}),json!({"msg":"文件上传中"})]{let info=upload_info(&value).unwrap();assert_eq!(info["uploading"],true);assert_eq!(info["error"],"");}
  let failed=upload_info(&json!({"data":{"status":"failed"}})).unwrap();assert_eq!(failed["uploading"],false);assert_ne!(failed["error"],"");
 }
 #[test]fn parses_original_string_code_and_uploading_service_error_without_exposing_body(){
  let response_for=|value:Value|HttpResponse{status:200,headers:Default::default(),body:serde_json::to_vec(&value).unwrap(),final_url:String::new()};
  assert!(response(response_for(json!({"code":"0","data":{}})),false).is_ok());
  let pending=json!({"code":500,"msg":"文件上传中 fixture-secret"});
  assert!(response(response_for(pending.clone()),false).is_err());
  let value=response(response_for(pending),true).unwrap();assert_eq!(upload_info(&value).unwrap()["uploading"],true);assert!(!value.to_string().contains("fixture-secret"));
  let err=response(response_for(json!({"code":500,"msg":"fixture-secret"})),true).unwrap_err();assert!(!err.message.contains("fixture-secret"));
 }
 #[test]fn rejects_unsafe_object_paths_before_signed_request(){for path in ["../text","a/../text","a/./text","/text","text?signature=x","text#fragment","text\n"]{let mut value=token();value["objectPath"]=json!(path);assert!(signed_put(&value,b"text","date").is_err());}}

}
