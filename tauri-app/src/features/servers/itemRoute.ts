import type { BrowseRoute, ServerItem } from './workspace'

const detailKinds = new Set(['series', 'show', 'season', 'episode', 'movie', 'video', 'clip', 'musicvideo'])

export function serverItemRoute(item: ServerItem, libraryId?: string): BrowseRoute {
  if (item.kind === 'person') return { kind: 'person', personId: item.id, title: item.name, libraryId }
  if (detailKinds.has(item.kind)) return { kind: 'detail', id: item.id, title: item.name, libraryId }
  return serverContainerRoute(item, libraryId)
}

export function serverContainerRoute(item: ServerItem, libraryId?: string): BrowseRoute {
  const target = { id: item.id, title: item.name, libraryId }
  if (item.libraryType) {
    const music = ['music', 'artist'].includes(item.libraryType.toLowerCase())
    return { ...target, kind: 'category', category: music ? 'music' : 'all', libraryId: item.id }
  }
  return { ...target, kind: 'children' }
}
