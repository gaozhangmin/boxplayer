import {Message} from '@arco-design/web-vue'
import {getDrivePane} from './ports'
export const message={
 error:(content:string,...args:unknown[])=>Message.error({content,id:typeof args[1]==='string'?args[1]:undefined}),
 success:(content:string,duration=3,id?:string)=>Message.success({content,duration:duration*1000,id}),
 warning:(content:string)=>Message.warning(content),
 loading:(content:string,duration=3,id?:string)=>Message.loading({content,duration:duration*1000,id})
}
export const DebugLog={mSaveDanger(_message:string,_cause:unknown){/* The operation host displays failures; do not log provider bodies. */}}
export const Sleep=(duration:number)=>new Promise<void>(resolve=>setTimeout(resolve,duration))
const excluded=async(..._args:unknown[]):Promise<boolean>=>{throw Error('相册功能不属于文件管理迁移范围')}
export const AliAlbum={ApiAlbumDeleteFiles:excluded,ApiAlbumDelete:excluded}
export const nativeEmptyTrash=(user:string,drive:string):Promise<number>=>getDrivePane().action('emptyTrashDirect',[user,drive])
