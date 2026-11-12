import {getDrivePane} from './ports'
export type BoxItemType='file'|'folder'
export async function resolveBoxItemType(user:string,id:string,known?:BoxItemType):Promise<BoxItemType|undefined>{
 const pane=getDrivePane();if(user!==pane.sourceId||pane.account?.providerId!=='box')throw Error('重命名来源不匹配')
 const file=pane.file?.(id)||pane.store.ListDataRaw.find(file=>file.file_id===id)
 if(!file)throw Error('文件不在当前来源列表中')
 const actual=file.isDir?'folder':'file';if(known&&known!==actual)throw Error('文件类型已变化');return actual
}
function mapped(data:unknown){
 if(!data||typeof data!=='object')throw Error('提供商未返回重命名结果')
 const row=data as {id?:unknown;name?:unknown}
 if(typeof row.id!=='string'||!row.id||typeof row.name!=='string'||!row.name)throw Error('提供商重命名结果缺少标识或名称')
 return {file_id:row.id,name:row.name}
}
export const mapGoogleFileToAliModel=(data:unknown,_drive:string,_parent:string)=>mapped(data)
export const mapBoxItemToAliModel=(data:unknown,_drive:string,_parent:string)=>mapped(data)

export const getEncType=(_file:{description:string})=>''
function excluded():never{throw Error('此浏览器不支持相册、加密或未接入来源的重命名')}
export const EncodeEncName=(..._args:unknown[]):string=>excluded()
export const AliAlbum={ApiAlbumUpdate:async(..._args:unknown[]):Promise<boolean>=>excluded()}
export const apiCloud123Rename=async(..._args:unknown[]):Promise<{success:boolean}>=>excluded()
