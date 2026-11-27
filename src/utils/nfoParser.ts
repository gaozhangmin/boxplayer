export const NFO_MAX_BYTES = 512 * 1024
export const ARTWORK_MAX_BYTES = 8 * 1024 * 1024

export type ParsedNfoKind = 'movie' | 'tvshow' | 'episodedetails'

export interface ParsedNfoMetadata {
  kind: ParsedNfoKind
  tmdbId?: number
  imdbId?: string
  tvdbId?: string
  title: string
  originalTitle?: string
  overview?: string
  year?: string
  releaseDate?: string
  rating?: number
  genres: string[]
  studios: string[]
  collectionName?: string
  mpaa?: string
  runtime?: number
  season?: number
  episode?: number
  episodeTitle?: string
  thumbUrl?: string
  fanartUrl?: string
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])

const XML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'"
}

export function stripFileExtension(name: string): string {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

export function isNfoFileName(name: string): boolean {
  return name.toLowerCase().endsWith('.nfo')
}

export function isArtworkFileName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

export function isSeasonDirectoryName(name: string): boolean {
  const trimmed = name.trim()
  if (!trimmed) return false
  return /^(?:season\s*\d+|s\d{1,3}|specials?|sp|ova|oav|第\s*[0-9一二三四五六七八九十百]+\s*[季部])$/i.test(trimmed)
}

export function stableNfoSyntheticId(seed: string): number {
  let hash = 2166136261
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  const positive = (hash >>> 0) % 2_000_000_000
  return -(positive + 1)
}

function decodeXmlText(raw: string): string {
  const withoutCdata = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return withoutCdata
    .replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_match, entity: string) => {
      if (entity.startsWith('#x') || entity.startsWith('#X')) {
        const code = Number.parseInt(entity.slice(2), 16)
        return Number.isFinite(code) ? String.fromCodePoint(code) : ''
      }
      if (entity.startsWith('#')) {
        const code = Number.parseInt(entity.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : ''
      }
      return XML_ENTITY_MAP[entity] ?? _match
    })
    .trim()
}

function stripNestedBlocks(xml: string, tags: string[]): string {
  let result = xml
  for (const tag of tags) {
    result = result.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'), '')
  }
  return result
}

function parseAttributes(rawAttrs: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const regex = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(rawAttrs))) {
    attrs[match[1].toLowerCase()] = decodeXmlText(match[2] ?? match[3] ?? '')
  }
  return attrs
}

function extractElements(xml: string, tagName: string): Array<{ attrs: Record<string, string>; body: string; text: string }> {
  const regex = new RegExp(`<${tagName}(\\b[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'gi')
  const items: Array<{ attrs: Record<string, string>; body: string; text: string }> = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml))) {
    const body = match[2] || ''
    items.push({
      attrs: parseAttributes(match[1] || ''),
      body,
      text: decodeXmlText(body.replace(/<[^>]+>/g, ''))
    })
  }
  return items
}

function firstTagText(xml: string, tagNames: string[]): string | undefined {
  for (const tag of tagNames) {
    for (const element of extractElements(xml, tag)) {
      if (element.text) return element.text
    }
  }
  return undefined
}

function positiveInt(raw?: string): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const num = Number.parseInt(trimmed, 10)
  return Number.isFinite(num) && num > 0 ? num : undefined
}

function nonNegativeInt(raw?: string): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const num = Number.parseInt(trimmed, 10)
  return Number.isFinite(num) && num >= 0 ? num : undefined
}

function extractRating(topXml: string): number | undefined {
  const ratingsBlock = extractElements(topXml, 'ratings')[0]?.body || topXml
  const ratings = extractElements(ratingsBlock, 'rating')
  const parseValue = (entry: { attrs: Record<string, string>; body: string; text: string }): number | undefined => {
    const valueText = firstTagText(entry.body, ['value']) || entry.text
    const parsed = valueText ? Number.parseFloat(valueText) : Number.NaN
    return Number.isFinite(parsed) && parsed > 0 && parsed <= 10 ? parsed : undefined
  }
  for (const preferred of [
    ratings.find(r => (r.attrs.name || '').toLowerCase() === 'themoviedb'),
    ratings.find(r => (r.attrs.default || '').toLowerCase() === 'true'),
    ratings[0]
  ]) {
    if (preferred) {
      const value = parseValue(preferred)
      if (value !== undefined) return value
    }
  }
  const direct = firstTagText(topXml, ['rating'])
  if (direct) {
    const parsed = Number.parseFloat(direct)
    if (Number.isFinite(parsed) && parsed > 0 && parsed <= 10) return parsed
  }
  return undefined
}

export function parseNfoXml(rawXml: string): ParsedNfoMetadata | null {
  if (!rawXml || typeof rawXml !== 'string') return null
  const sanitized = rawXml
    .replace(/^\uFEFF/, '')
    .replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')

  const rootMatch = sanitized.match(/<(movie|tvshow|episodedetails)\b[^>]*>([\s\S]*?)<\/\1>/i)
  if (!rootMatch) return null
  const kind = rootMatch[1].toLowerCase() as ParsedNfoKind
  const rootBody = rootMatch[2] || ''

  // Exclude nested cast/crew/technical metadata blocks before extracting top-level tags.
  const topXml = stripNestedBlocks(rootBody, ['actor', 'director', 'credits', 'producer', 'fileinfo', 'streamdetails'])

  const uniqueIds = extractElements(topXml, 'uniqueid')
  let tmdbId = positiveInt(uniqueIds.find(item => (item.attrs.type || '').toLowerCase() === 'tmdb')?.text)
    ?? positiveInt(firstTagText(topXml, ['tmdbid']))
  const rawId = firstTagText(topXml, ['id'])
  if (tmdbId === undefined && rawId && /^\d+$/.test(rawId)) {
    tmdbId = positiveInt(rawId)
  }

  let imdbId = uniqueIds.find(item => (item.attrs.type || '').toLowerCase() === 'imdb')?.text
    || firstTagText(topXml, ['imdbid'])
  if (!imdbId && rawId && /^tt\d+$/i.test(rawId)) imdbId = rawId
  const tvdbId = uniqueIds.find(item => (item.attrs.type || '').toLowerCase() === 'tvdb')?.text
    || firstTagText(topXml, ['tvdbid'])

  const title = firstTagText(topXml, ['title']) || firstTagText(topXml, ['showtitle', 'originaltitle']) || ''
  const originalTitle = firstTagText(topXml, ['originaltitle'])
  const overview = firstTagText(topXml, ['plot', 'outline'])
  const releaseDate = firstTagText(topXml, ['premiered', 'aired', 'releasedate'])
  const yearMatch = firstTagText(topXml, ['year'])?.match(/\b(19\d\d|20\d\d)\b/) || releaseDate?.match(/\b(19\d\d|20\d\d)\b/)
  const year = yearMatch?.[1]

  const genres = [...new Set(extractElements(topXml, 'genre').map(item => item.text).filter(Boolean))]
  const studios = [...new Set(extractElements(topXml, 'studio').map(item => item.text).filter(Boolean))]
  const setBody = extractElements(topXml, 'set')[0]?.body
  const collectionName = setBody ? firstTagText(setBody, ['name', 'title']) : undefined
  const mpaa = firstTagText(topXml, ['mpaa'])
  const runtime = positiveInt(firstTagText(topXml, ['runtime']))
  const season = nonNegativeInt(firstTagText(topXml, ['season']))
  const episode = nonNegativeInt(firstTagText(topXml, ['episode']))

  const fanartBody = extractElements(topXml, 'fanart')[0]?.body || ''
  const fanartUrl = extractElements(fanartBody, 'thumb')
    .map(item => item.text)
    .find(url => /^https?:\/\//i.test(url))

  const withoutFanart = stripNestedBlocks(topXml, ['fanart'])
  const thumbs = extractElements(withoutFanart, 'thumb').filter(item => /^https?:\/\//i.test(item.text))
  const thumbUrl = (thumbs.find(item => (item.attrs.aspect || '').toLowerCase() === 'poster') || thumbs[0])?.text

  return {
    kind,
    tmdbId,
    imdbId: imdbId || undefined,
    tvdbId: tvdbId || undefined,
    title,
    originalTitle: originalTitle || undefined,
    overview: overview || undefined,
    year,
    releaseDate: releaseDate || undefined,
    rating: extractRating(topXml),
    genres,
    studios,
    collectionName: collectionName || undefined,
    mpaa: mpaa || undefined,
    runtime,
    season,
    episode,
    episodeTitle: kind === 'episodedetails' ? (firstTagText(topXml, ['title']) || undefined) : undefined,
    thumbUrl,
    fanartUrl
  }
}

export function mergeShowAndEpisodeNfo(
  showNfo: ParsedNfoMetadata | null,
  episodeNfo: ParsedNfoMetadata | null
): ParsedNfoMetadata | null {
  if (!showNfo && !episodeNfo) return null
  if (!showNfo) return episodeNfo
  if (!episodeNfo) return showNfo
  if (episodeNfo.kind === 'movie' && showNfo.kind !== 'tvshow') return episodeNfo
  return {
    kind: episodeNfo.kind === 'episodedetails' ? 'tvshow' : showNfo.kind,
    tmdbId: showNfo.tmdbId ?? episodeNfo.tmdbId,
    imdbId: showNfo.imdbId ?? episodeNfo.imdbId,
    tvdbId: showNfo.tvdbId ?? episodeNfo.tvdbId,
    title: showNfo.title || episodeNfo.title,
    originalTitle: showNfo.originalTitle || episodeNfo.originalTitle,
    overview: showNfo.overview || episodeNfo.overview,
    year: showNfo.year || episodeNfo.year,
    releaseDate: showNfo.releaseDate || episodeNfo.releaseDate,
    rating: showNfo.rating ?? episodeNfo.rating,
    genres: showNfo.genres.length ? showNfo.genres : episodeNfo.genres,
    studios: showNfo.studios.length ? showNfo.studios : episodeNfo.studios,
    collectionName: showNfo.collectionName || episodeNfo.collectionName,
    mpaa: showNfo.mpaa || episodeNfo.mpaa,
    runtime: episodeNfo.runtime ?? showNfo.runtime,
    season: episodeNfo.season ?? showNfo.season,
    episode: episodeNfo.episode ?? showNfo.episode,
    episodeTitle: episodeNfo.episodeTitle || episodeNfo.title || undefined,
    thumbUrl: showNfo.thumbUrl || episodeNfo.thumbUrl,
    fanartUrl: showNfo.fanartUrl || episodeNfo.fanartUrl
  }
}

export interface DirectorySidecarIndex<T extends { name: string }> {
  tvshowNfo?: T
  movieNfo?: T
  posterFile?: T
  fanartFile?: T
  filesByLowerName: Map<string, T>
  artworksByLowerStem: Map<string, T>
}

export interface MatchedVideoSidecars<T extends { name: string }> {
  videoNfo?: T
  movieNfo?: T
  tvshowNfo?: T
  posterFile?: T
  fanartFile?: T
  thumbFile?: T
}

export function buildDirectorySidecarIndex<T extends { name: string }>(entries: T[]): DirectorySidecarIndex<T> {
  const filesByLowerName = new Map<string, T>()
  const artworksByLowerStem = new Map<string, T>()
  for (const entry of entries) {
    const lower = entry.name.toLowerCase()
    if (!filesByLowerName.has(lower)) filesByLowerName.set(lower, entry)
    if (isArtworkFileName(entry.name)) {
      const stem = stripFileExtension(lower)
      if (!artworksByLowerStem.has(stem)) artworksByLowerStem.set(stem, entry)
    }
  }
  const posterFile = artworksByLowerStem.get('poster') || artworksByLowerStem.get('folder') || artworksByLowerStem.get('cover')
  const fanartFile = artworksByLowerStem.get('fanart') || artworksByLowerStem.get('backdrop')
  return {
    tvshowNfo: filesByLowerName.get('tvshow.nfo'),
    movieNfo: filesByLowerName.get('movie.nfo'),
    posterFile,
    fanartFile,
    filesByLowerName,
    artworksByLowerStem
  }
}

export function matchDirectorySidecars<T extends { name: string }>(
  index: DirectorySidecarIndex<T>,
  videoName: string,
  parentShowIndex?: Pick<DirectorySidecarIndex<T>, 'tvshowNfo' | 'posterFile' | 'fanartFile'>
): MatchedVideoSidecars<T> {
  const lowerStem = stripFileExtension(videoName.toLowerCase())
  const videoNfo = index.filesByLowerName.get(`${lowerStem}.nfo`)
  const posterFile =
    index.artworksByLowerStem.get(`${lowerStem}-poster`)
    || index.artworksByLowerStem.get(lowerStem)
    || index.posterFile
    || parentShowIndex?.posterFile
  const fanartFile =
    index.artworksByLowerStem.get(`${lowerStem}-fanart`)
    || index.artworksByLowerStem.get(`${lowerStem}-backdrop`)
    || index.fanartFile
    || parentShowIndex?.fanartFile
  const thumbFile =
    index.artworksByLowerStem.get(`${lowerStem}-thumb`)
    || index.artworksByLowerStem.get(lowerStem)
  return {
    videoNfo,
    movieNfo: index.movieNfo,
    tvshowNfo: index.tvshowNfo || parentShowIndex?.tvshowNfo,
    posterFile,
    fanartFile,
    thumbFile
  }
}
