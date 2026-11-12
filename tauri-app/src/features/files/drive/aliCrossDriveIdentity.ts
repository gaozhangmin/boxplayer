/** Native reconciliation input. Never infer descendant IDs from a root receipt. */
export interface AliMoveNode {id:string;parent:string;name:string;isDirectory:boolean;size:number;contentHash?:string}
export interface AliMovePair {from:string;to:string}
function location(value:string){
 let row:any;try{row=JSON.parse(value)}catch{throw Error('跨盘移动位置无效')}
 if(!row||typeof row.driveId!=='string'||!row.driveId||typeof row.fileId!=='string'||!row.fileId||JSON.stringify({driveId:row.driveId,fileId:row.fileId})!==value)throw Error('跨盘移动位置无效')
 return row as {driveId:string;fileId:string}
}
function snapshot(nodes:AliMoveNode[]){
 const result=new Map<string,AliMoveNode>()
 for(const node of nodes){
  const id=location(node.id),parent=location(node.parent)
  if(id.fileId==='root'||id.driveId!==parent.driveId||node.id===node.parent||result.has(node.id)||typeof node.name!=='string'||!node.name||typeof node.isDirectory!=='boolean'||!Number.isSafeInteger(node.size)||node.size<0||node.contentHash!==undefined&&typeof node.contentHash!=='string')throw Error('跨盘移动快照身份或字段无效')
  result.set(node.id,{...node})
 }
 return result
}
export function validateAliCrossDriveIdentity(before:AliMoveNode[],after:AliMoveNode[],selected:string[],destination:string,pairs:AliMovePair[]){
 const target=location(destination),old=snapshot(before),next=snapshot(after)
 if(!selected.length||new Set(selected).size!==selected.length||selected.some(id=>!old.has(id))||pairs.length!==old.size||pairs.length!==next.size)throw Error('跨盘移动缺少完整根或后代映射')
 const roots=new Set(selected),mapping=new Map<string,string>(),targets=new Set<string>()
 for(const pair of pairs){
  const from=old.get(pair.from),to=next.get(pair.to)
  if(!from||!to||mapping.has(pair.from)||targets.has(pair.to)||location(pair.from).driveId===location(pair.to).driveId||location(pair.to).driveId!==target.driveId)throw Error('跨盘移动映射重复或来源不匹配')
  if(from.isDirectory!==to.isDirectory||!from.isDirectory&&(from.size!==to.size||from.contentHash&&to.contentHash&&from.contentHash!==to.contentHash)||!roots.has(pair.from)&&from.name!==to.name)throw Error('跨盘移动目标身份与原快照不匹配')
  mapping.set(pair.from,pair.to);targets.add(pair.to)
 }
 for(const [id,node] of old){
  const to=next.get(mapping.get(id)!)!
  if(roots.has(id)){
   if(mapping.has(node.parent)||to.parent!==destination)throw Error('跨盘移动所选根或目标父目录无效')
  }else if(!old.get(node.parent)?.isDirectory||to.parent!==mapping.get(node.parent))throw Error('跨盘移动后代父目录映射缺失')
  const seen=new Set<string>();let current=id
  while(!roots.has(current)){
   if(seen.has(current)||seen.size>=512)throw Error('跨盘移动快照目录成环或过深')
   seen.add(current);const parent=old.get(current)?.parent
   if(!parent||!old.has(parent))throw Error('跨盘移动快照存在未归属后代')
   current=parent
  }
 }
 if(targets.has(destination))throw Error('跨盘移动目标不能是被移动节点')
 return {mapping,roots:new Set(roots),before:old,after:next,destination}
}
