const contexts=new Map<string,()=>void>()
export function checkAliRelocationContext(user:string){contexts.get(user)?.()}
export async function withAliRelocationContext<T>(user:string,check:()=>void,work:()=>Promise<T>){
 if(contexts.has(user))throw Error('阿里移动/复制正在进行，请等待结果')
 contexts.set(user,check)
 try{check();const result=await work();check();return result}finally{if(contexts.get(user)===check)contexts.delete(user)}
}
