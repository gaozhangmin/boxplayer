// 媒体库相关类型定义
export interface MediaLibraryItem {
  id: string
  parentId: string
  folderId?: string // 所属文件夹ID
  folderPath?: string // 所属文件夹路径
  type: 'movie' | 'tv' | 'unmatched'
  name: string
  posterUrl?: string
  backdropUrl?: string
  logoUrl?: string
  year?: string
  releaseDate?: string
  rating?: number
  certification?: string
  mediaSubtype?: 'movie' | 'concert' | 'short'
  isMiniseries?: boolean
  genres: string[]
  networks?: Network[]
  productionCountries?: string[]
  overview?: string
  driveFiles: DriveFileItem[]
  tmdbId?: number
  imdbId?: string
  tvdbId?: string
  aiScrape?: { provider: string; confidence: number; reason: string; updatedAt: number }
  // TMDB / AI 暂时不可用时仍显示该文件，并在后续增量扫描中优先重试。
  scrapeRetrying?: boolean
  metadataSource?: 'tmdb' | 'ai-tmdb' | 'filename' | 'manual'
  metadataUpdatedAt?: number
  seasons?: MediaSeason[]
  expectedSeasons?: MediaExpectedSeason[]
  credits?: Credits
  // 删除冗余的episodes?: MediaEpisode[] - 集数信息应该在seasons中管理
  lastWatched?: Date
  watchProgress?: number
  lastPlayedFileId?: string
  lastPlayedPositionSeconds?: number
  lastPlayedDurationSeconds?: number
  collectionId?: number
  collectionName?: string
  collectionMovies?: MediaCollectionMovie[]
  addedAt: Date
}

export interface MediaCollectionMovie {
  certification?: string
  id: string
  parentId: string
  folderId?: string
  folderPath?: string
  type: 'movie'
  name: string
  posterUrl?: string
  backdropUrl?: string
  logoUrl?: string
  year?: string
  releaseDate?: string
  rating?: number
  genres: string[]
  productionCountries?: string[]
  overview?: string
  driveFiles: DriveFileItem[]
  tmdbId?: number
  imdbId?: string
  tvdbId?: string
  metadataSource?: 'tmdb' | 'ai-tmdb' | 'filename' | 'manual'
  metadataUpdatedAt?: number
  credits?: Credits
  addedAt: Date
}

export interface MediaExpectedSeason {
  seasonNumber: number
  episodeCount: number
  latestAiredEpisode?: number
  airDate?: string
  episodes?: MediaExpectedEpisode[]
}

export interface MediaExpectedEpisode {
  episodeNumber: number
  airDate?: string
}

export type FavoriteId = string

export type PlaylistMap = Record<string, string[]>

export interface MediaSeason {
  id: number
  seasonNumber: number
  name: string
  overview?: string
  posterPath?: string
  episodeCount: number
  airDate?: string
  credits?: Credits
  metadataSource?: 'tmdb' | 'manual'
  metadataUpdatedAt?: number
  episodes?: MediaEpisode[] // 添加缺少的episodes属性
}

export interface MediaEpisode {
  id: number
  rating?: number
  episodeNumber: number
  name: string
  overview?: string
  stillPath?: string
  airDate?: string
  runtime?: number
  seasonNumber: number
  crew?: CrewMember[]
  metadataSource?: 'tmdb' | 'manual'
  metadataUpdatedAt?: number
  driveFiles: DriveFileItem[]
}

export interface DriveFileItem {
  id: string
  name: string
  path: string
  parentFileId?: string
  userId?: string
  driveId: string
  driveServerId: string
  fileSize: number
  contentHash?: string
  contentHashName?: string
  thumbnailLink?: string
  videoDuration?: string
  height?: number
  cloudType?: string
  fileHash?: string
  sourceFolderIds?: string[]
  subtitleFiles?: Array<Omit<DriveFileItem, 'subtitleFiles'>>
}

// API响应结构
export interface ApiResponse<T> {
  msg?: string
  code?: number
  data?: T
}

export interface MovieItemResponse extends ApiResponse<MovieItem> {}
export interface TvSeriesItemResponse extends ApiResponse<MediaLibraryTvSeriesItem> {}

// 电影数据结构
export interface MovieItem {
  certification?: string
  id: number
  imdb_id?: string
  backdrop_path?: string
  logo_path?: string
  selfBackdropPath?: string
  backdropFile?: DriveFileItem
  genres?: Genre[]
  original_title: string
  original_language: string
  origin_country?: string[]
  overview: string
  poster_path?: string
  selfPosterPath?: string
  posterFile?: DriveFileItem
  release_date?: string
  credits: Credits
  title: string
  vote_average: number
  belongs_to_collection?: CollectionItem
  movieCollections?: MovieItem[]
  production_countries?: ProductionCountry[]
  production_companies?: ProductionCompany[]
  cloudItem?: DriveFileItem[]
}

// 电视剧数据结构
export interface MediaLibraryTvSeriesItem {
  id: number
  tv: TvSeriesItem
  current_season?: Season // 注意API使用下划线命名
}

export interface TvSeriesItem {
  certification?: string
  id: number
  name: string
  original_name?: string
  original_language?: string
  overview?: string
  origin_country?: string[]
  first_air_date?: string
  backdrop_path?: string
  logo_path?: string
  selfBackdropPath?: string
  backdropFile?: DriveFileItem
  poster_path?: string
  selfPosterPath?: string
  posterFile?: DriveFileItem
  vote_average?: number
  networks?: Network[]
  genres?: Genre[]
  languages?: string[]
  last_air_date?: string
  number_of_episodes?: number
  number_of_seasons?: number
  seasons?: Season[]
  credits?: Credits
  production_companies?: ProductionCompany[]
  production_countries?: ProductionCountry[]
  imdbId?: string
  tvdbId?: string
}

export interface Season {
  id: number
  air_date?: string
  name: string
  overview?: string
  poster_path?: string
  selfPosterPath?: string
  posterFile?: DriveFileItem
  season_number: number
  episode_count?: number
  episodes?: Episode[]
  vote_average?: number
  credits?: Credits
}

export interface Episode {
  id: number
  name: string
  overview?: string
  runtime?: number
  season_number: number
  episode_number: number
  still_path?: string
  selfStillPath?: string
  stillFile?: DriveFileItem
  vote_average?: number
  vote_count?: number
  air_date?: string
  crew?: CrewMember[]
  cloudItem?: DriveFileItem[]
}

// 支持类型
export interface Genre {
  id: number
  name: string
}

export interface Network {
  id: number
  name: string
  logoPath?: string
}

export interface CollectionItem {
  id: number
  name: string
  posterPath?: string
  backdropPath?: string
  parts?: MovieItem[]
}

export interface ProductionCountry {
  iso31661: string
  name: string
}

export interface ProductionCompany {
  id: number
  name: string
  logoPath?: string
  originCountry: string
}

export interface Credits {
  cast?: CastMember[]
  crew?: CrewMember[]
}

export interface CastMember {
  id: number
  name: string
  character?: string
  profile_path?: string
}

export interface CrewMember {
  id: number
  name: string
  job?: string
  department?: string
  profile_path?: string
}

// 保留原有的搜索结果类型（用于TMDB直接搜索）
export interface TmdbSearchResult {
  id: number
  title?: string
  name?: string
  original_title?: string
  original_name?: string
  overview?: string
  poster_path?: string
  backdrop_path?: string
  release_date?: string
  first_air_date?: string
  vote_average?: number
  genre_ids?: number[]
  media_type?: 'movie' | 'tv'
}

export interface TmdbGenre {
  id: number
  name: string
}

export interface MediaLibraryFolder {
  isDriveRootFavorite?: boolean
  isFavorite?: boolean
  id: string // 复合ID: ${driveServerId}_${fileId}
  fileId: string // 真正的阿里云盘文件ID
  name: string
  path: string
  userId?: string
  driveId: string
  driveServerId: string
  scanDate: Date
  itemCount: number
}

export interface MediaFilter {
  type?: 'movie' | 'tv' | 'unmatched'
  genre?: string
  yearRange?: [number, number]
  ratingRange?: [number, number]
  sortBy?: 'added' | 'title' | 'year' | 'rating'
  sortOrder?: 'asc' | 'desc'
}
