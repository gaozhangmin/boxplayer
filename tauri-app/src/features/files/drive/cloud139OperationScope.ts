const operations=new Map<string,'rename'|'move'|'copy'|'trash'>()
const key=(account:string,id:string)=>JSON.stringify([account,id])
export function assertCloud139Operation(account:string,id:string,kind:'rename'|'move'|'copy'|'trash'){
 const pending=operations.get(key(account,id));if(pending&&pending!==kind)throw Error('139 此文件此前操作尚未确认，请先完成原操作')
}
export function beginCloud139Operation(account:string,id:string,kind:'rename'|'move'|'copy'|'trash'){assertCloud139Operation(account,id,kind);operations.set(key(account,id),kind)}
export function endCloud139Operation(account:string,id:string,kind:'rename'|'move'|'copy'|'trash'){if(operations.get(key(account,id))===kind)operations.delete(key(account,id))}
