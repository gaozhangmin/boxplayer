import {useVideoCatalog} from '@/features/library/catalog'
export function readPersonalRatings(){return Object.fromEntries(useVideoCatalog().items.filter(item=>item.personalRating).map(item=>[item.id,item.personalRating!]))}
export async function savePersonalRating(id:string,rating:number){await useVideoCatalog().patch(id,{personalRating:rating})}
