import type { ITokenInfo } from '../user/userstore'
import { applyQuotaValues } from '../drive/providerQuota'
import { cloud189Request } from './dirfilelist'

export const applyCloud189Quota = async (token: ITokenInfo): Promise<boolean> => {
  if (!token.user_id) return false
  try {
    const data = await cloud189Request(token.user_id, 'portal/getUserSizeInfo.action', {})
    // The account summary shows personal space, not the unrelated family quota.
    return applyQuotaValues(token, data?.cloudCapacityInfo?.totalSize, data?.cloudCapacityInfo?.usedSize)
  } catch {
    return false
  }
}
