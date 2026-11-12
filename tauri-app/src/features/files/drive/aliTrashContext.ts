const contexts=new Map<string,()=>void>()
export const checkAliTrashContext=(user:string)=>contexts.get(user)?.()
export async function withAliTrashContext<T>(user:string,check:()=>void,work:()=>Promise<T>){if(contexts.has(user))throw Error('阿里回收站操作正在进行，请等待结果');contexts.set(user,check);try{check();const value=await work();check();return value}finally{if(contexts.get(user)===check)contexts.delete(user)}}
