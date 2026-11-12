//! Read-only system pickers for the retained file-browser transfer entries.
//! Execution and durable tasks belong to M6; this module never transfers bytes.
use crate::settings::AppError;
use serde::Deserialize;
use tauri_plugin_dialog::DialogExt;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferSelection { Files, Folders, Destination }

#[tauri::command]
pub async fn choose_transfer_paths(app:tauri::AppHandle,window:tauri::Window,kind:TransferSelection)->Result<Vec<String>,AppError>{
 if window.label()!="main" {return Err(AppError::new("TRANSFER_PICKER","只能从主窗口选择传输文件",false))}
 tauri::async_runtime::spawn_blocking(move||{
  let dialog=app.dialog().file();
  let files=match kind {
   TransferSelection::Files=>dialog.set_title("选择多个文件上传到网盘").blocking_pick_files(),
   TransferSelection::Folders=>dialog.set_title("选择多个文件夹上传到网盘").blocking_pick_folders(),
   TransferSelection::Destination=>dialog.set_title("选择一个文件夹，把所有文件下载到此文件夹内").blocking_pick_folder().map(|file|vec![file]),
  };
  files.unwrap_or_default().into_iter().map(|file|file.into_path().map(|path|path.to_string_lossy().into_owned()).map_err(|_|AppError::new("TRANSFER_PICKER","请选择本机路径",false))).collect()
 }).await.map_err(|_|AppError::new("TRANSFER_PICKER","无法打开文件选择窗口",true))?
}
