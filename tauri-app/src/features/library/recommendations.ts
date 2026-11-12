import type { VideoItem as MediaLibraryItem } from './catalog'
export interface TmdbRankedEntry { id: number; type: 'movie' | 'tv' }
export function matchLibraryRanking(items: MediaLibraryItem[], ranking: TmdbRankedEntry[]): MediaLibraryItem[] {
  const ranks = new Map(ranking.map((entry, index) => [entry.type + ':' + entry.id, index]))
  const matched = items.flatMap(item => {
    if (item.type !== 'movie' && item.type !== 'tv') return []
    const ids = item.collectionMovies?.length ? item.collectionMovies.map(movie => movie.tmdbId) : [item.tmdbId]
    const positions = ids.flatMap(id => id && ranks.has(item.type + ':' + id) ? [ranks.get(item.type + ':' + id)!] : [])
    return positions.length ? [{ item, rank: Math.min(...positions) }] : []
  }).sort((a, b) => a.rank - b.rank)
  const seen = new Set<string>()
  return matched.flatMap(({item}) => { if (seen.has(item.id)) return []; seen.add(item.id); return [item] })
}

export function matchDailyLibraryRanking(items: MediaLibraryItem[], ranking: TmdbRankedEntry[], now = new Date()): MediaLibraryItem[] {
  const matched = matchLibraryRanking(items, ranking)
  const seen = new Set(matched.map(item => item.id))
  const local = items.filter(item => (item.type === 'movie' || item.type === 'tv') && Number(item.tmdbId) > 0)
    .sort((a, b) => `${a.type}:${a.tmdbId}:${a.id}`.localeCompare(`${b.type}:${b.tmdbId}:${b.id}`))
  if (!local.length || matched.length >= 24) return matched.slice(0, 24)
  const day = Math.floor(now.getTime() / 86_400_000)
  const result = [...matched]
  for (let index = 0; index < local.length && result.length < 24; index++) {
    const item = local[(day + index) % local.length]
    if (!seen.has(item.id)) { seen.add(item.id); result.push(item) }
  }
  return result
}
export async function fetchRankingPages(base: string, endpoint: string, type: 'movie' | 'tv', request: (url: string) => Promise<Response>, maxPages = 5): Promise<TmdbRankedEntry[]> {
  const results: TmdbRankedEntry[] = []
  const seen = new Set<number>()
  for (let page = 1; page <= maxPages; page++) {
    const response = await request(base + endpoint + '?language=zh-CN&page=' + page)
    if (!response.ok) throw new Error('TMDB ranking HTTP ' + response.status)
    const payload = await response.json()
    const data = payload?.data?.results ? payload.data : payload
    if (!Array.isArray(data?.results)) throw new Error('Invalid TMDB ranking response')
    for (const entry of data.results) { const id = Number(entry.id); if (Number.isSafeInteger(id) && id > 0 && !seen.has(id)) { seen.add(id); results.push({id, type}) } }
    if (!data.results.length || page >= Number(data.total_pages || 1)) break
  }
  return results
}
