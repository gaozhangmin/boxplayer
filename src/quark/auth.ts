import type { ITokenInfo } from '../user/userstore'
import { humanSize } from '../utils/format'

export type QuarkCookie = {
  name: string
  value: string
  domain?: string
}

type QuarkAccountInfo = {
  uid?: string | number
  user_id?: string | number
  id?: string | number
  member_id?: string | number
  nickname?: string
  nick_name?: string
  nickName?: string
  username?: string
  user_name?: string
  userName?: string
  display_name?: string
  displayName?: string
  mobile?: string
  phone?: string
  avatar_url?: string
  avatarUri?: string
  avatar?: string
  total_capacity?: number
  used_capacity?: number
}

const ACCOUNT_INFO_URL = 'https://pan.quark.cn/account/info'
const QR_TOKEN_URL = 'https://uop.quark.cn/cas/ajax/getTokenForQrcodeLogin'
const QR_STATUS_URL = 'https://uop.quark.cn/cas/ajax/getServiceTicketByQrcodeToken'
const QUARK_QR_HEADERS: HeadersInit = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
  origin: 'https://pan.quark.cn',
  referer: 'https://pan.quark.cn/',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-site',
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
}
const QUARK_ACCOUNT_HEADERS: HeadersInit = {
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9',
  'cache-control': 'no-cache',
  pragma: 'no-cache'
}
export const QUARK_DOWNLOAD_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) quark-cloud-drive/2.5.56 Chrome/100.0.4896.160 Electron/18.3.5.12-a038f7b798 Safari/537.36 Channel/pckk_other_ch'

export type QuarkQrCode = {
  token: string
  qrUrl: string
  qrImageUrl: string
}

export type QuarkQrStatus = {
  status: 'waiting' | 'confirmed' | 'expired' | 'failed'
  serviceTicket: string
  message: string
}

export const buildQuarkCookieString = (cookies: QuarkCookie[]): string => {
  const cookieMap = new Map<string, string>()
  for (const cookie of cookies) {
    if ((cookie.domain || '').includes('quark.cn') && cookie.name && cookie.value) cookieMap.set(cookie.name, cookie.value)
  }
  return Array.from(cookieMap, ([name, value]) => `${name}=${value}`).join('; ')
}

const parseCookieValue = (cookieString: string, key: string): string => {
  const part = cookieString.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${key}=`))
  return part ? part.substring(key.length + 1) : ''
}

const hashText = (text: string): string => {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const getQuarkAccountId = (info: QuarkAccountInfo, cookieString: string): string => {
  const explicitId = info.uid || info.user_id || info.id || info.member_id
  if (explicitId) return String(explicitId)
  const cookieId = parseCookieValue(cookieString, '__uid') || parseCookieValue(cookieString, '__puus')
  if (cookieId) return cookieId
  const authCookie = parseCookieValue(cookieString, '__kps') || parseCookieValue(cookieString, '__pus')
  if (authCookie) return `cookie_${hashText(authCookie)}`
  return `cookie_${hashText(cookieString)}`
}

const hasQuarkAuthCookie = (cookieString: string): boolean => {
  return !!parseCookieValue(cookieString, '__pus') && (!!parseCookieValue(cookieString, '__uid') || !!parseCookieValue(cookieString, '__kps'))
}

export const syncQuarkCookiesToElectron = async (cookieString: string): Promise<void> => {
  if (!cookieString || typeof window === 'undefined' || !window.WebSetCookies) return
  const cookies = cookieString.split(';')
    .map((item) => item.trim())
    .map((item) => {
      const separator = item.indexOf('=')
      return separator > 0 ? { name: item.slice(0, separator), value: item.slice(separator + 1), url: 'https://drive-pc.quark.cn', domain: '.quark.cn' } : undefined
    })
    .filter(Boolean)
  if (cookies.length) await window.WebSetCookies(cookies)
}

const randomRequestId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const buildQuarkQrLoginUrl = (token: string): string => {
  const params = new URLSearchParams({
    token,
    client_id: '532',
    ssb: 'weblogin',
    uc_param_str: '',
    uc_biz_str: 'S:custom|OPT:SAREA@0|OPT:IMMERSIVE@1|OPT:BACK_BTN_STYLE@0'
  })
  return `https://su.quark.cn/4_eMHBJ?${params.toString()}`
}

export const buildQuarkQrImageUrl = (content: string): string => {
  const params = new URLSearchParams({ size: '250x250', data: content })
  return `https://api.qrserver.com/v1/create-qr-code/?${params.toString()}`
}

export const requestQuarkQrCode = async (): Promise<QuarkQrCode> => {
  const params = new URLSearchParams({
    client_id: '532',
    v: '1.2',
    request_id: randomRequestId()
  })
  const resp = await fetch(`${QR_TOKEN_URL}?${params.toString()}`, {
    headers: QUARK_QR_HEADERS,
    credentials: 'include'
  })
  const data = await resp.json().catch(() => undefined)
  const token = data?.data?.members?.token || ''
  if (!resp.ok || data?.status !== 2000000 || !token) {
    throw new Error(data?.message || '获取夸克登录二维码失败')
  }
  const qrUrl = buildQuarkQrLoginUrl(token)
  return {
    token,
    qrUrl,
    qrImageUrl: buildQuarkQrImageUrl(qrUrl)
  }
}

export const pollQuarkQrStatus = async (token: string): Promise<QuarkQrStatus> => {
  const params = new URLSearchParams({
    client_id: '532',
    v: '1.2',
    token,
    request_id: randomRequestId()
  })
  const resp = await fetch(`${QR_STATUS_URL}?${params.toString()}`, {
    headers: QUARK_QR_HEADERS,
    credentials: 'include'
  })
  const data = await resp.json().catch(() => undefined)
  const serviceTicket = data?.data?.members?.service_ticket || ''
  if (resp.ok && data?.status === 2000000 && serviceTicket) {
    return { status: 'confirmed', serviceTicket, message: data?.message || '授权成功' }
  }
  const message = data?.message || ''
  const code = Number(data?.status || data?.code || 0)
  if ([50004002, 50004003, 50004004].includes(code) || /expired|timeout|invalid|token not found/i.test(message)) {
    const expiredMessage = /token not found/i.test(message) ? '' : message
    return { status: 'expired', serviceTicket: '', message: expiredMessage || '二维码已失效，请刷新' }
  }
  if (!resp.ok || /failed|error/i.test(message)) {
    return { status: 'failed', serviceTicket: '', message: message || '获取夸克扫码状态失败' }
  }
  const waitingMessage = /query result is empty/i.test(message) ? '' : message
  return { status: 'waiting', serviceTicket: '', message: waitingMessage || '请使用夸克 App 扫码' }
}

const emptyQuarkToken = (): ITokenInfo => ({
  tokenfrom: 'quark',
  access_token: '',
  refresh_token: '',
  session_expires_in: 0,
  open_api_token_type: '',
  open_api_access_token: '',
  open_api_refresh_token: '',
  open_api_expires_in: 0,
  expires_in: 0,
  token_type: 'Cookie',
  user_id: '',
  user_name: '',
  avatar: '',
  nick_name: '',
  default_drive_id: 'quark',
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

const normalizeAccountInfo = (data: any): QuarkAccountInfo => {
  const payload = data?.data || data || {}
  const body = payload?.member || payload?.user_info || payload?.userInfo || payload?.member_info || payload?.memberInfo || data?.member || payload
  return body as QuarkAccountInfo
}

const getQuarkDisplayName = (info: QuarkAccountInfo): string => {
  const values = [info.nickname, info.nick_name, info.nickName, info.username, info.user_name, info.userName, info.display_name, info.displayName, info.mobile, info.phone]
  return values.map((value) => String(value || '').trim()).find(Boolean) || '夸克用户'
}

const createQuarkToken = (cookieString: string, data: any): ITokenInfo => {
  const info = normalizeAccountInfo(data)
  const uid = getQuarkAccountId(info, cookieString)
  const name = getQuarkDisplayName(info)
  const token = emptyQuarkToken()
  token.access_token = cookieString
  token.user_id = uid.startsWith('quark_') ? uid : `quark_${uid}`
  token.user_name = name
  token.nick_name = name
  token.name = name
  token.avatar = info.avatar_url || info.avatarUri || info.avatar || ''
  token.total_size = Number(info.total_capacity || 0)
  token.used_size = Number(info.used_capacity || 0)
  token.free_size = Math.max(0, token.total_size - token.used_size)
  if (token.total_size || token.used_size) token.spaceinfo = `${humanSize(token.used_size)} / ${humanSize(token.total_size)}`
  return token
}

const readQuarkResponse = async (resp: Response): Promise<{ data: any; text: string }> => {
  const text = await resp.text().catch(() => '')
  if (!text) return { data: undefined, text: '' }
  try {
    return { data: JSON.parse(text), text }
  } catch {
    return { data: undefined, text }
  }
}

const getQuarkErrorMessage = (resp: Response, data: any, text: string, fallback: string): string => {
  const detail = data?.message || data?.error || text.slice(0, 160).trim()
  if (!detail) return fallback
  return `${fallback}（HTTP ${resp.status}：${detail}）`
}

const isQuarkAccountResponseError = (data: any): boolean => {
  if (data?.success === true) return false
  if (data?.status === 'error') return true
  if (data?.code !== undefined && data.code !== 0 && data.code !== '0') return true
  return false
}

export const quarkAuthHeaders = (cookieString: string): HeadersInit => ({
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9',
  'content-type': 'application/json',
  origin: 'https://pan.quark.cn',
  referer: 'https://pan.quark.cn/',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  cookie: cookieString
})

export const quarkDownloadHeaders = (cookieString: string): HeadersInit => ({
  ...quarkAuthHeaders(cookieString),
  'user-agent': QUARK_DOWNLOAD_AGENT
})

export const createQuarkTokenFromCookies = async (cookieString: string): Promise<ITokenInfo> => {
  if (!cookieString || !cookieString.includes('=')) throw new Error('夸克 Cookie 为空')
  if (!hasQuarkAuthCookie(cookieString)) throw new Error('夸克登录 Cookie 无效，请重新登录夸克')
  await syncQuarkCookiesToElectron(cookieString)
  const resp = await fetch(ACCOUNT_INFO_URL, {
    headers: quarkAuthHeaders(cookieString),
    signal: AbortSignal.timeout(15000),
    credentials: 'include'
  })
  const data = await resp.json().catch(() => undefined)
  if (!resp.ok || isQuarkAccountResponseError(data)) {
    throw new Error(data?.message || '验证夸克登录失败')
  }
  return createQuarkToken(cookieString, data)
}

export const refreshQuarkAccountInfo = async (token: ITokenInfo): Promise<ITokenInfo> => {
  const refreshed = await createQuarkTokenFromCookies(token.access_token)
  return {
    ...token,
    ...refreshed,
    // /account/info is identity metadata. Capacity comes from /clouddrive/member.
    total_size: token.total_size,
    used_size: token.used_size,
    free_size: token.free_size,
    spaceinfo: token.spaceinfo,
    user_id: token.user_id || refreshed.user_id,
    access_token: token.access_token,
    default_drive_id: token.default_drive_id || refreshed.default_drive_id || 'quark'
  }
}

export const readQuarkCookieStringFromElectron = async (): Promise<string> => {
  if (typeof window === 'undefined' || !window.WebGetCookies) return ''
  const driveCookies = await window.WebGetCookies({ url: 'https://drive-pc.quark.cn' }) as QuarkCookie[]
  const driveCookieString = buildQuarkCookieString(driveCookies)
  if (hasQuarkAuthCookie(driveCookieString)) return driveCookieString

  const cookieMap = new Map<string, QuarkCookie>()
  const appendCookies = (cookies: QuarkCookie[] = []) => {
    for (const cookie of cookies) {
      if (cookie?.name && cookie?.value) cookieMap.set(`${cookie.domain || ''}:${cookie.name}`, cookie)
    }
  }
  appendCookies(await window.WebGetCookies({ url: 'https://pan.quark.cn' }) as QuarkCookie[])
  appendCookies(driveCookies)
  appendCookies(await window.WebGetCookies({ url: 'https://uop.quark.cn' }) as QuarkCookie[])
  if (!cookieMap.size) appendCookies(await window.WebGetCookies({ domain: '.quark.cn' }) as QuarkCookie[])
  if (!cookieMap.size) appendCookies(await window.WebGetCookies({ domain: 'quark.cn' }) as QuarkCookie[])
  return buildQuarkCookieString(Array.from(cookieMap.values()))
}

const createQuarkTokenFromAccountInfo = (cookieString: string, data: any): ITokenInfo => {
  if (!cookieString || !cookieString.includes('=')) throw new Error('未获取到夸克 Cookie，请刷新二维码重试')
  if (!hasQuarkAuthCookie(cookieString)) throw new Error('未获取到夸克登录 Cookie，请刷新二维码重试')
  return createQuarkToken(cookieString, data)
}

export const createQuarkTokenFromElectronCookies = async (): Promise<ITokenInfo> => {
  const cookieString = await readQuarkCookieStringFromElectron()
  return createQuarkTokenFromCookies(cookieString)
}

export const completeQuarkQrLogin = async (serviceTicket: string): Promise<ITokenInfo> => {
  if (!serviceTicket) throw new Error('夸克登录凭证为空')
  if (typeof window !== 'undefined' && window.WebQuarkAccountInfo) {
    const result = await window.WebQuarkAccountInfo({ serviceTicket })
    const text = result?.body || ''
    const data = text ? (() => { try { return JSON.parse(text) } catch { return undefined } })() : undefined
    if (!result?.ok || isQuarkAccountResponseError(data)) {
      throw new Error(getQuarkErrorMessage({ status: result?.status || 0 } as Response, data, text, '获取夸克账号信息失败'))
    }
    const cookieString = buildQuarkCookieString((result?.cookies || []) as QuarkCookie[])
    return createQuarkTokenFromAccountInfo(cookieString, data)
  }
  const params = new URLSearchParams({ st: serviceTicket, lw: 'scan' })
  const resp = await fetch(`${ACCOUNT_INFO_URL}?${params.toString()}`, {
    headers: QUARK_ACCOUNT_HEADERS,
    credentials: 'include'
  })
  const { data, text } = await readQuarkResponse(resp)
  if (!resp.ok || isQuarkAccountResponseError(data)) {
    throw new Error(getQuarkErrorMessage(resp, data, text, '获取夸克账号信息失败'))
  }
  const cookieString = await readQuarkCookieStringFromElectron()
  return createQuarkTokenFromAccountInfo(cookieString, data)
}
