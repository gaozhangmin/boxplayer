/** Shared by native MPV and HTML video controls. No playback seek is issued here. */
export class SeekThumbnailPreview {
  private readonly card = document.createElement('div')
  private readonly frame = document.createElement('div')
  private readonly image = document.createElement('img')
  private readonly spinner = document.createElement('div')
  private spin?: Animation
  private readonly time = document.createElement('div')
  private timer?: ReturnType<typeof setTimeout>
  private hideTimer?: ReturnType<typeof setTimeout>
  private generation = 0
  private bucket = -1
  private source = ''
  private disposed = false
  private pointerDown = false
  private readonly cleanups: Array<() => void> = []

  constructor(private readonly progress: HTMLElement,
    private readonly getSource: () => { url: string; headers?: Record<string, string>; duration: number }) {
    const parent = progress.parentElement!
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative'
    this.card.style.cssText = 'display:none;position:absolute;z-index:100;pointer-events:none;width:min(240px,80vw);padding:5px;border-radius:10px;border:1px solid #ffffff55;background:#111d;box-shadow:0 4px 18px #0006;color:white;text-align:center;line-height:20px;font:12px sans-serif;transform:translateX(-50%);white-space:normal'
    this.frame.style.cssText = 'display:none;position:relative;width:100%;aspect-ratio:16/9;border-radius:6px;background:black;overflow:hidden'
    this.image.style.cssText = 'display:none;width:100%;height:100%;object-fit:contain'
    this.image.alt = ''
    this.spinner.style.cssText = 'display:none;position:absolute;left:50%;top:50%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid #ffffff40;border-top-color:white;box-sizing:border-box'
    this.frame.append(this.image, this.spinner)
    this.card.append(this.frame, this.time)
    parent.append(this.card)
    this.listen(progress, 'pointermove', event => this.move(event as PointerEvent))
    this.listen(progress, 'pointerdown', event => { this.pointerDown = true; this.move(event as PointerEvent) })
    this.listen(progress, 'pointerleave', () => { if (!this.pointerDown) this.hide() })
    this.listen(window, 'pointerup', event => {
      if (!this.pointerDown) return
      this.pointerDown = false
      if ((event as PointerEvent).pointerType !== 'mouse' || !this.progress.matches(':hover')) this.hide()
    })
    this.listen(window, 'pointercancel', () => { this.pointerDown = false; this.hide() })
    this.listen(progress, 'blur', () => this.hide())
    this.listen(progress, 'input', () => {
      if (progress instanceof HTMLInputElement) this.show(Number(progress.value))
    })
  }

  private listen(target: EventTarget, name: string, handler: EventListener) {
    target.addEventListener(name, handler)
    this.cleanups.push(() => target.removeEventListener(name, handler))
  }

  private move(event: PointerEvent) {
    const { duration } = this.getSource()
    const rect = this.progress.getBoundingClientRect()
    if (duration > 0 && Number.isFinite(duration) && rect.width > 0)
      this.show(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * duration)
  }

  private show(seconds: number) {
    const source = this.getSource()
    if (this.disposed || !source.url || !Number.isFinite(source.duration) || source.duration <= 0 || !Number.isFinite(seconds)) { this.hide(); return }
    const rect = this.progress.getBoundingClientRect()
    const parent = this.progress.parentElement!.getBoundingClientRect()
    const fraction = Math.max(0, Math.min(1, seconds / source.duration))
    clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => this.hide(), 3000)
    this.card.style.display = 'block'
    const halfWidth = Math.min(120, parent.width / 2)
    this.card.style.left = `${Math.min(Math.max(halfWidth, rect.left - parent.left + rect.width * fraction), Math.max(halfWidth, parent.width - halfWidth))}px`
    this.card.style.bottom = `${parent.bottom - rect.top + 14}px`
    const whole = Math.max(0, Math.floor(seconds))
    this.time.textContent = `${Math.floor(whole / 3600) > 0 ? `${Math.floor(whole / 3600)}:` : ''}${String(Math.floor(whole / 60) % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
    const key = JSON.stringify([source.url, source.headers])
    const bucket = Math.floor(seconds / 2)
    if (this.bucket === bucket && this.source === key) return
    this.bucket = bucket; this.source = key
    this.image.style.display = 'none'
    this.image.removeAttribute('src')
    this.setLoading(true)
    const token = ++this.generation
    clearTimeout(this.timer)
    // Cancel native work immediately; only start the replacement after settling.
    window.WebCancelSeekThumbnail?.()
    this.timer = setTimeout(async () => {
      try {
        // Vue props are reactive Proxies; Electron IPC cannot structured-clone them.
        const headers: Record<string, string> = {}
        for (const [name, value] of Object.entries(source.headers || {})) if (typeof value === 'string') headers[name] = value
        const image = await window.WebSeekThumbnail?.({ url: source.url, headers, time: bucket * 2 })
        if (this.disposed || token !== this.generation) return
        if (image && this.source === JSON.stringify([this.getSource().url, this.getSource().headers])) {
          this.image.src = image
          this.image.style.display = 'block'
          this.setLoading(false)
        } else this.setLoading(false, true)
      } catch {
        // Time-only fallback when native capture or the source is unavailable.
        if (token === this.generation) this.setLoading(false, true)
      }
    }, 120)
  }

  /** Spinner while a frame is in flight; collapse to time-only when capture fails. */
  private setLoading(loading: boolean, failed = false) {
    this.frame.style.display = failed ? 'none' : 'block'
    this.spinner.style.display = loading ? 'block' : 'none'
    if (loading && !this.spin) this.spin = this.spinner.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 800, iterations: Infinity })
    if (!loading) { this.spin?.cancel(); this.spin = undefined }
  }

  hide() {
    clearTimeout(this.hideTimer)
    this.setLoading(false)
    this.generation++; this.bucket = -1
    clearTimeout(this.timer)
    this.card.style.display = 'none'
    window.WebCancelSeekThumbnail?.()
  }

  dispose() {
    this.hide(); this.disposed = true
    this.cleanups.splice(0).forEach(cleanup => cleanup())
    this.card.remove()
  }
}
