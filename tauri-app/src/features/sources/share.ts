// Protocols ported from src/drive/share.ts and provider share.ts adapters.
// Call only after explicit user action: these endpoints create public cloud shares.
import type { Account } from './contracts'
import { nativeCall } from '@/platform/native'
import { json, request, text } from './transport'

const supported = new Set(['aliyun', '123', 'pikpak', 'guangya', 'dropbox', 'onedrive', 'box', 'google', 'quark'])
export function supportsSourceShare(account: Account): boolean { return supported.has(account.providerId) }
type Data = Record<string, any>
function checked(data: Data): Data {
  if (!data || data.error || data.success === false || data.status === 'error'
    || (data.code !== undefined && data.code !== 0 && data.code !== 200)) throw new Error('创建分享链接失败，请检查账号权限')
  return data
}
function link(url: unknown, password?: unknown): { url: string; password?: string } {
  if (typeof url !== 'string' || !url) throw new Error('提供商未返回分享链接')
  let parsed: URL
  try { parsed = new URL(url) } catch { throw new Error('提供商返回的分享链接无效') }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('提供商返回的分享链接无效')
  return { url, ...(typeof password === 'string' && password ? { password } : {}) }
}
const seg = encodeURIComponent
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** Single-item, default-expiration share. No credentials or Electron stores in renderer. */
export async function createSourceShare(account: Account, fileId: string, title: string): Promise<{ url: string; password?: string }> {
  if (!supportsSourceShare(account)) throw new Error('当前来源不支持创建分享链接')
  if (!account.id || !fileId.trim()) throw new Error('分享文件标识无效')
  const call = async (method: string, url: string, body?: unknown) => checked(await json<Data>(account, method, url, body))
  switch (account.providerId) {
    case 'aliyun': {
      let location: Data
      try { location = JSON.parse(fileId) } catch { throw new Error('阿里云盘文件位置无效') }
      if (!location || typeof location.driveId !== 'string' || !location.driveId || typeof location.fileId !== 'string' || !location.fileId || location.fileId === 'root') throw new Error('阿里云盘文件位置无效')
      const data = await call('POST', 'https://api.aliyundrive.com/adrive/v2/share_link/create', {
        drive_id: location.driveId, expiration: '', share_pwd: '', share_name: title, file_id_list: [location.fileId],
      })
      return link(data.share_url, data.share_pwd)
    }
    case '123': {
      // Account.id is a native UUID, never a provider UID. Do not manufacture a share domain from it.
      const uid = account.userId?.replace(/^cloud123_/, '')
      if (!uid || !/^\d+$/.test(uid) || !/^\d+$/.test(fileId)) throw new Error('123 分享缺少有效的用户或文件标识')
      const response = await request(account, 'POST', 'https://open-api.123pan.com/api/v1/share/create',
        JSON.stringify({ shareName: title || '分享链接', shareExpire: 0, fileIDList: fileId }),
        { 'Content-Type': 'application/json', Platform: 'open_platform' })
      const envelope = checked(JSON.parse(text(response)))
      if (envelope.code !== 0 || !envelope.data?.shareKey || !(envelope.data.shareID ?? envelope.data.shareId)) throw new Error('创建123分享链接失败')
      return link(`https://${uid}.share.123pan.cn/123pan/${seg(envelope.data.shareKey)}`)
    }
    case 'pikpak': {
      // Captcha signing, token injection and the share POST stay entirely native.
      const data = checked(await nativeCall<Data>('pikpak_create_share', { accountId: account.id, fileId }))
      if (!(data.share_id || data.id)) throw new Error('创建 PikPak 分享失败')
      return link(data.share_url || data.share_link, data.pass_code || data.passcode)
    }
    case 'guangya': {
      const envelope = await call('POST', 'https://api.guangyapan.com/nd.bizuserres.s/v1/share_file', {
        fileIds: [fileId], title: title || '分享链接', validateDuration: 0, shareType: 1,
        code: '', autoFillCode: true, trafficLimit: '0', maxRestoreCount: 0, downloadType: 1,
      })
      const data = envelope.data || envelope
      const id = data.shareId || data.id || data.share_id
      return link(data.shareUrl || data.url || data.link || (id ? `https://www.guangyapan.com/s/${seg(id)}` : ''), data.code || data.sharePwd || data.pwd)
    }
    case 'dropbox': {
      const list = async () => {
        let cursor: string | undefined
        for (let page = 0; page < 100; page++) {
          const data = await call('POST', 'https://api.dropboxapi.com/2/sharing/list_shared_links', cursor ? { cursor } : { path: fileId, direct_only: true })
          if (data.links?.[0]?.url) return data.links[0].url as string
          if (!data.has_more) return undefined
          if (!data.cursor || data.cursor === cursor) throw new Error('Dropbox 分享分页无效')
          cursor = data.cursor
        }
        throw new Error('Dropbox 分享分页超出限制')
      }
      const existing = await list()
      if (existing) return link(existing)
      try {
        const data = await call('POST', 'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', { path: fileId })
        return link(data.url)
      } catch (error) {
        // Native transport hides HTTP error bodies; re-read to recover an already-exists race.
        const raced = await list()
        if (raced) return link(raced)
        throw error
      }
    }
    case 'onedrive': {
      const data = await call('POST', `https://graph.microsoft.com/v1.0/me/drive/items/${seg(fileId)}/createLink`, { type: 'view', scope: 'anonymous' })
      return link(data.link?.webUrl)
    }
    case 'box': {
      const base = 'https://api.box.com/2.0'
      // SourceEntry ids are opaque and do not encode folder/file type. Probe read-only first.
      const data = await call('GET', `${base}/files/${seg(fileId)}?fields=id,type`)
        .catch(() => call('GET', `${base}/folders/${seg(fileId)}?fields=id,type`))
      if (!['file', 'folder'].includes(data.type) || data.id !== fileId) throw new Error('Box 分享目标无效')
      const shared = await call('PUT', `${base}/${data.type === 'folder' ? 'folders' : 'files'}/${seg(fileId)}?fields=shared_link,id,name,type`, {
        shared_link: { access: 'open', permissions: { can_download: true } },
      })
      return link(shared.shared_link?.url)
    }
    case 'google': {
      const base = `https://www.googleapis.com/drive/v3/files/${seg(fileId)}`
      const data = await call('GET', `${base}/permissions?supportsAllDrives=true&fields=permissions(id,type,role,allowFileDiscovery)`)
      if (!Array.isArray(data.permissions)) throw new Error('Google Drive 分享权限响应无效')
      if (!data.permissions.some((p: Data) => p.type === 'anyone')) {
        const permission = await call('POST', `${base}/permissions?supportsAllDrives=true`, { type: 'anyone', role: 'reader' })
        if (!permission.id) throw new Error('创建 Google Drive 分享权限失败')
      }
      const file = await call('GET', `${base}?fields=id,name,webViewLink&supportsAllDrives=true`)
      return link(file.webViewLink)
    }
    case 'quark': {
      const endpoint = (path: string, extra: Record<string, string> = {}) => {
        const params = new URLSearchParams({ pr: 'ucpro', fr: 'pc', uc_param_str: '', __t: String(Date.now()), __dt: '1000', ...extra })
        return `https://drive-pc.quark.cn/1/clouddrive/${path}?${params}`
      }
      const created = await call('POST', endpoint('share'), { fid_list: [fileId], title: title || '夸克分享', url_type: 1, expired_type: 1 })
      let id = created.data?.task_resp?.data?.share_id || created.data?.share_id
      const taskId = created.data?.task_id
      for (let retry = 0; !id && taskId && retry < 40; retry++) {
        const task = (await call('GET', endpoint('task', { task_id: taskId, retry_index: String(retry) }))).data
        if (!task || (task.code !== undefined && task.code !== 0 && task.code !== 200) || Number(task.status) >= 400 || Number(task.status) === 3) throw new Error('夸克分享任务失败')
        id = task.share_id
        if (!id && task.status === 2) break
        if (!id) await sleep(600)
      }
      if (!id) throw new Error('夸克分享任务未完成')
      const data = (await call('POST', endpoint('share/password'), { share_id: id })).data || {}
      const pwdId = data.pwd_id || data.share_id || id
      return link(data.share_url || data.url || `https://pan.quark.cn/s/${seg(pwdId)}`, data.share_pwd || data.passcode || data.password)
    }
    default: throw new Error('当前来源不支持创建分享链接')
  }
}
