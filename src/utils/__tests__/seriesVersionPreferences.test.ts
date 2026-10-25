import { afterEach, describe, expect, it } from 'vitest'
import { expandedMovieCollections, movieVersionItems, orderedVersions, seriesPreferences } from '../seriesVersionPreferences'
import type { DriveFileItem, MediaLibraryItem } from '../../types/media'
const file = (id: string, fileSize: number) => ({ id, fileSize } as DriveFileItem)
const movie = (id: string, files: DriveFileItem[]) => ({ id, name: id, type: 'movie', genres: [], driveFiles: files, addedAt: new Date(0), parentId: '' } as MediaLibraryItem & { type: 'movie' })
afterEach(() => { seriesPreferences.mergeVersions = true; seriesPreferences.defaultVersion = 'auto' })
describe('series and version display policy', () => {
  it('retains automatic ordering without mutating the source', () => {
    const files = [file('a', 10), file('b', 30)]
    expect(orderedVersions(files, 'auto')).toBe(files)
    expect(orderedVersions(files, 'largest').map(item => item.id)).toEqual(['b', 'a'])
    expect(files.map(item => item.id)).toEqual(['a', 'b'])
  })
  it('keeps unknown sizes last for either size preference and preserves ties', () => {
    const files = [file('unknown', 0), file('a', 10), file('b', 10), file('c', 30)]
    expect(orderedVersions(files, 'smallest').map(item => item.id)).toEqual(['a', 'b', 'c', 'unknown'])
    expect(orderedVersions(files, 'largest').map(item => item.id)).toEqual(['c', 'a', 'b', 'unknown'])
  })
  it('expands versions only for display and retains canonical identity and files', () => {
    const source = movie('movie', [file('a', 10), file('b', 30)])
    expect(movieVersionItems([source])).toEqual([source])
    seriesPreferences.mergeVersions = false
    const display = movieVersionItems([source])
    expect(display.map(item => item.driveFiles[0].id)).toEqual(['a', 'b'])
    expect(display.map(item => item.id)).toEqual(['movie', 'movie'])
    expect(source.driveFiles).toHaveLength(2)
  })
  it('flattens stored collections without discarding member files or changing storage', () => {
    const members = [movie('a', [file('a', 10)]), movie('b', [file('b', 20)])]
    const collection = { ...members[0], id: 'collection', collectionId: 5, collectionMovies: members }
    expect(expandedMovieCollections([collection]).map(item => item.id)).toEqual(['a', 'b'])
    expect(collection.collectionMovies).toHaveLength(2)
    expect(expandedMovieCollections([collection])[1].driveFiles[0].id).toBe('b')
  })
})
