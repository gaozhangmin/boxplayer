import { MediaServerAuthenticationError } from './base'
import type { MediaServerAdapter, MediaServerSignInInput, MediaServerSignInResult } from './base'
import { generateDeviceId, normalizeServerBaseUrl } from './base'

interface JellyfinAuthResponse {
  AccessToken?: string
  accessToken?: string
  User?: {
    Id?: string
    Name?: string
  }
  user?: {
    id?: string
    name?: string
  }
}

const APP_NAME = 'XbyBoxPlayer'
const APP_VERSION = '1.0.0'

const createAuthHeader = (deviceId: string) => {
  const fields = [
    `Token=""`,
    `Client="${APP_NAME}"`,
    `Device="${APP_NAME}"`,
    `DeviceId="${deviceId}"`,
    `Version="${APP_VERSION}"`
  ]
  return `MediaBrowser ${fields.join(', ')}`
}

const parseAuthResponse = (payload: JellyfinAuthResponse, deviceId: string, normalizedBaseUrl: string): MediaServerSignInResult => {
  const accessToken = payload.AccessToken || payload.accessToken || ''
  const userId = payload.User?.Id || payload.user?.id || ''
  if (!accessToken) throw new Error('服务器未返回 access token')
  return {
    accessToken,
    userId,
    deviceId,
    normalizedBaseUrl
  }
}

export const jellyfinAdapter: MediaServerAdapter = {
  type: 'jellyfin',
  async signIn(input: MediaServerSignInInput): Promise<MediaServerSignInResult> {
    const normalizedBaseUrl = normalizeServerBaseUrl(input.baseUrl)
    const deviceId = generateDeviceId()
    const response = await fetch(`${normalizedBaseUrl}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: createAuthHeader(deviceId)
      },
      body: JSON.stringify({
        Username: input.username || '',
        Pw: input.password || ''
      })
    })
    if (!response.ok) {
      throw new MediaServerAuthenticationError(response.status, `Jellyfin 登录失败 (${response.status})`)
    }
    const payload = await response.json() as JellyfinAuthResponse
    return parseAuthResponse(payload, deviceId, normalizedBaseUrl)
  }
}

