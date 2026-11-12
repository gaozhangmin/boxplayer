type Scope={check:()=>void;renameList:string[]}
const scopes=new Map<string,Scope>()
export function cloud123RenameScope(user:string){return scopes.get(user)}
export async function withCloud123RenameScope<T>(user:string,renameList:string[],check:()=>void,work:()=>Promise<T>){
 if(scopes.has(user))throw Error('123 批量重命名已在进行')
 const scope={check,renameList};scopes.set(user,scope)
 try{check();return await work()}finally{if(scopes.get(user)===scope)scopes.delete(user)}
}
