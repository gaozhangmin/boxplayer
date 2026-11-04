import { ITokenInfo } from '../user/userstore'
import { DRIVE115_APP_ID, DRIVE115_APP_SECRET } from '../secrets.generated'
import { tokenRefreshKey, withTokenRefreshLock } from '../user/tokenRefresh'

export { DRIVE115_APP_ID, DRIVE115_APP_SECRET }

const DRIVE115_AUTH_DEVICE_URL = 'https://passportapi.115.com/open/authDeviceCode'
const DRIVE115_QR_STATUS_URL = 'https://qrcodeapi.115.com/get/status/'
const DRIVE115_TOKEN_URL = 'https://passportapi.115.com/open/deviceCodeToToken'
const DRIVE115_REFRESH_URL = 'https://passportapi.115.com/open/refreshToken'

const base64UrlEncode = (input: ArrayBuffer): string => {
  const bytes = new Uint8Array(input)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  const base64 = btoa(binary)
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const randomString = (length: number) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  let output = ''
  for (let i = 0; i < array.length; i++) {
    output += chars[array[i] % chars.length]
  }
  return output
}

export const generatePkce = async () => {
  const codeVerifier = randomString(64)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  const codeChallenge = base64UrlEncode(digest)
  return { codeVerifier, codeChallenge }
}

export const buildQrImageUrl = (content: string) => {
  const params = new URLSearchParams({ size: '250x250', data: content })
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`
}

export const requestDeviceCode = async (clientId: string, codeChallenge: string, method = 'sha256') => {
  const effectiveClientId = (clientId || '').trim() || DRIVE115_APP_ID
  const body = new URLSearchParams({
    client_id: effectiveClientId,
    code_challenge: codeChallenge,
    code_challenge_method: method
  })
  const resp = await fetch(DRIVE115_AUTH_DEVICE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!resp.ok) return { error: '获取二维码失败' }
  const data = await resp.json()
  if (data?.error || data?.errno) return { error: data?.message || '获取二维码失败' }
  if (!data?.data?.uid) return { error: data?.message || '获取二维码失败' }
  return {
    uid: data.data.uid as string,
    time: data.data.time as string,
    sign: data.data.sign as string,
    qrcode: data.data.qrcode as string,
    error: ''
  }
}

export const pollDeviceStatus = async (uid: string, time: string, sign: string) => {
  const params = new URLSearchParams({ uid, time, sign })
  const resp = await fetch(`${DRIVE115_QR_STATUS_URL}?${params.toString()}`, { signal: AbortSignal.timeout(30_000) })
  if (!resp.ok) return { error: '获取扫码状态失败' }
  const data = await resp.json()
  if (data?.error || data?.errno) {
    return { error: data?.message || '获取扫码状态失败' }
  }
  return {
    state: data?.state ?? 0,
    status: data?.data?.status ?? 0,
    msg: data?.data?.msg || data?.message || '',
    error: ''
  }
}

export const exchangeDeviceCode = async (uid: string, codeVerifier: string) => {
  const body = new URLSearchParams({ uid, code_verifier: codeVerifier })
  const resp = await fetch(DRIVE115_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!resp.ok) return { error: '获取 access_token 失败' }
  const data = await resp.json()
  if (data?.error || data?.errno) {
    return { error: data?.message || '获取 access_token 失败' }
  }
  return { data: data?.data || data, error: '' }
}

const refresh115AccessTokenInternal = async (refreshToken: string) => {
  const body = new URLSearchParams({ refresh_token: refreshToken })
  if (DRIVE115_APP_ID) body.set('client_id', DRIVE115_APP_ID)
  if (DRIVE115_APP_SECRET) body.set('client_secret', DRIVE115_APP_SECRET)
  const resp = await fetch(DRIVE115_REFRESH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  })
  if (!resp.ok) return { error: '刷新 access_token 失败' }
  const data = await resp.json()
  if (data?.error || data?.errno || data?.code) {
    return { error: data?.message || '刷新 access_token 失败' }
  }
  const payload = data?.data || {}
  if (!payload?.access_token) return { error: '刷新 access_token 失败' }
  return {
    access_token: payload.access_token as string,
    refresh_token: (payload.refresh_token || refreshToken) as string,
    expires_in: payload.expires_in as number,
    token_type: payload.token_type || 'Bearer',
    error: ''
  }
}

export const refresh115AccessToken = async (refreshToken: string) =>
  withTokenRefreshLock(tokenRefreshKey('115', refreshToken), () => refresh115AccessTokenInternal(refreshToken))

const hashString = (value: string): string => {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

export const build115UserId = (refreshToken?: string, accessToken?: string) => {
  const base = refreshToken || accessToken || ''
  if (!base) return ''
  return `115_${hashString(base)}`
}

export const normalize115Token = (data: any): ITokenInfo | null => {
  if (!data?.access_token) return null
  const expireTime = new Date(Date.now() + (data.expires_in || 0) * 1000).toISOString()
  const userId = build115UserId(data.refresh_token, data.access_token)
  return {
    tokenfrom: '115',
    access_token: data.access_token,
    refresh_token: data.refresh_token || '',
    session_expires_in: 0,
    open_api_token_type: '',
    open_api_access_token: '',
    open_api_refresh_token: '',
    open_api_expires_in: 0,
    signature: '',
    device_id: '',
    expires_in: data.expires_in || 0,
    token_type: data.token_type || 'Bearer',
    user_id: userId,
    user_name: '115网盘',
    avatar: '',
    nick_name: '115网盘',
    default_drive_id: '',
    default_sbox_drive_id: '',
    resource_drive_id: '',
    backup_drive_id: '',
    sbox_drive_id: '',
    role: '',
    status: '',
    expire_time: expireTime,
    state: '',
    pin_setup: false,
    is_first_login: false,
    need_rp_verify: false,
    name: '115网盘',
    spu_id: '',
    is_expires: false,
    used_size: 0,
    total_size: 0,
    free_size: 0,
    space_expire: false,
    spaceinfo: '',
    vipname: '',
    vipIcon: '',
    vipexpire: '',
    pic_drive_id: '',
    signInfo: { signMon: -1, signDay: -1 }
  }
}
