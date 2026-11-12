import {Cloud139RequestRejected} from './cloud139Errors'
import {cloud139Id} from './cloud139Identity'
import {useFileSourcesStore} from '@/stores/fileSources'
import {listFromResponse,mapCloud139FileToAliModel,type Cloud139FileItem} from '@/features/files/drive/electron/providers/cloud139Metadata'
import type { Account, SourceDriver } from './contracts'
import { json,SourceHttpError } from './transport'
type Item = Record<string, unknown>
export class MissingRoute extends Error {}
function object(value: unknown): Item { return value && typeof value === 'object' && !Array.isArray(value) ? value as Item : {} }
export function personalUrls(baseUrl: string, endpoint: string) {
  const url = new URL(baseUrl);const base = url.href.replace(/\/+$/, '')
  const primary = url.pathname.replace(/\/+$/, '') ? base + endpoint : base + '/orchestration' + endpoint
  const fallback = base.replace(/\/hcy\/orchestration$/i, '/orchestration').replace(/\/hcy$/i, '')
  const alternate = new URL(fallback).pathname.replace(/\/+$/, '') ? fallback + endpoint : fallback + '/orchestration' + endpoint
  return [...new Set([primary, alternate])]
}
export async function cloud139Call(account: Account, urls: string[], body: unknown,check:()=>void=()=>{},observe?:(data:Item)=>void) {
  for (let index = 0; index < urls.length; index++) {
    try {
      check();const data = await json<Item>(account, 'POST', urls[index]!, body)
      if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('移动云盘响应无效')
      const message = String(data.message || data.msg || data.error_msg || '')
      if (/route not found/i.test(message)) throw new MissingRoute('移动云盘接口路径不存在')
      if (data.success === false || ['9000', '9008', '9100'].includes(String(data.code ?? ''))) throw new Cloud139RequestRejected('移动云盘请求失败，请检查账号或来源权限')
      observe?.(data);check();return data
    } catch (error) {
      check();if(error instanceof Cloud139RequestRejected)throw error
      const missing = error instanceof MissingRoute || error instanceof SourceHttpError&&error.status===404 || error instanceof Error && /（404）/.test(error.message)
      if (!missing) {if(error instanceof SourceHttpError&&error.status>=400&&error.status<500&&error.status!==408)throw new Cloud139RequestRejected(error.message);throw error}
      if (index === urls.length - 1) throw new MissingRoute('移动云盘接口路径不存在')
    }
  }
  throw new MissingRoute('移动云盘没有可用的接口路径')
}
const owner=(account:Account)=>JSON.stringify([account.id,account.userId||'',account.deviceId||'',account.baseUrl])
function entries(data:Item,account:Account,parent:string){
 const raw=object(data.data??data),disk=object(raw.getDiskResult)
 const primary=raw.items??raw.list??raw.content??raw.files??raw.fileList??disk.catalogList
 const secondary=disk.contentList
 if(primary===undefined&&secondary===undefined||primary!==undefined&&!Array.isArray(primary)||secondary!==undefined&&!Array.isArray(secondary))throw Error('移动云盘目录响应无效')
 return listFromResponse(data).map((item:Cloud139FileItem)=>{
  if(!item||typeof item!=='object'||Array.isArray(item))throw Error('移动云盘文件模型无效')
  const id=cloud139Id(item.fileId||item.catalogId||item.catalogID||item.contentID)
  const actualParent=item.parentFileId??item.parentCatalogId
  if(actualParent!==undefined&&cloud139Id(actualParent,true)!==parent)throw Error('移动云盘文件父目录不匹配')
  if(item.type!==undefined&&!['folder','file'].includes(item.type)||item.type==='file'&&!!(item.catalogId||item.catalogID))throw Error('移动云盘文件类型冲突')
  const name=item.name||item.catalogName||item.contentName
  if(typeof name!=='string'||!name)throw Error('移动云盘文件缺少名称')
  const model=mapCloud139FileToAliModel(item,account.id,parent==='/'?'cloud139_root':parent)
  if(model.file_id!==id||model.name!==name||!Number.isSafeInteger(model.size)||model.size<0||!Number.isFinite(model.time)||typeof model.thumbnail!=='string')throw Error('移动云盘媒体字段无效')
  return {id,name,isDirectory:model.isDir,size:model.size,modified:model.time,playable:!model.isDir&&['video','video2'].includes(model.category),originalParent:parent==='/'?'':parent,electronModel:model}
 })
}
interface Position {mode:'new'|'old';value:string|number;source:string;parent:string;seen:string[];ids:string[]}
function position(account:Account,parent:string,cursor?:string):Position{
 if(!cursor)return {mode:'new',value:'',source:owner(account),parent,seen:[],ids:[]}
 let data:Position;try{data=JSON.parse(cursor)}catch{throw Error('移动云盘分页位置无效')}
 if(!data||data.source!==owner(account)||data.parent!==parent||!Array.isArray(data.seen)||data.seen.some(value=>typeof value!=='string')||new Set(data.seen).size!==data.seen.length||!Array.isArray(data.ids)||data.ids.some(value=>typeof value!=='string')||new Set(data.ids).size!==data.ids.length)throw Error('移动云盘分页范围无效')
 if(data.mode==='new'&&typeof data.value==='string'&&data.value&&data.seen.includes(data.value)||data.mode==='old'&&Number.isSafeInteger(data.value)&&Number(data.value)>=101&&(Number(data.value)-1)%100===0)return data
 throw Error('移动云盘分页位置无效')
}
export const cloud139: SourceDriver = {
  async list(account, parent, cursor) {
    if (account.providerId !== '139') throw new Error('移动云盘来源不匹配')
    parent=cloud139Id(parent,true)
    const signature=owner(account),check=()=>{const actual=useFileSourcesStore().accounts.find(item=>item.id===account.id);if(!actual||actual.providerId!=='139'||owner(actual)!==signature)throw Error('移动云盘来源账号已移除或身份已变化')}
    check();const page=position(account,parent,cursor)
    const finish=(data:Item,mode:'new'|'old',next:string|number|undefined)=>{
      check();const rows=entries(data,account,parent),ids=rows.map(row=>row.id)
      if(new Set(ids).size!==ids.length||ids.some(id=>page.ids.includes(id)))throw Error('移动云盘列表重复文件标识')
      const seen=next===undefined?page.seen:[...page.seen,String(next)]
      if(next!==undefined&&page.seen.includes(String(next)))throw Error('移动云盘分页游标重复')
      return {entries:rows,nextCursor:next===undefined?undefined:JSON.stringify({mode,value:next,source:signature,parent,seen,ids:[...page.ids,...ids]})}
    }
    if(page.mode==='new'){
      try{
        const data=await cloud139Call(account,personalUrls(account.baseUrl,'/file/list'),{imageThumbnailStyleList:['Small','Large'],orderBy:'updated_at',orderDirection:'DESC',pageInfo:{pageCursor:page.value,pageSize:100},parentFileId:parent})
        const raw=object(data.data??data),info=object(raw.pageInfo),next=info.nextPageCursor??info.nextCursor??raw.nextPageCursor??raw.nextCursor
        if(next!==undefined&&typeof next!=='string')throw Error('移动云盘分页游标无效')
        return finish(data,'new',next||undefined)
      }catch(error){if(!(error instanceof MissingRoute)||cursor)throw error}
    }
    const offset=page.mode==='old'?Number(page.value):1
    const data=await cloud139Call(account,['https://yun.139.com/orchestration/personalCloud/catalog/v1.0/getDisk'],{catalogID:parent==='/'?'root':parent,sortDirection:1,startNumber:offset,endNumber:offset+99,filterType:0,catalogSortType:0,contentSortType:0,commonAccountInfo:{account:account.userId,accountType:1}})
    check();const count=entries(data,account,parent).length
    return finish(data,'old',count>=100?offset+100:undefined)
  },
  async resolve(account, entry) {
    if (account.providerId !== '139' || entry.isDirectory || !entry.id) throw new Error('移动云盘文件无效')
    const data = await cloud139Call(account, personalUrls(account.baseUrl, '/file/getDownloadUrl'), { fileId: entry.id });const raw = object(data.data ?? data)
    const url = new URL(String(raw.cdnUrl || raw.url || raw.downloadUrl || ''))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('移动云盘下载地址无效')
    return { schemaVersion: 1, sourceId: account.id, accountId: account.id, fileId: entry.id, url: url.href, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', Referer: 'https://yun.139.com/', Origin: 'https://yun.139.com' } }
  },
}
