import type { MediaServerType } from './mediaServer'

export interface MediaServerImageSources {
  primary?: string
  thumb?: string
  backdrop?: string
  parentBackdrop?: string
  screenshot?: string
  logo?: string
  profile?: string
  seriesPrimary?: string
  seriesThumb?: string
  seriesBackdrop?: string
}

export interface MediaServerCardItem {
  id: string
  serverId: string
  provider: MediaServerType
  kind: 'movie' | 'series' | 'season' | 'episode' | 'folder' | 'person' | 'unknown'
  title: string
  genres?: string[]
  productionLocations?: string[]
  overview?: string
  poster?: string
  backdrop?: string
  rawType?: string
  seriesId?: string
  images?: MediaServerImageSources
  fileName?: string
  sortName?: string
  createdAt?: string | number
  criticRating?: number
  playCount?: number
  videoBitrate?: number
  airTime?: string
  studio?: string
  artist?: string
  officialRating?: string
  seriesTitle?: string
  seriesDatePlayed?: string | number
  addedAt?: string | number
  premiereDate?: string
  year?: number
  seasonCount?: number
  rating?: number
  tmdbId?: number
  imdbId?: string
  runtimeMinutes?: number
  progress?: number
  parentTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  isPlayed?: boolean
  isFavorite?: boolean
  isContinuing?: boolean
  coverageBadge?: string
}

export interface MediaServerLibraryNode extends MediaServerCardItem {
  childCount?: number
  collectionType?: string
}

export interface MediaServerPerson {
  id: string
  name: string
  role?: string
  image?: string
}

export interface MediaServerExternalLink {
  title: string
  url: string
}

export interface MediaServerMediaInfoRow {
  label: string
  value: string
}

export interface MediaServerMediaInfoCard {
  id: string
  kind: 'video' | 'audio' | 'subtitle'
  title: string
  streamIndex?: number
  selected?: boolean
  rows: MediaServerMediaInfoRow[]
}

export interface MediaServerSourceOption {
  id: string
  title: string
  fileLabel?: string
  filePath?: string
  fileSubLabel?: string
  mediaInfoCards: MediaServerMediaInfoCard[]
}

export interface MediaServerPlaybackInfo {
  url: string
  headers: Record<string, string>
  subtitleSources?: Array<{ url: string; title?: string; streamIndex?: number }>
  tracksSelectable?: boolean
  playSessionId?: string
  playCursorSeconds?: number
  videoStreamIndex?: number
}

export interface MediaServerDownloadInfo {
  url: string
  headers: Record<string, string>
  fileName: string
  fileSize: number
  sourceId?: string
}


export interface MediaServerChapter {
  start: number
  end: number
  title: string
}

export interface MediaServerItemDetail extends MediaServerLibraryNode {
  genres: string[]
  studios: string[]
  people: MediaServerPerson[]
  isPlayed?: boolean
  isFavorite?: boolean
  tagline?: string
  officialRating?: string
  premiereDate?: string
  endDate?: string
  birthday?: string
  deathDate?: string
  birthPlace?: string
  seasonCount?: number
  productionLocations: string[]
  externalLinks: MediaServerExternalLink[]
  mediaInfoCards: MediaServerMediaInfoCard[]
  sourceOptions: MediaServerSourceOption[]
  fileLabel?: string
  filePath?: string
  fileSubLabel?: string
  playbackPositionTicks?: number
  chapters?: MediaServerChapter[]
}

export interface MediaServerHomeLibrarySection {
  id: string
  title: string
  collectionType?: string
  items: MediaServerLibraryNode[]
  total?: number
  attempted?: boolean
}

export interface MediaServerHomeStatistics {
  libraryCount: number
  movieCount: number
  seriesCount: number
  episodeCount: number
}

export interface MediaServerHomeData {
  resume: MediaServerCardItem[]
  latest: MediaServerCardItem[]
  latestTotal: number
  nextUp: MediaServerCardItem[]
  nextUpTotal: number
  libraries: MediaServerHomeLibrarySection[]
  statistics: MediaServerHomeStatistics
}

export interface MediaServerSearchData {
  query: string
  items: MediaServerLibraryNode[]
}

export interface MediaServerPagedCollection {
  key: string
  items: MediaServerLibraryNode[]
  total: number
  currentPage: number
  hasNextPage: boolean
}

export interface MediaServerPagedLibraryPage {
  key: string
  items: MediaServerLibraryNode[]
  total: number
  currentPage: number
  hasNextPage: boolean
}

export interface MediaServerMusicTrack {
  id: string
  serverId: string
  provider: MediaServerType
  serverName: string
  title: string
  artist?: string
  album?: string
  thumbnail?: string
  durationMs?: number
  sourceId?: string
}
