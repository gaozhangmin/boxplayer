import { isPublicCover } from './coverImages'
import { OrderDir } from './electron/filenameorder'
export type FileSort = 'name' | 'size' | 'modified'
export interface FolderBookmark { id: string; sourceId: string; path: string; name: string; local: boolean }
export interface FilePreferences { grid: boolean; showPreviews: boolean; sort: FileSort; descending: boolean; names: Record<string,string>; covers: Record<string,string>; hiddenOnHome: Record<string,boolean>; hiddenLocalRoots: Record<string,boolean>; order: string[]; favorites: FolderBookmark[] }
export const emptyFilePreferences = (): FilePreferences => ({ grid:false, showPreviews:false, sort:'name', descending:false, names:{}, covers:{}, hiddenOnHome:{}, hiddenLocalRoots:{}, order:[], favorites:[] })
export function readFilePreferences(): FilePreferences {
  try {
    const value = JSON.parse(localStorage.getItem('tauri.filePreferences') || '{}')
    return { grid:value.grid===true, showPreviews:value.showPreviews===true, sort:['name','size','modified'].includes(value.sort)?value.sort:'name', descending:value.descending===true,
      hiddenLocalRoots:Object.fromEntries(Object.entries(value.hiddenLocalRoots || {}).filter(([,v])=>typeof v==='boolean')) as Record<string,boolean>,
      covers:Object.fromEntries(Object.entries(value.covers || {}).filter(([,v])=>isPublicCover(v))) as Record<string,string>, hiddenOnHome:Object.fromEntries(Object.entries(value.hiddenOnHome || {}).filter(([,v])=>typeof v==='boolean')) as Record<string,boolean>,
      names:Object.fromEntries(Object.entries(value.names || {}).filter(([,v])=>typeof v==='string')) as Record<string,string>, order:Array.isArray(value.order)?value.order.filter((v:unknown)=>typeof v==='string'):[],
      favorites:Array.isArray(value.favorites)?value.favorites.filter((v:FolderBookmark)=>v&&typeof v.id==='string'&&typeof v.sourceId==='string'&&typeof v.path==='string'&&typeof v.name==='string'&&typeof v.local==='boolean'):[] }
  } catch { return emptyFilePreferences() }
}
export function sortedFiles<T extends { name:string; isDirectory:boolean; size:number; modified?:number }>(entries:T[], sort:FileSort, descending:boolean):T[] {
  // Keep Electron's pinyin/numeric ordering, tie-breaking and folder-first policy.
  const rows = entries.map(entry=>({name:entry.name,isDir:entry.isDirectory,size:entry.size,time:entry.modified||0,entry}))
  return OrderDir(sort==='modified'?'updated_at':sort,descending?'desc':'asc',rows).map(row=>(row as typeof rows[number]).entry)
}
