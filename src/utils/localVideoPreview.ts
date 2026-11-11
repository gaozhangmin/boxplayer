export interface LocalVideoPreview { thumbnail: string; duration: number; height: number; hdr?: boolean }
const cache = new Map<string, Promise<LocalVideoPreview>>()
let active = 0
const waiting: Array<() => void> = []
async function readBrowserPreview(path: string): Promise<LocalVideoPreview> {
  if (active >= 2) await new Promise<void>(resolve => waiting.push(resolve))
  active++
  try {
    return await new Promise(resolve => {
      const video = document.createElement('video')
      const result: LocalVideoPreview = { thumbnail: '', duration: 0, height: 0 }
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        video.onloadedmetadata = video.onseeked = video.onerror = null
        video.removeAttribute('src'); video.load()
        resolve(result)
      }
      const timer = setTimeout(finish, 8000)
      video.muted = true; video.preload = 'metadata'
      video.onerror = finish
      video.onloadedmetadata = () => {
        result.duration = Number.isFinite(video.duration) ? video.duration : 0
        result.height = video.videoHeight || 0
        video.currentTime = Math.min(1, Math.max(0, result.duration / 4))
      }
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = 480; canvas.height = Math.round(480 * video.videoHeight / video.videoWidth)
          if (canvas.height > 0) {
            canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
            result.thumbnail = canvas.toDataURL('image/jpeg', .82)
          }
        } catch { /* Unsupported codecs or a security boundary retain the file placeholder. */ }
        finish()
      }
      const urlModule = window.require?.('url')
      video.src = urlModule?.pathToFileURL ? urlModule.pathToFileURL(path).href : 'file://' + encodeURI(path)
    })
  } finally { active--; waiting.shift()?.() }
}
// The main process decodes with libmpv (MKV, AV1, HEVC, HDR) and caches frames on disk;
// Chromium's <video> only covers what it can decode and is kept as a fallback.
async function readPreview(path: string): Promise<LocalVideoPreview> {
  const native = await window.WebLocalVideoPreview?.({ path }).catch(() => null)
  if (native?.thumbnail) return native
  const browser = await readBrowserPreview(path)
  return { thumbnail: browser.thumbnail, duration: native?.duration || browser.duration, height: native?.height || browser.height, hdr: !!native?.hdr }
}
export function getLocalVideoPreview(path: string): Promise<LocalVideoPreview> {
  if (!cache.has(path)) {
    if (cache.size >= 160) cache.delete(cache.keys().next().value!)
    cache.set(path, readPreview(path))
  }
  return cache.get(path)!
}
