import {useVideoCatalog} from '../catalog'
import usePlacement from '@/stores/categoryPlacement'
export interface SeriesMedia {id:string;title:string;serverId?:string;parentId?:string}
export interface CustomSeriesDetail {id:string;title:string;members:(SeriesMedia&{posterUrl?:string})[]}
export const seriesMediaKey=(item:SeriesMedia)=>JSON.stringify([item.serverId||'local',item.id])
export const openCustomSeries=(item:SeriesMedia)=>window.dispatchEvent(new CustomEvent('boxplayer:custom-series',{detail:item}))
export function loadCustomSeries():CustomMediaSeries[]{const catalog=useVideoCatalog();return Object.entries(catalog.data.series).map(([title,ids])=>({id:encodeURIComponent(title),title,members:ids.map(id=>({id,title:catalog.items.find(item=>item.id===id)?.name||id}))}))}

export interface CustomMediaSeries {id:string;title:string;members:SeriesMedia[]}
export async function saveCustomSeries(groups:CustomMediaSeries[]){const catalog=useVideoCatalog(),before=loadCustomSeries();await catalog.update(draft=>{draft.series=Object.fromEntries(groups.map(group=>[group.title,group.members.filter(member=>!member.serverId).map(member=>member.id)]))});for(const group of groups){const previous=before.find(value=>value.id===group.id);if(previous&&previous.title!==group.title)await usePlacement().renameRoute('custom-series/'+previous.id,'custom-series/'+encodeURIComponent(group.title))}window.dispatchEvent(new Event('boxplayer:custom-series-changed'))}
export function toggleSeriesMember(group:CustomMediaSeries,item:SeriesMedia):CustomMediaSeries{const key=seriesMediaKey(item),exists=group.members.some(member=>seriesMediaKey(member)===key);return {...group,members:exists?group.members.filter(member=>seriesMediaKey(member)!==key):[...group.members,item]}}
