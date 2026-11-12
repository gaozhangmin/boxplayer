import type { MediaLibraryItem } from '../types/media'
export function libraryObjectCover(route: string, items: MediaLibraryItem[]): string | undefined {
 const candidates = items.filter(item => item.backdropUrl || item.posterUrl)
 if (!candidates.length) return undefined
 const index = Number(localStorage.getItem('library-cover:' + route) || 0) % candidates.length
 const item = candidates[index]; return item.backdropUrl || item.posterUrl
}
