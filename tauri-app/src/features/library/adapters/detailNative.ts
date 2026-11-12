import {useVideoCatalog} from '../catalog'
import {nativeCall} from '@/platform/native'
import {message} from '@/features/files/adapters/sourceServices'
export interface IAliGetFileModel {file_id:string;drive_id:string;name:string;parent_file_id:string;ext:string;description:string;media_play_cursor?:string;user_id?:string;[key:string]:unknown}
export interface IPageVideoPlaylistEntry {user_id:string;drive_id:string;file_id:string;parent_file_id:string;file_name:string;html:string;ext:string;description:string;play_cursor:number;encType:string}
export const path={posix:{dirname(value:string){const index=value.lastIndexOf('/');return index>0?value.slice(0,index):'/'}}}
export function getLocalVideoProgress(_userId:string,_driveId:string,id:string){const item=useVideoCatalog().items.find(item=>item.id===id);return item?.duration?(item.progress||0)*item.duration/100:0}
export async function menuOpenFile(file:IAliGetFileModel,_label:string,options:{customPlaylistLabel?:string;customPlaylist?:IPageVideoPlaylistEntry[];playlistLoop?:boolean}={}){
 try{const catalog=useVideoCatalog(),item=catalog.items.find(item=>item.id===file.file_id);if(!item)throw new Error('媒体来源已移除');const queue=(options.customPlaylist||[]).flatMap(entry=>catalog.items.find(item=>item.id===entry.file_id)||[]);const position=queue.findIndex(row=>row.id===item.id),ordered=position>=0?[...queue.slice(position),...queue.slice(0,position)]:[item,...queue];if(options.playlistLoop)await catalog.playMany(ordered,'loop');else await catalog.play(item,ordered)}catch(error){message.error(String(error))}
}
export default {async aAddDownload(files:IAliGetFileModel[],_path:string,_full:boolean){for(const file of files){const item=useVideoCatalog().items.find(item=>item.id===file.file_id);if(!item||item.local)throw new Error('此文件不支持远端下载');await nativeCall('source_download',{accountId:item.sourceId,fileId:item.fileId,name:item.fileName})}}}

export async function downloadFile(id:string){const item=useVideoCatalog().items.find(item=>item.id===id);if(!item||item.local)throw new Error('此文件不支持远端下载');await nativeCall('source_download',{accountId:item.sourceId,fileId:item.fileId,name:item.fileName})}
