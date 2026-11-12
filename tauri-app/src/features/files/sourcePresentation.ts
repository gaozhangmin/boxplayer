import type { Account } from '@/features/sources/contracts'
export function validatedEndpoint(account: Account, value: string): string {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.href.includes('?') || url.href.includes('#')) throw new Error('线路地址仅支持无账号、查询参数和片段的 HTTP(S) 地址')
  if (!account.authOrigins.some(origin => { try { return new URL(origin).origin === url.origin } catch { return false } })) throw new Error('新线路尚未授权，请重新登录授权后使用')
  return url.href.replace(/\/$/, '')
}
export function reorderCard(ids: string[], source: string, target: string): string[] {
  if (source === target || !ids.includes(source) || !ids.includes(target)) return [...ids]
  const result = ids.filter(id => id !== source)
  result.splice(ids.indexOf(target), 0, source)
  return result
}

const providerIcons:Record<string,string>={alist:'alist',webdav:'webdav',smb:'smb',nfs:'nfs',ftp:'ftp','139':'cloud139','189':'cloud189','alipan-open':'aliyun',aliyun:'aliyun',baidu:'baidu','123':'cloud123','115':'drive115',quark:'quark',pikpak:'pikpak',onedrive:'onedrive',google:'google-drive',dropbox:'dropbox',box:'box',jellyfin:'jellyfin',emby:'emby',plex:'plex',guangya:'guangya'}
export function providerIcon(provider?:string){return provider&&providerIcons[provider]?'/source-icons/'+providerIcons[provider]+(['webdav','smb','nfs'].includes(provider)?'.png':'.svg'):undefined}
