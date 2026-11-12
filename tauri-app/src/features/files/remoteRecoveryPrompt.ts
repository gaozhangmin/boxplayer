import {Modal} from '@arco-design/web-vue'
import {recoverRemoteOperations,type RemoteRecoveryConflict} from './remoteRecovery'
import type {FilePreferences} from './preferences'

export function confirmRemotePreferenceRestore(conflict:RemoteRecoveryConflict):Promise<boolean>{
 return new Promise(resolve=>{
  Modal.confirm({
   title:'恢复文件收藏',
   content:conflict.corruptStorage
    ?'文件已移动，但保存的收藏设置无法读取。恢复前会备份当前设置，再恢复移动后的收藏。'
    :'文件已移动，但收藏设置之后又有更改。恢复前会备份当前设置，再用移动完成时的收藏设置替换这些更改。',
   okText:'备份并恢复',cancelText:'稍后',closable:false,maskClosable:false,escToClose:false,
   onOk:()=>{resolve(true)},onCancel:()=>{resolve(false)}
  })
 })
}
export function recoverRemoteOperationsWithPrompt(store:{preferences:FilePreferences}){
 return recoverRemoteOperations(store,confirmRemotePreferenceRestore)
}
