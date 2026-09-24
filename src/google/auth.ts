import type { ITokenInfo } from '../user/userstore'
import message from '../utils/message'
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../secrets.generated'
import { tokenRefreshKey, withTokenRefreshLock } from '../user/tokenRefresh'

export { GOOGLE_CLIENT_ID }

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_ABOUT_URL = 'https://www.googleapis.com/drive/v3/about?fields=user%28permissionId%2CdisplayName%2CemailAddress%2CphotoLink%29%2CstorageQuota%28limit%2Cusage%29'
export const GOOGLE_AUTH_REQUEST_TIMEOUT_MS = 15_000
export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'

const base64UrlEncode = (bytes: Uint8Array) => {
  let value = ''
  bytes.forEach((byte) => { value += String.fromCharCode(byte) })
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const sha256 = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))

export const createGooglePkceVerifier = () => {
  const bytes = new Uint8Array(64)
  crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export const buildGoogleAuthUrl = async (clientId: string, verifier: string, redirectUri: string, state = `google_${Date.now()}`) => {
  const params = new URLSearchParams({
    client_id: clientId.trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: base64UrlEncode(await sha256(verifier)),
    code_challenge_method: 'S256',
    state
  })
  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

const emptyToken = (): ITokenInfo => ({
  tokenfrom: 'google', access_token: '', refresh_token: '', session_expires_in: 0, open_api_token_type: '', open_api_access_token: '', open_api_refresh_token: '', open_api_expires_in: 0, signature: '', device_id: '', expires_in: 0, token_type: 'Bearer', user_id: '', user_name: 'Google Drive', avatar: '', nick_name: 'Google Drive', default_drive_id: 'google', default_sbox_drive_id: '', resource_drive_id: '', backup_drive_id: '', sbox_drive_id: '', role: '', status: '', expire_time: '', state: '', pin_setup: false, is_first_login: false, need_rp_verify: false, name: 'Google Drive', spu_id: '', is_expires: false, used_size: 0, total_size: 0, free_size: 0, space_expire: false, spaceinfo: '', vipname: '', vipIcon: '', vipexpire: '', pic_drive_id: '', signInfo: { signMon: -1, signDay: -1 }
})

const googleTokenRequest = async (body: URLSearchParams, fallback: string): Promise<any | null> => {
  try {
    const response = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(GOOGLE_AUTH_REQUEST_TIMEOUT_MS) })
    const data = await response.json().catch(() => undefined)
    if (!response.ok || !data?.access_token) {
      message.error(data?.error_description || data?.error || fallback)
      return null
    }
    return data
  } catch (error: any) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    message.error(isTimeout ? '连接 Google OAuth 超时，请检查网络代理后重试' : `连接 Google OAuth 失败：${error?.message || fallback}`)
    return null
  }
}

const applyGoogleAccount = async (token: ITokenInfo) => {
  try {
    const response = await fetch(GOOGLE_ABOUT_URL, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(GOOGLE_AUTH_REQUEST_TIMEOUT_MS) })
    const data = await response.json().catch(() => undefined)
    if (!response.ok || !data?.user?.permissionId) return
    token.user_id = `google_${data.user.permissionId}`
    token.user_name = data.user.displayName || data.user.emailAddress || token.user_name
    token.nick_name = token.user_name
    token.name = token.user_name
    token.avatar = data.user.photoLink || ''
    const total = Number(data.storageQuota?.limit || 0)
    const used = Number(data.storageQuota?.usage || 0)
    token.total_size = total
    token.used_size = used
    token.free_size = Math.max(0, total - used)
  } catch (error: any) {
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError'
    message.error(isTimeout ? '连接 Google Drive 超时，请检查网络代理后重试' : `读取 Google Drive 账号信息失败：${error?.message || '网络错误'}`)
  }
}

const applyTokenResponse = (data: any, clientId: string, previous?: ITokenInfo) => {
  const token = previous || emptyToken()
  token.access_token = data.access_token
  token.refresh_token = data.refresh_token || token.refresh_token || ''
  token.expires_in = Number(data.expires_in || 3600)
  token.token_type = data.token_type || 'Bearer'
  token.device_id = clientId.trim()
  token.default_drive_id = 'google'
  token.expire_time = new Date(Date.now() + token.expires_in * 1000).toISOString()
  return token
}

export const exchangeGoogleCodeForToken = async (code: string, clientId: string, verifier: string, redirectUri: string) => {
  const data = await googleTokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId.trim(), client_secret: GOOGLE_CLIENT_SECRET.trim(), redirect_uri: redirectUri, code_verifier: verifier }), '获取 Google Drive access_token 失败')
  if (!data) return null
  const token = applyTokenResponse(data, clientId)
  await applyGoogleAccount(token)
  if (!token.user_id) return null
  const { default: UserDAL } = await import('../user/userdal')
  UserDAL.SaveUserToken(token)
  return token
}

export const refreshGoogleAccessToken = async (token: ITokenInfo) => withTokenRefreshLock(tokenRefreshKey('google', token.user_id || token.refresh_token), async () => {
  if (!token.refresh_token || !token.device_id || !GOOGLE_CLIENT_SECRET.trim()) return null
  const data = await googleTokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: token.device_id, client_secret: GOOGLE_CLIENT_SECRET.trim() }), '刷新 Google Drive access_token 失败')
  if (!data) return null
  const refreshed = applyTokenResponse(data, token.device_id, token)
  await applyGoogleAccount(refreshed)
  return refreshed
})

export const applyGoogleQuota = async (token: ITokenInfo) => {
  await applyGoogleAccount(token)
  return !!token.user_id
}
