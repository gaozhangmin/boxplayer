import { isPublicCover } from './coverImages'
import { OrderDir } from './electron/filenameorder'
import {compareTimes,entryTimes,type FileSort,type SourceSort,type FileFilter,type FileTimes} from './fileSorting'
export type {FileSort} from './fileSorting'
export interface FolderBookmark { id: string; sourceId: string; path: string; name: string; local: boolean }
export interface FilePreferences { grid: boolean; showPreviews: boolean; sort: FileSort; descending: boolean; names: Record<string,string>; covers: Record<string,string>; hiddenOnHome: Record<string,boolean>; hiddenLocalRoots: Record<string,boolean>; order: string[]; favorites: FolderBookmark[]; sourceSort:SourceSort; filter:FileFilter; times:Record<string,FileTimes>; watchedFiles:Record<string,number> }
export const emptyFilePreferences = (): FilePreferences => ({ grid:false, showPreviews:false, sort:'name', descending:false, names:{}, covers:{}, hiddenOnHome:{}, hiddenLocalRoots:{}, order:[], favorites:[],sourceSort:'name',filter:'all',times:{},watchedFiles:{} })
export function readFilePreferences(): FilePreferences {
  try {
    const value = JSON.parse(localStorage.getItem('tauri.filePreferences') || '{}')
    return { sourceSort:['manual','name','modified','added','watched'].includes(value.sourceSort)?value.sourceSort:Array.isArray(value.order)&&value.order.length?'manual':'name',filter:['all','video','image','document','subtitle'].includes(value.filter)?value.filter:'all',times:readTimes(value.times),watchedFiles:Object.fromEntries(Object.entries(value.watchedFiles||{}).filter(([,v])=>typeof v==='number'&&Number.isFinite(v)&&v>0)) as Record<string,number>,grid:value.grid===true, showPreviews:value.showPreviews===true, sort:['name','size','modified','added','watched'].includes(value.sort)?value.sort:'name', descending:value.descending===true,
      hiddenLocalRoots:Object.fromEntries(Object.entries(value.hiddenLocalRoots || {}).filter(([,v])=>typeof v==='boolean')) as Record<string,boolean>,
      covers:Object.fromEntries(Object.entries(value.covers || {}).filter(([,v])=>isPublicCover(v))) as Record<string,string>, hiddenOnHome:Object.fromEntries(Object.entries(value.hiddenOnHome || {}).filter(([,v])=>typeof v==='boolean')) as Record<string,boolean>,
      names:Object.fromEntries(Object.entries(value.names || {}).filter(([,v])=>typeof v==='string')) as Record<string,string>, order:Array.isArray(value.order)?value.order.filter((v:unknown)=>typeof v==='string'):[],
      favorites:Array.isArray(value.favorites)?value.favorites.filter((v:FolderBookmark)=>v&&typeof v.id==='string'&&typeof v.sourceId==='string'&&typeof v.path==='string'&&typeof v.name==='string'&&typeof v.local==='boolean'):[] }
  } catch { return emptyFilePreferences() }
}
export function sortedFiles<T extends { name:string; isDirectory:boolean; size:number; modified?:number;added?:number;watched?:number }>(entries:T[], sort:FileSort, descending:boolean):T[] {
  // Keep Electron's pinyin/numeric ordering, tie-breaking and folder-first policy.
  const rows = entries.map(entry=>({name:entry.name,isDir:entry.isDirectory,size:entry.size,time:entry.modified||0,entry}))
  if(sort==='name'||sort==='size')return (OrderDir(sort,descending?'desc':'asc',rows) as typeof rows).map(row=>row.entry)
  const named=(OrderDir('name','asc',rows) as typeof rows).map(row=>row.entry)
  return named.sort((a,b)=>Number(b.isDirectory)-Number(a.isDirectory)||compareTimes(entryTimes(a)[sort],entryTimes(b)[sort],descending))
}

function readTimes(value:unknown):Record<string,FileTimes>{if(!value||typeof value!=='object')return {};return Object.fromEntries(Object.entries(value).filter(([,v])=>v&&typeof v==='object').map(([key,v])=>[key,Object.fromEntries(Object.entries(v).filter(([field,time])=>['added','modified','watched'].includes(field)&&typeof time==='number'&&Number.isFinite(time)&&time>0))]))}
