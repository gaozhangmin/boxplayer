//! Shared proxy policy for native HTTP. Loopback/LAN never goes through an external proxy.
use crate::settings::AppError;
use hyper_util::client::proxy::matcher::Matcher;
use serde::{Deserialize,Serialize};
use std::sync::{Mutex,OnceLock,RwLock,atomic::{AtomicU64,Ordering}};
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct ProxySettings{pub mode:String,pub url:String}
impl Default for ProxySettings{fn default()->Self{Self{mode:"system".into(),url:String::new()}}}
impl ProxySettings{
 pub fn validate(&self)->Result<(),AppError>{
  let invalid=||AppError::new("PROXY_INVALID","代理配置无效，请填写不含账号密码的 HTTP、HTTPS 或 SOCKS5 地址",false);
  if !["system","direct","custom"].contains(&self.mode.as_str())||self.url.len()>2048{return Err(invalid())}
  if self.mode=="custom"||!self.url.is_empty(){let u=url::Url::parse(&self.url).map_err(|_|invalid())?;if !["http","https","socks5","socks5h"].contains(&u.scheme())||u.host_str().is_none()||u.port()==Some(0)||!u.username().is_empty()||u.password().is_some()||!matches!(u.path(),""|"/")||u.query().is_some()||u.fragment().is_some(){return Err(invalid())}}
  Ok(())
 }
}
static POLICY:OnceLock<RwLock<ProxySettings>>=OnceLock::new();
static GENERATION:AtomicU64=AtomicU64::new(0);
static CLIENT:Mutex<Option<(u64,reqwest::Client)>>=Mutex::new(None);
pub fn configure(value:ProxySettings){*POLICY.get_or_init(Default::default).write().unwrap_or_else(|e|e.into_inner())=value;GENERATION.fetch_add(1,Ordering::SeqCst);}
pub fn revision()->u64{GENERATION.load(Ordering::SeqCst)}
fn policy()->ProxySettings{POLICY.get_or_init(Default::default).read().unwrap_or_else(|e|e.into_inner()).clone()}
fn local(url:&url::Url)->bool{
 let Some(host)=url.host_str()else{return true};let host=host.trim_matches(['[',']']).trim_end_matches('.').to_ascii_lowercase();
 if host=="localhost"||host.ends_with(".localhost")||host.ends_with(".local")||!host.contains(['.',':']){return true}
 match host.parse::<std::net::IpAddr>(){Ok(std::net::IpAddr::V4(ip))=>ip.is_loopback()||ip.is_private()||ip.is_link_local()||ip.is_unspecified(),Ok(std::net::IpAddr::V6(ip))=>ip.is_loopback()||ip.is_unique_local()||ip.is_unicast_link_local()||ip.is_unspecified()||ip.to_ipv4_mapped().is_some_and(|v|v.is_private()||v.is_loopback()||v.is_link_local()),_=>false}
}

fn matches_exception(host:&str,pattern:&str)->bool{if pattern.len()>1024{return false}let pattern=regex::escape(pattern).replace("\\*",".*");regex::Regex::new(&format!("(?i)^{pattern}$")).is_ok_and(|r|r.is_match(host))}
#[cfg(target_os="macos")]
fn system_bypass(url:&url::Url)->bool{
 use system_configuration::{dynamic_store::SCDynamicStoreBuilder,core_foundation::{array::CFArray,string::CFString,base::{CFType,TCFType}}};
 let Some(store)=SCDynamicStoreBuilder::new("BoxPlayer proxy").build()else{return false};let Some(values)=store.get_proxies()else{return false};let Some(value)=values.find(&CFString::new("ExceptionsList"))else{return false};let Some(exceptions)=value.downcast::<CFArray>()else{return false};let host=url.host_str().unwrap_or("").trim_matches(['[',']']);let result=exceptions.iter().any(|raw|{let object=unsafe{CFType::wrap_under_get_rule(*raw)};object.downcast::<CFString>().is_some_and(|pattern|matches_exception(host,&pattern.to_string()))});result
}
#[cfg(not(target_os="macos"))]
fn system_bypass(_url:&url::Url)->bool{false}
fn route(policy:&ProxySettings,url:&url::Url,system:impl FnOnce()->Matcher)->Option<url::Url>{
 if local(url)||policy.mode=="direct"||(policy.mode=="system"&&system_bypass(url)){return None}
 if policy.mode=="custom"{return url::Url::parse(&policy.url).ok()}
 let matched=system().intercept(&url.as_str().parse().ok()?)?;
 let mut proxy=url::Url::parse(&matched.uri().to_string()).ok()?;
 if let Some((user,password))=matched.raw_auth(){proxy.set_username(user).ok()?;proxy.set_password(Some(password)).ok()?;}
 else if let Some(auth)=matched.basic_auth(){use base64::Engine;let value=auth.to_str().ok()?.strip_prefix("Basic ")?;let bytes=base64::engine::general_purpose::STANDARD.decode(value).ok()?;let text=String::from_utf8(bytes).ok()?;let(user,password)=text.split_once(':')?;proxy.set_username(user).ok()?;proxy.set_password(Some(password)).ok()?;}
 Some(proxy)
}
pub fn builder()->reqwest::ClientBuilder{
 builder_for(policy())
}
fn builder_for(value:ProxySettings)->reqwest::ClientBuilder{reqwest::Client::builder().no_proxy().proxy(reqwest::Proxy::custom(move |url|route(&value,url,Matcher::from_system))).redirect(reqwest::redirect::Policy::none()).connect_timeout(std::time::Duration::from_secs(10))
}
pub fn client()->Result<reqwest::Client,AppError>{let version=revision();let mut cached=CLIENT.lock().unwrap_or_else(|e|e.into_inner());if let Some((old,client))=&*cached{if *old==version{return Ok(client.clone())}}let client=builder().build().map_err(|_|AppError::new("HTTP_CLIENT","无法创建网络连接",true))?;*cached=Some((version,client.clone()));Ok(client)}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn routing_modes_bypass_lan_and_preserve_system_auth(){
  let system=||Matcher::builder().all("http://member:synthetic@127.0.0.1:7890").build();let target=url::Url::parse("https://api.dropboxapi.com/oauth2/token").unwrap();let proxy=route(&ProxySettings::default(),&target,system).unwrap();assert_eq!(proxy.username(),"member");assert_eq!(proxy.password(),Some("synthetic"));
  for host in ["localhost","127.0.0.1","[::1]","10.0.0.2","192.168.1.2","nas.local","nas","[::ffff:127.0.0.1]"]{let url=url::Url::parse(&format!("http://{host}/file")).unwrap();assert!(route(&ProxySettings::default(),&url,system).is_none(),"{host}");}
  assert!(route(&ProxySettings{mode:"direct".into(),url:String::new()},&target,system).is_none());assert_eq!(route(&ProxySettings{mode:"custom".into(),url:"socks5h://localhost:8888".into()},&target,system).unwrap().scheme(),"socks5h");
 }
 #[test]fn bypass_patterns(){assert!(matches_exception("cdn.zhihu.com","*zhihu.com"));assert!(matches_exception("172.28.1.1","172.2*"));assert!(!matches_exception("api.dropboxapi.com","*.local"));}
 #[test]fn settings_reject_credentials_and_non_proxy_urls(){for value in ["file:///tmp/x","http://user:pass@localhost:7890","http://localhost:7890/path","http://localhost:7890/?secret=x",""]{assert!(ProxySettings{mode:"custom".into(),url:value.into()}.validate().is_err())}assert!(ProxySettings::default().validate().is_ok());}

 #[tokio::test]
 async fn custom_proxy_routes_public_requests_but_not_loopback(){
  let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let addr=listener.local_addr().unwrap();let task=tokio::spawn(async move{axum::serve(listener,axum::Router::new().fallback(||async{"proxy-fixture"})).await.unwrap()});
  let client=builder_for(ProxySettings{mode:"custom".into(),url:format!("http://{addr}")}).build().unwrap();assert_eq!(client.get("http://boxplayer-fixture.invalid/test").send().await.unwrap().text().await.unwrap(),"proxy-fixture");
  let direct=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let addr=direct.local_addr().unwrap();let direct_task=tokio::spawn(async move{axum::serve(direct,axum::Router::new().fallback(||async{"local-fixture"})).await.unwrap()});assert_eq!(client.get(format!("http://{addr}/test")).send().await.unwrap().text().await.unwrap(),"local-fixture");task.abort();direct_task.abort();
 }
 #[tokio::test]
 #[ignore="live no-credential connectivity check"]
 async fn dropbox_system_proxy_connectivity(){let response=client().unwrap().get("https://api.dropboxapi.com/oauth2/token").send().await.unwrap();assert!(response.status().is_client_error());}
}

#[tauri::command]
pub async fn network_proxy_test(proxy:ProxySettings)->Result<serde_json::Value,AppError>{proxy.validate()?;let client=builder_for(proxy).timeout(std::time::Duration::from_secs(15)).build().map_err(|_|AppError::new("PROXY_INVALID","无法创建代理连接",false))?;let started=std::time::Instant::now();let response=client.get("https://api.dropboxapi.com/oauth2/token").send().await.map_err(|_|AppError::new("PROXY_CONNECTION","无法连接 Dropbox，请检查网络与代理地址",true))?;if response.status().as_u16()!=404{return Err(AppError::new("PROXY_RESPONSE","Dropbox 连接返回异常响应",true))}Ok(serde_json::json!({"milliseconds":started.elapsed().as_millis()}))}
