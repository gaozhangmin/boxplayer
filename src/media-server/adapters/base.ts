import type { MediaServerConfig, MediaServerType } from '../../types/mediaServer'

export interface MediaServerSignInInput {
  type: MediaServerType
  name: string
  baseUrl: string
  notes?: string
  host?: string
  port?: string
  path?: string
  username?: string
  password?: string
  useHttps?: boolean
  syncFlag?: boolean
  backupAddresses?: Record<string, string>
}

export interface MediaServerSignInResult {
  accessToken?: string
  refreshToken?: string
  userId?: string
  deviceId?: string
  selectedResourceId?: string
  selectedResourceName?: string
  normalizedBaseUrl: string
}

export interface MediaServerAdapter {
  type: MediaServerType
  signIn(input: MediaServerSignInInput): Promise<MediaServerSignInResult>
  validateSession?(config: MediaServerConfig): Promise<boolean>
}

export const normalizeServerBaseUrl = (baseUrl: string) => {
  const url = new URL(baseUrl)
  url.pathname = url.pathname.replace(/\/+$/, '') || ''
  return url.toString().replace(/\/$/, '')
}

export const generateDeviceId = () => `media-server-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`


export class MediaServerAuthenticationError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export const isMediaServerAuthenticationRejected = (error: unknown): boolean =>
  error instanceof MediaServerAuthenticationError && [401, 403].includes(error.status)
