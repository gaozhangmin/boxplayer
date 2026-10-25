import { reactive } from 'vue'
import type { DriveFileItem, MediaLibraryItem } from '../types/media'
export type VersionMode = 'auto' | 'largest' | 'smallest'
const defaults = { showMovies: true, showTV: false, useTMDB: true, useCustom: true, openDetail: true, mergeVersions: true, defaultVersion: 'auto' as VersionMode, playbackVersion: 'auto' as VersionMode }
export const seriesPreferences = reactive({ ...defaults })
function read() {
  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    try { const value = JSON.parse(localStorage.getItem('series.' + key) || 'null')
      if (typeof defaults[key] === 'boolean' ? typeof value === 'boolean' : ['auto', 'largest', 'smallest'].includes(value)) Object.assign(seriesPreferences, { [key]: value })
    } catch { /* Keep the default for unavailable or invalid storage. */ }
  }
}
if (typeof window !== 'undefined') { read(); window.addEventListener('storage', read); window.addEventListener('boxplayer:series-preferences', read) }
export function setSeriesPreference(key: keyof typeof defaults, value: boolean | VersionMode) {
  localStorage.setItem('series.' + key, JSON.stringify(value)); read()
  window.dispatchEvent(new Event('boxplayer:series-preferences'))
}
export function orderedVersions(files: DriveFileItem[], mode: VersionMode): DriveFileItem[] {
  if (mode === 'auto') return files
  return [...files].sort((a, b) => {
    if (!(a.fileSize > 0)) return b.fileSize > 0 ? 1 : 0
    if (!(b.fileSize > 0)) return -1
    return mode === 'largest' ? b.fileSize - a.fileSize : a.fileSize - b.fileSize
  })
}
export function movieVersionItems(items: MediaLibraryItem[]): MediaLibraryItem[] {
  if (seriesPreferences.mergeVersions) return items
  return items.flatMap(item => item.type === 'movie' && item.driveFiles.length > 1
    ? orderedVersions(item.driveFiles, seriesPreferences.defaultVersion).map(file => ({ ...item, driveFiles: [file] })) : [item])
}

export function expandedMovieCollections(items: MediaLibraryItem[]): MediaLibraryItem[] {
  return items.flatMap(item => item.collectionMovies?.length
    ? item.collectionMovies.map(movie => ({ ...item, ...movie, type: 'movie' as const, collectionMovies: undefined })) : [item])
}

export function playbackVersions(files: DriveFileItem[]): DriveFileItem[] {
  return orderedVersions(files, seriesPreferences.playbackVersion === 'auto' ? seriesPreferences.defaultVersion : seriesPreferences.playbackVersion)
}

export const generalPreferences = reactive({ autoSubtitles: false, logo: 'all', ratings: 'all', showFileNames: false, fileManagement: true, posterTitles: true, recentlyPlayed: true, watchIndicators: true, dailyPicks: 'all', hideSpoilers: false, autoNext: true, errorReports: true, sort: 'title' })
export function displayScopeAllows(mode: string, isMovie: boolean): boolean {
  return mode === 'all' || (mode === 'movie' && isMovie) || (mode === 'tv' && !isMovie)
}
function readGeneral() {
  for (const key of Object.keys(generalPreferences) as (keyof typeof generalPreferences)[]) {
    try { const value = JSON.parse(localStorage.getItem('general.' + key) || 'null')
      if (typeof value === typeof generalPreferences[key]) Object.assign(generalPreferences, { [key]: value })
    } catch { /* Ignore unavailable storage and malformed preferences. */ }
  }
}
if (typeof window !== 'undefined') { readGeneral(); window.addEventListener('storage', readGeneral); window.addEventListener('boxplayer:general-preferences', readGeneral) }
export function setGeneralPreference(key: keyof typeof generalPreferences, value: boolean | string) {
  localStorage.setItem('general.' + key, JSON.stringify(value)); readGeneral()
  window.dispatchEvent(new Event('boxplayer:general-preferences'))
}
