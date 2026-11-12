import type { BrowseRoute } from '@/features/servers/workspace'
import { providerIcon } from './sourcePresentation'
export interface SavedFolder { id: string; name: string }
export interface SourceFavorite { id: string; name: string; path: string; isDriveRoot?: boolean }
export interface SavedDrive { id: string; name: string; kind: 'local' | 'remote'; favorites: SourceFavorite[] }
export interface FileSourcesSnapshot {
  localFolders: SavedFolder[]
  drives: SavedDrive[]
  mediaServers: SavedFolder[]
  serverFavorites?: {sourceId:string;favoriteId:string;name:string;route:BrowseRoute}[]
  presentation?: { hiddenLocalRoots?:Record<string,boolean>; order:string[]; names:Record<string,string>; providerIds:Record<string,string>; descending:boolean }
  hasDirectURLs: boolean
}
export type FileSidebarEntry = {
  id: string
  title: string
  kind: 'localFolder' | 'drive' | 'favorite' | 'mediaServer' | 'serverFavorite' | 'directURL'
  sourceId?: string
  favoriteId?: string
  serverRoute?: BrowseRoute
  cardId?: string
  icon?: string
}
const entryId = (...parts: string[]) => JSON.stringify(parts)
// Electron retains source roots alongside folder favorites in one flat Files group.
export function buildFileSidebarEntries(snapshot: FileSourcesSnapshot, directURLTitle: string): FileSidebarEntry[] {
  const entries: FileSidebarEntry[] = snapshot.localFolders.filter(folder=>!snapshot.presentation?.hiddenLocalRoots?.[folder.id]).map(folder => ({ id: entryId('local', folder.id), title: folder.name, kind: 'localFolder', sourceId: folder.id }))
  for (const drive of snapshot.drives) {
    if (drive.kind !== 'local') {
      entries.push({ id: entryId('drive', drive.id), title: drive.name, kind: 'drive', sourceId: drive.id })
    }
    for (const favorite of drive.favorites) {
        const localRoot = drive.kind === 'local' && (favorite.isDriveRoot || favorite.id === 'root')
        if (!localRoot) entries.push({ id: entryId('favorite', drive.id, favorite.id), title: favorite.name, kind: 'favorite', sourceId: drive.id, favoriteId: favorite.id, icon:undefined })
    }
  }
  for (const server of snapshot.mediaServers) entries.push({ id: entryId('server', server.id), title: server.name, kind: 'mediaServer', sourceId: server.id })
  for(const favorite of snapshot.serverFavorites||[])entries.push({id:favorite.favoriteId,cardId:favorite.favoriteId,title:favorite.name,kind:'serverFavorite',sourceId:favorite.sourceId,favoriteId:favorite.favoriteId,serverRoute:favorite.route,icon:undefined})
  if (snapshot.hasDirectURLs) entries.push({ id: entryId('directURL'), title: directURLTitle, kind: 'directURL' })
  const presentation=snapshot.presentation
  const result=entries.map(entry=>{const cardId=entry.favoriteId||entry.sourceId||entry.id;return {...entry,cardId,title:presentation?.names[cardId]||entry.title,icon:entry.icon||(entry.kind!=='favorite'?providerIcon(presentation?.providerIds[entry.sourceId||'']):undefined)}})
  if(presentation)result.sort((a,b)=>{const ai=presentation.order.indexOf(a.cardId),bi=presentation.order.indexOf(b.cardId);return (ai<0?9999:ai)-(bi<0?9999:bi)||a.title.localeCompare(b.title)*(presentation.descending?-1:1)})
  return result
}
