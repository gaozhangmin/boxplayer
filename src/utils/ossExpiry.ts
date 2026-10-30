/** OSS V4 uses signing time + lifetime; older Aliyun URLs use an epoch. */
export function getOssExpiryTime(value: string): number {
  try {
    // Some callers store a URI-encoded URL. Do not decode an ordinary URL's
    // entire query: escaped ampersands inside signatures are not separators.
    const url = new URL(value.includes('://') ? value : decodeURIComponent(value))
    const raw = url.searchParams.get('x-oss-expires')
    if (!raw || !/^\d+$/.test(raw)) return 0
    const seconds = Number(raw)
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return 0
    const date = url.searchParams.get('x-oss-date')
    const v4 = url.searchParams.get('x-oss-signature-version') === 'OSS4-HMAC-SHA256'
    if (date || v4) {
      if (!date || !/^\d{8}T\d{6}Z$/.test(date) || seconds > 604800) return 0
      const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${date.slice(9, 11)}:${date.slice(11, 13)}:${date.slice(13, 15)}Z`
      const signedAt = Date.parse(iso)
      if (!Number.isFinite(signedAt) || new Date(signedAt).toISOString().replace(/[-:]/g, '').replace('.000', '') !== date) return 0
      return signedAt + seconds * 1000
    }
    const epoch = seconds * 1000
    return Number.isSafeInteger(epoch) ? epoch : 0
  } catch {
    return 0
  }
}
