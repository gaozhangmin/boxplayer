import { describe, expect, it } from 'vitest'
import { MediaFileNormalizer } from '../mediaFileNormalizer'

describe('MediaFileNormalizer', () => {
  const normalizer = new MediaFileNormalizer()

  it('returns one descriptor for release-style TV names', () => {
    expect(normalizer.normalize('Show.Name.S02E03.1080p.WEB-DL.mkv')).toEqual({
      normalizedFileName: 'show.name.s02e03.1080p.web-dl',
      cleanedTitle: 'show name',
      searchTitle: 'show name',
      releaseYear: undefined,
      seasonNumber: 2,
      episodeNumber: 3
    })
  })

  it('extracts movie title and release year before technical tags', () => {
    const result = normalizer.normalize('Movie.Title.2024.2160p.mkv')
    expect(result.cleanedTitle).toBe('movie title')
    expect(result.searchTitle).toBe('movie title')
    expect(result.releaseYear).toBe(2024)
    expect(result.seasonNumber).toBeUndefined()
  })

  it('does not mistake titles for episode markers or discard sequel numbers', () => {
    expect(normalizer.normalize('Se7en.1995.mkv')).toMatchObject({
      searchTitle: 'se7en', releaseYear: 1995,
      seasonNumber: undefined,
      episodeNumber: undefined
    })
    expect(normalizer.normalize('1917.mkv', '/Movies/1917.mkv')).toMatchObject({ cleanedTitle: '1917', searchTitle: '1917' })
    expect(normalizer.normalize('流浪地球 2 2023.mkv').searchTitle).toBe('流浪地球 2')
  })

  it('extracts years with spaces or dots while preserving numeric film titles', () => {
    for (const name of ['Dune 2021.mkv', 'Dune.2021.mkv', 'Dune 2021 1080p.mkv']) {
      expect(normalizer.normalize(name)).toMatchObject({ searchTitle: 'dune', releaseYear: 2021 })
    }
    expect(normalizer.normalize('2012.mkv')).toMatchObject({ searchTitle: '2012', releaseYear: undefined })
  })

  it('supports alternate, numeric and Chinese episode formats', () => {
    expect(normalizer.normalize('Show.S01_02.1080p.mkv')).toMatchObject({ searchTitle: 'show', seasonNumber: 1, episodeNumber: 2 })
    expect(normalizer.normalize('Show.1x03.WEBRip.mkv')).toMatchObject({ searchTitle: 'show', seasonNumber: 1, episodeNumber: 3 })
    expect(normalizer.normalize('庆余年.第二季.第十话.1080p.mkv')).toMatchObject({ searchTitle: '庆余年', seasonNumber: 2, episodeNumber: 10 })
  })

  it('uses folder context for numeric and marker-only episode names', () => {
    for (const name of ['EP03.mkv', '03.1080p.mkv']) {
      expect(normalizer.normalize(name, `/Library/My Show/Season 02/${name}`)).toMatchObject({ searchTitle: 'my show', seasonNumber: 2, episodeNumber: 3 })
    }
    expect(normalizer.normalize('03.mkv', '/Library/My Show/Season 02/03.mkv')).toMatchObject({
      searchTitle: 'my show',
      seasonNumber: 2,
      episodeNumber: 3
    })
    expect(normalizer.normalize('S01E01.mkv', '/Library/My Show/Season 01/S01E01.mkv')).toMatchObject({
      searchTitle: 'my show',
      seasonNumber: 1,
      episodeNumber: 1
    })
    expect(normalizer.normalize('07.mp4', '/不限速 最全库11111/剧集/欧美剧集/美剧 金斯敦市长 第四季 2025/07.mp4')).toMatchObject({
      searchTitle: '金斯敦市长',
      seasonNumber: 4,
      episodeNumber: 7
    })
  })

  it('retains every episode in a multi-episode release', () => {
    expect(normalizer.normalize('Show.S01E01-E03.mkv')).toMatchObject({ searchTitle: 'show', seasonNumber: 1, episodeNumber: 1, episodeNumbers: [1, 2, 3] })
  })
})
