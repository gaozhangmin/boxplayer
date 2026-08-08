import { randomUUID } from 'node:crypto'

const BASE_API = 'https://api.aliyundrive.com/'
const BASE_OPEN_API = 'https://openapi.alipan.com/'

// Map legacy aliyundrive API paths (v2/v3/v4, api.aliyundrive.com) to the
// current OpenAPI paths (openapi.alipan.com/adrive/v1.0/openFile/*).
// The legacy API domain is shut down (returns 401 AccessTokenInvalid).
const LEGACY_PATH_MAP = {
  'adrive/v3/file/list': 'adrive/v1.0/openFile/list',
  'adrive/v3/file/search': 'adrive/v1.0/openFile/search',
  'adrive/v3/file/create': 'adrive/v1.0/openFile/create',
  'adrive/v3/file/recyclebin/trash': 'adrive/v1.0/openFile/recyclebin/trash',
  'adrive/v3/file/recyclebin/restore': 'adrive/v1.0/openFile/recyclebin/restore',
  'v2/file/get': 'adrive/v1.0/openFile/get',
}

function resolveUrl(path) {
  if (path.startsWith('http')) return path
  const mapped = LEGACY_PATH_MAP[path] || path
  if (mapped.includes('adrive/v1.0') || mapped.includes('adrive/v1.1')) return BASE_OPEN_API + mapped
  return BASE_API + mapped
}

function buildHeaders(token, url) {
  const isOpen = url.startsWith(BASE_OPEN_API)
  const headers = { 'Content-Type': 'application/json' }
  if (isOpen && token.open_api_access_token) {
    headers['Authorization'] = `${token.open_api_token_type || 'Bearer'} ${token.open_api_access_token}`
  } else {
    headers['Authorization'] = `Bearer ${token.access_token}`
    if (token.device_id) headers['x-device-id'] = token.device_id
    if (token.signature) headers['x-signature'] = token.signature
    headers['x-request-id'] = randomUUID()
  }
  return headers
}

export async function aliPost(path, body, token) {
  const url = resolveUrl(path)
  const resp = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(token, url),
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`Aliyun API ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_ALIYUN_HTTP'
    err.status = resp.status
    throw err
  }
  return resp.json()
}

export async function aliRefreshToken(token) {
  // Legacy auth.aliyundrive.com is shut down; use OpenAPI oauth (same as browserAuth).
  // Keep empty-string defaults like HEAD browserAuth (do not hardcode client secrets).
  const clientId = process.env.CLOUDDRIVE_ALIYUN_CLIENT_ID || process.env.CLOUDDRIVE_ALIPAN_CLIENT_ID || ''
  const clientSecret = process.env.CLOUDDRIVE_ALIYUN_CLIENT_SECRET || process.env.CLOUDDRIVE_ALIPAN_CLIENT_SECRET || ''
  const refreshToken = token.open_api_refresh_token || token.refresh_token
  const resp = await fetch('https://openapi.alipan.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    const err = new Error(`Token refresh failed ${resp.status}: ${text.slice(0, 200)}`)
    err.code = 'ERR_ALIYUN_AUTH'
    throw err
  }
  const data = await resp.json()
  const expiresAt = data.expires_in ? Date.now() + Number(data.expires_in) * 1000 : 0
  return {
    ...token,
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in,
    expire_time: expiresAt ? new Date(expiresAt).toISOString() : token.expire_time,
    token_type: data.token_type || 'Bearer',
    open_api_access_token: data.access_token,
    open_api_refresh_token: data.refresh_token || refreshToken,
    open_api_token_type: data.token_type || 'Bearer',
    open_api_expires_in: expiresAt || token.open_api_expires_in,
  }
}
