import type {VideoItem} from '@/features/library/catalog'
import type {FilePreferences} from '../preferences'
import type {IAliGetFileModel} from './electron/aliapi/alimodels'
import type {BaiduRenameResult} from './baiduRenameMutations'
import type {BaiduMoveResult} from './baiduMoveMutations'

const pathAfter=(value:string|undefined,result:BaiduRenameResult)=>typeof value==='string'&&(value===result.previousPath||result.isDir&&value.startsWith(result.previousPath+'/'))?result.path+value.slice(result.previousPath.length):value
export function applyBaiduModelRename(row:IAliGetFileModel,result:BaiduRenameResult){
 if(row.file_id===result.file_id)row.name=result.name
 row.path=pathAfter(row.path,result)
 row.parent_file_id=pathAfter(row.parent_file_id,result)!
 if(typeof row.path==='string'&&row.path.startsWith('/'))row.description=`baidu_fsid:${row.file_id};baidu_path:${row.path}`
}
export function updateBaiduRenameCatalog(items:VideoItem[],source:string,results:ReadonlyArray<BaiduRenameResult>){
 function original(node:any,result:BaiduRenameResult){
  if(!node||typeof node!=='object')return
  const owned=(file:any)=>[file.driveServerId,file.userId,file.driveId].includes(source)
  if(!node.driveFiles?.length||node.driveFiles.some(owned)){
   if(typeof node.folderPath==='string')node.folderPath=pathAfter(node.folderPath,result)
   if(typeof node.folderId==='string')node.folderId=pathAfter(node.folderId,result)
  }
  for(const file of node.driveFiles||[]){
   if(!owned(file))continue
   file.path=pathAfter(file.path,result);file.parentFileId=pathAfter(file.parentFileId,result)
   if(file.id===result.file_id&&!result.isDir)file.name=result.name
  }
  for(const child of [...(node.collectionMovies||[]),...(node.seasons||[]),...(node.episodes||[])])original(child,result)
 }
 function visit(item:VideoItem){
  if(item.sourceId===source)for(const result of results){
   item.folderPath=pathAfter(item.folderPath,result)
   if(item.folderAncestors)item.folderAncestors=item.folderAncestors.map(path=>pathAfter(path,result)!)
   if(item.catalogRoots)item.catalogRoots=item.catalogRoots.map(path=>pathAfter(path,result)!)
   original(item.originalMetadata,result)
  }
  for(const child of item.collectionMovies||[])visit(child)
 }
 items.forEach(visit)
}
export function updateBaiduMoveCatalog(items:VideoItem[],source:string,results:ReadonlyArray<BaiduMoveResult>){
 updateBaiduRenameCatalog(items,source,results)
 function original(node:any,result:BaiduMoveResult){
  if(!node||typeof node!=='object')return
  const selected=(node.driveFiles||[]).filter((file:any)=>file.id===result.file_id&&[file.driveServerId,file.userId,file.driveId].includes(source))
  if(selected.length){for(const file of selected)file.parentFileId=result.parent_file_id;if(node.folderPath!==undefined)node.folderPath=result.destinationPath;if(node.folderId!==undefined)node.folderId=result.parent_file_id}
  for(const child of [...(node.collectionMovies||[]),...(node.seasons||[]),...(node.episodes||[])])original(child,result)
 }
 function visit(item:VideoItem){if(item.sourceId===source)for(const result of results.filter(row=>!row.isDir))original(item.originalMetadata,result);for(const child of item.collectionMovies||[])visit(child)}
 items.forEach(visit)
}
export function baiduRenamedPreferences(preferences:FilePreferences,source:string,results:ReadonlyArray<BaiduRenameResult>):FilePreferences{
 const next=JSON.parse(JSON.stringify(preferences)) as FilePreferences
 for(const result of results.filter(row=>row.isDir&&row.previousPath!==row.path)){
  const ids=new Map<string,string>()
  for(const favorite of next.favorites){
   if(favorite.local||favorite.sourceId!==source)continue
   const path=pathAfter(favorite.path,result)!
   if(path===favorite.path)continue
   const id=JSON.stringify([source,path]);ids.set(favorite.id,id);favorite.id=id;favorite.path=path
  }
  if(new Set(next.favorites.map(row=>row.id)).size!==next.favorites.length)throw Error('重命名后的收藏位置冲突，请核对收藏后重试同步')
  for(const dictionary of [next.names,next.covers,next.hiddenOnHome]){
   for(const [from,to] of ids){
    if(!(from in dictionary)||from===to)continue
    if(to in dictionary&&dictionary[to]!==dictionary[from])throw Error('重命名后的收藏显示设置冲突，请核对后重试同步')
    ;(dictionary as Record<string,unknown>)[to]=dictionary[from];delete dictionary[from]
   }
  }
  next.order=[...new Set(next.order.map(id=>ids.get(id)||id))]
 }
 return next
}
