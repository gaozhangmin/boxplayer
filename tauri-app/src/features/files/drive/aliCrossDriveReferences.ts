import type {VideoItem} from '@/features/library/catalog'
import type {FilePreferences} from '../preferences'
import {validateAliCrossDriveIdentity,type AliMoveNode,type AliMovePair} from './aliCrossDriveIdentity'
interface CatalogReferences {items:VideoItem[];playlists:Record<string,string[]>;series:Record<string,string[]>}
export interface AliCrossDriveReferenceInput {sourceId:string;before:AliMoveNode[];after:AliMoveNode[];selected:string[];destination:string;destinationAncestors:string[];pairs:AliMovePair[]}

/** Build a detached draft. This does not submit a move or commit native state. */
export function prepareAliCrossDriveReferences<T extends CatalogReferences>(catalog:T,preferences:FilePreferences,input:AliCrossDriveReferenceInput){
 const {sourceId, destinationAncestors}=input
 if(!sourceId||destinationAncestors[0]!==''||destinationAncestors.at(-1)!==input.destination||new Set(destinationAncestors).size!==destinationAncestors.length)throw Error('跨盘移动目标路径无效')
 const plan=validateAliCrossDriveIdentity(input.before,input.after,input.selected,input.destination,input.pairs)
 for(const parent of destinationAncestors.slice(1)){let value:any;try{value=JSON.parse(parent)}catch{throw Error('跨盘移动目标路径无效')};if(!value||typeof value.driveId!=='string'||typeof value.fileId!=='string'||JSON.stringify({driveId:value.driveId,fileId:value.fileId})!==parent||value.driveId!==JSON.parse(input.destination).driveId||!value.fileId||plan.after.has(parent))throw Error('跨盘移动目标路径与目标盘不匹配')}
 const draft=JSON.parse(JSON.stringify(catalog)) as T,nextPreferences=JSON.parse(JSON.stringify(preferences)) as FilePreferences
 const ids=new Map<string,string>(),catalogIds=new Map<string,string>(),resultIdentities=new Map<string,string>()
 for(const [from,to] of plan.mapping)ids.set(JSON.stringify([sourceId,from]),JSON.stringify([sourceId,to]))
 function ancestry(parent:string){
  const suffix:string[]=[],seen=new Set<string>();let current=parent
  while(current!==input.destination){if(seen.has(current)||!plan.after.get(current)?.isDirectory)throw Error('跨盘移动目标后代路径缺失');seen.add(current);suffix.unshift(current);current=plan.after.get(current)!.parent}
  return [...destinationAncestors,...suffix]
 }
 const mapped=(value:string|undefined)=>value===undefined?undefined:plan.mapping.get(value)||value
 function original(node:any){
  if(!node||typeof node!=='object')return
  const parents=new Set<string>();let ownedCount=0,movedCount=0
  function file(row:any){
   if(!row||![row.userId,row.driveId,row.driveServerId].includes(sourceId))return
   const old=plan.before.has(row.path)?row.path:plan.before.has(row.id)?row.id:undefined
   if(old){const target=plan.after.get(plan.mapping.get(old)!)!;row.path=target.id;row.parentFileId=target.parent;row.name=target.name;row.id=ids.get(row.id)||mapped(row.id);row.sourceFolderIds=row.sourceFolderIds?.map(mapped);parents.add(target.parent);movedCount++}
   ownedCount++
   for(const subtitle of row.subtitleFiles||[])file(subtitle)
  }
  for(const row of node.driveFiles||[])file(row)
  if(ownedCount>0)for(const key of ['folderId','folderPath'])if(typeof node[key]==='string')node[key]=mapped(node[key])
  if(ownedCount>0&&ownedCount===movedCount&&parents.size===1){node.folderId=[...parents][0];node.folderPath=[...parents][0]}
  if(typeof node.id==='string')node.id=ids.get(node.id)||node.id
  if(ownedCount>0&&typeof node.lastPlayedFileId==='string')node.lastPlayedFileId=ids.get(node.lastPlayedFileId)||mapped(node.lastPlayedFileId)
  for(const child of [...(node.collectionMovies||[]),...(node.seasons||[]),...(node.episodes||[])])original(child)
 }
 function visit(item:VideoItem){
  const oldIdentity=JSON.stringify([item.sourceId,item.fileId,item.local])
  if(item.sourceId===sourceId&&!item.local){
   const targetId=plan.mapping.get(item.fileId)
   const affected=targetId||item.folderAncestors?.some(parent=>plan.before.get(parent)?.isDirectory)||!!item.folderPath&&plan.before.get(item.folderPath)?.isDirectory
   if(affected&&!targetId)throw Error('跨盘移动遗漏媒体库后代身份映射')
   if(targetId){
    const target=plan.after.get(targetId)!,previousName=item.fileName
    const oldId=item.id;item.id=ids.get(item.id)||item.id;if(item.id!==oldId)catalogIds.set(oldId,item.id)
    item.fileId=targetId;item.fileName=target.name;item.folderPath=target.parent;item.folderAncestors=ancestry(target.parent)
    if(item.type==='unmatched'&&item.metadataSource!=='manual'&&item.name===previousName)item.name=target.name
    // Scan ownership follows moved roots only; do not enroll an unrelated destination scan.
    item.catalogRoots=item.catalogRoots?.map(root=>mapped(root)!)
   }
   original(item.originalMetadata)
  }
  if(resultIdentities.has(item.id)&&resultIdentities.get(item.id)!==oldIdentity)throw Error('跨盘移动目标已有媒体库身份，未合并覆盖')
  resultIdentities.set(item.id,oldIdentity)
  for(const child of item.collectionMovies||[])visit(child)
 }
 draft.items.forEach(visit)
 const topIds=new Set(draft.items.map(item=>item.id))
 if(topIds.size!==draft.items.length)throw Error('跨盘移动目标已有媒体库身份，未合并覆盖')
 for(const groups of [draft.playlists,draft.series])for(const name of Object.keys(groups)){
  const members=groups[name]!.map(id=>catalogIds.get(id)||id)
  if(new Set(members).size!==members.length)throw Error('跨盘移动集合成员身份冲突')
  if(members.some(id=>!topIds.has(id)))throw Error('跨盘移动集合引用缺失')
  groups[name]=members
 }
 const bookmarkIds=new Map<string,string>()
 for(const favorite of nextPreferences.favorites){
  if(favorite.local||favorite.sourceId!==sourceId||!plan.mapping.has(favorite.path))continue
  if(!plan.before.get(favorite.path)!.isDirectory)throw Error('跨盘移动收藏文件夹身份无效')
  const old=favorite.id;favorite.path=plan.mapping.get(favorite.path)!;favorite.id=JSON.stringify([sourceId,favorite.path]);bookmarkIds.set(old,favorite.id)
 }
 if(new Set(nextPreferences.favorites.map(row=>row.id)).size!==nextPreferences.favorites.length)throw Error('跨盘移动目标已有收藏，未合并覆盖')
 for(const dictionary of [nextPreferences.names,nextPreferences.covers,nextPreferences.hiddenOnHome])for(const [from,to] of bookmarkIds){
  if(!Object.hasOwn(dictionary,from)||from===to)continue
  if(Object.hasOwn(dictionary,to)&&dictionary[to]!==dictionary[from])throw Error('跨盘移动收藏显示设置冲突')
  ;(dictionary as Record<string,unknown>)[to]=dictionary[from];delete dictionary[from]
 }
 nextPreferences.order=nextPreferences.order.map(id=>bookmarkIds.get(id)||id)
 if(new Set(nextPreferences.order).size!==nextPreferences.order.length)throw Error('跨盘移动收藏顺序身份冲突')
 return {catalog:draft,preferences:nextPreferences,identityMoves:input.pairs.map(pair=>({sourceId,from:pair.from,to:pair.to}))}
}
