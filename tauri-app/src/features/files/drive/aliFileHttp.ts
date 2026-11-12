import {AliFolderHttp} from './aliFolderTransport'
import {recoverPost} from './aliRecoverTransport'
export {EncodeEncName,DebugLog,type ProviderFileCommandOptions} from './aliFolderTransport'
export const AliFileHttp={...AliFolderHttp,Post(path:string,body:string|Record<string,unknown>,user:string,share:string){
 if(['adrive/v1/file/resumeDeleted','adrive/v1/file/checkResumeTask'].includes(path))return recoverPost(path,body,user,share)
 if(typeof body!=='string')throw Error('阿里文件请求体无效')
 return AliFolderHttp.Post(path,body,user,share)
}}
