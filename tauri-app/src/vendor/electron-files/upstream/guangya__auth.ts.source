import type { ITokenInfo } from '../user/userstore'
import { GUANGYA_CLIENT_ID } from '../secrets.generated'
import { humanSize } from '../utils/format'
import { tokenRefreshKey, withTokenRefreshLock } from '../user/tokenRefresh'

export { GUANGYA_CLIENT_ID }

export const GUANGYA_WEB_URL = 'https://www.guangyapan.com'
export const GUANGYA_ACCOUNT_URL = 'https://account.guangyapan.com'
export const GUANGYA_API_URL = 'https://api.guangyapan.com'
export const GUANGYA_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

export interface GuangyaSmsState {
  phoneNumber: string
  captchaToken: string
  verificationId: string
}

export const normalizeGuangyaPhoneNumber = (value: string): string => {
  const text = value.trim().replace(/\s+/g, ' ')
  const compact = text.replace(/[\s-]/g, '')
  if (/^1\d{10}$/.test(compact)) return `+86 ${compact}`
  if (/^\+861\d{10}$/.test(compact)) return `+86 ${compact.slice(3)}`
  if (/^00861\d{10}$/.test(compact)) return `+86 ${compact.slice(4)}`
  return text
}

const hashString = (value: string): string => {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

export const generateGuangyaDid = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const generateGuangyaTraceparent = (): string => {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `00-${hex.slice(0, 32)}-${hex.slice(32, 48)}-01`
}

const tokenHex = (length: number): string => {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const guangyaAccountHeaders = (deviceId: string) => ({
  accept: '*/*',
  'content-type': 'application/json',
  origin: GUANGYA_WEB_URL,
  referer: `${GUANGYA_WEB_URL}/`,
  'user-agent': GUANGYA_USER_AGENT,
  'x-client-id': GUANGYA_CLIENT_ID,
  'x-client-version': '0.0.1',
  'x-device-id': deviceId,
  'x-device-model': 'chrome%2F147.0.0.0',
  'x-device-name': 'PC-Chrome',
  'x-device-sign': `wdi10.${deviceId}${tokenHex(16)}`,
  'x-net-work-type': 'NONE',
  'x-os-version': 'MacIntel',
  'x-platform-version': '1',
  'x-protocol-version': '301',
  'x-provider-name': 'NONE',
  'x-sdk-version': '9.0.2'
})

export const guangyaApiHeaders = (token: ITokenInfo) => ({
  accept: 'application/json, text/plain, */*',
  authorization: `Bearer ${token.access_token}`,
  'content-type': 'application/json',
  did: token.device_id || generateGuangyaDid(),
  dt: '4',
  origin: GUANGYA_WEB_URL,
  referer: `${GUANGYA_WEB_URL}/`,
  traceparent: generateGuangyaTraceparent(),
  'user-agent': GUANGYA_USER_AGENT
})

const readJson = async (resp: Response): Promise<any> => {
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok) {
    const detail = data?.message || data?.msg || data?.error_description || data?.error || data?.code
    throw new Error(detail ? `光鸭云盘请求失败 HTTP ${resp.status}: ${detail}` : `光鸭云盘请求失败 HTTP ${resp.status}`)
  }
  return data
}

export const requestGuangyaSmsCode = async (phoneNumber: string, deviceId = generateGuangyaDid()): Promise<GuangyaSmsState> => {
  const normalizedPhoneNumber = normalizeGuangyaPhoneNumber(phoneNumber)
  const initResp = await fetch(`${GUANGYA_ACCOUNT_URL}/v1/shield/captcha/init`, {
    method: 'POST',
    headers: guangyaAccountHeaders(deviceId),
    body: JSON.stringify({
      client_id: GUANGYA_CLIENT_ID,
      action: 'POST:/v1/auth/verification',
      device_id: deviceId,
      meta: { phone_number: normalizedPhoneNumber }
    })
  })
  const init = await readJson(initResp)
  const captchaToken = init?.captcha_token || init?.captchaToken || ''
  if (!captchaToken) {
    const captchaUrl = init?.url || init?.captcha_url || init?.captchaUrl || ''
    throw new Error(captchaUrl ? `需要先完成人机验证：${captchaUrl}` : '光鸭云盘未返回验证码 token')
  }

  const sendResp = await fetch(`${GUANGYA_ACCOUNT_URL}/v1/auth/verification`, {
    method: 'POST',
    headers: {
      ...guangyaAccountHeaders(deviceId),
      'x-captcha-token': captchaToken
    },
    body: JSON.stringify({
      phone_number: normalizedPhoneNumber,
      target: 'ANY',
      client_id: GUANGYA_CLIENT_ID
    })
  })
  const send = await readJson(sendResp)
  const verificationId = send?.verification_id || send?.verificationId || ''
  if (!verificationId) throw new Error(send?.message || send?.msg || '光鸭云盘未返回短信验证 ID')
  return { phoneNumber: normalizedPhoneNumber, captchaToken, verificationId }
}

export const submitGuangyaSmsCode = async (state: GuangyaSmsState, verificationCode: string, deviceId: string): Promise<ITokenInfo> => {
  const verifyResp = await fetch(`${GUANGYA_ACCOUNT_URL}/v1/auth/verification/verify`, {
    method: 'POST',
    headers: guangyaAccountHeaders(deviceId),
    body: JSON.stringify({
      verification_id: state.verificationId,
      verification_code: verificationCode,
      client_id: GUANGYA_CLIENT_ID
    })
  })
  const verify = await readJson(verifyResp)
  const verificationToken = verify?.verification_token || verify?.verificationToken || ''
  if (!verificationToken) throw new Error(verify?.message || verify?.msg || '短信验证码校验失败')

  const signinResp = await fetch(`${GUANGYA_ACCOUNT_URL}/v1/auth/signin`, {
    method: 'POST',
    headers: {
      ...guangyaAccountHeaders(deviceId),
      'x-captcha-token': state.captchaToken
    },
    body: JSON.stringify({
      verification_code: verificationCode,
      verification_token: verificationToken,
      username: state.phoneNumber,
      client_id: GUANGYA_CLIENT_ID
    })
  })
  const signin = await readJson(signinResp)
  return normalizeGuangyaToken(signin, deviceId, state.phoneNumber)
}

export const fetchGuangyaUserInfo = async (token: ITokenInfo): Promise<any> => {
  const resp = await fetch(`${GUANGYA_ACCOUNT_URL}/v1/user/me`, {
    method: 'POST',
    headers: {
      ...guangyaAccountHeaders(token.device_id || generateGuangyaDid()),
      authorization: `Bearer ${token.access_token}`
    }
  })
  return readJson(resp)
}

export const applyGuangyaQuota = async (token: ITokenInfo): Promise<boolean> => {
  try {
    const payload = await fetchGuangyaUserInfo(token)
    const info = payload?.data || payload || {}
    token.user_name = info.username || info.phone_number || info.phoneNumber || token.user_name
    token.nick_name = info.nickname || info.nick_name || info.name || token.nick_name
    token.name = info.name || token.nick_name || token.name
    token.avatar = info.avatar || token.avatar
    const total = Number(info.total_size ?? info.totalSize)
    const used = Number(info.used_size ?? info.usedSize)
    if (!Number.isFinite(total) && !Number.isFinite(used)) return false
    token.total_size = Number.isFinite(total) ? total : token.total_size
    token.used_size = Number.isFinite(used) ? used : token.used_size
    token.free_size = Math.max(0, token.total_size - token.used_size)
    token.spaceinfo = `${humanSize(token.used_size)} / ${humanSize(token.total_size)}`
    return true
  } catch {
    return false
  }
}

export const refreshGuangyaAccessToken = async (token: ITokenInfo): Promise<ITokenInfo | null> => {
  const key = tokenRefreshKey('guangya', token.user_id || token.device_id || token.refresh_token)
  return withTokenRefreshLock(key, async () => {
    if (!token.refresh_token) return null
    const deviceId = token.device_id || generateGuangyaDid()
    const resp = await fetch(`${GUANGYA_ACCOUNT_URL}/v1/auth/token`, {
      method: 'POST',
      headers: {
        ...guangyaAccountHeaders(deviceId),
        'x-action': '401'
      },
      body: JSON.stringify({
        client_id: GUANGYA_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token
      })
    })
    const data = await readJson(resp)
    const refreshed = normalizeGuangyaToken(data, deviceId, token.user_name || token.nick_name || token.user_id)
    refreshed.refresh_token = refreshed.refresh_token || token.refresh_token
    refreshed.user_id = token.user_id || refreshed.user_id
    refreshed.user_name = token.user_name || refreshed.user_name
    refreshed.nick_name = token.nick_name || refreshed.nick_name
    return refreshed
  })
}

export const normalizeGuangyaToken = (data: any, deviceId: string, fallbackName = '光鸭云盘'): ITokenInfo => {
  const raw = data?.data || data || {}
  const accessToken = raw?.access_token || raw?.accessToken || ''
  const refreshToken = raw?.refresh_token || raw?.refreshToken || ''
  const expiresIn = Number(raw?.expires_in || raw?.expiresIn || 0)
  const id = raw?.user_id || raw?.uid || raw?.id || hashString(refreshToken || accessToken || fallbackName)
  const expireTime = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : ''
  return {
    tokenfrom: 'guangya',
    access_token: accessToken,
    refresh_token: refreshToken,
    session_expires_in: 0,
    open_api_token_type: '',
    open_api_access_token: '',
    open_api_refresh_token: '',
    open_api_expires_in: 0,
    signature: '',
    device_id: deviceId,
    expires_in: expiresIn,
    token_type: raw?.token_type || raw?.tokenType || 'Bearer',
    user_id: `guangya_${id}`,
    user_name: raw?.user_name || raw?.username || fallbackName || '光鸭云盘',
    avatar: raw?.avatar || '',
    nick_name: raw?.nick_name || raw?.nickname || raw?.name || fallbackName || '光鸭云盘',
    default_drive_id: 'guangya',
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
    name: raw?.name || raw?.nick_name || fallbackName || '光鸭云盘',
    spu_id: '',
    is_expires: false,
    used_size: Number(raw?.used_size || raw?.usedSize || 0),
    total_size: Number(raw?.total_size || raw?.totalSize || 0),
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
