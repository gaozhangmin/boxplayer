import {mapCloud189FileToAliModel} from '@/features/files/drive/electron/providers/cloud189Metadata'
import {cloud189FamilyId} from '@/features/files/drive/electron/providers/cloud189Identity'
import {useFileSourcesStore} from '@/stores/fileSources'
import {preserveCloud189LargeIds} from '@/features/files/drive/electron/providers/cloud189Identity'
import type { Account, SourceDriver } from './contracts'
import { json } from './transport'
const api = 'https://api.cloud.189.cn/'
type Scope = { fileId: string; familyId?: string; families?: boolean }
type Item = Record<string, unknown>
function object(value: unknown): Item { return value && typeof value === 'object' && !Array.isArray(value) ? value as Item : {} }
const owner=(account:Account)=>JSON.stringify([account.id,account.userId||'',account.deviceId||'',account.baseUrl])
function accountCheck(account:Account){const expected=owner(account);return ()=>{const actual=useFileSourcesStore().accounts.find(value=>value.id===account.id);if(!actual||actual.providerId!=='189'||owner(actual)!==expected)throw new Error('天翼来源账号已移除或身份已变化')}}
function id(scope: Scope) { return JSON.stringify(scope) }
function scope(value: string): Scope {
  const data = JSON.parse(value) as Scope
  if (typeof data.fileId !== 'string' || data.familyId !== undefined && !/^\d+$/.test(data.familyId) || data.families !== undefined && data.families !== true) throw new Error('天翼空间位置无效')
  return data
}
function check(value: Item) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('天翼云盘响应无效')
  if (value.errorCode || value.success === false || value.res_code !== undefined && Number(value.res_code) !== 0 || value.code && value.code !== 'SUCCESS') throw new Error('天翼云盘请求失败，请检查账号或空间权限')
  return value
}
async function get(account: Account, action: string, params: Record<string, string>) { return check(await json<Item>(account, 'GET', api + action + '?' + new URLSearchParams(params),undefined,raw=>JSON.parse(preserveCloud189LargeIds(raw)))) }
export {id as cloud189NativeId,scope as cloud189NativeScope}
export const cloud189: SourceDriver = {
  async list(account, parent, cursor) {
    if (account.providerId !== '189') throw new Error('天翼来源不匹配')
    const active=accountCheck(account);active()
    if (cursor&&['','root','backup_root','cloud189_root'].includes(parent))throw new Error('天翼聚合根不支持分页游标')
    if (['','root','backup_root','cloud189_root'].includes(parent)) return { entries: [{ id: id({ fileId: '-11' }), name: '个人空间', isDirectory: true, size: 0, playable: false }, { id: id({ fileId: '', families: true }), name: '家庭空间', isDirectory: true, size: 0, playable: false }] }
    const location = scope(parent)
    if (location.families) {
      if(cursor)throw new Error('天翼家庭集合不支持分页游标')
      const data = await get(account, 'family/manage/getFamilyList.action', {})
      active()
      const families = data.familyInfoResp ?? object(data.data).familyInfoResp
      if (!Array.isArray(families)) throw new Error('天翼家庭空间列表无效')
      return { entries: families.map(value => { const item = object(value);if(typeof item.familyId==='number'&&!Number.isSafeInteger(item.familyId))throw new Error('天翼家庭标识超出数值精度');const familyId = String(item.familyId || '');if (!/^\d+$/.test(familyId)) throw new Error('天翼家庭空间标识无效');return { id: id({ fileId: '', familyId }), name: String(item.remarkName || '家庭空间 ' + familyId), isDirectory: true, size: 0, playable: false } }) }
    }
    let page=1,previous:string[]=[],tokens:string[]=[]
    if(cursor){
      let value:any;try{value=JSON.parse(cursor)}catch{throw new Error('天翼分页位置无效')}
      if(!value||value.source!==owner(account)||value.parent!==id(location)||!Number.isSafeInteger(value.page)||value.page<2||!Array.isArray(value.ids)||value.ids.some((item:unknown)=>typeof item!=='string')||new Set(value.ids).size!==value.ids.length||!Array.isArray(value.tokens)||value.tokens.some((item:unknown)=>typeof item!=='string')||value.tokens.length!==value.page-1)throw new Error('天翼分页范围无效')
      page=value.page;previous=value.ids;tokens=value.tokens
    }
    const params: Record<string, string> = { folderId: location.fileId, fileType: '0', mediaAttr: '0', iconOption: '5', pageNum: String(page), pageSize: '100', orderBy: location.familyId ? '1' : 'filename', descending: 'false' }
    if (location.familyId) params.familyId = location.familyId
    else params.recursive = '0'
    const data = await get(account, (location.familyId ? 'family/file/' : '') + 'listFiles.action', params)
    active()
    const ao = object(data.fileListAO ?? object(data.data).fileListAO ?? data)
    if (!Array.isArray(ao.folderList) && !Array.isArray(ao.fileList)) throw new Error('天翼目录响应无效')
    const entries = [...(Array.isArray(ao.folderList) ? ao.folderList.map(value => ({ value, folder: true })) : []), ...(Array.isArray(ao.fileList) ? ao.fileList.map(value => ({ value, folder: false })) : [])].map(({ value, folder }) => {
      const item = object(value);if(typeof item.familyId==='number'&&!Number.isSafeInteger(item.familyId))throw new Error('天翼家庭标识超出数值精度');if(item.familyId!==undefined&&String(item.familyId)!==(location.familyId||''))throw new Error('天翼目录响应空间不匹配');const rawId = item.id || item.fileId || item.folderId
      if(typeof rawId!=='string'&&typeof rawId!=='number')throw new Error('天翼文件标识无效')
      if (typeof rawId === 'number' && !Number.isSafeInteger(rawId)) throw new Error('天翼文件标识超出数值精度')
      const fileId = String(rawId ?? '');const name = String(item.name || item.fileName || item.folderName || '')
      if(fileId.length>4096||/[\u0000-\u0020/\\]/.test(fileId))throw new Error('天翼文件标识无效')
      if(item.size!==undefined&&(typeof item.size!=='string'&&typeof item.size!=='number'||!Number.isSafeInteger(Number(item.size))||Number(item.size)<0))throw new Error('天翼文件大小无效')
      if (!fileId || !name) throw new Error('天翼文件信息无效')
      if(typeof(item.name||item.fileName||item.folderName)!=='string'||item.icon!==undefined&&(!item.icon||typeof item.icon!=='object'||Array.isArray(item.icon)))throw new Error('天翼文件名称或缩略图字段无效')
      const nativeId=id({fileId,...(location.familyId?{familyId:location.familyId}:{})}),originalParent=location.familyId?cloud189FamilyId(location.familyId,location.fileId):location.fileId
      // The original list sets collection type, family and known request parent
      // before mapping. Preserve that behavior, then adapt only native IDs.
      const mapped=mapCloud189FileToAliModel({...item,isFolder:folder,familyId:location.familyId||'',parentId:originalParent},account.id,originalParent)
      if(!Number.isSafeInteger(mapped.size)||mapped.size<0||!Number.isFinite(mapped.time)||typeof mapped.thumbnail!=='string'||mapped.name!==name)throw new Error('天翼原文件模型媒体字段无效')
      const electronModel={...mapped,file_id:nativeId,parent_file_id:parent}
      return {id:nativeId,name:mapped.name,isDirectory:mapped.isDir,size:mapped.size,modified:mapped.time,playable:!mapped.isDir&&['video','video2'].includes(mapped.category),originalParent:parent,electronModel}
    })
    const ids=entries.map(row=>row.id)
    if(new Set(ids).size!==ids.length||ids.some(value=>previous.includes(value)))throw new Error('天翼列表重复文件标识')
    const token=String(page)
    if(tokens.includes(token))throw new Error('天翼分页循环')
    return {entries,nextCursor:entries.length>=100?JSON.stringify({source:owner(account),parent:id(location),page:page+1,ids:[...previous,...ids],tokens:[...tokens,token]}):undefined}
  },
  async resolve(account, entry) {
    if (account.providerId !== '189' || entry.isDirectory) throw new Error('天翼文件无效')
    const active=accountCheck(account);active()
    const location = scope(entry.id)
    if (!location.fileId || location.fileId === '-11' || location.families) throw new Error('天翼文件无效')
    const params: Record<string, string> = { fileId: location.fileId }
    if (location.familyId) params.familyId = location.familyId
    else { params.dt = '3';params.flag = '1' }
    const data = await get(account, (location.familyId ? 'family/file/' : '') + 'getFileDownloadUrl.action', params)
    active()
    const url = new URL(String(data.fileDownloadUrl || data.downloadUrl || data.url || '').replace(/&amp;/g, '&').replace(/^http:\/\//i, 'https://'))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('天翼下载地址无效')
    return { schemaVersion: 1, sourceId: account.id, accountId: account.id, fileId: entry.id, url: url.href, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', Referer: 'https://cloud.189.cn' } }
  },
}
