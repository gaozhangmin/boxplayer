/** Detail heroes must not stretch a thumbnail across a desktop/Retina window. */
export function detailBackdropUrl(value?: string): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    if (url.hostname === 'image.tmdb.org') url.pathname = url.pathname.replace(/^\/t\/p\/w\d+\//, '/t/p/original/')
    else url.pathname = url.pathname.replace(/^(.*\/api\/tmdb\/image\/)w\d+\//, '$1original/')
    return url.href
  } catch { return value }
}
