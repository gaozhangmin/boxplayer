import {request,text} from '@/features/sources/transport'
import {mutationAccount} from './providerTransport'
export function guangyaId(value:unknown,root=false):string{
 if(typeof value==='number'&&(!Number.isSafeInteger(value)||value<0||!root&&value===0))throw Error('光鸭文件标识超出安全范围')
 if(typeof value!=='string'&&typeof value!=='number')throw Error('光鸭文件标识无效')
 const raw=String(value);if(root&&['','0','/','guangya_root'].includes(raw))return raw;if(!root&&['0','/','guangya_root'].includes(raw))throw Error('光鸭文件标识不能是根目录');
 const id=String(value);if((!root&&!id)||id.length>4096||/[\u0000-\u001f/\\]/.test(id))throw Error('光鸭文件标识无效');return id
}
const detailScopes=new Map<string,{user:string;check:()=>void}>()
export async function withGuangyaDetailGuard<T>(user:string,check:()=>void,read:(scopedUser:string)=>Promise<T>){
 check();mutationAccount(user,'guangya')
 if(detailScopes.size>=128)throw Error('光鸭详情读取过多')
 const key=`guangya-detail:${crypto.randomUUID()}`
 detailScopes.set(key,{user,check})
 try{return await read(key)}finally{detailScopes.delete(key)}
}
export async function guangyaRequest(user:string,path:string,body:Record<string,unknown>={},method:'GET'|'POST'='POST',allowedCodes:number[]=[]):Promise<any>{
 const scope=detailScopes.get(user);scope?.check()
 const account=mutationAccount(scope?.user??user,'guangya')
 const endpoints=['/nd.bizuserres.s/v1/file/create_dir','/nd.bizuserres.s/v1/file/rename','/nd.bizuserres.s/v1/file/move_file','/nd.bizuserres.s/v1/file/copy_file','/nd.bizuserres.s/v1/file/delete_file','/nd.bizuserres.s/v1/file/get_file_detail','/userres/v1/file/get_file_list']
 if(!endpoints.includes(path)||method!=='POST'||allowedCodes.length||!body||typeof body!=='object'||Array.isArray(body))throw Error('光鸭文件请求未适配')
 const keys=Object.keys(body),name=body.dirName??body.newName
 if(name!==undefined&&(typeof name!=='string'||!name.trim()||/[\u0000-\u001f/\\]/.test(name)||name==='.'||name==='..'))throw Error('光鸭文件名无效')
 if(path.endsWith('/create_dir')){if(typeof body.dirName!=='string'||body.failIfNameExist!==true||keys.some(key=>!['dirName','parentId','failIfNameExist'].includes(key)))throw Error('光鸭新建参数无效');guangyaId(body.parentId,true)}
 if(path.endsWith('/rename')){guangyaId(body.fileId);if(typeof body.newName!=='string'||keys.some(key=>!['fileId','newName'].includes(key)))throw Error('光鸭重命名参数无效')}
 if(path.endsWith('/get_file_detail')){guangyaId(body.fileId);if(keys.some(key=>key!=='fileId'))throw Error('光鸭详情参数无效')}
 if(path.endsWith('/get_file_list')){guangyaId(body.parentId,true);if(!Number.isSafeInteger(body.page)||Number(body.page)<0||!Number.isSafeInteger(body.pageSize)||Number(body.pageSize)<1||Number(body.pageSize)>100||body.orderBy!==0||body.sortType!==0||keys.some(key=>!['parentId','page','pageSize','orderBy','sortType'].includes(key)))throw Error('光鸭详情回退列表参数无效')}
 if(path.endsWith('/move_file')||path.endsWith('/copy_file')){guangyaId(body.parentId,true);if(!Array.isArray(body.fileIds)||!body.fileIds.length||body.fileIds.length>100||new Set(body.fileIds).size!==body.fileIds.length||keys.some(key=>!['fileIds','parentId'].includes(key)))throw Error('光鸭移动参数无效');body.fileIds.forEach(id=>guangyaId(id))}
 if(path.endsWith('/delete_file')){if(!Array.isArray(body.fileIds)||!body.fileIds.length||body.fileIds.length>100||new Set(body.fileIds).size!==body.fileIds.length||keys.some(key=>key!=='fileIds'))throw Error('光鸭回收参数无效');body.fileIds.forEach(id=>guangyaId(id))}
 const response=await request(account,'POST','https://api.guangyapan.com'+path,JSON.stringify(body),{'Content-Type':'application/json'})
 scope?.check()
 const data=JSON.parse(text(response));if((response.status<200||response.status>=300)||!data||typeof data!=='object'||Array.isArray(data)||data.code!==undefined&&Number(data.code)!==0||data.success===false)throw Error('光鸭文件操作未确认成功')
 if(path.endsWith('/get_file_list')){const raw=data.data||data;const list=raw.list||raw.items||raw.files||raw.records||raw.content||raw.fileList;if(!Array.isArray(list))throw Error('光鸭文件列表响应无效')}
 const validate=(value:unknown):void=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(validate);return}for(const [key,field] of Object.entries(value)){if(['fileId','file_id','id','resId','resourceId','parentId','parentFileId'].includes(key)&&field!==null&&field!==undefined)guangyaId(field,key.startsWith('parent'));else if(field&&typeof field==='object')validate(field)}};validate(data.data??data)
 return data
}
