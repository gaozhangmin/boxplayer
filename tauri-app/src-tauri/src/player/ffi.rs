// libmpv C ABI and ownership adapted from FengZeng/soia baec808 mpv/{ffi,handle}.rs.
// GPL-3.0-only. No soia_utils, private protocol callback, or authentication service.
use crate::settings::AppError;
use libloading::Library;
use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    path::Path,
};
#[repr(C)]
pub struct Event {
    pub id: c_int,
    pub error: c_int,
    pub userdata: u64,
    pub data: *mut c_void,
}
#[repr(C)]
pub struct EndFile {
    pub reason: c_int,
    pub error: c_int,
    pub playlist_entry_id: i64,
    pub playlist_insert_id: i64,
    pub playlist_insert_num_entries: c_int,
}
#[repr(C)]
union Value {
    string: *mut c_char,
    flag: c_int,
    int64: i64,
    double: f64,
    list: *mut NodeList,
}
#[repr(C)]
struct Node {
    value: Value,
    format: c_int,
}
#[repr(C)]
struct NodeList {
    num: c_int,
    values: *mut Node,
    keys: *mut *mut c_char,
}
type Create = unsafe extern "C" fn() -> *mut c_void;
type Init = unsafe extern "C" fn(*mut c_void) -> c_int;
type Set = unsafe extern "C" fn(*mut c_void, *const c_char, *const c_char) -> c_int;
type Command = unsafe extern "C" fn(*mut c_void, *const *const c_char) -> c_int;
type Get = unsafe extern "C" fn(*mut c_void, *const c_char, c_int, *mut c_void) -> c_int;
type GetString = unsafe extern "C" fn(*mut c_void, *const c_char) -> *mut c_char;
type Wait = unsafe extern "C" fn(*mut c_void, f64) -> *mut Event;
type Destroy = unsafe extern "C" fn(*mut c_void);
type Free = unsafe extern "C" fn(*mut c_void);
type FreeNode = unsafe extern "C" fn(*mut Node);
pub struct Mpv {
    ctx: *mut c_void,
    set: Set,
    command: Command,
    get: Get,
    get_string: GetString,
    wait: Wait,
    destroy: Destroy,
    free: Free,
    free_node: FreeNode,
    _library: Library,
}
fn error() -> AppError {
    AppError::new(
        "MPV_ERROR",
        "libmpv could not execute the playback operation",
        true,
    )
}
fn c(value: &str) -> Result<CString, AppError> {
    CString::new(value).map_err(|_| AppError::new("MPV_INPUT", "Invalid player input", false))
}
impl Mpv {
    pub fn new(runtime: &Path, host: Option<usize>) -> Result<Self, AppError> {
        unsafe {
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr());
            #[cfg(target_os = "macos")]
            let name = "libmpv.dylib";
            #[cfg(target_os = "windows")]
            let name = "libmpv-2.dll";
            #[cfg(target_os = "linux")]
            let name = "libmpv.so.2";
            let library = Library::new(runtime.join(name)).map_err(|_| {
                AppError::new(
                    "MPV_RUNTIME",
                    "Unable to load libmpv; prepare the platform runtime before playing",
                    false,
                )
            })?;
            let create: Create = *library.get(b"mpv_create\0").map_err(|_| error())?;
            let init: Init = *library.get(b"mpv_initialize\0").map_err(|_| error())?;
            // Resolve all symbols before creating a handle so a missing symbol cannot leak it.
            let ctx = std::ptr::null_mut();
            let mut mpv = Self {
                ctx,
                set: *library
                    .get(b"mpv_set_property_string\0")
                    .map_err(|_| error())?,
                command: *library.get(b"mpv_command\0").map_err(|_| error())?,
                get: *library.get(b"mpv_get_property\0").map_err(|_| error())?,
                get_string: *library
                    .get(b"mpv_get_property_string\0")
                    .map_err(|_| error())?,
                wait: *library.get(b"mpv_wait_event\0").map_err(|_| error())?,
                destroy: *library
                    .get(b"mpv_terminate_destroy\0")
                    .map_err(|_| error())?,
                free: *library.get(b"mpv_free\0").map_err(|_| error())?,
                free_node: *library
                    .get(b"mpv_free_node_contents\0")
                    .map_err(|_| error())?,
                _library: library,
            };
            mpv.ctx = create();
            if mpv.ctx.is_null() {
                return Err(error());
            }
            let ctx = mpv.ctx;
            let set_option: Set = *mpv
                ._library
                .get(b"mpv_set_option_string\0")
                .map_err(|_| error())?;
            let mut options = vec![
                ("config", "no".to_string()),
                ("load-scripts", "no".into()),
                ("osc", "no".into()),
                ("input-default-bindings", "no".into()),
                ("input-media-keys", "no".into()),
                ("terminal", "no".into()),
                ("msg-level", "all=no".into()),
                ("idle", "yes".into()),
                ("keep-open", "yes".into()),
                ("pause", "yes".into()),
                ("volume", "70".into()),
                ("hwdec", "auto-safe".into()),
            ];
            if let Some(host) = host {
                options.extend([
                    ("wid", host.to_string()),
                    ("vo", "gpu-next".into()),
                    ("force-window", "yes".into()),
                ]);
            } else {
                options.extend([("vo", "null".into()), ("ao", "null".into())]);
            }
            for (key, value) in options {
                if set_option(ctx, c(key)?.as_ptr(), c(&value)?.as_ptr()) < 0 {
                    return Err(error());
                }
            }
            if init(ctx) < 0 {
                return Err(error());
            }
            mpv.set("pause", "yes")?;
            Ok(mpv)
        }
    }
    /// Independent software-only client; never changes the playback client or global locale.
    pub fn thumbnail(runtime: &Path) -> Result<Self, AppError> {
        Self::thumbnail_config(runtime, false)
    }
    /// Only for validated loopback gateway URLs in thumbnail::extract_remote.
    pub(super) fn thumbnail_gateway(runtime: &Path) -> Result<Self, AppError> {
        Self::thumbnail_config(runtime, true)
    }
    fn thumbnail_config(runtime: &Path, gateway: bool) -> Result<Self, AppError> {
        unsafe {
            #[cfg(target_os = "macos")]
            let name = "libmpv.dylib";
            #[cfg(target_os = "windows")]
            let name = "libmpv-2.dll";
            #[cfg(target_os = "linux")]
            let name = "libmpv.so.2";
            let library = Library::new(runtime.join(name)).map_err(|_| {
                AppError::new(
                    "MPV_RUNTIME",
                    "Unable to load libmpv; prepare the platform runtime before playing",
                    false,
                )
            })?;
            let create: Create = *library.get(b"mpv_create\0").map_err(|_| error())?;
            let init: Init = *library.get(b"mpv_initialize\0").map_err(|_| error())?;
            // Resolve all symbols before creating a handle so a missing symbol cannot leak it.
            let ctx = std::ptr::null_mut();
            let mut mpv = Self {
                ctx,
                set: *library
                    .get(b"mpv_set_property_string\0")
                    .map_err(|_| error())?,
                command: *library.get(b"mpv_command\0").map_err(|_| error())?,
                get: *library.get(b"mpv_get_property\0").map_err(|_| error())?,
                get_string: *library
                    .get(b"mpv_get_property_string\0")
                    .map_err(|_| error())?,
                wait: *library.get(b"mpv_wait_event\0").map_err(|_| error())?,
                destroy: *library
                    .get(b"mpv_terminate_destroy\0")
                    .map_err(|_| error())?,
                free: *library.get(b"mpv_free\0").map_err(|_| error())?,
                free_node: *library
                    .get(b"mpv_free_node_contents\0")
                    .map_err(|_| error())?,
                _library: library,
            };
            mpv.ctx = create();
            if mpv.ctx.is_null() {
                return Err(error());
            }
            let ctx = mpv.ctx;
            let set_option: Set = *mpv
                ._library
                .get(b"mpv_set_option_string\0")
                .map_err(|_| error())?;
            let options = [
                ("config", "no"),
                ("load-scripts", "no"),
                ("osc", "no"),
                ("input-default-bindings", "no"),
                ("input-media-keys", "no"),
                ("terminal", "no"),
                ("msg-level", "all=no"),
                ("idle", "yes"),
                ("keep-open", "yes"),
                ("pause", "yes"),
                ("vo", "null"),
                ("ao", "null"),
                ("audio", "no"),
                ("sid", "no"),
                ("sub-auto", "no"),
                ("audio-file-auto", "no"),
                ("autoload-files", "no"),
                ("hwdec", "no"),
                ("force-window", "no"),
                ("screenshot-sw", "yes"),
                ("screenshot-high-bit-depth", "no"),
                ("screenshot-png-compression", "7"),
                ("vf", "lavfi=[scale=320:320:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1]"),
                ("access-references", "no"),
                ("network-timeout", "8"),
                ("demuxer-lavf-o", if gateway { "protocol_whitelist=%8%http,tcp" } else { "protocol_whitelist=file" }),
            ];
            for (key, value) in options {
                if set_option(ctx, c(key)?.as_ptr(), c(&value)?.as_ptr()) < 0 {
                    return Err(AppError::new(
                        "THUMBNAIL_OPTION",
                        format!("Unsupported thumbnail option: {key}"),
                        false,
                    ));
                }
            }
            if init(ctx) < 0 {
                return Err(error());
            }
            mpv.set("pause", "yes")?;
            Ok(mpv)
        }
    }
    pub fn set(&mut self, key: &str, value: &str) -> Result<(), AppError> {
        let status = unsafe { (self.set)(self.ctx, c(key)?.as_ptr(), c(value)?.as_ptr()) };
        if status < 0 {
            Err(error())
        } else {
            Ok(())
        }
    }
    pub fn command(&mut self, args: &[&str]) -> Result<(), AppError> {
        let args = args.iter().map(|v| c(v)).collect::<Result<Vec<_>, _>>()?;
        let mut ptrs = args.iter().map(|v| v.as_ptr()).collect::<Vec<_>>();
        ptrs.push(std::ptr::null());
        if unsafe { (self.command)(self.ctx, ptrs.as_ptr()) } < 0 {
            Err(error())
        } else {
            Ok(())
        }
    }
    pub fn number(&self, key: &str) -> Option<f64> {
        let mut value: f64 = 0.0;
        let key = c(key).ok()?;
        if unsafe { (self.get)(self.ctx, key.as_ptr(), 5, (&mut value as *mut f64).cast()) } >= 0
            && value.is_finite()
        {
            Some(value)
        } else {
            None
        }
    }
    pub fn flag(&self, key: &str) -> Option<bool> {
        let mut value = 0;
        let key = c(key).ok()?;
        if unsafe { (self.get)(self.ctx, key.as_ptr(), 3, (&mut value as *mut c_int).cast()) } >= 0
        {
            Some(value != 0)
        } else {
            None
        }
    }
    pub fn string(&self, key: &str) -> Option<String> {
        unsafe {
            let value = (self.get_string)(self.ctx, c(key).ok()?.as_ptr());
            if value.is_null() {
                return None;
            }
            let result = CStr::from_ptr(value).to_string_lossy().into_owned();
            (self.free)(value.cast());
            Some(result)
        }
    }
    pub fn json(&self, key: &str) -> Option<serde_json::Value> {
        unsafe {
            let mut node = Node {
                value: Value { int64: 0 },
                format: 0,
            };
            if (self.get)(
                self.ctx,
                c(key).ok()?.as_ptr(),
                6,
                (&mut node as *mut Node).cast(),
            ) < 0
            {
                return None;
            }
            let value = node_value(&node, 0);
            (self.free_node)(&mut node);
            Some(value)
        }
    }
    // The returned pointer is only valid until the next wait_event on this client.
    pub fn wait(&mut self, timeout: f64) -> *mut Event {
        unsafe { (self.wait)(self.ctx, timeout) }
    }
}
impl Drop for Mpv {
    fn drop(&mut self) {
        unsafe { (self.destroy)(self.ctx) }
    }
}
unsafe fn node_value(node: &Node, depth: usize) -> serde_json::Value {
    if depth > 8 {
        return serde_json::Value::Null;
    }
    match node.format {
        1 => {
            if node.value.string.is_null() {
                serde_json::Value::Null
            } else {
                CStr::from_ptr(node.value.string)
                    .to_string_lossy()
                    .into_owned()
                    .into()
            }
        }
        3 => (node.value.flag != 0).into(),
        4 => node.value.int64.into(),
        5 => serde_json::json!(node.value.double),
        7 | 8 => {
            if node.value.list.is_null() {
                return serde_json::Value::Null;
            }
            let list = &*node.value.list;
            if list.num < 0 || list.num > 10000 || list.values.is_null() {
                return serde_json::Value::Null;
            }
            let values = std::slice::from_raw_parts(list.values, list.num as usize);
            if node.format == 7 {
                serde_json::Value::Array(values.iter().map(|v| node_value(v, depth + 1)).collect())
            } else {
                let mut map = serde_json::Map::new();
                if !list.keys.is_null() {
                    for (i, value) in values.iter().enumerate() {
                        let key = *list.keys.add(i);
                        if !key.is_null() {
                            map.insert(
                                CStr::from_ptr(key).to_string_lossy().into_owned(),
                                node_value(value, depth + 1),
                            );
                        }
                    }
                }
                map.into()
            }
        }
        _ => serde_json::Value::Null,
    }
}
