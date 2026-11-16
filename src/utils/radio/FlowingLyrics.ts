// Original Canvas implementation shared with the Tauri renderer.
export type FlowingColors = { text: string; light: string; background: string }
export const DEFAULT_FLOWING_COLORS: FlowingColors = { text: '#D6ADFF', light: '#9850FF', background: '#090310' }
const font = (size: number) => `700 ${size}px "Arial Narrow", "PingFang SC", "Microsoft YaHei", sans-serif`
const fraction = (value: number) => value - Math.floor(value)
function rgba(hex: string, alpha: number): string {
  const value = /^#[\da-f]{6}$/i.test(hex) ? hex : '#9850FF'
  return `rgba(${parseInt(value.slice(1, 3), 16)},${parseInt(value.slice(3, 5), 16)},${parseInt(value.slice(5, 7), 16)},${alpha})`
}

// Split overlong words by Unicode code point; retain explicit line breaks.
export function wrapFlowingText(text: string, width: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const token of paragraph.match(/\s+|[^\s]+/gu) || []) {
      if (measure(line + token) <= width) { line += token; continue }
      if (line.trim()) { lines.push(line.trim()); line = '' }
      if (measure(token.trim()) <= width) { line = token.trimStart(); continue }
      for (const letter of Array.from(token.trim())) {
        if (line && measure(line + letter) > width) { lines.push(line); line = '' }
        line += letter
      }
    }
    lines.push(line.trim())
  }
  return lines.length ? lines : ['']
}

export class FlowingLyricsRenderer {
  private glyph = document.createElement('canvas')
  private points: Array<{ x: number; y: number }> = []
  private width = 1
  private height = 1
  private glyphHeight = 1
  private glyphWidth = 1
  private text = ''
  private colors = { ...DEFAULT_FLOWING_COLORS }
  private context: CanvasRenderingContext2D
  constructor(private canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D unavailable')
    this.context = context
  }
  resize(width: number, height: number): void {
    this.width = Math.max(1, width); this.height = Math.max(1, height)
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(this.width * scale); this.canvas.height = Math.round(this.height * scale)
    this.context.setTransform(scale, 0, 0, scale, 0, 0)
    this.rasterize()
  }
  update(text: string, colors: FlowingColors): void {
    const next = text.slice(0, 600)
    const changed = next !== this.text || colors.text !== this.colors.text
    this.text = next; this.colors = { ...colors }
    if (changed) this.rasterize()
  }
  private rasterize(): void {
    const context = this.glyph.getContext('2d')!
    const width = Math.max(1, Math.floor(Math.min(1200, this.width * .92)))
    const lineLimit = this.width > this.height ? (Array.from(this.text).length <= 12 ? 1 : 2) : 3
    const maxHeight = this.height * (this.width > this.height ? .56 : .42)
    let low = Math.min(26, maxHeight / 1.2), high = Math.max(low, Math.min(180, this.height * .29, width * .21))
    for (let i = 0; i < 10; i++) {
      const candidate = (low + high) / 2
      context.font = font(candidate)
      const lines = wrapFlowingText(this.text, width, value => context.measureText(value).width)
      if (lines.length <= lineLimit && lines.length * candidate * 1.2 <= maxHeight) low = candidate
      else high = candidate
    }
    context.font = font(low)
    const lines = wrapFlowingText(this.text, width, value => context.measureText(value).width)
    this.glyphWidth = width; this.glyphHeight = Math.max(1, Math.ceil(Math.min(maxHeight, lines.length * low * 1.2)))
    this.glyph.width = width; this.glyph.height = this.glyphHeight
    context.font = font(low); context.textAlign = 'center'; context.textBaseline = 'top'; context.fillStyle = this.colors.text
    lines.forEach((line, index) => context.fillText(line, width / 2, index * low * 1.2, width))
    const pixels = context.getImageData(0, 0, width, this.glyphHeight).data
    const sampled: typeof this.points = []
    for (let y = 0; y < this.glyphHeight; y += 2) for (let x = 0; x < width; x += 2) {
      if (pixels[(y * width + x) * 4 + 3] > 100) sampled.push({ x, y })
    }
    const step = Math.max(1, Math.ceil(sampled.length / 5600))
    this.points = sampled.filter((_, index) => index % step === 0)
  }
  draw(time: number, reduced = false, transparent = false): void {
    const c = this.context, w = this.width, h = this.height, colors = this.colors
    c.clearRect(0, 0, w, h)
    if (!transparent) {
      c.fillStyle = colors.background; c.fillRect(0, 0, w, h)
      const halo = c.createRadialGradient(w / 2, h * 1.02, 0, w / 2, h * 1.02, Math.max(w * .6, h * .7))
      halo.addColorStop(0, rgba(colors.light, .65)); halo.addColorStop(.42, rgba(colors.light, .2)); halo.addColorStop(1, rgba(colors.light, 0))
      c.fillStyle = halo; c.fillRect(0, 0, w, h)
    }
    const ox = (w - this.glyphWidth) / 2, oy = (h - this.glyphHeight) * .3
    c.save(); c.globalAlpha = reduced || transparent ? 1 : .24; c.shadowColor = colors.light; c.shadowBlur = 8
    c.drawImage(this.glyph, ox, oy); c.restore()
    if (reduced) return
    for (let i = 0; !transparent && i < 44; i++) {
      const seed = i * .6180339887
      c.fillStyle = rgba(colors.text, .08 + (Math.sin(time * .65 + seed * 10) + 1) * .08)
      c.fillRect(fraction(seed) * w, fraction(seed * 1.73) * h, 1.2, 1.2)
    }
    const travel = Math.min(360, h * .66)
    for (let i = 0; i < this.points.length; i += 8) {
      const p = this.points[i], seed = i * .618034, progress = fraction(time * .21 + seed)
      const distance = progress * travel, length = Math.min(distance, travel * (.35 + seed % .5))
      if (length < .1) continue
      const x = ox + p.x, y = oy + p.y + distance, alpha = Math.pow(1 - progress, 1.3) * .72
      const trail = c.createLinearGradient(x, y - length, x, y)
      trail.addColorStop(0, rgba(colors.light, 0)); trail.addColorStop(.6, rgba(colors.light, alpha * .7)); trail.addColorStop(1, rgba(colors.text, alpha))
      c.strokeStyle = trail; c.lineWidth = .6; c.beginPath(); c.moveTo(x, y - length); c.lineTo(x, y); c.stroke()
      c.fillStyle = rgba(colors.text, alpha); c.fillRect(x - .7, y - .7, 1.4, 1.4)
    }
    const grains = [new Path2D(), new Path2D(), new Path2D(), new Path2D()]
    const sweep = fraction(time * .16) * 1.8 - .4
    this.points.forEach((p, index) => {
      const seed = index * .754877666
      const band = Math.max(0, 1 - Math.abs(p.x / this.glyphWidth - sweep) / .2)
      const brightness = Math.min(.999, .5 + .5 * Math.sin(time * (1.1 + fraction(seed)) + seed * 7) + band * .2)
      const radius = .35 + seed % .6
      grains[Math.floor(brightness * 4)].rect(ox + p.x - radius, oy + p.y - radius, radius * 2, radius * 2)
    })
    grains.forEach((path, index) => { c.fillStyle = rgba(index === 3 ? '#FFFFFF' : colors.text, .25 + index * .22); c.fill(path) })
  }
}
