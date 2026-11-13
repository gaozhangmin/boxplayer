import type { ITokenInfo } from '../user/userstore'
import { applyQuotaValues } from '../drive/providerQuota'
import { quarkAuthHeaders, syncQuarkCookiesToElectron, refreshQuarkAccountInfo } from './auth'

/** Profile failures must not prevent the independent drive-capacity request. */
export const refreshQuarkProfileAndQuota = async (token: ITokenInfo): Promise<boolean> => {
  const quotaToken = { ...token }
  const [profile, quota] = await Promise.allSettled([
    refreshQuarkAccountInfo(token),
    applyQuarkQuota(quotaToken)
  ])
  if (profile.status === 'fulfilled') Object.assign(token, profile.value)
  if (quota.status !== 'fulfilled' || !quota.value) return false
  // Merge quota last so a slower identity response cannot reset fresh capacity.
  token.total_size = quotaToken.total_size
  token.used_size = quotaToken.used_size
  token.free_size = quotaToken.free_size
  token.spaceinfo = quotaToken.spaceinfo
  return true
}

export const applyQuarkQuota = async (token: ITokenInfo): Promise<boolean> => {
  if (!token.access_token) return false
  try {
    await syncQuarkCookiesToElectron(token.access_token)
    const query = new URLSearchParams({ pr: 'ucpro', fr: 'pc', uc_param_str: '', fetch_subscribe: 'false', _ch: 'home', fetch_identity: 'false' })
    const response = await fetch(`https://drive-pc.quark.cn/1/clouddrive/member?${query}`, {
      credentials: 'include',
      signal: AbortSignal.timeout(15000),
      headers: quarkAuthHeaders(token.access_token)
    })
    const data = await response.json()
    if (!response.ok || data?.status === 'error' || (data?.code != null && Number(data.code) !== 0)) return false
    return applyQuotaValues(token, data?.data?.total_capacity, data?.data?.use_capacity)
  } catch {
    return false
  }
}
