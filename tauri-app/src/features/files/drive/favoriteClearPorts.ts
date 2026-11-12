import {getDrivePane} from './ports'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
export interface IAliFileResp {m_user_id:string;m_drive_id:string;items:IAliGetFileModel[]}
export const NewIAliFileResp=(user:string,drive:string,_id:string,_name:string):IAliFileResp=>({m_user_id:user,m_drive_id:drive,items:[]})
export const ArrayKeyList=<T extends string>(key:'file_id',rows:IAliGetFileModel[])=>rows.map(row=>row[key]) as T[]
export const AliTrash={async ApiFavorFileListOnePageForClean(_by:string,_order:string,dir:IAliFileResp){dir.items=await getDrivePane().action('favoritePageForClear',[dir.m_user_id,dir.m_drive_id])}}
