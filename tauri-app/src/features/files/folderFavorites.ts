import type { useFileSourcesStore } from '@/stores/fileSources'
export interface FolderCatalog { scanFolder(sourceId:string,path:string):Promise<unknown>; removeFolder(sourceId:string,path:string):Promise<unknown> }
export async function toggleFolderFavorite(sources:ReturnType<typeof useFileSourcesStore>,catalog:FolderCatalog,sourceId:string,path:string,name:string,local:boolean){
 if(local&&!path){const previous=!!sources.preferences.hiddenLocalRoots[sourceId];sources.preferences.hiddenLocalRoots[sourceId]=!previous;try{if(previous)await catalog.scanFolder(sourceId,path);else await catalog.removeFolder(sourceId,path)}catch(cause){sources.preferences.hiddenLocalRoots[sourceId]=previous;throw cause}return}
 const existing=sources.preferences.favorites.find(f=>f.sourceId===sourceId&&f.path===path)
 if(existing){sources.removeBookmark(existing.id);try{await catalog.removeFolder(sourceId,path)}catch(cause){sources.preferences.favorites.push(existing);throw cause}}
 else{sources.bookmark(sourceId,path,name,local);try{await catalog.scanFolder(sourceId,path)}catch(cause){sources.removeBookmark(JSON.stringify([sourceId,path]));throw cause}}
}
