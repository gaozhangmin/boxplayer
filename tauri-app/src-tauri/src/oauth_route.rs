//! Temporarily route a registered OAuth scheme to this development app on macOS.
//! Restore the previous handler after completion/cancel; never expose callback payloads.
use crate::settings::AppError;
#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use std::{
        ffi::{c_void, CString},
        ptr,
    };
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(
            allocator: *const c_void,
            value: *const i8,
            encoding: u32,
        ) -> *const c_void;
        fn CFStringGetCString(
            value: *const c_void,
            buffer: *mut i8,
            size: isize,
            encoding: u32,
        ) -> u8;
        fn CFRelease(value: *const c_void);
    }
    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSCopyDefaultHandlerForURLScheme(scheme: *const c_void) -> *const c_void;
        fn LSSetDefaultHandlerForURLScheme(scheme: *const c_void, bundle: *const c_void) -> i32;
    }
    struct Text(*const c_void);
    impl Text {
        fn new(value: &str) -> Result<Self, AppError> {
            let value = CString::new(value).map_err(|_| failure())?;
            let ptr = unsafe { CFStringCreateWithCString(ptr::null(), value.as_ptr(), 0x08000100) };
            if ptr.is_null() {
                Err(failure())
            } else {
                Ok(Self(ptr))
            }
        }
    }
    impl Drop for Text {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0) }
        }
    }
    fn failure() -> AppError {
        AppError::new(
            "OAUTH_HANDLER",
            "无法临时设置登录回调，请使用打包后的开发应用",
            false,
        )
    }
    fn current(scheme: &str) -> Result<Option<String>, AppError> {
        let scheme = Text::new(scheme)?;
        let ptr = unsafe { LSCopyDefaultHandlerForURLScheme(scheme.0) };
        if ptr.is_null() {
            return Ok(None);
        }
        let value = Text(ptr);
        let mut buffer = [0i8; 4096];
        if unsafe {
            CFStringGetCString(
                value.0,
                buffer.as_mut_ptr(),
                buffer.len() as isize,
                0x08000100,
            )
        } == 0
        {
            return Err(failure());
        }
        Ok(Some(
            unsafe { std::ffi::CStr::from_ptr(buffer.as_ptr()) }
                .to_string_lossy()
                .into_owned(),
        ))
    }
    fn set(scheme: &str, bundle: &str) -> Result<(), AppError> {
        let scheme = Text::new(scheme)?;
        let bundle = Text::new(bundle)?;
        if unsafe { LSSetDefaultHandlerForURLScheme(scheme.0, bundle.0) } != 0 {
            return Err(failure());
        }
        Ok(())
    }
    pub struct Route {
        scheme: String,
        previous: Option<String>,
        bundle: String,
    }
    impl Route {
        pub fn new(app: &tauri::AppHandle, scheme: &str) -> Result<Self, AppError> {
            let previous = current(scheme)?;
            let bundle = app.config().identifier.clone();
            set(scheme, &bundle)?;
            Ok(Self {
                scheme: scheme.into(),
                previous,
                bundle,
            })
        }
    }
    impl Drop for Route {
        fn drop(&mut self) {
            if current(&self.scheme).ok().flatten().as_deref() == Some(&self.bundle) {
                if let Some(previous) = &self.previous {
                    let _ = set(&self.scheme, previous);
                }
            }
        }
    }
}
#[cfg(target_os = "macos")]
pub use mac::Route;
#[cfg(not(target_os = "macos"))]
pub struct Route;
#[cfg(not(target_os = "macos"))]
impl Route {
    pub fn new(_app: &tauri::AppHandle, _scheme: &str) -> Result<Self, AppError> {
        Ok(Self)
    }
}
