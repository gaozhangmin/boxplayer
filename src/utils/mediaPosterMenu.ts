import { generalPreferences } from './seriesVersionPreferences'
export type PosterAction = 'play' | 'loop' | 'shuffle' | 'favorite' | 'refresh' | 'watched' | 'playlist' | 'delete' | 'transcode' | 'rating' | 'share' | 'download' | 'select' | 'metadata' | 'continue' | 'series' | 'removePlaylistItem' | 'reorderPlaylistItem' | 'removeSeriesItem' | 'reorderSeriesItem'
export function mediaPosterActions(server: boolean, tv: boolean, membership?: 'playlist' | 'series'): PosterAction[] {
 const base: PosterAction[] = server
  ? tv ? ['play','loop','shuffle','rating','favorite','refresh','watched','playlist','delete'] : ['play','loop','rating','share','download','refresh','watched','favorite','playlist','delete']
  : tv ? ['play','loop','shuffle','select','rating','watched','continue','playlist','series','delete'] : ['play','loop','select','rating','share','download','metadata','watched','continue','playlist','series','delete']
 if (!generalPreferences.fileManagement) { const index = base.indexOf('delete'); if (index >= 0) base.splice(index, 1) }
 if (!membership) return base
 return [...base.filter(action => action !== 'delete'), ...(membership === 'series' ? ['reorderSeriesItem', 'removeSeriesItem'] : ['reorderPlaylistItem', 'removePlaylistItem']) as PosterAction[]]
}
