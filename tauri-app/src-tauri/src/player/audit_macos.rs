//! Read-only debug probes, dispatched to AppKit's main thread. No screen settings are changed.
use objc2::{
    msg_send,
    runtime::{AnyClass, AnyObject, Bool},
};
use objc2_app_kit::{NSView, NSWindow};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    ffi::{c_char, c_void, CStr},
    fs::OpenOptions,
    io::Write,
    path::PathBuf,
};
use tauri::Manager;
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGColorSpaceCopyName(space: *const c_void) -> *const c_void;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFStringGetCString(
        string: *const c_void,
        buffer: *mut c_char,
        size: isize,
        encoding: u32,
    ) -> u8;
    fn CFRelease(object: *const c_void);
}
unsafe fn color_name(space: *const c_void) -> Option<String> {
    if space.is_null() {
        return None;
    }
    let name = CGColorSpaceCopyName(space);
    if name.is_null() {
        return None;
    }
    let mut buffer = [0i8; 512];
    let success = CFStringGetCString(name, buffer.as_mut_ptr(), buffer.len() as isize, 0x08000100);
    let result = if success != 0 {
        Some(
            CStr::from_ptr(buffer.as_ptr())
                .to_string_lossy()
                .into_owned(),
        )
    } else {
        None
    };
    CFRelease(name);
    result
}
unsafe fn layers(
    layer: *mut AnyObject,
    view_path: &str,
    depth: usize,
    visited: &mut HashSet<usize>,
    result: &mut Vec<Value>,
) {
    if layer.is_null() || depth > 12 || visited.len() >= 256 || !visited.insert(layer as usize) {
        return;
    }
    if let Some(metal) = AnyClass::get(c"CAMetalLayer") {
        let is_metal: Bool = msg_send![layer,isKindOfClass:metal];
        if is_metal.as_bool() {
            let edr: Bool = msg_send![layer, wantsExtendedDynamicRangeContent];
            let pixel_format: u64 = msg_send![layer, pixelFormat];
            let space: *const c_void = msg_send![layer, colorspace];
            let metadata: *mut AnyObject = msg_send![layer, EDRMetadata];
            result.push(json!({"viewPath":view_path,"layerClass":(&*layer).class().name().to_string_lossy(),"pixelFormat":pixel_format,"wantsEDR":edr.as_bool(),"colorSpace":color_name(space),"hasEDRMetadata":!metadata.is_null()}));
        }
    }
    let children: *mut AnyObject = msg_send![layer, sublayers];
    if !children.is_null() {
        let count: usize = msg_send![children, count];
        for i in 0..count.min(64) {
            let child: *mut AnyObject = msg_send![children,objectAtIndex:i];
            layers(child, view_path, depth + 1, visited, result);
        }
    }
}
unsafe fn views(
    view: &NSView,
    path: String,
    depth: usize,
    visited: &mut HashSet<usize>,
    result: &mut Vec<Value>,
) {
    if depth > 12 || visited.len() >= 256 {
        return;
    }
    let view_object = view as *const NSView as *mut AnyObject;
    let name = (&*view_object).class().name().to_string_lossy();
    let path = format!("{path}/{name}");
    let layer: *mut AnyObject = msg_send![view, layer];
    let children = view.subviews();
    for child in children.iter().take(64) {
        views(&child, path.clone(), depth + 1, visited, result);
    }
    layers(layer, &path, 0, visited, result);
}
pub(super) fn capture(
    app: &tauri::AppHandle,
    output: PathBuf,
    title: String,
    source_session: String,
) {
    let Some(window) = app.get_webview_window("player") else {
        return;
    };
    let cloned = window.clone();
    let _=window.run_on_main_thread(move || {
        let row=unsafe {
            let Some(ptr)=cloned.ns_window().ok() else { return };
            let window=&*(ptr as *const NSWindow);
            let Some(view)=window.contentView() else { return };
            let mut found=Vec::new(); let mut visited=HashSet::new();
            views(&view,String::new(),0,&mut visited,&mut found);
            let screen:*mut AnyObject=msg_send![window,screen];
            let display=if screen.is_null() { Value::Null } else {
                let current:f64=msg_send![screen,maximumExtendedDynamicRangeColorComponentValue];
                let potential:f64=msg_send![screen,maximumPotentialExtendedDynamicRangeColorComponentValue];
                let reference:f64=msg_send![screen,maximumReferenceExtendedDynamicRangeColorComponentValue];
                let scale:f64=msg_send![screen,backingScaleFactor];
                json!({"edrCurrent":current,"edrPotential":potential,"edrReference":reference,"scale":scale})
            };
            let bounds=view.bounds();
            json!({"kind":"native-surface","unixMs":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis(),"title":title,"sourceSession":source_session,"viewSize":[bounds.size.width,bounds.size.height],"screen":display,"metalLayers":found})
        };
        if let Ok(mut file)=OpenOptions::new().create(true).append(true).open(output) { let _=writeln!(file,"{}",row); }
    });
}
