import { ref } from 'vue'
import type { MediaServerConfig } from '../types/mediaServer'
import type { MediaServerCardItem } from '../types/mediaServerContent'

interface FolderFavorite { userId: string; item: MediaServerCardItem }
const storageKey = 'boxplayer:server-folder-favorites'
function read(): FolderFavorite[] {
  try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value.filter(entry => entry && typeof entry.userId === 'string' && entry.item && typeof entry.item.serverId === 'string' && typeof entry.item.id === 'string') : [] }
  catch { return [] }
}
export const serverFolderFavorites = ref<FolderFavorite[]>(read())
export function serverFolderFavoriteKey(item: MediaServerCardItem) {
  return 'server-folder:' + encodeURIComponent(item.serverId) + ':' + encodeURIComponent(item.id)
}
export function rememberServerFolderFavorite(config: MediaServerConfig, item: MediaServerCardItem, favorite: boolean) {
  item = { ...item, serverId: config.id }
  const key = serverFolderFavoriteKey(item)
  const values = serverFolderFavorites.value.filter(entry => entry.userId !== (config.userId || '') || serverFolderFavoriteKey(entry.item) !== key)
  if (favorite && (item.kind === 'folder' || item.kind === 'series' || item.kind === 'season' || ['boxset', 'playlist'].includes((item.rawType || '').toLowerCase())))
    values.push({ userId: config.userId || '', item: { ...item, serverId: config.id, isFavorite: true } })
  serverFolderFavorites.value = values
  localStorage.setItem(storageKey, JSON.stringify(values))
}

if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === storageKey) serverFolderFavorites.value = read()
})
