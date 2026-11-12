export const GUANGYA_WEB_URL = 'https://www.guangyapan.com'

export const GUANGYA_API_URL = 'https://api.guangyapan.com'

export const GUANGYA_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

export const generateGuangyaDid = (): string => {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const generateGuangyaTraceparent = (): string => {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `00-${hex.slice(0, 32)}-${hex.slice(32, 48)}-01`
}
