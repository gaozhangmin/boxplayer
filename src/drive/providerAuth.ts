import type { ITokenInfo } from '../user/userstore'
import { refreshCloud123AccessToken, refreshCloud123UserInfo } from '../cloud123/auth'
import { refreshBaiduAccessToken, refreshBaiduUserInfo } from '../cloudbaidu/auth'
import { build115UserId, refresh115AccessToken, refreshDrive115UserInfo } from '../cloud115/auth'
import { applyPikPakQuota, refreshPikPakAccessToken } from '../pikpak/auth'
import { applyDropboxQuota, refreshDropboxAccessToken } from '../dropbox/auth'
import { applyOneDriveQuota, refreshOneDriveAccessToken } from '../onedrive/auth'
import { applyBoxQuota, refreshBoxAccessToken } from '../box/auth'
import { applyGoogleQuota, refreshGoogleAccessToken } from '../google/auth'
import { applyGuangyaQuota } from '../guangya/auth'
import { refreshQuarkAccountInfo } from '../quark/auth'
import { refreshCloud189Token } from '../cloud189/auth'
import { applyCloud189Quota } from '../cloud189/quota'
import { refreshQuarkProfileAndQuota } from '../quark/quota'
import { resolveDriveProvider } from '../utils/driveProvider'

/** Refreshes standard OAuth providers. Undefined means the provider has custom session semantics. */
export const ensureProviderAccessToken = async (token: ITokenInfo, force = false): Promise<ITokenInfo | null | undefined> => {
  const provider = resolveDriveProvider(token.user_id, token.default_drive_id, token.tokenfrom).provider
  if (!['cloud123', 'baidu', 'pikpak', 'dropbox', 'onedrive', 'box', 'google'].includes(provider)) return undefined
  const expireTime = new Date(token.expire_time || 0).getTime()
  if (!force && token.access_token && (!expireTime || expireTime > Date.now())) return token
  const refreshed = provider === 'cloud123' ? await refreshCloud123AccessToken(token.refresh_token)
    : provider === 'baidu' ? await refreshBaiduAccessToken(token.refresh_token)
      : provider === 'pikpak' ? await refreshPikPakAccessToken(token)
        : provider === 'dropbox' ? await refreshDropboxAccessToken(token)
          : provider === 'onedrive' ? await refreshOneDriveAccessToken(token)
            : provider === 'box' ? await refreshBoxAccessToken(token)
              : await refreshGoogleAccessToken(token)
  if (!refreshed?.access_token) return null
  if (provider === 'cloud123' || provider === 'baidu') Object.assign(refreshed, { user_id: token.user_id || refreshed.user_id, user_name: refreshed.user_name || token.user_name, nick_name: refreshed.nick_name || token.nick_name, avatar: refreshed.avatar || token.avatar, tokenfrom: provider })
  return refreshed
}

/** Updates provider-owned quota fields. Undefined means no quota adapter exists. */
export const applyProviderQuota = async (token: ITokenInfo): Promise<boolean | undefined> => {
  const provider = resolveDriveProvider(token.user_id, token.default_drive_id, token.tokenfrom).provider
  switch (provider) {
    case 'pikpak': await applyPikPakQuota(token); return true
    case 'dropbox': await applyDropboxQuota(token); return true
    case 'onedrive': await applyOneDriveQuota(token); return true
    case 'box': await applyBoxQuota(token); return true
    case 'google': await applyGoogleQuota(token); return true
    case 'guangya': await applyGuangyaQuota(token); return true
    default: return undefined
  }
}

/** Completes provider-specific sessions that do not use the standard OAuth refresh contract. */
export const ensureProviderSession = async (token: ITokenInfo, force = false): Promise<ITokenInfo | null | undefined> => {
  const provider = resolveDriveProvider(token.user_id, token.default_drive_id, token.tokenfrom).provider
  if (provider === '115') {
    if (!token.user_id) token.user_id = build115UserId(token.refresh_token, token.access_token)
    const expireTime = new Date(token.expire_time || 0).getTime()
    if (force || !token.access_token || (expireTime && expireTime <= Date.now())) {
      const refreshed = await refresh115AccessToken(token.refresh_token)
      if (refreshed?.error || !refreshed?.access_token) return null
      token.access_token = refreshed.access_token
      if (refreshed.refresh_token) token.refresh_token = refreshed.refresh_token
      if (typeof refreshed.expires_in === 'number') token.expires_in = refreshed.expires_in
      token.token_type = refreshed.token_type || token.token_type
      token.expire_time = new Date(Date.now() + (token.expires_in || 0) * 1000).toISOString()
    }
    return token.user_id && token.access_token ? token : null
  }
  if (provider === 'quark') {
    token.default_drive_id = token.default_drive_id || 'quark'
    const accountId = token.user_id.replace(/^quark_/, '')
    const displayName = token.nick_name || token.user_name || token.name
    if (force || !displayName || displayName === token.user_id || displayName === accountId || displayName.startsWith('cookie_')) {
      try {
        Object.assign(token, await refreshQuarkAccountInfo(token))
      } catch {
        // Cookie 会话仍可用时，资料刷新失败不应阻断登录。
      }
    }
    return token.user_id && token.access_token ? token : null
  }
  if (provider === '139') {
    token.default_drive_id = token.default_drive_id || 'cloud139'
    return token.user_id && token.access_token ? token : null
  }
  if (provider === '189') {
    token.default_drive_id = token.default_drive_id || 'cloud189'
    if (!token.open_api_access_token || !token.open_api_refresh_token) {
      const refreshed = await refreshCloud189Token(token)
      return refreshed?.user_id ? refreshed : null
    }
    return token.user_id && token.refresh_token ? token : null
  }
  return undefined
}

/** Refreshes provider-owned identity and capacity fields. */
export const refreshProviderAccountInfo = async (token: ITokenInfo): Promise<boolean | undefined> => {
  const provider = resolveDriveProvider(token.user_id, token.default_drive_id, token.tokenfrom).provider
  switch (provider) {
    case 'cloud123': return await refreshCloud123UserInfo(token)
    case 'baidu': return await refreshBaiduUserInfo(token)
    case '115': return await refreshDrive115UserInfo(token)
    case 'quark':
      return await refreshQuarkProfileAndQuota(token)
    case '139':
      token.default_drive_id = token.default_drive_id || 'cloud139'
      return true
    case '189':
      token.default_drive_id = token.default_drive_id || 'cloud189'
      return await applyCloud189Quota(token)
    default: return undefined
  }
}
