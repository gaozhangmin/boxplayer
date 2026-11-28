import { expect, it } from 'vitest'
import type { MediaLibraryItem } from '@/features/files/electron/mediaTypes'
import { visibleSeriesSeasons } from '@/features/library/electron/mediaCoverage'

it('controls missing seasons and missing episodes independently', () => {
  const file = { id: 'owned' } as MediaLibraryItem['driveFiles'][number]
  const episode = { id: 1, seasonNumber: 1, episodeNumber: 1, name: 'Pilot', driveFiles: [file] }
  const item = {
    id: 'series', type: 'tv',
    seasons: [{ id: 1, seasonNumber: 1, name: 'Season 1', episodeCount: 1, episodes: [episode] }],
    expectedSeasons: [{ seasonNumber: 1, episodeCount: 2 }, { seasonNumber: 2, episodeCount: 1 }],
  } as MediaLibraryItem
  const listed = (seasons: boolean, episodes: boolean) => visibleSeriesSeasons(item, seasons, episodes).map(
    season => [season.seasonNumber, season.episodes?.map(entry => entry.driveFiles.length)],
  )
  expect(listed(true, true)).toEqual([[1, [1, 0]], [2, [0]]])
  expect(listed(false, true)).toEqual([[1, [1, 0]]])
  expect(listed(true, false)).toEqual([[1, [1]], [2, []]])
  expect(listed(false, false)).toEqual([[1, [1]]])
  expect(item.seasons?.[0]?.episodes).toEqual([episode])
})
