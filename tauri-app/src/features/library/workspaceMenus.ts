import type { VideoItem } from './catalog'
import {generalPreferences} from './displayPreferences'
export interface WorkspaceVideo extends VideoItem { personalRating?: number; continueHidden?: boolean; continueAdded?: boolean; resolution?: string }
export interface MenuEntry { id: string; label: string; disabled?: boolean; reason?: string }
export const categoryLabels: Record<string,string> = {all:'全部',recent:'最近添加',unwatched:'未观看的',mini:'迷你剧',genres:'按类型',ratings:'按评价',years:'按发行日期',certification:'按分级',resolution:'按分辨率',networks:'按电视网',concerts:'演唱会',shorts:'短视频'}
export function rootCategories(root:string){return (root==='movies'?['all','recent','unwatched','genres','ratings','years','certification','resolution','concerts','shorts']:['all','recent','unwatched','mini','genres','ratings','years','certification','resolution','networks']).map(id=>({route:root+'/'+id,title:id==='all'?(root==='movies'?'所有电影':'所有电视剧'):categoryLabels[id]!,count:0}))}
const labels:Record<string,string>={play:'播放',loop:'循环播放',shuffle:'随机播放',select:'选择',rating:'个人评分',share:'分享',download:'下载',metadata:'编辑元数据',watched:'标记为已观看',continue:'添加到继续观看',playlist:'添加到播放列表',series:'添加到自定义系列',delete:'删除',refresh:'刷新元数据',favorite:'收藏',removeMember:'移除成员',reorderMember:'重新排序'}
export function posterMenu(item:WorkspaceVideo,server:boolean,membership:boolean|'playlist'|'series',detail=false):MenuEntry[]{
 const ids=detail&&server?['loop','shuffle','watched','favorite','playlist','rating','refresh','share','download']:server?(item.type==='tv'?['play','loop','shuffle','rating','favorite','refresh','watched','playlist','delete']:['play','loop','rating','share','download','refresh','watched','favorite','playlist','delete']):item.type==='tv'?['play','loop','shuffle','select','rating','watched','continue','playlist','series','delete']:['play','loop','select','rating','share','download','metadata','watched','continue','playlist','series','delete']
 return [...ids.filter(id=>(!membership||id!=='delete')&&(id!=='delete'||generalPreferences.fileManagement)),...(membership?['reorderMember','removeMember']:[])].map(id=>({id,label:id==='removeMember'&&typeof membership==='string'?(membership==='playlist'?'从播放列表移除':'从系列移除'):id==='watched'&&item.watched?'标记为未观看':id==='continue'&&((item.progress||0)>0||item.continueAdded)&&!item.continueHidden?'从继续观看移除':id==='favorite'&&item.favorite?'取消收藏':labels[id]!,disabled:id==='download'&&item.local||server&&id==='playlist',reason:server&&id==='playlist'?'服务器不提供播放列表分配':id==='download'&&item.local?'本地文件不提供下载':undefined}))
}
export function objectMenu(route:string,placed:boolean,toolbar=false):MenuEntry[]{const collection=/^(playlist|custom-series)\/.+/.test(route),series=route.startsWith('custom-series/');return [
 ...(!toolbar||collection?['play','loop',...(series?['select']:[]),'shuffle']:[]).map(id=>({id,label:labels[id]!})),
 ...(placed?[{id:'remove',label:'从主页移除'},{id:'renameFavorite',label:'重命名收藏夹'}]:[{id:'favorite',label:'添加到收藏夹'},{id:'home',label:'添加到主页'}]),
 ...(series?[...(!toolbar?[{id:'watched',label:'标记为已观看'},{id:'unwatched',label:'标记为未观看'}]:[]),{id:'playlist',label:labels.playlist!}]:[]),
 ...(!series&&(collection||route.split('/').length>=3)?[{id:'cover',label:route.startsWith('playlist/')?'刷新播放列表封面':'刷新分类封面'}]:[]),
 ...(collection?[{id:'renameCollection',label:series?'重命名系列':'重命名播放列表'},...(!toolbar?[{id:'reorder',label:'重新排序'}]:[]),{id:'deleteCollection',label:series?'删除系列':'删除播放列表'}]:[])
]}
export function appendMembers(groups:Record<string,string[]>,name:string,ids:string[]){name=name.trim();if(!name)throw new Error('请输入名称');groups[name]=[...new Set([...(groups[name]||[]),...ids])]}
export function renameCollection(groups:Record<string,string[]>,from:string,to:string){to=to.trim();if(!to)throw new Error('请输入名称');if(from===to)return;if(!(from in groups))throw new Error('集合已移除');if(to in groups)throw new Error('同名集合已存在');groups[to]=groups[from]!;delete groups[from]}
export function moveMember(ids:string[],id:string,offset:number){const index=ids.indexOf(id),target=index+offset;if(index<0||target<0||target>=ids.length)return [...ids];const next=[...ids];next.splice(index,1);next.splice(target,0,id);return next}

export function orderedWorkspaceVersions(items:VideoItem[],mode:string):VideoItem[]{return mode==='auto'?[...items]:[...items].sort((a,b)=>a.size>0&&b.size>0?(mode==='largest'?b.size-a.size:a.size-b.size):Number(b.size>0)-Number(a.size>0))}
export function playbackItems(items:VideoItem[],mode:string):VideoItem[]{
 const groups=new Map<string,VideoItem[]>()
 for(const item of items){const identity=item.tmdbId?`${item.type}:tmdb:${item.tmdbId}`:item.seriesId?`${item.sourceId}:series:${item.seriesId}`:item.id;const key=item.type==='movie'?identity:item.type==='tv'&&item.episodeNumber!==undefined?`${identity}:s${item.seasonNumber||0}:e${item.episodeNumber}`:item.id;const group=groups.get(key)||[];group.push(item);groups.set(key,group)}
 return [...groups.values()].map(group=>orderedWorkspaceVersions(group,mode)[0]!)
}
