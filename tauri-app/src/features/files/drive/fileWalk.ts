import {getDrivePane} from './ports'
import {OrderDir} from '../electron/filenameorder'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
export function createFileWalk(validate:()=>void=()=>{}){
 const pane=getDrivePane(),source=pane.sourceId,context=pane.context
 let disposed=false
 function check(){validate();if(disposed||getDrivePane()!==pane||pane.sourceId!==source||pane.context!==context)throw Error('目录解析已关闭或来源已切换')}
 return {
  dispose(){disposed=true},
  async ApiWalkFileList(user:string,drive:string,root:string,_name:string,_order:string,_type:string,max=5000){
   check();if(user!==source||drive!==source)throw Error('目录解析来源不匹配')
   const items:IAliGetFileModel[]=[],queue=[root],seen=new Set([root])
   for(let index=0;index<queue.length;index++){
    check();const parent=queue[index]!,children=OrderDir('name','asc',await pane.list(user,drive,parent,check)) as IAliGetFileModel[];check()
    for(const row of children){
     if(!row.file_id||row.drive_id!==source||seen.has(row.file_id))throw Error('目录解析包含重复或循环项目')
     if(max>0&&items.length>=max)throw Error(`目录树超过 ${max} 项，未生成不完整结果`)
     seen.add(row.file_id);items.push({...row,parent_file_id:parent})
     if(row.isDir)queue.push(row.file_id)
    }
   }
   return {items,next_marker:''}
  }
 }
}
