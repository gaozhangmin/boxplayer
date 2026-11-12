import type {VideoItem} from '@/features/library/catalog'
export function updateMovedCatalogItems(items:VideoItem[],sourceId:string,moved:ReadonlyArray<{file_id:string;isDir:boolean;name?:string}>,destination:string,ancestors:string[]){
 const direct=new Set(moved.filter(file=>!file.isDir).map(file=>file.file_id)),folders=new Set(moved.filter(file=>file.isDir).map(file=>file.file_id))
 function visit(item:VideoItem){
  if(item.sourceId===sourceId){
   if(direct.has(item.fileId)){item.folderPath=destination;item.folderAncestors=[...ancestors];const name=moved.find(file=>file.file_id===item.fileId)?.name;if(name){const previous=item.fileName;item.fileName=name;if(item.type==='unmatched'&&item.metadataSource!=='manual'&&item.name===previous)item.name=name}}
   else{
    const previous=item.folderAncestors||[];let index=-1
    for(let position=0;position<previous.length;position++)if(folders.has(previous[position]!))index=position
    if(index>=0)item.folderAncestors=[...ancestors,...previous.slice(index)]
    else if(item.folderPath&&folders.has(item.folderPath))item.folderAncestors=[...ancestors,item.folderPath]
   }
  }
  for(const child of item.collectionMovies||[])visit(child)
 }
 for(const item of items)visit(item)
 // catalogRoots records scan ownership, not a guessed destination scan. Keep it
 // until the existing scanner reconciles roots; stable IDs and user metadata stay intact.
}
