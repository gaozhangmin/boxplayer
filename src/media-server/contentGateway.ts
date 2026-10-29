import { rememberServerFolderFavorite } from './folderFavorites'
import { serverPageOrder, type MediaServerPageSort } from '../utils/mediaServerPageSort'
import type { MediaServerConfig } from '../types/mediaServer'
import { serverFavoriteType } from './favoriteCategories'
import type {
  MediaServerCardItem,
  MediaServerExternalLink,
  MediaServerDownloadInfo,
  MediaServerHomeData,
  MediaServerHomeLibrarySection,
  MediaServerMediaInfoCard,
  MediaServerPlaybackInfo,
  MediaServerSourceOption,
  MediaServerItemDetail,
  MediaServerLibraryNode,
  MediaServerMusicTrack,
  MediaServerPagedLibraryPage,
  MediaServerPagedCollection,
  MediaServerPerson,
  MediaServerSearchData
} from '../types/mediaServerContent'
import { buildMediaServerImageUrl, mediaServerFetch, mediaServerFetchVoid, mediaServerHeaders } from './http'
import type { MediaServerHomePreferencesState } from '../store/mediaServerHomePreferences'
import {
  buildMediaServerDeviceProfile,
  getMediaServerMaxStreamingBitrate,
  MEDIA_SERVER_MAX_PLAYBACK_BITRATE,
  type MediaServerBitrateTestSize,
  type MediaServerCustomDeviceProfile,
  type MediaServerPlaybackCompatibility,
  type MediaServerPlaybackQuality
} from './playbackQuality'
import {
  getPlexMediaServerCollectionPage,
  getPlexMediaServerDownloadInfo,
  getPlexMediaServerExcludedLibraries,
  getPlexMediaServerFilteredPagedItems,
  getPlexMediaServerHomeLatest,
  getPlexMediaServerHomeLibraryLatest,
  getPlexMediaServerHomeNextUp,
  getPlexMediaServerHomeResume,
  getPlexMediaServerHomeShell,
  getPlexMediaServerHomeWithPreferences,
  getPlexMediaServerItemDetail,
  getPlexMediaServerLibraries,
  getPlexMediaServerMusicTracks,
  getPlexMediaServerLibraryPagedItems,
  getPlexMediaServerPersonPagedItems,
  getPlexMediaServerPlaybackInfo,
  getPlexMediaServerSearch,
  getPlexMediaServerSimilarItems,
  getPlexMediaServerSuggestions,
  reportPlexMediaServerPlaybackProgress,
  updatePlexMediaServerFavoriteState,
  updatePlexMediaServerPlayedState
} from './plexContent'

const HOME_ITEM_FIELDS = 'Genres,ProductionLocations,Overview,PrimaryImageAspectRatio,ProductionYear,PremiereDate,DateCreated,Path,SortName,CommunityRating,CriticRating,Studios,Artists,OfficialRating,MediaSources,SeriesName,AirTime'

interface MediaServerBaseItem {
  Path?: string
  Id?: string
  Key?: string
  ratingKey?: string
  ETag?: string
  SeriesId?: string
  Duration?: number
  Name?: string
  SortName?: string
  CriticRating?: number
  AirTime?: string
  Type?: string
  Overview?: string
  ProductionYear?: number
  CommunityRating?: number
  RunTimeTicks?: number
  ParentIndexNumber?: number
  IndexNumber?: number
  SeriesName?: string
  Album?: string
  AlbumArtist?: string
  Artists?: string[]
  ArtistItems?: Array<{ Name?: string }>
  ParentBackdropItemId?: string
  ParentBackdropImageTags?: string[]
  ImageTags?: Record<string, string>
  PrimaryImageTag?: string
  BackdropImageTags?: string[]
  ScreenshotImageTags?: string[]
  CollectionType?: string
  ChildCount?: number
  Genres?: string[]
  Studios?: Array<{ Name?: string }>
  ProviderIds?: Record<string, string>
  ExternalUrls?: Array<{
    Name?: string
    Url?: string
  }>
  Taglines?: string[]
  OfficialRating?: string
  PremiereDate?: string
  EndDate?: string
  DateCreated?: string
  BirthDate?: string
  DeathDate?: string
  BirthPlace?: string
  ProductionLocations?: string[]
  MediaSources?: MediaServerMediaSource[]
  Chapters?: Array<{
    Name?: string
    StartPositionTicks?: number
  }>
  People?: Array<{
    Id?: string
    Name?: string
    Role?: string
    PrimaryImageTag?: string
  }>
  UserData?: {
    PlaybackPositionTicks?: number
    PlayPercentage?: number
    PlayedPercentage?: number
    IsPlayed?: boolean
    Played?: boolean
    IsFavorite?: boolean
    PlayCount?: number
    LastPlayedDate?: string
  }
}

interface MediaServerMediaSource {
  Id?: string
  Name?: string
  Path?: string
  Size?: number
  Bitrate?: number
  ETag?: string
  Protocol?: string
  DirectStreamUrl?: string
  XOriginDirectStreamUrl?: string
  TranscodingUrl?: string
  PartKey?: string
  DefaultAudioStreamIndex?: number
  DefaultSubtitleStreamIndex?: number
  RequiredHttpHeaders?: Record<string, string>
  MediaStreams?: MediaServerMediaStream[]
}

interface MediaServerMediaStream {
  Index?: number
  Type?: string
  DisplayTitle?: string
  Title?: string
  Language?: string
  Codec?: string
  Width?: number
  Height?: number
  RealFrameRate?: number
  AverageFrameRate?: number
  BitRate?: number
  VideoRange?: string
  Profile?: string
  Level?: number
  IsInterlaced?: boolean
  BitDepth?: number
  PixelFormat?: string
  ColorSpace?: string
  ColorTransfer?: string
  ColorPrimaries?: string
  AspectRatio?: string
  ChannelLayout?: string
  Channels?: number
  SampleRate?: number
  BitRateMode?: string
  IsDefault?: boolean
  IsExternal?: boolean
  IsForced?: boolean
  DeliveryUrl?: string
}

const browserUnsupportedAudioCodecs = new Set([
  'ac3',
  'ac-3',
  'eac3',
  'ec-3',
  'dts',
  'dts-hd',
  'dca',
  'truehd',
  'mlp'
])

const requiresBrowserAudioTranscoding = (source: MediaServerMediaSource | undefined, audioStreamIndex?: number) => {
  const audioStreams = (source?.MediaStreams || []).filter((stream) => (stream.Type || '').toLowerCase() === 'audio')
  if (audioStreams.length === 0) return false
  const selectedStream = typeof audioStreamIndex === 'number' && audioStreamIndex >= 0
    ? audioStreams.find((stream) => stream.Index === audioStreamIndex)
    : audioStreams.find((stream) => stream.Index === source?.DefaultAudioStreamIndex)
      || audioStreams.find((stream) => stream.IsDefault)
      || audioStreams[0]
  return browserUnsupportedAudioCodecs.has(String(selectedStream?.Codec || '').toLowerCase())
}

interface BaseQueryResult {
  Items?: MediaServerBaseItem[]
  TotalRecordCount?: number
}

interface ItemCountsResult {
  MovieCount?: number
  SeriesCount?: number
  EpisodeCount?: number
}

interface UserDetailResult {
  Configuration?: {
    LatestItemsExcludes?: string[]
  }
}

const toRuntimeMinutes = (ticks?: number) => {
  if (!ticks) return undefined
  return Math.max(1, Math.round(ticks / 10_000_000 / 60))
}

const extractYear = (...values: Array<number | string | undefined>) => {
  for (const value of values) {
    if (typeof value === 'number' && value > 0) return value
    if (typeof value !== 'string' || !value) continue
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.getFullYear()
    const matched = value.match(/\b(19|20)\d{2}\b/)
    if (matched) return Number(matched[0])
  }
  return undefined
}

const toProgress = (item: MediaServerBaseItem) => {
  const explicit = item.UserData?.PlayedPercentage ?? item.UserData?.PlayPercentage
  if (typeof explicit === 'number') return Math.max(0, Math.min(100, explicit))
  if (item.UserData?.PlaybackPositionTicks && item.RunTimeTicks) {
    return Math.max(0, Math.min(100, (item.UserData.PlaybackPositionTicks / item.RunTimeTicks) * 100))
  }
  return undefined
}

const toKind = (type?: string): MediaServerCardItem['kind'] => {
  switch ((type || '').toLowerCase()) {
    case 'video':
    case 'movie': return 'movie'
    case 'series': return 'series'
    case 'season': return 'season'
    case 'episode': return 'episode'
    case 'person': return 'person'
    case 'folder':
    case 'collectionfolder': return 'folder'
    default: return 'unknown'
  }
}

type MediaServerImageTypeKey =
  | 'Primary'
  | 'Thumb'
  | 'Backdrop'
  | 'Logo'
  | 'Profile'
  | 'Screenshot'

const buildImageUrlFromTag = (
  config: MediaServerConfig,
  itemId: string,
  imageType: MediaServerImageTypeKey,
  tag?: string,
  requireTag = true
) => {
  if (!tag && requireTag) return undefined
  if (tag && /^https?:\/\//i.test(tag)) return tag
  if (!itemId) return undefined
  return buildMediaServerImageUrl(config, itemId, imageType, tag)
}

const mapItem = (config: MediaServerConfig, item: MediaServerBaseItem): MediaServerCardItem => {
  const itemKind = toKind(item.Type)
  const directPrimary = buildImageUrlFromTag(
    config,
    item.Id || '',
    'Primary',
    item.ImageTags?.Primary || item.PrimaryImageTag
  )
  const directThumb = buildImageUrlFromTag(
    config,
    item.Id || '',
    'Thumb',
    item.ImageTags?.Thumb
  )
  const directBackdrop = buildImageUrlFromTag(
    config,
    item.Id || '',
    'Backdrop',
    item.BackdropImageTags?.[0] || item.ImageTags?.Backdrop
  )
  const parentBackdrop = item.ParentBackdropItemId
    ? buildImageUrlFromTag(
        config,
        item.ParentBackdropItemId,
        'Backdrop',
        item.ParentBackdropImageTags?.[0],
        false
      )
    : undefined
  const directScreenshot = buildImageUrlFromTag(
    config,
    item.Id || '',
    'Screenshot',
    item.ScreenshotImageTags?.[0]
  )
  const images = {
    primary: directPrimary,
    thumb: directThumb,
    backdrop: directBackdrop,
    parentBackdrop,
    screenshot: directScreenshot,
    logo: buildImageUrlFromTag(
      config,
      item.Id || '',
      'Logo',
      item.ImageTags?.Logo
    ),
    profile: buildImageUrlFromTag(
      config,
      item.Id || '',
      'Profile',
      item.ImageTags?.Profile || item.PrimaryImageTag
    ),
    seriesPrimary: item.SeriesId
      ? buildImageUrlFromTag(config, item.SeriesId, 'Primary', undefined, false)
      : undefined,
    seriesThumb: item.SeriesId
      ? buildImageUrlFromTag(config, item.SeriesId, 'Thumb', undefined, false)
      : undefined,
    seriesBackdrop: item.SeriesId
      ? buildImageUrlFromTag(config, item.SeriesId, 'Backdrop', undefined, false)
      : undefined
  }
  const poster = images.primary || images.profile || images.seriesPrimary
  const backdrop = images.backdrop || images.parentBackdrop || images.screenshot || images.seriesBackdrop || images.seriesThumb || images.thumb || images.primary
  const episodePrefix = item.ParentIndexNumber && item.IndexNumber ? `S${item.ParentIndexNumber}E${item.IndexNumber}` : ''
  const title = itemKind === 'episode' && episodePrefix
    ? `${episodePrefix} · ${item.Name || '未命名'}`
    : item.Name || '未命名'

  return {
    id: item.Id || '',
    serverId: config.id,
    provider: config.type,
    kind: itemKind,
    rawType: item.Type,
    seriesId: item.SeriesId,
    title,
    overview: item.Overview,
    poster,
    backdrop,
    images,
    sortName: item.SortName,
    createdAt: item.DateCreated,
    criticRating: item.CriticRating,
    playCount: item.UserData?.PlayCount,
    videoBitrate: item.MediaSources?.[0]?.MediaStreams?.find(stream => stream.Type?.toLowerCase() === 'video')?.BitRate || item.MediaSources?.[0]?.Bitrate,
    airTime: item.AirTime,
    studio: item.Studios?.map(studio => studio.Name).filter(Boolean).join(', '),
    artist: item.Artists?.join(', ') || item.AlbumArtist,
    officialRating: item.OfficialRating,
    seriesTitle: item.SeriesName,
    fileName: item.Path?.split(/[\\/]/).filter(Boolean).pop(),
    addedAt: item.DateCreated,
    premiereDate: item.PremiereDate,
    year: extractYear(item.ProductionYear, item.PremiereDate, item.DateCreated),
    genres: item.Genres || [],
    productionLocations: item.ProductionLocations || [],
    rating: item.CommunityRating,
    tmdbId: Number(Object.entries(item.ProviderIds || {}).find(([key]) => key.toLowerCase() === 'tmdb')?.[1]) || undefined,
    imdbId: Object.entries(item.ProviderIds || {}).find(([key]) => key.toLowerCase() === 'imdb')?.[1],
    runtimeMinutes: toRuntimeMinutes(item.RunTimeTicks),
    progress: toProgress(item),
    parentTitle: item.SeriesName || item.Album,
    seasonCount: item.Type === 'Series' ? item.ChildCount : undefined,
    seasonNumber: item.ParentIndexNumber,
    episodeNumber: item.IndexNumber,
    isPlayed: item.UserData?.IsPlayed ?? item.UserData?.Played,
    isFavorite: item.UserData?.IsFavorite
  }
}

const mapLibraryNode = (config: MediaServerConfig, item: MediaServerBaseItem): MediaServerLibraryNode => ({
  ...mapItem(config, item),
  childCount: item.ChildCount,
  collectionType: item.CollectionType
})

const mapPerson = (
  config: MediaServerConfig,
  person: NonNullable<MediaServerBaseItem['People']>[number]
): MediaServerPerson => ({
  id: person.Id || '',
  name: person.Name || '未知人物',
  role: person.Role,
  image: person.PrimaryImageTag && person.Id
    ? buildMediaServerImageUrl(config, person.Id, 'Primary', person.PrimaryImageTag)
    : undefined
})

const formatDateLabel = (value?: string) => {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

const formatBitrate = (value?: number) => {
  if (!value || value <= 0) return undefined
  return value >= 1_000_000 ? `${Number((value / 1_000_000).toFixed(1))}Mbps` : `${Math.round(value / 1_000)}kbps`
}

const formatSize = (value?: number) => {
  if (!value || value <= 0) return undefined
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }
  return `${current >= 10 ? current.toFixed(1).replace(/\.0$/, '') : current.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}${units[unitIndex]}`
}

const createExternalLinks = (item: MediaServerBaseItem): MediaServerExternalLink[] => {
  const providerIds = item.ProviderIds || {}
  const links: MediaServerExternalLink[] = []
  const pushLink = (title?: string, url?: string) => {
    const normalizedTitle = (title || '').trim()
    const normalizedUrl = (url || '').trim()
    if (!normalizedUrl) return
    if (links.some((link) => link.url === normalizedUrl)) return
    links.push({
      title: normalizedTitle || '外部链接',
      url: normalizedUrl
    })
  }

  for (const external of item.ExternalUrls || []) {
    pushLink(external.Name, external.Url)
  }

  if (links.length > 0) {
    return links
  }

  const imdbId = Object.entries(providerIds).find(([key]) => key.toLowerCase() === 'imdb')?.[1]
  if (imdbId) {
    const imdbPath = toKind(item.Type) === 'person' ? 'name' : 'title'
    pushLink('IMDb', `https://www.imdb.com/${imdbPath}/${imdbId}`)
  }
  const tmdbId = Object.entries(providerIds).find(([key]) => key.toLowerCase() === 'tmdb')?.[1]
  if (tmdbId) {
    const kind = toKind(item.Type)
    const tmdbType = kind === 'person'
      ? 'person'
      : ['series', 'season', 'episode'].includes(kind)
        ? 'tv'
        : 'movie'
    pushLink('TheMovieDb', `https://www.themoviedb.org/${tmdbType}/${tmdbId}`)
  }
  const tvdbId = Object.entries(providerIds).find(([key]) => key.toLowerCase() === 'tvdb')?.[1]
  if (tvdbId) {
    const tvdbPath = toKind(item.Type) === 'person' ? 'people' : 'series'
    pushLink('TheTVDB', `https://thetvdb.com/dereferrer/${tvdbPath}/${tvdbId}`)
  }
  return links
}

const createMediaInfoCardsForSource = (source?: MediaServerMediaSource): MediaServerMediaInfoCard[] => {
  const streams = source?.MediaStreams || []
  const groups: Record<'video' | 'audio' | 'subtitle', MediaServerMediaStream[]> = {
    video: streams.filter((stream) => (stream.Type || '').toLowerCase() === 'video'),
    audio: streams.filter((stream) => (stream.Type || '').toLowerCase() === 'audio'),
    subtitle: streams.filter((stream) => (stream.Type || '').toLowerCase() === 'subtitle')
  }

  const cards: MediaServerMediaInfoCard[] = []
  groups.video.forEach((video, index) => {
    cards.push({
      id: `video:${source?.Id || 'primary'}:${video.Index ?? index}`,
      kind: 'video',
      title: video.DisplayTitle || video.Title || `视频 ${index + 1}`,
      streamIndex: video.Index,
      selected: index === 0,
      rows: [
        ['序号', video.Index != null ? String(video.Index) : undefined],
        ['语言', video.Language],
        ['Codec', video.Codec],
        ['分辨率', video.Width && video.Height ? `${video.Width}x${video.Height}` : undefined],
        ['帧率', video.RealFrameRate || video.AverageFrameRate ? `${(video.RealFrameRate || video.AverageFrameRate || 0).toFixed(3)}` : undefined],
        ['比特率', formatBitrate(video.BitRate || source?.Bitrate)],
        ['Video range', video.VideoRange],
        ['配置', video.Profile],
        ['Level', typeof video.Level === 'number' ? String(video.Level) : undefined],
        ['Bit depth', typeof video.BitDepth === 'number' ? String(video.BitDepth) : undefined],
        ['Pixel format', video.PixelFormat],
        ['Aspect ratio', video.AspectRatio],
        ['Interlaced', typeof video.IsInterlaced === 'boolean' ? (video.IsInterlaced ? '是' : '否') : undefined],
        ['Color primaries', video.ColorPrimaries],
        ['Color space', video.ColorSpace],
        ['Color transfer', video.ColorTransfer]
      ].filter((row): row is [string, string] => !!row[1]).map(([label, value]) => ({ label, value }))
    })
  })

  groups.audio.forEach((audio, index) => {
    cards.push({
      id: `audio:${source?.Id || 'primary'}:${audio.Index ?? index}`,
      kind: 'audio',
      title: audio.DisplayTitle || audio.Title || `音频 ${index + 1}`,
      streamIndex: audio.Index,
      selected: !!audio.IsDefault,
      rows: [
        ['序号', audio.Index != null ? String(audio.Index) : undefined],
        ['语言', audio.Language],
        ['布局', audio.ChannelLayout],
        ['Channels', typeof audio.Channels === 'number' ? `${audio.Channels}` : undefined],
        ['Codec', audio.Codec],
        ['比特率', formatBitrate(audio.BitRate)],
        ['Audio sample', audio.SampleRate ? `${audio.SampleRate}Hz` : undefined],
        ['默认', typeof audio.IsDefault === 'boolean' ? (audio.IsDefault ? '是' : '否') : undefined],
        ['外部', typeof audio.IsExternal === 'boolean' ? (audio.IsExternal ? '是' : '否') : undefined]
      ].filter((row): row is [string, string] => !!row[1]).map(([label, value]) => ({ label, value }))
    })
  })

  groups.subtitle.forEach((subtitle, index) => {
    cards.push({
      id: `subtitle:${source?.Id || 'primary'}:${subtitle.Index ?? index}`,
      kind: 'subtitle',
      title: subtitle.DisplayTitle || subtitle.Title || `字幕 ${index + 1}`,
      streamIndex: subtitle.Index,
      selected: !!subtitle.IsDefault,
      rows: [
        ['序号', subtitle.Index != null ? String(subtitle.Index) : undefined],
        ['语言', subtitle.Language],
        ['Codec', subtitle.Codec],
        ['强制', typeof subtitle.IsForced === 'boolean' ? (subtitle.IsForced ? '是' : '否') : undefined],
        ['外部', typeof subtitle.IsExternal === 'boolean' ? (subtitle.IsExternal ? '是' : '否') : undefined],
        ['默认', typeof subtitle.IsDefault === 'boolean' ? (subtitle.IsDefault ? '是' : '否') : undefined]
      ].filter((row): row is [string, string] => !!row[1]).map(([label, value]) => ({ label, value }))
    })
  })

  return cards
}

const createSourceOptions = (item: MediaServerBaseItem): MediaServerSourceOption[] => {
  return (item.MediaSources || []).map((source, index) => ({
    id: source.Id || `${item.Id || 'item'}:${index}`,
    title: source.Name || source.Path?.split('/').filter(Boolean).pop() || `版本 ${index + 1}`,
    fileLabel: source.Path?.split('/').filter(Boolean).pop() || source.Name,
    filePath: source.Path,
    fileSubLabel: formatSize(source.Size),
    mediaInfoCards: createMediaInfoCardsForSource(source)
  }))
}

const createChapters = (item: MediaServerBaseItem) => {
  const durationSeconds = item.RunTimeTicks ? item.RunTimeTicks / 10_000_000 : 0
  const chapters = (item.Chapters || [])
    .map((chapter) => ({
      start: typeof chapter.StartPositionTicks === 'number' ? chapter.StartPositionTicks / 10_000_000 : 0,
      title: chapter.Name || ''
    }))
    .filter((chapter) => chapter.start >= 0)
    .sort((a, b) => a.start - b.start)

  return chapters
    .map((chapter, index) => ({
      start: chapter.start,
      end: chapters[index + 1]?.start ?? (durationSeconds > chapter.start ? durationSeconds : Infinity),
      title: chapter.title || `章节 ${index + 1}`
    }))
    .filter((chapter) => chapter.end > chapter.start)
}

const mapItemDetail = (config: MediaServerConfig, item: MediaServerBaseItem): MediaServerItemDetail => ({
  ...mapLibraryNode(config, item),
  genres: item.Genres || [],
  studios: (item.Studios || []).map((studio) => studio.Name || '').filter(Boolean),
  people: (item.People || []).map((person) => mapPerson(config, person)),
  isPlayed: item.UserData?.IsPlayed ?? item.UserData?.Played,
  isFavorite: item.UserData?.IsFavorite,
  tagline: item.Taglines?.[0],
  officialRating: item.OfficialRating,
  premiereDate: formatDateLabel(item.PremiereDate),
  endDate: formatDateLabel(item.EndDate),
  birthday: formatDateLabel(item.BirthDate),
  deathDate: formatDateLabel(item.DeathDate),
  birthPlace: item.BirthPlace,
  seasonCount: item.ChildCount,
  productionLocations: item.ProductionLocations || [],
  externalLinks: createExternalLinks(item),
  mediaInfoCards: createMediaInfoCardsForSource(item.MediaSources?.[0]),
  sourceOptions: createSourceOptions(item),
  fileLabel: item.MediaSources?.[0]?.Path?.split('/').filter(Boolean).pop() || item.MediaSources?.[0]?.Name,
  filePath: item.MediaSources?.[0]?.Path,
  fileSubLabel: [formatDateLabel(item.PremiereDate), formatSize(item.MediaSources?.[0]?.Size)].filter(Boolean).join('  '),
  playbackPositionTicks: item.UserData?.PlaybackPositionTicks,
  chapters: createChapters(item)
})

const ensureServerContext = (config: MediaServerConfig) => {
  if (!config.baseUrl) throw new Error('媒体服务器地址缺失')
  if (!config.userId) throw new Error('媒体服务器用户信息缺失，请重新登录')
}

const homeLibraryIncludeTypes = (collectionType?: string) => {
  const normalized = (collectionType || '').toLowerCase()
  if (normalized === 'movies') return 'Movie'
  if (normalized === 'tvshows') return 'Series'
  if (normalized === 'musicvideos') return 'MusicVideo,Video'
  if (normalized === 'homevideos') return 'Movie,Series,Video'
  return 'Movie,Series,Video'
}

export const getMediaServerHome = async (config: MediaServerConfig): Promise<MediaServerHomeData> => {
  if (config.type === 'plex') return getPlexMediaServerHomeWithPreferences(config)
  ensureServerContext(config)

  const [resumePayload, latestPayload, nextUpPayload, libraryPayload, countsPayload, userPayload] = await Promise.all([
    mediaServerFetch<BaseQueryResult>(config, `/Users/${config.userId}/Items/Resume?EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&IncludeItemTypes=Movie,Episode&Limit=20`),
    mediaServerFetch<BaseQueryResult>(config, `/Users/${config.userId}/Items?EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=50&SortBy=DateCreated&SortOrder=Descending&StartIndex=0`),
    mediaServerFetch<BaseQueryResult>(config, `/Shows/NextUp?EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&Limit=50&StartIndex=0&UserId=${encodeURIComponent(config.userId || '')}`),
    mediaServerFetch<BaseQueryResult>(config, `/Users/${config.userId}/Views`),
    mediaServerFetch<ItemCountsResult>(config, `/Items/Counts`),
    mediaServerFetch<UserDetailResult>(config, `/Users/${config.userId}`)
  ])

  const excludedLibraryIds = new Set(userPayload.Configuration?.LatestItemsExcludes || [])
  const libraries = (libraryPayload.Items || [])
    .filter((item) => ['homevideos', 'movies', 'musicvideos', 'tvshows'].includes((item.CollectionType || '').toLowerCase()))
    .filter((item) => !excludedLibraryIds.has(item.Id || ''))
    .map((item) => mapLibraryNode(config, item))
  const librarySections = (
    await Promise.all(
      libraries.map(async (library): Promise<MediaServerHomeLibrarySection | undefined> => {
        if (!library.id) return undefined
        try {
          const payload = await mediaServerFetch<BaseQueryResult>(
            config,
            `/Users/${config.userId}/Items?ParentId=${encodeURIComponent(library.id)}&Recursive=true&IncludeItemTypes=${encodeURIComponent(homeLibraryIncludeTypes(library.collectionType))}&EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&SortBy=DateCreated&SortOrder=Descending&Limit=50&StartIndex=0`
          )
          const items = (payload.Items || []).map((entry) => mapLibraryNode(config, entry))
          if (items.length === 0) return undefined
          return {
            id: library.id,
            title: library.title,
            collectionType: library.collectionType,
            items
            ,
            total: payload.TotalRecordCount || items.length
          }
        } catch {
          return undefined
        }
      })
    )
  ).filter(Boolean) as MediaServerHomeLibrarySection[]

  return {
    resume: (resumePayload.Items || []).map((item) => mapItem(config, item)),
    latest: (latestPayload.Items || []).map((item) => mapItem(config, item)),
    latestTotal: latestPayload.TotalRecordCount || (latestPayload.Items || []).length,
    nextUp: (nextUpPayload.Items || []).map((item) => mapItem(config, item)),
    nextUpTotal: nextUpPayload.TotalRecordCount || (nextUpPayload.Items || []).length,
    libraries: librarySections,
    statistics: {
      libraryCount: libraries.length,
      movieCount: countsPayload.MovieCount || 0,
      seriesCount: countsPayload.SeriesCount || 0,
      episodeCount: countsPayload.EpisodeCount || 0
    }
  }
}

export const getMediaServerHomeWithPreferences = async (
  config: MediaServerConfig,
  preferences: MediaServerHomePreferencesState
): Promise<MediaServerHomeData> => {
  if (config.type === 'plex') return getPlexMediaServerHomeWithPreferences(config)
  ensureServerContext(config)

  const nextUpDateCutoff = preferences.maxNextUpDays > 0
    ? new Date(Date.now() - preferences.maxNextUpDays * 86400 * 1000).toISOString()
    : ''

  const [resumePayload, latestPayload, nextUpPayload, libraryPayload, countsPayload, userPayload] = await Promise.all([
    mediaServerFetch<BaseQueryResult>(config, `/Users/${config.userId}/Items/Resume?EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&IncludeItemTypes=Movie,Episode&Limit=20`),
    mediaServerFetch<BaseQueryResult>(config, `/Users/${config.userId}/Items?EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=50&SortBy=DateCreated&SortOrder=Descending&StartIndex=0`),
    mediaServerFetch<BaseQueryResult>(
      config,
      `/Shows/NextUp?EnableUserData=true&EnableRewatching=${preferences.resumeNextUp ? 'true' : 'false'}&Fields=${HOME_ITEM_FIELDS}&Limit=50&StartIndex=0${nextUpDateCutoff ? `&NextUpDateCutoff=${encodeURIComponent(nextUpDateCutoff)}` : ''}&UserId=${encodeURIComponent(config.userId || '')}`
    ),
    mediaServerFetch<BaseQueryResult>(config, `/Users/${config.userId}/Views`),
    mediaServerFetch<ItemCountsResult>(config, `/Items/Counts`),
    mediaServerFetch<UserDetailResult>(config, `/Users/${config.userId}`)
  ])

  const excludedLibraryIds = new Set(userPayload.Configuration?.LatestItemsExcludes || [])
  const libraries = (libraryPayload.Items || [])
    .filter((item) => ['homevideos', 'movies', 'musicvideos', 'tvshows'].includes((item.CollectionType || '').toLowerCase()))
    .filter((item) => !excludedLibraryIds.has(item.Id || ''))
    .map((item) => mapLibraryNode(config, item))

  const librarySections = (
    await Promise.all(
      libraries.map(async (library): Promise<MediaServerHomeLibrarySection | undefined> => {
        if (!library.id) return undefined
        try {
          const payload = await mediaServerFetch<BaseQueryResult>(
            config,
            `/Users/${config.userId}/Items?ParentId=${encodeURIComponent(library.id)}&Recursive=true&IncludeItemTypes=${encodeURIComponent(homeLibraryIncludeTypes(library.collectionType))}&EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&SortBy=DateCreated&SortOrder=Descending&Limit=50&StartIndex=0`
          )
          const items = (payload.Items || []).map((entry) => mapLibraryNode(config, entry))
          if (items.length === 0) return undefined
          return {
            id: library.id,
            title: library.title,
            collectionType: library.collectionType,
            items,
            total: payload.TotalRecordCount || items.length
          }
        } catch {
          return undefined
        }
      })
    )
  ).filter(Boolean) as MediaServerHomeLibrarySection[]

  return {
    resume: (resumePayload.Items || []).map((item) => mapItem(config, item)),
    latest: (latestPayload.Items || []).map((item) => mapItem(config, item)),
    latestTotal: latestPayload.TotalRecordCount || (latestPayload.Items || []).length,
    nextUp: (nextUpPayload.Items || []).map((item) => mapItem(config, item)),
    nextUpTotal: nextUpPayload.TotalRecordCount || (nextUpPayload.Items || []).length,
    libraries: librarySections,
    statistics: {
      libraryCount: libraries.length,
      movieCount: countsPayload.MovieCount || 0,
      seriesCount: countsPayload.SeriesCount || 0,
      episodeCount: countsPayload.EpisodeCount || 0
    }
  }
}

export const getMediaServerHomeShell = async (config: MediaServerConfig): Promise<Pick<MediaServerHomeData, 'libraries' | 'statistics'>> => {
  if (config.type === 'plex') return getPlexMediaServerHomeShell(config)
  ensureServerContext(config)

  // Directory discovery must not depend on optional statistics permissions or latency.
  const libraryPayload = await mediaServerFetch<BaseQueryResult>(config, `/Users/${config.userId}/Views`)

  const libraries = (libraryPayload.Items || [])
    .filter((item) => ['homevideos', 'movies', 'musicvideos', 'tvshows'].includes((item.CollectionType || '').toLowerCase()))
    .map((item) => mapLibraryNode(config, item))
    .map((item) => ({ id: item.id, title: item.title, collectionType: item.collectionType, items: [], total: item.childCount }))

  return {
    libraries,
    statistics: {
      libraryCount: libraries.length,
      movieCount: 0,
      seriesCount: 0,
      episodeCount: 0
    }
  }
}

export const getMediaServerHomeStatistics = async (config: MediaServerConfig, libraryCount = 0): Promise<MediaServerHomeData['statistics']> => {
  if (config.type === 'plex') return (await getPlexMediaServerHomeShell(config)).statistics
  ensureServerContext(config)
  const counts = await mediaServerFetch<ItemCountsResult>(config, '/Items/Counts')
  return { libraryCount, movieCount: counts.MovieCount || 0, seriesCount: counts.SeriesCount || 0, episodeCount: counts.EpisodeCount || 0 }
}

export const getMediaServerExcludedLibraries = async (config: MediaServerConfig): Promise<string[]> => {
  if (config.type === 'plex') return getPlexMediaServerExcludedLibraries()
  ensureServerContext(config)
  const userPayload = await mediaServerFetch<UserDetailResult>(config, `/Users/${config.userId}`)
  return userPayload.Configuration?.LatestItemsExcludes || []
}

export const getMediaServerHomeResume = async (config: MediaServerConfig): Promise<MediaServerCardItem[]> => {
  if (config.type === 'plex') return getPlexMediaServerHomeResume(config)
  ensureServerContext(config)
  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Users/${config.userId}/Items/Resume?EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&IncludeItemTypes=Movie,Episode&Limit=20`
  )
  return (payload.Items || []).map((item) => mapItem(config, item))
}

export const getMediaServerHomeLatest = async (config: MediaServerConfig): Promise<{ items: MediaServerCardItem[]; total: number }> => {
  if (config.type === 'plex') return getPlexMediaServerHomeLatest(config)
  ensureServerContext(config)
  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Users/${config.userId}/Items?EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=24&SortBy=DateCreated&SortOrder=Descending&StartIndex=0`
  )
  return {
    items: (payload.Items || []).map((item) => mapItem(config, item)),
    total: payload.TotalRecordCount || (payload.Items || []).length
  }
}

export const getMediaServerHomeNextUp = async (
  config: MediaServerConfig,
  preferences: Pick<MediaServerHomePreferencesState, 'resumeNextUp' | 'maxNextUpDays'>
): Promise<{ items: MediaServerCardItem[]; total: number }> => {
  if (config.type === 'plex') return getPlexMediaServerHomeNextUp(config)
  ensureServerContext(config)
  const nextUpDateCutoff = preferences.maxNextUpDays > 0
    ? new Date(Date.now() - preferences.maxNextUpDays * 86400 * 1000).toISOString()
    : ''
  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Shows/NextUp?EnableUserData=true&EnableRewatching=${preferences.resumeNextUp ? 'true' : 'false'}&Fields=${HOME_ITEM_FIELDS}&Limit=24&StartIndex=0${nextUpDateCutoff ? `&NextUpDateCutoff=${encodeURIComponent(nextUpDateCutoff)}` : ''}&UserId=${encodeURIComponent(config.userId || '')}`
  )
  return {
    items: (payload.Items || []).map((item) => mapItem(config, item)),
    total: payload.TotalRecordCount || (payload.Items || []).length
  }
}

export const getMediaServerHomeLibraryLatest = async (
  config: MediaServerConfig,
  libraryId: string,
  collectionType?: string
): Promise<{ items: MediaServerLibraryNode[]; total: number }> => {
  if (config.type === 'plex') return getPlexMediaServerHomeLibraryLatest(config, libraryId)
  ensureServerContext(config)
  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Users/${config.userId}/Items?ParentId=${encodeURIComponent(libraryId)}&Recursive=true&IncludeItemTypes=${encodeURIComponent(homeLibraryIncludeTypes(collectionType))}&EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&SortBy=DateCreated&SortOrder=Descending&Limit=24&StartIndex=0`
  )
  const items = (payload.Items || []).map((item) => mapLibraryNode(config, item))
  return {
    items,
    total: payload.TotalRecordCount || items.length
  }
}

export const getMediaServerLibraries = async (config: MediaServerConfig): Promise<MediaServerLibraryNode[]> => {
  if (config.type === 'plex') return getPlexMediaServerLibraries(config)
  ensureServerContext(config)
  const payload = await mediaServerFetch<BaseQueryResult>(config, `/Users/${config.userId}/Views`)
  // Views can omit image tags even when the collection has its own cover.
  // Resolve the collection itself before considering any child poster.
  return Promise.all((payload.Items || []).map(async (item) => {
    if (item.Id && !item.ImageTags?.Primary && !item.PrimaryImageTag) {
      try {
        const detail = await mediaServerFetch<MediaServerBaseItem>(config, `/Users/${config.userId}/Items/${encodeURIComponent(item.Id)}`)
        return mapLibraryNode(config, { ...item, ...detail })
      } catch {
        // Keep the list entry if detail lookup is unavailable.
      }
    }
    return mapLibraryNode(config, item)
  }))
}

export const getMediaServerMusicTracks = async (config: MediaServerConfig): Promise<MediaServerMusicTrack[]> => {
  if (config.type === 'plex') return getPlexMediaServerMusicTracks(config)
  ensureServerContext(config)
  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Users/${config.userId}/Items?Recursive=true&IncludeItemTypes=Audio&EnableUserData=true&Fields=Album,AlbumArtist,Artists,ArtistItems,PrimaryImageAspectRatio,MediaSources,RunTimeTicks&SortBy=SortName&SortOrder=Ascending&Limit=5000&StartIndex=0`
  )
  return (payload.Items || []).flatMap((item) => {
    const id = item.Id || ''
    if (!id) return []
    const source = item.MediaSources?.[0]
    return [{
      id,
      serverId: config.id,
      provider: config.type,
      serverName: config.name,
      title: item.Name || '未命名曲目',
      artist: item.Artists?.[0] || item.ArtistItems?.[0]?.Name || item.AlbumArtist,
      album: item.Album,
      thumbnail: buildImageUrlFromTag(config, id, 'Primary', item.ImageTags?.Primary, true),
      durationMs: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000) : undefined,
      sourceId: source?.Id
    }]
  })
}

export const getMediaServerLibraryItems = async (
  config: MediaServerConfig,
  parentId: string
): Promise<MediaServerLibraryNode[]> => {
  if (config.type === 'plex') return (await getPlexMediaServerLibraryPagedItems(config, parentId, 0, { recursiveMedia: true })).items
  ensureServerContext(config)
  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Users/${config.userId}/Items?ParentId=${encodeURIComponent(parentId)}&Recursive=true&Fields=${HOME_ITEM_FIELDS}&SortBy=SortName&SortOrder=Ascending`
  )
  return (payload.Items || []).map((item) => mapLibraryNode(config, item))
}

export const getMediaServerItemDetail = async (
  config: MediaServerConfig,
  itemId: string
): Promise<MediaServerItemDetail> => {
  if (config.type === 'plex') return getPlexMediaServerItemDetail(config, itemId)
  ensureServerContext(config)
  const payload = await mediaServerFetch<MediaServerBaseItem>(
    config,
    `/Users/${config.userId}/Items/${itemId}?EnableUserData=true&Fields=Overview,Taglines,Genres,Studios,People,ProviderIds,ExternalUrls,PrimaryImageAspectRatio,MediaSources,MediaStreams,ProductionLocations,DateCreated,Chapters,CommunityRating,CriticRating`
  )
  return mapItemDetail(config, payload)
}

const buildAbsoluteMediaServerUrl = (config: MediaServerConfig, value: string) => {
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  const baseUrl = config.baseUrl.replace(/\/+$/, '')
  if (!value.startsWith('/')) return new URL(value, `${baseUrl}/`).toString()

  const base = new URL(`${baseUrl}/`)
  const basePath = base.pathname.replace(/\/+$/, '')
  if (!basePath || basePath === '/') return new URL(value, base.origin).toString()
  if (value === basePath || value.startsWith(`${basePath}/`)) return new URL(value, base.origin).toString()
  return `${base.origin}${basePath}${value}`
}

const pickFileNameFromSource = (item: MediaServerBaseItem, source?: MediaServerMediaSource) => {
  const rawName = source?.Path?.split(/[\\/]/).filter(Boolean).pop()
    || source?.Name
    || item.Name
    || item.Id
    || 'media'
  return rawName.replace(/[<>:"/\\|?*\f\n\r\t\v]+/g, '').replace(/[ .]+$/g, '').replace(/^\.+/g, '') || 'media'
}

export const withMediaServerPlaybackAuth = (config: MediaServerConfig, url: string) => {
  const token = (config.accessToken || '').trim()
  if (!url || !token) return url
  try {
    const parsed = new URL(url)
    if (config.type === 'plex') {
      if (!parsed.searchParams.has('X-Plex-Token')) parsed.searchParams.set('X-Plex-Token', token)
    } else {
      if (!parsed.searchParams.has('api_key')) parsed.searchParams.set('api_key', token)
      if (!parsed.searchParams.has('X-Emby-Token')) parsed.searchParams.set('X-Emby-Token', token)
    }
    return parsed.toString()
  } catch {
    return url
  }
}

const createJellyfinAuthorization = (config: MediaServerConfig) => {
  const fields = [
    `Token="${config.accessToken || ''}"`,
    `UserId="${config.userId || ''}"`,
    'Client="XbyBoxPlayer"',
    'Device="XbyBoxPlayer"',
    `DeviceId="${config.deviceId || ''}"`,
    'Version="1.0.0"'
  ]
  return `MediaBrowser ${fields.join(', ')}`
}

interface MediaServerPlaybackResponse {
  MediaSources?: MediaServerMediaSource[]
  PlaySessionId?: string
}

const testMediaServerBitrate = async (
  config: MediaServerConfig,
  testSize: MediaServerBitrateTestSize
): Promise<number> => {
  const size = Number(testSize)
  const testStartTime = Date.now()
  const url = `${config.baseUrl.replace(/\/+$/, '')}/Playback/BitrateTest?${new URLSearchParams({ size: String(size) }).toString()}`
  const response = await fetch(url, {
    headers: mediaServerHeaders(config)
  })
  if (!response.ok) {
    throw new Error(`${config.type === 'emby' ? 'Emby' : config.type === 'jellyfin' ? 'Jellyfin' : 'Plex'} 请求失败 (${response.status})`)
  }
  await response.arrayBuffer()
  const testDurationSeconds = Math.max((Date.now() - testStartTime) / 1000, 0.001)
  const testBitrate = Math.floor((size * 8) / testDurationSeconds)
  return Math.min(testBitrate, MEDIA_SERVER_MAX_PLAYBACK_BITRATE)
}

export const getMediaServerPlaybackInfo = async (
  config: MediaServerConfig,
  itemId: string,
  sourceId?: string,
  videoStreamIndex?: number,
  audioStreamIndex?: number,
  subtitleStreamIndex?: number,
  playbackQuality: MediaServerPlaybackQuality = 'max',
  compatibilityMode: MediaServerPlaybackCompatibility = 'auto',
  customDeviceProfile?: MediaServerCustomDeviceProfile,
  bitrateTestSize: MediaServerBitrateTestSize = '5000000',
  preferTranscoding = false
): Promise<MediaServerPlaybackInfo> => {
  if (config.type === 'plex') return getPlexMediaServerPlaybackInfo(config, itemId, sourceId, videoStreamIndex)
  ensureServerContext(config)

  const detailPayload = await mediaServerFetch<MediaServerBaseItem>(
    config,
    `/Users/${config.userId}/Items/${encodeURIComponent(itemId)}?EnableUserData=true&Fields=MediaSources,MediaStreams`
  )

  const fallbackPlayCursorSeconds = detailPayload.UserData?.PlaybackPositionTicks
    ? Math.max(0, Math.floor(detailPayload.UserData.PlaybackPositionTicks / 10_000_000))
    : 0
  const requestedSource = (detailPayload.MediaSources || []).find((entry) => sourceId && entry.Id === sourceId) || detailPayload.MediaSources?.[0]
  const forceBrowserCompatiblePlayback = preferTranscoding
    || (compatibilityMode !== 'directPlay' && requiresBrowserAudioTranscoding(requestedSource, audioStreamIndex))

  const maxStreamingBitrate = playbackQuality === 'auto'
    ? await testMediaServerBitrate(config, bitrateTestSize)
    : getMediaServerMaxStreamingBitrate(playbackQuality)

  const requestPlaybackInfo = (forceTranscoding: boolean, forceDirectPlay = false) => {
    const query = new URLSearchParams({
      UserId: config.userId || '',
      StartTimeTicks: '0',
      AutoOpenLiveStream: 'false'
    })
    if (maxStreamingBitrate) query.set('MaxStreamingBitrate', String(maxStreamingBitrate))
    if (sourceId) query.set('MediaSourceId', sourceId)
    if (typeof videoStreamIndex === 'number' && videoStreamIndex >= 0) query.set('VideoStreamIndex', String(videoStreamIndex))
    if (typeof audioStreamIndex === 'number' && audioStreamIndex >= 0) query.set('AudioStreamIndex', String(audioStreamIndex))
    if (typeof subtitleStreamIndex === 'number' && subtitleStreamIndex >= 0) query.set('SubtitleStreamIndex', String(subtitleStreamIndex))
    if (forceTranscoding) {
      query.set('EnableDirectPlay', 'false')
      query.set('EnableDirectStream', 'false')
      query.set('EnableTranscoding', 'true')
    } else if (forceDirectPlay) {
      query.set('EnableDirectPlay', 'true')
      query.set('EnableDirectStream', 'true')
      query.set('EnableTranscoding', 'false')
    }
    return mediaServerFetch<MediaServerPlaybackResponse>(
      config,
      `/Items/${encodeURIComponent(itemId)}/PlaybackInfo?${query.toString()}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          DeviceProfile: buildMediaServerDeviceProfile(maxStreamingBitrate, forceDirectPlay ? 'directPlay' : compatibilityMode, customDeviceProfile),
          VideoStreamIndex: typeof videoStreamIndex === 'number' && videoStreamIndex >= 0 ? videoStreamIndex : undefined,
          AudioStreamIndex: typeof audioStreamIndex === 'number' && audioStreamIndex >= 0 ? audioStreamIndex : undefined,
          SubtitleStreamIndex: typeof subtitleStreamIndex === 'number' && subtitleStreamIndex >= 0 ? subtitleStreamIndex : undefined,
          EnableDirectPlay: forceTranscoding ? false : forceDirectPlay ? true : undefined,
          EnableDirectStream: forceTranscoding ? false : forceDirectPlay ? true : undefined,
          EnableTranscoding: forceTranscoding ? true : forceDirectPlay ? false : undefined
        })
      }
    )
  }
  const resolvePlaybackSource = (payload: MediaServerPlaybackResponse) => {
    const matchingSources = requestedSource
      ? (payload.MediaSources || []).filter((entry) => entry.Id === requestedSource.Id)
      : []
    return requestedSource
      ? matchingSources.find((entry) => entry.ETag && entry.ETag === requestedSource.ETag)
        || (matchingSources.length === 1 ? matchingSources[0] : undefined)
        || (matchingSources.length === 0 && (payload.MediaSources || []).length === 1 ? payload.MediaSources?.[0] : undefined)
      : undefined
  }

  let useBrowserCompatiblePlayback = forceBrowserCompatiblePlayback
  let playbackPayload = await requestPlaybackInfo(useBrowserCompatiblePlayback)
  let source = resolvePlaybackSource(playbackPayload)

  // Some servers omit both direct and transcoding URLs when direct play is disabled.
  // Retry without the compatibility restriction so the original source remains playable.
  if (useBrowserCompatiblePlayback && source && !source.TranscodingUrl) {
    useBrowserCompatiblePlayback = false
    playbackPayload = await requestPlaybackInfo(false, true)
    source = resolvePlaybackSource(playbackPayload)
  }

  if (!source) {
    throw new Error('Matching media source not in playback info')
  }

  const directUrl = source.DirectStreamUrl || source.XOriginDirectStreamUrl
  const transcodingUrl = source.TranscodingUrl
  const isHttpProtocol = (source.Protocol || '').toLowerCase() === 'http'
  let playUrl = ''
  let tracksSelectable = false
  if (transcodingUrl && useBrowserCompatiblePlayback) {
    playUrl = buildAbsoluteMediaServerUrl(config, transcodingUrl)
    tracksSelectable = true
  } else if (isHttpProtocol && directUrl) {
    playUrl = buildAbsoluteMediaServerUrl(config, directUrl)
  } else if (isHttpProtocol && source.Path) {
    playUrl = source.Path
  } else if (config.type === 'emby' && directUrl) {
    playUrl = buildAbsoluteMediaServerUrl(config, directUrl)
  } else if (transcodingUrl && compatibilityMode !== 'directPlay') {
    playUrl = buildAbsoluteMediaServerUrl(config, transcodingUrl)
    tracksSelectable = true
  } else {
    const streamQuery = new URLSearchParams({
      static: 'true',
      playSessionId: playbackPayload.PlaySessionId || source.Id || '',
      mediaSourceId: source.Id || sourceId || ''
    })
    if (detailPayload.ETag) streamQuery.set('tag', detailPayload.ETag)
    playUrl = `${config.baseUrl.replace(/\/+$/, '')}/Videos/${encodeURIComponent(itemId)}/stream?${streamQuery.toString()}`
  }

  const headers: Record<string, string> = config.type === 'emby'
    ? {
        'X-Emby-Authorization': createJellyfinAuthorization(config),
        'X-Emby-Token': config.accessToken || '',
        // Some Emby servers behind Cloudflare reject libmpv's default User-Agent.
        'User-Agent': 'SenPlayer'
      }
    : {
        Authorization: createJellyfinAuthorization(config)
      }

  const subtitleSources = (source.MediaStreams || [])
    .filter((stream) => (stream.Type || '').toLowerCase() === 'subtitle' && typeof stream.Index === 'number' && (stream.IsExternal || !!stream.DeliveryUrl))
    .map((stream) => {
      const codec = String(stream.Codec || 'srt').toLowerCase()
      const subtitlePath = stream.DeliveryUrl
        || `/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(source.Id || sourceId || '')}/Subtitles/${stream.Index}/Stream.${codec}`
      return {
        url: withMediaServerPlaybackAuth(config, buildAbsoluteMediaServerUrl(config, subtitlePath)),
        title: stream.DisplayTitle || stream.Title || stream.Language || `字幕 ${stream.Index}`,
        streamIndex: stream.Index
      }
    })

  return {
    url: withMediaServerPlaybackAuth(config, playUrl),
    headers: {
      ...headers,
      ...(source.RequiredHttpHeaders || {})
    },
    subtitleSources,
    tracksSelectable,
    playSessionId: playbackPayload.PlaySessionId || source.Id,
    playCursorSeconds: fallbackPlayCursorSeconds,
    videoStreamIndex: typeof videoStreamIndex === 'number' && videoStreamIndex >= 0
      ? videoStreamIndex
      : source.MediaStreams?.find((stream) => (stream.Type || '').toLowerCase() === 'video')?.Index
  }
}

export const getMediaServerDownloadInfo = async (
  config: MediaServerConfig,
  itemId: string,
  sourceId?: string
): Promise<MediaServerDownloadInfo> => {
  if (config.type === 'plex') return getPlexMediaServerDownloadInfo(config, itemId, sourceId)
  ensureServerContext(config)

  const detailPayload = await mediaServerFetch<MediaServerBaseItem>(
    config,
    `/Users/${config.userId}/Items/${encodeURIComponent(itemId)}?EnableUserData=true&Fields=MediaSources,MediaStreams`
  )
  const source = (detailPayload.MediaSources || []).find((entry) => sourceId && entry.Id === sourceId) || detailPayload.MediaSources?.[0]
  if (!source) throw new Error('媒体服务器未返回可下载媒体源')

  let downloadUrl = ''
  const directUrl = source.DirectStreamUrl || source.XOriginDirectStreamUrl
  const isHttpProtocol = (source.Protocol || '').toLowerCase() === 'http'
  if (isHttpProtocol && directUrl) {
    downloadUrl = buildAbsoluteMediaServerUrl(config, directUrl)
  } else if (isHttpProtocol && source.Path) {
    downloadUrl = source.Path
  } else if (config.type === 'emby' && directUrl) {
    downloadUrl = buildAbsoluteMediaServerUrl(config, directUrl)
  } else {
    const streamQuery = new URLSearchParams({
      static: 'true',
      mediaSourceId: source.Id || sourceId || ''
    })
    if (detailPayload.ETag) streamQuery.set('tag', detailPayload.ETag)
    downloadUrl = `${config.baseUrl.replace(/\/+$/, '')}/Videos/${encodeURIComponent(itemId)}/stream?${streamQuery.toString()}`
  }

  if (!downloadUrl) throw new Error('媒体服务器未返回可下载地址')

  return {
    url: withMediaServerPlaybackAuth(config, downloadUrl),
    headers: {
      ...mediaServerHeaders(config),
      ...(source.RequiredHttpHeaders || {})
    },
    fileName: pickFileNameFromSource(detailPayload, source),
    fileSize: source.Size || 0,
    sourceId: source.Id
  }
}

const createPlaybackProgressBody = (params: {
  itemId: string
  sourceId?: string
  playSessionId?: string
  positionSeconds: number
  runtimeSeconds?: number
}) => {
  const positionTicks = Math.max(0, Math.floor(params.positionSeconds * 10_000_000))
  return {
    ItemId: params.itemId,
    MediaSourceId: params.sourceId || '',
    PlaySessionId: params.playSessionId || '',
    SessionId: params.playSessionId || '',
    PositionTicks: positionTicks,
    CanSeek: true,
    IsMuted: false,
    IsPaused: false,
    PlaybackRate: 1,
    PlayMethod: 'DirectStream',
    RepeatMode: 'RepeatNone',
    EventName: 'TimeUpdate',
    RunTimeTicks: params.runtimeSeconds ? Math.max(0, Math.floor(params.runtimeSeconds * 10_000_000)) : undefined
  }
}

const reportPlexPlaybackProgress = async (
  config: MediaServerConfig,
  itemId: string,
  state: 'playing' | 'stopped',
  positionSeconds: number
) => {
  const detailPayload = await mediaServerFetch<MediaServerBaseItem>(
    config,
    `/library/metadata/${encodeURIComponent(itemId)}`
  )
  const ratingKey = detailPayload.ratingKey || detailPayload.Id || itemId
  const metaKey = detailPayload.Key || `/library/metadata/${ratingKey}`
  const duration = detailPayload.Duration || (detailPayload.RunTimeTicks ? Math.floor(detailPayload.RunTimeTicks / 10_000) : 0)
  const query = new URLSearchParams({
    key: metaKey,
    ratingKey,
    state,
    time: String(Math.max(0, Math.floor(positionSeconds * 1000))),
    duration: String(Math.max(0, duration))
  })
  await mediaServerFetchVoid(config, `/:/progress?${query.toString()}`)
}

export const reportMediaServerPlaybackStart = async (
  config: MediaServerConfig,
  itemId: string,
  sourceId: string | undefined,
  playSessionId: string | undefined,
  positionSeconds: number,
  runtimeSeconds?: number
) => {
  ensureServerContext(config)
  if (config.type === 'plex') {
    await reportPlexMediaServerPlaybackProgress(config, itemId, 'playing', positionSeconds)
    return
  }
  await mediaServerFetchVoid(config, '/Sessions/Playing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(createPlaybackProgressBody({
      itemId,
      sourceId,
      playSessionId,
      positionSeconds,
      runtimeSeconds
    }))
  })
}

export const reportMediaServerPlaybackProgress = async (
  config: MediaServerConfig,
  itemId: string,
  sourceId: string | undefined,
  playSessionId: string | undefined,
  positionSeconds: number,
  runtimeSeconds?: number
) => {
  ensureServerContext(config)
  if (config.type === 'plex') {
    await reportPlexMediaServerPlaybackProgress(config, itemId, 'playing', positionSeconds)
    return
  }
  await mediaServerFetchVoid(config, '/Sessions/Playing/Progress', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(createPlaybackProgressBody({
      itemId,
      sourceId,
      playSessionId,
      positionSeconds,
      runtimeSeconds
    }))
  })
}

export const reportMediaServerPlaybackStop = async (
  config: MediaServerConfig,
  itemId: string,
  sourceId: string | undefined,
  playSessionId: string | undefined,
  positionSeconds: number,
  runtimeSeconds?: number
) => {
  ensureServerContext(config)
  if (config.type === 'plex') {
    await reportPlexMediaServerPlaybackProgress(config, itemId, 'stopped', positionSeconds)
    return
  }
  await mediaServerFetchVoid(config, '/Sessions/Playing/Stopped', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(createPlaybackProgressBody({
      itemId,
      sourceId,
      playSessionId,
      positionSeconds,
      runtimeSeconds
    }))
  })
}

export const updateMediaServerPlayedState = async (
  config: MediaServerConfig,
  itemId: string,
  isPlayed: boolean
) => {
  ensureServerContext(config)
  if (config.type === 'plex') {
    await updatePlexMediaServerPlayedState(config, itemId, isPlayed)
    return
  }
  await mediaServerFetchVoid(
    config,
    `/Users/${config.userId}/PlayedItems/${encodeURIComponent(itemId)}`,
    { method: isPlayed ? 'DELETE' : 'POST' }
  )
}

export const updateMediaServerFavoriteState = async (
  config: MediaServerConfig,
  itemId: string,
  isFavorite: boolean,
  item?: MediaServerCardItem
) => {
  ensureServerContext(config)
  if (config.type === 'plex') {
    await updatePlexMediaServerFavoriteState(config, itemId, isFavorite)
  } else {
    await mediaServerFetchVoid(
      config,
      `/Users/${config.userId}/FavoriteItems/${encodeURIComponent(itemId)}`,
      { method: isFavorite ? 'DELETE' : 'POST' }
    )
  }
  // Persist shortcuts only after the owning server accepted the favorite change.
  if (item) rememberServerFolderFavorite(config, item, !isFavorite)
}

export const getMediaServerSimilarItems = async (
  config: MediaServerConfig,
  itemId: string
): Promise<MediaServerLibraryNode[]> => {
  if (config.type === 'plex') return getPlexMediaServerSimilarItems(config, itemId)
  ensureServerContext(config)
  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Items/${encodeURIComponent(itemId)}/Similar?UserId=${encodeURIComponent(config.userId || '')}&Limit=24&Fields=Overview,PrimaryImageAspectRatio`
  )
  return (payload.Items || []).map((item) => mapLibraryNode(config, item))
}

export const getMediaServerCollectionPage = async (
  config: MediaServerConfig,
  kind: 'latest' | 'nextup',
  page: number,
  _excludeItemIds: string[] = [],
  preferences?: Pick<MediaServerHomePreferencesState, 'resumeNextUp' | 'maxNextUpDays'>,
  order: MediaServerPageSort = {}
): Promise<MediaServerPagedCollection> => {
  if (config.type === 'plex') return getPlexMediaServerCollectionPage(config, kind, page, order)
  ensureServerContext(config)

  const pageSize = 50

  if (kind === 'latest') {
    const payload = await mediaServerFetch<BaseQueryResult>(
      config,
      `/Users/${config.userId}/Items?EnableUserData=true&Fields=${HOME_ITEM_FIELDS}&IncludeItemTypes=Movie,Series&Recursive=true&Limit=${pageSize}&${serverPageOrder(order, 'DateCreated')}&StartIndex=${page * pageSize}`
    )
    const items = (payload.Items || []).map((item) => mapLibraryNode(config, item))
    return {
      key: `latest`,
      items,
      total: payload.TotalRecordCount || items.length,
      currentPage: page,
      hasNextPage: items.length >= pageSize
    }
  }

  const nextUpDateCutoff = preferences && preferences.maxNextUpDays > 0
    ? new Date(Date.now() - preferences.maxNextUpDays * 86400 * 1000).toISOString()
    : ''
  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Shows/NextUp?EnableUserData=true&EnableRewatching=${preferences?.resumeNextUp === false ? 'false' : 'true'}&Fields=${HOME_ITEM_FIELDS}&Limit=${pageSize}&StartIndex=${page * pageSize}${nextUpDateCutoff ? `&NextUpDateCutoff=${encodeURIComponent(nextUpDateCutoff)}` : ''}&UserId=${encodeURIComponent(config.userId || '')}`
  )
  const items = (payload.Items || []).map((item) => mapLibraryNode(config, item))
  return {
    key: `nextup`,
    items,
    total: payload.TotalRecordCount || items.length,
    currentPage: page,
    hasNextPage: items.length >= pageSize
  }
}

export const getMediaServerLibraryPagedItems = async (
  config: MediaServerConfig,
  parentId: string,
  page: number,
  options?: {
    recursiveMedia?: boolean
    collectionType?: string
    order?: MediaServerPageSort
  }
): Promise<MediaServerPagedLibraryPage> => {
  const favoriteType = serverFavoriteType(parentId)
  if (favoriteType && config.type !== 'plex') {
    ensureServerContext(config)
    const limit = 50
    const params = new URLSearchParams({
      UserId: config.userId || '', IsFavorite: 'true', Recursive: 'true',
      EnableUserData: 'true', Fields: HOME_ITEM_FIELDS,
      Limit: String(limit), StartIndex: String(page * limit)
    })
    new URLSearchParams(serverPageOrder(options?.order)).forEach((value, key) => params.set(key, value))
    if (favoriteType !== 'Person') params.set('IncludeItemTypes', favoriteType)
    const path = favoriteType === 'Person' ? '/Persons' : `/Users/${config.userId}/Items`
    const payload = await mediaServerFetch<BaseQueryResult>(config, `${path}?${params}`)
    const items = (payload.Items || []).map(item => mapLibraryNode(config, item))
    const total = payload.TotalRecordCount ?? items.length
    return { key: `${config.id}:${parentId}`, items, total, currentPage: page,
      hasNextPage: payload.TotalRecordCount == null ? items.length === limit : (page + 1) * limit < total }
  }
  if (config.type === 'plex') return getPlexMediaServerLibraryPagedItems(config, parentId, page, options)
  ensureServerContext(config)
  const pageSize = 50
  const container = parentId.startsWith('server-container:')
  const queryParentId = container ? parentId.slice('server-container:'.length) : parentId
  const recursive = !container && options?.recursiveMedia === true
  const includeItemTypes = (() => {
    const collectionType = (options?.collectionType || '').toLowerCase()
    if (!recursive) return ''
    if (collectionType === 'movies') return '&IncludeItemTypes=Movie'
    if (collectionType === 'tvshows') return '&IncludeItemTypes=Series'
    if (collectionType === 'musicvideos') return '&IncludeItemTypes=MusicVideo,Video'
    if (collectionType === 'homevideos') return '&IncludeItemTypes=Movie,Series,Video'
    return '&IncludeItemTypes=Movie,Series,Video'
  })()
  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Users/${config.userId}/Items?ParentId=${encodeURIComponent(queryParentId)}&Recursive=${recursive ? 'true' : 'false'}${includeItemTypes}&EnableUserData=true&Fields=${HOME_ITEM_FIELDS}${container ? '' : '&' + serverPageOrder(options?.order)}&Limit=${pageSize}&StartIndex=${page * pageSize}`
  )
  const items = (payload.Items || []).map((item) => mapLibraryNode(config, item))
  return {
    key: `${config.id}:${parentId}`,
    items,
    total: payload.TotalRecordCount || items.length,
    currentPage: page,
    hasNextPage: items.length >= pageSize
  }
}

export const getMediaServerPersonPagedItems = async (
  config: MediaServerConfig,
  personId: string,
  page: number
): Promise<MediaServerPagedLibraryPage> => {
  if (config.type === 'plex') return getPlexMediaServerPersonPagedItems(config, personId, page)
  ensureServerContext(config)
  const pageSize = 120
  const startIndex = page * pageSize
  const includeTypes = ['Movie', 'Series', 'Season', 'Episode']

  const payloads = await Promise.all(
    includeTypes.map((type) => mediaServerFetch<BaseQueryResult>(
      config,
      `/Users/${config.userId}/Items?Recursive=true&personIds=${encodeURIComponent(personId)}&IncludeItemTypes=${type}&Fields=${HOME_ITEM_FIELDS}&SortBy=SortName&SortOrder=Ascending&Limit=${pageSize}&StartIndex=${startIndex}`
    ))
  )

  const mergedRaw = payloads.flatMap((payload) => payload.Items || [])
  const seen = new Set<string>()
  const items = mergedRaw
    .filter((item) => {
      const id = item.Id || ''
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map((item) => mapLibraryNode(config, item))

  const total = payloads.reduce((sum, payload) => sum + (payload.TotalRecordCount || payload.Items?.length || 0), 0)
  const hasNextPage = payloads.some((payload) => (payload.Items || []).length >= pageSize)

  return {
    key: `${config.id}:${personId}`,
    items,
    total: total || items.length,
    currentPage: page,
    hasNextPage
  }
}

export const getMediaServerFilteredPagedItems = async (
  config: MediaServerConfig,
  page: number,
  options: {
    genre?: string
    studio?: string
    parentId?: string
    order?: MediaServerPageSort
  }
): Promise<MediaServerPagedLibraryPage> => {
  if (config.type === 'plex') return getPlexMediaServerFilteredPagedItems(config, page, options)
  ensureServerContext(config)
  const pageSize = 50
  const params = new URLSearchParams()
  params.set('Recursive', 'true')
  params.set('Fields', 'Overview,PrimaryImageAspectRatio')
  new URLSearchParams(serverPageOrder(options.order)).forEach((value, key) => params.set(key, value))
  params.set('Limit', String(pageSize))
  params.set('StartIndex', String(page * pageSize))
  params.set('IncludeItemTypes', 'Movie,Series,Video')
  if (options.parentId) params.set('ParentId', options.parentId)
  if (options.genre) params.set('genres', options.genre)
  if (options.studio) params.set('studios', options.studio)

  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Users/${config.userId}/Items?${params.toString()}`
  )
  const items = (payload.Items || []).map((item) => mapLibraryNode(config, item))
  const key = options.genre
    ? `${config.id}:genre:${options.genre}`
    : `${config.id}:studio:${options.studio || ''}`
  return {
    key,
    items,
    total: payload.TotalRecordCount || items.length,
    currentPage: page,
    hasNextPage: items.length >= pageSize
  }
}

export const getMediaServerSuggestions = async (
  config: MediaServerConfig
): Promise<MediaServerLibraryNode[]> => {
  if (config.type === 'plex') return getPlexMediaServerSuggestions(config)
  ensureServerContext(config)

  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Users/${config.userId}/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=${HOME_ITEM_FIELDS}&Limit=16&SortBy=Random`
  )

  const items = (payload.Items || []).map((item) => mapLibraryNode(config, item))
  return items.filter((item) => item.kind === 'series' || item.kind === 'movie')
}

export const getMediaServerSearch = async (
  config: MediaServerConfig,
  query: string
): Promise<MediaServerSearchData> => {
  if (config.type === 'plex') return getPlexMediaServerSearch(config, query)
  ensureServerContext(config)
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return { query: '', items: [] }
  }

  const payload = await mediaServerFetch<BaseQueryResult>(
    config,
    `/Users/${config.userId}/Items?SearchTerm=${encodeURIComponent(trimmedQuery)}&Recursive=true&IncludeItemTypes=Movie,Series,Season,Episode,BoxSet,Person,Folder&Fields=${HOME_ITEM_FIELDS}&Limit=60&SortBy=SortName&SortOrder=Ascending`
  )

  return {
    query: trimmedQuery,
    items: (payload.Items || []).map((item) => mapLibraryNode(config, item))
  }
}
