import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { IMusicTrack } from '../types/music'
import type { ILibrarySource } from '../types/librarySource'
import DB from '../utils/db'
import { loadMusicTrackList } from '../utils/musicPlayerStorage'
import { musicCatalogHints } from '../utils/musicCatalog'
import { mergeMusicEnrichment, mergeRescannedMusicTrack, recentlyAddedMusicTracks } from '../utils/musicTrackMerge'

const LS_AUTOSCAN = 'musicLibrary.autoScan'
const LS_LASTSCAN = 'musicLibrary.lastScanAt'
const LS_SUBTAB = 'musicLibrary.subTab'
const MUSIC_CACHE_PAGE_SIZE = 100

export type MusicSubTab = 'home' | 'all' | 'artists' | 'albums' | 'folders' | 'fav' | 'server'

const TRACK_NUM_PREFIX_RE = /^\s*(?:CD\s*\d+\s*[-_.]\s*)?\d+\s*[.\-_、)]\s*/i

function stripExt(name: string): string {
  if (!name) return ''
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(0, i) : name
}

function parseArtistTitle(file_name: string): { artist: string; title: string } {
  const { artist, title } = musicCatalogHints({ file_name } as IMusicTrack)
  return { artist, title }
}

function ensureArtistTitle(t: IMusicTrack): IMusicTrack {
  // 修复历史脏数据：artist 带轨道号前缀（如 "01. 周杰倫"）的重新解析
  const looksDirty = t.artist && TRACK_NUM_PREFIX_RE.test(t.artist)
  if (t.artist && t.title && !looksDirty) return t
  const { artist, title } = parseArtistTitle(t.file_name)
  if (!t.artist || looksDirty) t.artist = artist
  if (!t.title) t.title = title
  return t
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key)
    if (!s) return fallback
    const parsed = JSON.parse(s)
    return parsed === null || parsed === undefined ? fallback : parsed
  } catch {
    return fallback
  }
}

function saveJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const useMusicLibraryStore = defineStore('musiclibrary', () => {
  const tracks = ref<IMusicTrack[]>([])
  const trackPositions = new Map<string, number>()
  const loaded = ref(false)
  const sources = ref<ILibrarySource[]>([])
  const isScanning = ref(false)
  const scanLabel = ref('')
  const scanScanned = ref(0)
  const scanFound = ref(0)
  const scanError = ref('')
  const lastScanAt = ref<number>(loadJson<number>(LS_LASTSCAN, 0))
  const autoScanEnabled = ref<boolean>(loadJson<boolean>(LS_AUTOSCAN, true))
  const randomSeed = ref<number>(Date.now())
  const subTab = ref<MusicSubTab>(loadJson<MusicSubTab>(LS_SUBTAB, 'home'))
  const totalTrackCount = ref(0)
  const loadedTrackCount = ref(0)
  const isLoadingPage = ref(false)
  const activeQuery = ref('')

  const totalCount = computed(() => totalTrackCount.value)
  const hasMoreTracks = computed(() => loadedTrackCount.value < totalTrackCount.value)

  const rebuildTrackPositions = () => {
    trackPositions.clear()
    tracks.value.forEach((track, index) => trackPositions.set(track.id, index))
  }

  const recentlyAdded = computed<IMusicTrack[]>(() => {
    return recentlyAddedMusicTracks(tracks.value, 30)
  })

  const randomPicks = computed<IMusicTrack[]>(() => {
    const arr = tracks.value
    if (!arr.length) return []
    const rand = mulberry32(randomSeed.value)
    const indices = arr.map((_, i) => i)
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[indices[i], indices[j]] = [indices[j], indices[i]]
    }
    return indices.slice(0, 24).map((i) => arr[i])
  })

  const byArtist = computed(() => {
    const map = new Map<string, IMusicTrack[]>()
    for (const t of tracks.value) {
      const key = (t.artist || '').trim() || '未知艺人'
      const arr = map.get(key)
      if (arr) arr.push(t)
      else map.set(key, [t])
    }
    return Array.from(map.entries())
      .map(([artist, items]) => ({ artist, items, count: items.length }))
      .sort((a, b) => b.count - a.count)
  })

  const byAlbum = computed(() => {
    const map = new Map<string, IMusicTrack[]>()
    for (const t of tracks.value) {
      const key = (t.album || '').trim() || '未知专辑'
      const arr = map.get(key)
      if (arr) arr.push(t)
      else map.set(key, [t])
    }
    return Array.from(map.entries())
      .map(([album, items]) => ({ album, items, count: items.length }))
      .sort((a, b) => b.count - a.count)
  })

  const byFolder = computed(() => {
    const sourceItems = sources.value.map((source) => {
      const items = tracks.value.filter(track => (track.source_ids || (track.source_id ? [track.source_id] : [])).includes(source.id))
      return {
        key: source.id,
        source_id: source.id,
        path: source.path || source.name,
        name: source.name,
        user_id: source.user_id,
        drive_id: source.drive_id,
        folder_id: source.folder_id,
        items,
        count: source.item_count ?? items.length,
        scanned_at: source.scanned_at
      }
    })
    const map = new Map<string, IMusicTrack[]>()
    for (const t of tracks.value.filter(track => !(track.source_ids?.length || track.source_id))) {
      const path = (t.parent_path || t.parent_file_id || '').trim() || '未分组'
      const key = `${t.user_id || ''}|${t.drive_id || ''}|${path}`
      const arr = map.get(key)
      if (arr) arr.push(t)
      else map.set(key, [t])
    }
    const legacyItems = Array.from(map.values())
      .map((items) => {
        const first = items[0]
        const path = (first.parent_path || first.parent_file_id || '').trim() || '未分组'
        const key = `${first.user_id || ''}|${first.drive_id || ''}|${path}`
        return {
          key,
          source_id: undefined,
          path,
          name: path.split('/').pop() || path,
          user_id: first.user_id || '',
          drive_id: first.drive_id || '',
          folder_id: first.parent_file_id || '',
          items,
          count: items.length,
          scanned_at: items.reduce((m, t) => Math.max(m, t.scanned_at || 0), 0)
        }
      })
      .sort((a, b) => b.scanned_at - a.scanned_at)
    return [...sourceItems, ...legacyItems].sort((a, b) => b.scanned_at - a.scanned_at)
  })

  const favoritesTracks = computed<IMusicTrack[]>(() => {
    try {
      const favs: any[] = loadMusicTrackList('pm.favs', { legacyKeys: ['pageMusic.favorites'] })
      const ids = new Set<string>(favs.map((f) => `${f.user_id || ''}|${f.drive_id || ''}|${f.file_id || ''}`))
      const found = tracks.value.filter((t) => ids.has(t.id))
      // 已收藏但不在库里的（可能是其它来源），用 favs 自身合成
      const present = new Set(found.map((t) => t.id))
      const synthetic: IMusicTrack[] = []
      for (const f of favs) {
        const id = `${f.user_id || ''}|${f.drive_id || ''}|${f.file_id || ''}`
        if (!present.has(id)) {
          synthetic.push(ensureArtistTitle({
            id,
            user_id: f.user_id || '',
            drive_id: f.drive_id || '',
            file_id: f.file_id || '',
            parent_file_id: f.parent_file_id || '',
            file_name: f.file_name || '',
            ext: f.ext || '',
            size: f.size || 0,
            category: f.category || 'audio',
            thumbnail: f.thumbnail || '',
            description: f.description || '',
            encType: f.encType || '',
            scanned_at: 0
          }))
        }
      }
      return [...found, ...synthetic]
    } catch {
      return []
    }
  })

  async function loadFromDB() {
    if (loaded.value) return
    try {
      const [list, count, sourceList] = await Promise.all([DB.getMusicTrackPage({ limit: MUSIC_CACHE_PAGE_SIZE }), DB.countMusicTracks(), DB.getLibrarySources('music')])
      const dirtyToFix: IMusicTrack[] = []
      const fixed = list.map((raw) => {
        const before = { artist: raw.artist, title: raw.title }
        const t = ensureArtistTitle(raw)
        if (t.artist !== before.artist || t.title !== before.title) {
          // 文本修正过 → 之前 enrich 的结果基于脏字段，清掉重跑
          t.enriched_at = undefined
          if (!t.cover_url) {
            // 没有封面的也清，让 enrich 用新 artist/title 重试
          }
          dirtyToFix.push(t)
        }
        return t
      })
      tracks.value = fixed
      rebuildTrackPositions()
      totalTrackCount.value = count
      loadedTrackCount.value = fixed.length
      loaded.value = true
      sources.value = sourceList
      if (dirtyToFix.length) {
        DB.saveMusicTracks(dirtyToFix).catch(() => {})
      }
    } catch (e) {
      console.warn('musicLibrary loadFromDB failed', e)
    }
  }

  async function loadTrackPage(options: { reset?: boolean; query?: string } = {}) {
    const reset = options.reset === true
    const query = options.query ?? activeQuery.value
    if (isLoadingPage.value) return false
    isLoadingPage.value = true
    try {
      const offset = reset ? 0 : loadedTrackCount.value
      const [page, count] = await Promise.all([
        DB.getMusicTrackPage({ offset, limit: MUSIC_CACHE_PAGE_SIZE, query }),
        DB.countMusicTracks(query)
      ])
      const fixed = page.map(ensureArtistTitle)
      activeQuery.value = query
      totalTrackCount.value = count
      tracks.value = reset ? fixed : [...tracks.value, ...fixed]
      loadedTrackCount.value = tracks.value.length
      rebuildTrackPositions()
      return true
    } finally {
      isLoadingPage.value = false
    }
  }

  async function loadAllTracks() {
    if (activeQuery.value) {
      const reset = await loadTrackPage({ reset: true, query: '' })
      if (!reset) return
    }
    while (hasMoreTracks.value && await loadTrackPage({ query: '' })) {}
  }

  async function getEnrichmentCandidates(limit: number, now: number, excludedIds: Set<string> = new Set()) {
    const staleBefore = now - 24 * 60 * 60 * 1000
    return (await DB.getMusicEnrichmentCandidates(limit, staleBefore, excludedIds)).map(ensureArtistTitle)
  }

  function setScanProgress(label: string, scanned: number, found: number) {
    scanLabel.value = label
    scanScanned.value = scanned
    scanFound.value = found
  }

  async function appendTracks(newTracks: IMusicTrack[]) {
    if (!newTracks.length) return
    const existingById = new Map((await DB.getMusicTracksByIds(newTracks.map(track => track.id))).map(track => [track.id, track]))
    const enriched = newTracks.map(ensureArtistTitle).map((track) => {
      const existing = existingById.get(track.id)
      if (!existing) return track
      return mergeRescannedMusicTrack(existing, track)
    })
    await DB.saveMusicTracks(enriched)
    for (const track of enriched) {
      const index = trackPositions.get(track.id)
      if (index === undefined) {
        if (tracks.value.length < MUSIC_CACHE_PAGE_SIZE) {
          trackPositions.set(track.id, tracks.value.length)
          tracks.value.push(track)
          loadedTrackCount.value = tracks.value.length
        }
        if (!existingById.has(track.id)) totalTrackCount.value += 1
      } else {
        tracks.value[index] = track
      }
    }
  }

  function removeTracksByIds(ids: string[]) {
    if (!ids || ids.length === 0) return
    const removeSet = new Set(ids)
    tracks.value = tracks.value.filter((t) => !removeSet.has(t.id))
    totalTrackCount.value = Math.max(0, totalTrackCount.value - ids.length)
    loadedTrackCount.value = tracks.value.length
    rebuildTrackPositions()
  }

  async function deleteTracksByIds(ids: string[]) {
    if (!ids || ids.length === 0) return 0
    const deleted = await DB.deleteMusicTracksByIds(ids).catch(() => 0)
    removeTracksByIds(ids)
    return deleted || ids.length
  }

  async function saveSource(source: ILibrarySource) {
    const index = sources.value.findIndex(item => item.id === source.id)
    const nextSource = index >= 0 ? { ...source, created_at: sources.value[index].created_at } : source
    await DB.saveLibrarySource(nextSource)
    if (index >= 0) sources.value[index] = nextSource
    else sources.value.push(nextSource)
  }

  async function deleteSource(sourceId: string) {
    const deleted = await DB.deleteMusicLibrarySource(sourceId)
    sources.value = sources.value.filter(source => source.id !== sourceId)
    tracks.value = tracks.value.flatMap((track) => {
      const sourceIds = (track.source_ids || (track.source_id ? [track.source_id] : [])).filter(id => id !== sourceId)
      return sourceIds.length ? [{ ...track, source_ids: sourceIds, source_id: sourceIds[0] }] : []
    })
    totalTrackCount.value = Math.max(0, totalTrackCount.value - deleted)
    loadedTrackCount.value = tracks.value.length
    rebuildTrackPositions()
    return deleted
  }

  async function reconcileSource(sourceId: string, seenIds: string[]) {
    const removed = await DB.reconcileMusicLibrarySource(sourceId, seenIds)
    const seen = new Set(seenIds)
    tracks.value = tracks.value.flatMap((track) => {
      const sourceIds = track.source_ids || (track.source_id ? [track.source_id] : [])
      if (!sourceIds.includes(sourceId) || seen.has(track.id)) return [track]
      const next = sourceIds.filter(id => id !== sourceId)
      return next.length ? [{ ...track, source_ids: next, source_id: next[0] }] : []
    })
    totalTrackCount.value = Math.max(0, totalTrackCount.value - removed)
    loadedTrackCount.value = tracks.value.length
    rebuildTrackPositions()
    return removed
  }

  async function updateTrackEnrichment(id: string, patch: Partial<IMusicTrack>) {
    const idx = tracks.value.findIndex((t) => t.id === id)
    const existing = idx >= 0 ? tracks.value[idx] : await DB.getMusicTrackById(id)
    if (!existing) return false
    const merged = mergeMusicEnrichment(existing, patch)
    await DB.saveMusicTracks([merged])
    if (idx >= 0) {
      tracks.value = [
        ...tracks.value.slice(0, idx),
        merged,
        ...tracks.value.slice(idx + 1)
      ]
    }
    return true
  }

  function setIsScanning(v: boolean, errMsg = '') {
    isScanning.value = v
    if (!v) {
      scanLabel.value = ''
      scanScanned.value = 0
      scanFound.value = 0
    }
    scanError.value = errMsg
  }

  function markScanFinished() {
    lastScanAt.value = Date.now()
    saveJson(LS_LASTSCAN, lastScanAt.value)
  }

  function rerollRandom() {
    randomSeed.value = Date.now()
  }

  function setAutoScan(v: boolean) {
    autoScanEnabled.value = v
    saveJson(LS_AUTOSCAN, v)
  }

  function setSubTab(t: MusicSubTab) {
    subTab.value = t
    saveJson(LS_SUBTAB, t)
  }

  async function clearAll() {
    await DB.clearMusicTracks().catch(() => {})
    tracks.value = []
    trackPositions.clear()
    totalTrackCount.value = 0
    loadedTrackCount.value = 0
    lastScanAt.value = 0
    saveJson(LS_LASTSCAN, 0)
  }

  return {
    tracks,
    sources,
    loaded,
    isScanning,
    scanLabel,
    scanScanned,
    scanFound,
    scanError,
    lastScanAt,
    autoScanEnabled,
    randomSeed,
    subTab,
    totalCount,
    loadedTrackCount,
    hasMoreTracks,
    isLoadingPage,
    recentlyAdded,
    randomPicks,
    byArtist,
    byAlbum,
    byFolder,
    favoritesTracks,
    loadFromDB,
    loadTrackPage,
    loadAllTracks,
    getEnrichmentCandidates,
    setScanProgress,
    appendTracks,
    removeTracksByIds,
    deleteTracksByIds,
    saveSource,
    deleteSource,
    reconcileSource,
    updateTrackEnrichment,
    setIsScanning,
    markScanFinished,
    rerollRandom,
    setAutoScan,
    setSubTab,
    clearAll
  }
})

export default useMusicLibraryStore
export { parseArtistTitle, ensureArtistTitle, stripExt }
