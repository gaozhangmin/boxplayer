import { OrderDir } from './electron/filenameorder'
export type FileSort = 'name' | 'size' | 'modified' | 'added' | 'watched'
export type SourceSort = Exclude<FileSort, 'size'> | 'manual'
export type FileFilter = 'all' | 'video' | 'image' | 'document' | 'subtitle'
export interface FileTimes { added?: number; modified?: number; watched?: number }
export function timestamp(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? (/^\d+(\.\d+)?$/.test(value) ? Number(value) : Date.parse(value)) : NaN
  return Number.isFinite(number) && number > 0 ? (number < 100_000_000_000 ? number * 1000 : number) : undefined
}
export function compareTimes(a: unknown, b: unknown, descending: boolean): number {
  const left=timestamp(a),right=timestamp(b)
  if(left===undefined||right===undefined)return left===right?0:left===undefined?1:-1
  return (left-right)*(descending?-1:1)
}
export function sortSources<T extends {id:string;name:string}>(rows:T[],sort:SourceSort,descending:boolean,order:string[],times:Record<string,FileTimes>):T[]{
  const models=rows.map(row=>({name:row.name,isDir:false,size:0,time:0,row}))
  const named=(OrderDir('name',descending?'desc':'asc',models) as typeof models).map(model=>model.row)
  return named.sort((a,b)=>sort==='manual'?(order.includes(a.id)?order.indexOf(a.id):Infinity)-(order.includes(b.id)?order.indexOf(b.id):Infinity)||0:sort==='name'?0:compareTimes(times[a.id]?.[sort],times[b.id]?.[sort],descending))
}
export function matchesFileFilter(row:{name:string;isDirectory:boolean},filter:FileFilter):boolean{
  if(row.isDirectory||filter==='all')return true
  const extension=row.name.split('.').pop()?.toLowerCase()||''
  if(filter==='subtitle')return /^(srt|ass|ssa|vtt|sub|idx|sup|smi|sami|lrc|ttml)$/.test(extension)
  if(filter==='video')return /^(mp4|mkv|avi|mov|wmv|flv|webm|m4v|ts|mts|m2ts|mpg|mpeg|vob|iso|rm|rmvb|3gp|strm|m3u8)$/.test(extension)
  if(filter==='image')return /^(jpg|jpeg|png|gif|webp|bmp|svg|avif|heic|heif|tif|tiff)$/.test(extension)
  return /^(pdf|epub|txt|mobi|azw3|azw|fb2|cbz|cbr|doc|docx|docm|dot|rtf|odt|ppt|pptx|odp|wps|xls|xlsx|xlsm|xlsb|csv|tsv|md|html|mhtml|mht|json|xml|yaml|yml|log)$/.test(extension)
}
export function entryTimes(row:{name?:string;modified?:unknown;added?:unknown;watched?:unknown;createdAt?:unknown;updatedAt?:unknown;electronModel?:unknown}):FileTimes{
  const model=(row.electronModel||{}) as {time?:unknown;created_at?:unknown;updated_at?:unknown}
  return {modified:timestamp(row.modified??row.updatedAt??model.updated_at??model.time),added:timestamp(row.added??row.createdAt??model.created_at),watched:timestamp(row.watched)}
}
