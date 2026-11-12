import type { MediaServerMediaInfoCard } from '../types/mediaServerContent'

const selectedCard = (cards: MediaServerMediaInfoCard[], kind: MediaServerMediaInfoCard['kind']) =>
  cards.find(card => card.kind === kind && card.selected) || cards.find(card => card.kind === kind)

const rowValue = (card: MediaServerMediaInfoCard | undefined, ...labels: string[]) =>
  card?.rows.find(row => labels.includes(row.label))?.value

const codecLabel = (raw: string | undefined) => {
  const name = raw?.toUpperCase()
  if (name === 'H264' || name === 'AVC') return 'H.264'
  if (name === 'H265' || name === 'HEVC') return 'H.265'
  if (name === 'EAC3' || name === 'E-AC-3') return 'E-AC-3'
  if (name === 'AC3' || name === 'AC-3') return 'AC-3'
  return name
}

const resolutionLabel = (raw: string | undefined) => {
  const dimensions = raw?.match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!dimensions) return raw
  const width = Number(dimensions[1])
  const height = Number(dimensions[2])
  if (width >= 7000 || height >= 4000) return '8K'
  if (width >= 3800 || height >= 2000) return '4K'
  return height > 0 ? `${height}p` : raw
}

const channelLabel = (card: MediaServerMediaInfoCard | undefined) => {
  const layout = rowValue(card, '布局')?.match(/\d+\.\d+/)?.[0]
  const channels = rowValue(card, 'Channels')
  return layout || ({ '1': '1.0', '2': '2.0', '6': '5.1', '8': '7.1' } as Record<string, string>)[channels || ''] || channels
}

export const mediaVersionQualityTitle = (cards: MediaServerMediaInfoCard[]): string => {
  const video = selectedCard(cards, 'video')
  const fps = Number(rowValue(video, '帧率'))
  return [
    resolutionLabel(rowValue(video, '分辨率')),
    fps > 0 ? `${Number(fps.toFixed(2))}fps` : undefined,
    rowValue(video, 'Video range', '视频范围', '范围'),
    rowValue(video, '比特率')?.replace(/(\d)(Mbps|kbps)/i, '$1 $2')
  ].filter(Boolean).join(' · ')
}

export const mediaVersionQualityDetails = (cards: MediaServerMediaInfoCard[]): string => {
  const video = selectedCard(cards, 'video')
  const audio = selectedCard(cards, 'audio')
  const audioLabel = [codecLabel(rowValue(audio, 'Codec')), channelLabel(audio)].filter(Boolean).join(' ')
  return [codecLabel(rowValue(video, 'Codec')), audioLabel || undefined].filter(Boolean).join(' - ')
}

export const mediaFileSummary = (fileLabel: string | undefined, cards: MediaServerMediaInfoCard[]): string => {
  const video = cards.find(card => card.kind === 'video' && card.selected) || cards.find(card => card.kind === 'video')
  const audio = cards.find(card => card.kind === 'audio' && card.selected) || cards.find(card => card.kind === 'audio')
  const value = (card: MediaServerMediaInfoCard | undefined, label: string) => card?.rows.find(row => row.label === label)?.value
  const codec = codecLabel
  const size = fileLabel?.match(/\d+(?:\.\d+)?\s*(?:TB|GB|MB|KB|B)\b/i)?.[0].replace(/(\d)([A-Z])/i, '$1 $2')
  const dimensions = value(video, '分辨率')?.match(/(\d+)\s*[x×]\s*(\d+)/i)
  const resolution = dimensions ? '(' + dimensions[2] + 'p)' : value(video, '分辨率')
  const layout = value(audio, '布局')
  const channels = value(audio, 'Channels')
  const channelLabel = layout?.match(/\d+\.\d+/)?.[0] || ({ '1': '1.0', '2': '2.0', '6': '5.1', '8': '7.1' } as Record<string, string>)[channels || ''] || channels
  const audioLabel = [codec(value(audio, 'Codec')), channelLabel].filter(Boolean).join(' ')
  const bitrate = value(video, '比特率')?.replace(/(\d)(Mbps|kbps)/i, '$1 $2')
  const frameRate = Number(value(video, '帧率'))
  return [size, codec(value(video, 'Codec')), resolution, audioLabel, bitrate, frameRate > 0 ? Number(frameRate.toFixed(2)) + ' fps' : undefined].filter(Boolean).join('   ')
}
