//! Clear stale HDR metadata only on mpv's owned video layer after SDR restoration.
use objc2::{
    msg_send,
    runtime::{AnyObject, Bool},
};
use objc2_app_kit::{NSView, NSWindow};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tauri::Manager;
unsafe fn clear(view: &NSView, depth: usize) -> (usize, bool) {
    if depth > 12 {
        return (0, false);
    }
    let object = view as *const NSView as *mut AnyObject;
    let view_name = (&*object).class().name().to_string_lossy();
    let layer: *mut AnyObject = msg_send![view, layer];
    let mut found = 0;
    let mut waiting = false;
    // The pinned mpv Swift backend owns View + MetalLayer. Never modify WKWebView layers.
    if view_name.ends_with(".View")
        && !layer.is_null()
        && (&*layer)
            .class()
            .name()
            .to_string_lossy()
            .ends_with(".MetalLayer")
    {
        found += 1;
        let edr: Bool = msg_send![layer, wantsExtendedDynamicRangeContent];
        if edr.as_bool() {
            waiting = true;
        } else {
            let metadata: *mut AnyObject = msg_send![layer, EDRMetadata];
            if !metadata.is_null() {
                let _: () = msg_send![layer,setEDRMetadata:std::ptr::null_mut::<AnyObject>()];
            }
        }
    }
    for child in view.subviews().iter().take(64) {
        let (n, w) = clear(&child, depth + 1);
        found += n;
        waiting |= w;
    }
    (found, waiting)
}
pub(super) fn clear_sdr_metadata(app: &tauri::AppHandle, done: Arc<AtomicBool>) {
    let Some(window) = app.get_webview_window("player") else {
        return;
    };
    let cloned = window.clone();
    let _ = window.run_on_main_thread(move || unsafe {
        let Some(ptr) = cloned.ns_window().ok() else {
            return;
        };
        let Some(view) = (&*(ptr as *const NSWindow)).contentView() else {
            return;
        };
        let (found, waiting) = clear(&view, 0);
        if found > 0 && !waiting {
            done.store(true, Ordering::Release);
        }
    });
}
