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
  const itemId = String(input.itemId || '').trim()
  const sourceId = String(input.sourceId || '').trim()
  const directStreamUrl = String(input.directStreamUrl || '').trim()
  const username = String(input.username || '').trim()
  const hasPassword = Object.prototype.hasOwnProperty.call(input, 'password') && typeof input.password === 'string'
  const userAgent = String(input.userAgent || ((itemId || directStreamUrl) ? 'SenPlayer' : 'BoxPlayer E2E')).trim()
  if (!userAgent || /["\\,\r\n]/.test(userAgent)) throw new Error('BOXPLAYER_E2E_EMBY_JSON.userAgent contains unsupported characters')
  if (itemId || directStreamUrl) {
    if (!accessToken) throw new Error('BOXPLAYER_E2E_EMBY_JSON.accessToken is required for direct playback')
    if (itemId && !userId) throw new Error('BOXPLAYER_E2E_EMBY_JSON.userId is required to refresh PlaybackInfo')
  } else if (accessToken || userId) {
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
    mediaTitle: String(input.mediaTitle || '').trim(),
    ...(itemId ? { itemId } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(directStreamUrl ? { directStreamUrl } : {})
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

function sameOriginPlaybackUrl(config, value) {
  let url
  try {
    url = new URL(value, `${config.baseUrl}/`)
  } catch {
    throw new Error('Emby direct playback URL is invalid')
  }
  if (url.origin !== new URL(config.baseUrl).origin) throw new Error('Emby direct playback URL must use the configured server origin')
  return url.toString()
}

async function resolveDirectPlayback(config, fetchImpl) {
  let directStreamUrl = config.directStreamUrl
  let requiredHeaders = {}
  let sourceId = config.sourceId || ''
  if (config.itemId) {
    const bitrate = 360000000
    const query = new URLSearchParams({ UserId: config.userId, StartTimeTicks: '0', AutoOpenLiveStream: 'false', MaxStreamingBitrate: String(bitrate) })
    if (sourceId) query.set('MediaSourceId', sourceId)
    const response = await fetchImpl(`${config.baseUrl}/Items/${encodeURIComponent(config.itemId)}/PlaybackInfo?${query}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': config.userAgent,
        'X-Emby-Token': config.accessToken,
        'X-Emby-Authorization': embyAuthorization(config, config.accessToken, config.userId)
      },
      body: JSON.stringify({ DeviceProfile: {
        Action: 'replace', MaxStreamingBitrate: bitrate, MaxStaticBitrate: bitrate, MusicStreamingTranscodingBitrate: bitrate,
        DirectPlayProfiles: [{ Type: 'Video', AudioCodec: 'aac,ac3,alac,amr_nb,amr_wb,dts,eac3,flac,mp1,mp2,mp3,nellymoser,opus,pcm_alaw,pcm_bluray,pcm_dvd,pcm_mulaw,pcm_s16be,pcm_s16le,pcm_s24be,pcm_s24le,pcm_u8,speex,vorbis,wavpack,wmalossless,wmapro,wmav1,wmav2' }],
        TranscodingProfiles: [{ Type: 'Video', Container: 'mp4', Protocol: 'hls', AudioCodec: 'aac,ac3,alac,dts,eac3,flac,mp1,mp2,mp3,opus,vorbis', VideoCodec: 'av1,h263,h264,hevc,mjpeg,mpeg1video,mpeg2video,mpeg4,vc1,vp9', Context: 'Streaming', MaxAudioChannels: '8', MinSegments: '2', BreakOnNonKeyFrames: true }]
      } })
    })
    const payload = await responseJson(response, 'Emby PlaybackInfo')
    const sources = Array.isArray(payload?.MediaSources) ? payload.MediaSources : []
    const source = (sourceId ? sources.find(entry => entry.Id === sourceId) : sources[0]) || null
    if (!source?.DirectStreamUrl) throw new Error('Emby PlaybackInfo did not include a direct stream URL for the selected source')
    directStreamUrl = source.DirectStreamUrl
    requiredHeaders = source.RequiredHttpHeaders || {}
    sourceId = String(source.Id || sourceId)
  }
  const url = sameOriginPlaybackUrl(config, directStreamUrl)
  return {
    url,
    headers: {
      'User-Agent': config.userAgent,
      // Emby already placed the token in api_key. Avoid redundant custom
      // headers in libmpv's comma-delimited loadfile option parser.
      ...(new URL(url).searchParams.has('api_key') ? {} : { 'X-Emby-Token': config.accessToken }),
      ...requiredHeaders
    },
    itemId: config.itemId || '',
    sourceId
  }
}

async function resolveRealMediaServerE2EConfig(env = process.env, fetchImpl = globalThis.fetch) {
  const config = loadRealMediaServerE2EConfig(env)
  if (config.directStreamUrl || config.itemId) {
    if (config.itemId && typeof fetchImpl !== 'function') throw new Error('Emby PlaybackInfo requires fetch')
    return {
      type: config.type, name: config.name, baseUrl: config.baseUrl,
      accessToken: config.accessToken, userId: config.userId, deviceId: config.deviceId,
      userAgent: config.userAgent, mediaTitle: config.mediaTitle,
      directPlayback: await resolveDirectPlayback(config, fetchImpl)
    }
  }
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
    console.log(`Real media-server E2E coverage OK: ${config.type}, ${config.directPlayback ? 'token-based direct playback' : 'login and playable media'} verified`)
  }).catch((error) => {
    console.error(`Real media-server E2E preflight failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}

module.exports = { loadRealMediaServerE2EConfig, resolveRealMediaServerE2EConfig }
