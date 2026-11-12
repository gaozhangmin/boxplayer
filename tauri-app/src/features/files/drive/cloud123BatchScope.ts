type Scope={check:()=>void;rejected:boolean;sent:boolean}
const scopes=new Map<string,Scope>()
const key=(source:string,ids:number[],parent:number)=>JSON.stringify([source,ids,parent])
export function cloud123BatchScope(source:string,body:{fileIds?:number[];targetDirId?:number}){
 return Array.isArray(body.fileIds)?scopes.get(key(source,body.fileIds,body.targetDirId!)):undefined
}
export async function withCloud123BatchScope<T>(source:string,ids:string[],parent:string,check:()=>void,work:()=>Promise<T>){
 const id=key(source,ids.map(Number),Number(parent)),scope:Scope={check,rejected:false,sent:false}
 if(scopes.has(id))throw Error('123 批量复制请求已在进行')
 scopes.set(id,scope)
 try{return {value:await work(),rejected:scope.rejected,sent:scope.sent}}finally{if(scopes.get(id)===scope)scopes.delete(id)}
}
