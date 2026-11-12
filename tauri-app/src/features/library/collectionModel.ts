import type {VideoItem} from './catalog'
export interface MovieCollection {id:string;title:string;members:VideoItem[]}
export function movieCollections(items:VideoItem[]):MovieCollection[]{
 const groups=new Map<string,MovieCollection>()
 for(const item of items){if(item.type!=='movie'||!item.collectionId)continue;const id=String(item.collectionId),group=groups.get(id)||{id,title:item.collectionName||item.name,members:[]};for(const member of item.collectionMovies?.length?item.collectionMovies:[item])if(!group.members.some(value=>value.id===member.id))group.members.push(member);groups.set(id,group)}
 return [...groups.values()]
}
