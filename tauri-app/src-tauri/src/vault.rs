//! Small OS-vault entries protect versioned encrypted credential payloads.
//! This also avoids Windows Credential Manager's 2560-byte blob limit.
use crate::{accounts::Vault, settings::AppError};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use ring::{
    aead::{self, Aad, LessSafeKey, Nonce, UnboundKey},
    rand::{SecureRandom, SystemRandom},
};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
const SERVICE: &str = "com.boxplayer.migration.dev.accounts";
const PREFIX: &str = "boxplayer-vault-v1:";
fn unavailable() -> AppError {
    AppError::new(
        "CREDENTIAL_STORE",
        "系统凭据存储不可用或凭据内容无法验证",
        true,
    )
}
fn keyring_error(_: keyring::Error) -> AppError {
    unavailable()
}
fn cipher(key: &[u8]) -> Result<LessSafeKey, AppError> {
    Ok(LessSafeKey::new(
        UnboundKey::new(&aead::AES_256_GCM, key).map_err(|_| unavailable())?,
    ))
}
fn seal(key: &[u8], id: &str, value: &str) -> Result<Vec<u8>, AppError> {
    let mut nonce = [0; 12];
    SystemRandom::new()
        .fill(&mut nonce)
        .map_err(|_| unavailable())?;
    let mut data = value.as_bytes().to_vec();
    cipher(key)?
        .seal_in_place_append_tag(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(format!("{}:{}", SERVICE, id)),
            &mut data,
        )
        .map_err(|_| unavailable())?;
    let mut result = nonce.to_vec();
    result.extend(data);
    Ok(result)
}
fn open(key: &[u8], id: &str, mut data: Vec<u8>) -> Result<String, AppError> {
    if data.len() < 28 || data.len() > 2 * 1024 * 1024 {
        return Err(unavailable());
    }
    let nonce: [u8; 12] = data[..12].try_into().map_err(|_| unavailable())?;
    let plain = cipher(key)?
        .open_in_place(
            Nonce::assume_unique_for_key(nonce),
            Aad::from(format!("{}:{}", SERVICE, id)),
            &mut data[12..],
        )
        .map_err(|_| unavailable())?;
    String::from_utf8(plain.to_vec()).map_err(|_| unavailable())
}
/// Cache only within this native process, after the OS vault has authorized access.
/// Never persist plaintext or change the OS keychain access policy.
pub(crate) struct SessionVault {
    inner: Box<dyn Vault>,
    values: std::sync::Mutex<std::collections::HashMap<String,String>>,
}
impl SessionVault {
    pub(crate) fn new(inner:Box<dyn Vault>)->Self{Self{inner,values:Default::default()}}
}
impl Vault for SessionVault {
    fn get(&self,id:&str)->Result<String,AppError>{
        // Coalesce concurrent reads so one slot does not trigger parallel OS prompts.
        let mut values=self.values.lock().map_err(|_|unavailable())?;
        if let Some(value)=values.get(id){return Ok(value.clone())}
        let value=self.inner.get(id)?;values.insert(id.into(),value.clone());Ok(value)
    }
    fn put(&self,id:&str,value:&str)->Result<(),AppError>{
        let mut values=self.values.lock().map_err(|_|unavailable())?;
        values.remove(id);self.inner.put(id,value)?;values.insert(id.into(),value.into());Ok(())
    }
    fn remove(&self,id:&str)->Result<(),AppError>{
        let mut values=self.values.lock().map_err(|_|unavailable())?;
        values.remove(id);self.inner.remove(id)
    }
}
// File-based macOS keychains do not reliably honor per-query no-UI flags.
// Serialize our OS-vault calls and restore this process's previous setting afterward.
#[cfg(target_os="macos")]
mod noninteractive {
    use super::*;
    static ACCESS:std::sync::Mutex<()>=std::sync::Mutex::new(());
    #[link(name="Security",kind="framework")]
    unsafe extern "C" {
        fn SecKeychainGetUserInteractionAllowed(allowed:*mut u8)->i32;
        fn SecKeychainSetUserInteractionAllowed(allowed:u8)->i32;
    }
    pub(super) fn run<T>(work:impl FnOnce()->Result<T,AppError>)->Result<T,AppError>{
        let _lock=ACCESS.lock().map_err(|_|unavailable())?;
        let mut previous=0u8;
        if unsafe{SecKeychainGetUserInteractionAllowed(&mut previous)}!=0||unsafe{SecKeychainSetUserInteractionAllowed(0)}!=0{return Err(unavailable())}
        struct Restore(u8);
        impl Drop for Restore{fn drop(&mut self){unsafe{SecKeychainSetUserInteractionAllowed(self.0)};}}
        let _restore=Restore(previous);
        work()
    }
    #[cfg(test)]mod tests{
        use super::*;
        #[test]fn suppresses_ui_during_vault_access_and_restores_previous_policy_on_error(){
            let mut before=0;assert_eq!(unsafe{SecKeychainGetUserInteractionAllowed(&mut before)},0);
            let result:Result<(),AppError>=run(||{let mut during=1;assert_eq!(unsafe{SecKeychainGetUserInteractionAllowed(&mut during)},0);assert_eq!(during,0);Err(unavailable())});assert!(result.is_err());
            let mut after=0;assert_eq!(unsafe{SecKeychainGetUserInteractionAllowed(&mut after)},0);assert_eq!(before,after);
        }
    }
}
fn without_vault_ui<T>(work:impl FnOnce()->Result<T,AppError>)->Result<T,AppError>{
    #[cfg(target_os="macos")] {noninteractive::run(work)}
    #[cfg(not(target_os="macos"))] {work()}
}
fn read_error(error:keyring::Error)->AppError{
    #[cfg(target_os="macos")]
    {let _=error;AppError::new("CREDENTIAL_RELOGIN","无法静默读取此来源的登录凭据，请在应用中重新登录此来源",false)}
    #[cfg(not(target_os="macos"))]
    {keyring_error(error)}
}
pub struct SystemVault {
    directory: PathBuf,
}
impl SystemVault {
    pub fn new(directory: &Path) -> Result<Self, AppError> {
        let directory = directory.join("credential-payloads");
        std::fs::create_dir_all(&directory).map_err(AppError::io)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
                .map_err(AppError::io)?;
        }
        Ok(Self { directory })
    }
    fn entry(id: &str) -> Result<keyring::Entry, AppError> {
        keyring::Entry::new(SERVICE, id).map_err(keyring_error)
    }
    fn marker(&self, value: &str) -> Result<Option<(PathBuf, Vec<u8>)>, AppError> {
        let Some(value) = value.strip_prefix(PREFIX) else {
            return Ok(None);
        };
        let (file, key) = value.split_once(':').ok_or_else(unavailable)?;
        let file = uuid::Uuid::parse_str(file).map_err(|_| unavailable())?;
        let key = URL_SAFE_NO_PAD.decode(key).map_err(|_| unavailable())?;
        if key.len() != 32 {
            return Err(unavailable());
        }
        Ok(Some((self.directory.join(format!("{}.bin", file)), key)))
    }
}
impl SystemVault {
    fn put_inner(&self, id: &str, value: &str) -> Result<(), AppError> {
        if value.len() > 1024 * 1024 {
            return Err(unavailable());
        }
        let entry = Self::entry(id)?;
        let previous = match entry.get_password() {
            Ok(value) => self.marker(&value)?,
            Err(keyring::Error::NoEntry) => None,
            Err(e) => return Err(keyring_error(e)),
        };
        let mut key = [0; 32];
        SystemRandom::new()
            .fill(&mut key)
            .map_err(|_| unavailable())?;
        let encrypted = seal(&key, id, value)?;
        let file_id = uuid::Uuid::new_v4();
        let target = self.directory.join(format!("{}.bin", file_id));
        let mut file = tempfile::NamedTempFile::new_in(&self.directory).map_err(AppError::io)?;
        file.write_all(&encrypted).map_err(AppError::io)?;
        file.as_file().sync_all().map_err(AppError::io)?;
        file.persist(&target).map_err(|_| unavailable())?;
        let marker = format!("{}{}:{}", PREFIX, file_id, URL_SAFE_NO_PAD.encode(key));
        if let Err(e) = entry.set_password(&marker) {
            let _ = std::fs::remove_file(&target);
            return Err(keyring_error(e));
        }
        if let Some((path, _)) = previous {
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }
    fn get_inner(&self, id: &str) -> Result<String, AppError> {
        let value = Self::entry(id)?.get_password().map_err(read_error)?;
        match self.marker(&value)? {
            Some((path, key)) => open(&key, id, std::fs::read(path).map_err(|_| unavailable())?),
            None => Ok(value),
        } // M3 early development vault entries remain readable.
    }
    fn remove_inner(&self, id: &str) -> Result<(), AppError> {
        let entry = Self::entry(id)?;
        let value = match entry.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Ok(()),
            Err(e) => return Err(keyring_error(e)),
        };
        let payload = self.marker(&value).unwrap_or(None);
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(e) => return Err(keyring_error(e)),
        }
        if let Some((path, _)) = payload {
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }
}
impl Vault for SystemVault {
    fn put(&self,id:&str,value:&str)->Result<(),AppError>{without_vault_ui(||self.put_inner(id,value))}
    fn get(&self,id:&str)->Result<String,AppError>{without_vault_ui(||self.get_inner(id))}
    fn remove(&self,id:&str)->Result<(),AppError>{without_vault_ui(||self.remove_inner(id))}
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_payload_is_encrypted_and_bound_to_slot_and_detects_tampering() {
        let key = [7; 32];
        let value = "synthetic-cookie-payload".repeat(1000);
        let data = seal(&key, "slot-a", &value).unwrap();
        assert_ne!(&data[12..40], &value.as_bytes()[..28]);
        assert_eq!(open(&key, "slot-a", data.clone()).unwrap(), value);
        assert!(open(&key, "slot-b", data.clone()).is_err());
        let mut changed = data.clone();
        changed[20] ^= 1;
        assert!(open(&key, "slot-a", changed).is_err());
        assert_ne!(data, seal(&key, "slot-a", &value).unwrap());
    }
}

#[cfg(test)]mod session_tests{
 use super::*;
 use std::sync::{Arc,Mutex,atomic::{AtomicUsize,AtomicBool,Ordering}};
 #[derive(Default)]struct Fixture{values:Mutex<std::collections::HashMap<String,String>>,reads:AtomicUsize,fail:AtomicBool}
 struct Store(Arc<Fixture>);
 impl Vault for Store{
  fn get(&self,id:&str)->Result<String,AppError>{self.0.reads.fetch_add(1,Ordering::SeqCst);if self.0.fail.load(Ordering::SeqCst){return Err(unavailable())}self.0.values.lock().unwrap().get(id).cloned().ok_or_else(unavailable)}
  fn put(&self,id:&str,value:&str)->Result<(),AppError>{if self.0.fail.load(Ordering::SeqCst){return Err(unavailable())}self.0.values.lock().unwrap().insert(id.into(),value.into());Ok(())}
  fn remove(&self,id:&str)->Result<(),AppError>{if self.0.fail.load(Ordering::SeqCst){return Err(unavailable())}self.0.values.lock().unwrap().remove(id);Ok(())}
 }
 fn fixture()->(Arc<Fixture>,SessionVault){let fixture=Arc::new(Fixture::default());fixture.values.lock().unwrap().insert("slot".into(),"fixture-secret".into());(fixture.clone(),SessionVault::new(Box::new(Store(fixture))))}
 #[test]fn concurrent_requests_authorize_once_per_native_session(){let (state,vault)=fixture();let vault=Arc::new(vault);let workers:Vec<_>=(0..12).map(|_|{let vault=vault.clone();std::thread::spawn(move||assert_eq!(vault.get("slot").unwrap(),"fixture-secret"))}).collect();for worker in workers{worker.join().unwrap()}assert_eq!(state.reads.load(Ordering::SeqCst),1);let next=SessionVault::new(Box::new(Store(state.clone())));assert_eq!(next.get("slot").unwrap(),"fixture-secret");assert_eq!(state.reads.load(Ordering::SeqCst),2);}
 #[test]fn denied_reads_are_not_cached(){let (state,vault)=fixture();state.fail.store(true,Ordering::SeqCst);assert!(vault.get("slot").is_err());state.fail.store(false,Ordering::SeqCst);assert_eq!(vault.get("slot").unwrap(),"fixture-secret");assert_eq!(state.reads.load(Ordering::SeqCst),2);}
 #[test]fn refresh_and_logout_do_not_leave_stale_cached_credentials(){let (_,vault)=fixture();assert_eq!(vault.get("slot").unwrap(),"fixture-secret");vault.put("slot","refreshed").unwrap();assert_eq!(vault.get("slot").unwrap(),"refreshed");vault.remove("slot").unwrap();assert!(vault.get("slot").is_err());}
 #[test]fn failed_writes_or_deletions_invalidate_cached_values(){let (state,vault)=fixture();vault.get("slot").unwrap();state.fail.store(true,Ordering::SeqCst);assert!(vault.put("slot","new").is_err());assert!(vault.get("slot").is_err());state.fail.store(false,Ordering::SeqCst);vault.get("slot").unwrap();state.fail.store(true,Ordering::SeqCst);assert!(vault.remove("slot").is_err());assert!(vault.get("slot").is_err());}
}
