'use strict'

function parseJsonObject(raw, name) {
  if (!raw || !String(raw).trim()) throw new Error(`${name} is required`)
  let value
  try {
    value = JSON.parse(String(raw))
  } catch {
    throw new Error(`${name} must be valid JSON`)
  }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${name} must be a JSON object`)
  return value
}

function normalizeUrl(value) {
  const url = new URL(String(value || '').trim())
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Emby url must use http or https')
  return url.toString().replace(/\/$/, '')
}

function loadRealMediaServerE2EConfig(env = process.env) {
  const input = parseJsonObject(env.BOXPLAYER_E2E_EMBY_JSON, 'BOXPLAYER_E2E_EMBY_JSON')
  const baseUrl = normalizeUrl(input.url || input.baseUrl)
  const accessToken = String(input.accessToken || '').trim()
  const userId = String(input.userId || '').trim()
  const username = String(input.username || '').trim()
  const hasPassword = Object.prototype.hasOwnProperty.call(input, 'password') && typeof input.password === 'string'
  const userAgent = String(input.userAgent || 'BoxPlayer E2E').trim()
  if (!userAgent || /["\\,\r\n]/.test(userAgent)) throw new Error('BOXPLAYER_E2E_EMBY_JSON.userAgent contains unsupported characters')
  if (accessToken || userId) {
    if (!accessToken) throw new Error('BOXPLAYER_E2E_EMBY_JSON.accessToken is required when userId is set')
    if (!userId) throw new Error('BOXPLAYER_E2E_EMBY_JSON.userId is required when accessToken is set')
  } else {
    if (!username) throw new Error('BOXPLAYER_E2E_EMBY_JSON.username is required')
    if (!hasPassword) throw new Error('BOXPLAYER_E2E_EMBY_JSON.password must be a string')
  }
  return {
    type: 'emby',
    name: String(input.name || 'BoxPlayer E2E Emby').trim(),
    baseUrl,
    username,
    password: hasPassword ? input.password : '',
    userAgent,
    accessToken,
    userId,
    deviceId: String(input.deviceId || 'boxplayer-github-actions').trim(),
    mediaTitle: String(input.mediaTitle || '').trim()
  }
}

function embyAuthorization(config, accessToken = '', userId = '') {
  const fields = [
    `Token="${accessToken}"`,
    ...(userId ? [`UserId="${userId}"`] : []),
    'Client="XbyBoxPlayer"',
    `Device="${config.userAgent}"`,
    `DeviceId="${config.deviceId}"`,
    'Version="1.0.0"'
  ]
  return `MediaBrowser ${fields.join(', ')}`
}

async function responseJson(response, action) {
  if (!response.ok) throw new Error(`${action} failed (${response.status})`)
  try {
    return await response.json()
  } catch {
    throw new Error(`${action} returned invalid JSON`)
  }
}

async function discoverMediaTitle(config, fetchImpl) {
  if (config.mediaTitle) return config.mediaTitle
  const query = new URLSearchParams({
    Recursive: 'true',
    IncludeItemTypes: 'Movie,Episode,Video',
    IsFolder: 'false',
    SortBy: 'DateCreated',
    SortOrder: 'Descending',
    Limit: '1'
  })
  const response = await fetchImpl(`${config.baseUrl}/Users/${encodeURIComponent(config.userId)}/Items?${query}`, {
    headers: {
      'User-Agent': config.userAgent,
      'X-Emby-Token': config.accessToken,
      'X-Emby-Authorization': embyAuthorization(config, config.accessToken, config.userId)
    }
  })
  const payload = await responseJson(response, 'Emby media discovery')
  const title = String(payload?.Items?.[0]?.Name || payload?.items?.[0]?.name || '').trim()
  if (!title) throw new Error('Emby media discovery found no playable Movie, Episode, or Video')
  return title
}

async function resolveRealMediaServerE2EConfig(env = process.env, fetchImpl = globalThis.fetch) {
  const config = loadRealMediaServerE2EConfig(env)
  if (typeof fetchImpl !== 'function') throw new Error('Emby CI login requires fetch')
  let accessToken = config.accessToken
  let userId = config.userId
  if (!accessToken) {
    const response = await fetchImpl(`${config.baseUrl}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': config.userAgent,
        'X-Emby-Authorization': embyAuthorization(config)
      },
      body: JSON.stringify({ Username: config.username, Pw: config.password })
    })
    const payload = await responseJson(response, 'Emby login')
    accessToken = String(payload?.AccessToken || payload?.accessToken || '').trim()
    userId = String(payload?.User?.Id || payload?.user?.id || '').trim()
    if (!accessToken || !userId) throw new Error('Emby login response did not include AccessToken and User.Id')
  }
  const resolved = {
    type: config.type,
    name: config.name,
    baseUrl: config.baseUrl,
    accessToken,
    userId,
    deviceId: config.deviceId,
    userAgent: config.userAgent,
    mediaTitle: config.mediaTitle
  }
  resolved.mediaTitle = await discoverMediaTitle(resolved, fetchImpl)
  return resolved
}

if (require.main === module) {
  resolveRealMediaServerE2EConfig().then((config) => {
    console.log(`Real media-server E2E coverage OK: ${config.type}, login and playable media verified`)
  }).catch((error) => {
    console.error(`Real media-server E2E preflight failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

module.exports = { loadRealMediaServerE2EConfig, resolveRealMediaServerE2EConfig }
