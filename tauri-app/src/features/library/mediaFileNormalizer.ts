export interface NormalizedMediaFileDescriptor {
  normalizedFileName: string
  cleanedTitle: string
  searchTitle?: string
  releaseYear?: number
  seasonNumber?: number
  episodeNumber?: number
  episodeNumbers?: number[]
}

const MEDIA_EXTENSIONS = new Set(['mkv', 'mp4', 'm4v', 'avi', 'mov', 'wmv', 'flv', 'ts', 'm2ts', 'webm', 'mpg', 'mpeg', '3gp', 'rmvb', 'asf', 'divx', 'xvid', 'mts', 'vob', 'ogv', 'dv'])
const CHINESE_NUMBER_PATTERN = '[一二三四五六七八九十两零\\d]+'
const TECHNICAL_TAG_PATTERN = /(?:^|[.\s_\-[\(])(?:2160p|1080p|720p|480p|4k|web[ ._-]?(?:dl|rip)?|webrip|bluray|bdrip|remux|h[ ._-]?26[45]|x26[45]|hevc|av1|aac(?:[ ._-]?\d+(?:\.\d+)?)?|dts|truehd|ddp(?:[ ._-]?\d+(?:\.\d+)?)?|atmos|hdr(?:10(?:\+)?|[ ._-]?dv)?)(?=$|[.\s_\-\]\)])/i

type SeasonEpisode = { season: number; episode: number }

export class MediaFileNormalizer {
  normalize(fileName: string, folderHint?: string): NormalizedMediaFileDescriptor {
    const mediaName = this.removeMediaExtension(fileName)
    const parsedSeasonEpisode = this.parseSeasonEpisode(mediaName)
    const folderSeason = this.parseSeasonNumber(folderHint)
    const seasonEpisode = parsedSeasonEpisode ?? this.standaloneEpisode(mediaName, folderSeason)
    if (seasonEpisode && folderSeason !== undefined && !/(?:^|[^A-Za-z0-9])S(?:eason)?[ ._-]*\d|\d{1,2}x\d|第.+季/i.test(mediaName)) seasonEpisode.season = folderSeason
    const multipleEpisodes = mediaName.match(/S\d{1,2}[ ._-]*E(\d{1,3})\s*-\s*E?(\d{1,3})(?!\d)/i)
    const episodeNumbers = multipleEpisodes && Number(multipleEpisodes[2]) > Number(multipleEpisodes[1]) && Number(multipleEpisodes[2]) - Number(multipleEpisodes[1]) < 100
      ? Array.from({ length: Number(multipleEpisodes[2]) - Number(multipleEpisodes[1]) + 1 }, (_, index) => Number(multipleEpisodes[1]) + index)
      : undefined
    const titleRegion = this.titleRegion(mediaName)
    const releaseYear = this.releaseYear(titleRegion, mediaName)
    const cleanedTitle = this.cleanTitle(titleRegion, releaseYear)
    const folderTitle = this.titleFromFolderHint(folderHint)
    const searchTitle = MediaFileNormalizer.isSearchableTitle(cleanedTitle) ? cleanedTitle : folderTitle

    return {
      normalizedFileName: mediaName.replace(/\s/g, '').toLowerCase(),
      cleanedTitle,
      searchTitle,
      releaseYear,
      seasonNumber: seasonEpisode?.season,
      episodeNumber: seasonEpisode?.episode,
      ...(episodeNumbers ? { episodeNumbers } : {})
    }
  }

  static isSearchableTitle(title: string): boolean {
    const compactTitle = title.replace(/\s/g, '')
    return /^\d{4}$/.test(compactTitle) || (compactTitle.length > 0 && !/^\d+$/.test(compactTitle) && /\p{L}/u.test(compactTitle))
  }

  private titleRegion(name: string): string {
    const boundaries = [this.seasonEpisodeIndex(name), this.technicalTagIndex(name)].filter((value): value is number => value !== undefined)
    return boundaries.length > 0 ? name.slice(0, Math.min(...boundaries)) : name
  }

  private releaseYear(titleRegion: string, originalName: string): number | undefined {
    const bracketed = originalName.match(/[\(\[（【](19\d{2}|20\d{2})[\)\]）】]/)
    if (bracketed) return Number(bracketed[1])

    const separated = titleRegion.match(/(?:^|[.\s_-])(19\d{2}|20\d{2})(?=$|[.\s_-])/)
    return separated && this.cleanTitle(titleRegion, Number(separated[1])).length > 0 ? Number(separated[1]) : undefined
  }

  private cleanTitle(value: string, releaseYear?: number): string {
    let title = value
    if (releaseYear) {
      title = title.replace(new RegExp(`(?:^|[.\\s_-])${releaseYear}(?=$|[.\\s_-])`), ' ')
    }
    return title
      .replace(/[.+_\-=|/\\;:,'!?~"%#$&*<>｜[\](){}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
  }

  private parseSeasonEpisode(name: string): SeasonEpisode | undefined {
    const patterns: RegExp[] = [
      /(?:^|[^A-Za-z0-9])S(?:eason)?[ ._-]*(\d{1,2})[ ._-]*E(?:pisode)?[ ._-]*(\d{1,3})(?![A-Za-z0-9])/i,
      /(?:^|[^A-Za-z0-9])S(?:eason)?[ ._-]*(\d{1,2})[._-]+(\d{1,3})(?![A-Za-z0-9])/i,
      /(?:^|[^A-Za-z0-9])(\d{1,2})x(\d{1,3})(?![A-Za-z0-9])/i,
      new RegExp(`第(${CHINESE_NUMBER_PATTERN})季.*?第(${CHINESE_NUMBER_PATTERN})(?:集|话)`)
    ]

    for (const pattern of patterns) {
      const match = name.match(pattern)
      if (!match) continue
      const season = this.parseNumber(match[1])
      const episode = this.parseNumber(match[2])
      if (season !== undefined && episode !== undefined) return { season, episode }
    }

    const markerEpisode = name.match(/(?:^|[^A-Za-z0-9])(?:Episode|Ep|E)[ ._-]*(\d{1,3})(?![A-Za-z0-9])/i)
    if (markerEpisode) return { season: 1, episode: Number(markerEpisode[1]) }

    const chineseEpisode = name.match(new RegExp(`第(${CHINESE_NUMBER_PATTERN})(?:集|话)`))
    const episode = chineseEpisode ? this.parseNumber(chineseEpisode[1]) : undefined
    return episode === undefined ? undefined : { season: 1, episode }
  }

  private seasonEpisodeIndex(name: string): number | undefined {
    const patterns: RegExp[] = [
      /(?:^|[^A-Za-z0-9])S(?:eason)?[ ._-]*\d{1,2}[ ._-]*E(?:pisode)?[ ._-]*\d{1,3}(?![A-Za-z0-9])/i,
      /(?:^|[^A-Za-z0-9])S(?:eason)?[ ._-]*\d{1,2}[._-]+\d{1,3}(?![A-Za-z0-9])/i,
      /(?:^|[^A-Za-z0-9])\d{1,2}x\d{1,3}(?![A-Za-z0-9])/i,
      new RegExp(`第${CHINESE_NUMBER_PATTERN}季.*?第${CHINESE_NUMBER_PATTERN}(?:集|话)`),
      /(?:^|[^A-Za-z0-9])(?:Episode|Ep|E)[ ._-]*\d{1,3}(?![A-Za-z0-9])/i,
      new RegExp(`第${CHINESE_NUMBER_PATTERN}(?:集|话)`)
    ]
    const indexes = patterns.map(pattern => name.search(pattern)).filter(index => index >= 0)
    return indexes.length > 0 ? Math.min(...indexes) : undefined
  }

  private standaloneEpisode(name: string, folderSeason?: number): SeasonEpisode | undefined {
    const match = this.titleRegion(name).match(/^\s*0*(\d{1,3})[.\s_-]*$/)
    return match && folderSeason !== undefined ? { season: folderSeason, episode: Number(match[1]) } : undefined
  }

  private parseSeasonNumber(folderHint?: string): number | undefined {
    if (!folderHint) return undefined
    for (const component of this.folderComponents(folderHint).reverse()) {
      const season = component.match(/(?:^|[\s._-])(?:S|Season)\s*0*(\d{1,2})(?=$|[\s._-])/i)
      if (season) return Number(season[1])
      const chinese = component.match(new RegExp(`第(${CHINESE_NUMBER_PATTERN})季`))
      const value = chinese ? this.parseNumber(chinese[1]) : undefined
      if (value !== undefined) return value
    }
    return undefined
  }

  private titleFromFolderHint(folderHint?: string): string | undefined {
    if (!folderHint) return undefined
    for (const component of this.folderComponents(folderHint).reverse()) {
      const hasSeason = this.parseSeasonNumber(component) !== undefined
      const titlePart = hasSeason
        ? component
          .replace(/(?:^|[\s._-])(?:S|Season)\s*0*\d{1,2}(?=$|[\s._-])/i, ' ')
          .replace(new RegExp(`第${CHINESE_NUMBER_PATTERN}季`), ' ')
          .replace(/(?:^|[\s._-])(?:19|20)\d{2}(?=$|[\s._-])/, ' ')
          .replace(/^(?:美剧|英剧|日剧|韩剧|国产剧|港剧|台剧)\s+/, '')
        : component
      const title = this.cleanTitle(titlePart)
      if (MediaFileNormalizer.isSearchableTitle(title)) return title
    }
    return undefined
  }

  private folderComponents(folderHint: string): string[] {
    const components = folderHint.split(/[\\/]/).filter(Boolean)
    if (components.length > 1) components.pop()
    return components
  }

  private technicalTagIndex(value: string): number | undefined {
    const match = TECHNICAL_TAG_PATTERN.exec(value)
    return match?.index
  }

  private removeMediaExtension(value: string): string {
    const match = value.match(/\.([^.]+)$/)
    return match && MEDIA_EXTENSIONS.has(match[1].toLowerCase()) ? value.slice(0, -match[0].length) : value
  }

  private parseNumber(value: string): number | undefined {
    if (/^\d+$/.test(value)) return Number(value)
    const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
    let result = 0
    let current = 0
    for (const character of value) {
      if (character === '十') {
        result += Math.max(current, 1) * 10
        current = 0
      } else if (digits[character] !== undefined) {
        current = digits[character]
      } else {
        return undefined
      }
    }
    const number = result + current
    return number > 0 ? number : undefined
  }
}

export const mediaFileNormalizer = new MediaFileNormalizer()
