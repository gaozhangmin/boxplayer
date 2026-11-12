// Electron UnifiedMediaLibraryView / unifiedLibraryCategories sidebar order.
export const videoLibraryRoutes=[
 ['playlist','播放列表'],['daily','每日精选'],['movies/all','所有电影'],['tv/all','所有电视剧'],['tv/mini','迷你剧'],['recent','最近添加'],['unwatched','未观看'],['series','系列'],['movies/genres','按类型'],['tv/networks','按网络'],['movies/ratings','按评价'],['movies/years','按发行日期'],['movies/certification','按分级'],['movies/concerts','演唱会'],['movies/shorts','短视频'],['other','其他'],
] as const
export function libraryTitle(route:string):string{
 const title=videoLibraryRoutes.find(([id])=>id===route)?.[1];if(title)return title
 const roots:Record<string,string>={home:'主屏幕',library:'媒体库',favorites:'收藏夹',movies:'电影',tv:'电视剧',files:'文件',search:'搜索结果'}
 if(roots[route])return roots[route]
 const parts=route.split('/');try{const value=decodeURIComponent(parts.at(-1)||route);const labels:Record<string,string>={'rating:top30':'前 30','rating:8-10':'8–10 星','rating:1-4':'1–4 星','year:newest':'最新的','year:earlier':'更早','network:other':'其他'};return labels[value]||(/^rating:[5-7]$/.test(value)?value.slice(7)+' 星':value)}catch{return route}
}
export function libraryRoot(route:string){return ['files','home','library'].includes(route)?route:route==='favorites'?'home':'library'}

export function homeRouteTitle(route:string){const labels:Record<string,string>={'movies/all':'电影','movies/genres':'电影类型','tv/all':'电视','movies/ratings':'电影 - 按评价','movies/years':'电影 - 按发行日期'};return labels[route]||libraryTitle(route)}
