import { validServerCover } from './cover'
import type { BrowseRoute } from './workspace'
export interface Favorite { key: string; title: string; route: BrowseRoute; hiddenOnHome?: boolean; cover?: string; content?: boolean }
export interface ServerPreferences { version: 1; favorites: Favorite[]; home: string[]; layout: 'grid' | 'list'; portrait: boolean; libraryMode?:boolean }
export const preferenceKey = (accountId: string) => `boxplayer:server-workspace:v1:${encodeURIComponent(accountId)}`
export const routeKey = (route: BrowseRoute) => JSON.stringify([route.kind, route.id || '', route.category || '', route.favoriteType || '', route.facet || '', route.value || ''])
export function readPreferences(accountId: string, storage: Pick<Storage, 'getItem'> = localStorage): ServerPreferences {
  const defaults: ServerPreferences = { version: 1, favorites: [], home: ['resume', 'nextup', 'latest'], layout: 'grid', portrait: true }
  try {
    const value = JSON.parse(storage.getItem(preferenceKey(accountId)) || 'null')
    if (value?.version !== 1) return defaults
    return { version: 1, libraryMode:value.libraryMode!==false, favorites: Array.isArray(value.favorites) ? value.favorites.filter((f: any) => typeof f.key === 'string' && typeof f.title === 'string' && ['category', 'children'].includes(f.route?.kind)).map((f: Favorite) => ({ ...f, cover: typeof f.cover === 'string' && validServerCover(f.cover) ? f.cover : undefined })) : [], home: Array.isArray(value.home) ? value.home.filter((key: unknown) => typeof key === 'string') : defaults.home, layout: value.layout === 'list' ? 'list' : 'grid', portrait: value.portrait !== false }
  } catch { return defaults }
}
export function writePreferences(accountId: string, preferences: ServerPreferences, storage: Pick<Storage, 'setItem'> = localStorage) { if (preferences.favorites.some(f => f.cover !== undefined && (typeof f.cover !== 'string' || !validServerCover(f.cover)))) throw new Error('封面必须是本地 PNG/JPEG/WebP 图片或无凭据的服务器相对路径'); storage.setItem(preferenceKey(accountId), JSON.stringify(preferences)) }
export function putFavorite(preferences: ServerPreferences, route: BrowseRoute, title: string, content = false): ServerPreferences {
  title = title.trim(); if (!title) throw new Error('请输入收藏夹名称')
  const key = routeKey(route), existing = preferences.favorites.find(f => f.key === key)
  return { ...preferences, favorites: [...preferences.favorites.filter(f => f.key !== key), { ...existing, key, title, route: { ...route }, content }] }
}
