// Pure profile policies ported from Electron src/media-server/playbackQuality.ts (GPL-3.0).
export type MediaServerPlaybackQuality =
  | 'auto'
  | 'max'
  | '120000000'
  | '80000000'
  | '60000000'
  | '40000000'
  | '20000000'
  | '15000000'
  | '10000000'
  | '8000000'
  | '6000000'
  | '4000000'
  | '3000000'
  | '1500000'
  | '720000'
  | '420000'

export type MediaServerBitrateTestSize = '10000000' | '7500000' | '5000000' | '2500000' | '1000000'
export type MediaServerPlaybackCompatibility = 'auto' | 'mostCompatible' | 'directPlay' | 'custom'
export type MediaServerCustomDeviceProfileAction = 'add' | 'replace'
export const MEDIA_SERVER_MAX_PLAYBACK_BITRATE = 360000000

export interface MediaServerDeviceProfileEntry {
  Type: 'Video'
  Container?: string
  VideoCodec?: string
  AudioCodec?: string
  Protocol?: string
  Context?: string
  MaxAudioChannels?: string
  MinSegments?: string
  BreakOnNonKeyFrames?: boolean
}

export interface MediaServerCustomDeviceProfile {
  Action?: MediaServerCustomDeviceProfileAction
  MaxStreamingBitrate?: number
  MaxStaticBitrate?: number
  MusicStreamingTranscodingBitrate?: number
  DirectPlayProfiles: MediaServerDeviceProfileEntry[]
  TranscodingProfiles: MediaServerDeviceProfileEntry[]
}

const BOX_PLAYER_DIRECT_AUDIO_CODECS = [
  'aac',
  'ac3',
  'alac',
  'amr_nb',
  'amr_wb',
  'dts',
  'eac3',
  'flac',
  'mp1',
  'mp2',
  'mp3',
  'nellymoser',
  'opus',
  'pcm_alaw',
  'pcm_bluray',
  'pcm_dvd',
  'pcm_mulaw',
  'pcm_s16be',
  'pcm_s16le',
  'pcm_s24be',
  'pcm_s24le',
  'pcm_u8',
  'speex',
  'vorbis',
  'wavpack',
  'wmalossless',
  'wmapro',
  'wmav1',
  'wmav2'
]

const BOX_PLAYER_TRANSCODE_AUDIO_CODECS = [
  'aac',
  'ac3',
  'alac',
  'dts',
  'eac3',
  'flac',
  'mp1',
  'mp2',
  'mp3',
  'opus',
  'vorbis'
]

const BOX_PLAYER_TRANSCODE_VIDEO_CODECS = [
  'av1',
  'h263',
  'h264',
  'hevc',
  'mjpeg',
  'mpeg1video',
  'mpeg2video',
  'mpeg4',
  'vc1',
  'vp9'
]

export const MEDIA_SERVER_PLAYBACK_QUALITY_OPTIONS: Array<{ label: string, value: MediaServerPlaybackQuality }> = [
  { label: '自动', value: 'auto' },
  { label: '最高（直接播放）', value: 'max' },
  { label: '120 Mbps', value: '120000000' },
  { label: '80 Mbps', value: '80000000' },
  { label: '60 Mbps', value: '60000000' },
  { label: '40 Mbps', value: '40000000' },
  { label: '20 Mbps', value: '20000000' },
  { label: '15 Mbps', value: '15000000' },
  { label: '10 Mbps', value: '10000000' },
  { label: '8 Mbps', value: '8000000' },
  { label: '6 Mbps', value: '6000000' },
  { label: '4 Mbps', value: '4000000' },
  { label: '3 Mbps', value: '3000000' },
  { label: '1.5 Mbps', value: '1500000' },
  { label: '720 Kbps', value: '720000' },
  { label: '420 Kbps', value: '420000' }
]

export const MEDIA_SERVER_BITRATE_TEST_SIZE_OPTIONS: Array<{ label: string, value: MediaServerBitrateTestSize }> = [
  { label: '最大', value: '10000000' },
  { label: '较大', value: '7500000' },
  { label: '常规', value: '5000000' },
  { label: '较小', value: '2500000' },
  { label: '最小', value: '1000000' }
]

export const MEDIA_SERVER_COMPATIBILITY_OPTIONS: Array<{ label: string, value: MediaServerPlaybackCompatibility, description: string }> = [
  {
    label: '自动',
    value: 'auto',
    description: '使用浏览器兼容配置请求播放信息，不强制转码。'
  },
  {
    label: '兼容',
    value: 'mostCompatible',
    description: '优先请求服务器转为 H.264 视频和 AAC 音频。'
  },
  {
    label: '直连',
    value: 'directPlay',
    description: '优先播放原始格式，不支持的编码可能无法播放。'
  },
  {
    label: '自定义',
    value: 'custom',
    description: '使用下方保存的自定义设备配置文件请求播放信息。'
  }
]

export const isMediaServerPlaybackQuality = (value: unknown): value is MediaServerPlaybackQuality => {
  return MEDIA_SERVER_PLAYBACK_QUALITY_OPTIONS.some((option) => option.value === value)
}

export const isMediaServerBitrateTestSize = (value: unknown): value is MediaServerBitrateTestSize => {
  return MEDIA_SERVER_BITRATE_TEST_SIZE_OPTIONS.some((option) => option.value === value)
}

export const isMediaServerPlaybackCompatibility = (value: unknown): value is MediaServerPlaybackCompatibility => {
  return MEDIA_SERVER_COMPATIBILITY_OPTIONS.some((option) => option.value === value)
}

export const getMediaServerMaxStreamingBitrate = (quality: MediaServerPlaybackQuality): number | undefined => {
  if (quality === 'auto') return undefined
  if (quality === 'max') return MEDIA_SERVER_MAX_PLAYBACK_BITRATE
  return Number(quality)
}

const cleanText = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

const cleanBitrate = (value: unknown): number | undefined => {
  const bitrate = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(bitrate) && bitrate > 0 ? Math.floor(bitrate) : undefined
}

const normalizeProfileEntry = (value: unknown): MediaServerDeviceProfileEntry | null => {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  return {
    Type: 'Video',
    Container: cleanText(item.Container),
    VideoCodec: cleanText(item.VideoCodec),
    AudioCodec: cleanText(item.AudioCodec),
    Protocol: cleanText(item.Protocol),
    Context: cleanText(item.Context),
    MaxAudioChannels: cleanText(item.MaxAudioChannels),
    MinSegments: cleanText(item.MinSegments),
    BreakOnNonKeyFrames: typeof item.BreakOnNonKeyFrames === 'boolean' ? item.BreakOnNonKeyFrames : undefined
  }
}

const normalizeProfileEntries = (value: unknown): MediaServerDeviceProfileEntry[] => {
  if (!Array.isArray(value)) return []
  return value.map(normalizeProfileEntry).filter((item): item is MediaServerDeviceProfileEntry => item !== null)
}

export const buildMediaServerBrowserDeviceProfile = (
  maxStreamingBitrate?: number,
  compatibilityMode: MediaServerPlaybackCompatibility = 'auto'
): MediaServerCustomDeviceProfile => {
  const directPlayProfiles: MediaServerDeviceProfileEntry[] = compatibilityMode === 'directPlay'
    ? [{ Type: 'Video' }]
    : compatibilityMode === 'mostCompatible'
      ? [
          {
            Type: 'Video',
            Container: 'mp4',
            VideoCodec: 'h264',
            AudioCodec: 'aac'
          }
        ]
      : [
          {
            Type: 'Video',
            AudioCodec: BOX_PLAYER_DIRECT_AUDIO_CODECS.join(',')
          }
        ]
  const transcodingProfiles: MediaServerDeviceProfileEntry[] = compatibilityMode === 'directPlay'
    ? []
    : [
        {
          Type: 'Video',
          Container: 'mp4',
          Protocol: 'hls',
          AudioCodec: compatibilityMode === 'mostCompatible' ? 'aac' : BOX_PLAYER_TRANSCODE_AUDIO_CODECS.join(','),
          VideoCodec: compatibilityMode === 'mostCompatible' ? 'h264' : BOX_PLAYER_TRANSCODE_VIDEO_CODECS.join(','),
          Context: 'Streaming',
          MaxAudioChannels: '8',
          MinSegments: '2',
          BreakOnNonKeyFrames: true
        }
      ]

  return {
    Action: 'replace',
    MaxStreamingBitrate: maxStreamingBitrate,
    MaxStaticBitrate: maxStreamingBitrate,
    MusicStreamingTranscodingBitrate: maxStreamingBitrate,
    DirectPlayProfiles: directPlayProfiles,
    TranscodingProfiles: transcodingProfiles
  }
}

export const DEFAULT_MEDIA_SERVER_CUSTOM_DEVICE_PROFILE: MediaServerCustomDeviceProfile = {
  Action: 'add',
  DirectPlayProfiles: [],
  TranscodingProfiles: []
}

export const normalizeMediaServerCustomDeviceProfile = (value: unknown): MediaServerCustomDeviceProfile => {
  if (!value || typeof value !== 'object') return DEFAULT_MEDIA_SERVER_CUSTOM_DEVICE_PROFILE
  const profile = value as Record<string, unknown>
  const directPlayProfiles = normalizeProfileEntries(profile.DirectPlayProfiles)
  const transcodingProfiles = normalizeProfileEntries(profile.TranscodingProfiles)
  const action = profile.Action === 'replace' ? 'replace' : 'add'
  return {
    Action: action,
    MaxStreamingBitrate: cleanBitrate(profile.MaxStreamingBitrate),
    MaxStaticBitrate: cleanBitrate(profile.MaxStaticBitrate),
    MusicStreamingTranscodingBitrate: cleanBitrate(profile.MusicStreamingTranscodingBitrate),
    DirectPlayProfiles: directPlayProfiles,
    TranscodingProfiles: transcodingProfiles
  }
}

export const buildMediaServerDeviceProfile = (
  maxStreamingBitrate?: number,
  compatibilityMode: MediaServerPlaybackCompatibility = 'auto',
  customProfile?: MediaServerCustomDeviceProfile
): MediaServerCustomDeviceProfile => {
  const profile = compatibilityMode === 'custom'
    ? (() => {
        const custom = normalizeMediaServerCustomDeviceProfile(customProfile)
        const base = buildMediaServerBrowserDeviceProfile(undefined, 'auto')
        if (custom.Action === 'replace') {
          return {
            ...custom,
            TranscodingProfiles: custom.TranscodingProfiles.length > 0
              ? custom.TranscodingProfiles
              : base.TranscodingProfiles
          }
        }
        return {
          ...base,
          DirectPlayProfiles: [
            ...base.DirectPlayProfiles,
            ...custom.DirectPlayProfiles
          ],
          TranscodingProfiles: [
            ...base.TranscodingProfiles,
            ...custom.TranscodingProfiles
          ]
        }
      })()
    : buildMediaServerBrowserDeviceProfile(undefined, compatibilityMode)
  if (typeof maxStreamingBitrate !== 'number') return profile
  return {
    ...profile,
    MaxStreamingBitrate: maxStreamingBitrate,
    MaxStaticBitrate: maxStreamingBitrate,
    MusicStreamingTranscodingBitrate: maxStreamingBitrate
  }
}
