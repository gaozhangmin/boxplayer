const operations=new Map<string,'rename'|'move'|'copy'|'trash'>()
const key=(account:string,id:string)=>JSON.stringify([account,id])
export function assertCloud189Operation(account:string,id:string,kind:'rename'|'move'|'copy'|'trash'){
 const pending=operations.get(key(account,id));if(pending&&pending!==kind)throw Error('天翼 此文件此前操作尚未确认，请先完成原操作')
}
export function beginCloud189Operation(account:string,id:string,kind:'rename'|'move'|'copy'|'trash'){assertCloud189Operation(account,id,kind);operations.set(key(account,id),kind)}
export function endCloud189Operation(account:string,id:string,kind:'rename'|'move'|'copy'|'trash'){if(operations.get(key(account,id))===kind)operations.delete(key(account,id))}
