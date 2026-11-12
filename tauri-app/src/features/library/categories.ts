import type {VideoItem} from './catalog'
import {categoryRoute} from './categoryPlacement'
const networkAliases:Record<string,string>={netflix:'Netflix',hulu:'Hulu','apple tv':'Apple TV+','apple tv+':'Apple TV+','disney+':'Disney+','prime video':'Prime Video','amazon prime video':'Prime Video','hbo max':'Max',max:'Max',hbo:'HBO',showtime:'Showtime','paramount+':'Paramount+',peacock:'Peacock'}
export const networkGroup=(name:string)=>networkAliases[name.trim().toLowerCase()]||'network:other'
export function resolutions(item:VideoItem){const height=item.height||Number(item.fileName.match(/\b(2160|1080|720|480)p\b/i)?.[1])||(/\b4k\b/i.test(item.fileName)?2160:0);return height>=2160?['4K']:height>=1080?['1080p']:height>=720?['720p']:height>0?['SD']:[]}
export const yearGroup=(year:string)=>Number(year)>=2020?'2020+':Number(year)<1940?'更早':`${Math.floor(Number(year)/10)*10}s`
export const ratingGroup=(rating:number)=>rating>=8?'rating:8-10':rating>=5?`rating:${Math.floor(rating)}`:'rating:1-4'
export function categoryItems(all:VideoItem[],address:string){
 const [root,category='all',encoded='']=categoryRoute(address).split('/'),value=decodeURIComponent(encoded)
 let items=all.filter(item=>root==='movies'?item.type==='movie':root==='tv'?item.type==='tv':root==='other'?item.type==='unmatched':true)
 if(root==='unwatched'||category==='unwatched')items=items.filter(item=>!item.watched)
 if(category==='genres'&&value)items=items.filter(item=>item.genres.includes(value))
 if(category==='ratings'&&value){if(value==='rating:top30')return [...items].filter(item=>(item.rating||0)>0).sort((a,b)=>(b.rating||0)-(a.rating||0)).slice(0,30);items=items.filter(item=>!!item.rating&&item.rating<=10&&ratingGroup(item.rating)===value)}
 if(category==='years'&&value){if(value==='year:newest')return [...items].filter(item=>item.year).sort((a,b)=>String(b.releaseDate||b.year).localeCompare(String(a.releaseDate||a.year))).slice(0,30);items=items.filter(item=>item.year===value||yearGroup(item.year||'')===(value==='year:earlier'?'更早':value))}
 if(category==='resolution'&&value)items=items.filter(item=>resolutions(item).includes(value))
 if(category==='certification'&&value)items=items.filter(item=>item.certification===value)
 if(category==='networks'&&value)items=items.filter(item=>item.networks?.some(name=>networkGroup(name)===value))
 if(category==='mini')items=items.filter(item=>item.isMiniseries===true)
 if(category==='concerts')items=items.filter(item=>item.mediaSubtype==='concert')
 if(category==='shorts')items=items.filter(item=>item.mediaSubtype==='short')
 if(root==='recent'||category==='recent')items=[...items].sort((a,b)=>b.addedAt.localeCompare(a.addedAt))
 return items
}
export function categoryGroups(items:VideoItem[],route:string){
 const category=route.split('/')[1],base=categoryItems(items,route.split('/')[0]+'/all'),groups=new Map<string,{title:string;ids:string[]}>()
 const add=(id:string,title:string,item:VideoItem)=>{const group=groups.get(id)||{title,ids:[]};group.ids.push(item.id);groups.set(id,group)}
 if(category==='ratings'){const rated=base.filter(item=>!!item.rating&&item.rating<=10);if(rated.length)groups.set('rating:top30',{title:'前 30',ids:[...rated].sort((a,b)=>b.rating!-a.rating!).slice(0,30).map(item=>item.id)});for(const item of rated){const id=ratingGroup(item.rating!);add(id,id==='rating:8-10'?'8–10 星':id==='rating:1-4'?'1–4 星':`${id.slice(7)} 星`,item)}}
 else if(category==='years'){const dated=base.filter(item=>item.year&&Number(item.year)>0);if(dated.length)groups.set('year:newest',{title:'最新的',ids:[...dated].sort((a,b)=>String(b.releaseDate||b.year).localeCompare(String(a.releaseDate||a.year))).slice(0,30).map(item=>item.id)});for(const item of dated){const title=yearGroup(item.year!);add(title==='更早'?'year:earlier':title,title,item)}}
 else for(const item of base){const values=category==='genres'?item.genres:category==='networks'?(item.networks||[]).map(networkGroup):category==='resolution'?resolutions(item):item.certification?[item.certification]:[];for(const value of new Set(values))add(value,value==='network:other'?'其他':value,item)}
 const order=category==='ratings'?['rating:top30','rating:8-10','rating:7','rating:6','rating:5','rating:1-4']:['year:newest','2020+','2010s','2000s','1990s','1980s','1970s','1960s','1950s','1940s','year:earlier'];return [...groups].sort(([a],[b])=>['ratings','years'].includes(category!)?order.indexOf(a)-order.indexOf(b):0).map(([id,group])=>({route:route+'/'+encodeURIComponent(id),title:group.title,count:group.ids.length})).sort((a,b)=>['years','ratings'].includes(category!)?0:category==='networks'&&((a.title==='其他')!==(b.title==='其他'))?(a.title==='其他'?1:-1):a.title.localeCompare(b.title,undefined,{numeric:true}))
}
