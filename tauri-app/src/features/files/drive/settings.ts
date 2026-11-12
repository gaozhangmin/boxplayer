import { reactive } from 'vue'
import { Message } from '@arco-design/web-vue'
const key='tauri.driveSettings'
// Defaults copied from Electron src/setting/settingstore.ts; secrets are never persisted here.
const defaults=()=>({downSavePath:'',downUploadWhatExist:'refuse',uiAutoPlaycursorVideo:true,uiShareDays:'always',uiSharePassword:'random',uiShareFormate:'「NAME」URL\n提取码: PWD',uiShowPanPath:true,uiShowPanMedia:false,uiFileListMode:'list',uiTimeFolderFormate:'yyyy-MM-dd HH-mm-ss',uiTimeFolderIndex:1,uiFolderPreviewEnabled:true,uiFolderPreviewAutoHide:6,uiFolderSize:true,securityHideBackupDrive:false,securityHideResourceDrive:false,securityHidePicDrive:true,securityPassword:'',securityPasswordConfirm:false,uiFileListShowFileSize:true,uiFileColorArray:[{key:'#df5659',title:'鹅冠红'},{key:'#9c27b0',title:'兰花紫'},{key:'#42a5f5',title:'晴空蓝'},{key:'#00bc99',title:'竹叶青'},{key:'#4caf50',title:'宝石绿'},{key:'#ff9800',title:'金盏黄'}]})
export function createDriveSettings(){
 const initial=defaults()
 try{
  const saved=JSON.parse(localStorage.getItem(key)||'{}')
  if(typeof saved.downSavePath==='string'&&saved.downSavePath.length<=32768&&!/[\u0000-\u001f]/.test(saved.downSavePath))initial.downSavePath=saved.downSavePath
  if(['ignore','overwrite','auto_rename','refuse'].includes(saved.downUploadWhatExist))initial.downUploadWhatExist=saved.downUploadWhatExist
  if(['list','image','bigimage'].includes(saved.uiFileListMode))initial.uiFileListMode=saved.uiFileListMode
  if(typeof saved.uiAutoPlaycursorVideo==='boolean')initial.uiAutoPlaycursorVideo=saved.uiAutoPlaycursorVideo
  if(typeof saved.uiFolderSize==='boolean')initial.uiFolderSize=saved.uiFolderSize
  if(typeof saved.uiFolderPreviewEnabled==='boolean')initial.uiFolderPreviewEnabled=saved.uiFolderPreviewEnabled
  if(Number.isFinite(saved.uiFolderPreviewAutoHide)&&saved.uiFolderPreviewAutoHide>=0&&saved.uiFolderPreviewAutoHide<=3600)initial.uiFolderPreviewAutoHide=saved.uiFolderPreviewAutoHide
  if(typeof saved.uiShowPanPath==='boolean')initial.uiShowPanPath=saved.uiShowPanPath
  if(typeof saved.uiTimeFolderFormate==='string'&&saved.uiTimeFolderFormate.length>0&&saved.uiTimeFolderFormate.length<=160)initial.uiTimeFolderFormate=saved.uiTimeFolderFormate
  if(Number.isSafeInteger(saved.uiTimeFolderIndex)&&saved.uiTimeFolderIndex>=1&&saved.uiTimeFolderIndex<1000000000)initial.uiTimeFolderIndex=saved.uiTimeFolderIndex
  if(Array.isArray(saved.uiFileColorArray)&&saved.uiFileColorArray.length<=64&&saved.uiFileColorArray.every((item:unknown)=>!!item&&typeof item==='object'&&/^#[0-9a-f]{6}$/i.test(String((item as {key?:unknown}).key))&&typeof (item as {title?:unknown}).title==='string'))initial.uiFileColorArray=saved.uiFileColorArray
 }catch{}
 const state=reactive(initial)
 return Object.assign(state,{updateStore(patch:Partial<typeof initial>){
  Object.assign(state,patch)
  try{localStorage.setItem(key,JSON.stringify({downSavePath:state.downSavePath,downUploadWhatExist:state.downUploadWhatExist,uiAutoPlaycursorVideo:state.uiAutoPlaycursorVideo,uiShowPanPath:state.uiShowPanPath,uiFolderSize:state.uiFolderSize,uiFolderPreviewEnabled:state.uiFolderPreviewEnabled,uiFolderPreviewAutoHide:state.uiFolderPreviewAutoHide,uiFileListMode:state.uiFileListMode,uiTimeFolderFormate:state.uiTimeFolderFormate,uiTimeFolderIndex:state.uiTimeFolderIndex,uiFileColorArray:state.uiFileColorArray}))}
  catch{Message.warning('无法保存文件浏览设置，当前设置仅在本次会话有效')}
 }})
}
