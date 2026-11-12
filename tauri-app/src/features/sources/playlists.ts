// Adapted from Electron media-server/playlists.ts; all requests bind the owning account.
import type { Account, SourceEntry } from './contracts'
import { endpoint, json, request } from './transport'
export interface ServerPlaylist { id: string; title: string; count: number }
type Item = Record<string, unknown>
const segment = encodeURIComponent
const query = (values: Record<string, string>) => new URLSearchParams(values).toString()
export function mediaServerAccount(account: Account) {
  if (!['jellyfin', 'emby', 'plex'].includes(account.providerId)) throw new Error('此来源不是媒体服务器')
  if (account.providerId !== 'plex' && !account.userId) throw new Error('服务器账号缺少用户标识，请重新登录')
}
export function serverItemId(value: string) { const id = value.startsWith('playlist:') ? value.slice(9) : value;if (!id.trim()) throw new Error('服务器媒体标识不能为空');return id }
async function allItems(account: Account, path: string, params: Record<string, string> = {}) {
  mediaServerAccount(account)
  const plex = account.providerId === 'plex';const result: Item[] = [];let offset = 0;let previous = ''
  for (let page = 0; page < 100; page++) {
    const data = await json<Record<string, unknown>>(account, 'GET', endpoint(account, `${path}?${query({ ...params, [plex ? 'X-Plex-Container-Start' : 'StartIndex']: String(offset), [plex ? 'X-Plex-Container-Size' : 'Limit']: '100' })}`))
    const container = (plex ? data.MediaContainer : data) as Record<string, unknown> | undefined
    if (!container || typeof container !== 'object' || !plex && !Array.isArray(container.Items)) throw new Error('服务器播放列表响应无效')
    const rows = container[plex ? 'Metadata' : 'Items'] ?? []
    if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object')) throw new Error('服务器播放列表响应无效')
    const marker = JSON.stringify(rows.map(row => [row.Id ?? row.ratingKey, row.PlaylistItemId ?? row.playlistItemID]))
    if (rows.length && marker === previous) throw new Error('服务器未推进播放列表分页')
    previous = marker;result.push(...rows);offset += rows.length
    const total = container?.[plex ? 'totalSize' : 'TotalRecordCount']
    if (!rows.length || (typeof total === 'number' ? offset >= total : rows.length < 100)) return result
  }
  throw new Error('服务器播放列表过多，请缩小范围后重试')
}
export async function listServerPlaylists(account: Account): Promise<ServerPlaylist[]> {
  const plex = account.providerId === 'plex'
  const rows = await allItems(account, plex ? 'playlists' : `Users/${segment(account.userId || '')}/Items`, plex ? { playlistType: 'video', smart: '0' } : { IncludeItemTypes: 'Playlist', Recursive: 'true', Fields: 'ChildCount' })
  return rows.filter(row => row[plex ? 'ratingKey' : 'Id'] != null).map(row => ({ id: String(row[plex ? 'ratingKey' : 'Id']), title: String(row[plex ? 'title' : 'Name'] || ''), count: Number(row[plex ? 'leafCount' : 'ChildCount'] || 0) }))
}
function entries(account: Account, playlistId: string) { const id = segment(serverItemId(playlistId));return allItems(account, account.providerId === 'plex' ? `playlists/${id}/items` : `Playlists/${id}/Items`, account.providerId === 'plex' ? {} : { UserId: account.userId || '' }) }
export async function serverPlaylistMembership(account: Account, playlistId: string, itemId: string) { const id = serverItemId(itemId);return (await entries(account, playlistId)).some(row => String(row[account.providerId === 'plex' ? 'ratingKey' : 'Id']) === id) }
async function plexURI(account: Account, itemId: string) {
  const data = await json<{ MediaContainer?: { machineIdentifier?: string } }>(account, 'GET', endpoint(account, ''))
  const machine = data.MediaContainer?.machineIdentifier;if (!machine) throw new Error('Plex 未返回服务器标识')
  return `server://${machine}/com.plexapp.plugins.library/library/metadata/${itemId}`
}
export async function createServerPlaylist(account: Account, title: string, itemId: string) {
  mediaServerAccount(account);title = title.trim();const id = serverItemId(itemId);if (!title) throw new Error('请输入播放列表名称')
  if (account.providerId === 'plex') await request(account, 'POST', endpoint(account, `playlists?${query({ title, type: 'video', smart: '0', uri: await plexURI(account, id) })}`))
  else if (account.providerId === 'emby') await request(account, 'POST', endpoint(account, `Playlists?${query({ Name: title, UserId: account.userId || '', Ids: id, MediaType: 'Video' })}`))
  else await request(account, 'POST', endpoint(account, 'Playlists'), JSON.stringify({ Name: title, UserId: account.userId, Ids: [id], MediaType: 'Video', IsPublic: false }), { 'Content-Type': 'application/json' })
}
export async function deleteServerPlaylist(account: Account, playlistId: string) { mediaServerAccount(account);const id = segment(serverItemId(playlistId));await request(account, 'DELETE', endpoint(account, account.providerId === 'plex' ? `playlists/${id}` : `Items/${id}`)) }
export async function setServerPlaylistMembership(account: Account, playlistId: string, itemId: string, selected: boolean) {
  mediaServerAccount(account);const id = serverItemId(itemId);const playlist = segment(serverItemId(playlistId));const plex = account.providerId === 'plex'
  const matches = (await entries(account, playlistId)).filter(row => String(row[plex ? 'ratingKey' : 'Id']) === id)
  if (selected) {
    if (matches.length) return
    const params: Record<string, string> = plex ? { uri: await plexURI(account, id) } : { Ids: id, UserId: account.userId || '' }
    await request(account, plex ? 'PUT' : 'POST', endpoint(account, `${plex ? `playlists/${playlist}/items` : `Playlists/${playlist}/Items`}?${query(params)}`))
  } else {
    const entryIds = matches.map(row => row[plex ? 'playlistItemID' : 'PlaylistItemId'])
    if (entryIds.some(id => id == null)) throw new Error('服务器未返回播放列表条目 ID，无法移除')
    if (!entryIds.length) return
    if (plex) for (const entryId of entryIds) await request(account, 'DELETE', endpoint(account, `playlists/${playlist}/items/${segment(String(entryId))}`))
    else await request(account, 'DELETE', endpoint(account, `Playlists/${playlist}/Items?${query({ EntryIds: entryIds.join(',') })}`))
  }
}
export async function deleteServerMedia(account: Account, entry: SourceEntry) { mediaServerAccount(account);const id = segment(serverItemId(entry.id));await request(account, 'DELETE', endpoint(account, account.providerId === 'plex' ? `library/metadata/${id}` : `Items/${id}`)) }
