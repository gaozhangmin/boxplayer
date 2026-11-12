export function detailSeriesId(id: string): string {
  return id.replace(/_\d+_\d+$/, '')
}

export function detailResumeState(positionSeconds: number | undefined, durationSeconds: number | undefined, progressPercent?: number) {
  const position = Number(positionSeconds)
  const duration = Number(durationSeconds)
  if (!Number.isFinite(position) || position < 1) return null
  const seconds = Math.floor(position)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds / 60) % 60
  const time = hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${minutes}:${String(seconds % 60).padStart(2, '0')}`
  const percent = Number.isFinite(duration) && duration > 0 ? position / duration * 100 : Number(progressPercent)
  return { label: `继续播放：${time}`, percent: Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 0 }
}

export function videoDurationSeconds(value?: string): number {
  if (!value) return 0
  const parts = value.split(':').map(Number)
  if (parts.some(part => !Number.isFinite(part) || part < 0)) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}
