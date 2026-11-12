import { serverIdentity } from './identity'
import type { Account, SourceEntry } from '../sources/contracts'
import { endpoint, json, request } from '../sources/transport'
import { mediaServerAccount, serverItemId } from '../sources/playlists'

export interface MediaInfoCard {id:string;kind:string;title:string;rows:{label:string;value:string}[];selected?:boolean}
export interface ServerVersion {id:string;title:string;filePath?:string;fileLabel?:string;mediaInfoCards:MediaInfoCard[]}
function mediaVersions(row:Record<string,any>,plex:boolean):ServerVersion[]{return (plex?row.Media||[]:row.MediaSources||[]).map((source:any,index:number)=>{const path=plex?source.Part?.[0]?.file:source.Path;return {id:String(plex?source.id??index:source.Id),title:source.Name||[source.videoResolution?source.videoResolution+'p':'',source.Container||source.container,source.videoCodec].filter(Boolean).join(' · ')||'版本 '+(index+1),filePath:path,fileLabel:path?.split(/[\\/]/).at(-1),mediaInfoCards:(plex?source.Part?.[0]?.Stream||[]:source.MediaStreams||[]).map((stream:any,i:number)=>({id:String(stream.Id||stream.id||stream.Index||i),kind:plex?stream.streamType===1?'video':stream.streamType===2?'audio':'subtitle':String(stream.Type).toLowerCase(),title:stream.DisplayTitle||stream.displayTitle||stream.Codec||stream.codec||'媒体轨道',rows:[['编码',stream.Codec||stream.codec],['分辨率',stream.Width||stream.width?`${stream.Width||stream.width} × ${stream.Height||stream.height}`:''],['语言',stream.Language||stream.language],['声道',stream.Channels||stream.channels],['码率',stream.BitRate||stream.bitrate]].filter((row:any)=>row[1]!=null&&row[1]!=='').map((row:any)=>({label:row[0],value:String(row[1])}))}))}})}
export interface ServerItem extends SourceEntry {
  externalLinks?:{title:string;url:string}[];
  birthday?:string;birthPlace?:string;deathDate?:string;
  versions?:ServerVersion[];criticRating?:number;
  backdropPath?:string;logoPath?:string;duration?:number;progress?:number;height?:number;childCount?:number;
  tmdbId?: number; imdbId?: string; parentId?: string; libraryType?: string; people?: ServerPerson[]; kind: string; overview: string; year?: string; rating?: number; watched: boolean; imagePath?: string
  genres: string[]; studios: string[]; season?: number; episode?: number; sortValues?: Partial<Record<keyof typeof sortFields, string | number>>
}
export interface ServerPerson { id: string; name: string; role?: string; imagePath?: string }
export type Category = 'all' | 'movies' | 'shows' | 'collections' | 'playlists' | 'resume' | 'nextup' | 'latest' | 'favorites'
export interface BrowseRoute { kind: 'home' | 'root' | 'category' | 'children' | 'detail' | 'search' | 'person'; title: string; id?: string; category?: Category; query?: string; favoriteType?: string; facet?: 'genre' | 'studio' | 'year' | 'certification' | 'rating' | 'network'; value?: string; personId?: string; libraryId?: string }
export const categories: { id: Category; title: string }[] = [
  { id: 'all', title: '所有视频' }, { id: 'movies', title: '电影' }, { id: 'shows', title: '电视剧' },
  { id: 'collections', title: '合集' }, { id: 'playlists', title: '播放列表' },
  { id: 'resume', title: '继续观看' }, { id: 'nextup', title: '接下来观看' }, { id: 'latest', title: '最近添加' }
]
export const favoriteTypes = ['Series', 'Episode', 'Movie', 'Video', 'BoxSet', 'Playlist', 'Person']
export const sortFields = {
 premiereDate: ['首映日期', 'PremiereDate', 'originallyAvailableAt'], title: ['名称', 'Name', 'titleSort'], createdAt: ['创建日期', 'DateCreated', 'addedAt'],
 rating: ['社区评分', 'CommunityRating', 'rating'], criticRating: ['评论家评分', 'CriticRating', 'audienceRating'], runtimeMinutes: ['时长', 'Runtime', 'duration'],
 year: ['制作年份', 'ProductionYear', 'year'], playCount: ['播放次数', 'PlayCount', 'viewCount'], sortName: ['排序名称', 'SortName', 'titleSort'],
 addedAt: ['添加日期', 'DateCreated', 'addedAt'], random: ['随机', 'SortName', 'titleSort'], videoBitrate: ['视频码率', 'VideoBitRate', 'titleSort'],
 airTime: ['播出时间', 'AirTime', 'titleSort'], studio: ['工作室', 'Studio', 'studio.titleSort'], artist: ['艺术家', 'Artist', 'titleSort'],
 officialRating: ['搜索评分', 'OfficialRating', 'contentRating'], seriesTitle: ['系列名称', 'SeriesSortName', 'titleSort'],
 seriesDatePlayed: ['系列观看日期', 'SeriesDatePlayed', 'lastViewedAt'], airOrder: ['播出顺序', 'AiredEpisodeOrder', 'titleSort']
} as const
export function randomRank(id: string, seed: number) { let hash = seed | 0; for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619); hash ^= hash >>> 16; hash = Math.imul(hash, 0x45d9f3b); return (hash ^ hash >>> 16) >>> 0 }

export interface BrowseOptions { offset?: number; limit?: number; sort?: keyof typeof sortFields; descending?: boolean; type?: string; genre?: string; studio?: string; year?: string; certification?: string; watched?: string; minRating?: string; maxRating?: string }
const enc = encodeURIComponent
const videoKinds = new Set(['movie', 'series', 'show', 'season', 'episode', 'video', 'clip', 'musicvideo', 'boxset', 'collection', 'playlist', 'person', 'folder', 'collectionfolder', 'userview'])
export function normalizeItem(row: Record<string, any>, plex: boolean, root = false): ServerItem {
  const kind = root ? 'folder' : String(plex ? row.type || '' : row.Type || '').toLowerCase()
  const rawId = String(plex ? row.ratingKey ?? row.key : row.Id)
  const id = root && plex ? `section:${rawId}` : kind === 'playlist' ? `playlist:${rawId}` : rawId
  return { id, ...serverIdentity(row, plex), parentId: plex ? row.parentRatingKey : row.ParentId || row.SeasonId, libraryType: root ? String(plex ? row.type : row.CollectionType || '') : undefined, people: (plex ? [...(row.Role || []), ...(row.Director || []), ...(row.Writer || [])] : row.People || []).filter((p: any) => plex ? p.id != null || p.key : p.Id).map((p: any) => ({ id: String(plex ? p.id ?? p.key : p.Id), name: String(plex ? p.tag : p.Name), role: plex ? p.role : p.Role || p.Type, imagePath: plex ? p.thumb : p.PrimaryImageTag ? `Items/${enc(p.Id)}/Images/Primary?maxWidth=180&tag=${enc(p.PrimaryImageTag)}` : undefined })), name: String(plex ? row.title : row.Name), kind, serverType: kind, size: Number(plex?row.Media?.[0]?.Part?.[0]?.size||0:row.MediaSources?.[0]?.Size||row.Size||0),
    isDirectory: root || ['show', 'series', 'season', 'folder', 'collectionfolder', 'userview', 'boxset', 'collection', 'playlist'].includes(kind),
    playable: ['movie', 'episode', 'video', 'clip', 'musicvideo'].includes(kind),
    overview: String((plex ? row.summary : row.Overview) || ''), year: String((plex ? row.year : row.ProductionYear) || '') || undefined,
    rating: plex ? row.rating : row.CommunityRating, watched: plex ? Number(row.viewCount || 0) > 0 : !!row.UserData?.Played,
    favorite: plex ? Number(row.userRating || 0) >= 9 : !!row.UserData?.IsFavorite,
    imagePath: plex ? row.thumb : row.ImageTags?.Primary ? `Items/${enc(rawId)}/Images/Primary?maxWidth=400&tag=${enc(row.ImageTags.Primary)}` : undefined,
    externalLinks:((row.ExternalUrls||[]).map((link:any)=>({title:link.Name||'外部链接',url:link.Url})).filter((link:any)=>{try{const url=new URL(link.url);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password}catch{return false}})),
    birthday:row.PremiereDate?.slice(0,10),birthPlace:row.ProductionLocations?.[0],deathDate:row.EndDate?.slice(0,10),
    versions:mediaVersions(row,plex),criticRating:plex?row.audienceRating:row.CriticRating,
    backdropPath:plex?row.art:row.BackdropImageTags?.[0]?`Items/${enc(rawId)}/Images/Backdrop?maxWidth=1920&tag=${enc(row.BackdropImageTags[0])}`:undefined,
    logoPath:!plex&&row.ImageTags?.Logo?`Items/${enc(rawId)}/Images/Logo?tag=${enc(row.ImageTags.Logo)}`:undefined,
    duration:plex?Number(row.duration||0)/1000:Number(row.RunTimeTicks||0)/10000000,
    progress:plex?(row.duration?Number(row.viewOffset||0)/row.duration*100:0):(row.RunTimeTicks?Number(row.UserData?.PlaybackPositionTicks||0)/row.RunTimeTicks*100:0),
    height:plex?row.Media?.[0]?.height:row.MediaSources?.[0]?.MediaStreams?.find((stream:any)=>stream.Type==='Video')?.Height,
    childCount:plex?row.leafCount:row.ChildCount,
    genres: plex ? (row.Genre || []).map((g: any) => g.tag) : row.Genres || [],
    studios: plex ? row.studio ? [row.studio] : [] : (row.Studios || []).map((s: any) => s.Name),
    season: plex ? row.parentIndex : row.ParentIndexNumber, episode: plex ? row.index : row.IndexNumber,
    sortValues: { title: plex ? row.title : row.Name, sortName: plex ? row.titleSort || row.title : row.SortName || row.Name,
      premiereDate: plex ? row.originallyAvailableAt : row.PremiereDate, createdAt: plex ? row.addedAt : row.DateCreated, addedAt: plex ? row.addedAt : row.DateCreated,
      rating: plex ? row.rating : row.CommunityRating, criticRating: plex ? row.audienceRating : row.CriticRating, runtimeMinutes: plex ? row.duration : row.RunTimeTicks,
      year: plex ? row.year : row.ProductionYear, playCount: plex ? row.viewCount : row.UserData?.PlayCount, videoBitrate: plex ? row.Media?.[0]?.bitrate : row.MediaSources?.[0]?.Bitrate,
      airTime: plex ? undefined : row.AirTime, studio: plex ? row.studio : row.Studios?.[0]?.Name, artist: plex ? row.Artist?.[0]?.tag : row.Artists?.[0],
      officialRating: plex ? row.contentRating : row.OfficialRating, seriesTitle: plex ? row.grandparentTitle || row.parentTitle : row.SeriesName,
      seriesDatePlayed: plex ? row.lastViewedAt : row.UserData?.LastPlayedDate,
      airOrder: plex ? row.parentIndex == null || row.index == null ? undefined : row.parentIndex * 100000 + row.index : row.ParentIndexNumber == null || row.IndexNumber == null ? undefined : row.ParentIndexNumber * 100000 + row.IndexNumber } }
}
export interface ServerPage { items: ServerItem[]; nextOffset?: number; total?: number }
export async function browseServer(account: Account, route: BrowseRoute, options: BrowseOptions = {}): Promise<ServerPage> {
  mediaServerAccount(account)
  const offset = options.offset ?? 0, limit = options.limit ?? 60
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('分页参数无效')
  options = { ...options, ...(route.value ? route.facet === 'genre' ? { genre: route.value } : ['studio', 'network'].includes(route.facet || '') ? { studio: route.value } : route.facet === 'year' ? { year: route.value } : route.facet === 'certification' ? { certification: route.value } : route.facet === 'rating' ? { minRating: route.value, maxRating: String(Number(route.value) + 0.999) } : {} : {}) }
  const plex = account.providerId === 'plex', root = route.kind === 'root', category = route.category
  // Plex has section-scoped catalogs. Merge video sections instead of guessing /library/all.
  if (plex && route.kind === 'category' && !route.id && !route.personId && !['playlists', 'resume', 'nextup', 'favorites'].includes(category || '')) {
    const roots = await browseServer(account, { kind: 'root', title: '' })
    const selected = roots.items.filter(item => category !== 'movies' && category !== 'shows' || item.libraryType === (category === 'movies' ? 'movie' : 'show'))
    const merged: ServerItem[] = []
    for (const library of selected) merged.push(...await allServerItems(account, { ...route, id: library.id }, options))
    const unique = [...new Map(merged.map(item => [item.id, item])).values()].sort((a,b) => compareItems(a,b,options.sort || (category === 'latest' ? 'addedAt' : 'sortName'),options.descending ?? category === 'latest'))
    return { items: unique.slice(offset, offset + limit), total: unique.length, nextOffset: offset + limit < unique.length ? offset + limit : undefined }
  }
  const sort = sortFields[options.sort || (category === 'latest' ? 'addedAt' : 'sortName')]
  const descending = options.descending ?? category === 'latest'
  const q = new URLSearchParams(plex ? { 'X-Plex-Container-Start': String(offset), 'X-Plex-Container-Size': String(limit), sort: `${sort[2]}:${descending ? 'desc' : 'asc'}`, includeGuids: '1', includeMeta: '1' } : {
    StartIndex: String(offset), Limit: String(limit), EnableUserData: 'true', Fields: 'ProviderIds,Overview,Genres,Studios,Artists,DateCreated,SortName,CommunityRating,CriticRating,OfficialRating,ProductionYear,PremiereDate,MediaSources,SeriesName,AirTime,PrimaryImageAspectRatio', SortBy: sort[1] === 'SortName' ? 'SortName' : `${sort[1]},SortName`, SortOrder: descending ? 'Descending' : 'Ascending'
  })
  let path = ''
  if (plex) {
    if (category === 'favorites') throw new Error('Plex 不支持服务器收藏分类')
    if (root) path = 'library/sections'
    else if (route.personId) path = `library/people/${enc(route.personId)}/media`
    else if (route.kind === 'search') { path = 'hubs/search'; q.set('query', route.query || ''); q.set('limit', '100'); q.set('includeExternalMedia', '0') }
    else if (category === 'playlists') { path = 'playlists'; q.set('playlistType', 'video') }
    else if (category === 'resume') path = 'hubs/home/continueWatching'
    else if (category === 'nextup') path = 'library/onDeck'
    else if (route.id?.startsWith('playlist:')) path = `playlists/${enc(serverItemId(route.id))}/items`
    else if (route.id?.startsWith('section:')) path = `library/sections/${enc(route.id.slice(8))}/${category === 'collections' ? 'collections' : 'all'}`
    else if (route.id) path = `library/metadata/${enc(route.id)}/children`
    else throw new Error('Plex 浏览缺少媒体库范围')
    const type = options.type || (category === 'movies' ? 'Movie' : category === 'shows' ? 'Series' : category === 'collections' ? 'BoxSet' : '')
    const types: Record<string, string> = { Movie: '1', Series: '2', Season: '3', Episode: '4', BoxSet: '18', Video: '12' }
    if (types[type]) q.set('type', types[type])
    if (route.id?.startsWith('section:')) {
      for (const key of ['genre', 'studio'] as const) if (options[key] && !/^\d+$/.test(options[key]!)) {
        const data = await json<Record<string,any>>(account,'GET',endpoint(account,`library/sections/${enc(route.id.slice(8))}/${key}`))
        const found = data.MediaContainer?.Directory?.find((entry: any) => (entry.title || entry.tag) === options[key])
        if (!found) return { items: [], total: 0 }
        options = { ...options, [key]: String(found.key) }
      }
    }
    for (const [key, value] of Object.entries({ genre: options.genre, studio: options.studio, year: options.year, contentRating: options.certification, 'rating>': options.minRating, 'rating<': options.maxRating, unwatched: options.watched === 'yes' ? '0' : options.watched === 'no' ? '1' : undefined })) if (value) q.set(key, value)
  } else {
    path = `Users/${enc(account.userId!)}/Items`
    if (root) path = `Users/${enc(account.userId!)}/Views`
    else if (category === 'resume') path += '/Resume'
    else if (category === 'nextup') { path = 'Shows/NextUp'; q.set('UserId', account.userId!) }
    else if (route.id?.startsWith('playlist:')) { path = `Playlists/${enc(serverItemId(route.id))}/Items`; q.set('UserId', account.userId!) }
    else if (route.id) q.set('ParentId', route.id)
    if (route.kind === 'category' || route.kind === 'search') {
      q.set('Recursive', 'true')
      q.set('IncludeItemTypes', options.type || (category === 'movies' ? 'Movie' : category === 'shows' ? 'Series' : category === 'collections' ? 'BoxSet' : category === 'playlists' ? 'Playlist' : category === 'favorites' ? route.favoriteType || 'Movie,Series,Episode,Video,BoxSet,Playlist' : route.kind === 'search' ? 'Movie,Series,Season,Episode,Video,BoxSet,Playlist,Person' : 'Movie,Series,Video'))
    }
    if (category === 'favorites') { q.set('IsFavorite', 'true'); if (route.favoriteType === 'Person') { path = 'Persons'; q.delete('IncludeItemTypes'); q.set('UserId', account.userId!) } }
    if (route.kind === 'search') q.set('SearchTerm', route.query || '')
    if (route.personId) q.set('PersonIds', route.personId)
    for (const [key, value] of Object.entries({ Genres: options.genre, Studios: options.studio, Years: options.year, OfficialRatings: options.certification, MinCommunityRating: options.minRating, MaxCommunityRating: options.maxRating, IsPlayed: options.watched === 'yes' ? 'true' : options.watched === 'no' ? 'false' : undefined })) if (value) q.set(key, value)
  }
  const data = await json<Record<string, any>>(account, 'GET', endpoint(account, `${path}?${q}`))
  const container = plex ? data.MediaContainer : data
  if (!container || typeof container !== 'object') throw new Error('服务器列表响应无效')
  const rows = plex ? root ? container.Directory : container.Metadata ?? (container.Hub ? container.Hub.flatMap((hub: any) => hub.Metadata || []) : []) : container.Items
  if (!Array.isArray(rows)) throw new Error('服务器列表响应无效')
  const total = plex ? container.totalSize : container.TotalRecordCount
  const items = rows.filter((row: any) => root ? (plex ? ['movie', 'show', 'video'].includes(String(row.type || '').toLowerCase()) : !['music', 'audiobooks', 'books', 'photos'].includes(String(row.CollectionType || '').toLowerCase())) : videoKinds.has(String(plex ? row.type : row.Type).toLowerCase())).map((row: any) => normalizeItem(row, plex, root))
  // Plex hubs/search has no offset protocol: never fabricate a next page.
  const next = !root && route.kind !== 'search' || !plex && route.kind === 'search'
  return { items, total, nextOffset: next && rows.length && (typeof total === 'number' ? offset + rows.length < total : rows.length === limit) ? offset + rows.length : undefined }
}
export async function serverDetail(account: Account, id: string) {
  mediaServerAccount(account)
  const plex = account.providerId === 'plex'
  const data = await json<Record<string, any>>(account, 'GET', endpoint(account, plex ? `library/metadata/${enc(serverItemId(id))}?includeGuids=1&includeMeta=1` : `Users/${enc(account.userId!)}/Items/${enc(serverItemId(id))}`))
  const row = plex ? data.MediaContainer?.Metadata?.[0] : data
  if (!row || !(plex ? row.ratingKey : row.Id)) throw new Error('服务器条目不存在')
  return normalizeItem(row, plex)
}
export async function setWatched(account: Account, id: string, watched: boolean) {
  mediaServerAccount(account); id = serverItemId(id)
  if (account.providerId === 'plex') await request(account, 'GET', endpoint(account, `:/${watched ? 'scrobble' : 'unscrobble'}?${new URLSearchParams({ key: id, identifier: 'com.plexapp.plugins.library' })}`))
  else await request(account, watched ? 'POST' : 'DELETE', endpoint(account, `Users/${enc(account.userId!)}/PlayedItems/${enc(id)}`))
}
export async function collectPlayable(account: Account, route: BrowseRoute, options: BrowseOptions = {}, seen = new Set<string>()): Promise<ServerItem[]> {
  if (seen.size > 1000) throw new Error('目录过多，请缩小播放范围')
  const items: ServerItem[] = [], ids = new Set<string>(); let offset = 0
  for (let page = 0; page < 100; page++) {
    const result = await browseServer(account, route, { ...options, offset })
    let added = 0
    for (const item of result.items) {
      if (ids.has(item.id)) continue
      ids.add(item.id); added++
      if (item.playable) items.push(item)
      else if (item.isDirectory && !seen.has(item.id)) { seen.add(item.id); items.push(...await collectPlayable(account, { kind: 'children', id: item.id, title: item.name }, options, seen)) }
      if (items.length > 1000) throw new Error('播放队列超过1000项，请缩小范围')
    }
    if (result.nextOffset === undefined) return [...new Map(items.map(item => [item.id, item])).values()]
    if (!added || result.nextOffset <= offset) throw new Error('服务器未推进分页')
    offset = result.nextOffset
  }
  throw new Error('服务器分页过多，请缩小范围')
}

export function needsLocalSort(account: Account, sort?: keyof typeof sortFields) { return sort === 'random' || account.providerId === 'plex' && ['videoBitrate', 'airTime', 'artist', 'seriesTitle', 'airOrder'].includes(sort || '') }
export function compareItems(a: ServerItem, b: ServerItem, sort: keyof typeof sortFields, descending = false, seed = 0): number {
 const value = (item: ServerItem) => sort === 'random' ? randomRank(item.id, seed) : item.sortValues?.[sort]
 const x = value(a), y = value(b), missingX = x == null || x === '', missingY = y == null || y === ''
 if (missingX !== missingY) return missingX ? 1 : -1
 const result = missingX ? 0 : typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })
 return result * (descending ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id)
}
/** Exhaust all pages before local ordering: never sort only the current Plex page. */
export async function allServerItems(account: Account, route: BrowseRoute, options: BrowseOptions = {}): Promise<ServerItem[]> {
 const result = new Map<string, ServerItem>(); let offset = 0
 for (let page = 0; page < 100; page++) {
  const data = await browseServer(account, route, { ...options, sort: 'sortName', offset, limit: 100 }); let added = 0
  for (const item of data.items) if (!result.has(item.id)) { added++; result.set(item.id, item) }
  if (data.nextOffset === undefined) return [...result.values()]
  if (!added || data.nextOffset <= offset) throw new Error('服务器未推进分页')
  offset = data.nextOffset
 }
 throw new Error('服务器条目过多，无法完整排序，请缩小范围')
}

export const facetNames = { genre: '按类型', studio: '按制片公司', year: '按发行日期', certification: '按分级', rating: '按评分', network: '按电视网络' } as const
export function groupFacets(items: ServerItem[], facet: NonNullable<BrowseRoute['facet']>) {
 const counts = new Map<string, number>()
 for (const item of items) {
  const values = facet === 'genre' ? item.genres : ['studio', 'network'].includes(facet) ? item.studios : facet === 'year' ? item.year ? [item.year] : [] : facet === 'rating' ? item.rating == null ? [] : [String(Math.floor(item.rating))] : item.sortValues?.officialRating ? [String(item.sortValues.officialRating)] : []
  for (const value of new Set(values)) if (value) counts.set(value, (counts.get(value) || 0) + 1)
 }
 return [...counts].map(([value, count]) => ({ value, count })).sort((a,b) => a.value.localeCompare(b.value, undefined, { numeric: true }))
}

export interface FacetEntry { value: string; label: string; count?: number }
export async function serverFacets(account: Account, route: BrowseRoute): Promise<FacetEntry[]> {
 mediaServerAccount(account)
 const facet = route.facet
 if (!facet) return []
 if (facet === 'rating') return groupFacets(await allServerItems(account, { ...route, facet: undefined, value: undefined }), facet).map(row => ({ ...row, label: row.value + ' 分' }))
 const plex = account.providerId === 'plex'
 if (plex) {
  const roots = route.id?.startsWith('section:') ? [{ id: route.id, libraryType: '' }] : (await browseServer(account, { kind: 'root', title: '' })).items
  const result = new Map<string, FacetEntry>()
  for (const root of roots) {
   if (root.libraryType && (route.category === 'movies' && root.libraryType !== 'movie' || route.category === 'shows' && root.libraryType !== 'show')) continue
   const name = facet === 'certification' ? 'contentRating' : facet === 'network' ? 'studio' : facet
   const data = await json<Record<string, any>>(account,'GET',endpoint(account,`library/sections/${enc(root.id.slice(8))}/${name}`))
   if (!data.MediaContainer || !Array.isArray(data.MediaContainer.Directory)) throw new Error('服务器分类响应无效')
   for (const entry of data.MediaContainer.Directory) { const label = String(entry.title || entry.tag || entry.key || ''); if (label) result.set(label, { value: label, label, count: entry.count }) }
  }
  return [...result.values()]
 }
 const q = new URLSearchParams({ UserId: account.userId!, Recursive: 'true', IncludeItemTypes: route.category === 'movies' ? 'Movie' : route.category === 'shows' ? 'Series' : 'Movie,Series,Video' })
 if (route.id) q.set('ParentId', route.id)
 if (facet === 'genre' || facet === 'studio' || facet === 'network') {
  const result: FacetEntry[] = []; let offset = 0; const seen = new Set<string>()
  for (let page = 0; page < 100; page++) {
   q.set('StartIndex', String(offset)); q.set('Limit','100')
   const data = await json<Record<string, any>>(account,'GET',endpoint(account,`${facet === 'genre' ? 'Genres' : 'Studios'}?${q}`))
   if (!Array.isArray(data.Items)) throw new Error('服务器分类响应无效')
   let added = 0
   for (const item of data.Items) if (item.Name && !seen.has(item.Name)) { seen.add(item.Name); added++; result.push({value:item.Name,label:item.Name,count:item.ChildCount}) }
   offset += data.Items.length
   if (!data.Items.length || (typeof data.TotalRecordCount === 'number' ? offset >= data.TotalRecordCount : data.Items.length < 100)) return result
   if (!added) throw new Error('服务器分类分页未推进')
  }
  throw new Error('服务器分类过多，请缩小范围')
 }
 const data = await json<Record<string, any>>(account,'GET',endpoint(account,`Items/Filters?${q}`)), values = data[facet === 'year' ? 'Years' : 'OfficialRatings']
 if (!Array.isArray(values)) throw new Error('服务器分类响应无效')
 return values.map((value: any) => ({ value: String(value.Name ?? value), label: String(value.Name ?? value) }))
}
export async function similarServerItems(account: Account, id: string): Promise<ServerItem[]> {
 const plex = account.providerId === 'plex', data = await json<Record<string, any>>(account,'GET',endpoint(account,plex ? `library/metadata/${enc(id)}/similar` : `Items/${enc(id)}/Similar?${new URLSearchParams({UserId:account.userId || '',Limit:'12',Fields:'Overview,Genres,Studios'})}`))
 const rows = plex ? data.MediaContainer?.Metadata : data.Items
 if (!Array.isArray(rows)) return []
 return rows.filter((row: any) => videoKinds.has(String(plex ? row.type : row.Type).toLowerCase())).map((row: any) => normalizeItem(row,plex))
}

export async function serverHomeStatistics(account:Account,libraries:ServerItem[]){if(account.providerId==='plex')return {libraryCount:libraries.length,movieCount:libraries.filter(i=>i.libraryType==='movie').reduce((n,i)=>n+(i.childCount||0),0),seriesCount:libraries.filter(i=>i.libraryType==='show').reduce((n,i)=>n+(i.childCount||0),0),episodeCount:0};const counts=await json<{MovieCount?:number;SeriesCount?:number;EpisodeCount?:number}>(account,'GET',endpoint(account,'Items/Counts'));return {libraryCount:libraries.length,movieCount:counts.MovieCount||0,seriesCount:counts.SeriesCount||0,episodeCount:counts.EpisodeCount||0}}
