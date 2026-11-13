import type { ITokenInfo } from '../user/userstore'
import { humanSize } from '../utils/format'

/** Missing or malformed quota must never replace the last known capacity with zero. */
export const applyQuotaValues = (token: ITokenInfo, total: unknown, used: unknown): boolean => {
  if ((typeof total !== 'number' && typeof total !== 'string') || (typeof used !== 'number' && typeof used !== 'string')) return false
  if (String(total).trim() === '' || String(used).trim() === '') return false
  const totalSize = Number(total)
  const usedSize = Number(used)
  if (!Number.isFinite(totalSize) || !Number.isFinite(usedSize) || totalSize < 0 || usedSize < 0) return false
  token.total_size = totalSize
  token.used_size = usedSize
  token.free_size = Math.max(0, totalSize - usedSize)
  token.spaceinfo = `${humanSize(usedSize)} / ${humanSize(totalSize)}`
  return true
}
