export const maxCoverBytes = 8 * 1024 * 1024
/** Native picker validates the image bytes; persisted input must also stay raster-only and bounded. */
export function isLocalCoverData(value: string): boolean {
 if (value.length > Math.ceil(maxCoverBytes / 3) * 4 + 40) return false
 const match = /^data:image\/(?:png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
 if (!match || match[1]!.length % 4 !== 0) return false
 const encoded = match[1]!, bytes = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0)
 return bytes > 0 && bytes <= maxCoverBytes
}
export function validServerCover(value: string): boolean {
 if (!value) return true
 if (value.startsWith('data:')) return isLocalCoverData(value)
 return !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) && !/[\\\r\n]/.test(value) && !/(?:[?&])(?:token|api_key|x-plex-token|authorization)=/i.test(value)
}
