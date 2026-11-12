import type {VideoItem} from '@/features/library/catalog'
export function purgeDeletedCatalog(snapshot:{items:VideoItem[];playlists:Record<string,string[]>;series:Record<string,string[]>},sourceId:string,files:ReadonlyArray<{file_id:string;isDir:boolean}>){
 const ids=new Set(files.map(file=>file.file_id)),folders=new Set(files.filter(file=>file.isDir).map(file=>file.file_id)),removed=new Set<string>()
 const keep=(item:VideoItem):boolean=>{
  if(item.sourceId===sourceId&&(ids.has(item.fileId)||!!item.folderPath&&folders.has(item.folderPath)||item.folderAncestors?.some(id=>folders.has(id)))){removed.add(item.id);return false}
  if(item.collectionMovies)item.collectionMovies=item.collectionMovies.filter(keep)
  return true
 }
 snapshot.items=snapshot.items.filter(keep)
 for(const groups of [snapshot.playlists,snapshot.series])for(const key of Object.keys(groups))groups[key]=groups[key]!.filter(id=>!removed.has(id))
}
