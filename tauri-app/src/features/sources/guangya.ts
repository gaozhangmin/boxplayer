import type { SourceDriver } from './contracts'
import { json } from './transport'

const api = 'https://api.guangyapan.com'
type Item = Record<string, unknown>
function object(value: unknown): Item {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Item : {}
}
function result(value: unknown): Item {
  const envelope = object(value)
  if ((envelope.code !== undefined && Number(envelope.code) !== 0) || envelope.success === false) {
    throw new Error('光鸭云盘请求失败，请检查账号或来源权限')
  }
  return object(envelope.data ?? envelope)
}
export const guangya: SourceDriver = {
  async search(account,query,cursor){const {searchGuangya}=await import('@/features/files/drive/guangyaSearch');return searchGuangya(account,query,cursor)},
  async list(account,parent,cursor){const {listGuangya}=await import('@/features/files/drive/guangyaListing');return listGuangya(account,parent,cursor)},
  async resolve(account, entry) {
    if (account.providerId !== 'guangya' || entry.isDirectory || !entry.id) throw new Error('光鸭云盘文件无效')
    const data = result(await json(account, 'POST', api + '/nd.bizuserres.s/v1/get_res_download_url', { fileId: entry.id }))
    const url = new URL(String(data.signedURL || data.signedUrl || data.url || data.downloadUrl || data.download_url || data.cdnUrl || data.cdn_url || ''))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('光鸭云盘下载地址无效')
    return { schemaVersion: 1, sourceId: account.id, accountId: account.id, fileId: entry.id, url: url.href, headers: { Referer: 'https://www.guangyapan.com/', Origin: 'https://www.guangyapan.com' } }
  },
}
