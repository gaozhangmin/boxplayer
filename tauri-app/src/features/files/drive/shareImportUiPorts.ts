import type {IAliShareAnonymous} from './electron/aliapi/alimodels'
import type {IAliShareFileResp} from './electron/providers/aliImport'
export interface ShareImportUiPort {
 check():void
 token(id:string,password:string):Promise<string>
 info(id:string,password:string):Promise<IAliShareAnonymous>
 list(id:string,token:string,parent:string):Promise<IAliShareFileResp>
 close():void
 selectDirectory(callback:(user:string,drive:string,file:any)=>Promise<void>):void
 save(id:string,token:string,user:string,drive:string,parent:string,ids:string[]):Promise<string>
 createFolder(user:string,drive:string,parent:string,name:string):Promise<{file_id?:string;error?:string}>
 refresh(user:string,drive:string,parent:string):Promise<unknown>
}
