import { getDrivePane } from './ports'
export default {
 ApiFileColorBatch:(...args:unknown[]):Promise<void>=>getDrivePane().action('colorBatch',args),
 ApiFavorBatch:(...args:unknown[]):Promise<string[]>=>getDrivePane().action('favoriteBatch',args),
 ApiRecoverBatch:(...args:unknown[]):Promise<string[]|string>=>getDrivePane().action('recoverBatch',args),
 ApiRenameBatch:(...args:unknown[]):Promise<Array<{file_id:string;parent_file_id:string;name:string;isDir:boolean}>>=>getDrivePane().action('renameBatch',args),
 ApiMoveBatch:(...args:unknown[]):Promise<string[]>=>getDrivePane().action('moveBatch',args),
 ApiCopyBatch:(...args:unknown[]):Promise<string[]>=>getDrivePane().action('copyBatch',args),
 ApiTrashBatch:(...args:unknown[]):Promise<string[]>=>getDrivePane().action('trashBatch',args),
 ApiDeleteBatch:(...args:unknown[]):Promise<string[]>=>getDrivePane().action('deleteBatch',args),
 ApiTrashRestoreBatch:(...args:unknown[]):Promise<string[]>=>getDrivePane().action('restoreBatch',args),
 ApiGetFileBatch:(...args:unknown[]):Promise<import('./electron/aliapi/alimodels').IAliGetFileModel[]>=>getDrivePane().action('restoredDetails',args),
 ApiCreatNewForder:(...args:unknown[]):Promise<{file_id?:string;error?:string}>=>getDrivePane().action('createFolderDirect',args)
}
