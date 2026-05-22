import { MD5 } from 'crypto-js'
import type { ITokenInfo } from '../user/userstore'
import { humanSize } from '../utils/format'

const PIKPAK_API_HOST = 'https://api-drive.mypikpak.com'
const PIKPAK_USER_HOST = 'https://user.mypikpak.com'
const PIKPAK_CLIENT_ID = ''
const PIKPAK_CLIENT_SECRET = ''
const CLIENT_VERSION = '1.47.1'
const PACKAGE_NAME = 'com.pikcloud.pikpak'
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const CAPTCHA_SALTS = [
  'Gez0T9ijiI9WCeTsKSg3SMlx',
  'zQdbalsolyb1R/',
  'ftOjr52zt51JD68C3s',
  'yeOBMH0JkbQdEFNNwQ0RI9T3wU/v',
  'BRJrQZiTQ65WtMvwO',
  'je8fqxKPdQVJiy1DM6Bc9Nb1',
  'niV',
  '9hFCW2R1',
  'sHKHpe2i96',
  'p7c5E6AcXQ/IJUuAEC9W6',
  '',
  'aRv9hjc9P+Pbn+u3krN6',
  'BzStcgE8qVdqjEH16l4',
  'SqgeZvL5j9zoHP95xWHt',
  'zVof5yaJkPe3VFpadPof'
]

type PikPakAuthResp = {
  access_token: string
  refresh_token: string
  expires_in?: number
  token_type?: string
  sub?: string
}

export const captchaSign = (deviceId: string, timestamp: string): string => {
  let sign = PIKPAK_CLIENT_ID + CLIENT_VERSION + PACKAGE_NAME + deviceId + timestamp
  for (const salt of CAPTCHA_SALTS) {
    sign = MD5(sign + salt).toString()
  }
  return `1.${sign}`
}

const buildHeaders = (deviceId?: string, accessToken?: string): HeadersInit => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': DEFAULT_USER_AGENT
  }
  if (deviceId) headers['X-Device-Id'] = deviceId
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  return headers
}

const parsePikPakError = (data: any, fallback: string) => {
  if (!data) return fallback
  if (data.error === 'invalid_account_or_password') return 'PikPak 账号或密码错误'
  return data.error_description || data.message || data.error || fallback
}

const pikpakJson = async <T>(url: string, init: RequestInit, fallback: string): Promise<T> => {
  const resp = await fetch(url, init)
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || data?.error) {
    throw new Error(parsePikPakError(data, fallback))
  }
  return data as T
}

const emptyToken = (): ITokenInfo => ({
  tokenfrom: 'pikpak',
  access_token: '',
  refresh_token: '',
  session_expires_in: 0,
  open_api_token_type: '',
  open_api_access_token: '',
  open_api_refresh_token: '',
  open_api_expires_in: 0,
  expires_in: 0,
  token_type: '',
  user_id: '',
  user_name: '',
  avatar: '',
  nick_name: '',
  default_drive_id: 'pikpak',
  default_sbox_drive_id: '',
  resource_drive_id: '',
  backup_drive_id: '',
  sbox_drive_id: '',
  role: '',
  status: '',
  expire_time: '',
  state: '',
  pin_setup: false,
  is_first_login: false,
  need_rp_verify: false,
  name: '',
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
  device_id: '',
  signature: '',
  signInfo: {
    signMon: -1,
    signDay: -1
  }
})

export const loginPikPak = async (username: string, password: string): Promise<ITokenInfo> => {
  const deviceId = MD5(`${username}${password}`).toString()
  const loginUrl = `${PIKPAK_USER_HOST}/v1/auth/signin`
  const meta: Record<string, string> = {}
  if (/^\w+([-+.]\w+)*@\w+([-.]\w+)*\.\w+([-.]\w+)*$/.test(username)) {
    meta.email = username
  } else if (/^\d{11,18}$/.test(username)) {
    meta.phone_number = username
  } else {
    meta.username = username
  }
  const captcha = await pikpakJson<{ captcha_token?: string }>(`${PIKPAK_USER_HOST}/v1/shield/captcha/init`, {
    method: 'POST',
    headers: buildHeaders(deviceId),
    body: JSON.stringify({
      client_id: PIKPAK_CLIENT_ID,
      action: `POST:${loginUrl}`,
      device_id: deviceId,
      meta
    })
  }, '获取 PikPak 验证信息失败')
  if (!captcha.captcha_token) throw new Error('获取 PikPak 验证信息失败')

  const auth = await pikpakJson<PikPakAuthResp>(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Captcha-Token': captcha.captcha_token
    },
    body: JSON.stringify({
      client_id: PIKPAK_CLIENT_ID,
      client_secret: PIKPAK_CLIENT_SECRET,
      password,
      username,
      captcha_token: captcha.captcha_token
    })
  }, 'PikPak 登录失败')

  const token = emptyToken()
  token.access_token = auth.access_token
  token.refresh_token = auth.refresh_token
  token.expires_in = Number(auth.expires_in || 7200)
  token.token_type = auth.token_type || 'Bearer'
  token.user_id = `pikpak_${auth.sub || username}`
  token.user_name = username
  token.nick_name = username
  token.name = username
  token.device_id = deviceId
  token.expire_time = new Date(Date.now() + token.expires_in * 1000).toISOString()
  return token
}

export const refreshPikPakAccessToken = async (token: ITokenInfo): Promise<ITokenInfo | null> => {
  if (!token.refresh_token) return null
  const auth = await pikpakJson<PikPakAuthResp>(`${PIKPAK_USER_HOST}/v1/auth/token`, {
    method: 'POST',
    headers: buildHeaders(token.device_id),
    body: JSON.stringify({
      client_id: PIKPAK_CLIENT_ID,
      refresh_token: token.refresh_token,
      grant_type: 'refresh_token'
    })
  }, '刷新 PikPak Token 失败')
  token.access_token = auth.access_token
  token.refresh_token = auth.refresh_token || token.refresh_token
  token.expires_in = Number(auth.expires_in || token.expires_in || 7200)
  token.token_type = auth.token_type || token.token_type || 'Bearer'
  token.user_id = token.user_id || `pikpak_${auth.sub || ''}`
  token.expire_time = new Date(Date.now() + token.expires_in * 1000).toISOString()
  token.tokenfrom = 'pikpak'
  token.default_drive_id = token.default_drive_id || 'pikpak'
  return token
}

export const apiPikPakAbout = async (token: ITokenInfo): Promise<any | null> => {
  if (!token.access_token) return null
  return pikpakJson<any>(`${PIKPAK_API_HOST}/drive/v1/about`, {
    method: 'GET',
    headers: buildHeaders(token.device_id, token.access_token)
  }, '获取 PikPak 空间信息失败').catch(() => null)
}

export const applyPikPakQuota = async (token: ITokenInfo): Promise<boolean> => {
  const about = await apiPikPakAbout(token)
  const quota = about?.quota || {}
  const total = Number(quota.limit || 0)
  const used = Number(quota.usage || 0)
  if (Number.isFinite(total) && total > 0) token.total_size = total
  if (Number.isFinite(used) && used >= 0) token.used_size = used
  if (token.total_size || token.used_size) {
    token.spaceinfo = `${humanSize(token.used_size)} / ${humanSize(token.total_size)}`
  }
  return true
}

export const pikpakAuthHeaders = (token: ITokenInfo): HeadersInit => buildHeaders(token.device_id, token.access_token)
