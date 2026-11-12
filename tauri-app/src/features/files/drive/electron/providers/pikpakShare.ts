import {pikpakShareFetch} from '../../shareProviderTransport'
export type PikPakShareCreateResult = {
  shareId: string
  shareUrl: string
  passCode: string
  error: string
}

const PIKPAK_API_HOST = 'https://api-drive.mypikpak.com'

const parsePikPakError = (data: any, fallback: string) => {
  return data?.error_description || data?.message || data?.error || fallback
}

export const toPikPakExpirationDays = (expiration: string): number => {
  if (!expiration) return -1
  const target = new Date(expiration).getTime()
  if (Number.isNaN(target)) return -1
  const diff = target - Date.now()
  if (diff <= 0) return 1
  return Math.max(1, Math.ceil(diff / (24 * 60 * 60 * 1000)))
}

export const apiPikPakShareCreate = async (
  user_id: string,
  fileIDList: string[],
  needPassword: boolean,
  expiration: string
): Promise<PikPakShareCreateResult> => {
  const result: PikPakShareCreateResult = { shareId: '', shareUrl: '', passCode: '', error: '创建 PikPak 分享链接失败' }
  try {
    const resp = await pikpakShareFetch(user_id,`${PIKPAK_API_HOST}/drive/v1/share`, {
      method: 'POST',
      body: JSON.stringify({
        file_ids: fileIDList,
        share_to: needPassword ? 'encryptedlink' : 'publiclink',
        expiration_days: toPikPakExpirationDays(expiration),
        pass_code_option: needPassword ? 'REQUIRED' : 'NOT_REQUIRED'
      })
    })
    const data = await resp.json().catch(() => undefined)
    if (!resp.ok || data?.error) {
      result.error = parsePikPakError(data, result.error)
      return result
    }
    result.shareId = String(data?.share_id || data?.id || '')
    result.shareUrl = data?.share_url || data?.share_link || ''
    result.passCode = data?.pass_code || data?.passcode || ''
    result.error = result.shareId && result.shareUrl ? '' : '创建 PikPak 分享链接失败'
  } catch (err: any) {
    result.error = err?.message || result.error
  }
  return result
}

const PIKPAK_SHARE_PREFIX = 'pikpak:'

export const encodePikPakShareId = (shareId: string) => `${PIKPAK_SHARE_PREFIX}${shareId}`

export const parsePikPakShareLink = (value: string): { id: string; pwd: string } => {
  const id = value.match(/(?:mypikpak|pikpak)\.com\/s\/([A-Za-z0-9_-]+)/i)?.[1] || ''
  const pwd = value.match(/[?&#]pass_code=([A-Za-z0-9]+)/i)?.[1] || value.match(/(?:提取码|密码|pass_code|passcode|pwd)[:：\s]*([A-Za-z0-9]+)/i)?.[1] || ''
  return { id: id ? encodePikPakShareId(id) : '', pwd }
}
