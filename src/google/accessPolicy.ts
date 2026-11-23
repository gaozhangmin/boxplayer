import type { ITokenInfo } from '../user/userstore'

export const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'
export const GOOGLE_DRIVE_READ_ONLY_MESSAGE = 'Google Drive 当前仅支持只读访问'
export const GOOGLE_DRIVE_RECONNECT_MESSAGE = '请在添加来源中重新连接 Google Drive，授予只读权限；无需先删除已有来源'

export const hasGoogleDriveReadOnlyScope = (scope: unknown): boolean =>
  typeof scope === 'string' && scope.trim() === GOOGLE_DRIVE_SCOPE

export const hasVerifiedGoogleDriveGrant = (token: Pick<ITokenInfo, 'google_drive_scope'>): boolean =>
  hasGoogleDriveReadOnlyScope(token.google_drive_scope)

export const isGoogleDriveReadRequest = (path: string, method = 'GET'): boolean => {
  if (!path.startsWith('/') || path.startsWith('//')) return false
  const url = new URL('/drive/v3' + path, 'https://www.googleapis.com')
  if (!url.pathname.startsWith('/drive/v3/')) return false
  const normalizedMethod = method.toUpperCase()
  // files.download is a read-only long-running operation even though it uses POST.
  return normalizedMethod === 'GET' || (normalizedMethod === 'POST' && /^\/drive\/v3\/files\/[^/]+\/download$/.test(url.pathname))
}
