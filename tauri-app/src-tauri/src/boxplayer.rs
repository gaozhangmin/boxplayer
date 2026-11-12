//! Original Electron boxplayer repository in a bundled, lazy native process.
//! The WebView receives DTOs only. No SQL, filesystem paths, credentials or
//! execution/model configuration can be supplied through this command.
use crate::settings::AppError;
use serde_json::{json, Value};
use std::{path::{Path, PathBuf}, process::Stdio, time::Duration};
use tauri::{Emitter, State};
use tokio::{io::{AsyncBufReadExt, AsyncWriteExt, BufReader}, process::{Child, ChildStdin, ChildStdout, Command}, sync::Mutex};

const MAX_FRAME: usize = 1024 * 1024;
const OPERATIONS: &[&str] = &[
    "status", "listRuns", "getRun", "listStates", "listTracking", "listNotifications",
    "cancelRun", "endTracking", "clearCompletedRuns", "clearNotifications", "markNotificationsRead",
];
fn error(code: &'static str, message: &str) -> AppError { AppError::new(code, message, true) }
struct Host { child: Child, input: ChildStdin, output: BufReader<ChildStdout>, next_id: u64 }
impl Host {
    fn start(binary: &Path, directory: &Path) -> Result<Self, AppError> {
        let mut command=Command::new(binary);
        command.arg(directory).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).kill_on_drop(true);
        #[cfg(target_os="windows")]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let mut child=command.spawn().map_err(|_|error("BOXPLAYER_START", "无法启动媒体获取存储进程，请重新构建开发包"))?;
        let input=child.stdin.take().ok_or_else(||error("BOXPLAYER_START","媒体获取进程输入不可用"))?;
        let output=BufReader::new(child.stdout.take().ok_or_else(||error("BOXPLAYER_START","媒体获取进程输出不可用"))?);
        Ok(Self{child,input,output,next_id:1})
    }
    async fn exchange(&mut self, method:&str,args:Value)->Result<Value,AppError>{
        let id=self.next_id;
        self.next_id=self.next_id.checked_add(1).ok_or_else(||error("BOXPLAYER_PROTOCOL","媒体获取请求编号溢出"))?;
        let mut frame=serde_json::to_vec(&json!({"id":id,"method":method,"args":args})).map_err(|_|error("BOXPLAYER_PROTOCOL","媒体获取请求无效"))?;
        if frame.len()>MAX_FRAME{return Err(error("BOXPLAYER_LIMIT","媒体获取请求过大"))}
        frame.push(b'\n');
        self.input.write_all(&frame).await.map_err(|_|error("BOXPLAYER_IO","无法写入媒体获取进程"))?;
        self.input.flush().await.map_err(|_|error("BOXPLAYER_IO","无法发送媒体获取请求"))?;
        let reply=read_frame(&mut self.output).await?;
        let value:Value=serde_json::from_slice(&reply).map_err(|_|error("BOXPLAYER_PROTOCOL","媒体获取进程响应无效"))?;
        if value.get("id").and_then(Value::as_u64)!=Some(id){return Err(error("BOXPLAYER_PROTOCOL","媒体获取响应编号不匹配"))}
        if let Some(failure)=value.get("error"){
            let message=failure.get("message").and_then(Value::as_str).unwrap_or("媒体获取存储操作失败");
            return Err(AppError::new("BOXPLAYER_STORAGE",message,false));
        }
        value.get("result").cloned().ok_or_else(||error("BOXPLAYER_PROTOCOL","媒体获取进程缺少结果"))
    }
}
async fn read_frame<R:tokio::io::AsyncBufRead+Unpin>(reader:&mut R)->Result<Vec<u8>,AppError>{
    let mut result=Vec::new();
    loop{
        let bytes=reader.fill_buf().await.map_err(|_|error("BOXPLAYER_IO","无法读取媒体获取进程"))?;
        if bytes.is_empty(){return Err(error("BOXPLAYER_IO","媒体获取进程已退出"))}
        let end=bytes.iter().position(|byte|*byte==b'\n');
        let length=end.unwrap_or(bytes.len());
        if result.len()+length>MAX_FRAME{return Err(error("BOXPLAYER_LIMIT","媒体获取响应过大"))}
        result.extend_from_slice(&bytes[..length]);
        reader.consume(length+usize::from(end.is_some()));
        if end.is_some(){return Ok(result)}
    }
}
pub struct BoxPlayer { directory:PathBuf, binary:PathBuf, host:Mutex<Option<Host>> }
impl BoxPlayer {
    pub fn new(directory:&Path)->Result<Self,AppError>{
        let executable=std::env::current_exe().map_err(AppError::io)?;
        let name=if cfg!(windows){"boxplayer-host.exe"}else{"boxplayer-host"};
        let mut binary=executable.parent().ok_or_else(||error("BOXPLAYER_PATH","无法定位媒体获取进程"))?.join(name);
        #[cfg(debug_assertions)]
        if !binary.exists(){
            let architecture=if cfg!(target_arch="aarch64"){ "aarch64" }else{ "x86_64" };
            let system=if cfg!(target_os="macos"){ "apple-darwin" }else if cfg!(target_os="windows"){ "pc-windows-msvc" }else{ "unknown-linux-gnu" };
            binary=Path::new(env!("CARGO_MANIFEST_DIR")).join("binaries").join(format!("boxplayer-host-{architecture}-{system}{}",if cfg!(windows){".exe"}else{""}));
        }
        Ok(Self{directory:directory.join("boxplayer"),binary,host:Mutex::new(None)})
    }
    pub async fn call(&self,method:&str,args:Value)->Result<Value,AppError>{
        if !OPERATIONS.contains(&method){return Err(AppError::new("BOXPLAYER_OPERATION","此媒体获取操作尚未开放",false))}
        if !args.is_object(){return Err(AppError::new("BOXPLAYER_INPUT","媒体获取参数无效",false))}
        if serde_json::to_vec(&args).map_err(|_|error("BOXPLAYER_INPUT","媒体获取参数无效"))?.len()>MAX_FRAME-1024{return Err(error("BOXPLAYER_LIMIT","媒体获取请求过大"))}
        let mut guard=self.host.lock().await;
        if guard.is_none(){*guard=Some(Host::start(&self.binary,&self.directory)?)}
        let result=tokio::time::timeout(Duration::from_secs(10),guard.as_mut().unwrap().exchange(method,args)).await;
        match result{
            Ok(Ok(value))=>Ok(value),
            failure=>{
                // Tear down after any failure: no mismatched late reply may be
                // consumed as the next request. Next call reopens and recovers.
                if let Some(mut host)=guard.take(){let _=host.child.kill().await;}
                match failure{Ok(Err(error))=>Err(error),_=>Err(error("BOXPLAYER_TIMEOUT","媒体获取存储请求超时"))}
            }
        }
    }
    pub async fn stop(&self){if let Some(mut host)=self.host.lock().await.take(){let _=host.child.kill().await;}}
}
#[tauri::command]
pub async fn boxplayer_request(app:tauri::AppHandle,state:State<'_,BoxPlayer>,method:String,args:Value)->Result<Value,AppError>{
    let result=state.call(&method,args).await?;
    if matches!(method.as_str(),"cancelRun"|"endTracking"|"clearCompletedRuns"|"clearNotifications"|"markNotificationsRead"){
        let _=app.emit("boxplayer:changed",json!({}));
    }
    Ok(result)
}
#[cfg(test)]
mod tests{
 use super::*;
 #[tokio::test]
 async fn rejects_unknown_operations_before_starting_process(){
  let dir=tempfile::tempdir().unwrap();let service=BoxPlayer::new(dir.path()).unwrap();
  assert!(service.call("createRun",json!({})).await.is_err());
  assert!(service.call("sql",json!({"query":"SELECT 1"})).await.is_err());
  assert!(service.call("listRuns",json!([])).await.is_err());
  assert!(service.host.lock().await.is_none());
 }
 #[tokio::test]
 async fn bounds_frames_and_rejects_truncated_output(){
  let mut valid=BufReader::new(&b"{\"id\":1}\n"[..]);assert_eq!(read_frame(&mut valid).await.unwrap(),b"{\"id\":1}");
  let bytes=vec![b'x';MAX_FRAME+1];let mut oversized=BufReader::new(bytes.as_slice());assert!(read_frame(&mut oversized).await.is_err());
  let mut truncated=BufReader::new(&b"{\"id\":1}"[..]);assert!(read_frame(&mut truncated).await.is_err());
 }
 #[tokio::test]
 async fn bundled_process_roundtrip_and_restart_use_only_test_directory(){
  let directory=tempfile::tempdir().unwrap();
  let service=BoxPlayer::new(directory.path()).unwrap();
  assert!(service.binary.is_file(),"Run pnpm build:boxplayer before native tests");
  let status=service.call("status",json!({})).await.unwrap();
  assert_eq!(status["storageReady"],true);assert_eq!(status["workerReady"],false);
  assert_eq!(service.call("listRuns",json!({})).await.unwrap(),json!([]));
  service.stop().await;
  assert!(service.host.lock().await.is_none());
  assert_eq!(service.call("listTracking",json!({})).await.unwrap(),json!([]));
  assert!(directory.path().join("boxplayer/boxplayer.db").is_file());
  service.stop().await;
 }
}
