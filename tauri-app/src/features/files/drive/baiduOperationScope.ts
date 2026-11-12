const operations=new Map<string,'rename'|'move'|'copy'|'trash'>()
const key=(account:string,id:string)=>JSON.stringify([account,id])
export function assertBaiduOperation(account:string,id:string,kind:'rename'|'move'|'copy'|'trash'){
 const pending=operations.get(key(account,id));if(pending&&pending!==kind)throw Error('该文件此前的操作尚未确认或同步，请先完成此前操作')
}
export function beginBaiduOperation(account:string,id:string,kind:'rename'|'move'|'copy'|'trash'){assertBaiduOperation(account,id,kind);operations.set(key(account,id),kind)}
export function endBaiduOperation(account:string,id:string,kind:'rename'|'move'|'copy'|'trash'){if(operations.get(key(account,id))===kind)operations.delete(key(account,id))}
