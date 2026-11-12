import {ApiBatch as relocation} from './aliRelocationTransport'
import {ApiBatch as color} from './aliColorTransport'
import {ApiBatch as favorite} from './aliFavoriteTransport'
import {ApiBatch as trash} from './aliTrashTransport'
export async function ApiBatch(title:string,rows:string[],user:string,share:string){
 const urls=rows.map(row=>JSON.parse(row)?.url)
 if(urls.length&&urls.every(url=>url==='/file/update')&&rows.every(row=>typeof JSON.parse(row)?.body?.description==='string'))return color(title,rows,user,share)
 if(urls.length&&urls.every(url=>url==='/file/update'))return favorite(title,rows,user,share)
 if(urls.length&&urls.every(url=>['/recyclebin/trash','/recyclebin/restore','/file/delete'].includes(url)))return trash(title,rows,user,share)
 return relocation(title,rows,user,share)
}
