import { describe, expect, it } from 'vitest'
import {
  buildDirectorySidecarIndex,
  isSeasonDirectoryName,
  matchDirectorySidecars,
  mergeShowAndEpisodeNfo,
  parseNfoXml,
  stableNfoSyntheticId
} from '../nfoParser'

describe('TMM / Kodi NFO parser and sidecar matching', () => {
  it('parses TMM movie XML with uniqueid, ratings, set, and escaped ampersands', () => {
    const xml = `\uFEFF<?xml version="1.0" encoding="UTF-8"?>
<movie>
  <title>Fast & Furious</title>
  <originaltitle>The Fast and the Furious</originaltitle>
  <ratings>
    <rating name="imdb"><value>6.8</value></rating>
    <rating name="themoviedb" default="true"><value>7.2</value></rating>
  </ratings>
  <plot>Street racing story.</plot>
  <year>2001</year>
  <premiered>2001-06-22</premiered>
  <runtime>106</runtime>
  <mpaa>PG-13</mpaa>
  <uniqueid type="imdb">tt0232500</uniqueid>
  <uniqueid type="tmdb" default="true">9799</uniqueid>
  <genre>Action</genre>
  <genre>Crime</genre>
  <set><name>The Fast and the Furious Collection</name></set>
  <actor><name>Paul Walker</name><title>Ignored Nested Title</title></actor>
</movie>`
    const parsed = parseNfoXml(xml)
    expect(parsed).toMatchObject({
      kind: 'movie',
      tmdbId: 9799,
      imdbId: 'tt0232500',
      title: 'Fast & Furious',
      originalTitle: 'The Fast and the Furious',
      overview: 'Street racing story.',
      year: '2001',
      releaseDate: '2001-06-22',
      rating: 7.2,
      genres: ['Action', 'Crime'],
      collectionName: 'The Fast and the Furious Collection',
      mpaa: 'PG-13',
      runtime: 106
    })
  })

  it('parses offline NFO without tmdbId and merges tvshow + episodedetails', () => {
    const show = parseNfoXml(`
      <tvshow>
        <title>Custom Documentary</title>
        <plot>Show overview</plot>
        <premiered>2025-03-01</premiered>
        <genre>Documentary</genre>
      </tvshow>
    `)
    const ep = parseNfoXml(`
      <episodedetails>
        <title>Opening Night</title>
        <season>2</season>
        <episode>4</episode>
        <aired>2025-03-15</aired>
        <plot>Episode details</plot>
      </episodedetails>
    `)
    expect(show?.tmdbId).toBeUndefined()
    const merged = mergeShowAndEpisodeNfo(show, ep)
    expect(merged).toMatchObject({
      kind: 'tvshow',
      title: 'Custom Documentary',
      episodeTitle: 'Opening Night',
      season: 2,
      episode: 4,
      genres: ['Documentary']
    })
    expect(stableNfoSyntheticId('show-a')).toBeLessThan(0)
    expect(stableNfoSyntheticId('show-a')).toBe(stableNfoSyntheticId('show-a'))
    expect(stableNfoSyntheticId('show-a')).not.toBe(stableNfoSyntheticId('show-b'))
  })

  it('matches sibling poster/fanart and parent show sidecars by precedence', () => {
    const parentIndex = buildDirectorySidecarIndex([
      { name: 'tvshow.nfo' },
      { name: 'poster.jpg' },
      { name: 'fanart.png' }
    ])
    const seasonIndex = buildDirectorySidecarIndex([
      { name: 'S01E01.mkv' },
      { name: 'S01E01.nfo' },
      { name: 'S01E01-thumb.webp' }
    ])
    expect(isSeasonDirectoryName('Season 1')).toBe(true)
    expect(isSeasonDirectoryName('第1季')).toBe(true)
    expect(isSeasonDirectoryName('Movies')).toBe(false)

    const matched = matchDirectorySidecars(seasonIndex, 'S01E01.mkv', parentIndex)
    expect(matched.videoNfo?.name).toBe('S01E01.nfo')
    expect(matched.tvshowNfo?.name).toBe('tvshow.nfo')
    expect(matched.posterFile?.name).toBe('poster.jpg')
    expect(matched.fanartFile?.name).toBe('fanart.png')
    expect(matched.thumbFile?.name).toBe('S01E01-thumb.webp')

    const movieDir = buildDirectorySidecarIndex([
      { name: 'Film.mkv' },
      { name: 'Film-poster.png' },
      { name: 'poster.jpg' },
      { name: 'Film-backdrop.jpg' },
      { name: 'movie.nfo' }
    ])
    const movieMatched = matchDirectorySidecars(movieDir, 'Film.mkv')
    expect(movieMatched.posterFile?.name).toBe('Film-poster.png')
    expect(movieMatched.fanartFile?.name).toBe('Film-backdrop.jpg')
    expect(movieMatched.movieNfo?.name).toBe('movie.nfo')
  })
})
