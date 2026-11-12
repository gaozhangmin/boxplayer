const contexts=new Map<string,()=>void>()
export function checkAliRenameContext(user:string){contexts.get(user)?.()}
export async function withAliRenameContext<T>(user:string,check:()=>void,work:()=>Promise<T>){
 if(contexts.has(user))throw Error('阿里重命名正在进行，请等待结果')
 contexts.set(user,check)
 try{check();const result=await work();check();return result}finally{if(contexts.get(user)===check)contexts.delete(user)}
}
